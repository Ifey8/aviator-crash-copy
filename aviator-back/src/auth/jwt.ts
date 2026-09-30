import jwt from "jsonwebtoken";
import { config } from "../config";

export interface AuthPayload {
  userName: string;
  telegramId?: number;
  userType: boolean;
  /** Set only on tokens issued by /api/auth/admin-login (password + TOTP). */
  adm?: boolean;
}

export const signToken = (p: AuthPayload): string =>
  jwt.sign(p, config.jwtSecret, { expiresIn: "30d" });

export const signAdminToken = (userName: string): string =>
  jwt.sign({ userName, userType: false, adm: true }, config.jwtSecret, { expiresIn: "12h" });

export const verifyToken = (token: string): AuthPayload | null => {
  try {
    return jwt.verify(token, config.jwtSecret) as AuthPayload;
  } catch {
    return null;
  }
};
