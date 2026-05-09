import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth/jwt";
import { UserModel } from "../db/models/User";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUserName?: string;
    }
  }
}

/**
 * Express middleware: rejects unless the request carries a valid Bearer JWT.
 * Attaches the user's name to req.authUserName for downstream handlers.
 *
 * Unlike requireAdmin, this DOES NOT require isAdmin — any logged-in,
 * non-banned user passes.
 */
export const requireAuth = async (
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
  const user = await UserModel.findOne({ userName: payload.userName });
  if (!user) {
    res.status(401).json({ status: false, message: "User not found" });
    return;
  }
  if (user.banned) {
    res.status(403).json({ status: false, message: "Account banned" });
    return;
  }
  req.authUserName = user.userName;
  next();
};
