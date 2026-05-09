import { Router } from "express";
import { authWithTelegram, authDevGuest } from "../auth/session";
import { config } from "../config";

export const authRouter = Router();

authRouter.post("/telegram", async (req, res) => {
  const initData: string = req.body?.initData || "";
  const result = await authWithTelegram(initData);
  if (!result) return res.status(401).json({ status: false, message: "Invalid Telegram initData" });
  res.json({ status: true, ...result });
});

authRouter.post("/guest", async (req, res) => {
  if (!config.allowDevAuth) return res.status(403).json({ status: false, message: "Dev auth disabled" });
  const name: string | undefined = req.body?.name;
  const result = await authDevGuest(name);
  res.json({ status: true, ...result });
});
