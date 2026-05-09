import React from "react";
import Context from "../../context";
import { planeTracker } from "./planeTracker";

/**
 * CoinFxLayer — viewport-fixed gold coin animations that span between the
 * header balance display and the plane on the canvas.
 *
 *   • Bet placed   → coins fly FROM balance → plane     (paying in the stake)
 *   • Cash out     → after parachute, coins fly FROM plane → balance
 *                    (winnings landing in the wallet)
 *
 * Anchors:
 *   • balance: queries [data-fx="balance"] in the DOM (set on .mobile-header-balance)
 *   • plane:   .game-canvas-wrap rect + planeTracker (normalized 0..1)
 *
 * Why a separate fixed layer (not the existing FxLayer)?
 *   FxLayer is positioned inside .game-canvas-wrap so its children clip to the
 *   canvas. Coin trails need to span from the header into the canvas, which
 *   requires viewport-level positioning.
 */

interface CoinItem {
  id: string;
  sx: number;       // start viewport x (px)
  sy: number;       // start viewport y (px)
  ex: number;       // end viewport x (px)
  ey: number;       // end viewport y (px)
  mx: number;       // arc midpoint x (px)
  my: number;       // arc midpoint y (px) — biased upward for parabola
  delay: number;    // ms — staggers coins
  duration: number; // ms
  spinDir: 1 | -1;
}

let _seq = 0;
const nextId = () => `coin-${++_seq}`;

const FLY_DURATION = 850;
const COINS_BET = 5;
const COINS_CASHOUT = 7;

const balanceCenter = (): { x: number; y: number } | null => {
  const el = document.querySelector('[data-fx="balance"]') as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

const planeCenter = (): { x: number; y: number } | null => {
  const wrap = document.querySelector(".game-canvas-wrap") as HTMLElement | null;
  if (!wrap) return null;
  const r = wrap.getBoundingClientRect();
  return {
    x: r.left + planeTracker.x * r.width,
    y: r.top + planeTracker.y * r.height,
  };
};

const buildFlight = (
  from: { x: number; y: number },
  to: { x: number; y: number },
  count: number,
): CoinItem[] => {
  const items: CoinItem[] = [];
  for (let i = 0; i < count; i++) {
    // Slight scatter at both anchors so coins don't stack
    const jfx = (Math.random() - 0.5) * 26;
    const jfy = (Math.random() - 0.5) * 16;
    const jex = (Math.random() - 0.5) * 22;
    const jey = (Math.random() - 0.5) * 16;
    const sx = from.x + jfx;
    const sy = from.y + jfy;
    const ex = to.x + jex;
    const ey = to.y + jey;
    // Arc midpoint biased upward — gives a parabolic toss feel
    const lift = 70 + Math.random() * 50;
    const mx = (sx + ex) / 2 + (Math.random() - 0.5) * 36;
    const my = Math.min(sy, ey) - lift;
    items.push({
      id: nextId(),
      sx, sy, ex, ey, mx, my,
      delay: i * 65,
      duration: FLY_DURATION + Math.floor(Math.random() * 220),
      spinDir: i % 2 === 0 ? 1 : -1,
    });
  }
  return items;
};

export const CoinFxLayer: React.FC = () => {
  const ctx = React.useContext(Context);
  const [items, setItems] = React.useState<CoinItem[]>([]);

  const spawn = React.useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }, count: number) => {
      const newItems = buildFlight(from, to, count);
      setItems((prev) => [...prev, ...newItems]);
      const lifeMs =
        Math.max(...newItems.map((it) => it.delay + it.duration)) + 200;
      setTimeout(() => {
        setItems((prev) => prev.filter((p) => !newItems.some((n) => n.id === p.id)));
      }, lifeMs);
    },
    [],
  );

  // Listen to server-side success messages for bet/cashout signals
  React.useEffect(() => {
    const sock = (ctx as any).socket;
    if (!sock) return;
    const onSuccess = (msg: string) => {
      if (typeof msg !== "string") return;
      if (/bet\s*placed/i.test(msg)) {
        const from = balanceCenter();
        const to = planeCenter();
        if (from && to) spawn(from, to, COINS_BET);
        return;
      }
      if (/cashed?\s*out/i.test(msg)) {
        // Slight delay so coins follow the parachute (which deploys first)
        setTimeout(() => {
          const from = planeCenter();
          const to = balanceCenter();
          if (from && to) spawn(from, to, COINS_CASHOUT);
        }, 850);
      }
    };
    sock.on("success", onSuccess);
    return () => sock.off("success", onSuccess);
  }, [ctx, spawn]);

  return (
    <div className="coin-fx-layer" aria-hidden="true">
      {/* One shared gold gradient — all coins reference it via #coin-grad */}
      <svg width="0" height="0" style={{ position: "absolute" }}>
        <defs>
          <radialGradient id="coin-grad" cx="35%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#FFF6CC" />
            <stop offset="35%" stopColor="#FFD86B" />
            <stop offset="72%" stopColor="#D99000" />
            <stop offset="100%" stopColor="#6B3A0E" />
          </radialGradient>
          <radialGradient id="coin-rim" cx="50%" cy="50%" r="50%">
            <stop offset="85%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(94,44,8,0.6)" />
          </radialGradient>
        </defs>
      </svg>
      {items.map((it) => (
        <div
          key={it.id}
          className="coin-fly"
          style={
            {
              "--sx": `${it.sx}px`,
              "--sy": `${it.sy}px`,
              "--ex": `${it.ex}px`,
              "--ey": `${it.ey}px`,
              "--mx": `${it.mx}px`,
              "--my": `${it.my}px`,
              "--spin": `${it.spinDir * 360}deg`,
              animationDelay: `${it.delay}ms`,
              animationDuration: `${it.duration}ms`,
            } as React.CSSProperties
          }
        >
          <CoinSvg />
        </div>
      ))}
    </div>
  );
};

/* --- Single coin face (~28px). Inherits gradient from <defs> rendered above. --- */
const CoinSvg: React.FC = () => (
  <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="14" fill="url(#coin-grad)" />
    <circle cx="16" cy="16" r="14" fill="url(#coin-rim)" />
    <circle cx="16" cy="16" r="11" fill="none" stroke="#7A4A0E" strokeWidth="0.7" opacity="0.55" />
    {/* Simple rupee glyph drawn as paths to avoid font dependency */}
    <g stroke="#5A2F08" strokeWidth="1.7" strokeLinecap="round" fill="none">
      <path d="M 12 10 L 20 10" />
      <path d="M 12 13 L 20 13" />
      <path d="M 14 10 Q 18 10 18 13.5 Q 18 16.5 14 16.5 L 12 16.5 L 19 22.5" />
    </g>
    {/* highlight */}
    <ellipse cx="11" cy="10" rx="3.4" ry="1.6" fill="#FFF6CC" opacity="0.55" />
  </svg>
);

export default CoinFxLayer;
