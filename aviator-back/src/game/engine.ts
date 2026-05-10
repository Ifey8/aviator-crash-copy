import { EventEmitter } from "events";
import { config } from "../config";
import {
  GamePhase,
  PlayerState,
  BettedUser,
  GameStatus,
  emptySide,
  BetIndex,
} from "./types";
import {
  RoundSeed,
  buildRoundSeed,
  multiplierAt,
  newServerSeed,
  timeForMultiplier,
} from "./provablyFair";
import { UserModel } from "../db/models/User";
import { RoundModel } from "../db/models/Round";
import { BetModel } from "../db/models/Bet";
import { bots } from "./bots";
import { getSetting } from "../settings";

const TICK_MS = 100;

export class GameEngine extends EventEmitter {
  phase: GamePhase = "BET";
  phaseStartedAt = Date.now();
  multiplier = 1.0;
  roundId = 0;
  seed: RoundSeed;
  players = new Map<string, PlayerState>();
  history: number[] = [];
  ticker: NodeJS.Timeout | null = null;
  /** Latest committed serverSeedHash (revealed before round starts). */
  upcomingSeedHash: string;
  /** seed reserved for next round */
  private nextSeed: { serverSeed: string; serverSeedHash: string };

  constructor() {
    super();
    const initial = newServerSeed();
    this.nextSeed = newServerSeed();
    this.upcomingSeedHash = initial.serverSeedHash;
    this.seed = buildRoundSeed(initial.serverSeed, "init", 0, getSetting("houseEdge"));
  }

  async start(): Promise<void> {
    const last = await RoundModel.findOne().sort({ roundId: -1 }).lean();
    this.roundId = last ? last.roundId + 1 : 1;
    // Restore the last N crash points so new users (and post-restart
    // sessions) see populated history chips instead of an empty bar.
    const recent = await RoundModel.find()
      .sort({ roundId: -1 })
      .limit(config.historyLength)
      .lean();
    this.history = recent.map((r) => r.crashPoint).filter((x): x is number => typeof x === "number");
    this.beginBetPhase();
  }

  // ------- Player session management -------

  addPlayer(p: PlayerState): void {
    this.players.set(p.userName, p);
    this.emit("playerJoined", p);
  }

  removePlayer(userName: string): void {
    this.players.delete(userName);
  }

  getPlayer(userName: string): PlayerState | undefined {
    return this.players.get(userName);
  }

  /**
   * Credit `amount` to a user's balance (for referral reward / admin grant /
   * withdrawal refund). Does NOT add to wagerRequired — those credits are
   * freely withdrawable.
   *
   * Updates in-memory PlayerState if they're online AND persists to Mongo.
   * Returns the new balance, or null if the user does not exist in Mongo.
   *
   * IMPORTANT: caller is responsible for idempotency (checking
   * RechargeOrder.status before invoking this), since we do not record
   * the source of credit here.
   */
  async creditBalance(userName: string, amount: number): Promise<number | null> {
    if (amount <= 0) return null;
    const updated = await UserModel.findOneAndUpdate(
      { userName },
      { $inc: { balance: amount } },
      { new: true },
    );
    if (!updated) return null;
    const p = this.players.get(userName);
    if (p) p.balance = updated.balance;
    return updated.balance;
  }

  /**
   * Credit a recharge: balance += amount AND wagerRequired += amount × multiplier.
   * The recharged money is locked behind playthrough; only after the user
   * wagers `amount × multiplier` does it become withdrawable.
   *
   * Idempotency is the caller's responsibility (recharge order status flip).
   */
  async creditRecharge(userName: string, amount: number): Promise<number | null> {
    if (amount <= 0) return null;
    const wagerAdd = +(amount * Number(getSetting("wagerMultiplier") || 1)).toFixed(2);
    const updated = await UserModel.findOneAndUpdate(
      { userName },
      { $inc: { balance: amount, wagerRequired: wagerAdd } },
      { new: true },
    );
    if (!updated) return null;
    const p = this.players.get(userName);
    if (p) {
      p.balance = updated.balance;
      p.wagerRequired = updated.wagerRequired || 0;
    }
    return updated.balance;
  }

  /**
   * Atomically debit a user's balance for a pending withdrawal. Reserves the
   * funds so subsequent bets can't double-spend the same money.
   *
   *   • Checks balance >= deduct AND withdrawable (= balance − wagerRequired) >= net
   *   • On success: balance -= deduct, returns new balance
   *   • On insufficient: returns null (caller surfaces the right reason)
   *
   * The split between `deduct` (gross + fee) and `net` (gross) lets the caller
   * apply different rules — currently both must be ≤ withdrawable.
   */
  async reserveForWithdrawal(
    userName: string,
    deduct: number,
    net: number,
  ): Promise<{ balance: number; wagerRequired: number } | null> {
    if (deduct <= 0 || net <= 0) return null;
    // Withdrawable = balance − wagerRequired ≥ deduct (gross + fee).
    // Using aggregation-pipeline updateOne for atomic check+set.
    const result = await UserModel.findOneAndUpdate(
      {
        userName,
        balance: { $gte: deduct },
        $expr: { $gte: [{ $subtract: ["$balance", "$wagerRequired"] }, deduct] },
      },
      { $inc: { balance: -deduct } },
      { new: true },
    );
    if (!result) return null;
    const p = this.players.get(userName);
    if (p) p.balance = result.balance;
    return { balance: result.balance, wagerRequired: result.wagerRequired || 0 };
  }

  /** Refund a previously-reserved withdrawal (on cancel / failure). */
  async refundWithdrawal(userName: string, amount: number): Promise<number | null> {
    if (amount <= 0) return null;
    const updated = await UserModel.findOneAndUpdate(
      { userName },
      { $inc: { balance: amount } },
      { new: true },
    );
    if (!updated) return null;
    const p = this.players.get(userName);
    if (p) p.balance = updated.balance;
    return updated.balance;
  }

  // ------- Bet handling -------

  async placeBet(
    userName: string,
    index: BetIndex,
    betAmount: number,
    target: number,
    auto: boolean,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.phase !== "BET") return { ok: false, reason: "Bets are closed" };

    const p = this.players.get(userName);
    if (!p) return { ok: false, reason: "Player not in room" };

    const minB = getSetting("minBet");
    const maxB = getSetting("maxBet");
    if (betAmount < minB || betAmount > maxB)
      return { ok: false, reason: `Bet must be ${minB}–${maxB}` };

    if (p[index].betted) return { ok: false, reason: "Already betted this round" };
    if (p.balance < betAmount) return { ok: false, reason: "Insufficient balance" };

    p.balance -= betAmount;
    p.wagerRequired = Math.max(0, +(p.wagerRequired - betAmount).toFixed(2));
    p[index] = {
      ...emptySide(),
      betted: true,
      betAmount,
      target: target > 1 ? target : 2,
      auto,
    };

    // Aggregation-pipeline update: balance := new balance,
    // wagerRequired := max(0, old - betAmount). Single atomic write.
    await UserModel.updateOne({ userName }, [
      {
        $set: {
          balance: p.balance,
          wagerRequired: {
            $max: [0, { $subtract: ["$wagerRequired", betAmount] }],
          },
        },
      },
    ]);
    this.emit("betPlaced", p);
    return { ok: true };
  }

  cashOut(userName: string, index: BetIndex, endTarget: number): { ok: boolean; reason?: string } {
    if (this.phase !== "PLAYING") return { ok: false, reason: "Round not active" };
    const p = this.players.get(userName);
    if (!p) return { ok: false, reason: "Player not in room" };
    const side = p[index];
    if (!side.betted || side.cashouted) return { ok: false, reason: "Nothing to cash out" };

    const at = Math.min(endTarget || this.multiplier, this.multiplier);
    if (at < 1.01) return { ok: false, reason: "Too early" };

    side.cashouted = true;
    side.cashOutAt = at;
    side.cashAmount = +(side.betAmount * at).toFixed(2);
    p.balance = +(p.balance + side.cashAmount).toFixed(2);

    UserModel.updateOne({ userName }, { $set: { balance: p.balance } }).catch(() => {});
    // Emit with side index so the socket layer can send success + myInfo
    // to the right player (especially important for engine-driven auto-cashout
    // where the user did not initiate the request from a socket handler).
    this.emit("cashOut", p, index);
    return { ok: true };
  }

  // ------- Phase machine -------

  private beginBetPhase(): void {
    this.phase = "BET";
    this.phaseStartedAt = Date.now();
    this.multiplier = 1.0;

    // Reset per-round bet sides on every player
    for (const p of this.players.values()) {
      p.f = emptySide();
      p.s = emptySide();
    }

    // Use last round's seed as committed; rotate next
    const sd = this.nextSeed;
    this.upcomingSeedHash = sd.serverSeedHash;
    const clientPool = [...this.players.keys()].sort().join(",") || "house";
    this.seed = buildRoundSeed(sd.serverSeed, clientPool, this.roundId, getSetting("houseEdge"));
    this.nextSeed = newServerSeed();

    // Schedule bot players to join during this BET phase. They appear in
    // bettedUsersSnapshot, broadcast via the bot event handlers in sockets/.
    bots.beginRound(this.players.size, config.betDurationMs);

    this.emit("phaseChange", this.statusSnapshot());

    setTimeout(() => this.beginPlayingPhase(), config.betDurationMs);
  }

  private beginPlayingPhase(): void {
    this.phase = "PLAYING";
    this.phaseStartedAt = Date.now();

    if (this.ticker) clearInterval(this.ticker);
    this.ticker = setInterval(() => this.tick(), TICK_MS);
    this.emit("phaseChange", this.statusSnapshot());
  }

  private tick(): void {
    const elapsed = (Date.now() - this.phaseStartedAt) / 1000;
    this.multiplier = +multiplierAt(elapsed).toFixed(2);

    // Auto-cashout
    for (const p of this.players.values()) {
      for (const idx of ["f", "s"] as BetIndex[]) {
        const s = p[idx];
        if (s.betted && !s.cashouted && s.auto && s.target > 1 && this.multiplier >= s.target) {
          this.cashOut(p.userName, idx, s.target);
        }
      }
    }

    // Bot cashouts. Each bot has a pre-set target; if reached + willCashOut,
    // bots.tick() flips it to cashouted and emits botCashout — sockets/index.ts
    // hooks that to broadcast bettedUserInfo so all clients animate parachutes.
    bots.tick(this.multiplier);

    if (this.multiplier >= this.seed.crashPoint) {
      this.endRound();
      return;
    }
    this.emit("tick", this.statusSnapshot());
  }

  private async endRound(): Promise<void> {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.multiplier = +this.seed.crashPoint.toFixed(2);
    this.phase = "GAMEEND";
    bots.endRound();
    this.emit("phaseChange", this.statusSnapshot());

    const previousHand: PlayerState[] = [];
    const roundBets = [];
    for (const p of this.players.values()) {
      const snapshot: PlayerState = JSON.parse(JSON.stringify(p));
      previousHand.push(snapshot);
      for (const idx of ["f", "s"] as BetIndex[]) {
        const side = p[idx];
        if (side.betted) {
          roundBets.push({
            userName: p.userName,
            betAmount: side.betAmount,
            cashouted: side.cashouted,
            cashOutAt: side.cashOutAt,
            cashAmount: side.cashAmount,
            index: idx,
          });
          BetModel.create({
            userName: p.userName,
            roundId: this.roundId,
            betAmount: side.betAmount,
            cashouted: side.cashouted,
            cashOutAt: side.cashOutAt,
            cashAmount: side.cashAmount,
            crashPoint: this.seed.crashPoint,
            index: idx,
          }).catch(() => {});
        }
      }
    }

    RoundModel.create({
      roundId: this.roundId,
      serverSeed: this.seed.serverSeed,
      serverSeedHash: this.seed.serverSeedHash,
      clientSeedPool: this.seed.clientSeed,
      nonce: this.seed.nonce,
      crashPoint: this.seed.crashPoint,
      bets: roundBets,
    }).catch(() => {});

    this.history = [this.seed.crashPoint, ...this.history].slice(0, config.historyLength);
    this.emit("roundEnded", { previousHand, history: this.history, crashPoint: this.seed.crashPoint });

    this.roundId += 1;
    setTimeout(() => this.beginBetPhase(), config.settleDurationMs);
  }

  // ------- Snapshots -------

  statusSnapshot(): GameStatus {
    return {
      GameState: this.phase,
      time: Math.max(0, Math.floor((Date.now() - this.phaseStartedAt) / 1000)),
      currentNum: this.multiplier.toFixed(2),
      currentSecondNum: this.multiplier,
    };
  }

  bettedUsersSnapshot(): BettedUser[] {
    const out: BettedUser[] = [];
    for (const p of this.players.values()) {
      for (const idx of ["f", "s"] as BetIndex[]) {
        const s = p[idx];
        if (s.betted) {
          out.push({
            userName: p.userName,
            avatar: p.avatar,
            betAmount: s.betAmount,
            cashAmount: s.cashAmount,
            cashouted: s.cashouted,
            cashOutAt: s.cashOutAt,
            target: s.target,
          });
        }
      }
    }
    // Append bot bets so the bets list / FxLayer cashout-detection sees them.
    for (const b of bots.snapshot()) out.push(b);
    return out;
  }
}

export const engine = new GameEngine();
