import { EventEmitter } from "events";
import { BettedUser, BetIndex } from "./types";

/**
 * BotManager — virtual players that bet + cash out alongside real users so
 * the room never feels empty. Pure in-memory; no DB hits.
 *
 * Lifecycle (driven by GameEngine phase transitions):
 *   • beginRound(realPlayerCount) — clears prior bots, schedules new bots to
 *     "join" at staggered delays during the 5s BET phase.
 *   • tick(multiplier)            — called from engine.tick(); returns true if
 *     any bot cashed out so the engine can broadcast bettedUserInfo.
 *   • endRound()                  — cancel any pending join timers (bots stay
 *     in the snapshot through GAMEEND so the previousHand UI shows them).
 *
 * Distribution tuning:
 *   - bet amount: 70% small (10-50), 25% mid (100-200), 5% large (500-1000)
 *   - target:     35% 1.2-1.8x, 35% 1.8-3x, 15% 3-5x, 8% 5-10x, 4% 10-50x,
 *                 3% hold-and-crash (no cashout — they "lose")
 *   - count:      12 bots when alone, 8 with 1-2 reals, 4 with 3+ reals
 */

// Realistic-sounding handles. Mask in UI hides most chars anyway.
const FIRST_NAMES = [
  "Aarav", "Vivaan", "Aditya", "Krishna", "Arjun", "Reyansh", "Ayaan",
  "Ishaan", "Vihaan", "Dhruv", "Atharv", "Devansh", "Kabir", "Yash",
  "Karan", "Rohan", "Diya", "Saanvi", "Aanya", "Pari", "Zara", "Riya",
  "Anika", "Avani", "Myra", "Ira", "Kiara", "Aisha", "Tara", "Nia",
  "Manish", "Suresh", "Pooja", "Neha", "Sanjay", "Rakesh", "Geeta",
  "Vikram", "Anil", "Deepak", "Ramesh", "Sunita", "Meera", "Lakshmi",
];

const AVATAR_POOL = ["av-1.png", "av-2.png", "av-3.png", "av-4.png", "av-5.png", "av-6.png", "av-7.png", "av-8.png"];

interface BotSide {
  betted: boolean;
  cashouted: boolean;
  betAmount: number;
  cashAmount: number;
  cashOutAt: number;
  target: number;
  willCashOut: boolean;
}

interface Bot {
  userName: string;
  avatar: string;
  isBot: true;
  f: BotSide;
  s: BotSide;
}

const emptyBotSide = (): BotSide => ({
  betted: false,
  cashouted: false,
  betAmount: 0,
  cashAmount: 0,
  cashOutAt: 0,
  target: 0,
  willCashOut: false,
});

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const weightedAmount = (): number => {
  const r = Math.random();
  if (r < 0.7) {
    const opts = [10, 20, 30, 50];
    return pick(opts);
  }
  if (r < 0.95) {
    const opts = [100, 150, 200];
    return pick(opts);
  }
  return pick([500, 1000]);
};

const weightedTarget = (): { target: number; willCashOut: boolean } => {
  const r = Math.random();
  if (r < 0.03) return { target: 0, willCashOut: false }; // crash holder
  if (r < 0.38) return { target: 1.2 + Math.random() * 0.6, willCashOut: true };
  if (r < 0.73) return { target: 1.8 + Math.random() * 1.2, willCashOut: true };
  if (r < 0.88) return { target: 3 + Math.random() * 2, willCashOut: true };
  if (r < 0.96) return { target: 5 + Math.random() * 5, willCashOut: true };
  return { target: 10 + Math.random() * 40, willCashOut: true };
};

const makeName = (): string => {
  const first = pick(FIRST_NAMES);
  const tail = Math.floor(Math.random() * 9999);
  return `${first}${tail}`;
};

export class BotManager extends EventEmitter {
  private bots = new Map<string, Bot>();
  private joinTimers: NodeJS.Timeout[] = [];

  /** Bots currently visible in the room (snapshot includes their bets). */
  size(): number {
    return this.bots.size;
  }

  /** Called when engine enters BET phase. */
  beginRound(realPlayerCount: number, betDurationMs: number): void {
    this.clearTimers();
    this.bots.clear();
    const targetCount =
      realPlayerCount < 1 ? 9 + Math.floor(Math.random() * 5) :  // 9-13 alone
      realPlayerCount < 3 ? 6 + Math.floor(Math.random() * 4) :  // 6-9 with 1-2
      3 + Math.floor(Math.random() * 3);                          // 3-5 with 3+
    for (let i = 0; i < targetCount; i++) {
      // Stagger joins so the bet list grows over the BET phase, not all at once.
      const delay = Math.random() * (betDurationMs - 400);
      const t = setTimeout(() => this.spawnBot(), delay);
      this.joinTimers.push(t);
    }
  }

  /** Engine PLAYING-phase tick. Returns true if any bot cashed out. */
  tick(multiplier: number): boolean {
    let any = false;
    for (const bot of this.bots.values()) {
      for (const idx of ["f", "s"] as BetIndex[]) {
        const s = bot[idx];
        if (!s.betted || s.cashouted || !s.willCashOut) continue;
        if (multiplier >= s.target) {
          s.cashouted = true;
          s.cashOutAt = +s.target.toFixed(2);
          s.cashAmount = +(s.betAmount * s.target).toFixed(2);
          this.emit("botCashout", bot, idx);
          any = true;
        }
      }
    }
    return any;
  }

  /** Engine round-end. */
  endRound(): void {
    this.clearTimers();
    // Keep bots in the snapshot through GAMEEND so previousHand displays them.
  }

  /** Merge bot bets into bettedUsersSnapshot. */
  snapshot(): BettedUser[] {
    const out: BettedUser[] = [];
    for (const b of this.bots.values()) {
      for (const idx of ["f", "s"] as BetIndex[]) {
        const s = b[idx];
        if (!s.betted) continue;
        out.push({
          userName: b.userName,
          avatar: b.avatar,
          betAmount: s.betAmount,
          cashAmount: s.cashAmount,
          cashouted: s.cashouted,
          cashOutAt: s.cashOutAt,
          target: s.target,
        });
      }
    }
    return out;
  }

  private spawnBot(): void {
    const userName = this.uniqueName();
    const avatar = pick(AVATAR_POOL);
    const f = emptyBotSide();
    f.betted = true;
    f.betAmount = weightedAmount();
    const tt = weightedTarget();
    f.target = +tt.target.toFixed(2);
    f.willCashOut = tt.willCashOut;
    const bot: Bot = {
      userName,
      avatar,
      isBot: true,
      f,
      s: emptyBotSide(),
    };
    // ~12% chance of also betting on the second side, with independent target
    if (Math.random() < 0.12) {
      const s = emptyBotSide();
      s.betted = true;
      s.betAmount = weightedAmount();
      const tt2 = weightedTarget();
      s.target = +tt2.target.toFixed(2);
      s.willCashOut = tt2.willCashOut;
      bot.s = s;
    }
    this.bots.set(userName, bot);
    this.emit("botJoined", bot);
  }

  private uniqueName(): string {
    let candidate = makeName();
    let attempts = 0;
    while (this.bots.has(candidate) && attempts < 8) {
      candidate = makeName();
      attempts++;
    }
    return candidate;
  }

  private clearTimers(): void {
    for (const t of this.joinTimers) clearTimeout(t);
    this.joinTimers = [];
  }
}

export const bots = new BotManager();
