import { Schema, model } from "mongoose";

/**
 * ReferralReward — audit row for every INR credited to a referrer.
 *
 * Idempotency: unique compound index on (referrer + sourceType + sourceId)
 * prevents double-credit if the recharge webhook retries or the tron
 * watcher claims the same tx twice.
 *
 *   sourceType  recharge | crypto
 *   sourceId    rechargeOrder.providerRef OR cryptoOrder.txHash
 */
export interface ReferralRewardDoc {
  referrer: string;       // userName who received the reward
  referee: string;        // userName whose action triggered it
  sourceType: "recharge" | "crypto" | "payout";
  sourceId: string;       // unique key per source event
  amountInr: number;      // cents-precise INR credited
  refereeAmountInr: number; // size of the referee's recharge (for context)
  createdAt: Date;
}

const ReferralRewardSchema = new Schema<ReferralRewardDoc>(
  {
    referrer: { type: String, required: true, index: true },
    referee: { type: String, required: true, index: true },
    sourceType: { type: String, required: true, enum: ["recharge", "crypto", "payout"] },
    sourceId: { type: String, required: true },
    amountInr: { type: Number, required: true, min: 0 },
    refereeAmountInr: { type: Number, required: true, min: 0 },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { collection: "referralrewards" },
);

ReferralRewardSchema.index(
  { referrer: 1, sourceType: 1, sourceId: 1 },
  { unique: true },
);

export const ReferralRewardModel = model<ReferralRewardDoc>(
  "ReferralReward",
  ReferralRewardSchema,
);
