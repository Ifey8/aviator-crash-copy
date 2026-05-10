import { Schema, model } from "mongoose";

/**
 * Settings — singleton document (_id="default") holding live-editable
 * game / economy parameters. Admin can change them via UI; the in-memory
 * cache (settings/index.ts) reflects the change immediately for all new
 * rounds / new bets / new orders.
 *
 * Only fields that are SAFE to change at runtime live here. Engine
 * lifecycle params (mongo URI, jwt secret, bet duration, etc.) stay in
 * env vars because changing them mid-flight would break in-flight rounds.
 */
export interface SettingsDoc {
  _id: string;

  // ── Game economy ──
  maxCrashMultiplier: number;
  houseEdge: number;
  minBet: number;
  maxBet: number;
  initialBalance: number;

  // ── Crypto recharge ──
  cryptoMinUsdt: number;
  cryptoMaxUsdt: number;
  usdtInrRateFallback: number;

  // ── Bots (room liveliness) ──
  botMinCount: number;
  botMaxCount: number;

  // ── Referral ──
  /** INR credited to referrer EACH TIME a referred user successfully recharges OR withdraws. */
  referralRewardInr: number;

  // ── Withdrawal ──
  /** Fee added ON TOP of withdrawal amount. 0.05 = 5%. user requests ₹1000 → balance −1050. */
  withdrawalFeePct: number;
  /** Minimum gross withdrawal amount (INR). */
  withdrawalMinInr: number;
  /**
   * 1x = recharge of ₹X requires ₹X wagered before that ₹X becomes withdrawable.
   * Initial balance / cashout winnings do NOT count toward wagerRequired.
   * (Referral rewards DO — credited via creditRecharge — to deter ref farming.)
   */
  wagerMultiplier: number;
  /**
   * Withdrawals at or above this gross INR auto-flagged for admin review
   * (held in `review` status; admin must Approve or Fail). 0 disables.
   * Catches outsized cashouts regardless of account age.
   */
  withdrawalReviewAboveInr: number;
  /**
   * If account age (hours) is below this AND the user is withdrawing,
   * auto-flag for review regardless of amount. 0 disables.
   */
  withdrawalReviewNewAccountHours: number;

  // ── Anti-abuse: registration ──
  /**
   * Max successful new-user registrations from a single IP per 24h.
   * Counts /register + /telegram + /guest. 0 disables the limit.
   * Real users virtually never create 3+ accounts/day; bot farms do.
   */
  registerMaxPerIp24h: number;

  updatedAt: Date;
  updatedBy?: string;
}

const SettingsSchema = new Schema<SettingsDoc>(
  {
    _id: { type: String, default: "default" },
    maxCrashMultiplier: { type: Number, required: true, min: 1.01 },
    houseEdge: { type: Number, required: true, min: 0, max: 0.5 },
    minBet: { type: Number, required: true, min: 0 },
    maxBet: { type: Number, required: true, min: 1 },
    initialBalance: { type: Number, required: true, min: 0 },
    cryptoMinUsdt: { type: Number, required: true, min: 0 },
    cryptoMaxUsdt: { type: Number, required: true, min: 1 },
    usdtInrRateFallback: { type: Number, required: true, min: 0.01 },
    botMinCount: { type: Number, required: true, min: 0, max: 50 },
    botMaxCount: { type: Number, required: true, min: 0, max: 100 },
    referralRewardInr: { type: Number, required: true, min: 0 },
    withdrawalFeePct: { type: Number, required: true, min: 0, max: 0.5 },
    withdrawalMinInr: { type: Number, required: true, min: 0 },
    wagerMultiplier: { type: Number, required: true, min: 0, max: 10 },
    withdrawalReviewAboveInr: { type: Number, required: true, min: 0 },
    withdrawalReviewNewAccountHours: { type: Number, required: true, min: 0 },
    registerMaxPerIp24h: { type: Number, required: true, min: 0, max: 100 },
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: String },
  },
  { _id: false },
);

export const SettingsModel = model<SettingsDoc>("Settings", SettingsSchema);
