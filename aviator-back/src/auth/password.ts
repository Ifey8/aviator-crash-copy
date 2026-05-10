import bcrypt from "bcryptjs";
import { UserModel, UserDoc } from "../db/models/User";
import { getSetting } from "../settings";
import { signToken } from "./jwt";

const BCRYPT_ROUNDS = 10;

export interface AuthResult {
  token: string;
  userName: string;
  isAdmin: boolean;
  balance: number;
  avatar: string;
  phone?: string;
}

const sanitizeUserName = (s: string): string => {
  // letters, digits, hyphen, underscore — 3–20 chars
  return s.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20);
};

const isValidPhone = (p?: string): boolean => {
  if (!p) return true; // phone optional
  // very loose — accept 10–15 digits, optional leading +
  return /^\+?\d{10,15}$/.test(p.replace(/\s/g, ""));
};

const toResult = (user: UserDoc): AuthResult => {
  const token = signToken({
    userName: user.userName,
    telegramId: user.telegramId,
    userType: user.userType,
  });
  return {
    token,
    userName: user.userName,
    isAdmin: !!user.isAdmin,
    balance: user.balance,
    avatar: user.avatar,
    phone: user.phone,
  };
};

const sanitizeAttr = (s?: string): string | undefined => {
  if (!s) return undefined;
  const cleaned = s.toString().replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
  return cleaned || undefined;
};

export const registerWithPassword = async (input: {
  userName: string;
  password: string;
  phone?: string;
  /** First-touch acquisition source (?sid=). Persisted only on creation. */
  sid?: string;
  /** First-touch referrer userName (?ref=). Persisted only on creation. */
  referrer?: string;
}): Promise<{ ok: true; result: AuthResult } | { ok: false; reason: string }> => {
  const userName = sanitizeUserName(input.userName);
  if (userName.length < 3) return { ok: false, reason: "Username must be 3–20 letters/digits/-/_" };
  if (!input.password || input.password.length < 6)
    return { ok: false, reason: "Password must be at least 6 characters" };
  if (!isValidPhone(input.phone))
    return { ok: false, reason: "Invalid phone number" };

  const existing = await UserModel.findOne({ userName });
  if (existing) return { ok: false, reason: "Username already taken" };

  if (input.phone) {
    const phoneTaken = await UserModel.findOne({ phone: input.phone });
    if (phoneTaken) return { ok: false, reason: "Phone already registered" };
  }

  const sid = sanitizeAttr(input.sid);
  let referrer = sanitizeAttr(input.referrer);
  if (referrer === userName) referrer = undefined;
  if (referrer) {
    const refUser = await UserModel.findOne({ userName: referrer });
    if (!refUser) referrer = undefined;
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await UserModel.create({
    userName,
    passwordHash,
    phone: input.phone,
    avatar: `av-${Math.floor(Math.random() * 8) + 1}.png`,
    // Live admin-tunable setting (admin Settings → "Initial balance"). Was
    // mistakenly using config.initialBalance (env, 1000) — admin's value
    // had no effect, so users could spam-register for free credits.
    balance: getSetting("initialBalance"),
    lastLoginAt: new Date(),
    sid,
    referrer,
  });

  return { ok: true, result: toResult(user) };
};

export const loginWithPassword = async (input: {
  userName: string;
  password: string;
}): Promise<{ ok: true; result: AuthResult } | { ok: false; reason: string }> => {
  const userName = sanitizeUserName(input.userName);
  if (!userName || !input.password) return { ok: false, reason: "Username + password required" };

  // Have to explicitly select passwordHash because the schema marks it select:false.
  const user = await UserModel.findOne({ userName }).select("+passwordHash");
  if (!user || !user.passwordHash) return { ok: false, reason: "Invalid credentials" };
  if (user.banned) return { ok: false, reason: `Account banned${user.bannedReason ? ": " + user.bannedReason : ""}` };

  const match = await bcrypt.compare(input.password, user.passwordHash);
  if (!match) return { ok: false, reason: "Invalid credentials" };

  user.lastLoginAt = new Date();
  await user.save();

  return { ok: true, result: toResult(user) };
};

/** Used by sockets to upgrade a token → AuthResult, with admin flag. */
export const profileFromUserName = async (userName: string): Promise<AuthResult | null> => {
  const user = await UserModel.findOne({ userName });
  if (!user) return null;
  return toResult(user);
};
