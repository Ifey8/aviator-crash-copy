import { Schema, model, Document } from "mongoose";

export interface UserDoc extends Document {
  telegramId?: number;
  userName: string;
  avatar: string;
  balance: number;
  userType: boolean;
  clientSeed: string;

  // Password-based auth (Sprint 1). All optional for backward compat with
  // legacy guest / Telegram users that have no password.
  passwordHash?: string;
  phone?: string;
  email?: string;

  // Admin role gates the /api/admin/* routes (Sprint 2).
  isAdmin: boolean;

  // Soft-delete / banning so admin can disable an account without
  // dropping rows.
  banned: boolean;
  bannedReason?: string;

  createdAt: Date;
  lastLoginAt?: Date;
}

const UserSchema = new Schema<UserDoc>({
  telegramId: { type: Number, index: true, unique: true, sparse: true },
  userName: { type: String, required: true, index: true, unique: true },
  avatar: { type: String, default: "av-1.png" },
  balance: { type: Number, default: 1000 },
  userType: { type: Boolean, default: false },
  clientSeed: { type: String, default: "" },

  passwordHash: { type: String, select: false },
  phone: { type: String, index: true, sparse: true },
  email: { type: String, index: true, sparse: true },

  isAdmin: { type: Boolean, default: false, index: true },

  banned: { type: Boolean, default: false, index: true },
  bannedReason: { type: String },

  createdAt: { type: Date, default: Date.now },
  lastLoginAt: { type: Date },
});

export const UserModel = model<UserDoc>("User", UserSchema);
