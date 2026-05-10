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
import { listWallets, transferOut, sweepAddresses } from "../payment/walletOps";

export const adminRouter = Router();
adminRouter.use(requireAdmin);

// ---------- Settings ----------

adminRouter.get("/settings", async (_req, res) => {
  res.json({ status: true, data: getAllSettings() });
});

adminRouter.put("/settings", async (req, res) => {
  const allowed = [
    "maxCrashMultiplier", "houseEdge", "minBet", "maxBet", "initialBalance",
    "cryptoMinUsdt", "cryptoMaxUsdt", "usdtInrRateFallback",
    "botMinCount", "botMaxCount",
    "referralRewardInr",
    "withdrawalFeePct", "withdrawalMinInr", "wagerMultiplier",
    "withdrawalReviewAboveInr", "withdrawalReviewNewAccountHours",
    "registerMaxPerIp24h",
  ] as const;
  const patch: Record<string, number> = {};
  for (const k of allowed) {
    const v = req.body?.[k];
    if (v !== undefined) {
      const n = Number(v);
      if (!isFinite(n)) {
        return res.status(400).json({ status: false, message: `${k} must be a number` });
      }
      patch[k] = n;
    }
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ status: false, message: "No valid fields in request" });
  }
  // Sanity: minBet <= maxBet, botMinCount <= botMaxCount, cryptoMin <= cryptoMax
  const merged = { ...getAllSettings(), ...patch };
  if (merged.minBet > merged.maxBet) {
    return res.status(400).json({ status: false, message: "minBet > maxBet" });
  }
  if (merged.botMinCount > merged.botMaxCount) {
    return res.status(400).json({ status: false, message: "botMinCount > botMaxCount" });
  }
  if (merged.cryptoMinUsdt > merged.cryptoMaxUsdt) {
    return res.status(400).json({ status: false, message: "cryptoMinUsdt > cryptoMaxUsdt" });
  }
  const updated = await updateSettings(patch, req.adminUserName);
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

  pushToUser(order.userName, "withdrawalUpdate", {
    orderId: order.orderId,
    status: "paid",
    txHash: flipped.txHash,
  });
  pushUserMyInfo(order.userName);

  res.json({ status: true, data: withdrawalForAdmin(flipped) });
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
