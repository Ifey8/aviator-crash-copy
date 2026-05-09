import React from "react";

/**
 * Original SVG plane with separately-rotating propeller. Sized 64×40 viewBox;
 * scales via CSS. Stylized cartoon look — not derived from any commercial asset.
 */
export const Plane: React.FC<{ size?: number }> = ({ size = 56 }) => (
  <svg
    width={size}
    height={(size * 40) / 64}
    viewBox="0 0 64 40"
    style={{ overflow: "visible" }}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="bodyG" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#ff5468" />
        <stop offset="100%" stopColor="#a01530" />
      </linearGradient>
      <linearGradient id="wingG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ff7588" />
        <stop offset="100%" stopColor="#c12244" />
      </linearGradient>
      <radialGradient id="prop" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0%" stopColor="rgba(255,255,255,0.85)" />
        <stop offset="60%" stopColor="rgba(255,255,255,0.20)" />
        <stop offset="100%" stopColor="rgba(255,255,255,0)" />
      </radialGradient>
    </defs>

    {/* tail */}
    <path
      d="M50 14 L60 8 L60 14 L52 18 Z"
      fill="url(#wingG)"
      stroke="#5a0815"
      strokeWidth="0.6"
    />
    {/* body */}
    <path
      d="M6 22 Q14 14 32 14 L52 14 Q58 14 58 20 L58 24 Q58 28 52 28 L20 28 Q10 28 6 24 Z"
      fill="url(#bodyG)"
      stroke="#5a0815"
      strokeWidth="0.7"
    />
    {/* main wing */}
    <path
      d="M22 22 Q28 30 38 32 L48 30 Q42 24 36 22 Z"
      fill="url(#wingG)"
      stroke="#5a0815"
      strokeWidth="0.6"
    />
    {/* cockpit window */}
    <path
      d="M30 18 Q34 16 42 16 L46 16 L48 20 L40 22 Q34 22 30 20 Z"
      fill="#9be7ff"
      stroke="#3a90b8"
      strokeWidth="0.5"
      opacity="0.85"
    />
    {/* propeller hub */}
    <circle cx="6" cy="22" r="1.6" fill="#222" />
    {/* spinning propeller — animated via CSS */}
    <g className="prop-spin" style={{ transformOrigin: "6px 22px" }}>
      <ellipse cx="6" cy="22" rx="2" ry="9" fill="url(#prop)" />
      <ellipse cx="6" cy="22" rx="9" ry="2" fill="url(#prop)" />
    </g>
  </svg>
);
