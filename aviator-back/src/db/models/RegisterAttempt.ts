import { Schema, model } from "mongoose";

/**
 * RegisterAttempt — anti-abuse log for new-user registrations.
 *
 * Recorded by registerLimit middleware on /api/auth/register, /telegram,
 * and /guest. Used to enforce settings.registerMaxPerIp24h: a hard cap
 * on how many distinct accounts can be created from a single IP per day.
 *
 * We keep entries for 7 days then expire them (TTL index) — the count
 * window is 24h so anything older is dead weight.
 *
 * NOTE: Behind nginx, the request IP must come from X-Forwarded-For;
 * Express needs `app.set("trust proxy", true)` for `req.ip` to honour it.
 */
export interface RegisterAttemptDoc {
  ip: string;
  userName: string;
  /** "register" | "telegram" | "guest" — for diagnostics. */
  source: string;
  createdAt: Date;
}

const RegisterAttemptSchema = new Schema<RegisterAttemptDoc>(
  {
    ip: { type: String, required: true, index: true },
    userName: { type: String, required: true },
    source: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { collection: "registerattempts" },
);

// TTL: drop 7-day-old rows automatically
RegisterAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export const RegisterAttemptModel = model<RegisterAttemptDoc>(
  "RegisterAttempt",
  RegisterAttemptSchema,
);
