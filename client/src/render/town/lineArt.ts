// Hedges, low stone walls and picket fences, drawn in code and autotiled like the ground (town fixes).
//
// Why not sprites: a run of these is one continuous thing whose look depends on its neighbours (a straight
// run, a corner, a tee, an end), and the ¾ board shows a north–south run as its long top receding up the
// screen with a face only at its southern end. A front-facing segment sprite repeated down a column reads as
// a stack of separate blocks, and generated art can't be made to join seamlessly top to bottom. Here each
// cell asks which of its four neighbours continue the run and draws its share of one shape: a footprint band
// raised to the run's height (its top surface), and a front face wherever the footprint's southern edge is
// open. Shading is per world pixel, so no two cells repeat and joins are invisible; each cell is its own
// billboard, so people still sort in front of and behind a run correctly.
//
// Pure: RGBA buffers, no Phaser, no DOM.
import { hash01, TH, TW } from './autotile';

export type LineKind = 'hedge' | 'wall' | 'fence';
/** Which sprites are drawn as runs (the zone files keep naming them as props: `hedge`, `stone_wall`, `fence`). */
export const LINE_SPRITES: Readonly<Record<string, LineKind>> = { hedge: 'hedge', stone_wall: 'wall', fence: 'fence' };

export const N = 1, E = 2, S = 4, W = 8;

/** Footprint across the run (x, y, ground px) and height (px). Art tuning, against a 55 px resident. */
export const LINE_GEOMETRY: Readonly<Record<LineKind, { tx: number; ty: number; h: number }>> = {
  hedge: { tx: 22, ty: 14, h: 17 },
  wall: { tx: 18, ty: 12, h: 12 },
  fence: { tx: 4, ty: 4, h: 22 }
};

/** Neighbour masks for cells of one kind on one grid: N=1 E=2 S=4 W=8 for each cell that continues the run. */
export function lineMasks(cells: readonly (readonly [number, number])[]): number[] {
  const at = new Set(cells.map(([x, y]) => `${x},${y}`));
  return cells.map(([x, y]) => (at.has(`${x},${y - 1}`) ? N : 0) | (at.has(`${x + 1},${y}`) ? E : 0) | (at.has(`${x},${y + 1}`) ? S : 0) | (at.has(`${x - 1},${y}`) ? W : 0));
}

export interface LinePiece {
  w: number;
  h: number;
  /** Where the texture's top-left sits, px from the cell's ground top-left corner. */
  ox: number;
  oy: number;
  rgba: Uint8ClampedArray;
  /** Ground px from the cell's top edge to the run's front foot: its depth line for sorting with people. */
  foot: number;
}

const PAD = 2;

type Rgb = number;
const PAL: Readonly<Record<LineKind, { top: Rgb[]; face: Rgb[]; rim: Rgb; dark: Rgb; joint?: Rgb }>> = {
  hedge: { top: [0xb4c443, 0x98b03e, 0x7d9a3b, 0x5b8239], face: [0x62883b, 0x365931, 0x26533a, 0x24442e, 0x1d3c2c], rim: 0x1e3021, dark: 0x1d3526 },
  wall: { top: [0xe9c076, 0xdbba93, 0xd4af88, 0xc3975f], face: [0xe1a64d, 0xc3975f, 0xb17e45, 0x99673c], rim: 0x85553b, dark: 0x6b4430, joint: 0x85553b },
  fence: { top: [0xfffcf0, 0xf9f4e8, 0xf5ecdb], face: [0xfffcf0, 0xf9f4e8, 0xefe8dd, 0xe0d7cc], rim: 0x9a8f85, dark: 0x8a7f76 }
};

/**
 * One cell of a run. `mask` says which neighbours continue it; (cellX, cellY) seed the per-pixel shading so
 * neighbouring cells agree along their shared edges.
 */
export function paintLine(kind: LineKind, mask: number, cellX: number, cellY: number, seed = 0): LinePiece {
  const g = LINE_GEOMETRY[kind], pal = PAL[kind];
  const cx = TW / 2, cy = TH / 2;
  const bx0 = Math.round(cx - g.tx / 2), bx1 = bx0 + g.tx;
  const by0 = Math.round(cy - g.ty / 2), by1 = by0 + g.ty;
  const ns = (x: number) => x >= bx0 && x < bx1, ew = (gy: number) => gy >= by0 && gy < by1;
  /** The run's footprint in this cell's ground px, continuing into connected neighbours. */
  const inside = (x: number, gy: number): boolean => {
    if (ns(x) && ew(gy)) return true;
    if (ew(gy) && ((mask & E && x >= cx) || (mask & W && x < cx))) return true;
    if (ns(x) && ((mask & N && gy < cy) || (mask & S && gy >= cy))) return true;
    return false;
  };
  const top = g.h + PAD + 1;
  const w = TW + PAD * 2, h = TH + top + 1;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, sy: number, c: Rgb) => {
    const px = x + PAD, py = sy + top;
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const i = (py * w + px) * 4;
    rgba[i] = (c >> 16) & 255; rgba[i + 1] = (c >> 8) & 255; rgba[i + 2] = c & 255; rgba[i + 3] = 255;
  };
  const wx0 = cellX * TW, wy0 = cellY * TH;
  const noise = (x: number, y: number, k = 0) => hash01(wx0 + x, wy0 + y, seed * 7 + k);
  const pick = (cs: Rgb[], t: number) => cs[Math.min(cs.length - 1, Math.max(0, Math.floor(t * cs.length)))]!;
  /** How far (px, up to 8) a footprint pixel is from the run's open edge: rounds the top's shading. */
  const inset = (x: number, gy: number): number => {
    for (let d = 1; d <= 8; d++) if (!inside(x - d, gy) || !inside(x + d, gy) || !inside(x, gy - d) || !inside(x, gy + d)) return d;
    return 8;
  };
  /** Irregular stones: the nearest of a jittered grid of seeds in world px, and whether this px is a joint. */
  const stone = (wx: number, wy: number, sx: number, sy: number, k: number): { id: number; joint: boolean } => {
    const gx = Math.floor(wx / sx), gy = Math.floor(wy / sy);
    let d1 = Infinity, d2 = Infinity, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cxs = (gx + i + 0.2 + 0.6 * hash01(gx + i, gy + j, seed + k)) * sx, cys = (gy + j + 0.2 + 0.6 * hash01(gx + i, gy + j, seed + k + 1)) * sy;
      const d = Math.hypot((wx - cxs) / sx, (wy - cys) / sy);
      if (d < d1) { d2 = d1; d1 = d; id = (gx + i) * 7919 + (gy + j); } else if (d < d2) d2 = d;
    }
    return { id, joint: d2 - d1 < 0.16 };
  };

  // ── The top surface, raised by the run's height ──
  for (let gy = 0; gy < TH; gy++) for (let x = 0; x < TW; x++) {
    if (!inside(x, gy)) continue;
    const edge = !inside(x, gy - 1) && !(gy === 0 && mask & N) || !inside(x - 1, gy) && !(x === 0 && mask & W)
      || !inside(x + 1, gy) && !(x === TW - 1 && mask & E);
    const sy = gy - g.h;
    if (kind === 'fence') {
      // Only a run up the screen shows its top: the pickets' tips in a line, seen from above. Across the
      // screen the pickets' own tips are the top.
      if (ns(x) && mask & (N | S)) put(x, sy, edge || x === bx0 || x === bx1 - 1 ? pal.rim : (wy0 + gy) % 8 === 0 ? pal.face[3]! : pick(pal.top, noise(x, gy)));
      continue;
    }
    if (kind === 'hedge') {
      // Leaves in little clusters, lit along the crown and darker toward the sides; a scalloped rim with a few
      // tufts standing proud.
      const clump = noise(Math.floor((x + (gy & 2)) / 3), Math.floor(gy / 3), 2), fine = noise(x, gy, 1);
      const crown = Math.min(1, (inset(x, gy) - 1) / 5);
      if (edge) {
        put(x, sy, fine < 0.6 ? pal.rim : pal.face[3]!);
        if (!inside(x, gy - 1) && fine > 0.7) put(x, sy - 1, pal.rim);
      } else {
        const t = 1.05 - crown * 0.45 - clump * 0.5 + (fine > 0.92 ? -0.3 : 0) + (fine < 0.1 ? 0.4 : 0);
        put(x, sy, t > 0.95 ? pal.face[1]! : pick(pal.top, t));
      }
    } else {
      // Capstones: irregular flat stones with dark joints, a little lighter along the crown.
      const st = stone(wx0 + x, wy0 + gy, 9, 6, 11);
      const crown = Math.min(1, (inset(x, gy) - 1) / 4);
      put(x, sy, edge ? pal.rim : st.joint ? pal.joint! : pick(pal.top, 0.7 - crown * 0.35 + hash01(st.id, 1, seed) * 0.5 + noise(x, gy) * 0.15));
    }
  }

  // ── Front faces, wherever the footprint's southern edge is open ──
  for (let x = 0; x < TW; x++) for (let gy = 0; gy < TH; gy++) {
    if (!inside(x, gy) || inside(x, gy + 1) || (gy === TH - 1 && mask & S && ns(x))) continue;
    const leftOpen = !inside(x - 1, gy) && !(x === 0 && mask & W), rightOpen = !inside(x + 1, gy) && !(x === TW - 1 && mask & E);
    for (let z = 0; z < g.h; z++) {
      const sy = gy - z;
      if (kind === 'fence') {
        // Pickets on a run across the screen; a post at an end or on a run up the screen.
        const along = ew(gy) && (mask & (E | W)) !== 0;
        if (along) {
          const p = ((wx0 + x) % 8 + 8) % 8;
          const plank = p >= 1 && p <= 5, mid = p === 3;
          const rail = (z >= 5 && z <= 7) || (z >= 14 && z <= 16);
          const tip = z >= g.h - 2 ? (z === g.h - 1 ? mid : p >= 2 && p <= 4) : true;
          if (plank && tip) put(x, sy, p === 1 || p === 5 || z === 0 ? pal.rim : pick(pal.face, 0.2 + noise(x, z, 3) * 0.5 + (p === 4 ? 0.3 : 0)));
          else if (rail && !plank) put(x, sy, z === 5 || z === 14 ? pal.face[3]! : pal.face[2]!);
        } else {
          put(x, sy, leftOpen || rightOpen || z === 0 ? pal.rim : pick(pal.face, 0.1 + noise(x, z, 3) * 0.6));
        }
        continue;
      }
      if (leftOpen || rightOpen) { put(x, sy, pal.rim); continue; }
      if (z === 0) { put(x, sy, pal.dark); continue; }
      if (kind === 'hedge') {
        const clump = noise(Math.floor((x + (z & 2)) / 3), Math.floor((gy - z) / 3), 5), fine = noise(x, gy - z, 6);
        const depth = 1 - z / g.h; // darker toward the foot
        put(x, sy, z === g.h - 1 ? pick(pal.top, 0.45 + fine * 0.5) : pick(pal.face, depth * 0.7 + clump * 0.35 - 0.05 + (fine > 0.9 ? -0.45 : 0)));
      } else {
        // Rounded field stones laid in rough courses, darker toward the foot.
        const st = stone(wx0 + x, z + (wy0 + gy) * 3, 10, 5, 23);
        const depth = 1 - z / g.h;
        put(x, sy, z === g.h - 1 ? pal.top[1]! : st.joint ? pal.joint! : pick(pal.face, hash01(st.id, 2, seed) * 0.65 + depth * 0.35 + noise(x, z, 4) * 0.1));
      }
    }
  }

  // A post's cap on a fence wherever a run turns, tees or ends, and on runs up the screen.
  if (kind === 'fence') {
    const straightEW = (mask & (E | W)) === (E | W) && !(mask & (N | S));
    if (!straightEW) {
      const px0 = Math.round(cx - 3);
      for (let z = 0; z <= g.h + 1; z++) for (let x = px0; x < px0 + 6; x++) {
        const outline = x === px0 || x === px0 + 5 || z === 0 || z === g.h + 1;
        put(x, by1 - 1 - z, outline ? pal.rim : pick(pal.face, 0.1 + noise(x, z, 9) * 0.5 + (x === px0 + 4 ? 0.3 : 0)));
      }
    }
  }
  return { w, h, ox: -PAD, oy: -top, rgba, foot: by1 };
}
