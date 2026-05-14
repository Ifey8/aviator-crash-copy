import { createHmac, createHash } from "crypto";
import { config } from "../config";
import { TelegramBotModel } from "../db/models/TelegramBot";

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

/**
 * Validate Telegram WebApp initData per the official spec:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Steps (per bot token):
 *   secret_key = HMAC_SHA256("WebAppData", bot_token)
 *   data_check_string = sorted "key=value" lines (excluding hash) joined by \n
 *   expected = HMAC_SHA256(secret_key, data_check_string) hex
 *
 * Multi-bot: WebApps are bound to ONE bot, but the operator may register
 * several to survive Telegram bans. We don't know which bot a given
 * initData came from, so we try each enabled bot's token until one
 * verifies. Cache-and-lookup is acceptable here because a request only
 * happens on (re)login, not per game tick.
 *
 * Backward compat: if no bots in DB but env TELEGRAM_BOT_TOKEN is set,
 * use that (covers fresh deploys before migration runs / single-bot
 * setups that haven't moved off env).
 */
export const validateInitData = async (
  initData: string,
): Promise<
  | { ok: true; user: TelegramUser; authDate: number; matchedBotCode?: string }
  | { ok: false; reason: string }
> => {
  if (!initData) return { ok: false, reason: "Empty initData" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "Missing hash" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const tokens: { token: string; code?: string }[] = [];
  const bots = await TelegramBotModel.find({ enabled: true }).select("token code").lean();
  for (const b of bots) {
    if (b.token) tokens.push({ token: b.token, code: b.code });
  }
  if (config.telegramBotToken) {
    // Env token as last-resort fallback. After migration runs it's
    // redundant, but harmless — verifying twice has no security cost.
    tokens.push({ token: config.telegramBotToken });
  }

  if (tokens.length === 0) {
    return { ok: false, reason: "No bot configured (add one in admin → Bots)" };
  }

  let matched: { code?: string } | null = null;
  for (const t of tokens) {
    const secretKey = createHmac("sha256", "WebAppData").update(t.token).digest();
    const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    if (expected === hash) { matched = t; break; }
  }
  if (!matched) return { ok: false, reason: "Invalid hash (no bot token matched)" };

  const userJson = params.get("user");
  if (!userJson) return { ok: false, reason: "No user payload" };
  let user: TelegramUser;
  try {
    user = JSON.parse(userJson);
  } catch {
    return { ok: false, reason: "Bad user JSON" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  return { ok: true, user, authDate, matchedBotCode: matched.code };
};

export interface TelegramWidgetPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

/**
 * Verify a Telegram Login Widget callback payload.
 * https://core.telegram.org/widgets/login#checking-authorization
 *
 * Differs from initData validation:
 *   secret_key = SHA256(bot_token)          ← NOT HMAC("WebAppData", token)
 *   data_check_string = fields sorted alphabetically (excluding hash), "key=value\n..."
 */
export const verifyWidgetHash = async (
  payload: TelegramWidgetPayload,
): Promise<{ ok: true; user: TelegramUser } | { ok: false; reason: string }> => {
  if (Date.now() / 1000 - payload.auth_date > 3600) {
    return { ok: false, reason: "auth_date expired" };
  }

  const { hash, ...fields } = payload;
  const dataCheckString = (Object.keys(fields) as (keyof typeof fields)[])
    .sort()
    .filter((k) => fields[k] !== undefined)
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

  const tokens: string[] = [];
  try {
    const promise = TelegramBotModel.find({ enabled: true }).select("token").lean();
    const bots = await Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error("DB timeout")), 1000)),
    ]);
    for (const b of bots as any[]) {
      if (b?.token) tokens.push(b.token);
    }
  } catch {
    // No DB connection (e.g. unit test env) — fall through to env token
  }
  if (config.telegramBotToken) tokens.push(config.telegramBotToken);

  if (tokens.length === 0) {
    return { ok: false, reason: "No bot configured (add one in admin → Bots)" };
  }

  for (const token of tokens) {
    const secretKey = createHash("sha256").update(token).digest();
    const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    if (expected === hash) {
      return {
        ok: true,
        user: {
          id: payload.id,
          username: payload.username,
          first_name: payload.first_name,
          last_name: payload.last_name,
          photo_url: payload.photo_url,
        },
      };
    }
  }

  return { ok: false, reason: "Invalid hash (no bot token matched)" };
};
