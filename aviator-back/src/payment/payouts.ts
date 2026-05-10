import { PayoutProvider } from "./payoutTypes";
import { MockPayoutProvider } from "./providers/mockPayout";

/**
 * Payout provider registry — mirrors the recharge registry pattern.
 *
 * v1: mock only. To integrate Razorpay Payouts / similar:
 *   1. Create providers/razorpayPayout.ts implementing PayoutProvider
 *   2. Register here when env vars present
 *   3. Set PAYOUT_BANK_PROVIDER env to its name
 */
const registry = new Map<string, PayoutProvider>();

// Always register mock for now — admin marks orders paid/failed manually.
registry.set("mock", new MockPayoutProvider());

export const getPayoutProvider = (name: string): PayoutProvider | null =>
  registry.get(name) || null;

export const listPayoutProviders = (): string[] => Array.from(registry.keys());

/**
 * Pick the right provider for a withdrawal method.
 *   bank → process.env.PAYOUT_BANK_PROVIDER || "mock"
 *   usdt → process.env.PAYOUT_USDT_PROVIDER || "mock"
 */
export const defaultPayoutProvider = (method: "bank" | "usdt"): string => {
  if (method === "bank") return process.env.PAYOUT_BANK_PROVIDER || "mock";
  return process.env.PAYOUT_USDT_PROVIDER || "mock";
};
