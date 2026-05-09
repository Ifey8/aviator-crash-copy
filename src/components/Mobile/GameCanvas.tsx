import React from "react";
import Context from "../../context";
import { Plane } from "./Plane";
import { FxLayer } from "./FxLayer";

/**
 * GameCanvas — the centerpiece. Draws:
 *   1. animated starfield + parallax sky gradient (canvas)
 *   2. the curved trajectory the plane has flown so far (canvas)
 *   3. the plane sprite (DOM, transform-only — GPU accelerated)
 *
 * Plane state machine:
 *   BET     — idle bob hover at origin (CSS keyframe)
 *   PLAYING — climbs the parabolic curve via transform
 *   GAMEEND — fades out (FxLayer drops a Diwali firework on its location)
 *
 * Smoothness:
 *   - Backend ticks every ~100ms; we run a 60fps RAF loop and interpolate the
 *     multiplier locally using the same polynomial the server uses.
 *   - All motion is `transform: translate3d` (GPU compositing).
 *   - Canvas redraws only the trail (single 2D path) per frame.
 */
const multiplierAt = (elapsedSec: number): number => {
  const t = elapsedSec;
  return Math.max(
    1,
    1 + 0.06 * t + Math.pow(0.06 * t, 2) - Math.pow(0.04 * t, 3) + Math.pow(0.04 * t, 4),
  );
};

export const GameCanvas: React.FC = () => {
  const { GameState, currentNum, time } = React.useContext(Context);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const planeRef = React.useRef<HTMLDivElement>(null);
  const liveMultRef = React.useRef<HTMLSpanElement>(null);
  const phaseTextRef = React.useRef<HTMLDivElement>(null);
  const countdownRef = React.useRef<HTMLDivElement>(null);

  const phaseStartRef = React.useRef<number>(Date.now());
  const phaseRef = React.useRef<string>(GameState || "BET");
  const lastCrashRef = React.useRef<number>(1.0);
  const lastPhaseRef = React.useRef<string>(GameState || "BET");

  React.useEffect(() => {
    phaseRef.current = GameState;
    const transition = GameState !== lastPhaseRef.current;

    // Re-anchor phase start ONLY on actual phase transitions.
    // Previously this ran on every gameState tick (~100ms), constantly
    // resetting the start time so the local interpolation never advanced.
    // Also: server sends `time` in SECONDS — convert to ms.
    if (transition) {
      if (GameState === "PLAYING" || GameState === "BET") {
        phaseStartRef.current = Date.now() - (time || 0) * 1000;
      }
      lastPhaseRef.current = GameState;
    }
    if (GameState === "GAMEEND") {
      lastCrashRef.current = Number(currentNum) || lastCrashRef.current;
    }
  }, [GameState, time, currentNum]);

  // RAF loop
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const plane = planeRef.current;
    if (!canvas || !wrap || !plane) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      canvas.width = Math.floor(r.width * dpr);
      canvas.height = Math.floor(r.height * dpr);
      canvas.style.width = r.width + "px";
      canvas.style.height = r.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const PLANE_HALF_W = 28; // svg width 56 / 2
    const PLANE_HALF_H = 16;

    const loop = () => {
      const r = wrap.getBoundingClientRect();
      const W = r.width;
      const H = r.height;
      const phase = phaseRef.current;
      ctx.clearRect(0, 0, W, H);

      const padX = 32;
      const padBottom = 28;
      const padTop = 36;
      const T_MAX = 8; // seconds before x saturates at right edge
      const M_MAX = 20; // multiplier before y saturates at top edge (log-mapped)
      const LOG_MAX = Math.log(M_MAX);

      const xAt = (t: number) => padX + Math.min(t / T_MAX, 1) * (W - padX * 2);
      // Logarithmic y so 2x already pushes 23% up, 5x at 54%, 10x at 77%.
      // Linear scaling made the early climb (1.0–2.0x) look flat.
      const yAt = (m: number) => {
        if (m <= 1) return H - padBottom;
        const k = Math.min(Math.log(m) / LOG_MAX, 1);
        return H - padBottom - k * (H - padBottom - padTop);
      };

      if (phase === "PLAYING") {
        const elapsed = (Date.now() - phaseStartRef.current) / 1000;
        const m = multiplierAt(elapsed);
        if (liveMultRef.current) liveMultRef.current.textContent = m.toFixed(2);
        if (phaseTextRef.current) phaseTextRef.current.style.opacity = "0";
        if (countdownRef.current) countdownRef.current.style.opacity = "0";

        const targetX = xAt(elapsed);
        const targetY = yAt(m);

        // Sample the curve
        const SAMPLES = 36;
        const pts: [number, number][] = [];
        for (let i = 0; i <= SAMPLES; i++) {
          const k = i / SAMPLES;
          const tk = k * elapsed;
          const mk = multiplierAt(tk);
          pts.push([xAt(tk), yAt(mk)]);
        }

        // ---- Filled gradient under the curve ----
        ctx.beginPath();
        ctx.moveTo(pts[0][0], H - padBottom);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        ctx.lineTo(pts[pts.length - 1][0], H - padBottom);
        ctx.closePath();
        const fill = ctx.createLinearGradient(0, H - padBottom, 0, padTop);
        fill.addColorStop(0, "rgba(255, 153, 51, 0.0)");
        fill.addColorStop(0.4, "rgba(255, 153, 51, 0.18)");
        fill.addColorStop(1, "rgba(255, 200, 87, 0.45)");
        ctx.fillStyle = fill;
        ctx.fill();

        // ---- Outer glow stroke ----
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        ctx.strokeStyle = "rgba(255, 153, 51, 0.55)";
        ctx.lineWidth = 8;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.shadowColor = "rgba(255, 153, 51, 0.9)";
        ctx.shadowBlur = 18;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // ---- Inner bright stroke ----
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        const lineGrad = ctx.createLinearGradient(pts[0][0], pts[0][1], targetX, targetY);
        lineGrad.addColorStop(0, "#FF9933");
        lineGrad.addColorStop(0.6, "#FFC857");
        lineGrad.addColorStop(1, "#FFE3A1");
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 3.2;
        ctx.stroke();

        // ---- Animated dashed ribbon along the curve ----
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        ctx.setLineDash([6, 9]);
        ctx.lineDashOffset = -((Date.now() / 30) % 30);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.setLineDash([]);

        // ---- Plane position + tilt (slope of the curve at end) ----
        // Approximate slope using neighbor sample
        const slopeFrom = pts[pts.length - 4] || pts[0];
        const slopeAngle = Math.atan2(targetY - slopeFrom[1], targetX - slopeFrom[0]);
        plane.style.opacity = "1";
        plane.style.transform = `translate3d(${targetX - PLANE_HALF_W}px, ${targetY - PLANE_HALF_H}px, 0) rotate(${slopeAngle.toFixed(4)}rad)`;
      } else if (phase === "BET") {
        if (liveMultRef.current) liveMultRef.current.textContent = "1.00";
        // Plane parked at runway origin (with idle bob from CSS class)
        const px = padX - PLANE_HALF_W;
        const py = H - padBottom - PLANE_HALF_H * 1.2;
        plane.style.opacity = "1";
        plane.style.transform = `translate3d(${px}px, ${py}px, 0) rotate(0rad)`;
        if (phaseTextRef.current) phaseTextRef.current.style.opacity = "1";
        if (countdownRef.current) {
          countdownRef.current.style.opacity = "1";
          const elapsed = (Date.now() - phaseStartRef.current) / 1000;
          const remaining = Math.max(0, 1 - elapsed / 5);
          countdownRef.current.style.transform = `scaleX(${remaining})`;
        }
        // Soft "runway" line at bottom
        ctx.beginPath();
        ctx.moveTo(padX, H - padBottom);
        ctx.lineTo(W - padX, H - padBottom);
        ctx.strokeStyle = "rgba(255, 200, 87, 0.18)";
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (phase === "GAMEEND") {
        if (liveMultRef.current) liveMultRef.current.textContent = lastCrashRef.current.toFixed(2);
        plane.style.opacity = "0";
        if (countdownRef.current) countdownRef.current.style.opacity = "0";
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const phaseColor =
    GameState === "GAMEEND"
      ? "var(--crash-red)"
      : GameState === "PLAYING"
      ? "var(--text-light)"
      : "var(--text-muted)";

  const phaseClass =
    GameState === "PLAYING" ? "phase-playing" : GameState === "GAMEEND" ? "phase-end" : "phase-bet";

  return (
    <div className={`game-canvas-wrap ${phaseClass}`} ref={wrapRef}>
      <canvas ref={canvasRef} className="game-canvas-bg" />
      <div className="game-canvas-multiplier" style={{ color: phaseColor }}>
        <span ref={liveMultRef}>1.00</span>
        <span className="x-suffix">x</span>
      </div>
      <div className={`game-canvas-flew ${GameState === "GAMEEND" ? "show" : ""}`}>
        FLEW AWAY!
      </div>
      {/* outer = positional transform from RAF; inner = idle/state CSS animations.
          Separating layers prevents CSS keyframes from overwriting position. */}
      <div className="game-canvas-plane" ref={planeRef}>
        <div className="game-canvas-plane-inner">
          <Plane size={56} />
        </div>
      </div>
      <div className="game-canvas-status" ref={phaseTextRef}>
        WAITING FOR NEXT ROUND
      </div>
      <div className="game-canvas-countdown">
        <div className="game-canvas-countdown-bar" ref={countdownRef} />
      </div>
      <FxLayer />
    </div>
  );
};
