import { Bot, InlineKeyboard } from "grammy";
import { config } from "../config";
import { TelegramBotModel, TelegramBotDoc } from "../db/models/TelegramBot";

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

    // Normal start (from affiliate deep link, /start, etc.)
    const kb = new InlineKeyboard().webApp(startButton, webappUrl);
    return ctx.reply(startMessage, { reply_markup: kb });
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
