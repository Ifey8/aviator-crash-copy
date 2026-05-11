import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { RechargeOrderModel, RechargeStatus } from "../db/models/RechargeOrder";
import { UserModel } from "../db/models/User";
import { requireAuth } from "../middleware/requireAuth";
import { config } from "../config";
import { engine } from "../game/engine";
import { pushToUser, pushUserMyInfo } from "../sockets";
import { getProvider, defaultProvider, listProviders } from "../payment";
import { getChannelByCode, getDefaultChannel } from "../payment/channels";
import { webhookGuard } from "../payment/webhookLog";
import { triggerReferralReward } from "../payment/referral";
import { recordPayin, resolveChannelCodeForOrder } from "../payment/ledger";
import { getSetting } from "../settings";

export const rechargeRouter = Router();

/**
 * GET /api/recharge/config — public-ish (auth required) channel availability.
 * Frontend uses this to hide/disable INR tab in the RechargeSheet when the
 * operator hasn't enabled fiat. USDT recharge is gated separately by
 * tronNetwork being set.
 */
rechargeRouter.get("/config", requireAuth, async (_req, res) => {
  res.json({
    status: true,
    data: {
      inrEnabled: Number(getSetting("inrRechargeEnabled") || 0) === 1,
      usdtEnabled: !!config.tronNetwork && !!config.tronContract,
      minInr: config.rechargeMinAmount,
      maxInr: config.rechargeMaxAmount,
    },
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const expireIfNeeded = async (
  doc: InstanceType<typeof RechargeOrderModel>,
): Promise<InstanceType<typeof RechargeOrderModel>> => {
  if (doc.status === "pending" && doc.expiresAt < new Date()) {
    doc.status = "expired";
    await doc.save();
  }
  return doc;
};

const orderToClient = (o: InstanceType<typeof RechargeOrderModel>) => ({
  orderId: o.orderId,
  amount: o.amount,
  currency: o.currency,
  status: o.status,
  provider: o.provider,
  paymentUrl: o.paymentUrl,
  qrCode: o.qrCode,
  createdAt: o.createdAt,
  expiresAt: o.expiresAt,
  paidAt: o.paidAt,
  failedReason: o.failedReason,
});

// ---------------------------------------------------------------------------
// POST /api/recharge/create — initiate a new top-up order
// ---------------------------------------------------------------------------
rechargeRouter.post("/create", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  // Normalise amount to integer rupees right at the entry: Payme rejects
  // decimal order_amount and we want DB / display / provider call all to
  // agree on the same value. Use Math.round so 499.6 → 500, not 499.
  const amount = Math.round(Number(req.body?.amount) || 0);
  const explicitChannelCode: string | undefined = req.body?.channelCode;
  const explicitProvider: string | undefined = req.body?.provider; // legacy fallback

  // Gate: INR recharge disabled until a real payment provider is integrated.
  if (Number(getSetting("inrRechargeEnabled") || 0) !== 1) {
    return res.status(403).json({
      status: false,
      message: "INR recharge is temporarily unavailable. Please use USDT (crypto) recharge for now.",
    });
  }

  if (!amount || amount < config.rechargeMinAmount || amount > config.rechargeMaxAmount) {
    return res.status(400).json({
      status: false,
      message: `Amount must be between ${config.rechargeMinAmount} and ${config.rechargeMaxAmount}`,
    });
  }

  // ── Channel resolution ──
  // Priority: explicit channelCode → default channel for country IN → legacy
  // top-level provider registry (mock / razorpay) as fallback for dev.
  let providerName: string;
  let provider: ReturnType<typeof getProvider> = null;
  let channelCode: string | undefined;

  if (explicitChannelCode) {
    const ch = await getChannelByCode(explicitChannelCode);
    if (!ch || !ch.payment) {
      return res.status(400).json({ status: false, message: `Channel "${explicitChannelCode}" not found or doesn't support payin` });
    }
    provider = ch.payment;
    providerName = ch.doc.provider;
    channelCode = ch.doc.code;
  } else {
    const def = await getDefaultChannel("IN", "payin");
    if (def && def.payment) {
      provider = def.payment;
      providerName = def.doc.provider;
      channelCode = def.doc.code;
    } else {
      // No active channel — fall back to legacy registry. Lets dev keep
      // using mock without setting up channels.
      providerName = explicitProvider || defaultProvider();
      provider = getProvider(providerName);
      if (!provider) {
        return res.status(400).json({
          status: false,
          message: `No active payment channel for IN, and unknown legacy provider "${providerName}". Available: ${listProviders().join(", ")}`,
        });
      }
    }
  }

  // Reject if user already has too many pending orders (basic abuse guard).
  const pendingCount = await RechargeOrderModel.countDocuments({
    userName,
    status: "pending",
    expiresAt: { $gt: new Date() },
  });
  if (pendingCount >= 5) {
    return res.status(429).json({
      status: false,
      message: "You have too many pending orders. Cancel one or wait for them to expire.",
    });
  }

  const orderId = randomUUID();
  const expiresAt = new Date(Date.now() + config.rechargeOrderTtlMs);

  let providerResult;
  try {
    providerResult = await provider.createOrder({
      orderId,
      amount,
      currency: "INR",
      userName,
      returnUrl: `${config.frontendUrl}/recharge/return?orderId=${orderId}`,
      // Webhook routes by CHANNEL CODE so we can look up the right channel
      // credentials when verifying signature. Falls back to legacy
      // provider-name routing when no channel is configured.
      webhookUrl: `${config.frontendUrl.replace(/:18803.*/, ":18805")}/api/recharge/webhook/${channelCode || provider.name}`,
    });
  } catch (e) {
    return res.status(502).json({
      status: false,
      message: `Provider error: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const doc = await RechargeOrderModel.create({
    orderId,
    userName,
    amount,
    currency: "INR",
    // Store provider type for analytics + channel code for webhook routing.
    provider: providerName,
    providerRef: providerResult.providerRef,
    status: "pending" as RechargeStatus,
    paymentUrl: providerResult.paymentUrl,
    qrCode: providerResult.qrCode,
    expiresAt,
    meta: channelCode ? { channelCode } : undefined,
  });

  res.json({ status: true, data: orderToClient(doc) });
});

// ---------------------------------------------------------------------------
// GET /api/recharge/status/:orderId — poll order status
// ---------------------------------------------------------------------------
rechargeRouter.get("/status/:orderId", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  const order = await RechargeOrderModel.findOne({ orderId: req.params.orderId });
  if (!order || order.userName !== userName) {
    return res.status(404).json({ status: false, message: "Order not found" });
  }
  await expireIfNeeded(order);
  res.json({ status: true, data: orderToClient(order) });
});

// ---------------------------------------------------------------------------
// GET /api/recharge/orders — recent orders for the logged-in user
// ---------------------------------------------------------------------------
rechargeRouter.get("/orders", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  const orders = await RechargeOrderModel.find({ userName })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
  res.json({ status: true, data: orders.map((o) => ({
    orderId: o.orderId,
    amount: o.amount,
    currency: o.currency,
    status: o.status,
    provider: o.provider,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
  })) });
});

// ---------------------------------------------------------------------------
// POST /api/recharge/cancel/:orderId — user cancels a pending order
// ---------------------------------------------------------------------------
rechargeRouter.post("/cancel/:orderId", requireAuth, async (req: Request, res: Response) => {
  const userName = req.authUserName!;
  const updated = await RechargeOrderModel.findOneAndUpdate(
    { orderId: req.params.orderId, userName, status: "pending" },
    { $set: { status: "cancelled" } },
    { new: true },
  );
  if (!updated) {
    return res.status(404).json({ status: false, message: "Order not found or not pending" });
  }
  pushToUser(userName, "rechargeUpdate", { orderId: updated.orderId, status: "cancelled" });
  res.json({ status: true, data: orderToClient(updated) });
});

// ---------------------------------------------------------------------------
// Internal: mark an order paid + credit balance.
// IDEMPOTENT — only applies if order was pending.
// Called from both webhook and dev mock-pay endpoints.
// ---------------------------------------------------------------------------
// Exported so orderWatcher can reuse the same idempotent credit logic
// when it polls /api/payinOrderQuery and finds an order is paid.
export const markPaidAndCredit = async (
  providerRef: string,
  raw: unknown,
): Promise<{ ok: boolean; reason?: string; order?: InstanceType<typeof RechargeOrderModel> }> => {
  // Atomically flip pending → paid; this prevents double-credit on retry.
  const order = await RechargeOrderModel.findOneAndUpdate(
    { providerRef, status: "pending" },
    { $set: { status: "paid", paidAt: new Date(), meta: raw as Record<string, unknown> } },
    { new: true },
  );
  if (!order) {
    // Either already paid (idempotent OK) or doesn't exist.
    const existing = await RechargeOrderModel.findOne({ providerRef });
    if (existing && existing.status === "paid") return { ok: true, order: existing };
    return { ok: false, reason: "Order not found or not pending" };
  }

  // Recharges add to wagerRequired (1x by default — admin-tunable). Bonuses
  // (referral / admin / cashout winnings) go through creditBalance which does NOT.
  const newBalance = await engine.creditRecharge(order.userName, order.amount);
  if (newBalance == null) {
    // User vanished — leave order as paid (Mongo source of truth) but log.
    console.warn(`[recharge] paid order ${order.orderId} for missing user ${order.userName}`);
    return { ok: true, order };
  }
  order.balanceAfter = newBalance;
  await order.save();

  // Push status + fresh balance to the user (if they're online).
  pushToUser(order.userName, "rechargeUpdate", {
    orderId: order.orderId,
    status: "paid",
    amount: order.amount,
    balance: newBalance,
  });
  pushUserMyInfo(order.userName);

  // Referral reward (idempotent, no-op if user has no referrer)
  await triggerReferralReward(order.userName, {
    type: "recharge",
    id: order.providerRef || order.orderId,
    amountInr: order.amount,
  });

  // Channel ledger: record the payin as a credit on the channel's
  // running balance. resolveChannelCodeForOrder falls back to
  // provider→channel lookup if meta.channelCode is missing (handles
  // orphans from partial deploys + manual flips).
  const channelCode = await resolveChannelCodeForOrder(order);
  if (channelCode) {
    try {
      await recordPayin({
        channelCode,
        orderId: order.orderId,
        providerRef: order.providerRef,
        grossInr: order.amount,
      });
    } catch (e) {
      console.error("[recharge] ledger recordPayin failed:", (e as Error).message);
    }
  }

  return { ok: true, order };
};

// ---------------------------------------------------------------------------
// POST /api/recharge/webhook/:key — provider callback (PUBLIC, sig-verified)
// :key is either a channel code (new path) or a legacy provider name
// (mock / razorpay). We try channel lookup first, then fall back.
// Payme expects literal "success" string as ack; other providers JSON.
// ---------------------------------------------------------------------------
rechargeRouter.post("/webhook/:key", async (req: Request, res: Response) => {
  const key = req.params.key;

  // Quick existence check — does :key match a channel or a legacy provider?
  const ch = await getChannelByCode(key, { allowDisabled: true });
  const isChannel = !!ch?.payment;
  const legacy = isChannel ? null : getProvider(key);

  if (!isChannel && !legacy) {
    return res.status(404).json({ status: false, message: "Unknown provider/channel" });
  }

  await webhookGuard(
    req, res,
    { channelCode: isChannel ? key : undefined, direction: "payin" },
    async () => {
      const rawBody = JSON.stringify(req.body);
      const result = isChannel
        ? ch!.payment!.verifyWebhook(req.headers, rawBody)
        : legacy!.verifyWebhook(req.headers, rawBody);

      const orderNo = String((req.body?.transdata?.order_no || req.body?.order_no || "")).slice(0, 64);
      const platOrderNo = result.providerRef || "";
      const orderStatus = String((req.body?.transdata?.order_status || req.body?.order_status || "")).slice(0, 32);

      if (!result.ok) {
        return {
          outcome: "rejected-sig" as const,
          orderNo, platOrderNo, orderStatus,
          responseStatus: 400,
          responseBody: JSON.stringify({ status: false, message: result.failedReason || "Webhook verification failed" }),
          responseContentType: "json" as const,
          note: result.failedReason,
        };
      }
      if (result.status === "paid") {
        const r = await markPaidAndCredit(result.providerRef, result.raw);
        if (!r.ok) {
          return {
            outcome: "order-not-found" as const,
            orderNo, platOrderNo, orderStatus,
            responseStatus: isChannel ? 200 : 200,
            responseBody: isChannel ? "success" : JSON.stringify({ status: false, message: r.reason }),
            responseContentType: isChannel ? "text" as const : "json" as const,
            note: r.reason,
          };
        }
        return {
          outcome: "ok-paid" as const,
          orderNo, platOrderNo, orderStatus,
          responseStatus: 200,
          responseBody: isChannel ? "success" : JSON.stringify({ status: true, data: { orderId: r.order?.orderId } }),
          responseContentType: isChannel ? "text" as const : "json" as const,
        };
      }
      // status === "failed"
      const order = await RechargeOrderModel.findOneAndUpdate(
        { providerRef: result.providerRef, status: "pending" },
        { $set: { status: "failed", failedReason: result.failedReason || "Provider reported failure" } },
        { new: true },
      );
      if (order) {
        pushToUser(order.userName, "rechargeUpdate", { orderId: order.orderId, status: "failed" });
      }
      return {
        outcome: "ok-failed" as const,
        orderNo, platOrderNo, orderStatus,
        responseStatus: 200,
        responseBody: isChannel ? "success" : JSON.stringify({ status: true }),
        responseContentType: isChannel ? "text" as const : "json" as const,
      };
    },
  );
});

// ---------------------------------------------------------------------------
// POST /api/recharge/mock-pay/:orderId — DEV-ONLY simulated payment
// (Mock provider's "user clicks Pay Now" maps here.)
// ---------------------------------------------------------------------------
rechargeRouter.post("/mock-pay/:orderId", async (req: Request, res: Response) => {
  if (!config.allowDevAuth) {
    return res.status(404).json({ status: false, message: "Not found" });
  }
  const order = await RechargeOrderModel.findOne({ orderId: req.params.orderId });
  if (!order) return res.status(404).json({ status: false, message: "Order not found" });
  if (order.provider !== "mock") {
    return res.status(400).json({ status: false, message: "Mock-pay only valid for mock provider" });
  }
  const r = await markPaidAndCredit(order.providerRef, { mockPay: true });
  res.json({ status: r.ok, message: r.reason, data: r.order ? orderToClient(r.order) : null });
});
