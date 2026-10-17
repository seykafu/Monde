import { describe, expect, it } from 'vitest';
import { percentile, frameStatistics } from '../statistics';

describe('performance statistics', () => {
  it('interpolates sorted ranks without mutating samples', () => {
    const values = [40, 10, 30, 20];
    expect(percentile(values, 0)).toBe(10);
    expect(percentile(values, 1)).toBe(40);
    expect(percentile(values, 0.5)).toBe(25);
    expect(percentile(values, 0.95)).toBeCloseTo(38.5);
    expect(percentile([7], 0.99)).toBe(7);
    expect(values).toEqual([40, 10, 30, 20]);
  });
  it('reports time-weighted mean fps and the fifth percentile of per-frame fps', () => {
    const result = frameStatistics([10, 20, 50, 100]);
    expect(result.fpsMean).toBeCloseTo(4000 / 180);
    expect(result.fpsP5).toBeCloseTo(11.5);
    expect(result.frameMsP50).toBe(35);
    expect(result.frameMsP95).toBeCloseTo(92.5);
    expect(result.frameMsP99).toBeCloseTo(98.5);
    expect(result.longFramesOver50Ms).toBe(1);
    expect(frameStatistics(Array(120).fill(1000 / 60)).fpsMean).toBeCloseTo(60);
  });
  it('handles no samples and rejects invalid input', () => {
    expect(frameStatistics([])).toMatchObject({ fpsMean: null, fpsP5: null, frames: 0, longFramesOver50Ms: 0 });
    for (const n of [0, -1, NaN, Infinity]) expect(() => frameStatistics([n])).toThrow(RangeError);
    expect(() => percentile([NaN], 0.5)).toThrow(RangeError);
    expect(() => percentile([1], 1.1)).toThrow(RangeError);
  });
});
