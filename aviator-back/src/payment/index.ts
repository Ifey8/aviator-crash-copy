import { PaymentProvider } from "./types";
import { MockProvider } from "./providers/mock";
import { RazorpayProvider } from "./providers/razorpay";
import { config } from "../config";

/**
 * Provider registry. To register Razorpay (or another real provider) in
 * production, set its credentials via env vars; the corresponding provider
 * is auto-registered if present.
 *
 * Mock is registered only when ALLOW_DEV_AUTH=true (i.e. local/dev only).
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

export const defaultProvider = (): string =>
  // Prefer real provider if configured; otherwise mock for dev.
  (registry.has("razorpay") ? "razorpay" : "mock");
