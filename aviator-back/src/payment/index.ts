import { PaymentProvider } from "./types";
import { MockProvider } from "./providers/mock";
import { RazorpayProvider } from "./providers/razorpay";
import { PaymeProvider } from "./providers/payme";
import { config } from "../config";
import { tryGetSetting } from "../settings";

/**
 * Provider registry. Production providers are auto-registered when
 * credentials are present:
 *   • Razorpay — env vars (RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET)
 *   • Payme    — admin Settings (paymeEnabled=1 AND apiBase/merchant/secret)
 *
 * Mock is registered only when ALLOW_DEV_AUTH=true (i.e. local/dev only).
 *
 * Payme is registered unconditionally (instance created once), but
 * isPaymeAvailable() gates whether `defaultProvider()` returns it. This
 * lets admin toggle Payme on/off from Settings without restart — the
 * provider's createOrder reads settings on every call, and a non-enabled
 * setting will throw cleanly there.
 */
const registry = new Map<string, PaymentProvider>();

if (config.allowDevAuth) {
  registry.set("mock", new MockProvider());
}
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  registry.set("razorpay", new RazorpayProvider());
}
// Payme is always registered so its webhook endpoint resolves. Whether the
// frontend can ROUTE recharges through it depends on isPaymeAvailable().
registry.set("payme", new PaymeProvider());

export const getProvider = (name: string): PaymentProvider | null =>
  registry.get(name) || null;

export const listProviders = (): string[] => Array.from(registry.keys());

/** Live-checked: admin must have flipped paymeEnabled=1 AND filled creds. */
export const isPaymeAvailable = (): boolean => {
  if (Number(tryGetSetting("paymeEnabled", 0)) !== 1) return false;
  const base = String(tryGetSetting("paymeApiBase", "")).trim();
  const merchant = String(tryGetSetting("paymeMerchantCode", "")).trim();
  const secret = String(tryGetSetting("paymeSecretKey", "")).trim();
  return !!(base && merchant && secret);
};

export const defaultProvider = (): string => {
  // Preference order: Payme (when admin-enabled) → Razorpay → mock (dev only).
  if (isPaymeAvailable()) return "payme";
  if (registry.has("razorpay")) return "razorpay";
  return "mock";
};
