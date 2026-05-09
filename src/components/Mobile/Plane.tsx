import React from "react";

/**
 * Indian-aesthetic festive mascot plane.
 *
 * Original design generated via Claude Design from a custom prompt for a
 * cute Bollywood/Diwali-style cartoon airplane mascot. Palette: saffron
 * #FF9933, marigold gold #FFC857, deep crimson #C12244, royal navy #1E3A8A.
 *
 * - <g id={`body-${id}`}> stays still
 * - <g id={`prop-${id}`}> spins via CSS keyframe (transform-origin in viewBox)
 * - id suffix prevents collision when several planes are on the page
 *   (header logo + main canvas + cashout pop)
 *
 * ViewBox 0 0 120 80 — keep these intrinsic units; size with the `size` prop.
 */

let _uid = 0;
const useUid = () => {
  const ref = React.useRef<string | null>(null);
  if (ref.current === null) ref.current = `pl${++_uid}`;
  return ref.current;
};

interface PlaneProps {
  /** Width in CSS pixels (height auto-derived from 120:80 ratio). */
  size?: number;
  /** Disable propeller spin — useful for the static logo glyph. */
  static?: boolean;
  /** Show the soft saffron halo behind the plane. */
  halo?: boolean;
}

export const Plane: React.FC<PlaneProps> = ({
  size = 88,
  static: isStatic = false,
  halo = true,
}) => {
  const id = useUid();
  const ratio = 80 / 120;
  return (
    <svg
      width={size}
      height={size * ratio}
      viewBox="0 0 120 80"
      style={{ overflow: "visible" }}
      aria-hidden="true"
      className={`plane-svg ${isStatic ? "plane-static" : ""}`}
    >
      <defs>
        <radialGradient id={`bodyG-${id}`} cx="42%" cy="32%" r="78%">
          <stop offset="0%" stopColor="#FFE3A1" />
          <stop offset="40%" stopColor="#FFC857" />
          <stop offset="78%" stopColor="#FF9933" />
          <stop offset="100%" stopColor="#D86A1B" />
        </radialGradient>
        <radialGradient id={`noseG-${id}`} cx="35%" cy="45%" r="80%">
          <stop offset="0%" stopColor="#FFB36A" />
          <stop offset="55%" stopColor="#E85A4C" />
          <stop offset="100%" stopColor="#9B1A36" />
        </radialGradient>
        <radialGradient id={`finG-${id}`} cx="50%" cy="35%" r="80%">
          <stop offset="0%" stopColor="#E04A60" />
          <stop offset="100%" stopColor="#9B1A36" />
        </radialGradient>
        <radialGradient id={`wingG-${id}`} cx="55%" cy="25%" r="85%">
          <stop offset="0%" stopColor="#3B5BB8" />
          <stop offset="65%" stopColor="#1E3A8A" />
          <stop offset="100%" stopColor="#10215A" />
        </radialGradient>
        <radialGradient id={`cockpitG-${id}`} cx="32%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor="#E7EEFC" />
          <stop offset="100%" stopColor="#9FB2DA" />
        </radialGradient>
        <radialGradient id={`hubG-${id}`} cx="38%" cy="32%" r="80%">
          <stop offset="0%" stopColor="#FFF1B8" />
          <stop offset="55%" stopColor="#FFC857" />
          <stop offset="100%" stopColor="#9F6A0A" />
        </radialGradient>
        <radialGradient id={`haloG-${id}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFC857" stopOpacity="0.55" />
          <stop offset="55%" stopColor="#FF9933" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#FF9933" stopOpacity="0" />
        </radialGradient>
        <filter id={`shadow-${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.4" />
          <feOffset dx="0" dy="1.2" />
          <feComponentTransfer>
            <feFuncA type="linear" slope="0.45" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {halo && (
        <ellipse cx="58" cy="44" rx="58" ry="22" fill={`url(#haloG-${id})`} />
      )}

      {/* ----------- BODY (everything except the spinning propeller) ----------- */}
      <g filter={`url(#shadow-${id})`}>
        {/* horizontal tail stabilizer */}
        <path
          d="M 10,44 Q 4,40 8,34 L 22,36 L 22,46 L 10,48 Q 6,46 10,44 Z"
          fill={`url(#wingG-${id})`}
          stroke="#FFC857"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
        {/* vertical fin */}
        <path
          d="M 20,30 L 24,12 Q 28,9 34,11 L 38,30 Z"
          fill={`url(#finG-${id})`}
          stroke="#FFC857"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
        {/* saffron stripe across fin */}
        <path d="M 22.6,22 L 36.4,22" stroke="#FF9933" strokeWidth="2.4" strokeLinecap="round" />
        <path
          d="M 22.6,22 L 36.4,22"
          stroke="#FFC857"
          strokeWidth="0.6"
          strokeLinecap="round"
          opacity="0.9"
        />

        {/* main wing — swept-back paddle */}
        <path
          d="M 38,50 Q 56,52 76,52 Q 72,70 50,72 Q 30,72 28,60 Q 30,50 38,50 Z"
          fill={`url(#wingG-${id})`}
          stroke="#FFC857"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />

        {/* paisley swirl decoration on wing */}
        <g
          stroke="#FFC857"
          strokeWidth="0.9"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 48,64 C 50,58 60,57 64,62 C 67,66 64,69 60,69 C 56,69 54,67 54,65 C 54,63 56,63 57,64" />
          <circle cx="57.6" cy="64.4" r="0.9" fill="#FFC857" stroke="none" />
          <circle cx="66" cy="60.5" r="0.7" fill="#FFC857" stroke="none" />
        </g>

        {/* fuselage */}
        <path
          d="M 18,42 C 16,32 26,28 34,28 L 78,28 C 90,28 96,34 96,42 C 96,50 90,56 78,56 L 34,56 C 26,56 16,52 18,42 Z"
          fill={`url(#bodyG-${id})`}
          stroke="#9F6A0A"
          strokeWidth="1"
          strokeLinejoin="round"
        />

        {/* crimson nose accent */}
        <path
          d="M 74,28 L 78,28 C 90,28 96,34 96,42 C 96,50 90,56 78,56 L 74,56 C 82,48 84,36 74,28 Z"
          fill={`url(#noseG-${id})`}
          opacity="0.95"
        />
        <path
          d="M 78.5,28.4 C 76,40 76,44 78.5,55.6"
          stroke="#FFC857"
          strokeWidth="0.9"
          fill="none"
          strokeLinecap="round"
        />

        {/* gold trim lines */}
        <path
          d="M 24,52 Q 60,58 92,50"
          stroke="#FFC857"
          strokeWidth="1.1"
          fill="none"
          strokeLinecap="round"
          opacity="0.9"
        />
        <path
          d="M 38,30 Q 58,28 70,29"
          stroke="#FFC857"
          strokeWidth="0.9"
          fill="none"
          strokeLinecap="round"
          opacity="0.85"
        />

        {/* cockpit */}
        <path
          d="M 50,32 Q 52,29 58,29 L 68,30 Q 71,33 71,38 Q 70,42 64,43 L 54,42 Q 49,40 50,32 Z"
          fill={`url(#cockpitG-${id})`}
          stroke="#1E3A8A"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path
          d="M 51.5,33 Q 52.5,30.5 57.5,30.5 L 67.5,31.5"
          stroke="#FFC857"
          strokeWidth="0.7"
          fill="none"
          strokeLinecap="round"
          opacity="0.9"
        />
        <path
          d="M 53.5,33.6 Q 56,32.5 60.5,33"
          stroke="#FFFFFF"
          strokeWidth="1.1"
          fill="none"
          strokeLinecap="round"
          opacity="0.9"
        />

        {/* rivet dots */}
        <circle cx="32" cy="42" r="0.9" fill="#9F6A0A" opacity="0.8" />
        <circle cx="40" cy="42" r="0.9" fill="#9F6A0A" opacity="0.8" />
        <circle cx="48" cy="50" r="0.9" fill="#9F6A0A" opacity="0.8" />

        {/* propeller hub */}
        <circle cx="98" cy="42" r="4.8" fill={`url(#hubG-${id})`} stroke="#9F6A0A" strokeWidth="1" />
        <circle cx="98" cy="42" r="2.6" fill="#C12244" stroke="#FFC857" strokeWidth="0.6" />
        <circle cx="98" cy="42" r="0.9" fill="#FFE3A1" />
      </g>

      {/* ----------- PROPELLER (spins via CSS) ----------- */}
      <g
        className={`plane-prop ${isStatic ? "" : "spin"}`}
        style={{ transformOrigin: "98px 42px", transformBox: "fill-box" }}
      >
        <g opacity="0.95">
          <ellipse
            cx="98"
            cy="32"
            rx="2.2"
            ry="9"
            fill={`url(#wingG-${id})`}
            stroke="#FFC857"
            strokeWidth="0.7"
          />
          <ellipse
            cx="98"
            cy="32"
            rx="2.2"
            ry="9"
            fill={`url(#wingG-${id})`}
            stroke="#FFC857"
            strokeWidth="0.7"
            transform="rotate(120 98 42)"
          />
          <ellipse
            cx="98"
            cy="32"
            rx="2.2"
            ry="9"
            fill={`url(#wingG-${id})`}
            stroke="#FFC857"
            strokeWidth="0.7"
            transform="rotate(240 98 42)"
          />
        </g>
        <circle cx="98" cy="42" r="1.4" fill="#FFC857" />
      </g>
    </svg>
  );
};
