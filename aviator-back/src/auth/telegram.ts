import { createHmac } from "crypto";
import { config } from "../config";

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
 * Steps:
 *   secret_key = HMAC_SHA256("WebAppData", bot_token)
 *   data_check_string = sorted "key=value" lines (excluding hash) joined by \n
 *   expected = HMAC_SHA256(secret_key, data_check_string) hex
 */
export const validateInitData = (
  initData: string,
): { ok: true; user: TelegramUser; authDate: number } | { ok: false; reason: string } => {
  if (!config.telegramBotToken) return { ok: false, reason: "Bot token not configured" };
  if (!initData) return { ok: false, reason: "Empty initData" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "Missing hash" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(config.telegramBotToken)
    .digest();

  const expected = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (expected !== hash) return { ok: false, reason: "Invalid hash" };

  const userJson = params.get("user");
  if (!userJson) return { ok: false, reason: "No user payload" };
  let user: TelegramUser;
  try {
    user = JSON.parse(userJson);
  } catch {
    return { ok: false, reason: "Bad user JSON" };
  }

  const authDate = Number(params.get("auth_date") || 0);
  return { ok: true, user, authDate };
};
