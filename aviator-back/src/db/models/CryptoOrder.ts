import { Schema, model, Document } from "mongoose";

/**
 * CryptoOrder — top-up via on-chain USDT transfer.
 *
 * Lifecycle (parallel to RechargeOrder for fiat):
 *   pending → paid       (matching tx confirmed on-chain + balance credited)
 *   pending → expired    (no matching tx within expiresAt)
 *   pending → cancelled  (user cancels)
 *
 * Idempotency: txHash is unique across the collection. The watcher
 * atomically claims a tx by setting status:pending → paid + txHash:<hash>;
 * any second match for the same hash fails the unique constraint and is
 * silently dropped.
 */
export type CryptoOrderStatus = "pending" | "paid" | "expired" | "cancelled";

export interface CryptoOrderDoc extends Document {
  orderId: string;
  userName: string;

  /** Amount the user must transfer, in major USDT units (e.g. 10.50). */
  amountUsdt: number;
  /** Locked INR equivalent at order-creation time (amountUsdt × fxRate). */
  amountInr: number;
  /** Snapshotted USDT→INR rate (CoinGecko or env fallback). */
  fxRate: number;
  fxRateAt: Date;

  /** "shasta" | "mainnet" — picked from config at create-time. */
  network: string;
  /** Receiver wallet (your TronLink address). */
  receiver: string;
  /** TRC20 contract address (mock USDT on shasta, real Tether on mainnet). */
  contractAddress: string;

  status: CryptoOrderStatus;

  /** Filled in when the watcher matches a tx. */
  txHash?: string;
  fromAddress?: string;
  blockTimestamp?: number;
  /** Internal user balance after credit, for audit. */
  balanceAfter?: number;

  createdAt: Date;
  expiresAt: Date;
  paidAt?: Date;

  meta?: Record<string, unknown>;
}

const CryptoOrderSchema = new Schema<CryptoOrderDoc>({
  orderId: { type: String, required: true, unique: true, index: true },
  userName: { type: String, required: true, index: true },

  amountUsdt: { type: Number, required: true, min: 0 },
  amountInr: { type: Number, required: true, min: 0 },
  fxRate: { type: Number, required: true, min: 0 },
  fxRateAt: { type: Date, required: true },

  network: { type: String, required: true, index: true },
  receiver: { type: String, required: true, index: true },
  contractAddress: { type: String, required: true },

  status: {
    type: String,
    enum: ["pending", "paid", "expired", "cancelled"],
    default: "pending",
    index: true,
  },

  txHash: { type: String, unique: true, sparse: true, index: true },
  fromAddress: { type: String },
  blockTimestamp: { type: Number },
  balanceAfter: { type: Number },

  createdAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, required: true, index: true },
  paidAt: { type: Date },

  meta: { type: Schema.Types.Mixed },
});

export const CryptoOrderModel = model<CryptoOrderDoc>(
  "CryptoOrder",
  CryptoOrderSchema,
);
