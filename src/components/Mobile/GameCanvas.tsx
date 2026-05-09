import React from "react";
import Context from "../../context";
import { Plane } from "./Plane";

/**
 * GameCanvas — the centerpiece. Draws:
 *   1. animated starfield + parallax sky gradient (canvas)
 *   2. the curved trajectory the plane has flown so far (canvas)
 *   3. the plane sprite (DOM, transform-only — GPU accelerated)
 *
 * Smoothness:
 *   - Backend ticks every ~100ms; we run a 60fps RAF loop and interpolate the
 *     multiplier locally using the same polynomial the server uses, so the
 *     plane glides instead of stepping.
 *   - All motion is `transform: translate3d` (GPU compositing); canvas only
 *     redraws the trail (a single 2D path).
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

  // Phase tracking that the RAF loop reads without re-renders
  const phaseStartRef = React.useRef<number>(Date.now());
  const phaseRef = React.useRef<string>(GameState || "BET");
  const lastCrashRef = React.useRef<number>(1.0);

  React.useEffect(() => {
    phaseRef.current = GameState;
    if (GameState === "PLAYING") {
      phaseStartRef.current = Date.now() - (time || 0);
    } else if (GameState === "BET") {
      phaseStartRef.current = Date.now() - (time || 0);
    } else if (GameState === "GAMEEND") {
      lastCrashRef.current = Number(currentNum) || 1.0;
    }
  }, [GameState, time, currentNum]);

  // Canvas trail + RAF animation
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const plane = planeRef.current;
    if (!canvas || !wrap || !plane) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let dpr = window.devicePixelRatio || 1;

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

    const loop = () => {
      const r = wrap.getBoundingClientRect();
      const W = r.width;
      const H = r.height;
      const phase = phaseRef.current;

      ctx.clearRect(0, 0, W, H);

      if (phase === "PLAYING") {
        const elapsed = (Date.now() - phaseStartRef.current) / 1000;
        const m = multiplierAt(elapsed);
        if (liveMultRef.current) liveMultRef.current.textContent = m.toFixed(2);
        if (phaseTextRef.current) phaseTextRef.current.style.opacity = "0";
        if (countdownRef.current) countdownRef.current.style.opacity = "0";

        // Map (multiplier, time) → screen coords
        // x grows over time (capped), y rises with multiplier (capped)
        const tNorm = Math.min(elapsed / 8, 1); // x maxes around 8s
        const mNorm = Math.min((m - 1) / 4, 1); // y maxes around 5x
        // Plane terminus
        const padX = 28;
        const padBottom = 20;
        const targetX = padX + tNorm * (W - padX * 2);
        const targetY = H - padBottom - mNorm * (H - padBottom - 28);

        // Draw curve from origin to plane
        ctx.beginPath();
        ctx.moveTo(padX, H - padBottom);
        // build a smooth curve: sample points using same parametric eq
        const SAMPLES = 28;
        for (let i = 1; i <= SAMPLES; i++) {
          const k = i / SAMPLES;
          const tk = k * elapsed;
          const mk = multiplierAt(tk);
          const xk = padX + Math.min(tk / 8, 1) * (W - padX * 2);
          const yk = H - padBottom - Math.min((mk - 1) / 4, 1) * (H - padBottom - 28);
          ctx.lineTo(xk, yk);
        }
        // Fill trail (semi-transparent)
        ctx.lineTo(targetX, H - padBottom);
        ctx.lineTo(padX, H - padBottom);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, H - padBottom, 0, 0);
        grad.addColorStop(0, "rgba(255, 153, 51, 0.0)");
        grad.addColorStop(0.6, "rgba(255, 153, 51, 0.22)");
        grad.addColorStop(1, "rgba(255, 200, 87, 0.42)");
        ctx.fillStyle = grad;
        ctx.fill();

        // Stroke the curve — gold-saffron with glow
        ctx.beginPath();
        ctx.moveTo(padX, H - padBottom);
        for (let i = 1; i <= SAMPLES; i++) {
          const k = i / SAMPLES;
          const tk = k * elapsed;
          const mk = multiplierAt(tk);
          const xk = padX + Math.min(tk / 8, 1) * (W - padX * 2);
          const yk = H - padBottom - Math.min((mk - 1) / 4, 1) * (H - padBottom - 28);
          ctx.lineTo(xk, yk);
        }
        const lineGrad = ctx.createLinearGradient(padX, H - padBottom, targetX, targetY);
        lineGrad.addColorStop(0, "rgba(255, 153, 51, 0.85)");
        lineGrad.addColorStop(1, "rgba(255, 200, 87, 1)");
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 2.4;
        ctx.shadowColor = "rgba(255, 200, 87, 0.85)";
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Plane: position via transform
        const angle = -Math.atan2(
          (H - padBottom - targetY) - (H - padBottom - (H - padBottom - 6)),
          targetX - padX,
        );
        plane.style.opacity = "1";
        plane.style.transform = `translate3d(${targetX - 28}px, ${targetY - 16}px, 0) rotate(${
          angle * 0.45
        }rad)`;
      } else if (phase === "BET") {
        // Idle: plane parked at origin, multiplier "1.00"
        if (liveMultRef.current) liveMultRef.current.textContent = "1.00";
        const padX = 28;
        const padBottom = 20;
        plane.style.opacity = "1";
        plane.style.transform = `translate3d(${padX - 28}px, ${H - padBottom - 28}px, 0) rotate(0rad)`;
        if (phaseTextRef.current) phaseTextRef.current.style.opacity = "1";
        if (countdownRef.current) {
          // 5s BET window — show shrinking bar
          countdownRef.current.style.opacity = "1";
          const elapsed = (Date.now() - phaseStartRef.current) / 1000;
          const remaining = Math.max(0, 1 - elapsed / 5);
          countdownRef.current.style.transform = `scaleX(${remaining})`;
        }
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

  return (
    <div className="game-canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="game-canvas-bg" />
      <div className="game-canvas-multiplier" style={{ color: phaseColor }}>
        <span ref={liveMultRef}>1.00</span>
        <span className="x-suffix">x</span>
      </div>
      <div className={`game-canvas-flew ${GameState === "GAMEEND" ? "show" : ""}`}>
        FLEW AWAY!
      </div>
      <div className="game-canvas-plane" ref={planeRef}>
        <Plane size={56} />
      </div>
      <div className="game-canvas-status" ref={phaseTextRef}>
        WAITING FOR NEXT ROUND
      </div>
      <div className="game-canvas-countdown">
        <div className="game-canvas-countdown-bar" ref={countdownRef} />
      </div>
    </div>
  );
};
