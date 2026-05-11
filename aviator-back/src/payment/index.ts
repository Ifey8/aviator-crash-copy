import { PaymentProvider } from "./types";
import { MockProvider } from "./providers/mock";
import { RazorpayProvider } from "./providers/razorpay";
import { config } from "../config";

/**
 * Legacy provider registry.
 *
 * Channels (see ./channels.ts) are the modern way to integrate gateways —
 * each channel is a DB-stored config + credentials pair, admin-tunable
 * at runtime. This registry remains for:
 *   • Mock (dev only, ALLOW_DEV_AUTH=true) — used by tests / sandbox
 *   • Razorpay — env-var driven (legacy integration path)
 *
 * Payme moved out of here — it's now a provider TYPE registered in the
 * catalog (catalog.ts → bootstrapCatalog), and admin creates one or more
 * channels of that type via the Channels admin tab.
 *
 * defaultProvider() is now only used when no channel is configured. The
 * routes ask channels.ts first and only fall back here.
 */
const registry = new Map<string, PaymentProvider>();

if (config.allowDevAuth) {
  registry.set("mock", new MockProvider());
}
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  registry.set("razorpay", new RazorpayProvider());
}

export const getProvider = (name: string): PaymentProvider | null =>
  registry.get(name) || null;

export const listProviders = (): string[] => Array.from(registry.keys());

export const defaultProvider = (): string => {
  if (registry.has("razorpay")) return "razorpay";
  return "mock";
};
