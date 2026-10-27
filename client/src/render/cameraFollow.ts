// The town camera's follow (pure; unit-tested).
//
// The camera's centre chases a goal, the player plus a little look-ahead the way they walk, on a critically damped
// spring (the Game Programming Gems 4 smooth-damp): starting, stopping and stepping up a level ease instead of
// jolting, and it closes on a still goal without overshooting it. The look-ahead builds while walking and falls away
// once the player stops, so the camera settles back on them. The goal is clamped to the board's bounds before the
// spring sees it, so the camera never chases past an edge and lags coming back. Entering a zone, a door or a map
// journey restarts the scene, which places the camera at once (placeFollow); any other jump past `jump` does too.
// Reduced motion: no look-ahead and a much tighter spring. ZoneScene rounds the result to whole device pixels.
// Pure: no Phaser, no DOM.

export interface Vec { x: number; y: number }

/** Feel (art tuning, not game rules). */
export interface FollowTuning {
  /** About how long (s) the spring takes to close on its goal; walking, it trails by speed × this. */
  smoothTime: number;
  /** How far (world px) the goal leads the player while walking: along the screen's x and its y. */
  leadX: number;
  leadY: number;
  /** Time constants (s): the look-ahead building while walking, and falling away once stopped. */
  leadIn: number;
  leadOut: number;
  /** A goal further than this (world px) from the camera is a jump: placed at once, not eased. */
  jump: number;
}

/**
 * The player walks 4 tiles/s, 192 px/s across the screen and 144 px/s up it: the spring trails by about 29 / 22 px,
 * so these leads keep the camera some 20 / 13 px ahead while walking. Stopping, it drifts on ~10 px, then settles
 * back on the player inside a second.
 */
export const FOLLOW: FollowTuning = { smoothTime: 0.15, leadX: 48, leadY: 34, leadIn: 0.35, leadOut: 0.12, jump: 480 };
export const FOLLOW_REDUCED: FollowTuning = { ...FOLLOW, smoothTime: 0.07, leadX: 0, leadY: 0 };

/** The camera's centre (world px), its velocity (px/s) and the current look-ahead (px). */
export interface FollowState { x: number; y: number; vx: number; vy: number; lx: number; ly: number }

/** Put the camera's centre at `at`, still. */
export function placeFollow(at: Vec): FollowState {
  return { x: at.x, y: at.y, vx: 0, vy: 0, lx: 0, ly: 0 };
}

/**
 * Advance the follow `dtMs`. `heading` is the way the player moved this frame in world px (any length; zero when
 * standing or pushing a wall). `clamp` keeps a camera centre inside the bounds. Mutates and returns `s`.
 */
export function stepFollow(s: FollowState, player: Vec, heading: Vec, dtMs: number, tuning: FollowTuning, clamp: (p: Vec) => Vec = p => p): FollowState {
  const dt = dtMs / 1000;
  if (!(dt > 0)) return s;
  const len = Math.hypot(heading.x, heading.y), moving = len > 1e-6;
  const k = 1 - Math.exp(-dt / (moving ? tuning.leadIn : tuning.leadOut));
  s.lx += ((moving ? (heading.x / len) * tuning.leadX : 0) - s.lx) * k;
  s.ly += ((moving ? (heading.y / len) * tuning.leadY : 0) - s.ly) * k;
  const goal = clamp({ x: player.x + s.lx, y: player.y + s.ly });
  if (Math.hypot(goal.x - s.x, goal.y - s.y) > tuning.jump) return Object.assign(s, placeFollow(clamp(player)));
  [s.x, s.vx] = smoothDamp(s.x, goal.x, s.vx, tuning.smoothTime, dt);
  [s.y, s.vy] = smoothDamp(s.y, goal.y, s.vy, tuning.smoothTime, dt);
  return s;
}

/**
 * One step of a critically damped spring from `current` toward `target` (Unity's SmoothDamp: stable at any frame
 * time, and it never passes a target it is closing on). Returns the new value and velocity (per second).
 */
export function smoothDamp(current: number, target: number, velocity: number, smoothTime: number, dt: number): [number, number] {
  const omega = 2 / Math.max(1e-4, smoothTime), x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target, temp = (velocity + omega * change) * dt;
  const out = target + (change + temp) * decay;
  if (target - current > 0 === out > target) return [target, 0];
  return [out, (velocity - omega * temp) * decay];
}

/** A scroll rounded to whole device pixels at `zoom` (device px per world px), so no art pixel shimmers. */
export const toDevicePixel = (v: number, zoom: number): number => Math.round(v * zoom) / zoom;
