import { Schema, model, Document } from "mongoose";

export interface RoundBet {
  userName: string;
  betAmount: number;
  cashouted: boolean;
  cashOutAt: number;
  cashAmount: number;
  index: "f" | "s";
}

export interface RoundDoc extends Document {
  roundId: number;
  serverSeed: string;
  serverSeedHash: string;
  clientSeedPool: string;
  nonce: number;
  crashPoint: number;
  bets: RoundBet[];
  createdAt: Date;
}

const RoundSchema = new Schema<RoundDoc>({
  roundId: { type: Number, required: true, unique: true, index: true },
  serverSeed: { type: String, required: true },
  serverSeedHash: { type: String, required: true },
  clientSeedPool: { type: String, default: "" },
  nonce: { type: Number, required: true },
  crashPoint: { type: Number, required: true },
  bets: [
    {
      userName: String,
      betAmount: Number,
      cashouted: Boolean,
      cashOutAt: Number,
      cashAmount: Number,
      index: String,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

export const RoundModel = model<RoundDoc>("Round", RoundSchema);
