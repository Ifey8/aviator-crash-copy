import { PayoutProvider } from "./payoutTypes";
import { MockPayoutProvider } from "./providers/mockPayout";
import { PaymePayoutProvider } from "./providers/paymePayout";
import { isPaymeAvailable } from "./index";

/**
 * Payout provider registry — mirrors the recharge registry pattern.
 *
 * Always-registered:
 *   • "mock"  — admin marks orders paid/failed manually
 *   • "payme" — bank/UPI payout via Payme /api/payout (gated by admin Settings)
 */
const registry = new Map<string, PayoutProvider>();

registry.set("mock", new MockPayoutProvider());
registry.set("payme", new PaymePayoutProvider());

export const getPayoutProvider = (name: string): PayoutProvider | null =>
  registry.get(name) || null;

export const listPayoutProviders = (): string[] => Array.from(registry.keys());

/**
 * Pick the right provider for a withdrawal method.
 *   bank → Payme (if enabled) → env override → "mock"
 *   usdt → on-chain path handles it (this fn still returns "mock" as
 *          fallback for the legacy adapter call, but routes/withdrawal.ts
 *          routes USDT directly to walletOps regardless).
 */
export const defaultPayoutProvider = (method: "bank" | "usdt"): string => {
  if (method === "bank") {
    if (isPaymeAvailable()) return "payme";
    return process.env.PAYOUT_BANK_PROVIDER || "mock";
  }
  return process.env.PAYOUT_USDT_PROVIDER || "mock";
};
