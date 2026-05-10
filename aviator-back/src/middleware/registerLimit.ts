import { Request, Response, NextFunction } from "express";
import { RegisterAttemptModel } from "../db/models/RegisterAttempt";
import { getSetting } from "../settings";

/**
 * Helpers used by the auth routes:
 *
 *   • clientIp(req)        → best-effort client IP (handles X-Forwarded-For
 *                            via Express's trust-proxy setting).
 *   • checkRegisterIpLimit → throws 429 if this IP already created
 *                            registerMaxPerIp24h accounts in the last 24h.
 *                            Returns { ok, count, limit } so callers can
 *                            log telemetry. 0 in setting = unlimited.
 *   • recordRegisterAttempt → writes a row AFTER successful auth, so
 *                              limit only counts SUCCESSFUL registrations.
 *
 * We don't use a generic Express middleware here because each auth route
 * has its own success-condition (validation may fail before we reach
 * upsertUser); we only want to count rows that resulted in a real new
 * user. So callers invoke checkRegisterIpLimit at request start, then
 * recordRegisterAttempt only on the success path.
 */

export const clientIp = (req: Request): string => {
  // Express with trust proxy returns the original client IP via req.ip.
  // Strip IPv6 prefix `::ffff:` for clean storage.
  const raw = (req.ip || req.socket.remoteAddress || "").toString();
  return raw.replace(/^::ffff:/, "");
};

export interface IpLimitResult {
  ok: boolean;
  count: number;
  limit: number;
  ip: string;
}

export const checkRegisterIpLimit = async (req: Request): Promise<IpLimitResult> => {
  const limit = Number(getSetting("registerMaxPerIp24h") || 0);
  const ip = clientIp(req);
  if (limit === 0 || !ip) return { ok: true, count: 0, limit, ip };
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await RegisterAttemptModel.countDocuments({ ip, createdAt: { $gte: since } });
  return { ok: count < limit, count, limit, ip };
};

export const recordRegisterAttempt = async (
  req: Request,
  userName: string,
  source: "register" | "telegram" | "guest",
): Promise<void> => {
  const ip = clientIp(req);
  if (!ip) return;
  try {
    await RegisterAttemptModel.create({ ip, userName, source });
  } catch {
    // Non-fatal — registration succeeded, we just lose telemetry for this row.
  }
};

/** Convenience: send the standard 429 response with the count info. */
export const sendIpLimitExceeded = (res: Response, info: IpLimitResult): void => {
  res.status(429).json({
    status: false,
    message: `Too many accounts created from your network (${info.count}/${info.limit} in 24h). Try again later or contact support.`,
  });
};
