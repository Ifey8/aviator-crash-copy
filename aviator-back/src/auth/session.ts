import { config } from "../config";
import { getSetting } from "../settings";
import { UserModel } from "../db/models/User";
import { signToken, verifyToken, AuthPayload } from "./jwt";
import { validateInitData } from "./telegram";

export interface AuthResult {
  token: string;
  userName: string;
  telegramId?: number;
  userType: boolean;
  balance: number;
  avatar: string;
}

const sanitizeUserName = (s: string): string =>
  s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || `guest${Math.floor(Math.random() * 9999)}`;

const sanitizeAttribution = (s?: string): string | undefined => {
  if (!s) return undefined;
  // Allow letters/digits/_/-/. up to 64 chars (e.g. "facebook", "google_q4", a userName).
  const cleaned = s.toString().replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64);
  return cleaned || undefined;
};

const upsertUser = async (input: {
  telegramId?: number;
  userName: string;
  avatar?: string;
  /** Acquisition source (e.g. "facebook"). First-touch — ignored if user already exists. */
  sid?: string;
  /** Referrer userName from `?ref=` URL. First-touch — ignored if user exists OR if it's themselves. */
  referrer?: string;
}) => {
  const userName = sanitizeUserName(input.userName);
  let user = input.telegramId
    ? await UserModel.findOne({ telegramId: input.telegramId })
    : await UserModel.findOne({ userName });
  if (!user) {
    const sid = sanitizeAttribution(input.sid);
    let referrer = sanitizeAttribution(input.referrer);
    // Self-referral guard
    if (referrer && referrer === userName) referrer = undefined;
    // Validate referrer exists (silently drop if not)
    if (referrer) {
      const refUser = await UserModel.findOne({ userName: referrer });
      if (!refUser) referrer = undefined;
    }
    user = await UserModel.create({
      telegramId: input.telegramId,
      userName,
      avatar: input.avatar || `av-${Math.floor(Math.random() * 8) + 1}.png`,
      balance: getSetting("initialBalance"),
      sid,
      referrer,
    });
  }
  return user;
};

export const authWithTelegram = async (
  initData: string,
  attribution?: { sid?: string; referrer?: string },
): Promise<AuthResult | null> => {
  const v = validateInitData(initData);
  if (!v.ok) return null;
  const tg = v.user;
  const baseName = tg.username || tg.first_name || `tg${tg.id}`;
  const user = await upsertUser({
    telegramId: tg.id,
    userName: baseName,
    avatar: tg.photo_url ? "av-1.png" : undefined,
    sid: attribution?.sid,
    referrer: attribution?.referrer,
  });
  const token = signToken({
    userName: user.userName,
    telegramId: user.telegramId,
    userType: user.userType,
  });
  return {
    token,
    userName: user.userName,
    telegramId: user.telegramId,
    userType: user.userType,
    balance: user.balance,
    avatar: user.avatar,
  };
};

export const authDevGuest = async (
  name?: string,
  attribution?: { sid?: string; referrer?: string },
): Promise<AuthResult> => {
  const userName = sanitizeUserName(name || `guest${Math.floor(Math.random() * 9999)}`);
  const user = await upsertUser({
    userName,
    sid: attribution?.sid,
    referrer: attribution?.referrer,
  });
  const token = signToken({
    userName: user.userName,
    userType: user.userType,
  });
  return {
    token,
    userName: user.userName,
    userType: user.userType,
    balance: user.balance,
    avatar: user.avatar,
  };
};

export const authFromToken = async (token: string): Promise<AuthResult | null> => {
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = await UserModel.findOne({ userName: payload.userName });
  if (!user) return null;
  return {
    token,
    userName: user.userName,
    telegramId: user.telegramId,
    userType: user.userType,
    balance: user.balance,
    avatar: user.avatar,
  };
};
