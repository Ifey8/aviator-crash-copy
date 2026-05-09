/**
 * Server unit economics simulation:
 *   gross gambling revenue (GGR) - payment cost - CAC = net profit
 *
 * Costs assumed:
 *   - Deposit channel takes 10% of every deposit
 *   - User acquisition cost (CAC) = 100 INR per registered user
 *   - House edge = 3% (config default)
 *
 * Run:  npx ts-node tests/sim-business.ts
 */
import { randomBytes } from "crypto";
import { computeCrashPoint } from "../src/game/provablyFair";

const HOUSE_EDGE = 0.03;
const PAYMENT_COST = 0.10;
const CAC = 100;

// --------------------------------------------------------------------
// Part 1: analytical per-user breakeven
// --------------------------------------------------------------------
console.log(`\n══════════════════════════════════════════════════════`);
console.log(`  Part 1 · Per-user breakeven (analytical)`);
console.log(`══════════════════════════════════════════════════════`);
console.log(`Costs:`);
console.log(`  payment fee    = 10% of deposit`);
console.log(`  CAC            = 100 INR per user (one-time)`);
console.log(`  house edge     =  3% of total wagered\n`);
console.log(`Per-user profit = 0.03·turnover − 0.10·deposit − 100`);
console.log(`Breakeven turnover  T* = (0.10·D + 100) / 0.03\n`);
console.log(`┌──────────────┬──────────────────┬───────────────────┐`);
console.log(`│   Deposit    │  Breakeven       │  Required wagering│`);
console.log(`│   (INR)      │  turnover (INR)  │  multiple of D    │`);
console.log(`├──────────────┼──────────────────┼───────────────────┤`);
for (const D of [100, 500, 1000, 2000, 5000, 10000, 50000, 100000]) {
  const T = (0.10 * D + CAC) / HOUSE_EDGE;
  const ratio = T / D;
  console.log(
    `│ ${D.toString().padStart(10)}   ` +
    `│ ${Math.round(T).toLocaleString().padStart(13)}    ` +
    `│ ${ratio.toFixed(1).padStart(7)}× of D     │`,
  );
}
console.log(`└──────────────┴──────────────────┴───────────────────┘`);
console.log(`\n  • Smaller deposits need MUCH higher relative turnover to repay`);
console.log(`    the fixed 100-INR CAC. Tiny deposits often lose money.`);
console.log(`  • Once D × 0.03 ≥ 0.10·D + 100 / D, scale wins.`);

// --------------------------------------------------------------------
// Part 2: realistic scenarios across player profiles
// --------------------------------------------------------------------
interface Profile {
  name: string;
  share: number; // fraction of population
  depositMin: number;
  depositMax: number;
  turnoverMin: number; // multiple of deposit
  turnoverMax: number;
  target: number; // chosen cashout target
  betPct: number; // each bet is this fraction of deposit
}

const profiles: Profile[] = [
  { name: "Drop-off  (open app, no deposit)", share: 0.45, depositMin: 0,    depositMax: 0,    turnoverMin: 0,  turnoverMax: 0,  target: 1.5, betPct: 0    },
  { name: "Tester    (one tiny deposit)",     share: 0.25, depositMin: 100,  depositMax: 300,  turnoverMin: 1,  turnoverMax: 3,  target: 1.5, betPct: 0.10 },
  { name: "Casual    (regular small)",        share: 0.18, depositMin: 300,  depositMax: 1500, turnoverMin: 4,  turnoverMax: 12, target: 2.0, betPct: 0.05 },
  { name: "Regular   (medium engaged)",       share: 0.08, depositMin: 1500, depositMax: 8000, turnoverMin: 15, turnoverMax: 40, target: 2.0, betPct: 0.05 },
  { name: "Whale     (high engagement)",      share: 0.04, depositMin: 8000, depositMax: 50000, turnoverMin: 50, turnoverMax: 200, target: 1.5, betPct: 0.02 },
];
const totalShare = profiles.reduce((a, p) => a + p.share, 0);
if (Math.abs(totalShare - 1) > 0.001) {
  throw new Error(`profile shares must sum to 1, got ${totalShare}`);
}

const POPULATION = 10_000;
const serverSeed = randomBytes(32).toString("hex");
let nonce = 0;

interface Tally {
  users: number;
  totalDeposit: number;
  totalWagered: number;
  totalGGR: number;
  totalPaymentCost: number;
  totalCAC: number;
  totalNet: number;
  losingUsers: number; // users that lost money
  winningUsers: number; // users that won money
  serverWinningUsers: number; // users where server made > 0 net
}

const tallyBy: Record<string, Tally> = {};
const totalTally: Tally = {
  users: 0, totalDeposit: 0, totalWagered: 0, totalGGR: 0,
  totalPaymentCost: 0, totalCAC: 0, totalNet: 0,
  losingUsers: 0, winningUsers: 0, serverWinningUsers: 0,
};

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

console.log(`\n══════════════════════════════════════════════════════`);
console.log(`  Part 2 · Population sim — ${POPULATION.toLocaleString()} users`);
console.log(`══════════════════════════════════════════════════════`);

for (const p of profiles) {
  tallyBy[p.name] = { users: 0, totalDeposit: 0, totalWagered: 0, totalGGR: 0,
    totalPaymentCost: 0, totalCAC: 0, totalNet: 0,
    losingUsers: 0, winningUsers: 0, serverWinningUsers: 0 };
}

const t0 = Date.now();
for (let u = 0; u < POPULATION; u++) {
  // Pick profile by share
  let r = Math.random();
  let prof: Profile = profiles[profiles.length - 1];
  for (const p of profiles) {
    if (r < p.share) { prof = p; break; }
    r -= p.share;
  }

  const t = tallyBy[prof.name];
  t.users++;
  totalTally.users++;
  totalTally.totalCAC += CAC;
  t.totalCAC += CAC;

  if (prof.depositMax === 0) {
    // Drop-off — only CAC, no deposit, no GGR
    totalTally.totalNet += -CAC;
    t.totalNet += -CAC;
    t.losingUsers++; // server's perspective: lost CAC
    continue;
  }

  const deposit = Math.round(rand(prof.depositMin, prof.depositMax));
  const turnoverMult = rand(prof.turnoverMin, prof.turnoverMax);
  const targetWagered = deposit * turnoverMult;
  const betSize = Math.max(1, Math.round(deposit * prof.betPct));

  let balance = deposit;
  let wagered = 0;
  let userPnL = 0;
  let nRounds = 0;

  // Play rounds until either: target wagered hit, or balance < betSize
  while (wagered < targetWagered && balance >= betSize) {
    nonce++;
    const cp = computeCrashPoint(serverSeed, "biz", nonce, HOUSE_EDGE);
    wagered += betSize;
    if (cp >= prof.target) {
      const winnings = betSize * prof.target;
      balance = balance - betSize + winnings;
      userPnL += betSize * (prof.target - 1);
    } else {
      balance -= betSize;
      userPnL -= betSize;
    }
    nRounds++;
    if (nRounds > 50_000) break; // safety
  }

  const ggr = -userPnL; // server gets the negative of player P&L
  const paymentCost = deposit * PAYMENT_COST;
  const net = ggr - paymentCost - CAC;

  t.totalDeposit += deposit;
  t.totalWagered += wagered;
  t.totalGGR += ggr;
  t.totalPaymentCost += paymentCost;
  t.totalNet += net;
  if (net < 0) t.losingUsers++; else { t.winningUsers++; t.serverWinningUsers++; }

  totalTally.totalDeposit += deposit;
  totalTally.totalWagered += wagered;
  totalTally.totalGGR += ggr;
  totalTally.totalPaymentCost += paymentCost;
  totalTally.totalNet += net;
  if (net < 0) totalTally.losingUsers++; else { totalTally.winningUsers++; totalTally.serverWinningUsers++; }
}
const ms = Date.now() - t0;

console.log(`Sim time: ${ms} ms\n`);

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

console.log(`┌────────────────────────────────────┬────────┬───────────────┬───────────────┬───────────────┬────────────────────┐`);
console.log(`│ Profile                            │ Users  │   Deposits    │    Wagered    │      GGR      │   Net (server)     │`);
console.log(`├────────────────────────────────────┼────────┼───────────────┼───────────────┼───────────────┼────────────────────┤`);
for (const p of profiles) {
  const t = tallyBy[p.name];
  console.log(
    `│ ${p.name.padEnd(34)} ` +
    `│ ${t.users.toString().padStart(6)} ` +
    `│ ${fmt(t.totalDeposit).padStart(13)} ` +
    `│ ${fmt(t.totalWagered).padStart(13)} ` +
    `│ ${fmt(t.totalGGR).padStart(13)} ` +
    `│ ${fmt(t.totalNet).padStart(15)}    │`,
  );
}
console.log(`├────────────────────────────────────┼────────┼───────────────┼───────────────┼───────────────┼────────────────────┤`);
console.log(
  `│ ${"TOTAL".padEnd(34)} ` +
  `│ ${totalTally.users.toString().padStart(6)} ` +
  `│ ${fmt(totalTally.totalDeposit).padStart(13)} ` +
  `│ ${fmt(totalTally.totalWagered).padStart(13)} ` +
  `│ ${fmt(totalTally.totalGGR).padStart(13)} ` +
  `│ ${fmt(totalTally.totalNet).padStart(15)}    │`,
);
console.log(`└────────────────────────────────────┴────────┴───────────────┴───────────────┴───────────────┴────────────────────┘`);

console.log(`\nCost breakdown (server side):`);
console.log(`  Total CAC paid           : ${fmt(totalTally.totalCAC)} INR  (${POPULATION} users × 100)`);
console.log(`  Total payment cost (10%) : ${fmt(totalTally.totalPaymentCost)} INR`);
console.log(`  Total GGR (3% of wager)  : ${fmt(totalTally.totalGGR)} INR`);
console.log(`  ────────────────────────────────────────`);
console.log(`  Net profit               : ${fmt(totalTally.totalNet)} INR`);
console.log(`  ARPU (revenue/user)      : ${(totalTally.totalGGR / POPULATION).toFixed(2)} INR`);
console.log(`  ARPPU (revenue/paying)   : ${(totalTally.totalGGR / (POPULATION - tallyBy["Drop-off  (open app, no deposit)"].users)).toFixed(2)} INR`);
console.log(`  Net per user             : ${(totalTally.totalNet / POPULATION).toFixed(2)} INR`);
console.log(``);
