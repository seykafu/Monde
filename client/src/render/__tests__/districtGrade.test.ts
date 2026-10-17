import { describe, expect, it } from 'vitest';
import { districtGrade, easeRestoration, gradeMatrix, gradeTint, restorationShare } from '../districtGrade';
describe('district restoration (§16.1)', () => {
  it('uses both landmark openings and occupied homes, without diluting an absent category', () => {
    expect(restorationShare([false, false], [true, false])).toBe(0.25);
    expect(restorationShare([true, false], [true, false])).toBe(0.5);
    expect(restorationShare([], [true])).toBe(1);
    expect(restorationShare([], [])).toBe(0);
  });
  it('moves from cool/desaturated/dim to warm/saturated/clean, bounded at endpoints', () => {
    const faded = districtGrade(0), restored = districtGrade(1);
    for (const key of ['saturation', 'warmth', 'brightness'] as const) expect(restored[key]).toBeGreaterThan(faded[key]);
    expect(faded.saturation).toBeLessThan(1); expect(faded.warmth).toBeLessThan(0);
    expect(restored.saturation).toBeGreaterThan(1); expect(restored.warmth).toBeGreaterThan(0);
    expect(districtGrade(-20)).toEqual(faded); expect(districtGrade(NaN)).toEqual(faded);
    expect(districtGrade(20)).toEqual(restored);
    expect(districtGrade(1, true).warmth).toBeCloseTo(restored.warmth / 2);
  });
  it('eases independently of frame rate, reaches 95% after three seconds and snaps with reduced motion', () => {
    let value = 0;
    for (let n = 0; n < 180; n++) value = easeRestoration(value, 1, 1000 / 60, false);
    expect(value).toBeCloseTo(easeRestoration(0, 1, 3000, false));
    expect(value).toBeCloseTo(0.9502, 3);
    expect(easeRestoration(0, 1, 16, true)).toBe(1);
  });
  it('preserves alpha and transforms existing weather-lit pixels rather than replacing their tint', () => {
    const identity = gradeMatrix({ saturation: 1, warmth: 0, brightness: 1 });
    expect(identity).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
    const matrix = gradeMatrix(districtGrade(0));
    expect(matrix.slice(15)).toEqual([0, 0, 0, 1, 0]);
    const transform = (rgb: number[]) => [0, 1, 2].map(row => rgb.reduce((v, c, col) => v + c * matrix[row * 5 + col]!, 0));
    const day = transform([1, 0.8, 0.6]), night = transform([0.3, 0.24, 0.18]);
    night.forEach((n, i) => expect(n).toBeCloseTo(day[i]! * 0.3));
    expect(gradeTint(districtGrade(0))).not.toBe(gradeTint(districtGrade(1)));
  });
});
