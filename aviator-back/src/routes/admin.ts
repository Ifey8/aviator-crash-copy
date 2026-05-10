import { Router } from "express";
import { UserModel } from "../db/models/User";
import { BetModel } from "../db/models/Bet";
import { RoundModel } from "../db/models/Round";
import { requireAdmin } from "../middleware/requireAdmin";
import { engine } from "../game/engine";
import { config } from "../config";
import { getAllSettings, updateSettings } from "../settings";

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
