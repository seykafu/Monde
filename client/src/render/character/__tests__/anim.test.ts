import { describe, expect, it } from 'vitest';
import { ANIM_TUNING, CharacterAnimator, chooseFacing, type Vec2 } from '../anim';
import { PROCEDURAL_LAYOUT, DEFAULT_LAYOUT, type SheetLayout } from '../sheet';

const FRAME = 1000 / 60;
const PLAYER_SPEED = 4;

/** One 60 fps update: intent held, body moved `speed` tiles/s along `dir` (scaled per axis by `moves`). */
function tick(a: CharacterAnimator, intent: Vec2 | null, moved: Vec2 = { x: 0, y: 0 }, dt = FRAME) {
  return a.step({ intent, moved, dtMs: dt });
}
function walk(a: CharacterAnimator, dir: Vec2, ms: number, speed = PLAYER_SPEED, blockX = false, blockY = false) {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const frames: string[] = [];
  for (let t = 0; t < ms; t += FRAME) {
    const d = (speed * FRAME) / 1000;
    tick(a, dir, { x: blockX ? 0 : (dir.x / len) * d, y: blockY ? 0 : (dir.y / len) * d });
    frames.push(`${a.frame.facing}:${a.frame.kind}${a.frame.index}`);
  }
  return frames;
}
const animator = (layout: SheetLayout = PROCEDURAL_LAYOUT, facing: 'down' | 'left' | 'right' | 'up' = 'down') => new CharacterAnimator(layout, 1, facing);

describe('facing', () => {
  it('follows a cardinal input', () => {
    for (const [dir, facing] of [[{ x: 0, y: 1 }, 'down'], [{ x: -1, y: 0 }, 'left'], [{ x: 1, y: 0 }, 'right'], [{ x: 0, y: -1 }, 'up']] as const) {
      const a = animator(PROCEDURAL_LAYOUT, facing === 'down' ? 'up' : 'down');
      walk(a, dir, 100);
      expect(a.facing).toBe(facing);
    }
  });

  it('keeps the current facing on a diagonal that includes it', () => {
    const a = animator();
    walk(a, { x: 1, y: 0 }, 200);
    expect(walk(a, { x: 1, y: 1 }, 500).every(f => f.startsWith('right:'))).toBe(true);
    walk(a, { x: 0, y: 1 }, 200);
    expect(walk(a, { x: 1, y: 1 }, 500).every(f => f.startsWith('down:'))).toBe(true);
  });

  it('takes the newly pressed axis when the current facing is not part of the diagonal', () => {
    const a = animator();
    walk(a, { x: -1, y: 0 }, 200);           // facing left
    walk(a, { x: 1, y: 1 }, 100);            // x stays pressed (reversed), y is new
    expect(a.facing).toBe('down');
    const b = animator(PROCEDURAL_LAYOUT, 'up');
    walk(b, { x: 1, y: 1 }, 100);            // both pressed at once: the side view
    expect(b.facing).toBe('right');
  });

  it('faces along a wall it slides against, without flicker', () => {
    const a = animator(PROCEDURAL_LAYOUT, 'down');
    // Holding down-right with a wall to the south: only x moves.
    const frames = walk(a, { x: 1, y: 1 }, 1500, PLAYER_SPEED, false, true);
    expect(new Set(frames.map(f => f.split(':')[0]))).toEqual(new Set(['right']));
    expect(frames.some(f => f.includes('walk'))).toBe(true);
  });

  it('faces a wall it pushes against, and does not walk', () => {
    const a = animator(PROCEDURAL_LAYOUT, 'left');
    const frames = walk(a, { x: 0, y: 1 }, 1000, PLAYER_SPEED, true, true);
    expect(a.facing).toBe('down');
    expect(frames.every(f => !f.includes('walk'))).toBe(true);
    expect(a.phase).toBe(0);
  });

  it('swaps axis on an analog direction only once the other axis clearly dominates', () => {
    const deg = (d: number) => ({ x: Math.cos((d * Math.PI) / 180), y: Math.sin((d * Math.PI) / 180) });
    let f = chooseFacing(deg(50).x, deg(50).y, 'right');
    expect(f).toBe('right');
    f = chooseFacing(deg(65).x, deg(65).y, f);
    expect(f).toBe('down');
    f = chooseFacing(deg(40).x, deg(40).y, f);
    expect(f).toBe('down');
    f = chooseFacing(deg(25).x, deg(25).y, f);
    expect(f).toBe('right');
    // A path wobbling either side of 45° never flips.
    let g: ReturnType<typeof chooseFacing> = 'right';
    for (let i = 0; i < 200; i++) { const d = deg(45 + Math.sin(i) * 8); g = chooseFacing(d.x, d.y, g); expect(g).toBe('right'); }
  });

  it('keeps its facing with no intent and no movement', () => {
    const a = animator();
    walk(a, { x: 0, y: -1 }, 200);
    for (let i = 0; i < 30; i++) tick(a, null);
    expect(a.facing).toBe('up');
  });

  it('turns toward someone without walking', () => {
    const a = animator();
    a.faceToward({ x: -3, y: 1 });
    expect(a.frame).toMatchObject({ facing: 'left', kind: 'idle' });
  });
});

describe('walk frames', () => {
  it('advance by distance walked, not by time', () => {
    const fast = animator(), slow = animator();
    walk(fast, { x: 1, y: 0 }, 1000, 4);
    walk(slow, { x: 1, y: 0 }, 1000, 2);
    const stride = PROCEDURAL_LAYOUT.stride;
    expect(fast.phase).toBeCloseTo(4 / stride, 0);
    expect(slow.phase).toBeCloseTo(2 / stride, 0);
  });

  it('cycle through every walk frame in order, starting on a contact', () => {
    const a = animator();
    const frames = walk(a, { x: 1, y: 0 }, 1200).map(f => f.split(':')[1]);
    expect(frames[0]).toBe('walk0');
    const order = frames.filter((f, i) => f !== frames[i - 1]);
    expect(order.slice(0, 6)).toEqual(['walk0', 'walk1', 'walk2', 'walk3', 'walk0', 'walk1']);
  });

  it('do not advance while the body is blocked', () => {
    const a = animator();
    walk(a, { x: 1, y: 0 }, 300);
    const phase = a.phase;
    walk(a, { x: 1, y: 0 }, 1000, PLAYER_SPEED, true, true);
    expect(a.phase).toBeLessThanOrEqual(Math.ceil(phase));
    expect(a.frame.kind).not.toBe('walk');
  });

  it('settle on stopping: hold, feet together on a passing frame, then idle', () => {
    const a = animator();
    // Stop half-way through the first contact.
    walk(a, { x: 1, y: 0 }, 1000 * (0.5 * PROCEDURAL_LAYOUT.stride) / PLAYER_SPEED);
    expect(a.frame).toMatchObject({ kind: 'walk', index: 0 });
    const seen: string[] = [];
    for (let t = 0; t < 400; t += FRAME) { tick(a, null); seen.push(`${a.frame.kind}${a.frame.index}`); }
    const changes = seen.filter((f, i) => f !== seen[i - 1]);
    expect(changes[0]).toBe('walk0');
    expect(changes[1]).toBe('walk1');
    expect(changes[2]).toMatch(/^idle/);
    const settled = seen.findIndex(f => f.startsWith('idle')) * FRAME;
    expect(settled).toBeGreaterThanOrEqual(ANIM_TUNING.holdMs + ANIM_TUNING.settleMs - FRAME);
    expect(settled).toBeLessThan(ANIM_TUNING.holdMs + ANIM_TUNING.settleMs + 3 * FRAME);
  });

  it('ride out a one-frame hitch without flashing to idle', () => {
    const a = animator();
    walk(a, { x: 1, y: 0 }, 300);
    tick(a, { x: 1, y: 0 });
    expect(a.mode).toBe('walk');
    walk(a, { x: 1, y: 0 }, 100);
    expect(a.mode).toBe('walk');
  });

  it('start each walk on the foot that follows the last step taken', () => {
    const a = animator();
    const nextContact = (i: number) => ((Math.floor(i / 2) + 1) * 2) % PROCEDURAL_LAYOUT.walk;
    let last = -1;
    for (let i = 0; i < 6; i++) {
      walk(a, { x: 1, y: 0 }, 1);
      const first = a.frame.index;
      expect(first % 2).toBe(0); // a contact pose
      if (last >= 0) expect(first).toBe(nextContact(last));
      walk(a, { x: 1, y: 0 }, 150 + i * 40);
      for (let t = 0; t < 500; t += FRAME) {
        if (a.frame.kind === 'walk') last = a.frame.index;
        tick(a, null);
      }
      expect(a.mode).toBe('idle');
    }
  });

  it('switch to a run (longer strides) above the run speed, and back below it', () => {
    const a = animator();
    walk(a, { x: 1, y: 0 }, 300, 8);
    expect(a.gait).toBe('run');
    const before = a.phase;
    walk(a, { x: 1, y: 0 }, 1000, 8);
    expect(a.phase - before).toBeCloseTo(8 / (PROCEDURAL_LAYOUT.stride * ANIM_TUNING.runStrideScale), 0);
    walk(a, { x: 1, y: 0 }, 100, ANIM_TUNING.runSpeed * 0.9);
    expect(a.gait).toBe('run');
    walk(a, { x: 1, y: 0 }, 100, 4);
    expect(a.gait).toBe('walk');
  });

  it('treat a teleport as standing still', () => {
    const a = animator();
    tick(a, { x: 1, y: 0 }, { x: 6, y: 0 });
    expect(a.frame.kind).not.toBe('walk');
    expect(a.phase).toBe(0);
  });
});

describe('footfalls', () => {
  /** Walk `ms`, noting each frame's footfalls, foot and shown frame. */
  function steps(a: CharacterAnimator, dir: Vec2, ms: number, speed = PLAYER_SPEED) {
    const out: { t: number; falls: number; foot: 0 | 1; frame: string }[] = [];
    let t = 0;
    for (; t < ms; t += FRAME) {
      const d = (speed * FRAME) / 1000;
      tick(a, dir, { x: dir.x * d, y: dir.y * d });
      out.push({ t, falls: a.footfalls, foot: a.foot, frame: `${a.frame.kind}${a.frame.index}` });
    }
    return out;
  }

  it('land on the contact poses, two per walk cycle, starting with the first frame of a walk', () => {
    for (const layout of [PROCEDURAL_LAYOUT, { ...DEFAULT_LAYOUT, walk: 6, stride: 4 / 12 }, { ...DEFAULT_LAYOUT, walk: 8, stride: 4 / 14 }]) {
      const a = animator(layout);
      const frames = steps(a, { x: 1, y: 0 }, 3000);
      expect(frames[0]!.falls).toBe(1);
      const falls = frames.filter(f => f.falls > 0);
      for (const f of falls) {
        expect(f.falls).toBe(1);
        expect([`walk0`, `walk${layout.walk / 2}`]).toContain(f.frame);
      }
      // Two contacts per cycle of `walk` frames, a frame per `stride` tiles: 3 s at 4 tiles/s.
      const expected = 1 + Math.floor((3 * PLAYER_SPEED) / (layout.stride * layout.walk / 2));
      expect(Math.abs(falls.length - expected)).toBeLessThanOrEqual(1);
    }
  });

  it('alternate feet, and the next walk starts on the other foot', () => {
    const a = animator();
    const feet = steps(a, { x: 0, y: 1 }, 2000).filter(f => f.falls).map(f => f.foot);
    feet.forEach((foot, i) => { if (i) expect(foot).not.toBe(feet[i - 1]); });
    for (let t = 0; t < 600; t += FRAME) tick(a, null);
    const next = steps(a, { x: 0, y: 1 }, 100).find(f => f.falls)!;
    expect(next.foot).not.toBe(feet[feet.length - 1]);
  });

  it('none while pushing a wall, standing, or across a teleport', () => {
    const a = animator();
    walk(a, { x: 1, y: 0 }, 400, PLAYER_SPEED, true, true);
    expect(a.footfalls).toBe(0);
    for (let t = 0; t < 500; t += FRAME) { tick(a, null); expect(a.footfalls).toBe(0); }
    tick(a, { x: 1, y: 0 }, { x: 6, y: 0 });
    expect(a.footfalls).toBe(0);
  });

  it('no extra step for a one-frame hitch mid-walk', () => {
    const a = animator();
    const before = steps(a, { x: 1, y: 0 }, 1000).filter(f => f.falls).length;
    tick(a, { x: 1, y: 0 });
    expect(a.footfalls).toBe(0);
    const frames = steps(a, { x: 1, y: 0 }, 1000);
    // The hitch didn't restart the walk, so no fresh contact on its first frame back.
    expect(frames[0]!.falls).toBe(0);
    expect(Math.abs(frames.filter(f => f.falls).length - before)).toBeLessThanOrEqual(1);
  });
});

describe('idle', () => {
  it('breathes slowly and blinks briefly now and then', () => {
    const a = animator();
    const seen: string[] = [];
    for (let t = 0; t < 12000; t += FRAME) { tick(a, null); seen.push(`${a.frame.kind}${a.frame.index}`); }
    expect(seen).toContain('idle0');
    expect(seen).toContain('idle1');
    // Breathing changes a few times a second at most.
    const changes = seen.filter((f, i) => i > 0 && f !== seen[i - 1] && f.startsWith('idle') && seen[i - 1]!.startsWith('idle')).length;
    expect(changes).toBeLessThan(12 * PROCEDURAL_LAYOUT.idleFps + 2);
    // Blinks: a few, each a handful of frames, only from the resting breath.
    const blinks: number[] = [];
    seen.forEach((f, i) => {
      if (f === 'blink0' && seen[i - 1] !== 'blink0') { blinks.push(1); expect(seen[i - 1]).toBe('idle0'); }
      else if (f === 'blink0') blinks[blinks.length - 1]!++;
    });
    expect(blinks.length).toBeGreaterThanOrEqual(1);
    expect(blinks.length).toBeLessThanOrEqual(5);
    for (const n of blinks) expect(n * FRAME).toBeLessThanOrEqual(ANIM_TUNING.blinkMs + 2 * FRAME);
  });

  it('never blinks on a sheet without a blink column', () => {
    const a = animator(DEFAULT_LAYOUT);
    for (let t = 0; t < 12000; t += FRAME) { tick(a, null); expect(a.frame.kind).toBe('idle'); }
  });

  it('is desynchronised between characters', () => {
    const a = new CharacterAnimator(PROCEDURAL_LAYOUT, 11), b = new CharacterAnimator(PROCEDURAL_LAYOUT, 400);
    let differ = false;
    for (let t = 0; t < 5000; t += FRAME) { tick(a, null); tick(b, null); if (a.frame.index !== b.frame.index) differ = true; }
    expect(differ).toBe(true);
  });
});
