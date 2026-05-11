import { ChannelLedgerModel } from "../db/models/ChannelLedger";
import { PaymentChannelModel } from "../db/models/PaymentChannel";

/**
 * Ledger write helpers. Centralised so the recharge + withdrawal routes
 * don't each duplicate the fee math, and so it's easy to add new
 * channels later (e.g. if Razorpay's fee shape differs).
 *
 * recordPayin / recordPayout each write TWO rows:
 *   • principal — the gross amount (credit for payin, debit for payout)
 *   • fee       — the gateway's cut (debit). Stored separately so
 *                  reports can sum fees independently of principal.
 *
 * All amounts in INR. Idempotency: callers should only call these from
 * the same atomic state-flip that markPaidAndCredit / withdrawal-paid
 * does — the order's "pending → paid" flip guards against double-write.
 */

interface ChannelFeeConfig {
  payinFeePct: number;
  payoutFeePct: number;
  payoutFeeFlat: number;
}

const readFees = async (channelCode: string): Promise<ChannelFeeConfig> => {
  const ch = await PaymentChannelModel.findOne({ code: channelCode })
    .select("params")
    .lean<{ params: Record<string, string> }>();
  const p = ch?.params || {};
  return {
    payinFeePct: Number(p.payinFeePct ?? 0) || 0,
    payoutFeePct: Number(p.payoutFeePct ?? 0) || 0,
    payoutFeeFlat: Number(p.payoutFeeFlat ?? 0) || 0,
  };
};

export const recordPayin = async (args: {
  channelCode: string;
  orderId: string;
  providerRef?: string;
  grossInr: number;
}): Promise<void> => {
  const fees = await readFees(args.channelCode);
  const feeAmount = +(args.grossInr * fees.payinFeePct).toFixed(2);
  const netAmount = +(args.grossInr - feeAmount).toFixed(2);

  await ChannelLedgerModel.insertMany([
    {
      channelCode: args.channelCode,
      direction: "credit",
      amountInr: netAmount,
      category: "payin",
      relatedOrderId: args.orderId,
      providerRef: args.providerRef,
      meta: { gross: args.grossInr, feePct: fees.payinFeePct, feeAmount },
      note: `payin order ${args.orderId.slice(0, 8)}…`,
    },
    {
      channelCode: args.channelCode,
      direction: "debit",
      amountInr: feeAmount,
      category: "payin_fee",
      relatedOrderId: args.orderId,
      providerRef: args.providerRef,
      meta: { gross: args.grossInr, feePct: fees.payinFeePct },
      note: `${(fees.payinFeePct * 100).toFixed(2)}% fee on payin ${args.orderId.slice(0, 8)}…`,
    },
  ]);
};

export const recordPayout = async (args: {
  channelCode: string;
  orderId: string;
  providerRef?: string;
  grossInr: number;
}): Promise<void> => {
  const fees = await readFees(args.channelCode);
  const feeAmount = +(args.grossInr * fees.payoutFeePct + fees.payoutFeeFlat).toFixed(2);

  await ChannelLedgerModel.insertMany([
    {
      channelCode: args.channelCode,
      direction: "debit",
      amountInr: args.grossInr,
      category: "payout",
      relatedOrderId: args.orderId,
      providerRef: args.providerRef,
      meta: { gross: args.grossInr },
      note: `payout order ${args.orderId.slice(0, 8)}…`,
    },
    {
      channelCode: args.channelCode,
      direction: "debit",
      amountInr: feeAmount,
      category: "payout_fee",
      relatedOrderId: args.orderId,
      providerRef: args.providerRef,
      meta: { gross: args.grossInr, feePct: fees.payoutFeePct, flat: fees.payoutFeeFlat },
      note: `Payme fee ${(fees.payoutFeePct * 100).toFixed(2)}% + ₹${fees.payoutFeeFlat} on payout ${args.orderId.slice(0, 8)}…`,
    },
  ]);
};

export const recordManualAdjustment = async (args: {
  channelCode: string;
  direction: "credit" | "debit";
  amountInr: number;
  note: string;
  createdBy: string;
}): Promise<void> => {
  await ChannelLedgerModel.create({
    channelCode: args.channelCode,
    direction: args.direction,
    amountInr: args.amountInr,
    category: args.direction === "credit" ? "manual_credit" : "manual_withdraw",
    note: args.note,
    createdBy: args.createdBy,
  });
};
