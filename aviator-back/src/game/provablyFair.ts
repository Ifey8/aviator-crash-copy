import { createHash, createHmac, randomBytes } from "crypto";
import { tryGetSetting } from "../settings";
import { config } from "../config";

/**
 * Provably-fair crash point generator. Standard Bustabit-style algorithm:
 * HMAC-SHA256(serverSeed, clientSeed:nonce), take first 13 hex chars,
 * convert to uint52, then map to a multiplier with configurable house edge.
 *
 * Crash point is clamped at config.maxCrashMultiplier (default 100x). The
 * long tail of the Bustabit distribution puts ~1% of rounds above 100x
 * which adds huge variance to operator P&L without much player upside —
 * essentially nobody waits past 100x anyway.
 */

export interface RoundSeed {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  crashPoint: number;
}

export const newServerSeed = (): { serverSeed: string; serverSeedHash: string } => {
  const serverSeed = randomBytes(32).toString("hex");
  const serverSeedHash = createHash("sha256").update(serverSeed).digest("hex");
  return { serverSeed, serverSeedHash };
};

export const computeCrashPoint = (
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  houseEdge: number,
): number => {
  const hmac = createHmac("sha256", serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest("hex");

  const hex = hmac.slice(0, 13);
  const intVal = parseInt(hex, 16);

  const divisor = Math.pow(2, 52);
  const e = divisor;

  // House edge buckets: small percentage of rounds crash at exactly 1.00x
  if (intVal % Math.floor(1 / houseEdge) === 0) return 1.0;

  const result = Math.floor((100 * e - intVal) / (e - intVal)) / 100;
  // tryGetSetting falls back to config.maxCrashMultiplier (env, default 100x)
  // when the settings cache hasn't been loaded yet — this happens during the
  // GameEngine constructor's placeholder seed build at module import time.
  // After loadSettings(), live admin-tunable value is used.
  const cap = tryGetSetting("maxCrashMultiplier", config.maxCrashMultiplier);
  return Math.max(1.0, Math.min(result, cap));
};

export const buildRoundSeed = (
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  houseEdge: number,
): RoundSeed => ({
  serverSeed,
  serverSeedHash: createHash("sha256").update(serverSeed).digest("hex"),
  clientSeed,
  nonce,
  crashPoint: computeCrashPoint(serverSeed, clientSeed, nonce, houseEdge),
});

/** Same multiplier formula as the frontend uses for visual ticking. */
export const multiplierAt = (elapsedSec: number): number => {
  const t = elapsedSec;
  const m = 1 + 0.06 * t + Math.pow(0.06 * t, 2) - Math.pow(0.04 * t, 3) + Math.pow(0.04 * t, 4);
  return Math.max(1.0, m);
};

/** Inverse of multiplierAt — solve for time given a target multiplier. */
export const timeForMultiplier = (target: number): number => {
  if (target <= 1) return 0;
  let lo = 0;
  let hi = 60;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (multiplierAt(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};
