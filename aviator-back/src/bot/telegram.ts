import { Bot, InlineKeyboard } from "grammy";
import { config } from "../config";

export const startTelegramBot = async (): Promise<void> => {
  if (!config.telegramBotToken) {
    console.log("[bot] TELEGRAM_BOT_TOKEN not set — skipping bot");
    return;
  }

  const bot = new Bot(config.telegramBotToken);

  bot.command("start", (ctx) => {
    const kb = new InlineKeyboard().webApp("🛩️ Play Aviator", config.telegramWebappUrl);
    return ctx.reply(
      "Welcome to Aviator Crash! Tap below to launch the game.",
      { reply_markup: kb },
    );
  });

  bot.command("balance", async (ctx) => {
    await ctx.reply(
      "Open the WebApp to view balance and place bets.",
      {
        reply_markup: new InlineKeyboard().webApp("Open Aviator", config.telegramWebappUrl),
      },
    );
  });

  bot.command("help", (ctx) =>
    ctx.reply(
      "Aviator Crash — multiplayer crash game.\n\n" +
        "Commands:\n" +
        "/start — open the game\n" +
        "/balance — open game and view balance\n" +
        "/help — this message",
    ),
  );

  bot.catch((err) => console.error("[bot] error:", err));

  // Start in background
  bot.start({ onStart: (info) => console.log(`[bot] @${info.username} started`) }).catch((err) => {
    console.error("[bot] start failed:", err.message);
  });
};
