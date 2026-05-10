import { Schema, model, Document } from "mongoose";

/**
 * CryptoOrder — top-up via on-chain USDT transfer to a per-order DEPOSIT
 * ADDRESS that the server derives from its HD master seed.
 *
 * Why per-order address:
 *   • User can pay ANY amount of USDT — backend credits actual_value × fxRate
 *   • Zero ambiguity between concurrent orders (each address belongs to
 *     exactly one order).
 *   • Industry-standard pattern (Coinbase Commerce, BitPay, NowPayments).
 *
 * Lifecycle:
 *   pending → paid       (any USDT tx detected to depositAddress)
 *   pending → expired    (no payment within expiresAt)
 *   pending → cancelled  (user cancels)
 *   paid    → swept      (hot-wallet sweeper transferred funds away —
 *                         logical state, indicated by sweptAt timestamp)
 *
 * Idempotency: txHash unique-sparse. The first matching tx claims the order.
 */
export type CryptoOrderStatus = "pending" | "paid" | "expired" | "cancelled";

export interface CryptoOrderDoc extends Document {
  orderId: string;
  userName: string;

  /** Recommended USDT to pay, derived from amountInr at order-create time. */
  amountUsdt: number;
  /** Recommended INR equivalent (UI hint only — actual credit uses received amount). */
  amountInr: number;
  /** Snapshotted USDT→INR rate at order create. Used to compute INR credit when paid. */
  fxRate: number;
  fxRateAt: Date;

  network: string;
  /** Per-order TRON address derived from master seed. User sends here. */
  depositAddress: string;
  /** BIP44 index used to derive depositAddress. Hot wallet uses index 0. */
  derivIndex: number;
  /** TRC20 USDT contract address (mock on shasta, real Tether on mainnet). */
  contractAddress: string;

  status: CryptoOrderStatus;

  /** Filled by the watcher when a tx arrives. */
  txHash?: string;
  fromAddress?: string;
  blockTimestamp?: number;
  /** USDT actually received (smallest unit / 10^6). May differ from amountUsdt. */
  actualUsdt?: number;
  /** INR credited to user (= actualUsdt × fxRate). */
  actualInr?: number;
  /** User balance after credit (audit trail). */
  balanceAfter?: number;

  /** Sweeper has moved funds from depositAddress → hot wallet. */
  sweptAt?: Date;
  sweptTxHash?: string;

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
  // NOT unique: same address may legitimately back many sequential orders
  // (we recycle after `cryptoAddressReuseCooldownMs`). Tx-to-order matching
  // uses (depositAddress, status:'pending', timestamp window) as the key.
  depositAddress: { type: String, required: true, index: true },
  derivIndex: { type: Number, required: true, index: true },
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
  actualUsdt: { type: Number },
  actualInr: { type: Number },
  balanceAfter: { type: Number },

  sweptAt: { type: Date, index: true },
  sweptTxHash: { type: String },

  createdAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, required: true, index: true },
  paidAt: { type: Date },

  meta: { type: Schema.Types.Mixed },
});

export const CryptoOrderModel = model<CryptoOrderDoc>(
  "CryptoOrder",
  CryptoOrderSchema,
);
