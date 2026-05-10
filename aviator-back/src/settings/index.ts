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
  | "referralRewardInr";

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
});

/**
 * Load settings into the cache. Creates the doc on first run with env
 * defaults so the system always has a value. Call once at server boot.
 */
export const loadSettings = async (): Promise<SettingsDoc> => {
  let doc = await SettingsModel.findById("default");
  if (!doc) {
    doc = await SettingsModel.create({
      _id: "default",
      ...defaultsFromEnv(),
    });
    console.log("[settings] seeded default settings from env");
  }
  cache = doc.toObject ? doc.toObject() as SettingsDoc : (doc as SettingsDoc);
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
