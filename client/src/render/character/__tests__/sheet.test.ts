import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, PROCEDURAL_LAYOUT, REFERENCE_SPEED, frameFor, layoutFrom, parseManifest } from '../sheet';
import manifest from '../../../../public/assets/sprites/manifest.json';

describe('sprite manifest', () => {
  it('ships valid (empty until drawn sheets land)', () => {
    const problems: string[] = [];
    parseManifest(manifest, problems);
    expect(problems).toEqual([]);
  });

  it('reads `true` and meta objects, and drops bad entries with a reason', () => {
    const problems: string[] = [];
    const m = parseManifest({
      player: true,
      odile: { idle: 0, fps: { walk: 8 }, json: true },
      bad: 'yes',
      '../escape': true,
      tib: { rows: ['down', 'sideways'], walk: 6 },
      off: false
    }, problems);
    expect([...m.keys()]).toEqual(['player', 'odile', 'tib']);
    expect(m.get('player')).toEqual({});
    expect(m.get('odile')).toEqual({ idle: 0, fps: { walk: 8 }, json: true });
    expect(m.get('tib')).toEqual({ walk: 6 }); // the bad field is dropped, the good one kept
    expect(problems.join('\n')).toMatch(/bad/);
    expect(problems.join('\n')).toMatch(/escape/);
    expect(problems.join('\n')).toMatch(/tib\.rows/);
  });

  it('rejects a manifest that is not an object', () => {
    const problems: string[] = [];
    expect(parseManifest([], problems).size).toBe(0);
    expect(problems).toHaveLength(1);
  });
});

describe('sheet layout', () => {
  it('defaults to GDD §16.5: four rows, idle 2, walk 4, 32×48 cells', () => {
    expect(layoutFrom({})).toEqual(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT).toMatchObject({ rows: ['down', 'left', 'right', 'up'], idle: 2, walk: 4, frameWidth: 32, frameHeight: 48, footY: 48 });
  });

  it('turns fps.walk (at the player pace) into a stride, and lays `<id>.json` over the manifest entry', () => {
    expect(layoutFrom({ fps: { walk: 8 } }).stride).toBeCloseTo(REFERENCE_SPEED / 8);
    const l = layoutFrom({ idle: 0, fps: { walk: 8, idle: 1 } }, { idle: 2, fps: { walk: 10 } });
    expect(l.idle).toBe(2);
    expect(l.stride).toBeCloseTo(REFERENCE_SPEED / 10);
    expect(l.idleFps).toBe(1);
    expect(layoutFrom({ frameHeight: 40, scale: 1.5 })).toMatchObject({ frameHeight: 40, footY: 40, scale: 1.5 });
  });

  it('refuses layouts it cannot index', () => {
    expect(() => layoutFrom({ walk: 1 })).toThrow();
    expect(() => layoutFrom({ rows: ['down', 'up'] })).toThrow();
    expect(() => layoutFrom({ idle: 1, blink: true })).toThrow();
  });
});

describe('frameFor', () => {
  it('numbers cells row-major: idle columns, then walk columns', () => {
    const L = DEFAULT_LAYOUT; // 6 columns
    expect(frameFor(L, 'down', 'idle', 0)).toEqual({ frame: 0, flipX: false });
    expect(frameFor(L, 'down', 'idle', 3)).toEqual({ frame: 1, flipX: false });
    expect(frameFor(L, 'right', 'walk', 2)).toEqual({ frame: 2 * 6 + 2 + 2, flipX: false });
    expect(frameFor(L, 'up', 'walk', 5)).toEqual({ frame: 3 * 6 + 2 + 1, flipX: false });
  });

  it('mirrors the side row a sheet leaves out', () => {
    const three = layoutFrom({ rows: ['down', 'right', 'up'] });
    expect(frameFor(three, 'right', 'walk', 0)).toEqual({ frame: 6 + 2, flipX: false });
    expect(frameFor(three, 'left', 'walk', 0)).toEqual({ frame: 6 + 2, flipX: true });
    const leftOnly = layoutFrom({ rows: ['down', 'left', 'up'] });
    expect(frameFor(leftOnly, 'right', 'idle', 1)).toEqual({ frame: 6 + 1, flipX: true });
  });

  it('stands a walk-only sheet on its first passing frame', () => {
    const walkOnly = layoutFrom({ idle: 0 });
    expect(frameFor(walkOnly, 'down', 'idle', 0)).toEqual({ frame: 1, flipX: false });
    expect(frameFor(walkOnly, 'left', 'blink', 0)).toEqual({ frame: 4 + 1, flipX: false });
  });

  it('puts the blink in the last idle column, outside the breathing cycle', () => {
    const P = PROCEDURAL_LAYOUT; // idle 3 (2 breaths + blink), walk 4
    expect(frameFor(P, 'down', 'blink', 0).frame).toBe(2);
    expect(frameFor(P, 'down', 'idle', 2).frame).toBe(0);
    expect(frameFor(P, 'left', 'walk', 0).frame).toBe(7 + 3);
  });
});
