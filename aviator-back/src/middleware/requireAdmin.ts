import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth/jwt";
import { UserModel } from "../db/models/User";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminUserName?: string;
    }
  }
}

/**
 * Express middleware: rejects unless the request carries an ADMIN Bearer JWT
 * (issued only by /api/auth/admin-login after password + TOTP — ordinary
 * game / Telegram tokens are refused) AND that user has isAdmin === true. Attaches the user name
 * to req.adminUserName for downstream handlers.
 */
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const auth = req.header("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    res.status(401).json({ status: false, message: "Missing Bearer token" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ status: false, message: "Invalid token" });
    return;
  }
  if (payload.adm !== true) {
    res.status(401).json({ status: false, message: "Admin 2FA login required" });
    return;
  }
  const user = await UserModel.findOne({ userName: payload.userName }).select("+passwordHash");
  if (!user || !user.isAdmin) {
    res.status(403).json({ status: false, message: "Admin only" });
    return;
  }
  if (user.banned) {
    res.status(403).json({ status: false, message: "Account banned" });
    return;
  }
  req.adminUserName = user.userName;
  next();
};
