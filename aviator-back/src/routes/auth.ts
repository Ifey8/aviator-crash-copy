import { Router } from "express";
import { randomBytes } from "crypto";
import { authWithTelegram, authWithTelegramWidget, authDevGuest } from "../auth/session";
import { loginWithPassword, profileFromUserName } from "../auth/password";
import { verifyToken } from "../auth/jwt";
import { config } from "../config";
import { UserModel } from "../db/models/User";
import { LoginRequestModel } from "../db/models/LoginRequest";
import {
  checkRegisterIpLimit,
  recordRegisterAttempt,
  sendIpLimitExceeded,
} from "../middleware/registerLimit";

export const authRouter = Router();

authRouter.post("/telegram", async (req, res) => {
  const initData: string = req.body?.initData || "";
  const sid: string | undefined = req.body?.sid;
  const ref: string | undefined = req.body?.ref || req.body?.referrer;

  // Check IP limit BEFORE auth — but only count it if this turns out to be
  // a brand-new user (TG re-login of an existing user shouldn't count).
  const ipCheck = await checkRegisterIpLimit(req);
  if (!ipCheck.ok) return sendIpLimitExceeded(res, ipCheck);

  const result = await authWithTelegram(initData, { sid, referrer: ref });
  if (!result) return res.status(401).json({ status: false, message: "Invalid Telegram initData" });

  // Was this user just created? Compare createdAt to "a few seconds ago".
  const u = await UserModel.findOne({ userName: result.userName }).select("createdAt").lean();
  const isNew = u && Date.now() - new Date(u.createdAt).getTime() < 30_000;
  if (isNew) await recordRegisterAttempt(req, result.userName, "telegram");

  res.json({ status: true, ...result });
});

authRouter.post("/telegram-widget", async (req, res) => {
  const { sid, ref, referrer, ...payload } = req.body || {};

  const ipCheck = await checkRegisterIpLimit(req);
  if (!ipCheck.ok) return sendIpLimitExceeded(res, ipCheck);

  const result = await authWithTelegramWidget(payload, { sid, referrer: ref || referrer });
  if (!result) {
    return res.status(401).json({ status: false, message: "Invalid Telegram widget auth" });
  }

  const u = await UserModel.findOne({ userName: result.userName }).select("createdAt").lean();
  const isNew = u && Date.now() - new Date(u.createdAt).getTime() < 30_000;
  if (isNew) await recordRegisterAttempt(req, result.userName, "telegram");

  res.json({ status: true, ...result });
});

authRouter.post("/guest", async (req, res) => {
  if (!config.allowDevAuth) return res.status(403).json({ status: false, message: "Dev auth disabled" });
  const name: string | undefined = req.body?.name;
  const sid: string | undefined = req.body?.sid;
  const ref: string | undefined = req.body?.ref || req.body?.referrer;

  const ipCheck = await checkRegisterIpLimit(req);
  if (!ipCheck.ok) return sendIpLimitExceeded(res, ipCheck);

  const result = await authDevGuest(name, { sid, referrer: ref });
  await recordRegisterAttempt(req, result.userName, "guest");
  res.json({ status: true, ...result });
});

// ---------- Username / password ----------

authRouter.post("/login", async (req, res) => {
  const { userName, password } = req.body || {};
  const r = await loginWithPassword({ userName, password });
  if (!r.ok) return res.status(401).json({ status: false, message: r.reason });
  res.json({ status: true, ...r.result });
});

/**
 * POST /api/auth/login-request
 *
 * Cross-device login step 1: generate a one-time token.
 * Browser opens t.me/<bot>?start=auth_<token>, then polls /login-poll/<token>.
 */
authRouter.post("/login-request", async (_req, res) => {
  const token = randomBytes(10).toString("hex"); // 20 hex chars
  await LoginRequestModel.create({ token });
  res.json({ status: true, token });
});

/**
 * GET /api/auth/login-poll/:token
 *
 * Cross-device login step 3 (polling): called every ~2s by the browser.
 * Returns { fulfilled: false } while waiting, { fulfilled: true, jwt } on success.
 */
authRouter.get("/login-poll/:token", async (req, res) => {
  const doc = await LoginRequestModel.findOne({ token: req.params.token }).lean();
  if (!doc) return res.json({ status: false, message: "Invalid or expired token" });
  if (doc.expiresAt < new Date()) return res.json({ status: false, message: "Expired" });
  if (doc.status === "fulfilled" && doc.jwt) {
    return res.json({ status: true, fulfilled: true, jwt: doc.jwt });
  }
  res.json({ status: true, fulfilled: false });
});

/**
 * Public: return the first enabled bot's Telegram username + deep link.
 * Used by the AuthScreen to show the correct "Open in Telegram" link.
 * No auth required — returns only public info (username, no token).
 */
authRouter.get("/bots", async (_req, res) => {
  const { TelegramBotModel } = await import("../db/models/TelegramBot");
  const bots = await TelegramBotModel.find({ enabled: true })
    .select("username code webappUrl -_id")
    .sort({ createdAt: -1 })
    .lean();
  res.json({ status: true, bots });
});

/** Current user profile from Bearer token — used by frontend after page reload. */
authRouter.get("/me", async (req, res) => {
  const auth = req.header("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ status: false });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ status: false });
  const profile = await profileFromUserName(payload.userName);
  if (!profile) return res.status(401).json({ status: false });
  res.json({ status: true, ...profile });
});
