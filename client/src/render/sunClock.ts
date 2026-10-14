// Adapter: the clock's sun (sim/sunAngle) → the board's sun shadow (render/sun).
//
// render/sun.ts was ported with one fixed low afternoon sun. Monde's shadows
// rotate with the clock (GDD §16.4), so this turns a sun position into the
// same `Sun` record castFrom() already understands: lean, length, opacity.
// Pure math (no Phaser import), so it is tested with the sim.
//
// The board is seen from the south: screen-up is north, screen-right is east,
// and north–south distances on the ground are foreshortened to the tile
// aspect (36/48). A shadow points away from the sun and lies on that ground.

import { SUN, type Sun } from './sun';
import { DIORAMA_TILE_H, DIORAMA_TILE_W } from './dioramaConfig';
import type { SunPosition } from '../sim/sunAngle';

const GROUND_ASPECT = DIORAMA_TILE_H / DIORAMA_TILE_W;
const DEG = Math.PI / 180;

/**
 * Shadow length is the true cot(elevation), scaled so a mid-spring noon
 * (42°, pointing straight up the board) lands near the 0.55 the ported board
 * was tuned with. Clamped: a low sun's true shadow runs off across the street.
 */
export const SHADOW_LENGTH_SCALE = 0.7;
export const SHADOW_MIN_SQUASH = 0.2;
export const SHADOW_MAX_SQUASH = 1.5;
/** Shadows fade out over the last few degrees before the sun touches the horizon. */
export const SHADOW_FADE_ELEVATION = 6;

/**
 * The cast shadow for the sun at `sun`. `shade` (0..1) is how much direct sun
 * gets through the weather: 1 on a clear day, low under rain or fog. Writes into
 * `out` (allocation-free per frame) and returns it. Alpha 0 with the sun down.
 */
export const sunShadow = (sun: SunPosition, shade = 1, out: Sun = { ...SUN }): Sun => {
  const bearing = (sun.azimuth + 180) * DEG;
  const dx = Math.sin(bearing);
  const dy = -GROUND_ASPECT * Math.cos(bearing);
  const len = Math.hypot(dx, dy);
  // Upright rotated clockwise by θ points along (sin θ, −cos θ): see render/sun.
  out.angle = Math.atan2(dx, -dy) / DEG;
  const elevation = Math.max(1, sun.elevation);
  let squash = (SHADOW_LENGTH_SCALE * len) / Math.tan(elevation * DEG);
  squash = Math.min(SHADOW_MAX_SQUASH, Math.max(SHADOW_MIN_SQUASH, squash));
  // A shadow thrown toward the camera is shortened, as torchShadow does: it
  // would otherwise lie across the face of the raised tile in front.
  const forward = Math.max(0, dy / len);
  out.squash = squash * (1 - 0.55 * forward);
  out.alpha = SUN.alpha * Math.max(0, Math.min(1, shade)) * Math.max(0, Math.min(1, sun.elevation / SHADOW_FADE_ELEVATION));
  return out;
};
