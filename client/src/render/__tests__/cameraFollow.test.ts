import { describe, expect, it } from 'vitest';
import { FOLLOW, FOLLOW_REDUCED, placeFollow, smoothDamp, stepFollow, toDevicePixel, type FollowState, type FollowTuning, type Vec } from '../cameraFollow';

const FRAME = 1000 / 60;
/** The player's walk on screen: 4 tiles/s over 48 × 36 px tiles. */
const ACROSS = 192, UP = 144;

/** Walk `ms` at `velocity` px/s (zero: stand), stepping the camera each frame; the player's last position. */
function walk(s: FollowState, from: Vec, velocity: Vec, ms: number, tuning: FollowTuning = FOLLOW, frame = FRAME, clamp?: (p: Vec) => Vec): Vec {
  const p = { ...from };
  for (let t = 0; t < ms - 1e-9; t += frame) {
    const dx = (velocity.x * frame) / 1000, dy = (velocity.y * frame) / 1000;
    p.x += dx; p.y += dy;
    stepFollow(s, p, { x: dx, y: dy }, frame, tuning, clamp);
  }
  return p;
}

describe('smoothDamp', () => {
  it('closes on a still target without passing it, at any frame time', () => {
    for (const dt of [1 / 240, 1 / 60, 1 / 20, 0.25]) {
      let x = 0, v = 0, last = 0;
      for (let t = 0; t < 1.5; t += dt) {
        [x, v] = smoothDamp(x, 100, v, 0.15, dt);
        expect(x).toBeLessThanOrEqual(100);
        expect(x).toBeGreaterThanOrEqual(last);
        last = x;
      }
      expect(x).toBeGreaterThan(99.5);
    }
  });

  it('does not pass a still target even when arriving fast', () => {
    let x = 0, v = 2000;
    for (let i = 0; i < 60; i++) { [x, v] = smoothDamp(x, 50, v, 0.15, 1 / 60); expect(x).toBeLessThanOrEqual(50); }
  });
});

describe('camera follow', () => {
  it('stays put on a still player, and places at once', () => {
    const s = placeFollow({ x: 300, y: 200 });
    expect(s).toEqual({ x: 300, y: 200, vx: 0, vy: 0, lx: 0, ly: 0 });
    walk(s, { x: 300, y: 200 }, { x: 0, y: 0 }, 1000);
    expect(s.x).toBe(300);
    expect(s.y).toBe(200);
  });

  it('eases rather than snaps: the first frame of a walk moves the camera less than the player', () => {
    const s = placeFollow({ x: 0, y: 0 });
    const p = walk(s, { x: 0, y: 0 }, { x: ACROSS, y: 0 }, FRAME);
    expect(s.x).toBeGreaterThan(0);
    expect(s.x).toBeLessThan(p.x);
  });

  it('looks ahead the way the player walks, a little', () => {
    for (const [velocity, axis] of [[{ x: ACROSS, y: 0 }, 'x'], [{ x: -ACROSS, y: 0 }, 'x'], [{ x: 0, y: UP }, 'y'], [{ x: 0, y: -UP }, 'y']] as const) {
      const s = placeFollow({ x: 0, y: 0 });
      const p = walk(s, { x: 0, y: 0 }, velocity, 2000);
      const ahead = axis === 'x' ? (s.x - p.x) * Math.sign(velocity.x) : (s.y - p.y) * Math.sign(velocity.y);
      expect(ahead).toBeGreaterThan(8);
      expect(ahead).toBeLessThan(40);
      // Nothing sideways.
      expect(Math.abs(axis === 'x' ? s.y - p.y : s.x - p.x)).toBeLessThan(1e-6);
    }
  });

  it('settles back on the player within a second of stopping, without swinging past them', () => {
    const s = placeFollow({ x: 0, y: 0 });
    const p = walk(s, { x: 0, y: 0 }, { x: ACROSS, y: UP }, 2000);
    let minAhead = Infinity;
    for (let t = 0; t < 1000; t += FRAME) {
      stepFollow(s, p, { x: 0, y: 0 }, FRAME, FOLLOW);
      minAhead = Math.min(minAhead, s.x - p.x, s.y - p.y);
    }
    expect(minAhead).toBeGreaterThan(-0.5);
    expect(Math.abs(s.x - p.x)).toBeLessThan(0.5);
    expect(Math.abs(s.y - p.y)).toBeLessThan(0.5);
  });

  it('runs the same at 30, 60 and 144 fps', () => {
    const ends = [1000 / 30, 1000 / 60, 1000 / 144].map(frame => {
      const s = placeFollow({ x: 0, y: 0 });
      const p = walk(s, { x: 0, y: 0 }, { x: ACROSS, y: 0 }, 1200, FOLLOW, frame);
      return s.x - p.x;
    });
    // Within a world pixel or two (30 fps samples the walk in 6 px steps).
    for (const e of ends) expect(Math.abs(e - ends[1]!)).toBeLessThan(2.5);
  });

  it('reduced motion: no look-ahead, a tighter follow', () => {
    const s = placeFollow({ x: 0, y: 0 });
    const p = walk(s, { x: 0, y: 0 }, { x: ACROSS, y: 0 }, 2000, FOLLOW_REDUCED);
    expect(s.lx).toBe(0);
    expect(s.x).toBeLessThanOrEqual(p.x);
    expect(p.x - s.x).toBeLessThan(ACROSS * FOLLOW_REDUCED.smoothTime + 1);
    for (let t = 0; t < 300; t += FRAME) stepFollow(s, p, { x: 0, y: 0 }, FRAME, FOLLOW_REDUCED);
    expect(Math.abs(s.x - p.x)).toBeLessThan(0.5);
  });

  it('never chases past the bounds, so it leaves an edge at once', () => {
    const clamp = (q: Vec) => ({ x: Math.min(q.x, 500), y: q.y });
    const s = placeFollow({ x: 400, y: 0 });
    let p = walk(s, { x: 400, y: 0 }, { x: ACROSS, y: 0 }, 2000, FOLLOW, FRAME, clamp);
    expect(s.x).toBeLessThanOrEqual(500);
    expect(s.x).toBeGreaterThan(499.5);
    // Back from beyond the edge: by the time the player is back at it, the camera has already left it.
    while (p.x > 500) p = walk(s, p, { x: -ACROSS, y: 0 }, FRAME, FOLLOW, FRAME, clamp);
    expect(s.x).toBeLessThan(499);
  });

  it('places at once across a jump', () => {
    const s = placeFollow({ x: 0, y: 0 });
    stepFollow(s, { x: 2000, y: -900 }, { x: 2000, y: -900 }, FRAME, FOLLOW);
    expect(s).toEqual({ x: 2000, y: -900, vx: 0, vy: 0, lx: 0, ly: 0 });
  });

  it('ignores a frame with no time', () => {
    const s = placeFollow({ x: 5, y: 5 });
    stepFollow(s, { x: 50, y: 50 }, { x: 1, y: 0 }, 0, FOLLOW);
    expect(s).toEqual(placeFollow({ x: 5, y: 5 }));
  });
});

describe('device pixels', () => {
  it('rounds a scroll to whole device pixels at the town (2) and room (3) zooms', () => {
    for (const zoom of [2, 3]) for (const v of [0, 0.1, 0.26, 17.49, 17.51, -3.3, 1234.567]) {
      const snapped = toDevicePixel(v, zoom);
      expect(Math.abs(snapped * zoom - Math.round(snapped * zoom))).toBeLessThan(1e-9);
      expect(Math.abs(snapped - v)).toBeLessThanOrEqual(0.5 / zoom + 1e-9);
    }
  });
});
