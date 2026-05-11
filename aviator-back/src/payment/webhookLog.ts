import type { Request, Response } from "express";
import { WebhookLogModel, matchIpAllowlist } from "../db/models/WebhookLog";
import { getChannelMeta } from "./channels";
import { clientIp } from "../middleware/registerLimit";

/**
 * Webhook gatekeeper + logger.
 *
 * Wraps the entire callback handler so every received request gets:
 *   1. IP captured (X-Forwarded-For aware via app.set("trust proxy"))
 *   2. IP allowlist checked against the channel's stored list — if the
 *      channel has a non-empty list and the IP isn't in it, 403 + log
 *      "rejected-ip" and short-circuit.
 *   3. Handler invoked (which does signature verification + business logic)
 *   4. WebhookLog row written with outcome + parsed order info if possible
 *
 * Callers (the recharge / withdrawal webhook routes) use this by:
 *   await webhookGuard(req, res, { channelCode, direction }, async () => {
 *     // sig-verify + state-flip + response
 *     return { outcome, orderNo, platOrderNo, orderStatus, status, body };
 *   });
 *
 * The returned object tells the guard what response to send AND what
 * outcome to log.
 */

export interface GuardContext {
  channelCode?: string;
  direction: "payin" | "payout";
}

export interface GuardResult {
  outcome:
    | "ok-paid"
    | "ok-failed"
    | "rejected-sig"
    | "order-not-found"
    | "error";
  orderNo?: string;
  platOrderNo?: string;
  orderStatus?: string;
  /** What to send the provider as a response. */
  responseStatus: number;
  /** Body — string for text response (e.g. Payme "success"), or JSON-encoded. */
  responseBody: string;
  responseContentType?: "text" | "json";
  note?: string;
}

const MAX_BODY = 4 * 1024;
const MAX_RESP = 500;

const safeBodyString = (req: Request): string => {
  try {
    const s = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    return s.length > MAX_BODY ? s.slice(0, MAX_BODY) + "…[truncated]" : s;
  } catch {
    return "[unstringifiable body]";
  }
};

const pickHeaders = (req: Request): Record<string, string> => {
  const wanted = ["user-agent", "content-type", "x-forwarded-for", "x-real-ip"];
  const out: Record<string, string> = {};
  for (const h of wanted) {
    const v = req.headers[h];
    if (typeof v === "string") out[h] = v.slice(0, 256);
    else if (Array.isArray(v)) out[h] = v.join(",").slice(0, 256);
  }
  return out;
};

export const webhookGuard = async (
  req: Request,
  res: Response,
  ctx: GuardContext,
  handler: () => Promise<GuardResult>,
): Promise<void> => {
  const ip = clientIp(req);
  const rawBody = safeBodyString(req);
  const headers = pickHeaders(req);

  // 1. IP gate — only when channelCode present + channel has a list
  let ipAllowed = true;
  if (ctx.channelCode) {
    const meta = await getChannelMeta(ctx.channelCode);
    if (meta && meta.callbackIpAllowlist) {
      ipAllowed = matchIpAllowlist(meta.callbackIpAllowlist, ip);
    }
  }
  if (!ipAllowed) {
    res.status(403).json({ status: false, message: "IP not on channel allowlist" });
    await WebhookLogModel.create({
      channelCode: ctx.channelCode,
      direction: ctx.direction,
      ip,
      ipAllowed: false,
      signValid: false,
      outcome: "rejected-ip",
      rawBody,
      headers,
      responseStatus: 403,
      responseBody: '{"status":false,"message":"IP not on channel allowlist"}',
      note: `IP ${ip} not in allowlist`,
    });
    return;
  }

  // 2. Run the actual handler — it does sig verify + state flip
  let result: GuardResult;
  try {
    result = await handler();
  } catch (e) {
    res.status(500).json({ status: false, message: (e as Error).message });
    await WebhookLogModel.create({
      channelCode: ctx.channelCode,
      direction: ctx.direction,
      ip,
      ipAllowed,
      signValid: false,
      outcome: "error",
      rawBody,
      headers,
      responseStatus: 500,
      responseBody: ((e as Error).message || "").slice(0, MAX_RESP),
      note: "Handler threw",
    });
    return;
  }

  // 3. Send response per handler's decision
  if (result.responseContentType === "text") {
    res.status(result.responseStatus).type("text").send(result.responseBody);
  } else {
    res.status(result.responseStatus).json(JSON.parse(result.responseBody || "{}"));
  }

  // 4. Log it
  const signValid = result.outcome !== "rejected-sig";
  await WebhookLogModel.create({
    channelCode: ctx.channelCode,
    direction: ctx.direction,
    ip,
    ipAllowed,
    signValid,
    outcome: result.outcome,
    orderNo: result.orderNo,
    platOrderNo: result.platOrderNo,
    orderStatus: result.orderStatus,
    rawBody,
    headers,
    responseStatus: result.responseStatus,
    responseBody: (result.responseBody || "").slice(0, MAX_RESP),
    note: result.note,
  });
};
