/**
 * PayoutProvider — bank/USDT withdrawal abstraction.
 *
 * Same shape as the recharge PaymentProvider but for outbound money.
 * v1 ships with a mock provider; real providers (e.g. Razorpay Payouts,
 * Cashfree Payouts) plug in by implementing this interface.
 */
import type { WithdrawalOrderDoc } from "../db/models/WithdrawalOrder";

export interface PayoutCreateInput {
  orderId: string;
  userName: string;
  /** What the recipient receives (INR for bank, USDT for usdt). */
  grossAmount: number;
  method: "bank" | "usdt";
  // Bank
  bankAccount?: string;
  ifsc?: string;
  holderName?: string;
  // USDT
  trc20Address?: string;
  // EVM USDT (Polygon/BSC/Ethereum)
  network?: string;
  payoutAddress?: string;
}

export interface PayoutCreateResult {
  /** Provider's id for this payout (used to match webhook callbacks). */
  providerRef: string;
  /** Initial status to record. */
  status: "pending" | "processing" | "manual_queue" | "paid" | "failed";
  /** Optional info to surface to user (e.g. estimated arrival). */
  message?: string;
}

export interface PayoutWebhookResult {
  ok: boolean;
  /** providerRef of the order this webhook is for. */
  providerRef: string;
  status?: "paid" | "failed";
  failedReason?: string;
  raw?: unknown;
}

export interface PayoutQueryInput {
  orderId: string;
  providerRef?: string;
}
export interface PayoutQueryResult {
  status: "paid" | "failed" | "pending" | "unknown";
  providerRef?: string;
  failedReason?: string;
  raw?: unknown;
}

export interface PayoutProvider {
  readonly name: string;
  /** Create an outbound payout. May or may not complete synchronously. */
  createPayout(input: PayoutCreateInput): Promise<PayoutCreateResult>;
  /** Verify & parse a webhook callback. Some providers don't have one — return ok:false. */
  verifyWebhook(headers: Record<string, unknown>, rawBody: string): PayoutWebhookResult;
  /** Backstop poll: ask the gateway what state the payout order is in. */
  queryPayoutStatus?(input: PayoutQueryInput): Promise<PayoutQueryResult>;
}

/** Helper used by admin force-paid: refund-on-fail logic lives in routes. */
export type PayoutOrderRef = Pick<WithdrawalOrderDoc, "orderId" | "userName" | "method" | "totalDebitInr" | "grossAmount">;
