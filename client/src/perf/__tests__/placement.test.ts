import { describe, expect, it } from 'vitest';
import { crowdRoutes, sampleCrowdRoute } from '../placement';

describe('performance crowd placement', () => {
  const walk = [[true, false, true], [true, true, true]];
  it('uses visible walkable cells, deterministically, and returns the requested count', () => {
    const routes = crowdRoutes(walk, 60, p => p.x < 2);
    expect(routes).toHaveLength(60);
    expect(routes).toEqual(crowdRoutes(walk, 60, p => p.x < 2));
    for (const route of routes) for (const p of route) {
      expect(walk[Math.floor(p.y)]![Math.floor(p.x)]).toBe(true);
      expect(p.x).toBeLessThan(2);
    }
  });
  it('spreads across available cells', () => {
    const routes = crowdRoutes([Array(20).fill(true)], 2, () => true);
    expect(routes[1]![0]!.x).toBeGreaterThan(9);
  });
  it('fails explicitly if nothing can be shown or count is invalid', () => {
    expect(crowdRoutes([], 0, () => true)).toEqual([]);
    expect(() => crowdRoutes(walk, 1, () => false)).toThrow('No visible');
    for (const n of [-1, 1.5, Infinity, 501]) expect(() => crowdRoutes(walk, n, () => true)).toThrow(RangeError);
  });
  it('walks continuously along a closed route using the resident path sampler', () => {
    const route = crowdRoutes(walk, 1, () => true)[0]!;
    expect(sampleCrowdRoute(route, 0, 0).at).toEqual(route[0]);
    expect(sampleCrowdRoute(route, 50, 0).at).not.toEqual(route[0]);
    for (let ms = 0; ms < 20000; ms += 17) {
      const { at, dir } = sampleCrowdRoute(route, ms, 0);
      expect(at.x).toBeGreaterThanOrEqual(route[0]!.x);
      expect(at.x).toBeLessThanOrEqual(route[1]!.x);
      expect(dir).not.toBeNull();
    }
  });
});
