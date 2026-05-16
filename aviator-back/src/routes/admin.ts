import { Router } from "express";
import { UserModel } from "../db/models/User";
import { BetModel } from "../db/models/Bet";
import { RoundModel } from "../db/models/Round";
import { WithdrawalOrderModel } from "../db/models/WithdrawalOrder";
import { requireAdmin } from "../middleware/requireAdmin";
import { engine } from "../game/engine";
import { config } from "../config";
import { getAllSettings, updateSettings } from "../settings";
import { pushToUser, pushUserMyInfo } from "../sockets";
import { triggerReferralReward } from "../payment/referral";
import { getHotWalletBalance } from "../payment/hotWallet";
import { listWallets, transferOut, sweepAddresses, fetchAddressBalance } from "../payment/walletOps";
import { PaymentChannelModel } from "../db/models/PaymentChannel";
import { WebhookLogModel } from "../db/models/WebhookLog";
import { listProviderTypes, getProviderType } from "../payment/catalog";
import { invalidateChannelCache, listChannelsAdmin, getChannelByCode } from "../payment/channels";
import { pollOneOrderNow } from "../payment/orderWatcher";
import { ChannelLedgerModel, computeChannelBalance } from "../db/models/ChannelLedger";
import { recordManualAdjustment, recordPayout, resolveChannelCodeForOrder } from "../payment/ledger";
import { TelegramBotModel } from "../db/models/TelegramBot";
import { reloadBot } from "../bot/telegram";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// ---------- Settings ----------

adminRouter.get("/settings", async (_req, res) => {
  res.json({ status: true, data: getAllSettings() });
});

adminRouter.put("/settings", async (req, res) => {
  const allowedNumbers = [
    "maxCrashMultiplier", "houseEdge", "minBet", "maxBet", "initialBalance",
    "cryptoMinUsdt", "cryptoMaxUsdt", "usdtInrRateFallback",
    "botMinCount", "botMaxCount",
    "referralRewardInr",
    "withdrawalFeePct", "withdrawalMinInr", "wagerMultiplier",
    "withdrawalReviewAboveInr", "withdrawalReviewNewAccountHours",
    "registerMaxPerIp24h",
    "inrRechargeEnabled",
    "usdtAutoPayoutEnabled", "usdtAutoPayoutMaxInr",
  ] as const;
  const allowedStrings = [
    // (Payme settings moved to PaymentChannel — managed via /admin/channels)
  ] as const;
  const patch: Record<string, number | string> = {};
  for (const k of allowedNumbers) {
    const v = req.body?.[k];
    if (v !== undefined) {
      const n = Number(v);
      if (!isFinite(n)) {
        return res.status(400).json({ status: false, message: `${k} must be a number` });
      }
      patch[k] = n;
    }
  }
  for (const k of allowedStrings) {
    const v = req.body?.[k];
    if (v !== undefined) {
      if (typeof v !== "string") {
        return res.status(400).json({ status: false, message: `${k} must be a string` });
      }
      // Length cap to keep schema sane + prevent abuse via huge writes
      patch[k] = v.slice(0, 512);
    }
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ status: false, message: "No valid fields in request" });
  }
  // Sanity: minBet <= maxBet, botMinCount <= botMaxCount, cryptoMin <= cryptoMax
  const merged = { ...getAllSettings(), ...patch } as any;
  if (Number(merged.minBet) > Number(merged.maxBet)) {
    return res.status(400).json({ status: false, message: "minBet > maxBet" });
  }
  if (Number(merged.botMinCount) > Number(merged.botMaxCount)) {
    return res.status(400).json({ status: false, message: "botMinCount > botMaxCount" });
  }
  if (Number(merged.cryptoMinUsdt) > Number(merged.cryptoMaxUsdt)) {
    return res.status(400).json({ status: false, message: "cryptoMinUsdt > cryptoMaxUsdt" });
  }
  const updated = await updateSettings(patch as any, req.adminUserName);
  res.json({ status: true, data: updated });
});

// ---------- Users ----------

adminRouter.get("/users", async (req, res) => {
  const q = ((req.query.q as string) || "").trim();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const skip = Math.max(Number(req.query.skip) || 0, 0);
  const filter: any = {};
  if (q) {
    filter.$or = [
      { userName: { $regex: q, $options: "i" } },
      { phone: { $regex: q } },
      { email: { $regex: q, $options: "i" } },
      { sid: { $regex: q, $options: "i" } },
      { referrer: { $regex: q, $options: "i" } },
    ];
  }
  // Optional explicit sid filter (e.g. /admin/users?sid=facebook)
  const sidFilter = ((req.query.sid as string) || "").trim();
  if (sidFilter) filter.sid = sidFilter;
  const [items, total] = await Promise.all([
    UserModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    UserModel.countDocuments(filter),
  ]);
  res.json({
    status: true,
    total,
    items: items.map((u) => ({
      userName: u.userName,
      phone: u.phone,
      email: u.email,
      balance: u.balance,
      isAdmin: !!u.isAdmin,
      banned: !!u.banned,
      bannedReason: u.bannedReason,
      telegramId: u.telegramId,
      sid: u.sid,
      referrer: u.referrer,
      referralEarned: u.referralEarned || 0,
      wagerRequired: u.wagerRequired || 0,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    })),
  });
});

adminRouter.patch("/users/:userName", async (req, res) => {
  const { userName } = req.params;
  const { balance, banned, bannedReason, isAdmin } = req.body || {};
  const updates: any = {};
  if (typeof balance === "number" && balance >= 0) updates.balance = balance;
  if (typeof banned === "boolean") updates.banned = banned;
  if (typeof bannedReason === "string") updates.bannedReason = bannedReason;
  if (typeof isAdmin === "boolean") updates.isAdmin = isAdmin;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ status: false, message: "No updatable fields" });
  }
  const user = await UserModel.findOneAndUpdate({ userName }, { $set: updates }, { new: true });
  if (!user) return res.status(404).json({ status: false, message: "User not found" });

  // If they're connected and we just changed balance, push a fresh myInfo
  // so the client UI updates immediately.
  if ("balance" in updates) {
    const p = engine.getPlayer(userName);
    if (p) p.balance = updates.balance;
  }

  res.json({ status: true, user: { userName: user.userName, balance: user.balance, banned: user.banned, isAdmin: user.isAdmin } });
});

// ---------- Rounds ----------

adminRouter.get("/rounds", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const skip = Math.max(Number(req.query.skip) || 0, 0);
  const items = await RoundModel.find()
    .sort({ roundId: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  res.json({
    status: true,
    items: items.map((r) => ({
      roundId: r.roundId,
      crashPoint: r.crashPoint,
      serverSeedHash: r.serverSeedHash,
      betCount: r.bets.length,
      totalBetAmount: r.bets.reduce((a: number, b: any) => a + (b.betAmount || 0), 0),
      totalCashout: r.bets.reduce((a: number, b: any) => a + (b.cashAmount || 0), 0),
      createdAt: r.createdAt,
    })),
  });
});

adminRouter.get("/rounds/:roundId", async (req, res) => {
  const round = await RoundModel.findOne({ roundId: Number(req.params.roundId) }).lean();
  if (!round) return res.status(404).json({ status: false });
  res.json({ status: true, round });
});

// ---------- Stats ----------

adminRouter.get("/stats", async (_req, res) => {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [users, bets24h, rounds24h, bansCount] = await Promise.all([
    UserModel.countDocuments({}),
    BetModel.aggregate([
      { $match: { createdAt: { $gte: since24h } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          wagered: { $sum: "$betAmount" },
          paidOut: { $sum: "$cashAmount" },
        },
      },
    ]),
    RoundModel.countDocuments({ createdAt: { $gte: since24h } }),
    UserModel.countDocuments({ banned: true }),
  ]);
  const b24 = bets24h[0] || { count: 0, wagered: 0, paidOut: 0 };
  const ggr24h = b24.wagered - b24.paidOut;
  res.json({
    status: true,
    engine: {
      phase: engine.phase,
      multiplier: engine.multiplier,
      players: engine.players.size,
      historyLen: engine.history.length,
    },
    users: { total: users, banned: bansCount },
    last24h: {
      bets: b24.count,
      rounds: rounds24h,
      wagered: Math.round(b24.wagered),
      paidOut: Math.round(b24.paidOut),
      ggr: Math.round(ggr24h),
      houseEdgePct: b24.wagered > 0 ? +((ggr24h / b24.wagered) * 100).toFixed(2) : 0,
    },
    config: {
      minBet: config.minBet,
      maxBet: config.maxBet,
      houseEdge: config.houseEdge,
      betDurationMs: config.betDurationMs,
    },
  });
});

// ---------- Withdrawals ----------

const withdrawalForAdmin = (o: any) => ({
  orderId: o.orderId,
  userName: o.userName,
  method: o.method,
  status: o.status,
  grossAmount: o.grossAmount,
  feeAmount: o.feeAmount,
  totalDebitInr: o.totalDebitInr,
  bankAccount: o.bankAccount,
  ifsc: o.ifsc,
  holderName: o.holderName,
  trc20Address: o.trc20Address,
  fxRate: o.fxRate,
  txHash: o.txHash,
  provider: o.provider,
  providerRef: o.providerRef,
  failedReason: o.failedReason,
  meta: o.meta,
  createdAt: o.createdAt,
  paidAt: o.paidAt,
  failedAt: o.failedAt,
  cancelledAt: o.cancelledAt,
});

adminRouter.get("/withdrawals", async (req, res) => {
  const status = ((req.query.status as string) || "").trim();
  const userName = ((req.query.userName as string) || "").trim();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const skip = Math.max(Number(req.query.skip) || 0, 0);

  const filter: any = {};
  if (status) filter.status = status;
  if (userName) filter.userName = userName;

  const [items, total, pendingCount] = await Promise.all([
    WithdrawalOrderModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    WithdrawalOrderModel.countDocuments(filter),
    WithdrawalOrderModel.countDocuments({
      status: { $in: ["pending", "processing", "manual_queue"] },
    }),
  ]);

  res.json({
    status: true,
    total,
    pendingCount,
    items: items.map(withdrawalForAdmin),
  });
});

/** Admin force-success: mark order paid, record txHash if USDT, fire referral. */
adminRouter.post("/withdrawals/:orderId/mark-paid", async (req, res) => {
  const { orderId } = req.params;
  const txHash: string | undefined = req.body?.txHash;
  const order = await WithdrawalOrderModel.findOne({ orderId });
  if (!order) return res.status(404).json({ status: false, message: "Order not found" });
  if (!["pending", "processing", "manual_queue", "review"].includes(order.status)) {
    return res.status(400).json({
      status: false,
      message: `Cannot mark paid — order is ${order.status}`,
    });
  }
  // Atomic flip
  const flipped = await WithdrawalOrderModel.findOneAndUpdate(
    {
      orderId,
      status: { $in: ["pending", "processing", "manual_queue", "review"] },
    },
    {
      $set: {
        status: "paid",
        paidAt: new Date(),
        txHash: order.method === "usdt" ? txHash : undefined,
      },
    },
    { new: true },
  );
  if (!flipped) return res.status(409).json({ status: false, message: "Order state changed" });

  // Trigger referral reward (idempotent on orderId)
  await triggerReferralReward(order.userName, {
    type: "payout",
    id: order.providerRef || order.orderId,
    amountInr: order.grossAmount,
  });

  // Channel ledger: same recordPayout the webhook + watcher write, so
  // admin force-paid keeps the gateway balance accurate. Bank only —
  // USDT settles on-chain and isn't a channel concept.
  if (flipped.method === "bank") {
    const chCode = await resolveChannelCodeForOrder(flipped);
    if (chCode) {
      try {
        await recordPayout({
          channelCode: chCode,
          orderId: flipped.orderId,
          providerRef: flipped.providerRef,
          grossInr: flipped.grossAmount,
        });
      } catch (e) {
        console.error("[admin] mark-paid ledger recordPayout failed:", (e as Error).message);
      }
    }
  }

  pushToUser(order.userName, "withdrawalUpdate", {
    orderId: order.orderId,
    status: "paid",
    txHash: flipped.txHash,
  });
  pushUserMyInfo(order.userName);

  res.json({ status: true, data: withdrawalForAdmin(flipped) });
});

/** Admin broadcast: send USDT from hot wallet for a manual_queue order. */
adminRouter.post("/withdrawals/:orderId/broadcast", async (req, res) => {
  const { orderId } = req.params;
  const order = await WithdrawalOrderModel.findOne({ orderId });
  if (!order) return res.status(404).json({ status: false, message: "Order not found" });
  if (order.method !== "usdt") {
    return res.status(400).json({ status: false, message: "Broadcast only applies to USDT withdrawals" });
  }
  if (order.status !== "manual_queue") {
    return res.status(400).json({ status: false, message: `Order is ${order.status}, expected manual_queue` });
  }
  if (!order.trc20Address) {
    return res.status(400).json({ status: false, message: "Order has no TRC20 destination address" });
  }

  const result = await transferOut({ to: order.trc20Address, amountUsdt: order.grossAmount });
  if (!result.ok) {
    return res.status(400).json({ status: false, message: result.reason || "Broadcast failed" });
  }

  const flipped = await WithdrawalOrderModel.findOneAndUpdate(
    { orderId, status: "manual_queue" },
    { $set: { status: "paid", paidAt: new Date(), txHash: result.txHash, failedReason: undefined } },
    { new: true },
  );
  if (!flipped) return res.status(409).json({ status: false, message: "Order state changed concurrently" });

  await triggerReferralReward(order.userName, {
    type: "payout",
    id: order.providerRef || order.orderId,
    amountInr: order.grossAmount,
  });

  pushToUser(order.userName, "withdrawalUpdate", {
    orderId: order.orderId,
    status: "paid",
    txHash: result.txHash,
  });
  pushUserMyInfo(order.userName);

  res.json({ status: true, txHash: result.txHash, data: withdrawalForAdmin(flipped) });
});

/** Admin force-failure: mark order failed + refund balance. */
adminRouter.post("/withdrawals/:orderId/mark-failed", async (req, res) => {
  const { orderId } = req.params;
  const reason: string = (req.body?.reason || "Admin marked failed").toString().slice(0, 200);
  const order = await WithdrawalOrderModel.findOne({ orderId });
  if (!order) return res.status(404).json({ status: false, message: "Order not found" });
  if (!["pending", "processing", "manual_queue", "review"].includes(order.status)) {
    return res.status(400).json({
      status: false,
      message: `Cannot mark failed — order is ${order.status}`,
    });
  }
  const flipped = await WithdrawalOrderModel.findOneAndUpdate(
    {
      orderId,
      status: { $in: ["pending", "processing", "manual_queue", "review"] },
    },
    {
      $set: { status: "failed", failedAt: new Date(), failedReason: reason },
    },
    { new: true },
  );
  if (!flipped) return res.status(409).json({ status: false, message: "Order state changed" });

  await engine.refundWithdrawal(order.userName, order.totalDebitInr);
  pushToUser(order.userName, "withdrawalUpdate", {
    orderId: order.orderId,
    status: "failed",
    failedReason: reason,
  });
  pushUserMyInfo(order.userName);

  res.json({ status: true, data: withdrawalForAdmin(flipped) });
});

/**
 * Approve a review-status withdrawal: clears the review hold, calls the
 * payout provider, and flips status to whatever provider returns
 * (typically "processing"). Admin can then mark it paid once they verify
 * the actual transfer landed.
 */
adminRouter.post("/withdrawals/:orderId/approve-review", async (req, res) => {
  const { orderId } = req.params;
  const order = await WithdrawalOrderModel.findOne({ orderId });
  if (!order) return res.status(404).json({ status: false, message: "Order not found" });
  if (order.status !== "review") {
    return res.status(400).json({
      status: false,
      message: `Order is ${order.status}, not under review`,
    });
  }

  // Lazy import to avoid require cycles with admin routes
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getPayoutProvider, defaultPayoutProvider } = require("../payment/payouts");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getHotWalletBalance } = require("../payment/hotWallet");

  const providerName = order.provider || defaultPayoutProvider(order.method);
  const provider = getPayoutProvider(providerName);
  if (!provider) {
    return res.status(500).json({ status: false, message: `Provider ${providerName} not registered` });
  }

  let nextStatus: string = "processing";
  let providerRef: string | undefined = order.providerRef;
  try {
    if (order.method === "usdt") {
      const hot = await getHotWalletBalance();
      if (!hot || hot.usdtBalance < order.grossAmount) {
        nextStatus = "manual_queue";
      } else {
        const r = await provider.createPayout({
          orderId: order.orderId,
          userName: order.userName,
          method: "usdt",
          grossAmount: order.grossAmount,
          trc20Address: order.trc20Address,
        });
        providerRef = r.providerRef;
        nextStatus = r.status;
      }
    } else {
      const r = await provider.createPayout({
        orderId: order.orderId,
        userName: order.userName,
        method: "bank",
        grossAmount: order.grossAmount,
        bankAccount: order.bankAccount,
        ifsc: order.ifsc,
        holderName: order.holderName,
      });
      providerRef = r.providerRef;
      nextStatus = r.status;
    }
  } catch (e) {
    return res.status(502).json({
      status: false,
      message: `Provider error: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const flipped = await WithdrawalOrderModel.findOneAndUpdate(
    { orderId, status: "review" },
    { $set: { status: nextStatus, providerRef } },
    { new: true },
  );
  if (!flipped) return res.status(409).json({ status: false, message: "Order state changed" });

  pushToUser(order.userName, "withdrawalUpdate", {
    orderId: order.orderId,
    status: nextStatus,
  });

  res.json({ status: true, data: withdrawalForAdmin(flipped) });
});

// ============================================================
// Telegram Bots
// ============================================================

const maskToken = (t: string): string => {
  if (!t) return "";
  if (t.length <= 12) return "••••";
  // BOTID:••••XXXX — keep the bot_id prefix (everything before :) visible
  // since it's public; only mask the secret half. Last 4 chars revealed
  // for verification.
  const i = t.indexOf(":");
  if (i < 0) return "••••" + t.slice(-4);
  return t.slice(0, i + 1) + "••••" + t.slice(-4);
};

adminRouter.get("/telegram-bots", async (_req, res) => {
  const docs = await TelegramBotModel.find().sort({ createdAt: 1 }).lean();
  res.json({
    status: true,
    data: docs.map((d) => ({
      code: d.code,
      name: d.name,
      username: d.username,
      tokenMasked: maskToken(d.token),
      webappUrl: d.webappUrl,
      startMessage: d.startMessage || "",
      startButtonLabel: d.startButtonLabel || "",
      enabled: d.enabled,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
  });
});

adminRouter.post("/telegram-bots", async (req, res) => {
  const { code, name, token, webappUrl, startMessage, startButtonLabel, enabled } = req.body || {};
  if (!code || !/^[a-z0-9_-]{2,32}$/i.test(code)) {
    return res.status(400).json({ status: false, message: "code: 2-32 alphanumeric/_/- required" });
  }
  if (!name) return res.status(400).json({ status: false, message: "name required" });
  if (!token || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    return res.status(400).json({ status: false, message: "token must look like 1234567890:ABC... per BotFather" });
  }
  const dup = await TelegramBotModel.findOne({ code });
  if (dup) return res.status(409).json({ status: false, message: `Bot with code "${code}" exists` });
  const doc = await TelegramBotModel.create({
    code,
    name,
    token: token.trim(),
    webappUrl: String(webappUrl || "").trim() || undefined,
    startMessage: String(startMessage || "").slice(0, 4000),
    startButtonLabel: String(startButtonLabel || "").slice(0, 64),
    enabled: !!enabled,
  });
  if (doc.enabled) await reloadBot(doc.code);
  res.json({ status: true, data: { code: doc.code } });
});

adminRouter.patch("/telegram-bots/:code", async (req, res) => {
  const doc = await TelegramBotModel.findOne({ code: req.params.code });
  if (!doc) return res.status(404).json({ status: false, message: "Bot not found" });
  const { name, token, webappUrl, startMessage, startButtonLabel, enabled } = req.body || {};
  if (typeof name === "string") doc.name = name;
  if (typeof token === "string" && token.trim()) {
    // ignore masked placeholder (•••• in the middle)
    if (!/^[•\*]/.test(token) && !token.includes("••••")) {
      if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token.trim())) {
        return res.status(400).json({ status: false, message: "invalid token shape" });
      }
      doc.token = token.trim();
    }
  }
  if (typeof webappUrl === "string") doc.webappUrl = webappUrl.trim();
  if (typeof startMessage === "string") doc.startMessage = startMessage.slice(0, 4000);
  if (typeof startButtonLabel === "string") doc.startButtonLabel = startButtonLabel.slice(0, 64);
  if (typeof enabled === "boolean") doc.enabled = enabled;
  doc.updatedAt = new Date();
  await doc.save();
  await reloadBot(doc.code);
  res.json({ status: true, data: { code: doc.code } });
});

adminRouter.delete("/telegram-bots/:code", async (req, res) => {
  const r = await TelegramBotModel.deleteOne({ code: req.params.code });
  await reloadBot(req.params.code); // will just stop, since doc gone
  res.json({ status: true, data: { deleted: r.deletedCount } });
});

// ============================================================
// Payment Channels
// ============================================================

/**
 * GET /admin/channels/types — list supported provider types + their
 * credential / param FieldSpec schemas. Admin UI uses this to render
 * the "create channel" form dynamically — no UI changes required when
 * a new provider lands in the catalog.
 *
 * Sensitive fields are listed by key only (no values, no secrets here).
 */
adminRouter.get("/channels/types", async (_req, res) => {
  const types = listProviderTypes().map((t) => ({
    name: t.name,
    displayName: t.displayName,
    countries: t.countries,
    supports: t.supports,
    credentialFields: t.credentialFields,
    paramFields: t.paramFields,
  }));
  res.json({ status: true, data: types });
});

/**
 * GET /admin/channels — list all configured channels. Secrets are
 * MASKED in the response (•••• + last 4 chars). For audit + summary;
 * the admin doesn't need to re-read secrets once saved.
 */
adminRouter.get("/channels", async (_req, res) => {
  const docs = await listChannelsAdmin();
  const mask = (v: string): string => {
    if (!v) return "";
    if (v.length <= 4) return "••••";
    return "••••" + v.slice(-4);
  };
  const rows = docs.map((d) => {
    const t = getProviderType(d.provider);
    const credSpecs = t?.credentialFields || [];
    const credentials: Record<string, string> = {};
    const credMap = d.credentials instanceof Map
      ? Object.fromEntries((d.credentials as any).entries())
      : { ...(d.credentials as any) };
    for (const spec of credSpecs) {
      const raw = String(credMap[spec.key] || "");
      credentials[spec.key] = spec.kind === "secret" ? mask(raw) : raw;
    }
    const paramMap = d.params instanceof Map
      ? Object.fromEntries((d.params as any).entries())
      : { ...(d.params as any) };
    return {
      code: d.code,
      name: d.name,
      provider: d.provider,
      providerDisplayName: t?.displayName || d.provider,
      country: d.country,
      enabled: d.enabled,
      supports: d.supports,
      credentials,
      params: paramMap,
      priority: d.priority,
      callbackIpAllowlist: d.callbackIpAllowlist || "",
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  });
  res.json({ status: true, data: rows });
});

/**
 * POST /admin/channels — create a new channel. Validates against the
 * provider type's FieldSpec (required credentials present, countries
 * in the allowed set, etc).
 */
adminRouter.post("/channels", async (req, res) => {
  const {
    code, name, provider, country,
    enabled, supports, credentials, params, priority,
  } = req.body || {};

  if (!code || !/^[a-z0-9_-]{3,32}$/i.test(code)) {
    return res.status(400).json({ status: false, message: "code: 3-32 alphanumeric/_/- required" });
  }
  if (!name || typeof name !== "string") {
    return res.status(400).json({ status: false, message: "name required" });
  }
  const type = provider && getProviderType(provider);
  if (!type) {
    return res.status(400).json({ status: false, message: `Unknown provider type "${provider}"` });
  }
  if (!country || !type.countries.includes(country)) {
    return res.status(400).json({ status: false, message: `country must be one of ${type.countries.join(", ")}` });
  }
  // Validate credentials against spec
  const credObj: Record<string, string> = {};
  for (const spec of type.credentialFields) {
    const v = credentials?.[spec.key];
    if (spec.required && !String(v || "").trim()) {
      return res.status(400).json({ status: false, message: `credentials.${spec.key} is required` });
    }
    if (v !== undefined) credObj[spec.key] = String(v).slice(0, 512);
  }
  const paramObj: Record<string, string> = {};
  for (const spec of type.paramFields) {
    const v = params?.[spec.key];
    if (v !== undefined) paramObj[spec.key] = String(v).slice(0, 256);
    else if (spec.default !== undefined) paramObj[spec.key] = spec.default;
  }

  const existing = await PaymentChannelModel.findOne({ code });
  if (existing) {
    return res.status(409).json({ status: false, message: `Channel "${code}" already exists` });
  }

  const doc = await PaymentChannelModel.create({
    code,
    name,
    provider,
    country,
    enabled: !!enabled,
    supports: {
      payin: supports?.payin !== false && type.supports.payin,
      payout: supports?.payout !== false && type.supports.payout,
    },
    credentials: credObj,
    params: paramObj,
    priority: typeof priority === "number" ? priority : 100,
    callbackIpAllowlist: typeof req.body?.callbackIpAllowlist === "string" ? String(req.body.callbackIpAllowlist).slice(0, 512) : "",
  });
  res.json({ status: true, data: { code: doc.code } });
});

/**
 * PATCH /admin/channels/:code — update an existing channel. Same
 * validation rules as create, but secrets are only updated when the
 * admin sends a non-empty new value (allows admin UI to send the
 * masked placeholder for unchanged secrets).
 */
adminRouter.patch("/channels/:code", async (req, res) => {
  const doc = await PaymentChannelModel.findOne({ code: req.params.code });
  if (!doc) return res.status(404).json({ status: false, message: "Channel not found" });
  const type = getProviderType(doc.provider);
  if (!type) return res.status(500).json({ status: false, message: "Provider type missing from catalog" });

  const {
    name, country, enabled, supports, credentials, params, priority,
  } = req.body || {};

  if (typeof name === "string") doc.name = name;
  if (country) {
    if (!type.countries.includes(country)) {
      return res.status(400).json({ status: false, message: `country must be one of ${type.countries.join(", ")}` });
    }
    doc.country = country;
  }
  if (typeof enabled === "boolean") doc.enabled = enabled;
  if (supports) {
    if (typeof supports.payin === "boolean") doc.supports.payin = supports.payin && type.supports.payin;
    if (typeof supports.payout === "boolean") doc.supports.payout = supports.payout && type.supports.payout;
  }
  if (credentials && typeof credentials === "object") {
    for (const spec of type.credentialFields) {
      const v = credentials[spec.key];
      if (v === undefined) continue;
      const s = String(v).trim();
      // Don't overwrite secrets with the masked placeholder
      if (spec.kind === "secret" && /^[•\*]+/.test(s)) continue;
      (doc.credentials as any).set(spec.key, s.slice(0, 512));
    }
  }
  if (params && typeof params === "object") {
    for (const spec of type.paramFields) {
      const v = params[spec.key];
      if (v === undefined) continue;
      (doc.params as any).set(spec.key, String(v).slice(0, 256));
    }
  }
  if (typeof priority === "number") doc.priority = priority;
  if (typeof req.body?.callbackIpAllowlist === "string") {
    doc.callbackIpAllowlist = String(req.body.callbackIpAllowlist).slice(0, 512);
  }
  doc.updatedAt = new Date();
  await doc.save();
  invalidateChannelCache(doc.code);
  res.json({ status: true, data: { code: doc.code } });
});

/**
 * DELETE /admin/channels/:code — remove a channel. Affects future
 * routing only; existing orders keep their stored providerRef and the
 * webhook still verifies via channel doc IF it still exists. Use with
 * care — better to disable than to delete.
 */
adminRouter.delete("/channels/:code", async (req, res) => {
  const r = await PaymentChannelModel.deleteOne({ code: req.params.code });
  invalidateChannelCache(req.params.code);
  res.json({ status: true, data: { deleted: r.deletedCount } });
});

/**
 * POST /admin/channels/:code/test — ping the upstream gateway to verify
 * credentials + connectivity. No money moves and no order is created.
 *
 * Strategy: dispatch the provider's queryOrderStatus / queryPayoutStatus
 * with a bogus order_no like "_aviator_diag_<ts>". A healthy gateway:
 *   (a) responds within a few hundred ms (network reachable)
 *   (b) accepts the MD5 signature (secretKey + merchant_code right)
 *   (c) returns «order not found» or similar (auth succeeded, just no
 *       such record). For Payme that surfaces as status=unknown + a
 *       failedReason from the gateway — we treat that combo as OK.
 *
 * Anything else — network throw, HTTP 4xx, sign-mismatch — bubbles up
 * verbatim so the operator can see exactly what's wrong without digging
 * through server logs.
 */
adminRouter.post("/channels/:code/test", async (req, res) => {
  const ch = await getChannelByCode(req.params.code, { allowDisabled: true });
  if (!ch) return res.status(404).json({ status: false, message: "Channel not found" });

  const lines: string[] = [];
  // Same bogus id for both directions — easier to spot in upstream logs.
  const dummyId = `_aviator_diag_${Date.now()}`;

  const ping = async (
    label: string,
    fn: (() => Promise<{ status: string; failedReason?: string }>) | null,
  ): Promise<void> => {
    if (!fn) {
      lines.push(`${label}: configured (no query method to ping)`);
      return;
    }
    const t0 = Date.now();
    try {
      const r = await fn();
      const ms = Date.now() - t0;
      // status="unknown" with a failedReason = gateway responded with
      // «not found» or similar — which IS the success signal for a bogus
      // orderId (we never created it, so "unknown" means it round-tripped).
      const headline = r.status === "unknown" && r.failedReason
        ? "OK (round-trip"
        : `${r.status} (`;
      lines.push(`${label}: ${headline}${ms}ms)${r.failedReason ? ` — ${r.failedReason}` : ""}`);
    } catch (e) {
      const ms = Date.now() - t0;
      lines.push(`${label}: THREW (${ms}ms) — ${(e as Error).message}`);
    }
  };

  await ping(
    "PAYIN",
    ch.payment?.queryOrderStatus
      ? () => ch.payment!.queryOrderStatus!({ orderId: dummyId })
      : null,
  );
  await ping(
    "PAYOUT",
    ch.payout?.queryPayoutStatus
      ? () => ch.payout!.queryPayoutStatus!({ orderId: dummyId })
      : null,
  );

  res.json({
    status: true,
    data: {
      code: ch.doc.code,
      provider: ch.doc.provider,
      hasPayment: !!ch.payment,
      hasPayout: !!ch.payout,
      message: lines.length ? lines.join("\n") : "Channel resolves but no provider direction is configured.",
    },
  });
});

/**
 * GET /admin/channels/:code/balance — computed channel balance.
 * Returns the SUM(credit) - SUM(debit) per category breakdown.
 */
adminRouter.get("/channels/:code/balance", async (req, res) => {
  const code = req.params.code;
  const ch = await PaymentChannelModel.findOne({ code }).lean();
  if (!ch) return res.status(404).json({ status: false, message: "Channel not found" });
  const balance = await computeChannelBalance(code);
  res.json({ status: true, data: balance });
});

/**
 * GET /admin/channels/:code/ledger — paginated ledger query.
 * Filters: from / to (ISO date), category, direction, limit (max 200).
 */
adminRouter.get("/channels/:code/ledger", async (req, res) => {
  const code = req.params.code;
  const filter: Record<string, unknown> = { channelCode: code };
  if (req.query.category) filter.category = String(req.query.category);
  if (req.query.direction) filter.direction = String(req.query.direction);
  if (req.query.from || req.query.to) {
    const range: Record<string, Date> = {};
    if (req.query.from) range.$gte = new Date(String(req.query.from));
    if (req.query.to) range.$lte = new Date(String(req.query.to));
    filter.createdAt = range as any;
  }
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  const items = await ChannelLedgerModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  const total = await ChannelLedgerModel.countDocuments(filter);
  res.json({ status: true, total, items });
});

/**
 * POST /admin/channels/:code/adjust — manual ledger entry.
 * Body: { direction: "credit" | "debit", amountInr, note }
 * Use cases:
 *   • "manual_withdraw" — operator pulled funds out of Payme to their bank
 *   • "manual_credit"   — top-up / refund booked back / opening balance
 */
adminRouter.post("/channels/:code/adjust", async (req, res) => {
  const code = req.params.code;
  const ch = await PaymentChannelModel.findOne({ code }).lean();
  if (!ch) return res.status(404).json({ status: false, message: "Channel not found" });
  const direction = req.body?.direction;
  const amountInr = Number(req.body?.amountInr);
  const note = String(req.body?.note || "").slice(0, 256);
  if (direction !== "credit" && direction !== "debit") {
    return res.status(400).json({ status: false, message: "direction must be credit or debit" });
  }
  if (!isFinite(amountInr) || amountInr <= 0) {
    return res.status(400).json({ status: false, message: "amountInr must be > 0" });
  }
  if (!note.trim()) {
    return res.status(400).json({ status: false, message: "note required (reason for the adjustment)" });
  }
  await recordManualAdjustment({
    channelCode: code,
    direction,
    amountInr: +amountInr.toFixed(2),
    note,
    createdBy: req.adminUserName || "admin",
  });
  const balance = await computeChannelBalance(code);
  res.json({ status: true, data: { balance } });
});

/**
 * GET /admin/webhook-logs — query the callback audit trail.
 *
 * Filters (all optional):
 *   channelCode  — exact match
 *   direction    — "payin" | "payout"
 *   outcome      — exact match (ok-paid / rejected-sig / ...)
 *   orderNo      — exact match on the merchant order_no
 *   platOrderNo  — exact match on the gateway's plat_order_no
 *   ip           — exact source IP
 *   from / to    — ISO date range on createdAt
 *   limit        — default 50, max 200
 */
adminRouter.get("/webhook-logs", async (req, res) => {
  const filter: Record<string, unknown> = {};
  const q = req.query;
  if (q.channelCode) filter.channelCode = String(q.channelCode);
  if (q.direction) filter.direction = String(q.direction);
  if (q.outcome) filter.outcome = String(q.outcome);
  if (q.orderNo) filter.orderNo = String(q.orderNo);
  if (q.platOrderNo) filter.platOrderNo = String(q.platOrderNo);
  if (q.ip) filter.ip = String(q.ip);
  if (q.from || q.to) {
    const range: Record<string, Date> = {};
    if (q.from) range.$gte = new Date(String(q.from));
    if (q.to) range.$lte = new Date(String(q.to));
    filter.createdAt = range as any;
  }
  const limit = Math.min(Number(q.limit) || 50, 200);
  const items = await WebhookLogModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  const total = await WebhookLogModel.countDocuments(filter);
  res.json({ status: true, total, items });
});

/**
 * POST /admin/orders/poll — force a backstop query of a single order now.
 * Body: { direction: "payin" | "payout", orderId: "..." }
 * Useful when an operator wants to manually re-check an order that may
 * have missed its webhook. orderWatcher does this automatically on the
 * tiered schedule — this endpoint just bypasses the schedule.
 */
adminRouter.post("/orders/poll", async (req, res) => {
  const direction = req.body?.direction;
  const orderId = req.body?.orderId;
  if (direction !== "payin" && direction !== "payout") {
    return res.status(400).json({ status: false, message: "direction must be payin or payout" });
  }
  if (!orderId || typeof orderId !== "string") {
    return res.status(400).json({ status: false, message: "orderId required" });
  }
  const r = await pollOneOrderNow(direction, orderId);
  res.json({ status: r.ok, data: r });
});

// ---------- Hot wallet status (USDT liquidity gauge) ----------

adminRouter.get("/wallet-status", async (_req, res) => {
  const balance = await getHotWalletBalance();
  res.json({ status: true, data: balance });
});

// ---------- Wallets (hot + derived sub-addresses) ----------

/**
 * GET /admin/wallets — full list with live TRX + USDT balances.
 * Cached 30s server-side; pass ?fresh=1 to force refetch.
 */
adminRouter.get("/wallets", async (req, res) => {
  const useCache = req.query.fresh !== "1";
  try {
    const r = await listWallets(useCache);
    res.json({ status: true, data: r });
  } catch (e) {
    res.status(502).json({ status: false, message: (e as Error).message });
  }
});

/**
 * POST /admin/wallets/transfer-out — manual transfer from hot wallet to
 * an external address. Body:
 *   { to: string, amountUsdt?: number, amountTrx?: number, dryRun?: bool }
 * Wraps walletOps.transferOut so the operator never has to handle keys.
 */
adminRouter.post("/wallets/transfer-out", async (req, res) => {
  const { to, amountUsdt, amountTrx, dryRun } = req.body || {};
  try {
    const r = await transferOut({
      to,
      amountUsdt: amountUsdt != null ? Number(amountUsdt) : undefined,
      amountTrx: amountTrx != null ? Number(amountTrx) : undefined,
      dryRun: !!dryRun,
    });
    if (!r.ok) return res.status(400).json({ status: false, ...r });
    res.json({ status: true, data: r });
  } catch (e) {
    res.status(502).json({ status: false, message: (e as Error).message });
  }
});

/**
 * GET /admin/wallets/balance/:address — live single-address chain read.
 * Bypasses the 30s cache. Used by the per-row "from chain" refresh button
 * in the admin Wallets tab so operators can verify on-chain state without
 * triggering a full N-address re-fetch (which is rate-limited by TronGrid).
 */
adminRouter.get("/wallets/balance/:address", async (req, res) => {
  const addr = req.params.address;
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) {
    return res.status(400).json({ status: false, message: "Invalid TRC20 address" });
  }
  try {
    const r = await fetchAddressBalance(addr);
    res.json({ status: true, data: r });
  } catch (e) {
    res.status(502).json({ status: false, message: (e as Error).message });
  }
});

/**
 * POST /admin/wallets/reset-sweep-marker — clear sweptAt / sweptTxHash on
 * all paid orders for a given depositAddress so a subsequent /sweep can
 * re-process them. Use when admin sees on-chain USDT but DB believes the
 * address is already swept (typically caused by an earlier sweep that
 * misread TronGrid's response as "no balance" and prematurely flagged
 * the order).
 */
adminRouter.post("/wallets/reset-sweep-marker", async (req, res) => {
  const address: string | undefined = req.body?.address;
  if (!address || !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    return res.status(400).json({ status: false, message: "address required (TRC20)" });
  }
  // Lazy-import to avoid a top-level cycle with the admin router
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { CryptoOrderModel } = require("../db/models/CryptoOrder");
  const r = await CryptoOrderModel.updateMany(
    { depositAddress: address, status: "paid" },
    { $unset: { sweptAt: "", sweptTxHash: "" } },
  );
  res.json({
    status: true,
    data: { modified: r.modifiedCount, address },
  });
});

/**
 * POST /admin/wallets/sweep — run the sweep operation on paid+un-swept
 * deposit addresses → hot wallet. Optional body.addresses limits scope.
 */
adminRouter.post("/wallets/sweep", async (req, res) => {
  const { addresses, dryRun } = req.body || {};
  try {
    const r = await sweepAddresses({
      addresses: Array.isArray(addresses) ? addresses : undefined,
      dryRun: !!dryRun,
    });
    res.json({ status: true, data: r });
  } catch (e) {
    res.status(502).json({ status: false, message: (e as Error).message });
  }
});
