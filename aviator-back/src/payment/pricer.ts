import { config } from "../config";
import { getSetting } from "../settings";

/**
 * USDT → INR rate provider.
 *
 * Source: CoinGecko's free public API
 *   https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=inr
 *
 * The rate is cached in-memory for 5 minutes — CoinGecko's free tier has
 * a ~30 calls/min cap, so even a single instance pinging on every order
 * would be fine, but caching reduces dependency on a flaky 3rd-party API.
 *
 * Fallback: if the API is down OR returns garbage, we use the env-var
 * `USDT_INR_RATE` (default 83). The order endpoint clearly surfaces
 * which source produced the rate so admin can audit later.
 */
export interface RateQuote {
  rate: number;
  source: "coingecko" | "env-fallback";
  fetchedAt: Date;
}

const CACHE_TTL_MS = 5 * 60_000;
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=inr";

let cached: RateQuote | null = null;

const fetchFromCoinGecko = async (): Promise<number | null> => {
  try {
    const res = await fetch(COINGECKO_URL, {
      headers: { accept: "application/json" },
      // 3s tight budget — order creation shouldn't block on a slow 3rd party.
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { tether?: { inr?: number } };
    const r = json?.tether?.inr;
    if (typeof r !== "number" || !isFinite(r) || r <= 0) return null;
    return r;
  } catch {
    return null;
  }
};

export const getUsdtInrRate = async (): Promise<RateQuote> => {
  // Cache hit — reuse if fresh
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return cached;
  }

  const live = await fetchFromCoinGecko();
  if (live != null) {
    cached = { rate: +live.toFixed(4), source: "coingecko", fetchedAt: new Date() };
    return cached;
  }

  // Fallback path — note the freshness window is shorter so we retry sooner.
  const fallback: RateQuote = {
    rate: getSetting("usdtInrRateFallback"),
    source: "env-fallback",
    fetchedAt: new Date(),
  };
  cached = fallback;
  return fallback;
};
