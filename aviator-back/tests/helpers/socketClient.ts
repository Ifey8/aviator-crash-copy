/**
 * Test helper: a Socket.IO client wrapper that records every event the server
 * sends, plus convenience methods (waitForPhase, waitForEvent) so tests stay
 * declarative.
 */
import { io, Socket } from "socket.io-client";

export interface RecordedEvent {
  name: string;
  payload: any;
  at: number;
}

export class TestClient {
  socket: Socket;
  events: RecordedEvent[] = [];
  private phase: string | null = null;
  private resolvers: { match: (e: RecordedEvent) => boolean; resolve: (e: RecordedEvent) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }[] = [];

  constructor(public url: string = "http://localhost:5000") {
    this.socket = io(url, { transports: ["websocket"], forceNew: true, timeout: 5000 });
    this.attach();
  }

  private attach() {
    const trackedEvents = [
      "connect",
      "disconnect",
      "connect_error",
      "myInfo",
      "myBetState",
      "bettedUserInfo",
      "gameState",
      "history",
      "previousHand",
      "finishGame",
      "getBetLimits",
      "recharge",
      "error",
      "success",
    ];
    for (const name of trackedEvents) {
      this.socket.on(name, (payload: any) => {
        const ev = { name, payload, at: Date.now() };
        this.events.push(ev);
        if (name === "gameState") this.phase = payload?.GameState;
        // notify waiters
        for (let i = this.resolvers.length - 1; i >= 0; i--) {
          const w = this.resolvers[i];
          if (w.match(ev)) {
            clearTimeout(w.timer);
            w.resolve(ev);
            this.resolvers.splice(i, 1);
          }
        }
      });
    }
  }

  enterRoom(token: string | null = null): void {
    this.socket.emit("enterRoom", { token });
  }

  placeBet(opts: { betAmount: number; target: number; type: "f" | "s"; auto: boolean }): void {
    this.socket.emit("playBet", opts);
  }

  cashOut(type: "f" | "s", endTarget: number): void {
    this.socket.emit("cashOut", { type, endTarget });
  }

  /** Resolve when an event matching the predicate arrives. */
  waitFor(name: string, predicate?: (payload: any) => boolean, timeoutMs = 60000): Promise<RecordedEvent> {
    // Check already-received events first
    const existing = this.events.find((e) => e.name === name && (!predicate || predicate(e.payload)));
    if (existing) return Promise.resolve(existing);
    return new Promise<RecordedEvent>((resolve, reject) => {
      const match = (e: RecordedEvent) => e.name === name && (!predicate || predicate(e.payload));
      const timer = setTimeout(() => {
        const idx = this.resolvers.findIndex((r) => r.match === match);
        if (idx >= 0) this.resolvers.splice(idx, 1);
        reject(new Error(`Timeout waiting for "${name}" after ${timeoutMs}ms`));
      }, timeoutMs);
      this.resolvers.push({ match, resolve, reject, timer });
    });
  }

  waitForPhase(target: "BET" | "PLAYING" | "GAMEEND", timeoutMs = 60000) {
    if (this.phase === target) return Promise.resolve(this.lastEvent("gameState")!);
    return this.waitFor("gameState", (p) => p?.GameState === target, timeoutMs);
  }

  lastEvent(name: string): RecordedEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].name === name) return this.events[i];
    return undefined;
  }

  countEvents(name: string): number {
    return this.events.filter((e) => e.name === name).length;
  }

  close(): void {
    for (const w of this.resolvers) clearTimeout(w.timer);
    this.resolvers = [];
    this.socket.disconnect();
  }
}
