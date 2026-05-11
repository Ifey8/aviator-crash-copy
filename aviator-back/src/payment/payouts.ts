import { PayoutProvider } from "./payoutTypes";
import { MockPayoutProvider } from "./providers/mockPayout";

/**
 * Legacy payout provider registry.
 *
 * Channels (./channels.ts) own real production routing. This registry
 * provides the fallback "mock" only.
 *
 * defaultPayoutProvider is the LAST resort — routes/withdrawal.ts asks
 * channels first.
 */
const registry = new Map<string, PayoutProvider>();
registry.set("mock", new MockPayoutProvider());

export const getPayoutProvider = (name: string): PayoutProvider | null =>
  registry.get(name) || null;

export const listPayoutProviders = (): string[] => Array.from(registry.keys());

export const defaultPayoutProvider = (method: "bank" | "usdt"): string => {
  if (method === "bank") return process.env.PAYOUT_BANK_PROVIDER || "mock";
  return process.env.PAYOUT_USDT_PROVIDER || "mock";
};
