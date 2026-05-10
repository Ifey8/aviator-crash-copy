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

  // -------- Crypto (TRON / USDT-TRC20) recharge --------
  // Network: "shasta" (testnet) | "mainnet" | "" (disabled)
  tronNetwork: (process.env.TRON_NETWORK || "shasta") as "shasta" | "mainnet" | "",
  /** USDT TRC20 contract address. Shasta: your deployed MockUSDT. Mainnet: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t. */
  tronContract: process.env.TRON_USDT_CONTRACT || "",
  /** HD master mnemonic — derives every deposit address. KEEP SECRET. */
  cryptoMasterMnemonic: process.env.CRYPTO_MASTER_MNEMONIC || "",
  /** BIP44 index for the hot wallet (where sweeps land). 0 = first child. */
  cryptoHotWalletIndex: num(process.env.CRYPTO_HOT_WALLET_INDEX, 0),
  /** Min TRX to keep in deposit addresses for sweep gas (sweeper tops up to this if low). */
  cryptoSweepGasReserveTrx: num(process.env.CRYPTO_SWEEP_GAS_RESERVE_TRX, 30),
  /**
   * Cooldown after a deposit address's last order finalises before we
   * recycle it for a new order. 1h default — long enough that a late
   * payment for the old order is unambiguously "expired", short enough
   * that the address pool stays small. Order TTL is 15min, so 1h means
   * 45min of dead time between orders sharing an address.
   */
  cryptoAddressReuseCooldownMs: num(process.env.CRYPTO_ADDRESS_REUSE_COOLDOWN_MS, 60 * 60 * 1000),
  /** Optional TronGrid API key (improves rate limits). */
  trongridApiKey: process.env.TRONGRID_API_KEY || "",
  /** Watcher poll interval (ms). 30s default — fine for testnet. */
  cryptoWatchIntervalMs: num(process.env.CRYPTO_WATCH_INTERVAL_MS, 30_000),
  /** Min confirmations before crediting. 1 for testnet, 19+ for prod USDT mainnet. */
  cryptoMinConfirmations: num(process.env.CRYPTO_MIN_CONFIRMATIONS, 1),
  /** Order expiry (ms). 15min default. */
  cryptoOrderTtlMs: num(process.env.CRYPTO_ORDER_TTL_MS, 15 * 60 * 1000),
  /** Min/max USDT per order. */
  cryptoMinUsdt: num(process.env.CRYPTO_MIN_USDT, 10),
  cryptoMaxUsdt: num(process.env.CRYPTO_MAX_USDT, 5000),
  /** Used when CoinGecko is unreachable. Manually adjust as needed. */
  usdtInrRateFallback: num(process.env.USDT_INR_RATE, 83),

  // Production-safe default: dev guest auto-creation is OFF unless explicitly
  // enabled. Setting this to true allows any tokenless socket connection to
  // spawn a fresh User doc with initialBalance — useful for local dev, a
  // disaster on prod (every anonymous visitor / scraper / TG link-preview
  // bot creates a real DB row). Set ALLOW_DEV_AUTH=true in .env only for
  // local development.
  allowDevAuth: bool(process.env.ALLOW_DEV_AUTH, false),
  initialBalance: num(process.env.INITIAL_BALANCE, 1000),
  minBet: num(process.env.MIN_BET, 1),
  maxBet: num(process.env.MAX_BET, 1000),
  betDurationMs: num(process.env.BET_DURATION_MS, 5000),
  settleDurationMs: num(process.env.SETTLE_DURATION_MS, 3000),
  houseEdge: num(process.env.HOUSE_EDGE, 0.03),
  /** Hard cap on crash multiplier. 100x ≈ 80s round; few players sit that
   * long, and the long tail causes huge variance for the operator. */
  maxCrashMultiplier: num(process.env.MAX_CRASH_MULTIPLIER, 100),
  historyLength: 30,
};
