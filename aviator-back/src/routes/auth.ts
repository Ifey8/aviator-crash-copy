import { Router } from "express";
import { authWithTelegram, authDevGuest } from "../auth/session";
import { registerWithPassword, loginWithPassword, profileFromUserName } from "../auth/password";
import { verifyToken } from "../auth/jwt";
import { config } from "../config";

export const authRouter = Router();

authRouter.post("/telegram", async (req, res) => {
  const initData: string = req.body?.initData || "";
  const sid: string | undefined = req.body?.sid;
  const ref: string | undefined = req.body?.ref || req.body?.referrer;
  const result = await authWithTelegram(initData, { sid, referrer: ref });
  if (!result) return res.status(401).json({ status: false, message: "Invalid Telegram initData" });
  res.json({ status: true, ...result });
});

authRouter.post("/guest", async (req, res) => {
  if (!config.allowDevAuth) return res.status(403).json({ status: false, message: "Dev auth disabled" });
  const name: string | undefined = req.body?.name;
  const sid: string | undefined = req.body?.sid;
  const ref: string | undefined = req.body?.ref || req.body?.referrer;
  const result = await authDevGuest(name, { sid, referrer: ref });
  res.json({ status: true, ...result });
});

// ---------- Username / password ----------

authRouter.post("/register", async (req, res) => {
  const { userName, password, phone, sid, ref, referrer } = req.body || {};
  const r = await registerWithPassword({
    userName,
    password,
    phone,
    sid,
    referrer: ref || referrer,
  });
  if (!r.ok) return res.status(400).json({ status: false, message: r.reason });
  res.json({ status: true, ...r.result });
});

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
