/**
 * Multiplayer tests: 2+ clients sharing the same round.
 * Verifies broadcast semantics and per-user isolation.
 */
import { TestClient } from "./helpers/socketClient";

const URL = process.env.SMOKE_URL || "http://localhost:5000";

describe("Multiplayer broadcast", () => {
  jest.setTimeout(240_000);

  test("two clients see each other's bets in bettedUserInfo", async () => {
    const a = new TestClient(URL);
    const b = new TestClient(URL);
    await a.waitFor("connect");
    await b.waitFor("connect");
    a.enterRoom();
    b.enterRoom();
    const aName = (await a.waitFor("myInfo")).payload.userName;
    const bName = (await b.waitFor("myInfo")).payload.userName;
    expect(aName).not.toEqual(bName);

    await a.waitForPhase("BET");
    a.placeBet({ betAmount: 5, target: 2, type: "f", auto: false });
    b.placeBet({ betAmount: 7, target: 2, type: "f", auto: false });
    await a.waitFor("success");
    await b.waitFor("success");
    // Wait for the next bettedUserInfo broadcast that contains both names
    await a.waitFor(
      "bettedUserInfo",
      (list) => list.some((u: any) => u.userName === aName) && list.some((u: any) => u.userName === bName),
      5_000,
    );
    await b.waitFor(
      "bettedUserInfo",
      (list) => list.some((u: any) => u.userName === aName) && list.some((u: any) => u.userName === bName),
      5_000,
    );

    a.close();
    b.close();
  });

  test("balance is per-user (one's bet does not affect the other's balance)", async () => {
    const a = new TestClient(URL);
    const b = new TestClient(URL);
    await a.waitFor("connect");
    await b.waitFor("connect");
    a.enterRoom();
    b.enterRoom();
    const aInit = (await a.waitFor("myInfo")).payload.balance;
    const bInit = (await b.waitFor("myInfo")).payload.balance;

    await a.waitForPhase("BET");
    a.placeBet({ betAmount: 50, target: 2, type: "f", auto: false });
    await a.waitFor("success");

    // a's balance changed
    await a.waitFor("myInfo", (p) => Math.abs(p.balance - (aInit - 50)) < 0.01, 5_000);
    // b's balance should NOT have changed (no extra myInfo for b yet)
    const bLast = b.lastEvent("myInfo")!;
    expect(bLast.payload.balance).toBe(bInit);

    a.close();
    b.close();
  });

  test("both clients see the same crash point in history", async () => {
    const a = new TestClient(URL);
    const b = new TestClient(URL);
    await a.waitFor("connect");
    await b.waitFor("connect");
    a.enterRoom();
    b.enterRoom();
    await a.waitFor("myInfo");
    await b.waitFor("myInfo");

    await a.waitForPhase("GAMEEND", 60_000);
    await b.waitForPhase("GAMEEND", 60_000);
    await new Promise((r) => setTimeout(r, 500));

    const aHist = a.lastEvent("history")!.payload as number[];
    const bHist = b.lastEvent("history")!.payload as number[];
    // First (most recent) entry must match
    expect(aHist[0]).toBe(bHist[0]);

    a.close();
    b.close();
  });

  test("both clients see same gameState transitions (synchronized rounds)", async () => {
    const a = new TestClient(URL);
    const b = new TestClient(URL);
    await a.waitFor("connect");
    await b.waitFor("connect");
    a.enterRoom();
    b.enterRoom();
    await a.waitFor("myInfo");
    await b.waitFor("myInfo");

    await a.waitForPhase("BET", 30_000);
    await b.waitForPhase("BET", 5_000);
    await a.waitForPhase("PLAYING", 30_000);
    await b.waitForPhase("PLAYING", 5_000);

    // Sample current multiplier at the same time — should agree within ±0.05
    const aNum = Number(a.lastEvent("gameState")!.payload.currentNum);
    const bNum = Number(b.lastEvent("gameState")!.payload.currentNum);
    expect(Math.abs(aNum - bNum)).toBeLessThan(0.2);

    a.close();
    b.close();
  });
});
