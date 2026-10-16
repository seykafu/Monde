// The lighthouse beam (GDD §16.4: "the lighthouse beam once relit", a world light). Pure: no Phaser, no DOM.
//
// Point Lumière's lamp turns slowly; seen on the ¾ board its beam is a long wedge of light swinging round the
// lantern room, foreshortened as it points up or down the screen (north–south on the ground reads shorter).
// Art tuning, not game rules: the GDD gives no turn rate.

/** Seconds per turn. A slow, readable sweep. */
export const BEAM_PERIOD = 14;
/** How much the ground's north–south axis is foreshortened on screen (tile depth / tile width). */
export const BEAM_SQUASH = 0.75;
/** The beam's half-width at its far end, radians on the ground: what a stone must lie within to flash. */
export const BEAM_HALF_ANGLE = 0.11;

/** The beam's heading on the ground at time t (radians, 0 = east, π/2 = south, turning clockwise on screen). */
export const beamHeading = (t: number, period = BEAM_PERIOD): number => ((t / period) * Math.PI * 2) % (Math.PI * 2);

/** The beam on screen for a ground heading: its rotation and how long it looks (1 east–west, SQUASH north–south). */
export function beamOnScreen(heading: number, squash = BEAM_SQUASH): { rotation: number; length: number } {
  const dx = Math.cos(heading), dy = Math.sin(heading) * squash;
  return { rotation: Math.atan2(dy, dx), length: Math.hypot(dx, dy) };
}

/** The ground heading from the lantern to a point (screen px offsets), undoing the foreshortening. */
export const headingTo = (dx: number, dy: number, squash = BEAM_SQUASH): number => {
  const a = Math.atan2(dy / squash, dx);
  return a < 0 ? a + Math.PI * 2 : a;
};

/** 0..1: how squarely the beam falls on something at `target` (a heading); 1 dead on, 0 outside the beam. */
export function beamHit(heading: number, target: number, half = BEAM_HALF_ANGLE): number {
  let d = Math.abs(heading - target) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d >= half ? 0 : 1 - d / half;
}
