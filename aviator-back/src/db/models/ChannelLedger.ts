import { Schema, model } from "mongoose";

/**
 * ChannelLedger — append-only double-entry ledger per payment channel.
 *
 * Every successful payin / payout writes a ledger row capturing the
 * operator's NET balance impact at that gateway. Admin can also write
 * manual rows for:
 *   • manual_withdraw — operator withdrew from Payme to their own bank
 *   • manual_credit   — top-up / adjustment / refund booked back
 *
 * Channel balance = SUM(credit.amountInr) − SUM(debit.amountInr).
 *
 * Categories (used for filtering + report):
 *   payin          — user paid into Payme; net (after gateway fee) goes
 *                    to operator. credit, amount = gross × (1 − payinFeePct)
 *   payin_fee      — separately recorded fee so admin sees true cost.
 *                    debit, amount = gross × payinFeePct
 *                    Pairs with a "payin" row (same orderId); together
 *                    SUM-net == gross × (1 − payinFeePct).
 *                    NOTE: alternatively we just write the net "payin"
 *                    row and store the fee in meta for display.
 *   payout         — gateway sent INR to user. debit, amount = gross.
 *   payout_fee     — gateway's cut on the payout. debit, amount =
 *                    gross × payoutFeePct + payoutFeeFlat.
 *   manual_credit  — admin top-up. credit.
 *   manual_withdraw — admin withdrew operator funds out of gateway. debit.
 *
 * We adopt the "write fee + principal separately" pattern so reports
 * can show "gateway charged us X in fees this month" cleanly.
 */

export type LedgerCategory =
  | "payin"
  | "payin_fee"
  | "payout"
  | "payout_fee"
  | "manual_credit"
  | "manual_withdraw";

export interface ChannelLedgerDoc {
  channelCode: string;
  direction: "credit" | "debit";
  amountInr: number;
  category: LedgerCategory;
  /** Order ID this row relates to, when applicable. */
  relatedOrderId?: string;
  /** Free-form note (admin-supplied for manual entries; auto-set for payin/payout). */
  note?: string;
  /** Admin username for manual entries; undefined for auto. */
  createdBy?: string;
  /** Provider's plat_order_no for cross-reference. */
  providerRef?: string;
  /** Frozen snapshot of the rate config at the time of the entry. */
  meta?: Record<string, unknown>;
  createdAt: Date;
}

const ChannelLedgerSchema = new Schema<ChannelLedgerDoc>(
  {
    channelCode: { type: String, required: true, index: true },
    direction: { type: String, required: true, enum: ["credit", "debit"], index: true },
    amountInr: { type: Number, required: true, min: 0 },
    category: {
      type: String,
      required: true,
      enum: ["payin", "payin_fee", "payout", "payout_fee", "manual_credit", "manual_withdraw"],
      index: true,
    },
    relatedOrderId: { type: String, index: true, sparse: true },
    note: { type: String },
    createdBy: { type: String },
    providerRef: { type: String, index: true, sparse: true },
    meta: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { collection: "channelledger" },
);

// Compound index for the typical drill-down query (channel + time desc)
ChannelLedgerSchema.index({ channelCode: 1, createdAt: -1 });

export const ChannelLedgerModel = model<ChannelLedgerDoc>(
  "ChannelLedger",
  ChannelLedgerSchema,
);

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

export interface ChannelBalance {
  channelCode: string;
  /** SUM(credits) - SUM(debits). Positive = gateway owes operator. */
  balanceInr: number;
  totalIn: number;        // sum of credits
  totalOut: number;       // sum of debits
  byCategory: Record<LedgerCategory, number>;
  entryCount: number;
}

export const computeChannelBalance = async (channelCode: string): Promise<ChannelBalance> => {
  const rows = await ChannelLedgerModel.aggregate<{
    _id: { category: LedgerCategory; direction: "credit" | "debit" };
    total: number;
    count: number;
  }>([
    { $match: { channelCode } },
    {
      $group: {
        _id: { category: "$category", direction: "$direction" },
        total: { $sum: "$amountInr" },
        count: { $sum: 1 },
      },
    },
  ]);
  let totalIn = 0;
  let totalOut = 0;
  let entryCount = 0;
  const byCategory: Record<string, number> = {};
  for (const r of rows) {
    if (r._id.direction === "credit") totalIn += r.total;
    else totalOut += r.total;
    byCategory[r._id.category] = (byCategory[r._id.category] || 0) + (r._id.direction === "credit" ? r.total : -r.total);
    entryCount += r.count;
  }
  return {
    channelCode,
    balanceInr: +(totalIn - totalOut).toFixed(2),
    totalIn: +totalIn.toFixed(2),
    totalOut: +totalOut.toFixed(2),
    byCategory: byCategory as Record<LedgerCategory, number>,
    entryCount,
  };
};
