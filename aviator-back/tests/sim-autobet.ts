/**
 * Monte Carlo simulation: auto-bet 100 INR with auto-cashout @ 1.01x,
 * 100,000 rounds. Uses the real `computeCrashPoint` from the engine,
 * with the same houseEdge=0.03 the production server runs with.
 *
 * Run:  npx ts-node tests/sim-autobet.ts
 */
import { randomBytes } from "crypto";
import { computeCrashPoint } from "../src/game/provablyFair";

const N = 100_000;
const BET = 100;
const TARGET = 1.01;
const HOUSE_EDGE = 0.03;

// Replicate the engine's tick logic for auto-cashout: cashout fires when
// the displayed multiplier (toFixed(2)) reaches the target BEFORE the
// round-end multiplier check. Engine multiplier values move in 0.01 steps,
// so:
//   - crashPoint  < target  → user loses (multiplier never reaches target)
//   - crashPoint >= target  → auto-cashout fires; user wins (target − 1) × bet
const settle = (crash: number): number => {
  if (crash < TARGET) return -BET; // round crashed before reaching target
  return BET * (TARGET - 1); // cashed out at exactly target
};

// One persistent server seed for the whole run, like production where the
// seed is rotated per round but each round draws independently from a wide
// distribution; doesn't change the statistics.
const serverSeed = randomBytes(32).toString("hex");
const clientSeed = "sim";

let total = 0;
let wins = 0;
let losses = 0;
let crashAtOne = 0;
let crashBelowTarget = 0;
const sumSquares = { val: 0 };
const histogram: Record<string, number> = {};

const t0 = Date.now();
for (let nonce = 1; nonce <= N; nonce++) {
  const cp = computeCrashPoint(serverSeed, clientSeed, nonce, HOUSE_EDGE);
  const pnl = settle(cp);
  total += pnl;
  sumSquares.val += pnl * pnl;
  if (pnl > 0) wins++;
  else losses++;
  if (cp === 1.0) crashAtOne++;
  else if (cp < TARGET) crashBelowTarget++;

  // Bucket the crash point distribution
  const bucket =
    cp < 1.01 ? "1.00" :
    cp < 1.5  ? "1.01–1.49" :
    cp < 2    ? "1.50–1.99" :
    cp < 5    ? "2.00–4.99" :
    cp < 10   ? "5.00–9.99" :
    cp < 50   ? "10.0–49.9" :
    cp < 200  ? "50.0–199.9" :
                ">=200";
  histogram[bucket] = (histogram[bucket] || 0) + 1;
}
const ms = Date.now() - t0;

const wagered = N * BET;
const meanPnL = total / N;
const variance = sumSquares.val / N - meanPnL * meanPnL;
const sdRound = Math.sqrt(variance);
const sdTotal = Math.sqrt(N) * sdRound;

const houseEdgeRealized = -total / wagered;

console.log(`\n=== Auto-bet 100 INR @ ${TARGET.toFixed(2)}x · ${N.toLocaleString()} rounds ===`);
console.log(`Server houseEdge config:    ${HOUSE_EDGE} (3.00%)`);
console.log(`Sim wall time:              ${ms} ms\n`);

console.log("--- Round outcomes ---");
console.log(`Wins  (cashed @ ${TARGET}x): ${wins.toLocaleString()}  (${(100 * wins / N).toFixed(3)}%)`);
console.log(`Losses                     : ${losses.toLocaleString()}  (${(100 * losses / N).toFixed(3)}%)`);
console.log(`  ↳ from house-edge bucket: ${crashAtOne.toLocaleString()}  (crash = 1.00)`);
console.log(`  ↳ from low crash <1.01  : ${crashBelowTarget.toLocaleString()}  (1.00 < crash < 1.01)\n`);

console.log("--- Crash point distribution ---");
const order = ["1.00", "1.01–1.49", "1.50–1.99", "2.00–4.99", "5.00–9.99", "10.0–49.9", "50.0–199.9", ">=200"];
for (const k of order) {
  const c = histogram[k] || 0;
  const pct = (100 * c) / N;
  const bar = "█".repeat(Math.round(pct / 2));
  console.log(`  ${k.padEnd(10)} ${c.toString().padStart(7)}  ${pct.toFixed(2).padStart(5)}%  ${bar}`);
}

console.log("\n--- Player P&L ---");
console.log(`Total wagered            : ${wagered.toLocaleString()} INR`);
console.log(`Total returned           : ${(total + wagered).toLocaleString()} INR`);
console.log(`Net P&L (player)         : ${total.toFixed(2)} INR`);
console.log(`Mean P&L per round       : ${meanPnL.toFixed(4)} INR`);
console.log(`Std-dev per round        : ${sdRound.toFixed(2)} INR`);
console.log(`Std-dev across ${N.toLocaleString()} rounds: ±${sdTotal.toFixed(0)} INR`);
console.log(`Realized house edge      : ${(100 * houseEdgeRealized).toFixed(3)}%`);

console.log("\n--- Server P&L (mirror) ---");
console.log(`Server profit            : ${(-total).toFixed(2)} INR`);
console.log(`Server profit %          : ${(100 * houseEdgeRealized).toFixed(3)}% of total wagered`);

console.log("\n--- Theoretical (analytical) ---");
const pHouseBucket = 1 / 33;
const pLowCrash = (32 / 33) * 0.01;
const pWin = (32 / 33) * 0.99;
const evRound = pWin * 1 - (pHouseBucket + pLowCrash) * 100;
console.log(`P(win)        : ${(100 * pWin).toFixed(3)}%`);
console.log(`P(lose 100)   : ${(100 * (1 - pWin)).toFixed(3)}%`);
console.log(`EV per round  : ${evRound.toFixed(4)} INR`);
console.log(`EV × ${N.toLocaleString()}    : ${(evRound * N).toFixed(0)} INR`);
console.log("");
