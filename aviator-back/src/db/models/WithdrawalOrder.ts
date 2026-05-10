import { Schema, model } from "mongoose";

/**
 * WithdrawalOrder — user-initiated payout. Two methods:
 *
 *   • bank  → Indian bank transfer (account + IFSC + holder name).
 *             Routes through a payout provider (mock for v1, real adapter
 *             plugs in same way as recharge providers).
 *
 *   • usdt  → TRC20 USDT to user-supplied address.
 *             Paid out from server's hot wallet (master mnemonic, index 0).
 *             If hot wallet balance insufficient, status flips to
 *             "manual_queue" and admin must top up the hot wallet first.
 *
 * Money flow:
 *   1. /withdrawal/create     → balance reserved (balance -= gross+fee)
 *   2. status = pending → processing (provider accepted) → paid OR failed
 *   3. failed/cancelled       → balance refunded (balance += gross+fee)
 *
 * Withdrawable amount is enforced server-side at creation:
 *   withdrawable = balance − wagerRequired
 *   wagerRequired only contains UN-PLAYED-THROUGH RECHARGE money.
 *
 * Fees are ON TOP (user enters ₹1000 → bank receives ₹1000, balance −₹1050).
 */
export type WithdrawalMethod = "bank" | "usdt";
export type WithdrawalStatus =
  | "pending"        // created, balance reserved, awaiting provider attempt
  | "processing"    // provider accepted, awaiting confirmation
  | "manual_queue" // USDT only: hot wallet insufficient, admin must top up
  | "review"        // anti-abuse hold (large amount or young account); admin must Approve before provider call
  | "paid"          // confirmed sent
  | "failed"        // provider rejected → refunded
  | "cancelled";   // user or admin cancelled → refunded

export interface WithdrawalOrderDoc {
  orderId: string;
  userName: string;
  method: WithdrawalMethod;
  /** Amount the recipient receives (INR for bank, USDT for usdt). */
  grossAmount: number;
  /** Fee in INR (always INR — for usdt this is INR-equivalent at lock-in rate). */
  feeAmount: number;
  /** Total INR debited from balance (gross+fee for bank; (gross*fxRate)+fee for usdt). */
  totalDebitInr: number;

  // Bank method only:
  bankAccount?: string;
  ifsc?: string;
  holderName?: string;

  // USDT method only:
  trc20Address?: string;
  /** USDT/INR rate locked at creation; used to compute totalDebitInr. */
  fxRate?: number;
  /** TX hash once broadcast (USDT only). */
  txHash?: string;

  status: WithdrawalStatus;
  /** Reference returned by payout provider (mock: orderId; real: provider id). */
  providerRef?: string;
  provider?: string; // "mock" | "tron" | "razorpay-payout" | …

  failedReason?: string;
  /** INR balance AFTER reservation (for the user's records). */
  balanceAfter?: number;

  meta?: Record<string, unknown>;

  createdAt: Date;
  paidAt?: Date;
  failedAt?: Date;
  cancelledAt?: Date;
}

const WithdrawalOrderSchema = new Schema<WithdrawalOrderDoc>({
  orderId: { type: String, required: true, unique: true, index: true },
  userName: { type: String, required: true, index: true },
  method: { type: String, required: true, enum: ["bank", "usdt"] },
  grossAmount: { type: Number, required: true, min: 0 },
  feeAmount: { type: Number, required: true, min: 0 },
  totalDebitInr: { type: Number, required: true, min: 0 },

  bankAccount: { type: String },
  ifsc: { type: String },
  holderName: { type: String },

  trc20Address: { type: String, index: true, sparse: true },
  fxRate: { type: Number },
  txHash: { type: String, index: true, sparse: true },

  status: {
    type: String,
    required: true,
    enum: ["pending", "processing", "manual_queue", "review", "paid", "failed", "cancelled"],
    default: "pending",
    index: true,
  },
  providerRef: { type: String, index: true, sparse: true },
  provider: { type: String },

  failedReason: { type: String },
  balanceAfter: { type: Number },

  meta: { type: Schema.Types.Mixed },

  createdAt: { type: Date, default: Date.now, index: true },
  paidAt: { type: Date },
  failedAt: { type: Date },
  cancelledAt: { type: Date },
});

export const WithdrawalOrderModel = model<WithdrawalOrderDoc>(
  "WithdrawalOrder",
  WithdrawalOrderSchema,
);
