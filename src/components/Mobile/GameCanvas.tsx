import React from "react";
import Context from "../../context";
import { Plane } from "./Plane";
import { FxLayer } from "./FxLayer";
import { planeTracker } from "./planeTracker";
import * as Sounds from "./sounds";

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
  const { GameState, currentNum, time, longDisconnect } = React.useContext(Context);
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
  // Track last server tick so the RAF loop can freeze when stale (e.g.
  // phone screen off → resume after 30 min would show a crazy multiplier).
  const lastTickRef = React.useRef<number>(Date.now());
  const longDisconnectRef = React.useRef<boolean>(false);
  const lastMilestoneRef = React.useRef<number>(0);
  const lastCountdownTickRef = React.useRef<number>(0);

  React.useEffect(() => {
    phaseRef.current = GameState;
    lastTickRef.current = Date.now();
    longDisconnectRef.current = !!longDisconnect;
    const transition = GameState !== lastPhaseRef.current;

    // Re-anchor phase start ONLY on actual phase transitions.
    // Previously this ran on every gameState tick (~100ms), constantly
    // resetting the start time so the local interpolation never advanced.
    // Also: server sends `time` in SECONDS — convert to ms.
    if (transition) {
      if (GameState === "PLAYING" || GameState === "BET") {
        phaseStartRef.current = Date.now() - (time || 0) * 1000;
      }
      // ── Sound triggers on phase transitions ──
      if (GameState === "PLAYING" && lastPhaseRef.current === "BET") {
        Sounds.takeoff();
        lastMilestoneRef.current = 0;
      }
      if (GameState === "GAMEEND") {
        Sounds.crash();
      }
      if (GameState === "BET") {
        lastCountdownTickRef.current = 0;
      }
      lastPhaseRef.current = GameState;
    }

    // Countdown ticks during BET (once per second)
    if (GameState === "BET" && typeof time === "number") {
      const sec = Math.floor(time);
      if (sec > lastCountdownTickRef.current) {
        lastCountdownTickRef.current = sec;
        Sounds.countdownTick();
      }
    }

    // Milestone dings during PLAYING
    if (GameState === "PLAYING" && typeof currentNum === "number") {
      const MILESTONES = [2, 5, 10, 20, 50, 100];
      const m = Number(currentNum);
      for (const ms of MILESTONES) {
        if (m >= ms && lastMilestoneRef.current < ms) {
          Sounds.milestone(ms);
          lastMilestoneRef.current = ms;
          break;
        }
      }
    }

    if (GameState === "GAMEEND") {
      lastCrashRef.current = Number(currentNum) || lastCrashRef.current;
    }
  }, [GameState, time, currentNum, longDisconnect]);

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

      const padX = 28;
      const padBottom = 24;
      const padTop = 30;

      // ---- Trajectory math ----------------------------------------------
      // Concave-UP arc (taxi → take-off):
      //   plane hugs the bottom early then sweeps up to the top-right.
      //   The previous y power 1.4 made the lift-off feel sluggish (only
      //   4% up at m≈2). Bumped to 1.15 so the early segment lifts a bit
      //   faster while keeping the concave-up shape.
      //
      //   progress(m) = (m-1)/(M_PEAK-1)   ∈ [0..1] (clamped)
      //   x_norm = progress^0.45   (x leads — fast horizontal travel)
      //   y_norm = progress^1.15   (y trails — slow rise, sharper at end)
      //
      // At m=2:   progress=0.111 → x≈39%  y≈ 8%   (lifted off the runway)
      // At m=4:   progress=0.333 → x≈61%  y≈28%
      // At m=6:   progress=0.555 → x≈76%  y≈51%
      // At m=8:   progress=0.778 → x≈89%  y≈75%
      // At m=10 (M_PEAK): both 100% — plane reaches top-right corner.
      // For m>M_PEAK the plane "cruises" at the corner with bob+speed
      // lines so it never feels frozen.
      const M_PEAK = 10;
      const progressOf = (m: number) =>
        Math.min(Math.max((m - 1) / (M_PEAK - 1), 0), 1);
      const xAtM = (m: number) =>
        padX + Math.pow(progressOf(m), 0.45) * (W - padX * 2);
      const yAtM = (m: number) =>
        H - padBottom - Math.pow(progressOf(m), 1.15) * (H - padBottom - padTop);

      if (phase === "PLAYING") {
        // Guard: if no server tick for >10s (phone screen off, wifi drop)
        // freeze the multiplier at its last sane value instead of letting
        // the local polynomial run to absurd numbers.
        const tickAge = Date.now() - lastTickRef.current;
        const stale = tickAge > 10_000 || longDisconnectRef.current;

        const elapsed = (Date.now() - phaseStartRef.current) / 1000;
        const m = stale ? multiplierAt((lastTickRef.current - phaseStartRef.current) / 1000) : multiplierAt(elapsed);
        if (liveMultRef.current) liveMultRef.current.textContent = m.toFixed(2);
        if (phaseTextRef.current) phaseTextRef.current.style.opacity = "0";
        if (countdownRef.current) countdownRef.current.style.opacity = "0";

        // ---- Cruising state when plane has reached the corner ----
        // When m exceeds M_PEAK, both x and y are saturated at 1, so the
        // plane would freeze at the corner. We add a tiny vertical bob
        // (sine of time) and draw scrolling speed lines on the canvas
        // background so the plane reads as "still flying through clouds".
        const cruising = m > M_PEAK;
        const cruiseT = cruising ? (Date.now() - phaseStartRef.current) / 1000 : 0;
        const cruiseBobY = cruising ? Math.sin(cruiseT * 4.5) * 4 : 0;
        const cruiseBobX = cruising ? Math.cos(cruiseT * 3.2) * 2 : 0;

        const baseTargetX = xAtM(m);
        const baseTargetY = yAtM(m);
        const targetX = baseTargetX + cruiseBobX;
        const targetY = baseTargetY + cruiseBobY;

        // Sample the curve in MULTIPLIER space (not time) so the trail is
        // a smooth continuous arc that keeps its shape regardless of
        // elapsed time.
        const SAMPLES = 40;
        const pts: [number, number][] = [];
        for (let i = 0; i <= SAMPLES; i++) {
          const k = i / SAMPLES;
          const mk = 1 + k * (m - 1);
          pts.push([xAtM(mk), yAtM(mk)]);
        }

        // ---- Speed lines (only when cruising) ----
        if (cruising) {
          ctx.save();
          const phaseOffset = (cruiseT * 220) % 60;
          ctx.strokeStyle = "rgba(255, 200, 87, 0.35)";
          ctx.lineWidth = 1.4;
          ctx.lineCap = "round";
          for (let yi = 0; yi < 6; yi++) {
            const sy = padTop + 8 + yi * ((H - padTop - padBottom - 16) / 5);
            const sx = ((yi * 73) % 60) - phaseOffset;
            for (let x = sx; x < W; x += 60) {
              ctx.beginPath();
              ctx.moveTo(x, sy);
              ctx.lineTo(x + 18, sy);
              ctx.stroke();
            }
          }
          ctx.restore();
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
        // Use a fixed-pixel slope window so the angle stays geometrically
        // sensible regardless of how the curve is parameterised. With the
        // concave-up mapping the very last samples cluster near vertical;
        // walk back through the trail until we're ~50px away.
        let slopeFrom = pts[0];
        for (let i = pts.length - 2; i >= 0; i--) {
          const dx = targetX - pts[i][0];
          const dy = targetY - pts[i][1];
          if (Math.hypot(dx, dy) >= 50) { slopeFrom = pts[i]; break; }
        }
        let slopeAngle = Math.atan2(targetY - slopeFrom[1], targetX - slopeFrom[0]);
        // Clamp tilt so the plane never points more than ~55° upward.
        slopeAngle = Math.max(slopeAngle, -0.96);
        plane.style.opacity = "1";
        plane.style.transform = `translate3d(${targetX - PLANE_HALF_W}px, ${targetY - PLANE_HALF_H}px, 0) rotate(${slopeAngle.toFixed(4)}rad)`;
        // share plane center % for FxLayer (so crash burst + parachute origin
        // anchor to the actual plane location, not a fixed center)
        planeTracker.x = targetX / W;
        planeTracker.y = targetY / H;
        planeTracker.flying = true;
      } else if (phase === "BET") {
        if (liveMultRef.current) liveMultRef.current.textContent = "1.00";
        // Plane parked at runway origin (with idle bob from CSS class)
        const px = padX - PLANE_HALF_W;
        const py = H - padBottom - PLANE_HALF_H * 1.2;
        plane.style.opacity = "1";
        plane.style.transform = `translate3d(${px}px, ${py}px, 0) rotate(0rad)`;
        planeTracker.x = (px + PLANE_HALF_W) / W;
        planeTracker.y = (py + PLANE_HALF_H) / H;
        planeTracker.flying = false;
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
