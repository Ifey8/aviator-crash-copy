import { Server, Socket } from "socket.io";
import { engine } from "../game/engine";
import { config } from "../config";
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

export const initSockets = (io: Server): void => {
  const sessionByUser = new Map<string, Socket>();

  // Wire engine events to broadcasts
  engine.on("phaseChange", () => {
    announcePhase(io);
    // When a fresh BET phase starts, the engine has just reset every
    // player's f/s sides to emptySide(). Push that authoritative reset
    // to every connected client so the BetCard UI flips out of any
    // lingering "CASHED OUT" state from the previous round.
    if (engine.phase === "BET") {
      for (const [userName, sock] of sessionByUser.entries()) {
        const p = engine.getPlayer(userName);
        if (p) sock.emit("myInfo", userToFrontend(p));
      }
    }
  });
  engine.on("tick", () => broadcastGameState(io));
  engine.on("betPlaced", () => broadcastBets(io));
  engine.on("cashOut", (p: PlayerState, idx: BetIndex) => {
    broadcastBets(io);
    // Send success + fresh myInfo to the player whose side just cashed out.
    // Crucial for AUTO cash-outs: those fire from engine.tick(), not from a
    // socket request, so without this the client never knows it succeeded.
    const sock = sessionByUser.get(p.userName);
    if (!sock) return;
    sock.emit("myInfo", userToFrontend(p));
    sock.emit("success", `Cashed out @ ${p[idx].cashOutAt.toFixed(2)}x`);
  });
  engine.on(
    "roundEnded",
    ({ previousHand, history }: { previousHand: PlayerState[]; history: number[] }) => {
      io.emit("previousHand", previousHand.map(userToFrontend));
      io.emit("history", history);
      // Per-user finishGame
      for (const p of previousHand) {
        const sock = sessionByUser.get(p.userName);
        if (sock) sock.emit("finishGame", userToFrontend(p));
      }
    },
  );

  io.on("connection", (socket: Socket) => {
    let userName: string | null = null;
    console.log(`[ws] connect ${socket.id}`);

    socket.emit("getBetLimits", { max: config.maxBet, min: config.minBet });

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
      sessionByUser.set(userName, socket);

      const player: PlayerState = {
        userId: socket.id,
        userName: session.userName,
        avatar: session.avatar,
        balance: session.balance,
        userType: session.userType,
        token: session.token,
        f: emptySide(),
        s: emptySide(),
      };
      engine.addPlayer(player);

      socket.emit("myInfo", userToFrontend(player));
      socket.emit("history", engine.history);
      socket.emit("gameState", engine.statusSnapshot());
      socket.emit("bettedUserInfo", engine.bettedUsersSnapshot());

      if (session.balance < config.minBet) socket.emit("recharge");
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
        sessionByUser.delete(userName);
        engine.removePlayer(userName);
      }
      console.log(`[ws] disconnect ${socket.id}`);
    });
  });
};
