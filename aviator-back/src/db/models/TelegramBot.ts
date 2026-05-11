import { Schema, model } from "mongoose";

/**
 * TelegramBot — operator-managed bot account.
 *
 * Telegram occasionally bans gambling-related bots. Having multiple bot
 * accounts with different @usernames means a single ban doesn't kill
 * the funnel. Operator can:
 *   • Register 2-3 bot accounts via @BotFather
 *   • Add each as a row here (token + @username)
 *   • If one gets banned, flip its enabled=false and reconfigure the
 *     inline buttons / advertise the backup bot's deep link
 *
 * The auth flow `validateInitData` iterates all enabled bots — whichever
 * token's HMAC matches the received hash wins. So a player who joined
 * via Bot A keeps working even after admin adds Bot B.
 *
 * Each bot stores its OWN webapp URL — usually all bots point at the
 * same frontend (https://aviator.rummydeatly.com), but the field lets
 * an operator point bots at different deployments if needed.
 */
export interface TelegramBotDoc {
  code: string;         // stable identifier, e.g. "primary" / "backup-1"
  name: string;         // display name in admin
  token: string;        // bot HTTP API token from @BotFather  ⚠ SENSITIVE
  username?: string;    // @bot_username — display + deep-link generation
  webappUrl: string;    // URL Telegram opens when user taps Play
  /**
   * Per-bot /start reply text. Defaults to the canonical primary copy
   * if empty. Lets the operator soften wording on backup bots that may
   * be ad-targeted, e.g. avoid "crash" / "betting" in the response so
   * Telegram review crawlers see neutral content.
   */
  startMessage: string;
  /** Per-bot CTA button label shown on /start. Default "🛩️ Play Aviator". */
  startButtonLabel: string;
  enabled: boolean;     // master switch for this bot
  createdAt: Date;
  updatedAt: Date;
}

const TelegramBotSchema = new Schema<TelegramBotDoc>(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    token: { type: String, required: true },
    username: { type: String, default: "" },
    webappUrl: { type: String, default: "" },
    startMessage: { type: String, default: "" },
    startButtonLabel: { type: String, default: "" },
    enabled: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "telegrambots" },
);

export const TelegramBotModel = model<TelegramBotDoc>("TelegramBot", TelegramBotSchema);
