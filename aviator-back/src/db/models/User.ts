import { Schema, model, Document } from "mongoose";

export interface UserDoc extends Document {
  telegramId?: number;
  userName: string;
  avatar: string;
  balance: number;
  userType: boolean;
  clientSeed: string;
  createdAt: Date;
}

const UserSchema = new Schema<UserDoc>({
  telegramId: { type: Number, index: true, unique: true, sparse: true },
  userName: { type: String, required: true, index: true },
  avatar: { type: String, default: "av-1.png" },
  balance: { type: Number, default: 1000 },
  userType: { type: Boolean, default: false },
  clientSeed: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
});

export const UserModel = model<UserDoc>("User", UserSchema);
