import { Schema, model } from "mongoose";

/**
 * WebhookLog — append-only audit trail of every callback received from
 * a payment gateway, regardless of outcome.
 *
 * Every record captures:
 *   • which channel handled (or attempted to handle) the request
 *   • the source IP (X-Forwarded-For respected via app.set("trust proxy"))
 *   • whether the IP passed the channel's allowlist
 *   • whether the signature verified
 *   • the parsed order info we managed to pull out
 *   • the response we sent back to the provider
 *
 * Useful for:
 *   • Compliance: prove a callback arrived and how we handled it
 *   • Debug: when a payment "doesn't credit", search by order_no and
 *     see exactly what we received + why we rejected (bad IP, bad sig,
 *     unknown channel, etc).
 *   • Provider integration: replay or compare requests during onboarding.
 *
 * TTL: 90 days. Operator can extend in Settings if regulators require it.
 */
export interface WebhookLogDoc {
  channelCode?: string;
  direction: "payin" | "payout";
  ip: string;
  ipAllowed: boolean;
  signValid: boolean;
  outcome: "ok-paid" | "ok-failed" | "rejected-ip" | "rejected-sig" | "rejected-unknown" | "order-not-found" | "error";
  /** Extracted from body if parseable. */
  orderNo?: string;
  platOrderNo?: string;
  orderStatus?: string;
  /** Truncated raw body, max 4KB to keep the collection small. */
  rawBody: string;
  /** Selected request headers (user-agent, x-forwarded-for, content-type). */
  headers: Record<string, string>;
  /** HTTP status we returned + first 500 bytes of response. */
  responseStatus: number;
  responseBody: string;
  /** Free-form note when something specific went wrong. */
  note?: string;
  createdAt: Date;
}

const WebhookLogSchema = new Schema<WebhookLogDoc>(
  {
    channelCode: { type: String, index: true },
    direction: { type: String, required: true, enum: ["payin", "payout"], index: true },
    ip: { type: String, required: true, index: true },
    ipAllowed: { type: Boolean, required: true },
    signValid: { type: Boolean, required: true },
    outcome: { type: String, required: true, index: true },
    orderNo: { type: String, index: true },
    platOrderNo: { type: String, index: true },
    orderStatus: { type: String },
    rawBody: { type: String, required: true },
    headers: { type: Object, default: {} },
    responseStatus: { type: Number, required: true },
    responseBody: { type: String, default: "" },
    note: { type: String },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { collection: "webhooklogs" },
);

// 90-day TTL — admin can extend by recreating the index with a longer span.
WebhookLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const WebhookLogModel = model<WebhookLogDoc>("WebhookLog", WebhookLogSchema);

// ---------------------------------------------------------------------------
// Helper: matchIpAllowlist
// Accepts a comma-separated list of:
//   • exact IPs:       16.163.88.85
//   • CIDR ranges:     54.46.98.0/24
//   • IPv6-mapped IPv4 is normalised by stripping ::ffff: prefix.
// Returns true when the list is empty (no gate) OR the ip matches any entry.
// ---------------------------------------------------------------------------

export const matchIpAllowlist = (allowlist: string, ip: string): boolean => {
  const list = (allowlist || "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true; // no gate
  const normIp = (ip || "").replace(/^::ffff:/, "");
  for (const entry of list) {
    if (entry === normIp) return true;
    if (entry.includes("/") && cidrMatch(entry, normIp)) return true;
  }
  return false;
};

const cidrMatch = (cidr: string, ip: string): boolean => {
  const [range, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  if (!isFinite(bits) || bits < 0 || bits > 32) return false;
  const toInt = (s: string): number => {
    const parts = s.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return -1;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  };
  const a = toInt(range);
  const b = toInt(ip);
  if (a < 0 || b < 0) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) === (b & mask);
};
