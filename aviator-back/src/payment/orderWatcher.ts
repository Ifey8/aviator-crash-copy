import { RechargeOrderModel } from "../db/models/RechargeOrder";
import { WithdrawalOrderModel } from "../db/models/WithdrawalOrder";
import { getChannelByCode } from "./channels";
import { pushToUser, pushUserMyInfo } from "../sockets";
import { engine } from "../game/engine";
import { triggerReferralReward } from "./referral";

/**
 * orderWatcher — backstop poll of pending payin / payout orders.
 *
 * Webhooks are the primary signal; this is the safety net for the case
 * where:
 *   • Provider's webhook never arrives (network, our nginx hiccup, etc)
 *   • Webhook arrives but is rejected (bad sig, IP gate) and admin
 *     fixed config after the fact
 *
 * Strategy:
 *   • Every 20s, scan pending recharge + processing/pending withdrawal
 *     orders not yet polled this tick window.
 *   • Apply TIERED polling: more frequent in the first 2 min, less
 *     frequent later. Calculated via shouldPoll(order.createdAt,
 *     order.lastPolledAt).
 *   • For each due order:
 *       1. Look up its channel (via meta.channelCode)
 *       2. Call queryOrderStatus / queryPayoutStatus
 *       3. If "paid" → run the same markPaid logic as the webhook
 *          (idempotent guards prevent double-credit)
 *       4. If "failed" → mark failed + refund for withdrawal
 *       5. If "pending" / "unknown" → just update lastPolledAt + retry
 *
 * Order is left untouched if its channel doesn't expose the query
 * method (e.g. mock / razorpay) — orderWatcher then can't help and
 * webhook remains the only signal.
 */

const POLL_INTERVAL_MS = 20_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

const TIERS = [
  { untilAgeMs: 2 * 60_000,        intervalMs: 20_000 },     // 0-2 min: every 20s
  { untilAgeMs: 10 * 60_000,       intervalMs: 60_000 },     // 2-10 min: every 60s
  { untilAgeMs: 30 * 60_000,       intervalMs: 3 * 60_000 }, // 10-30 min: every 3 min
  { untilAgeMs: 60 * 60_000,       intervalMs: 10 * 60_000 },// 30-60 min: every 10 min
  { untilAgeMs: Infinity,          intervalMs: 30 * 60_000 },// >60 min: every 30 min
];

const shouldPoll = (createdAt: Date, lastPolledAt?: Date | null): boolean => {
  const ageMs = Date.now() - createdAt.getTime();
  const tier = TIERS.find((t) => ageMs < t.untilAgeMs) || TIERS[TIERS.length - 1];
  if (!lastPolledAt) return true;
  return Date.now() - lastPolledAt.getTime() >= tier.intervalMs;
};

/** Poll one pending payin order. Returns brief outcome for logging. */
const pollPayin = async (order: any): Promise<string> => {
  const channelCode = order.meta?.channelCode;
  if (!channelCode) return "no-channel";
  const ch = await getChannelByCode(channelCode, { allowDisabled: true });
  if (!ch?.payment?.queryOrderStatus) return "no-query-method";

  let result;
  try {
    result = await ch.payment.queryOrderStatus({
      orderId: order.orderId,
      providerRef: order.providerRef,
    });
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
  // Always bump lastPolledAt so we don't hammer
  await RechargeOrderModel.updateOne({ orderId: order.orderId }, { $set: { lastPolledAt: new Date() } });

  if (result.status === "paid") {
    // Use the same markPaidAndCredit path the webhook uses (idempotent).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { markPaidAndCredit } = require("../routes/recharge");
    const r = await markPaidAndCredit(order.providerRef || result.providerRef, result.raw);
    return r.ok ? `paid (${r.order?.orderId})` : `paid-but-error: ${r.reason}`;
  }
  if (result.status === "failed") {
    const flipped = await RechargeOrderModel.findOneAndUpdate(
      { orderId: order.orderId, status: "pending" },
      { $set: { status: "failed", failedReason: result.failedReason || "Backstop poll: failed" } },
      { new: true },
    );
    if (flipped) {
      pushToUser(flipped.userName, "rechargeUpdate", { orderId: flipped.orderId, status: "failed" });
    }
    return `failed (${order.orderId})`;
  }
  return result.status; // "pending" / "unknown"
};

/** Poll one in-flight payout (bank only — usdt has the on-chain watcher). */
const pollPayout = async (order: any): Promise<string> => {
  if (order.method !== "bank") return "skip-usdt";
  const channelCode = order.meta?.channelCode;
  if (!channelCode) return "no-channel";
  const ch = await getChannelByCode(channelCode, { allowDisabled: true });
  if (!ch?.payout?.queryPayoutStatus) return "no-query-method";

  let result;
  try {
    result = await ch.payout.queryPayoutStatus({
      orderId: order.orderId,
      providerRef: order.providerRef,
    });
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
  await WithdrawalOrderModel.updateOne({ orderId: order.orderId }, { $set: { lastPolledAt: new Date() } });

  if (result.status === "paid") {
    const flipped = await WithdrawalOrderModel.findOneAndUpdate(
      { orderId: order.orderId, status: { $in: ["pending", "processing", "manual_queue"] } },
      { $set: { status: "paid", paidAt: new Date() } },
      { new: true },
    );
    if (flipped) {
      await triggerReferralReward(order.userName, {
        type: "payout",
        id: order.providerRef || order.orderId,
        amountInr: order.method === "bank" ? order.grossAmount : order.grossAmount * (order.fxRate || 1),
      });
      pushToUser(order.userName, "withdrawalUpdate", { orderId: order.orderId, status: "paid" });
      pushUserMyInfo(order.userName);
    }
    return `paid (${order.orderId})`;
  }
  if (result.status === "failed") {
    const flipped = await WithdrawalOrderModel.findOneAndUpdate(
      { orderId: order.orderId, status: { $in: ["pending", "processing", "manual_queue"] } },
      { $set: { status: "failed", failedAt: new Date(), failedReason: result.failedReason || "Backstop poll: failed" } },
      { new: true },
    );
    if (flipped) {
      await engine.refundWithdrawal(order.userName, order.totalDebitInr);
      pushToUser(order.userName, "withdrawalUpdate", { orderId: order.orderId, status: "failed", failedReason: flipped.failedReason });
      pushUserMyInfo(order.userName);
    }
    return `failed (${order.orderId})`;
  }
  return result.status;
};

const tick = async (): Promise<void> => {
  if (running) return; // skip if previous tick still running
  running = true;
  try {
    // ── Pending recharge orders (within TTL) ──
    const recharges = await RechargeOrderModel.find({
      status: "pending",
      expiresAt: { $gt: new Date() },
    }).limit(50).lean();

    for (const o of recharges) {
      if (!shouldPoll(o.createdAt, o.lastPolledAt)) continue;
      const outcome = await pollPayin(o);
      if (outcome !== "pending" && outcome !== "unknown" && outcome !== "no-channel" && outcome !== "no-query-method") {
        console.log(`[orderWatcher] payin ${o.orderId.slice(0, 8)}: ${outcome}`);
      }
    }

    // ── In-flight withdrawal orders ──
    const withdrawals = await WithdrawalOrderModel.find({
      method: "bank",
      status: { $in: ["pending", "processing", "manual_queue"] },
    }).limit(50).lean();

    for (const o of withdrawals) {
      if (!shouldPoll(o.createdAt, o.lastPolledAt)) continue;
      const outcome = await pollPayout(o);
      if (outcome !== "pending" && outcome !== "unknown" && outcome !== "no-channel" && outcome !== "no-query-method" && outcome !== "skip-usdt") {
        console.log(`[orderWatcher] payout ${o.orderId.slice(0, 8)}: ${outcome}`);
      }
    }
  } finally {
    running = false;
  }
};

export const startOrderWatcher = (): void => {
  if (timer) return;
  console.log(`[orderWatcher] started (interval=${POLL_INTERVAL_MS}ms)`);
  tick().catch((e) => console.error("[orderWatcher] tick error:", e));
  timer = setInterval(() => {
    tick().catch((e) => console.error("[orderWatcher] tick error:", e));
  }, POLL_INTERVAL_MS);
};

export const stopOrderWatcher = (): void => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

/** Manual trigger — admin can hit this via the UI to force an immediate poll. */
export const pollOneOrderNow = async (
  direction: "payin" | "payout",
  orderId: string,
): Promise<{ ok: boolean; outcome: string }> => {
  if (direction === "payin") {
    const o = await RechargeOrderModel.findOne({ orderId }).lean();
    if (!o) return { ok: false, outcome: "order not found" };
    const outcome = await pollPayin(o);
    return { ok: true, outcome };
  } else {
    const o = await WithdrawalOrderModel.findOne({ orderId }).lean();
    if (!o) return { ok: false, outcome: "order not found" };
    const outcome = await pollPayout(o);
    return { ok: true, outcome };
  }
};
