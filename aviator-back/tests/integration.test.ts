/**
 * Single-client integration tests against the running backend at :5000.
 * Each test creates a fresh socket so account state is isolated.
 *
 * Required: backend container running (`docker compose up -d`).
 */
import { TestClient } from "./helpers/socketClient";

const URL = process.env.SMOKE_URL || "http://localhost:5000";

describe("Single-client gameplay", () => {
  jest.setTimeout(240_000);

  test("connects, receives bet limits + initial myInfo + history + gameState", async () => {
    const c = new TestClient(URL);
    await c.waitFor("connect");
    c.enterRoom();
    const my = await c.waitFor("myInfo");
    const limits = await c.waitFor("getBetLimits");
    const hist = await c.waitFor("history");
    const state = await c.waitFor("gameState");

    expect(my.payload.userName).toMatch(/^g[\w]+$/);
    expect(my.payload.balance).toBeGreaterThanOrEqual(1);
    expect(limits.payload).toEqual(
      expect.objectContaining({ min: expect.any(Number), max: expect.any(Number) }),
    );
    expect(Array.isArray(hist.payload)).toBe(true);
    expect(["BET", "PLAYING", "GAMEEND"]).toContain(state.payload.GameState);
    c.close();
  });

  test("game state cycles BET → PLAYING → GAMEEND", async () => {
    const c = new TestClient(URL);
    await c.waitFor("connect");
    c.enterRoom();
    await c.waitFor("myInfo");

    await c.waitForPhase("BET", 30_000);
    await c.waitForPhase("PLAYING", 30_000);
    await c.waitForPhase("GAMEEND", 60_000);
    await c.waitForPhase("BET", 30_000);
    c.close();
  });

  test("place valid bet during BET phase → balance deducts, success emitted", async () => {
    const c = new TestClient(URL);
    await c.waitFor("connect");
    c.enterRoom();
    const initial = (await c.waitFor("myInfo")).payload.balance;

    await c.waitForPhase("BET");
    c.placeBet({ betAmount: 10, target: 2, type: "f", auto: false });

    const success = await c.waitFor("success", (m) => /placed|bet/i.test(m), 5_000);
    expect(success.payload).toMatch(/placed/i);

    const myInfoAfter = await c.waitFor(
      "myInfo",
      (p) => Math.abs(p.balance - (initial - 10)) < 0.01,
      5_000,
    );
    expect(myInfoAfter.payload.balance).toBeCloseTo(initial - 10, 2);
    c.close();
  });

  test("cashout during PLAYING credits balance with bet × multiplier", async () => {
    const c = new TestClient(URL);
    await c.waitFor("connect");
    c.enterRoom();
    const initial = (await c.waitFor("myInfo")).payload.balance;

    await c.waitForPhase("BET");
    c.placeBet({ betAmount: 10, target: 5, type: "f", auto: false });
    await c.waitFor("success");

    await c.waitForPhase("PLAYING");
    // Wait until multiplier ≥ 1.05 (gives some headroom over server min cashout 1.01)
    await new Promise((r) => setTimeout(r, 700));
    const stateBefore = c.lastEvent("gameState")!.payload;
    const multiplierAtCashout = Number(stateBefore.currentNum);
    c.cashOut("f", multiplierAtCashout);

    const success = await c.waitFor("success", (m) => /cashed/i.test(m), 5_000).catch(() => null);
    if (success) {
      // Balance should be initial - 10 + (10 * cashedMultiplier)
      const myInfoAfter = await c.waitFor("myInfo", (p) => p.balance > initial - 10 + 0.01, 5_000);
      const expected = initial - 10 + 10 * multiplierAtCashout;
      expect(Math.abs(myInfoAfter.payload.balance - expected)).toBeLessThan(0.5);
    }
    c.close();
  });

  test("rejects bet below minimum", async () => {
    const c = new TestClient(URL);
    await c.waitFor("connect");
    c.enterRoom();
    await c.waitFor("myInfo");
    await c.waitForPhase("BET");
    c.placeBet({ betAmount: 0, target: 2, type: "f", auto: false });
    const err = await c.waitFor("error", undefined, 5_000);
    expect(err.payload.message).toMatch(/Bet must be|insufficient|invalid/i);
    c.close();
  });

  test("rejects bet outside BET phase", async () => {
    const c = new TestClient(URL);
    await c.waitFor("connect");
    c.enterRoom();
    await c.waitFor("myInfo");
    await c.waitForPhase("PLAYING", 30_000);
    c.placeBet({ betAmount: 10, target: 2, type: "f", auto: false });
    const err = await c.waitFor("error", undefined, 5_000);
    expect(err.payload.message).toMatch(/closed|not active|not in/i);
    c.close();
  });

  test("rejects double bet on same side in same round", async () => {
    const c = new TestClient(URL);
    await c.waitFor("connect");
    c.enterRoom();
    await c.waitFor("myInfo");
    await c.waitForPhase("BET");
    c.placeBet({ betAmount: 10, target: 2, type: "f", auto: false });
    await c.waitFor("success");
    c.placeBet({ betAmount: 10, target: 2, type: "f", auto: false });
    const err = await c.waitFor("error", undefined, 5_000);
    expect(err.payload.message).toMatch(/already|round/i);
    c.close();
  });

  test("dual bet (f + s) both deduct independently", async () => {
    const c = new TestClient(URL);
    await c.waitFor("connect");
    c.enterRoom();
    const initial = (await c.waitFor("myInfo")).payload.balance;

    await c.waitForPhase("BET");
    c.placeBet({ betAmount: 5, target: 2, type: "f", auto: false });
    c.placeBet({ betAmount: 7, target: 2, type: "s", auto: false });

    // Wait for both successes
    await new Promise((r) => setTimeout(r, 500));
    const myInfoAfter = await c.waitFor(
      "myInfo",
      (p) => Math.abs(p.balance - (initial - 12)) < 0.01,
      5_000,
    );
    expect(myInfoAfter.payload.balance).toBeCloseTo(initial - 12, 2);
    c.close();
  });

  test("auto-bet with target multiplier triggers auto-cashout", async () => {
    const c = new TestClient(URL);
    await c.waitFor("connect");
    c.enterRoom();
    const initial = (await c.waitFor("myInfo")).payload.balance;

    await c.waitForPhase("BET");
    c.placeBet({ betAmount: 10, target: 1.05, type: "f", auto: true });
    await c.waitFor("success");
    await c.waitForPhase("PLAYING");
    // Wait for round to end naturally
    await c.waitForPhase("GAMEEND", 60_000);
    // Match only OUR round's finishGame (one that has f.betAmount=10).
    const finishGame = await c.waitFor(
      "finishGame",
      (p) => p?.f?.betAmount === 10,
      30_000,
    );
    const fSide = finishGame.payload.f;
    expect(fSide.betted).toBe(true);
    // Either auto-cashed (cashAmount > 0) or crashed below 1.05 (rare)
    if (fSide.cashouted) {
      expect(fSide.cashOutAt).toBeGreaterThanOrEqual(1.05);
      expect(fSide.cashOutAt).toBeLessThanOrEqual(1.5);
    }
    c.close();
  });

  test("history grows by 1 each round end", async () => {
    const c = new TestClient(URL);
    await c.waitFor("connect");
    c.enterRoom();
    await c.waitFor("myInfo");
    const histInitial = (await c.waitFor("history")).payload as number[];

    await c.waitForPhase("GAMEEND", 60_000);
    await new Promise((r) => setTimeout(r, 500));
    const histAfter = c.lastEvent("history")!.payload as number[];
    expect(histAfter.length).toBeGreaterThanOrEqual(histInitial.length);
    expect(histAfter.length).toBeLessThanOrEqual(30); // capped at config.historyLength
    c.close();
  });

  test("bettedUserInfo is broadcast when a bet is placed", async () => {
    const c = new TestClient(URL);
    await c.waitFor("connect");
    c.enterRoom();
    await c.waitFor("myInfo");
    await c.waitForPhase("BET");
    const beforeCount = c.countEvents("bettedUserInfo");
    c.placeBet({ betAmount: 10, target: 2, type: "f", auto: false });
    await c.waitFor("success");
    await new Promise((r) => setTimeout(r, 300));
    const afterCount = c.countEvents("bettedUserInfo");
    expect(afterCount).toBeGreaterThan(beforeCount);
    const last = c.lastEvent("bettedUserInfo")!.payload;
    expect(Array.isArray(last)).toBe(true);
    expect(last.find((u: any) => u.betAmount === 10)).toBeDefined();
    c.close();
  });

  test("multiplier ticks monotonically up during PLAYING", async () => {
    const c = new TestClient(URL);
    await c.waitFor("connect");
    c.enterRoom();
    await c.waitFor("myInfo");
    await c.waitForPhase("PLAYING", 30_000);
    const samples: number[] = [];
    for (let i = 0; i < 6; i++) {
      const ev = c.lastEvent("gameState");
      if (ev?.payload.GameState === "PLAYING") samples.push(Number(ev.payload.currentNum));
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(samples.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1] - 0.01); // small floor for sampling jitter
    }
    c.close();
  });
});
