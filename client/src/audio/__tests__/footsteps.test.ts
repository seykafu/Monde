import { describe, expect, it } from 'vitest';
import { STEP_TUNING, TOWN_STEP, residentStepLevel, stepSurface, stepVoice } from '../footsteps';
import { TERRAIN_INFO, TOWN_TERRAINS } from '../../world/townTerrain';

const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; };

describe('step surface', () => {
  it('maps the town ground as it sounds underfoot', () => {
    for (const k of ['cobble', 'brick', 'plaza', 'steps', 'flags', 'tile'] as const) expect(stepSurface({ kind: k, terrain: 'stone' })).toBe('cobble');
    for (const k of ['boards', 'floor'] as const) expect(stepSurface({ kind: k, terrain: 'wood' })).toBe('boards');
    for (const k of ['grass', 'meadow'] as const) expect(stepSurface({ kind: k, terrain: 'grass' })).toBe('grass');
    for (const k of ['sand', 'wet_sand', 'rug'] as const) expect(stepSurface({ kind: k, terrain: 'sand' })).toBe('soft');
    for (const k of ['shingle', 'gravel'] as const) expect(stepSurface({ kind: k, terrain: 'rubble' })).toBe('gravel');
  });

  it('has a sound for every walkable kind and none for water or walls', () => {
    for (const kind of TOWN_TERRAINS) {
      const info = TERRAIN_INFO[kind];
      if (info.walkable) expect(TOWN_STEP[kind]).not.toBeNull();
      else expect(TOWN_STEP[kind]).toBeNull();
    }
  });

  it('falls back to the greybox terrain, and to nothing off the board', () => {
    expect(stepSurface({ terrain: 'wood' })).toBe('boards');
    expect(stepSurface({ terrain: 'grass' })).toBe('grass');
    expect(stepSurface({ terrain: 'rubble' })).toBe('gravel');
    expect(stepSurface({ terrain: 'cobblestone' })).toBe('cobble');
    expect(stepSurface({ terrain: 'water' })).toBeNull();
    expect(stepSurface(undefined)).toBeNull();
  });
});

describe('step voice', () => {
  it('drifts a little in pitch and level, and never repeats exactly', () => {
    const rng = seeded(7), T = STEP_TUNING;
    const voices = Array.from({ length: 200 }, (_, i) => stepVoice((i % 2) as 0 | 1, rng));
    for (const v of voices) {
      expect(v.pitch).toBeGreaterThan((1 - T.footSpread) * (1 - T.pitchJitter) - 1e-9);
      expect(v.pitch).toBeLessThan((1 + T.footSpread) * (1 + T.pitchJitter) + 1e-9);
      expect(v.level).toBeGreaterThanOrEqual(T.levelMin);
      expect(v.level).toBeLessThanOrEqual(T.levelMax);
    }
    expect(new Set(voices.map(v => v.pitch.toFixed(6))).size).toBeGreaterThan(195);
  });

  it('sets the two feet a touch apart', () => {
    const mean = (foot: 0 | 1) => { const rng = seeded(3); let sum = 0; for (let i = 0; i < 400; i++) sum += stepVoice(foot, rng).pitch; return sum / 400; };
    expect(mean(1) - mean(0)).toBeCloseTo(STEP_TUNING.footSpread, 2);
  });

  it('scales by the walker\'s level', () => {
    const a = stepVoice(0, seeded(5), 1), b = stepVoice(0, seeded(5), 0.25);
    expect(b.level).toBeCloseTo(a.level * 0.25);
    expect(b.pitch).toBe(a.pitch);
  });
});

describe('resident steps', () => {
  it('are quieter than the player\'s and fade out with distance', () => {
    expect(residentStepLevel(0)).toBe(STEP_TUNING.residentLevel);
    expect(residentStepLevel(1)).toBe(STEP_TUNING.residentLevel);
    let last = Infinity;
    for (let d = 0; d <= 10; d += 0.25) {
      const level = residentStepLevel(d);
      expect(level).toBeLessThanOrEqual(last);
      expect(level).toBeLessThan(1);
      last = level;
    }
    expect(residentStepLevel(STEP_TUNING.residentRange)).toBe(0);
    expect(residentStepLevel(Infinity)).toBe(0);
    expect(residentStepLevel(NaN)).toBe(0);
  });
});
