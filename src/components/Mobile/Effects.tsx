import React from "react";

/**
 * Festive effect SVG kit. All originals; Indian palette.
 *   Parachute  — 5 colour variants for cash-out flutter-down animation.
 *   BurstSuccess — small radiant sparkle + check, for bet-placed feedback.
 *   BurstCrash  — large Diwali firework, for round-end crash.
 */

let _uid = 0;
const useUid = (): string => {
  const ref = React.useRef<string | null>(null);
  if (ref.current === null) ref.current = `fx${++_uid}`;
  return ref.current;
};

/* ------------------------------------------------------------------ */
/*  PARACHUTE                                                         */
/* ------------------------------------------------------------------ */

interface ParachuteProps {
  /** 0..4 — cycles colour combos */
  variant?: number;
  size?: number;
  /** Optional label drawn above the figure (player name etc) */
  label?: string;
  /** Optional payout shown under the figure */
  payout?: string;
}

const PALETTES = [
  { a: "#FF9933", b: "#FFC857", c: "#C12244", figure: "#FFC857" }, // saffron / gold
  { a: "#C12244", b: "#FFC857", c: "#1E3A8A", figure: "#FF9933" }, // crimson / gold
  { a: "#1E3A8A", b: "#FF9933", c: "#FFC857", figure: "#FF9933" }, // navy / saffron
  { a: "#1DA0AA", b: "#E63995", c: "#FFC857", figure: "#FFC857" }, // peacock / magenta
  { a: "#E63995", b: "#2FCEA5", c: "#FFC857", figure: "#FFC857" }, // magenta / mint
];

export const Parachute: React.FC<ParachuteProps> = ({
  variant = 0,
  size = 56,
  label,
  payout,
}) => {
  const id = useUid();
  const p = PALETTES[variant % PALETTES.length];
  // Eight alternating canopy panels using two colors
  const panels: React.ReactElement[] = [];
  const cx = 30;
  const cy = 30;
  const r = 26;
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a1 = -Math.PI + (i / N) * Math.PI;
    const a2 = -Math.PI + ((i + 1) / N) * Math.PI;
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy + Math.sin(a1) * r;
    const x2 = cx + Math.cos(a2) * r;
    const y2 = cy + Math.sin(a2) * r;
    panels.push(
      <path
        key={i}
        d={`M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 0,1 ${x2},${y2} Z`}
        fill={i % 2 === 0 ? p.a : p.b}
        stroke={p.c}
        strokeWidth="0.6"
        strokeLinejoin="round"
      />,
    );
  }

  return (
    <svg
      width={size}
      height={(size * 80) / 60}
      viewBox="0 0 60 80"
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`canopy-${id}`} cx="50%" cy="35%" r="60%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.4)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <radialGradient id={`fig-${id}`} cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor={p.figure} />
          <stop offset="100%" stopColor={p.c} />
        </radialGradient>
      </defs>
      {/* canopy */}
      <g>
        {panels}
        {/* gloss highlight */}
        <ellipse
          cx="22"
          cy="22"
          rx="14"
          ry="6"
          fill={`url(#canopy-${id})`}
          opacity="0.9"
        />
        {/* gold trim along bottom edge */}
        <path
          d={`M ${cx - r},${cy} A ${r},${r} 0 0,1 ${cx + r},${cy}`}
          fill="none"
          stroke="#FFC857"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </g>
      {/* strings */}
      <g stroke="rgba(255,255,255,0.7)" strokeWidth="0.7" fill="none">
        <line x1="6" y1="30" x2="26" y2="56" />
        <line x1="18" y1="30" x2="28" y2="56" />
        <line x1="30" y1="30" x2="30" y2="56" />
        <line x1="42" y1="30" x2="32" y2="56" />
        <line x1="54" y1="30" x2="34" y2="56" />
      </g>
      {/* figure */}
      <g>
        <ellipse cx="30" cy="62" rx="6" ry="7" fill={`url(#fig-${id})`} stroke={p.c} strokeWidth="0.7" />
        {/* face */}
        <circle cx="28" cy="60" r="0.7" fill="#2a1408" />
        <circle cx="32" cy="60" r="0.7" fill="#2a1408" />
        <path d="M 28,63 Q 30,64.4 32,63" stroke="#2a1408" strokeWidth="0.6" fill="none" strokeLinecap="round" />
      </g>
      {/* optional text overlay */}
      {label && (
        <text x="30" y="76" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff" stroke="#000" strokeWidth="0.4" paintOrder="stroke">
          {label}
        </text>
      )}
      {payout && (
        <text x="30" y="11" textAnchor="middle" fontSize="6" fontWeight="800" fill="#FFC857" stroke="#5a2a0c" strokeWidth="0.5" paintOrder="stroke">
          {payout}
        </text>
      )}
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/*  BET SUCCESS BURST                                                 */
/* ------------------------------------------------------------------ */

export const BurstSuccess: React.FC<{ size?: number }> = ({ size = 80 }) => {
  const id = useUid();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`succ-disc-${id}`} cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#7CF7B5" />
          <stop offset="60%" stopColor="#2ECC71" />
          <stop offset="100%" stopColor="#1E8449" />
        </radialGradient>
        <radialGradient id={`succ-rim-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFC857" />
          <stop offset="100%" stopColor="#FF9933" />
        </radialGradient>
      </defs>
      {/* 8 sparkle stars radiating */}
      {[...Array(8)].map((_, i) => {
        const a = (i / 8) * Math.PI * 2;
        const x = 40 + Math.cos(a) * 30;
        const y = 40 + Math.sin(a) * 30;
        return (
          <g
            key={i}
            transform={`translate(${x} ${y}) rotate(${(a * 180) / Math.PI})`}
          >
            <path
              d="M 0,-4 L 1,-1 L 4,0 L 1,1 L 0,4 L -1,1 L -4,0 L -1,-1 Z"
              fill="#FFC857"
              opacity="0.95"
            />
          </g>
        );
      })}
      {/* gold rim disc */}
      <circle cx="40" cy="40" r="20" fill={`url(#succ-rim-${id})`} />
      {/* green inner disc */}
      <circle cx="40" cy="40" r="17" fill={`url(#succ-disc-${id})`} stroke="#FFC857" strokeWidth="1" />
      {/* checkmark */}
      <path
        d="M 31,40 L 38,47 L 51,33"
        fill="none"
        stroke="#fff"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/*  CRASH BURST (Diwali firework)                                     */
/* ------------------------------------------------------------------ */

export const BurstCrash: React.FC<{ size?: number }> = ({ size = 220 }) => {
  const id = useUid();
  // 12 radiating spokes
  const spokes: React.ReactElement[] = [];
  const cx = 60;
  const cy = 60;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * 14;
    const y1 = cy + Math.sin(a) * 14;
    const x2 = cx + Math.cos(a) * 50;
    const y2 = cy + Math.sin(a) * 50;
    spokes.push(
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={i % 2 === 0 ? "#FF9933" : "#FFC857"}
        strokeWidth="3"
        strokeLinecap="round"
      />,
    );
  }
  // confetti petals
  const petals: React.ReactElement[] = [];
  const PETAL = 18;
  for (let i = 0; i < PETAL; i++) {
    const a = (i / PETAL) * Math.PI * 2 + (i % 2) * 0.2;
    const r = 30 + (i % 3) * 8;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    petals.push(
      <ellipse
        key={i}
        cx={x}
        cy={y}
        rx="2.4"
        ry="3.2"
        fill={["#C12244", "#FF9933", "#FFC857", "#E63995"][i % 4]}
        opacity="0.88"
        transform={`rotate(${(a * 180) / Math.PI + 30} ${x} ${y})`}
      />,
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`core-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="40%" stopColor="#FFE3A1" />
          <stop offset="80%" stopColor="#FF9933" />
          <stop offset="100%" stopColor="rgba(255,153,51,0)" />
        </radialGradient>
      </defs>
      {/* outer halo */}
      <circle cx={cx} cy={cy} r="55" fill="rgba(255,153,51,0.16)" />
      {spokes}
      {petals}
      {/* central white-hot core */}
      <circle cx={cx} cy={cy} r="14" fill={`url(#core-${id})`} />
      {/* sparkle stars */}
      {[
        [20, 24],
        [98, 28],
        [104, 96],
        [16, 100],
        [60, 12],
        [60, 108],
      ].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path
            d="M 0,-5 L 1.2,-1.2 L 5,0 L 1.2,1.2 L 0,5 L -1.2,1.2 L -5,0 L -1.2,-1.2 Z"
            fill="#FFE3A1"
          />
        </g>
      ))}
    </svg>
  );
};
