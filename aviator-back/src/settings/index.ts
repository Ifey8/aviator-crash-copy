import { config } from "../config";
import { SettingsModel, SettingsDoc } from "../db/models/Settings";

/**
 * In-memory cache for the singleton settings doc. Loaded once at boot
 * (loadSettings) + refreshed when admin updates via /api/admin/settings.
 *
 * Read path: getSetting("maxCrashMultiplier") returns from cache (sync,
 * no DB hit). Used by hot paths like provablyFair.computeCrashPoint.
 *
 * Write path: updateSettings(patch) merges + persists + refreshes cache.
 */

type SettingsKey =
  | "maxCrashMultiplier"
  | "houseEdge"
  | "minBet"
  | "maxBet"
  | "initialBalance"
  | "cryptoMinUsdt"
  | "cryptoMaxUsdt"
  | "usdtInrRateFallback"
  | "botMinCount"
  | "botMaxCount"
  | "referralRewardInr"
  | "withdrawalFeePct"
  | "withdrawalMinInr"
  | "wagerMultiplier"
  | "withdrawalReviewAboveInr"
  | "withdrawalReviewNewAccountHours"
  | "registerMaxPerIp24h"
  | "inrRechargeEnabled"
  | "cryptoRechargeEnabled"
  | "cryptoWithdrawalEnabled"
  | "usdtAutoPayoutEnabled"
  | "usdtAutoPayoutMaxInr";
// Payme fields removed — they live on PaymentChannel docs now. See
// payment/channels.ts.

let cache: SettingsDoc | null = null;

const defaultsFromEnv = (): Omit<SettingsDoc, "_id" | "updatedAt" | "updatedBy"> => ({
  maxCrashMultiplier: config.maxCrashMultiplier,
  houseEdge: config.houseEdge,
  minBet: config.minBet,
  maxBet: config.maxBet,
  initialBalance: config.initialBalance,
  cryptoMinUsdt: config.cryptoMinUsdt,
  cryptoMaxUsdt: config.cryptoMaxUsdt,
  usdtInrRateFallback: config.usdtInrRateFallback,
  botMinCount: 5,
  botMaxCount: 15,
  referralRewardInr: 100,
  withdrawalFeePct: 0.05,
  withdrawalMinInr: 300,
  wagerMultiplier: 1.0,
  withdrawalReviewAboveInr: 5000,
  withdrawalReviewNewAccountHours: 24,
  registerMaxPerIp24h: 3,
  inrRechargeEnabled: 0, // OFF — re-enable after a real payment provider is integrated
  cryptoRechargeEnabled: 1, // ON by default — USDT deposits are live when TRON is configured
  cryptoWithdrawalEnabled: 1, // ON by default — USDT withdrawals are live
  usdtAutoPayoutEnabled: 0, // OFF by default — operator must explicitly opt in
  usdtAutoPayoutMaxInr: 2000,
});

/**
 * Load settings into the cache. Creates the doc on first run with env
 * defaults so the system always has a value. Call once at server boot.
 *
 * BACKFILL on every boot: if the existing doc is missing fields that
 * have been added to the schema in subsequent releases (e.g. paymeXxx,
 * usdtAutoPayoutXxx), $set them to the defaultsFromEnv() values. This
 * keeps old DBs working seamlessly through schema evolution without
 * needing a manual migration step. Safe because $set only touches
 * keys that are currently undefined — operator-tuned values stay put.
 */
export const loadSettings = async (): Promise<SettingsDoc> => {
  const defaults = defaultsFromEnv();
  let doc = await SettingsModel.findById("default");
  if (!doc) {
    doc = await SettingsModel.create({ _id: "default", ...defaults });
    console.log("[settings] seeded default settings from env");
  } else {
    // Backfill missing keys
    const docObj = doc.toObject ? doc.toObject() : doc;
    const missing: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(defaults)) {
      if ((docObj as any)[k] === undefined) missing[k] = v;
    }
    if (Object.keys(missing).length > 0) {
      await SettingsModel.updateOne({ _id: "default" }, { $set: missing });
      console.log(
        `[settings] backfilled ${Object.keys(missing).length} missing key(s): ${Object.keys(missing).join(", ")}`,
      );
      doc = await SettingsModel.findById("default");
    }
  }
  const finalObj = (doc && typeof (doc as any).toObject === "function")
    ? ((doc as any).toObject() as SettingsDoc)
    : (doc as unknown as SettingsDoc);
  cache = finalObj;
  return cache;
};

/** Read a setting. Throws if loadSettings() wasn't called first. */
export const getSetting = <K extends SettingsKey>(key: K): SettingsDoc[K] => {
  if (!cache) {
    throw new Error(
      `[settings] getSetting("${key}") called before loadSettings(). ` +
        "Make sure loadSettings() is awaited in server boot.",
    );
  }
  return cache[key];
};

/**
 * Soft variant — returns `fallback` if the cache isn't loaded yet, instead
 * of throwing. Use this in code paths that may run at module-construction
 * time (e.g. provablyFair.computeCrashPoint, called from new GameEngine()).
 * The fallback should match the env-default so behaviour is consistent
 * before loadSettings() arrives.
 */
export const tryGetSetting = <K extends SettingsKey>(
  key: K,
  fallback: SettingsDoc[K],
): SettingsDoc[K] => (cache ? cache[key] : fallback);

/** Read a settings snapshot (for /api/admin/settings GET). */
export const getAllSettings = (): SettingsDoc => {
  if (!cache) throw new Error("[settings] cache not loaded");
  return { ...cache };
};

/** Update one or more settings + refresh the cache atomically. */
export const updateSettings = async (
  patch: Partial<Omit<SettingsDoc, "_id" | "updatedAt">>,
  updatedBy?: string,
): Promise<SettingsDoc> => {
  const updated = await SettingsModel.findByIdAndUpdate(
    "default",
    { ...patch, updatedAt: new Date(), updatedBy },
    { new: true, upsert: true },
  );
  cache = updated.toObject ? updated.toObject() as SettingsDoc : (updated as SettingsDoc);
  return cache;
};
