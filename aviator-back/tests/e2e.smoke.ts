/* Standalone E2E smoke driver (run via ts-node, not jest).
 * Exits 0 on full success, 1 otherwise. */
import { io, Socket } from "socket.io-client";

const URL = process.env.SMOKE_URL || "http://localhost:5000";
const TIMEOUT_MS = 90_000;

interface Tally {
  connected: boolean;
  gotMyInfo: boolean;
  gotLimits: boolean;
  gotHistory: boolean;
  gotGameState: boolean;
  betPlaced: boolean;
  cashedOut: boolean;
  finishGame: boolean;
  errors: string[];
}

const log = (m: string) => console.log(`[smoke] ${m}`);

const main = async (): Promise<number> => {
  const tally: Tally = {
    connected: false,
    gotMyInfo: false,
    gotLimits: false,
    gotHistory: false,
    gotGameState: false,
    betPlaced: false,
    cashedOut: false,
    finishGame: false,
    errors: [],
  };

  const s: Socket = io(URL, { transports: ["websocket"], timeout: 10000 });

  s.on("connect", () => {
    tally.connected = true;
    log(`connected ${s.id}`);
    s.emit("enterRoom", { token: null });
  });
  s.on("connect_error", (e) => tally.errors.push(`connect_error:${e.message}`));
  s.on("getBetLimits", (l) => {
    tally.gotLimits = true;
    log(`limits: ${JSON.stringify(l)}`);
  });
  s.on("myInfo", (u: any) => {
    tally.gotMyInfo = true;
    log(`myInfo: ${u.userName} balance=${u.balance}`);
  });
  s.on("history", (h: number[]) => {
    tally.gotHistory = true;
    log(`history len=${h.length}`);
  });

  let phase = "";
  let betSent = false;
  let cashSent = false;
  s.on("gameState", (g: any) => {
    tally.gotGameState = true;
    if (g.GameState !== phase) {
      phase = g.GameState;
      log(`phase → ${phase}`);
    }
    if (g.GameState === "BET" && !betSent) {
      betSent = true;
      log("placing bet (f=10, target=1.5, auto=false)");
      s.emit("playBet", { betAmount: 10, target: 1.5, type: "f", auto: false });
    }
    if (g.GameState === "PLAYING" && tally.betPlaced && !cashSent && Number(g.currentNum) >= 1.3) {
      cashSent = true;
      log(`cashing out @ ${g.currentNum}x`);
      s.emit("cashOut", { type: "f", endTarget: Number(g.currentNum) });
    }
  });

  s.on("myBetState", () => {
    tally.betPlaced = true;
  });
  s.on("success", (m: string) => {
    log(`success: ${m}`);
    if (m.includes("Cashed")) tally.cashedOut = true;
  });
  s.on("error", (e: any) => tally.errors.push(`error:${JSON.stringify(e)}`));
  s.on("finishGame", () => {
    tally.finishGame = true;
    log("finishGame received");
  });
  s.on("bettedUserInfo", (b: any[]) => log(`bettedUsers count=${b.length}`));

  // Wait until we've placed a bet AND seen finishGame for that round
  const start = Date.now();
  let finishedAfterBet = false;
  s.on("finishGame", () => {
    if (tally.betPlaced) finishedAfterBet = true;
  });
  while (!finishedAfterBet && Date.now() - start < TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 250));
  }
  s.disconnect();

  console.log("\n=== Tally ===");
  console.log(JSON.stringify(tally, null, 2));

  const required: (keyof Tally)[] = [
    "connected",
    "gotMyInfo",
    "gotLimits",
    "gotHistory",
    "gotGameState",
    "betPlaced",
    "finishGame",
  ];
  const missing = required.filter((k) => !tally[k]);
  if (missing.length) {
    console.error(`✘ missing: ${missing.join(", ")}`);
    return 1;
  }
  if (tally.errors.length) {
    console.error(`✘ errors: ${tally.errors.join(" | ")}`);
    return 1;
  }
  if (!tally.cashedOut) {
    console.warn("⚠ never cashed out (round may have crashed before reaching 1.3x — acceptable)");
  }
  console.log("✓ All required signals received");
  return 0;
};

main().then((code) => process.exit(code));
