// Which frame a walking character shows: facing, walk cycle and idle (pure; unit-tested).
//
// Facing comes from intent (the input vector, a resident's path direction, or toward a talk partner),
// with any axis the body couldn't move along dropped, so pushing diagonally along a wall faces along
// the wall. Diagonals keep the current facing while it is still one of the two directions pressed
// (Zelda's rule: no flicker), and an analog direction only swaps axis once the other axis clearly
// dominates (hysteresis). When neither axis is the current facing, the axis pressed most recently wins.
//
// Walk frames advance by distance actually travelled, never by time, so feet don't skate when the
// body is blocked or slowed. A walk starts on a contact pose and the next walk starts on the other
// foot. Stopping holds the last frame for a moment (so a one-frame hitch doesn't flash to idle),
// brings the feet together on a passing frame, then settles into the idle.
// Idle breathes at the sheet's idle rate and, where the sheet has one, blinks every few seconds.
// A footfall is a foot coming down: the walk reaching a contact pose (starting a walk plants one), so
// footstep sounds land on the frames the feet do.
// Pure: no Phaser, no DOM.

import type { Facing, FrameKind, SheetLayout } from './sheet';
import { breathFrames } from './sheet';

export type Gait = 'walk' | 'run';
export type AnimMode = 'idle' | 'walk' | 'settle';

export interface Vec2 { x: number; y: number }

export interface AnimInput {
  /** Where the character means to go or look (any length; zero or null for no intent). */
  intent?: Vec2 | null;
  /** How far the body actually moved this update, tiles. */
  moved: Vec2;
  dtMs: number;
}

/** Feel (art tuning, not game rules). */
export const ANIM_TUNING = {
  /** Slower than this (tiles/s) counts as standing. */
  minWalkSpeed: 0.3,
  /** At or above this speed (tiles/s) the gait is a run (the player walks at 4; residents hurry up to ~13). */
  runSpeed: 5.6,
  /** Back to a walk below runSpeed × this. */
  runHysteresis: 0.85,
  /** A run takes longer strides. */
  runStrideScale: 1.35,
  /** A jump further than this in one update (tiles) is a teleport: no walk frames for it. */
  teleport: 1.5,
  /** After the body stops: hold the last walk frame this long, then a passing frame this long, then idle. */
  holdMs: 90,
  settleMs: 110,
  /** An analog direction swaps to the other axis once that axis is this much bigger (≈ 59° / 31°). */
  keepRatio: 0.6,
  /** Blinks: every 2.6–5 s, for this long. */
  blinkEveryMs: 2600,
  blinkJitterMs: 2400,
  blinkMs: 130
} as const;

export interface AnimFrame { facing: Facing; kind: FrameKind; index: number }

const AXIS_EPS = 1e-4;

export class CharacterAnimator {
  facing: Facing;
  mode: AnimMode = 'idle';
  gait: Gait = 'walk';
  /** Walk frames advanced (fractional); the frame is floor(phase) mod walk. */
  phase = 0;
  /** Feet that came down during the last step() (almost always 0 or 1). */
  footfalls = 0;
  /** Which foot came down last: 0 on the walk's first contact pose, 1 on the one halfway through. */
  foot: 0 | 1 = 0;
  private idleMs: number;
  private stillMs = 0;
  private settleFrame = 1;
  private nextBlinkMs: number;
  private blinkLeftMs = 0;
  private prevAxes = { x: false, y: false };
  private recentAxis: 'x' | 'y' | null = null;
  private rng: number;

  /** `seed` desynchronises idles and blinks between characters. */
  constructor(private readonly layout: SheetLayout, seed = 0, facing: Facing = 'down') {
    this.facing = facing;
    this.rng = (seed >>> 0) || 1;
    this.idleMs = (seed % 997) * 7;
    this.nextBlinkMs = ANIM_TUNING.blinkEveryMs + this.random() * ANIM_TUNING.blinkJitterMs;
  }

  /** Advance one update. */
  step(input: AnimInput): this {
    const dt = Math.max(0, input.dtMs);
    this.footfalls = 0;
    const moved = input.moved, dist = Math.hypot(moved.x, moved.y);
    const teleported = dist > ANIM_TUNING.teleport;
    this.face(input.intent ?? null, teleported ? { x: 0, y: 0 } : moved);
    const speed = dt > 0 ? (dist / dt) * 1000 : 0;
    if (!teleported && speed >= ANIM_TUNING.minWalkSpeed) this.walk(dist, speed);
    else this.rest(dt, teleported);
    return this;
  }

  /** The frame to show now. */
  get frame(): AnimFrame {
    const L = this.layout;
    if (this.mode === 'walk') return { facing: this.facing, kind: 'walk', index: Math.floor(this.phase) % L.walk };
    if (this.mode === 'settle') return { facing: this.facing, kind: 'walk', index: this.settleFrame };
    if (this.blinkLeftMs > 0 && L.blink) return { facing: this.facing, kind: 'blink', index: 0 };
    const breaths = breathFrames(L);
    const index = breaths > 1 ? Math.floor((this.idleMs / 1000) * L.idleFps) % breaths : 0;
    return { facing: this.facing, kind: 'idle', index };
  }

  /** Turn to face a direction without walking (e.g. toward someone talking). */
  faceToward(dir: Vec2): this {
    this.face(dir, { x: 0, y: 0 });
    return this;
  }

  // ── Facing ────────────────────────────────────────────────────────────────

  private face(intent: Vec2 | null, moved: Vec2): void {
    let dx = intent?.x ?? 0, dy = intent?.y ?? 0;
    const ax = Math.abs(dx) > AXIS_EPS, ay = Math.abs(dy) > AXIS_EPS;
    // Most recently pressed axis (for ties): one that just switched on while the other didn't.
    const newX = ax && !this.prevAxes.x, newY = ay && !this.prevAxes.y;
    if (newX !== newY) this.recentAxis = newX ? 'x' : 'y';
    else if (newX || (!ax && !ay)) this.recentAxis = null;
    this.prevAxes = { x: ax, y: ay };
    const mx = Math.abs(moved.x) > AXIS_EPS, my = Math.abs(moved.y) > AXIS_EPS;
    if (!ax && !ay) {
      // No intent: face the way the body went, if it went anywhere.
      if (!mx && !my) return;
      dx = moved.x; dy = moved.y;
    } else if (mx !== my) {
      // Moving along one axis only: drop an intended axis the body couldn't move along (a wall).
      if (!mx) dx = 0;
      if (!my) dy = 0;
      if (dx === 0 && dy === 0) { dx = moved.x; dy = moved.y; }
    }
    this.facing = chooseFacing(dx, dy, this.facing, this.recentAxis);
  }

  // ── Walking and standing ──────────────────────────────────────────────────

  private walk(dist: number, speed: number): void {
    const T = ANIM_TUNING, L = this.layout;
    if (speed >= T.runSpeed) this.gait = 'run';
    else if (speed < T.runSpeed * T.runHysteresis) this.gait = 'walk';
    const half = L.walk / 2;
    if (this.mode !== 'walk') {
      // Start on the next contact pose after where the last walk stopped, so the feet alternate.
      const at = Math.floor(this.phase);
      this.phase = Math.ceil((at + (this.mode === 'settle' ? 1 : 0)) / half) * half;
      this.mode = 'walk';
      this.land(this.phase / half);
    }
    this.stillMs = 0;
    this.idleMs = 0;
    this.blinkLeftMs = 0;
    const stride = L.stride * (this.gait === 'run' ? T.runStrideScale : 1);
    // Contacts sit at every multiple of `half`; the wrap below is a whole number of cycles, so none is skipped or doubled.
    const before = Math.floor(this.phase / half);
    this.phase += dist / stride;
    const after = Math.floor(this.phase / half);
    if (after > before) this.land(after, after - before);
    this.phase %= L.walk * 64;
  }

  /** A foot comes down on contact number `contact` (counted in half cycles). */
  private land(contact: number, count = 1): void {
    this.footfalls += count;
    this.foot = (Math.round(contact) % 2) as 0 | 1;
  }

  private rest(dt: number, teleported: boolean): void {
    const T = ANIM_TUNING, L = this.layout;
    if (teleported) { this.toIdle(); return; }
    if (this.mode === 'walk') {
      this.stillMs += dt;
      if (this.stillMs < T.holdMs) return;
      const at = Math.floor(this.phase) % L.walk, half = L.walk / 2;
      // Feet apart (a contact or near it): bring them together on the passing frame that follows.
      if (at % half === 0) { this.mode = 'settle'; this.settleFrame = (at + 1) % L.walk; this.stillMs = 0; return; }
      this.toIdle();
      return;
    }
    if (this.mode === 'settle') {
      this.stillMs += dt;
      if (this.stillMs >= T.settleMs) this.toIdle();
      return;
    }
    this.idleMs += dt;
    if (this.blinkLeftMs > 0) this.blinkLeftMs = Math.max(0, this.blinkLeftMs - dt);
    this.nextBlinkMs -= dt;
    if (this.nextBlinkMs <= 0) {
      // Blink only on the resting breath, so the blink frame never jumps the body by a pixel.
      if (this.frame.index === 0) this.blinkLeftMs = T.blinkMs;
      this.nextBlinkMs = T.blinkEveryMs + this.random() * T.blinkJitterMs;
    }
  }

  private toIdle(): void {
    if (this.mode === 'settle') this.phase = this.settleFrame;
    this.mode = 'idle';
    this.gait = 'walk';
    this.stillMs = 0;
    this.idleMs = 0;
  }

  private random(): number {
    let x = this.rng;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 4294967296;
  }
}

/**
 * The 4-way facing for a direction, given the current one. Keeps `current` while its axis still carries
 * at least `keepRatio` of the other (so exact diagonals and wobbly analog paths don't flicker); else
 * the dominant axis; a tie goes to the most recently pressed axis, then to the side view.
 */
export function chooseFacing(dx: number, dy: number, current: Facing, recentAxis: 'x' | 'y' | null = null): Facing {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax <= AXIS_EPS && ay <= AXIS_EPS) return current;
  const alongX: Facing = dx > 0 ? 'right' : 'left', alongY: Facing = dy > 0 ? 'down' : 'up';
  const k = ANIM_TUNING.keepRatio;
  if (ax > AXIS_EPS && current === alongX && ax >= ay * k) return current;
  if (ay > AXIS_EPS && current === alongY && ay >= ax * k) return current;
  if (Math.abs(ax - ay) <= 1e-6 * Math.max(ax, ay)) return recentAxis === 'y' ? alongY : alongX;
  return ax > ay ? alongX : alongY;
}
