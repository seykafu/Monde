import type { Sun } from '../sun';
import { LINE_GEOMETRY, E, N, S, W, type LineKind } from './lineArt';
import { TH, TW } from './autotile';

// ─────────────────────────────────────────────────────────────────────────────
// Where the town's sun shadows fall (§16.4.1). Pure, no Phaser, so the shapes are tested in Node.
//
// On the ¾ board a height of h px is drawn h px up the screen, and the ground is foreshortened. A point h px up
// throws its shadow to (k1·h, −k2·h) from its foot (render/sun's lean and length, turned into a shear), so:
//
//   props      their silhouette sheared along the ground about the foot (TownBoard bakes the texture): the
//              trunk stays planted and the crown lands away from the sun, which a rotated silhouette doesn't do
//   buildings  a box: the footprint swept by the shadow of its walls, the convex hull of the footprint and the
//              footprint thrown h px. Its side shadow runs the whole depth of the building, which is what
//              tells the eye the front wall has a building behind it
//   lines      hedges, walls and fences are extruded footprints already (lineArt.ts): each band is a box
// ─────────────────────────────────────────────────────────────────────────────

export interface Pt { x: number; y: number }
/** A rectangle on the ground, world px: y0 is its back (north) edge, y1 its front. */
export interface GroundRect { x0: number; y0: number; x1: number; y1: number }
/** Ground offset per px of height. */
export interface Shear { k1: number; k2: number }

const DEG = Math.PI / 180;

export const sunShear = (sun: Pick<Sun, 'angle' | 'squash'>): Shear =>
  ({ k1: sun.squash * Math.sin(sun.angle * DEG), k2: sun.squash * Math.cos(sun.angle * DEG) });

/**
 * How tall a building stands for its shadow. Its sprite is the front wall with the roof rising behind it, and the
 * roof's ridge runs along the middle of the footprint, so half the footprint's depth (foreshortened, as drawn) is
 * roof receding rather than height.
 */
export const buildingHeight = (artH: number, depthPx: number): number => Math.max(TH, artH - depthPx / 2);

/** Convex hull, counter-clockwise (Andrew's monotone chain). */
export function convexHull(points: readonly Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]!; while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The shadow of a box standing on `r`, `h` px tall. */
export function boxShadow(r: GroundRect, h: number, s: Shear): Pt[] {
  const dx = s.k1 * h, dy = -s.k2 * h;
  const corners = [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }];
  return convexHull([...corners, ...corners.map(c => ({ x: c.x + dx, y: c.y + dy }))]);
}

export function insidePolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * One cell of a hedge, wall or fence run as ground rectangles, px from the cell's top-left: the post in the middle
 * and an arm toward each neighbour that continues the run (the same footprint lineArt.ts paints).
 */
export function lineRects(kind: LineKind, mask: number): GroundRect[] {
  const g = LINE_GEOMETRY[kind];
  const cx = TW / 2, cy = TH / 2;
  const bx0 = Math.round(cx - g.tx / 2), bx1 = bx0 + g.tx, by0 = Math.round(cy - g.ty / 2), by1 = by0 + g.ty;
  const out: GroundRect[] = [{ x0: bx0, y0: by0, x1: bx1, y1: by1 }];
  if (mask & W) out.push({ x0: 0, y0: by0, x1: bx0, y1: by1 });
  if (mask & E) out.push({ x0: bx1, y0: by0, x1: TW, y1: by1 });
  if (mask & N) out.push({ x0: bx0, y0: 0, x1: bx1, y1: by0 });
  if (mask & S) out.push({ x0: bx0, y0: by1, x1: bx1, y1: TH });
  return out;
}
