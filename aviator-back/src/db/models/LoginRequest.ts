import { Schema, model } from "mongoose";

/**
 * LoginRequest — one-time cross-device login token.
 *
 * Flow:
 *   1. Browser calls POST /api/auth/login-request  → gets { token }
 *   2. Browser opens t.me/bot?start=auth_<token>
 *   3. Browser polls GET /api/auth/login-poll/<token> every 2s
 *   4. User taps "Confirm Login" inline button in the bot
 *   5. Bot callback handler: upserts user, generates JWT,
 *      stores JWT in this doc (status → "fulfilled")
 *   6. Next poll returns { fulfilled: true, jwt }
 *   7. Browser stores JWT → reloads → logged in
 *
 * TTL index on `expiresAt` — Mongo auto-deletes after 5 minutes.
 */
export interface LoginRequestDoc {
  token: string;
  status: "pending" | "fulfilled";
  jwt?: string;
  createdAt: Date;
  expiresAt: Date;
}

const LoginRequestSchema = new Schema<LoginRequestDoc>({
  token: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ["pending", "fulfilled"], default: "pending" },
  jwt: { type: String },
  createdAt: { type: Date, default: Date.now },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 5 * 60 * 1000), // 5 min
  },
});

// Auto-delete expired docs
LoginRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginRequestModel = model<LoginRequestDoc>(
  "LoginRequest",
  LoginRequestSchema,
);
