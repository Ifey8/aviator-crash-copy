import { Schema, model, Document } from "mongoose";

export interface BetDoc extends Document {
  userName: string;
  roundId: number;
  betAmount: number;
  cashouted: boolean;
  cashOutAt: number;
  cashAmount: number;
  crashPoint: number;
  index: "f" | "s";
  createdAt: Date;
}

const BetSchema = new Schema<BetDoc>({
  userName: { type: String, required: true, index: true },
  roundId: { type: Number, required: true, index: true },
  betAmount: { type: Number, required: true },
  cashouted: { type: Boolean, default: false },
  cashOutAt: { type: Number, default: 0 },
  cashAmount: { type: Number, default: 0 },
  crashPoint: { type: Number, default: 0 },
  index: { type: String, enum: ["f", "s"], required: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

export const BetModel = model<BetDoc>("Bet", BetSchema);
