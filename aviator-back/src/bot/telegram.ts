import { Bot, InlineKeyboard } from "grammy";
import { config } from "../config";
import { TelegramBotModel, TelegramBotDoc } from "../db/models/TelegramBot";
import { LoginRequestModel } from "../db/models/LoginRequest";
import { authFromTelegramUser } from "../auth/session";

/**
 * Multi-bot starter. Loads all enabled TelegramBot docs and starts each
 * in long-poll mode. Each runs its own command handlers + replies with
 * its OWN webapp URL.
 *
 * Migration: if NO bot docs exist and env TELEGRAM_BOT_TOKEN is set,
 * create a "primary" bot record from env first. Same pattern as the
 * Payme settings → channel migration.
 */
const running = new Map<string, Bot>();

const DEFAULT_START_MESSAGE =
  "Welcome to Aviator Crash! Tap below to launch the game.";
const DEFAULT_START_BUTTON = "🛩️ Play Aviator";

const startOneBot = async (doc: TelegramBotDoc): Promise<void> => {
  if (running.has(doc.code)) return; // already running
  const bot = new Bot(doc.token);
  const webappUrl = doc.webappUrl || config.telegramWebappUrl;
  const startMessage = (doc.startMessage || "").trim() || DEFAULT_START_MESSAGE;
  const startButton = (doc.startButtonLabel || "").trim() || DEFAULT_START_BUTTON;

  bot.command("start", (ctx) => {
    const param: string = (ctx.match || "").trim();

    // ?start=weblogin — user came from the web browser's "Log in with Telegram"
    // button. Show a login-branded CTA instead of the generic game start.
    if (param === "weblogin") {
      const kb = new InlineKeyboard().webApp("🔑 Login to Aviator", webappUrl);
      return ctx.reply(
        "Tap the button below to log in to Aviator with your Telegram account.",
        { reply_markup: kb },
      );
    }

    // ?start=auth_<token> — cross-device login from browser
    if (param.startsWith("auth_")) {
      const loginToken = param.slice(5);
      const kb = new InlineKeyboard()
        .text("✅ Confirm Login to Aviator", `login_${loginToken}`);
      return ctx.reply(
        "Someone is trying to log in to Aviator from a browser.\n\n" +
        "If that's you, tap the button below to confirm.",
        { reply_markup: kb },
      );
    }

    // ?start=weblogin — user came from the web auth screen
    if (param === "weblogin") {
      const kb = new InlineKeyboard().webApp("🔑 Login to Aviator", webappUrl);
      return ctx.reply(
        "Tap the button below to log in to Aviator with your Telegram account.",
        { reply_markup: kb },
      );
    }

    // Normal start (from affiliate deep link, /start, etc.)
    const kb = new InlineKeyboard().webApp(startButton, webappUrl);
    return ctx.reply(startMessage, { reply_markup: kb });
  });

  // Cross-device login: user tapped "Confirm Login" inline button
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data || "";
    if (!data.startsWith("login_")) return ctx.answerCallbackQuery();

    const loginToken = data.slice(6);
    const tgUser = ctx.from;
    if (!tgUser) return ctx.answerCallbackQuery("Error: no user context.");

    // Validate the pending request
    const loginReq = await LoginRequestModel.findOne({
      token: loginToken,
      status: "pending",
    }).lean();

    if (!loginReq || loginReq.expiresAt < new Date()) {
      await ctx.answerCallbackQuery("❌ Login link expired. Try again from the website.");
      return;
    }

    try {
      // Upsert user from Telegram identity + generate JWT
      const result = await authFromTelegramUser({
        id: tgUser.id,
        username: tgUser.username,
        first_name: tgUser.first_name,
      });

      // Fulfil the pending login request so the browser poll picks it up
      await LoginRequestModel.updateOne(
        { token: loginToken },
        { status: "fulfilled", jwt: result.token },
      );

      await ctx.answerCallbackQuery("✅ Logged in!");
      await ctx.editMessageText(
        "✅ Logged in as *" + result.userName + "*\\. Return to your browser — it should refresh automatically\\.",
        { parse_mode: "MarkdownV2" },
      );
    } catch (err) {
      console.error("[bot:login_callback] error:", err);
      await ctx.answerCallbackQuery("Error — please try again.");
    }
  });
  bot.command("balance", (ctx) =>
    ctx.reply(
      "Open the WebApp to view balance and place bets.",
      { reply_markup: new InlineKeyboard().webApp(startButton, webappUrl) },
    ),
  );
  bot.command("help", (ctx) =>
    ctx.reply(
      "Aviator Crash — multiplayer crash game.\n\n" +
        "Commands:\n" +
        "/start — open the game\n" +
        "/balance — open game and view balance\n" +
        "/help — this message",
    ),
  );
  bot.catch((err) => console.error(`[bot:${doc.code}] error:`, err));

  bot.start({
    onStart: async (info) => {
      console.log(`[bot:${doc.code}] @${info.username} started`);
      // Cache the @username on the doc so admin UI can display it.
      if (info.username && info.username !== doc.username) {
        await TelegramBotModel.updateOne(
          { code: doc.code },
          { $set: { username: info.username } },
        ).catch(() => undefined);
      }
      // Set the persistent chat menu button (the blue square next to
      // the chat input) so users get an always-visible "Play" entry
      // without having to /start first. Without this call the button
      // is the default Telegram one ("Menu" with no WebApp). This
      // saves the operator from running /setmenubutton in @BotFather
      // for every new bot.
      try {
        await bot.api.setChatMenuButton({
          menu_button: {
            type: "web_app",
            text: startButton.slice(0, 64),
            web_app: { url: webappUrl },
          },
        });
        console.log(`[bot:${doc.code}] menu button set → ${webappUrl}`);
      } catch (e) {
        console.warn(`[bot:${doc.code}] setChatMenuButton failed:`, (e as Error).message);
      }
    },
  }).catch((err) => {
    console.error(`[bot:${doc.code}] start failed:`, err.message);
    running.delete(doc.code);
  });
  running.set(doc.code, bot);
};

export const stopOneBot = async (code: string): Promise<void> => {
  const bot = running.get(code);
  if (!bot) return;
  await bot.stop().catch(() => undefined);
  running.delete(code);
  console.log(`[bot:${code}] stopped`);
};

/**
 * Boot-time migration: env TELEGRAM_BOT_TOKEN → DB "primary" bot. Runs once.
 */
const migrateEnvToken = async (): Promise<void> => {
  if (!config.telegramBotToken) return;
  const existing = await TelegramBotModel.findOne({ token: config.telegramBotToken }).lean();
  if (existing) return; // already migrated
  const anyBot = await TelegramBotModel.findOne().lean();
  if (anyBot) return; // operator already added bots manually; don't touch
  await TelegramBotModel.create({
    code: "primary",
    name: "Primary (migrated from env)",
    token: config.telegramBotToken,
    webappUrl: config.telegramWebappUrl,
    enabled: true,
  });
  console.log("[bot:migrate] created \"primary\" bot from env TELEGRAM_BOT_TOKEN");
};

export const startTelegramBot = async (): Promise<void> => {
  await migrateEnvToken();
  const bots = await TelegramBotModel.find({ enabled: true }).lean();
  if (bots.length === 0) {
    console.log("[bot] no enabled bots — skipping (add one in admin → Bots, or set TELEGRAM_BOT_TOKEN env)");
    return;
  }
  for (const b of bots) {
    await startOneBot(b);
  }
};

/** Called by admin route after enabling/disabling/editing a bot. */
export const reloadBot = async (code: string): Promise<void> => {
  await stopOneBot(code);
  const doc = await TelegramBotModel.findOne({ code }).lean();
  if (doc?.enabled) await startOneBot(doc);
};
