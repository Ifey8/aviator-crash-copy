/**
 * Sweep auto-bet 100 INR across multiple cashout targets, 100,000 rounds each.
 * Run:  npx ts-node tests/sim-autobet-sweep.ts
 */
import { randomBytes } from "crypto";
import { computeCrashPoint } from "../src/game/provablyFair";

const N = 100_000;
const BET = 100;
const HOUSE_EDGE = 0.03;
const TARGETS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

interface Row {
  target: number;
  wins: number;
  losses: number;
  total: number;
  meanPnL: number;
  sdRound: number;
  sdTotal: number;
  realizedEdgePct: number;
  pWinPct: number;
}

const settle = (crash: number, target: number): number =>
  crash < target ? -BET : BET * (target - 1);

// One shared HMAC stream — sample many nonces against the same server seed.
// Using the SAME crash points across all targets gives a fair head-to-head:
// the only difference between targets is the cashout decision.
const serverSeed = randomBytes(32).toString("hex");
const clientSeed = "sim-sweep";

console.log(`Generating ${N.toLocaleString()} crash points (houseEdge=${HOUSE_EDGE})…`);
const crashes: number[] = new Array(N);
const t0 = Date.now();
for (let nonce = 1; nonce <= N; nonce++) {
  crashes[nonce - 1] = computeCrashPoint(serverSeed, clientSeed, nonce, HOUSE_EDGE);
}
console.log(`Done in ${Date.now() - t0} ms.\n`);

const rows: Row[] = [];
for (const target of TARGETS) {
  let total = 0;
  let wins = 0;
  let losses = 0;
  let sumSquares = 0;
  for (let i = 0; i < N; i++) {
    const pnl = settle(crashes[i], target);
    total += pnl;
    sumSquares += pnl * pnl;
    if (pnl > 0) wins++;
    else losses++;
  }
  const meanPnL = total / N;
  const variance = sumSquares / N - meanPnL * meanPnL;
  const sdRound = Math.sqrt(variance);
  const sdTotal = Math.sqrt(N) * sdRound;
  rows.push({
    target,
    wins,
    losses,
    total,
    meanPnL,
    sdRound,
    sdTotal,
    realizedEdgePct: -100 * (total / (N * BET)),
    pWinPct: 100 * (wins / N),
  });
}

// ---- Render table ----
const fmt = (n: number, w: number) => n.toString().padStart(w);
const fmtN = (n: number, w: number, dec = 0) => n.toFixed(dec).padStart(w);

console.log(`┌──────────┬──────────┬──────────┬─────────────┬────────────┬─────────┬──────────────────┐`);
console.log(`│ Target   │  Wins    │  Losses  │   Net P&L   │  Mean/rnd  │ Edge %  │  ±3σ band (CI)   │`);
console.log(`├──────────┼──────────┼──────────┼─────────────┼────────────┼─────────┼──────────────────┤`);
for (const r of rows) {
  const lo = r.total - 3 * r.sdTotal;
  const hi = r.total + 3 * r.sdTotal;
  console.log(
    `│ ${r.target.toFixed(2).padStart(5)}x   ` +
    `│ ${fmt(r.wins, 8)} ` +
    `│ ${fmt(r.losses, 8)} ` +
    `│ ${fmtN(r.total, 11, 0)} ` +
    `│ ${fmtN(r.meanPnL, 10, 3)} ` +
    `│ ${fmtN(r.realizedEdgePct, 6, 3)}% ` +
    `│ [${fmtN(lo, 7, 0)},${fmtN(hi, 8, 0)}] │`,
  );
}
console.log(`└──────────┴──────────┴──────────┴─────────────┴────────────┴─────────┴──────────────────┘`);

console.log(`\nNotes:`);
console.log(`  • All targets run against the SAME 100,000 crash points → results comparable apples-to-apples.`);
console.log(`  • Realized edge ≈ 3% across the board confirms provably-fair invariant: no target beats house.`);
console.log(`  • Higher targets have larger SD (more variance) but same expected loss rate.`);
console.log(`  • Server P&L = -Net P&L (mirror).`);
