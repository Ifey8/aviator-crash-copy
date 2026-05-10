import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { RechargeOrderModel, RechargeStatus } from "../db/models/RechargeOrder";
import { UserModel } from "../db/models/User";
import { requireAuth } from "../middleware/requireAuth";
import { config } from "../config";
import { engine } from "../game/engine";
import { pushToUser, pushUserMyInfo } from "../sockets";
import { getProvider, defaultProvider, listProviders } from "../payment";
import { triggerReferralReward } from "../payment/referral";

export const rechargeRouter = Router();

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
  const amount = Number(req.body?.amount);
  const providerName: string = req.body?.provider || defaultProvider();

  if (!amount || amount < config.rechargeMinAmount || amount > config.rechargeMaxAmount) {
    return res.status(400).json({
      status: false,
      message: `Amount must be between ${config.rechargeMinAmount} and ${config.rechargeMaxAmount}`,
    });
  }

  const provider = getProvider(providerName);
  if (!provider) {
    return res.status(400).json({
      status: false,
      message: `Unknown provider "${providerName}". Available: ${listProviders().join(", ")}`,
    });
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
      webhookUrl: `${config.frontendUrl.replace(/:18803.*/, ":18805")}/api/recharge/webhook/${provider.name}`,
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
    provider: provider.name,
    providerRef: providerResult.providerRef,
    status: "pending" as RechargeStatus,
    paymentUrl: providerResult.paymentUrl,
    qrCode: providerResult.qrCode,
    expiresAt,
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
const markPaidAndCredit = async (
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

  return { ok: true, order };
};

// ---------------------------------------------------------------------------
// POST /api/recharge/webhook/:provider — provider callback (PUBLIC, sig-verified)
// Body MUST be parsed as raw JSON for HMAC; we use the global express.json()
// middleware which gives us the parsed object — for HMAC providers we re-stringify.
// ---------------------------------------------------------------------------
rechargeRouter.post("/webhook/:provider", async (req: Request, res: Response) => {
  const provider = getProvider(req.params.provider);
  if (!provider) {
    return res.status(404).json({ status: false, message: "Unknown provider" });
  }
  const rawBody = JSON.stringify(req.body);
  const result = provider.verifyWebhook(req.headers, rawBody);
  if (!result.ok) {
    return res.status(400).json({ status: false, message: "Webhook verification failed" });
  }
  if (result.status === "paid") {
    const r = await markPaidAndCredit(result.providerRef, result.raw);
    return res.json({ status: r.ok, data: { orderId: r.order?.orderId } });
  }
  // Failed — mark order as failed, no credit.
  const order = await RechargeOrderModel.findOneAndUpdate(
    { providerRef: result.providerRef, status: "pending" },
    { $set: { status: "failed", failedReason: result.failedReason || "Provider reported failure" } },
    { new: true },
  );
  if (order) {
    pushToUser(order.userName, "rechargeUpdate", { orderId: order.orderId, status: "failed" });
  }
  res.json({ status: true });
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
