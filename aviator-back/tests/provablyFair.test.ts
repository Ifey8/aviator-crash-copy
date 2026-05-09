import {
  newServerSeed,
  computeCrashPoint,
  multiplierAt,
  timeForMultiplier,
  buildRoundSeed,
} from "../src/game/provablyFair";
import { createHash } from "crypto";

describe("provably fair crash", () => {
  test("server seed hash matches sha256 of seed", () => {
    const { serverSeed, serverSeedHash } = newServerSeed();
    expect(createHash("sha256").update(serverSeed).digest("hex")).toBe(serverSeedHash);
  });

  test("crash point is deterministic for same inputs", () => {
    const seed = "abc123";
    const a = computeCrashPoint(seed, "client", 1, 0.03);
    const b = computeCrashPoint(seed, "client", 1, 0.03);
    expect(a).toBe(b);
  });

  test("crash point changes with nonce", () => {
    const seed = "abc123";
    const a = computeCrashPoint(seed, "c", 1, 0.03);
    const b = computeCrashPoint(seed, "c", 2, 0.03);
    expect(a).not.toBe(b);
  });

  test("crash point in [1.0, 1000]", () => {
    for (let i = 0; i < 200; i++) {
      const r = computeCrashPoint("seed-x", "client", i, 0.03);
      expect(r).toBeGreaterThanOrEqual(1.0);
      expect(r).toBeLessThanOrEqual(1000);
    }
  });

  test("house edge produces 1.0x bucket sometimes", () => {
    let oneXcount = 0;
    for (let i = 0; i < 1000; i++) {
      if (computeCrashPoint("hs-seed", "c", i, 0.03) === 1.0) oneXcount++;
    }
    expect(oneXcount).toBeGreaterThan(0);
  });

  test("multiplier is monotonically increasing", () => {
    let last = 0;
    for (let t = 0; t <= 30; t += 0.5) {
      const m = multiplierAt(t);
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
    }
  });

  test("multiplier starts at 1.0 at t=0", () => {
    expect(multiplierAt(0)).toBe(1);
  });

  test("timeForMultiplier inverts multiplierAt", () => {
    for (const target of [1.5, 2, 5, 10, 25]) {
      const t = timeForMultiplier(target);
      expect(Math.abs(multiplierAt(t) - target)).toBeLessThan(0.01);
    }
  });

  test("buildRoundSeed bundles all fields", () => {
    const r = buildRoundSeed("ss", "cc", 5, 0.03);
    expect(r.serverSeed).toBe("ss");
    expect(r.clientSeed).toBe("cc");
    expect(r.nonce).toBe(5);
    expect(r.crashPoint).toBeGreaterThanOrEqual(1);
    expect(r.serverSeedHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
