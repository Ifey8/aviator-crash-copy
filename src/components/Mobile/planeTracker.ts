/**
 * Module-level shared state for plane screen coordinates within the canvas
 * wrap. GameCanvas updates this every RAF frame; FxLayer reads it when
 * spawning effects so they anchor to the plane's actual position.
 *
 * Coordinates are normalized 0..1 (% of canvas wrap width/height) so they
 * survive resize without recomputation.
 */
export const planeTracker = {
  /** 0..1 — plane center x within canvas wrap */
  x: 0.05,
  /** 0..1 — plane center y within canvas wrap */
  y: 0.92,
  /** Whether the plane is currently visible (PLAYING) */
  flying: false,
};
