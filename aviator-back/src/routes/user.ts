import { Router } from "express";
import { BetModel } from "../db/models/Bet";
import { RoundModel } from "../db/models/Round";

export const userRouter = Router();

userRouter.post("/my-info", async (req, res) => {
  const name: string = req.body?.name || "";
  if (!name) return res.json({ status: false, data: [] });
  const bets = await BetModel.find({ userName: name }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({
    status: true,
    data: bets.map((b) => ({
      flyDetailID: b.roundId,
      betAmount: b.betAmount,
      cashOut: b.cashOutAt,
      cashAmount: b.cashAmount,
      crashPoint: b.crashPoint,
      result: b.cashouted ? "win" : "lose",
      date: b.createdAt,
    })),
  });
});

userRouter.get("/game/seed/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "bad id" });
  const round = await RoundModel.findOne({ roundId: id }).lean();
  if (!round) return res.status(404).json({ message: "not found" });
  res.json({
    flyDetailID: round.roundId,
    serverSeed: round.serverSeed,
    serverSeedHash: round.serverSeedHash,
    seedOfUsers: round.clientSeedPool ? round.clientSeedPool.split(",") : [],
    crashPoint: round.crashPoint,
    createdAt: round.createdAt,
  });
});
