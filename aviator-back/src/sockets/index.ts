import { Server, Socket } from "socket.io";
import { engine } from "../game/engine";
import { bots } from "../game/bots";
import { config } from "../config";
import { getSetting } from "../settings";
import { authFromToken, authDevGuest } from "../auth/session";
import { PlayerState, BetIndex } from "../game/types";
import { emptySide } from "../game/types";
import { UserModel } from "../db/models/User";

interface BetPayload {
  betAmount: number;
  target: number;
  type: BetIndex;
  auto: boolean;
}

interface CashOutPayload {
  type: BetIndex;
  endTarget: number;
}

const userToFrontend = (p: PlayerState) => ({
  userName: p.userName,
  balance: +p.balance.toFixed(2),
  wagerRequired: +(p.wagerRequired || 0).toFixed(2),
  avatar: p.avatar,
  userType: p.userType,
  token: p.token,
  f: p.f,
  s: p.s,
});

const broadcastBets = (io: Server) => {
  io.emit("bettedUserInfo", engine.bettedUsersSnapshot());
};

const broadcastGameState = (io: Server) => {
  io.emit("gameState", engine.statusSnapshot());
};

const announcePhase = (io: Server) => {
  broadcastGameState(io);
  if (engine.phase === "BET") {
    broadcastBets(io);
  }
};

/**
 * Active sockets per logged-in user. Multi-tab safe — a user is "in the room"
 * as long as ANY of their tabs has a live socket. Engine state (active bet
 * / balance) is keyed by userName, not socket, so it survives tab churn.
 *
 * Module-scope so other modules (e.g. recharge route after webhook) can push
 * events to a specific user. Push goes to ALL their open tabs.
 */
const userSockets = new Map<string, Set<Socket>>();

/** Send a one-off event to ALL of a user's open tabs. */
export const pushToUser = (
  userName: string,
  event: string,
  payload: unknown,
): boolean => {
  const set = userSockets.get(userName);
  if (!set || set.size === 0) return false;
  for (const s of set) s.emit(event, payload);
  return true;
};

/**
 * After balance changes outside the engine (recharge credit, admin grant,
 * etc), push a fresh myInfo so the client sees the new balance immediately.
 * Returns true if the user was online.
 */
export const pushUserMyInfo = (userName: string): boolean => {
  const set = userSockets.get(userName);
  if (!set || set.size === 0) return false;
  const p = engine.getPlayer(userName);
  if (p) for (const s of set) s.emit("myInfo", userToFrontend(p));
  return true;
};

export const initSockets = (io: Server): void => {

  // Wire engine events to broadcasts
  engine.on("phaseChange", () => {
    announcePhase(io);
    // When a fresh BET phase starts, the engine has just reset every
    // player's f/s sides to emptySide(). Push that authoritative reset
    // to every connected client so the BetCard UI flips out of any
    // lingering "CASHED OUT" state from the previous round.
    if (engine.phase === "BET") {
      for (const [userName, set] of userSockets.entries()) {
        const p = engine.getPlayer(userName);
        if (!p) continue;
        for (const sock of set) sock.emit("myInfo", userToFrontend(p));
      }
    }
  });
  engine.on("tick", () => broadcastGameState(io));
  engine.on("betPlaced", () => broadcastBets(io));
  // Bots — virtual players. Treat their join + cashout exactly like real bets
  // so the existing FxLayer parachute logic + bet list re-render automatically.
  bots.on("botJoined", () => broadcastBets(io));
  bots.on("botCashout", () => broadcastBets(io));
  engine.on("cashOut", (p: PlayerState, idx: BetIndex) => {
    broadcastBets(io);
    // Send success + fresh myInfo to the player whose side just cashed out.
    // Crucial for AUTO cash-outs: those fire from engine.tick(), not from a
    // socket request, so without this the client never knows it succeeded.
    const set = userSockets.get(p.userName);
    if (!set) return;
    for (const sock of set) {
      sock.emit("myInfo", userToFrontend(p));
      sock.emit("success", `Cashed out @ ${p[idx].cashOutAt.toFixed(2)}x`);
    }
  });
  engine.on(
    "roundEnded",
    ({ previousHand, history }: { previousHand: PlayerState[]; history: number[] }) => {
      io.emit("previousHand", previousHand.map(userToFrontend));
      io.emit("history", history);
      // Per-user finishGame
      for (const p of previousHand) {
        const set = userSockets.get(p.userName);
        if (set) for (const sock of set) sock.emit("finishGame", userToFrontend(p));
      }
    },
  );

  io.on("connection", (socket: Socket) => {
    let userName: string | null = null;
    console.log(`[ws] connect ${socket.id}`);

    socket.emit("getBetLimits", {
      max: getSetting("maxBet"),
      min: getSetting("minBet"),
    });

    socket.on("enterRoom", async ({ token }: { token?: string }) => {
      let session = token ? await authFromToken(token) : null;
      if (!session && config.allowDevAuth) {
        session = await authDevGuest(`g${socket.id.slice(0, 5)}`);
      }
      if (!session) {
        socket.emit("error", { index: "f", message: "Auth failed" });
        return;
      }

      userName = session.userName;
      // Multi-tab / refresh / reconnect handling: if the same user already has
      // a player in the engine, KEEP their existing f/s state (active bets,
      // cashout target, auto flag). We only update the socket reference so
      // future engine events route to this socket. Without this, opening a
      // payment page in a new tab (or any reconnect) would wipe an active bet.
      // Track this socket as one of the user's open tabs.
      let set = userSockets.get(userName);
      if (!set) {
        set = new Set();
        userSockets.set(userName, set);
      }
      set.add(socket);

      // Always pull the freshest wagerRequired from Mongo on (re)connect —
      // recharge / withdrawal can move it while the user is offline.
      const fresh = await UserModel.findOne({ userName }).select("wagerRequired").lean();
      const wagerRequired = +(fresh?.wagerRequired || 0);

      const existing = engine.getPlayer(userName);
      if (existing) {
        existing.userId = socket.id;
        existing.token = session.token;
        // Refresh balance/avatar in case Mongo changed (e.g. recharge credit
        // happened while disconnected).
        existing.balance = session.balance;
        existing.wagerRequired = wagerRequired;
        existing.avatar = session.avatar;
        socket.emit("myInfo", userToFrontend(existing));
      } else {
        const player: PlayerState = {
          userId: socket.id,
          userName: session.userName,
          avatar: session.avatar,
          balance: session.balance,
          wagerRequired,
          userType: session.userType,
          token: session.token,
          f: emptySide(),
          s: emptySide(),
        };
        engine.addPlayer(player);
        socket.emit("myInfo", userToFrontend(player));
      }

      socket.emit("history", engine.history);
      socket.emit("gameState", engine.statusSnapshot());
      socket.emit("bettedUserInfo", engine.bettedUsersSnapshot());

      if (session.balance < getSetting("minBet")) socket.emit("recharge");
    });

    socket.on("playBet", async (data: BetPayload) => {
      if (!userName) return;
      const result = await engine.placeBet(
        userName,
        data.type,
        Number(data.betAmount),
        Number(data.target),
        Boolean(data.auto),
      );
      if (!result.ok) {
        socket.emit("error", { index: data.type, message: result.reason });
        return;
      }
      const p = engine.getPlayer(userName);
      if (p) {
        socket.emit("myBetState", userToFrontend(p));
        socket.emit("myInfo", userToFrontend(p));
        socket.emit("success", "Bet placed");
      }
    });

    socket.on("cashOut", (data: CashOutPayload) => {
      if (!userName) return;
      const result = engine.cashOut(userName, data.type, Number(data.endTarget));
      if (!result.ok) {
        socket.emit("error", { index: data.type, message: result.reason || "Cashout failed" });
        return;
      }
      const p = engine.getPlayer(userName);
      if (p) {
        socket.emit("myInfo", userToFrontend(p));
        socket.emit("success", `Cashed out @ ${p[data.type].cashOutAt.toFixed(2)}x`);
      }
    });

    socket.on("disconnect", () => {
      if (userName) {
        const set = userSockets.get(userName);
        if (set) {
          set.delete(socket);
          // Only tear down the player when their LAST tab disconnects.
          // Multi-tab safe: opening /mock-pay in a new tab + closing it must
          // not kick the user from the room while their main tab is alive.
          if (set.size === 0) {
            userSockets.delete(userName);
            engine.removePlayer(userName);
          }
        }
      }
      console.log(`[ws] disconnect ${socket.id}`);
    });
  });
};
