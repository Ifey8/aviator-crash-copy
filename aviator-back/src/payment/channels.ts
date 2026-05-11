import { PaymentChannelModel, PaymentChannelDoc } from "../db/models/PaymentChannel";
import { getProviderType, channelToConfig } from "./catalog";
import { bootstrapCatalog } from "./catalogBootstrap";
import type { PaymentProvider } from "./types";
import type { PayoutProvider } from "./payoutTypes";

bootstrapCatalog();

/**
 * Channel registry — turns DB-stored channel configs into runtime provider
 * instances. The instance cache survives until invalidate() is called
 * (admin save). On miss we hit the DB and build via the catalog.
 *
 * Routing decisions:
 *   • getPayinChannel(country, code?)  — explicit code wins; else default
 *   • getPayoutChannel(country, code?) — same
 *   • Default = highest-priority ENABLED channel matching the country and
 *     supporting that direction.
 */

interface CacheEntry {
  doc: PaymentChannelDoc;
  payment?: PaymentProvider;
  payout?: PayoutProvider;
}
const cache = new Map<string, CacheEntry>();

export const invalidateChannelCache = (code?: string): void => {
  if (code) cache.delete(code);
  else cache.clear();
};

const fromCacheOrLoad = async (code: string): Promise<CacheEntry | null> => {
  const cached = cache.get(code);
  if (cached) return cached;
  const doc = await PaymentChannelModel.findOne({ code }).lean<PaymentChannelDoc>();
  if (!doc) return null;
  const entry: CacheEntry = { doc };
  cache.set(code, entry);
  return entry;
};

const buildPaymentProvider = (entry: CacheEntry): PaymentProvider | null => {
  if (entry.payment) return entry.payment;
  const type = getProviderType(entry.doc.provider);
  if (!type?.createPaymentProvider) return null;
  entry.payment = type.createPaymentProvider(channelToConfig(entry.doc));
  return entry.payment;
};

const buildPayoutProvider = (entry: CacheEntry): PayoutProvider | null => {
  if (entry.payout) return entry.payout;
  const type = getProviderType(entry.doc.provider);
  if (!type?.createPayoutProvider) return null;
  entry.payout = type.createPayoutProvider(channelToConfig(entry.doc));
  return entry.payout;
};

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export interface ChannelLookupResult {
  doc: PaymentChannelDoc;
  payment?: PaymentProvider;
  payout?: PayoutProvider;
}

/**
 * Look up by exact code. Returns null if not found or disabled.
 * Used when a route receives an explicit channelCode (e.g. webhook URL,
 * or when frontend wants a specific channel).
 */
export const getChannelByCode = async (
  code: string,
  opts: { allowDisabled?: boolean } = {},
): Promise<ChannelLookupResult | null> => {
  const entry = await fromCacheOrLoad(code);
  if (!entry) return null;
  if (!opts.allowDisabled && !entry.doc.enabled) return null;
  return {
    doc: entry.doc,
    payment: buildPaymentProvider(entry) || undefined,
    payout: buildPayoutProvider(entry) || undefined,
  };
};

/**
 * Pick the default channel for (country, direction).
 * Highest priority among enabled channels supporting that direction.
 */
export const getDefaultChannel = async (
  country: string,
  direction: "payin" | "payout",
): Promise<ChannelLookupResult | null> => {
  const supportsKey = direction === "payin" ? "supports.payin" : "supports.payout";
  const doc = await PaymentChannelModel.findOne({
    country,
    enabled: true,
    [supportsKey]: true,
  })
    .sort({ priority: -1, createdAt: 1 })
    .lean<PaymentChannelDoc>();
  if (!doc) return null;
  return getChannelByCode(doc.code);
};

export const listChannelsAdmin = async (): Promise<PaymentChannelDoc[]> => {
  return PaymentChannelModel.find().sort({ country: 1, priority: -1, createdAt: 1 }).lean<PaymentChannelDoc[]>();
};

/**
 * Look up just the IP allowlist + cached existence of a channel.
 * Used by webhook routes BEFORE sig verification to gate by IP.
 * Returns null if channel doesn't exist at all.
 */
export const getChannelMeta = async (code: string): Promise<{
  exists: true;
  enabled: boolean;
  callbackIpAllowlist: string;
} | null> => {
  const doc = await PaymentChannelModel.findOne({ code })
    .select("enabled callbackIpAllowlist")
    .lean<{ enabled: boolean; callbackIpAllowlist: string }>();
  if (!doc) return null;
  return {
    exists: true,
    enabled: doc.enabled,
    callbackIpAllowlist: doc.callbackIpAllowlist || "",
  };
};
