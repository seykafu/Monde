import { describe, expect, it } from 'vitest';
import { boxShadow, buildingHeight, convexHull, insidePolygon, lineRects, sunShear } from '../castShadow';
import { E, N, S, W } from '../lineArt';
import { TH, TW } from '../autotile';
import { shadeTint } from '../../sun';

const foot = { x0: 100, y0: 200, x1: 196, y1: 308 };
const xs = (p: { x: number }[]) => p.map(q => q.x), ys = (p: { y: number }[]) => p.map(q => q.y);

describe('town sun shadows', () => {
  it('turns the sun lean into a ground shear: straight up the board at noon, sideways when the sun is low', () => {
    const noon = sunShear({ angle: 0, squash: 0.6 });
    expect(noon.k1).toBeCloseTo(0);
    expect(noon.k2).toBeCloseTo(0.6);
    const evening = sunShear({ angle: 90, squash: 1.2 });
    expect(evening.k1).toBeCloseTo(1.2);
    expect(evening.k2).toBeCloseTo(0);
  });

  it('a building at noon throws its box straight north, no wider than itself', () => {
    const poly = boxShadow(foot, 100, sunShear({ angle: 0, squash: 0.6 }));
    expect(Math.min(...xs(poly))).toBeCloseTo(foot.x0);
    expect(Math.max(...xs(poly))).toBeCloseTo(foot.x1);
    expect(Math.min(...ys(poly))).toBeCloseTo(foot.y0 - 60);
    expect(Math.max(...ys(poly))).toBeCloseTo(foot.y1);
  });

  it('in the morning the shadow runs west along the whole depth of the building', () => {
    const poly = boxShadow(foot, 100, sunShear({ angle: -70, squash: 1.2 }));
    expect(Math.min(...xs(poly))).toBeLessThan(foot.x0 - 100);
    expect(Math.max(...xs(poly))).toBeCloseTo(foot.x1);
    // Beside the building, near its front and at its back, the ground is in shade (the front corner's own shadow
    // runs diagonally up the board, so right at the base the sun still gets in).
    expect(insidePolygon({ x: foot.x0 - 20, y: foot.y1 - 15 }, poly)).toBe(true);
    expect(insidePolygon({ x: foot.x0 - 20, y: foot.y1 - 2 }, poly)).toBe(false);
    expect(insidePolygon({ x: foot.x0 - 20, y: foot.y0 + 2 }, poly)).toBe(true);
    // In front of it (toward the camera) and east of it, the sun still reaches.
    expect(insidePolygon({ x: foot.x0 + 10, y: foot.y1 + 10 }, poly)).toBe(false);
    expect(insidePolygon({ x: foot.x1 + 10, y: foot.y0 + 10 }, poly)).toBe(false);
  });

  it('the hull covers every corner it was made from', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }, { x: 20, y: -5 }];
    const hull = convexHull(pts);
    // (10, 0) and (5, 5) fall inside the others.
    expect(hull).toHaveLength(4);
    for (const p of [{ x: 2, y: 2 }, { x: 9, y: 9 }, { x: 15, y: -1 }]) expect(insidePolygon(p, hull)).toBe(true);
    expect(insidePolygon({ x: 30, y: 30 }, hull)).toBe(false);
  });

  it('a building stands as tall as its art less the half of the footprint its roof recedes over', () => {
    expect(buildingHeight(185, 3 * TH)).toBe(185 - 54);
    expect(buildingHeight(30, 4 * TH)).toBe(TH);
  });

  it('a run cell is its post plus an arm toward each neighbour that continues it', () => {
    const post = lineRects('hedge', 0);
    expect(post).toHaveLength(1);
    expect(post[0]!.x0).toBeGreaterThan(0);
    expect(post[0]!.x1).toBeLessThan(TW);
    const across = lineRects('hedge', E | W);
    expect(Math.min(...across.map(r => r.x0))).toBe(0);
    expect(Math.max(...across.map(r => r.x1))).toBe(TW);
    const along = lineRects('wall', N | S);
    expect(Math.min(...along.map(r => r.y0))).toBe(0);
    expect(Math.max(...along.map(r => r.y1))).toBe(TH);
  });

  it('a figure in shade is dimmed as the ground is, and not at all with no sun', () => {
    expect(shadeTint(0)).toBe(0xffffff);
    const tint = shadeTint(0.32), r = tint >> 16, b = tint & 255;
    expect(r).toBeLessThan(200);
    // A touch cooler: the shade is lit by the sky.
    expect(b).toBeGreaterThan(r);
  });
});
