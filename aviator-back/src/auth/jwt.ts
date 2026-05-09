import jwt from "jsonwebtoken";
import { config } from "../config";

export interface AuthPayload {
  userName: string;
  telegramId?: number;
  userType: boolean;
}

export const signToken = (p: AuthPayload): string =>
  jwt.sign(p, config.jwtSecret, { expiresIn: "30d" });

export const verifyToken = (token: string): AuthPayload | null => {
  try {
    return jwt.verify(token, config.jwtSecret) as AuthPayload;
  } catch {
    return null;
  }
};
