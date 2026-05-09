import { Schema, model, Document } from "mongoose";

/**
 * RechargeOrder — a user's request to top up balance via a payment provider.
 *
 * Lifecycle:
 *   pending → paid       (provider webhook OK + balance credited)
 *   pending → cancelled  (user cancels before paying)
 *   pending → expired    (no payment within expiresAt window)
 *   pending → failed     (provider reports failure)
 *
 * `paid` is terminal and idempotent — webhook retries cannot double-credit.
 */
export type RechargeStatus =
  | "pending"
  | "paid"
  | "cancelled"
  | "expired"
  | "failed";

export interface RechargeOrderDoc extends Document {
  orderId: string;          // internal UUID — primary identifier surfaced to client
  userName: string;         // who is topping up
  amount: number;           // INR (positive)
  currency: string;         // "INR"
  provider: string;         // "mock" | "razorpay" | etc
  providerRef: string;      // ID at provider (their order_id)
  status: RechargeStatus;
  paymentUrl: string;       // where the user pays
  qrCode?: string;          // optional UPI QR data (provider-specific)
  createdAt: Date;
  expiresAt: Date;          // typically created + 15min
  paidAt?: Date;
  failedReason?: string;
  // Snapshot of user balance at credit-time, for easier audit later.
  balanceAfter?: number;
  // Free-form provider response (raw webhook payload, signature, etc).
  meta?: Record<string, unknown>;
}

const RechargeOrderSchema = new Schema<RechargeOrderDoc>({
  orderId: { type: String, required: true, unique: true, index: true },
  userName: { type: String, required: true, index: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: "INR" },
  provider: { type: String, required: true, index: true },
  providerRef: { type: String, default: "", index: true },
  status: {
    type: String,
    enum: ["pending", "paid", "cancelled", "expired", "failed"],
    default: "pending",
    index: true,
  },
  paymentUrl: { type: String, default: "" },
  qrCode: { type: String },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: true },
  paidAt: { type: Date },
  failedReason: { type: String },
  balanceAfter: { type: Number },
  meta: { type: Schema.Types.Mixed },
});

export const RechargeOrderModel = model<RechargeOrderDoc>(
  "RechargeOrder",
  RechargeOrderSchema,
);
