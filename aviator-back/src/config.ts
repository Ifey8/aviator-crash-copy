import dotenv from "dotenv";
dotenv.config();

const num = (v: string | undefined, fallback: number) =>
  v && !isNaN(Number(v)) ? Number(v) : fallback;
const bool = (v: string | undefined, fallback: boolean) =>
  v == null ? fallback : v.toLowerCase() === "true";

export const config = {
  // Default ports use the 188xx range (same scheme local + prod) so common
  // ports like 3000/5000/27017 don't collide with other services.
  port: num(process.env.PORT, 18805),
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/aviator",
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramWebappUrl: process.env.TELEGRAM_WEBAPP_URL || "http://localhost:18803",
  // Used by payment providers to build paymentUrls / returnUrls.
  // Same value as telegramWebappUrl in most setups; kept separate for clarity.
  frontendUrl: process.env.FRONTEND_URL || process.env.TELEGRAM_WEBAPP_URL || "http://localhost:18803",
  // Recharge presets / limits.
  rechargeMinAmount: num(process.env.RECHARGE_MIN_AMOUNT, 100),
  rechargeMaxAmount: num(process.env.RECHARGE_MAX_AMOUNT, 50000),
  rechargeOrderTtlMs: num(process.env.RECHARGE_ORDER_TTL_MS, 15 * 60 * 1000),
  allowDevAuth: bool(process.env.ALLOW_DEV_AUTH, true),
  initialBalance: num(process.env.INITIAL_BALANCE, 1000),
  minBet: num(process.env.MIN_BET, 1),
  maxBet: num(process.env.MAX_BET, 1000),
  betDurationMs: num(process.env.BET_DURATION_MS, 5000),
  settleDurationMs: num(process.env.SETTLE_DURATION_MS, 3000),
  houseEdge: num(process.env.HOUSE_EDGE, 0.03),
  historyLength: 30,
};
