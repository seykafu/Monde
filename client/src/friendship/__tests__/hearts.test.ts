import { describe, expect, it } from 'vitest';
import { heartRow, type TurnRegard } from '@monde/shared';
import { HEART_ANIMATION, heartFeedback, heartSteps, playsChime } from '../hearts';
import { EMOTE_CELL, HEART_CELL, emoteIcon, heartIcon, heartIconsFor } from '../icons';

const turn = (before: number, after: number, extra: Partial<TurnRegard> = {}): TurnRegard => ({
  before, after, delta: after - before, hearts_before: 0, hearts_after: 0, first_chat: false, capped: false, ...extra
});
const hearts = (rows: { hearts: number; cracked: boolean }[]) => rows.map(r => (r.cracked ? 'x' : r.hearts));

describe('heart feedback from a TurnRegard (§9.11.2)', () => {
  it('shows nothing for a turn that changes nothing', () => {
    expect(heartFeedback(null)).toBeNull();
    expect(heartFeedback(undefined)).toBeNull();
    expect(heartFeedback(turn(30, 30))).toBeNull();
    // The day's +6 is spent: the reply was judged well but nothing was applied.
    expect(heartFeedback(turn(30, 30, { capped: true }))).toBeNull();
  });

  it('fills half a heart at a time and chimes on a new whole heart', () => {
    const f = heartFeedback(turn(18, 24))!;
    expect(f.kind).toBe('gain');
    expect(f.float).toBe('heart');
    expect(hearts(f.steps)).toEqual([1.5, 2]);
    expect(f.chimes).toEqual([1]);
    expect(f.durationMs).toBe(HEART_ANIMATION.stepMs);
    expect(playsChime(turn(18, 24))).toBe(true);
  });

  it('floats a heart without moving the row when the change stays inside a half heart', () => {
    const f = heartFeedback(turn(21, 22, { first_chat: true }))!;
    expect(hearts(f.steps)).toEqual([2]);
    expect(f.chimes).toEqual([]);
    expect(f.durationMs).toBe(0);
    expect(f.float).toBe('heart');
  });

  it('a half heart is no chime; each whole heart of a big gain is', () => {
    expect(heartFeedback(turn(20, 26))!.chimes).toEqual([]);
    const big = heartFeedback(turn(18, 41))!;
    expect(hearts(big.steps)).toEqual([1.5, 2, 2.5, 3, 3.5, 4]);
    expect(big.chimes.map(i => big.steps[i]!.hearts)).toEqual([2, 3, 4]);
  });

  it('drains for a loss and floats a cracked heart, never chiming', () => {
    const f = heartFeedback(turn(22, 14))!;
    expect(f.kind).toBe('loss');
    expect(f.float).toBe('cracked');
    expect(hearts(f.steps)).toEqual([2, 1.5, 1]);
    expect(f.chimes).toEqual([]);
    expect(playsChime(turn(22, 14))).toBe(false);
  });

  it('ends on the cracked heart when Regard falls below 0, and leaves it when it climbs back', () => {
    expect(hearts(heartFeedback(turn(3, -2))!.steps)).toEqual([0, 'x']);
    expect(hearts(heartFeedback(turn(-1, 6))!.steps)).toEqual(['x', 0, 0.5]);
  });

  it('steps between any two values without repeats', () => {
    for (const [a, b] of [[0, 100], [100, -100], [-30, -10], [55, 55]] as const) {
      const steps = heartSteps(a, b);
      expect(steps[0]).toEqual(heartRow(a));
      expect(steps.at(-1)).toEqual(heartRow(b));
      for (let i = 1; i < steps.length; i++) expect(steps[i]).not.toEqual(steps[i - 1]);
    }
  });
});

describe('heart and emote icons (§9.11.1, §16.5)', () => {
  it('turns a row into ten icons, or one cracked heart', () => {
    expect(heartIconsFor(heartRow(45))).toEqual(['full', 'full', 'full', 'full', 'half', 'empty', 'empty', 'empty', 'empty', 'empty']);
    expect(heartIconsFor(heartRow(100))).toEqual(Array(10).fill('full'));
    expect(heartIconsFor(heartRow(0))).toEqual(Array(10).fill('empty'));
    expect(heartIconsFor(heartRow(-5))).toEqual(['cracked']);
  });

  it('draws hard-edged pixel art of the right size, each kind distinct', () => {
    const opaque = (d: Uint8ClampedArray) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] === 255) n++; else expect(d[i]).toBe(0); return n; };
    const kinds = (['full', 'half', 'empty', 'cracked'] as const).map(k => heartIcon(k));
    for (const art of kinds) {
      expect([art.w, art.h]).toEqual([HEART_CELL.w, HEART_CELL.h]);
      expect(opaque(art.data)).toBeGreaterThan(60);
    }
    const sig = kinds.map(a => Array.from(a.data).join(','));
    expect(new Set(sig).size).toBe(4);
    for (const id of ['heart', 'note', 'ellipsis', 'anger'] as const) {
      const art = emoteIcon(id);
      expect([art.w, art.h]).toEqual([EMOTE_CELL, EMOTE_CELL]);
      expect(opaque(art.data)).toBeGreaterThan(20);
    }
  });
});
