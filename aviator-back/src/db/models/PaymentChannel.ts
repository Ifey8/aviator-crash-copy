import { Schema, model } from "mongoose";

/**
 * PaymentChannel — one configured instance of an upstream payment gateway.
 *
 * A "channel" pairs a provider type (e.g. "payme", "razorpay", "cashfree")
 * with the credentials + params needed to talk to ONE specific merchant
 * account on that gateway. Multiple channels can coexist (e.g. Payme-India
 * for a primary merchant + Razorpay-India for fallback), and each can be
 * independently enabled / disabled without redeploy.
 *
 * Generic shape so new providers slot in without schema changes:
 *   • credentials   — Map of provider-specific secret fields (apiBase,
 *                     merchantCode, secretKey, etc). The provider's
 *                     catalog definition tells the admin UI which keys
 *                     to render + which are sensitive.
 *   • params        — Map of non-secret tuning fields (payinPayType,
 *                     payoutBankCode, etc).
 *
 * Routing:
 *   • A recharge or withdrawal can pass `channelCode` to select a specific
 *     channel; otherwise the default for the country + method is used
 *     (highest priority among enabled channels supporting that direction).
 *   • Webhook URL convention: /api/{recharge|withdrawal}/webhook/<channelCode>
 *     — channelCode in the URL identifies WHICH channel signed the payload,
 *     so we look up the right credentials to verify.
 */
export type PaymentDirection = "payin" | "payout";

export interface PaymentChannelDoc {
  /** Unique stable identifier used in webhook URLs + routing. e.g. "payme-in-1". */
  code: string;
  /** Human-readable label shown in admin. e.g. "Payme India (primary)". */
  name: string;
  /** Provider implementation key — must match a registered entry in catalog.ts. */
  provider: string;
  /** ISO country code, e.g. "IN", "ID". Used for default channel selection. */
  country: string;
  /** Master switch — channel skipped entirely when off. */
  enabled: boolean;
  /** Which directions this channel handles. Most providers support both, but some are payout-only. */
  supports: { payin: boolean; payout: boolean };
  /** Provider-specific secrets (apiBase, merchantCode, secretKey, ...). */
  credentials: Record<string, string>;
  /** Provider-specific non-secret tuning (payinPayType, payoutBankCode, ...). */
  params: Record<string, string>;
  /** Higher = preferred when multiple channels match. Default 100. */
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentChannelSchema = new Schema<PaymentChannelDoc>(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    provider: { type: String, required: true, index: true },
    country: { type: String, required: true, index: true },
    enabled: { type: Boolean, default: false, index: true },
    supports: {
      payin: { type: Boolean, default: true },
      payout: { type: Boolean, default: true },
    },
    // Map types so we don't need to extend the schema each time a new
    // provider adds another credential field.
    credentials: { type: Map, of: String, default: {} },
    params: { type: Map, of: String, default: {} },
    priority: { type: Number, default: 100 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "paymentchannels" },
);

PaymentChannelSchema.index({ country: 1, enabled: 1, priority: -1 });

export const PaymentChannelModel = model<PaymentChannelDoc>(
  "PaymentChannel",
  PaymentChannelSchema,
);
