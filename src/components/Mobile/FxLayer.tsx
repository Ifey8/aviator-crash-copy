import React from "react";
import Context from "../../context";
import { Parachute, BurstCrash } from "./Effects";
import { planeTracker } from "./planeTracker";

/**
 * FxLayer — overlays celebration effects on the game canvas.
 *
 *   • my cash-out  → big highlighted Parachute drifting down
 *   • other cashes → smaller Parachutes scattered, drifting down (continuous)
 *   • round end    → BurstCrash on top of the plane, ~700ms
 *
 * Bet-placed feedback now lives in <CoinFxLayer/> (gold coins flying from
 * the header balance to the plane), so the green "Bet placed" toast was
 * removed.
 *
 * Hooks into the existing socket via Context — no new socket events needed.
 */

interface FxItem {
  id: string;
  kind: "para-mine" | "para-other" | "crash";
  x: number; // 0..1 — % of canvas width
  y: number; // 0..1 — % of canvas height
  variant?: number;
  label?: string;
  payout?: string;
  born: number;
  ttl: number;
}

let _seq = 0;
const nextId = () => `fx-${++_seq}`;

const VARIANT_COUNT = 5;

export const FxLayer: React.FC = () => {
  const ctx = React.useContext(Context);
  const [items, setItems] = React.useState<FxItem[]>([]);

  // Track sock + previous bet snapshots for diff detection
  const lastBetsRef = React.useRef<any[]>([]);
  const successCountRef = React.useRef(0);

  const push = React.useCallback((it: Omit<FxItem, "id" | "born">) => {
    const item: FxItem = { id: nextId(), born: Date.now(), ...it };
    setItems((prev) => [...prev, item]);
    setTimeout(() => {
      setItems((prev) => prev.filter((p) => p.id !== item.id));
    }, it.ttl + 200);
  }, []);

  // ---- 1) Listen to "success" socket events for my-cashout parachute ----
  // The myInfo handler in context.tsx only syncs balance/userType/userName
  // back to standalone userInfo state (intentionally — to preserve local
  // bet input). So we cannot rely on userInfo.f.cashouted for detection.
  // The server's "success" message carries the signal directly.
  // (Bet-placed feedback handled by <CoinFxLayer/>; nothing to do here.)
  React.useEffect(() => {
    const sock = (ctx as any).socket;
    if (!sock) return;
    const onSuccess = (msg: string) => {
      if (typeof msg !== "string") return;
      const m = msg.match(/cashed?\s*out\s*@\s*([\d.]+)/i);
      if (m) {
        const mult = Number(m[1]);
        // anchor parachute to current plane location
        push({
          kind: "para-mine",
          x: planeTracker.x,
          y: planeTracker.y,
          variant: Math.floor(Math.random() * VARIANT_COUNT),
          payout: `${mult.toFixed(2)}x`,
          ttl: 4000,
        });
      }
    };
    sock.on("success", onSuccess);
    return () => sock.off("success", onSuccess);
  }, [ctx, push]);

  // ---- 2) Detect *other players* cashouts via bettedUsers diff ----
  const bettedUsers = ctx.bettedUsers as any[];
  const myName = ctx.userInfo?.userName;
  React.useEffect(() => {
    const prev = lastBetsRef.current || [];
    if (!Array.isArray(bettedUsers)) return;

    // Map prev cashed status by userName+betAmount key
    const key = (b: any) => `${b.userName}::${b.betAmount}`;
    const prevMap = new Map(prev.map((b) => [key(b), !!b.cashouted]));

    for (const b of bettedUsers) {
      if (b.userName === myName) continue;
      const wasCashed = prevMap.get(key(b)) ?? false;
      if (b.cashouted && !wasCashed) {
        // pseudo-random horizontal placement, biased away from center
        const r = (Math.sin(successCountRef.current++) * 4 + 3) % 1;
        const x = 0.08 + Math.abs(r) * 0.84;
        push({
          kind: "para-other",
          x,
          y: 0.32 + (Math.random() * 0.25),
          variant: successCountRef.current % VARIANT_COUNT,
          label: maskName(b.userName),
          payout: `${(b.cashOutAt || 0).toFixed(2)}x`,
          ttl: 3500,
        });
      }
    }
    lastBetsRef.current = bettedUsers.slice();
  }, [bettedUsers, myName, push]);

  // ---- 4) Crash burst on phase transition to GAMEEND ----
  const phase = ctx.GameState;
  const lastPhaseRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (phase === "GAMEEND" && lastPhaseRef.current !== "GAMEEND") {
      // anchor burst to plane's last position so it's clearly the plane
      // exploding, not a generic decoration
      push({ kind: "crash", x: planeTracker.x, y: planeTracker.y, ttl: 800 });
    }
    lastPhaseRef.current = phase as string;
  }, [phase, push]);

  return (
    <div className="fx-layer" aria-hidden="true">
      {items.map((it) => {
        const style: React.CSSProperties = {
          left: `${it.x * 100}%`,
          top: `${it.y * 100}%`,
        };
        if (it.kind === "para-mine") {
          return (
            <div key={it.id} className="fx-para fx-para-mine" style={style}>
              <Parachute size={56} variant={it.variant} payout={it.payout} />
            </div>
          );
        }
        if (it.kind === "para-other") {
          return (
            <div key={it.id} className="fx-para fx-para-other" style={style}>
              <Parachute size={40} variant={it.variant} label={it.label} payout={it.payout} />
            </div>
          );
        }
        if (it.kind === "crash") {
          return (
            <div key={it.id} className="fx-crash" style={style}>
              <BurstCrash size={100} />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
};

const maskName = (n?: string): string => {
  if (!n) return "***";
  if (n.length <= 4) return n[0] + "***";
  return n.slice(0, 2) + "***" + n.slice(-1);
};
