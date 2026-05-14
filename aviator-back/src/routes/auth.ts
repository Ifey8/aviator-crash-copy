import { Router } from "express";
import { authWithTelegram, authWithTelegramWidget, authDevGuest } from "../auth/session";
import { loginWithPassword, profileFromUserName } from "../auth/password";
import { verifyToken } from "../auth/jwt";
import { config } from "../config";
import { UserModel } from "../db/models/User";
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
