// Interiors' walls and rugs, painted into the baked ground (GDD §16.4 "about 30 interiors", MVP W-03). Pure: no Phaser,
// no DOM; terrainBake.ts calls it for every `wall` and `rug` pixel of a room.
//
// A room is a cutaway box on the ¾ diorama board, as the town's interiors are drawn in every cozy pixel-art game:
//
//   back wall   the top rows of `#` over the floor are the back wall's FACE, seen square on: a cornice beam along the
//               top, the room's wall (plaster, wallpaper, brick, panelling, whitewashed stone or boards), a dado and
//               wainscot where the style has one, a skirting board at the floor; windows where the room has them
//               (frame, mullions, sill; the glass is lit per the clock by render/town/InteriorRoom.ts)
//   cut walls   every other `#` (the side walls, the front wall, a partition) is a wall cut through: its top as a cap
//               band along the side that faces the room, the void beyond it; the front wall shows a short stub of its
//               face under the cap, and the doorway through it a stone threshold
//   rug         a hard-edged woven rug: a field with a small lozenge pattern, a border band all round, fringe at the ends
//
// Colours are the room's (zone `room:`), sampled from the painted interior backdrops (art_sources/backdrops).

import type { GroundMap } from './autotile';
import { KIND_ID, KIND_OF, TH, TW, hash01, vnoise } from './autotile';
import { MAT_H, MAT_W, bayer, material, mix, shade } from './materials';

export type WallStyle = 'plaster' | 'paper' | 'brick' | 'panel' | 'stone' | 'timber';
export type RugColour = 'red' | 'blue' | 'green' | 'gold';
export const WALL_STYLES: readonly WallStyle[] = ['plaster', 'paper', 'brick', 'panel', 'stone', 'timber'];
export const RUG_COLOURS: readonly RugColour[] = ['red', 'blue', 'green', 'gold'];

/** How a room looks (zone `room:`): its walls, its rug and the back wall's windows (tile columns). */
export interface RoomLook {
  wall: WallStyle;
  rug: RugColour;
  windows: readonly number[];
}

/** Outside the room: the dark the cutaway sits in (also the camera's background indoors). */
export const ROOM_VOID = 0x17120f;
/** Cap band width, px: how thick a cut wall reads from above. */
const CAP = 10;
/** The front wall's stub of face under its cap, px. */
const STUB = TH - CAP;

/** Window geometry on the back wall, in px relative to the column's left edge and the floor line (up is +). */
export const WINDOW = { x0: 8, x1: 40, bottom: 0.38, top: 0.84, frame: 3 } as const;

/** Per tile: 0 not a wall, 1 the back wall's face, 2 a cut wall (cap). With the floor line under each face column. */
export interface WallMap {
  cls: Uint8Array;
  /** Per column: the first floor row under the back wall (its floor line is that row × TH), or -1. */
  floorRow: Int16Array;
}

export function wallMap(map: GroundMap): WallMap {
  const { width, height, kinds } = map, wall = KIND_ID.wall;
  // The back wall is the band of rows along the top that are wall all the way across; its face shows over every column
  // with floor right under it. Everything else of wall (the sides, the front, partitions, a column of wall running down
  // from the band) is cut.
  let band = 0;
  while (band < height && Array.from({ length: width }, (_, x) => kinds[band * width + x]).every(k => k === wall)) band++;
  const cls = new Uint8Array(width * height), floorRow = new Int16Array(width).fill(-1);
  for (let x = 0; x < width; x++) {
    const faced = band > 0 && band < height && kinds[band * width + x] !== wall;
    if (faced) floorRow[x] = band;
    for (let y = 0; y < height; y++) if (kinds[y * width + x] === wall) cls[y * width + x] = faced && y < band ? 1 : 2;
  }
  return { cls, floorRow };
}

/** The windows' glass on the back wall, world px (for the light overlay): one rect per pane. */
export function windowPanes(map: GroundMap, walls: WallMap, look: RoomLook): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const cx of look.windows) {
    const row = walls.floorRow[cx] ?? -1;
    if (row < 0) continue;
    const H = row * TH, floorY = H;
    const g = windowRect(H);
    const left = cx * TW + WINDOW.x0 + WINDOW.frame, right = cx * TW + WINDOW.x1 - WINDOW.frame;
    const top = floorY - g.top + WINDOW.frame, bottom = floorY - g.bottom - WINDOW.frame;
    const midX = Math.round((left + right) / 2), midY = Math.round((top + bottom) / 2);
    out.push({ x: left, y: top, w: midX - 1 - left, h: midY - 1 - top }, { x: midX + 1, y: top, w: right - midX - 1, h: midY - 1 - top },
      { x: left, y: midY + 1, w: midX - 1 - left, h: bottom - midY - 1 }, { x: midX + 1, y: midY + 1, w: right - midX - 1, h: bottom - midY - 1 });
  }
  return out;
}

const windowRect = (H: number) => ({ bottom: Math.round(H * WINDOW.bottom), top: Math.round(H * WINDOW.top) });

// ── The back wall's face ────────────────────────────────────────────────────

const BEAM = 0x4a3020, BEAM_HI = 0x6e4a2e, SKIRT = 0x4e3220, SKIRT_HI = 0x7a5232;

/** Is the wall style one with a wainscot under a dado rail? */
const WAINSCOT: Readonly<Record<WallStyle, boolean>> = { plaster: true, paper: true, brick: false, panel: true, stone: false, timber: false };
const DADO = 30;

function body(style: WallStyle, gx: number, h: number, seed: number): number {
  switch (style) {
    case 'plaster': {
      const n = vnoise(gx / 19, h / 13, seed + 31) * 0.6 + vnoise(gx / 5, h / 4, seed + 32) * 0.4;
      let c = n + (bayer(gx, h) - 0.5) * 0.3 > 0.62 ? 0xe2d2b2 : 0xecdfc2;
      if (hash01(gx, h, seed + 33) < 0.01) c = 0xd6c6a4;
      return c;
    }
    case 'paper': {
      // Sage stripes with a cream pinstripe and a little sprig in the wide stripe.
      const s = ((gx % 16) + 16) % 16;
      if (s === 0) return 0xf0e6cc;
      let c = s < 8 ? 0x9fb48e : 0xb3c6a0;
      if (s >= 10 && s <= 13 && ((h + Math.floor(gx / 16) * 6) % 12) === 3) c = 0x7f9a70;
      return c;
    }
    case 'brick': {
      const row = Math.floor(h / 6), lh = h - row * 6, off = (row & 1) * 7;
      const col = Math.floor((gx + off) / 14), lx = gx + off - col * 14;
      if (lh === 5 || lx === 13) return 0x7a5a48;
      let c = [0xa85a3c, 0x9a5036, 0xb46646, 0x92482e, 0xac6040][Math.floor(hash01(col, row, seed + 41) * 5)]!;
      if (lh === 0) c = shade(c, 1.08);
      return c;
    }
    case 'panel': {
      // Dark oak panels: a frame, a raised field with a lit top-left bevel.
      const px = ((gx % 40) + 40) % 40, py = h % 44;
      if (px < 3 || py < 3) return 0x5a3a22;
      if (px < 5 || py < 5) return 0x7a5232;
      if (px > 36 || py > 40) return 0x4c3020;
      return pnoiseWood(gx, h, seed) ? 0x6e4628 : 0x765030;
    }
    case 'stone': {
      // Whitewashed rubble blocks.
      const row = Math.floor(h / 12), lh = h - row * 12, off = (row & 1) * 11;
      const w = 18 + Math.floor(hash01(row, 0, seed + 51) * 8);
      const col = Math.floor((gx + off) / w), lx = gx + off - col * w;
      if (lh === 11 || lx === 0) return 0xb2a894;
      let c = [0xe6e0d0, 0xdcd4c2, 0xeee8da][Math.floor(hash01(col, row, seed + 52) * 3)]!;
      if (lh === 0 || lx === 1) c = shade(c, 1.03);
      if (lh >= 9) c = shade(c, 0.94);
      return c;
    }
    case 'timber': {
      // Weathered upright boards.
      const s = ((gx % 12) + 12) % 12, b = Math.floor(gx / 12);
      if (s === 0) return 0x4a5458;
      let c = [0x7d8e96, 0x738690, 0x86969c][Math.floor(hash01(b, 0, seed + 61) * 3)]!;
      if (s === 1) c = shade(c, 1.1);
      if (vnoise(gx / 3, h / 18, seed + 62) > 0.7) c = shade(c, 0.92);
      return c;
    }
  }
}

const pnoiseWood = (gx: number, h: number, seed: number): boolean => vnoise(gx / 14, h / 2.5, seed + 71) > 0.62;

/** A pixel of the back wall's face: `h` px above the floor line, the face `H` px tall; `cx` its tile column. */
export function facePixel(look: RoomLook, gx: number, h: number, H: number, cx: number, seed: number): number {
  // Cornice beam along the top.
  if (h >= H - 8) return h === H - 8 ? BEAM_HI : h >= H - 2 ? shade(BEAM, 0.8) : BEAM;
  // A window, if this column has one.
  if (look.windows.includes(cx)) {
    const u = gx - cx * TW, g = windowRect(H);
    const sill = h >= g.bottom - 4 && h < g.bottom && u >= WINDOW.x0 - 3 && u < WINDOW.x1 + 3;
    if (sill) return h === g.bottom - 1 ? 0xf2e8d2 : 0xc8b898;
    if (u >= WINDOW.x0 && u < WINDOW.x1 && h >= g.bottom && h < g.top) {
      const f = WINDOW.frame, inside = u >= WINDOW.x0 + f && u < WINDOW.x1 - f && h >= g.bottom + f && h < g.top - f;
      const frame = look.wall === 'brick' || look.wall === 'timber' || look.wall === 'panel' ? 0x6e4a2a : 0xf0e8d6;
      if (!inside) return u === WINDOW.x0 || h === g.top - 1 ? shade(frame, 0.8) : frame;
      const mx = Math.round(cx * TW + (WINDOW.x0 + WINDOW.x1) / 2) - cx * TW, my = Math.round((g.bottom + g.top) / 2);
      if (Math.abs(u - mx) <= 1 || Math.abs(h - my) <= 1) return frame;
      // The glass (InteriorRoom paints the sky over it): a placeholder blue with a glint.
      return (u + h) % 11 === 0 ? 0xd4ecf8 : 0x9cc8e8;
    }
  }
  // Skirting at the floor.
  if (h < 5) return h === 4 ? SKIRT_HI : SKIRT;
  if (WAINSCOT[look.wall] && h < DADO + 3) {
    if (h >= DADO) return h === DADO + 2 ? 0x8a6038 : 0x6a4428;
    const s = ((gx % 12) + 12) % 12;
    if (look.wall === 'panel') return body('panel', gx, h, seed);
    if (s === 0) return 0x6e4626;
    return s === 1 ? 0xa67444 : hash01(Math.floor(gx / 12), 0, seed + 81) < 0.5 ? 0x936238 : 0x8c5c34;
  }
  let c = body(look.wall, gx, h, seed);
  // A soft shadow under the cornice, and the corners darken a touch.
  if (h >= H - 14) c = shade(c, 0.9);
  return c;
}

// ── Cut walls ───────────────────────────────────────────────────────────────

const CAP_TOP: Readonly<Record<WallStyle, number>> = { plaster: 0x6a4a34, paper: 0x6a4a34, brick: 0x7a4a34, panel: 0x4e3220, stone: 0x8a8274, timber: 0x56646a };

/**
 * A pixel of a cut wall at tile (tx, ty), (u, v) inside it: the cap band along each side that faces the room (floor, or
 * the back wall's face), corners included; the front wall's stub of face under its cap; the void beyond.
 */
export function capPixel(map: GroundMap, walls: WallMap, look: RoomLook, tx: number, ty: number, u: number, v: number, seed: number): number {
  const { width, height } = map;
  const room = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && walls.cls[y * width + x] !== 2;
  const n = room(tx, ty - 1), s = room(tx, ty + 1), w = room(tx - 1, ty), e = room(tx + 1, ty);
  const top = CAP_TOP[look.wall];
  let d = Infinity;
  if (n) d = Math.min(d, v);
  if (s) d = Math.min(d, TH - 1 - v);
  if (w) d = Math.min(d, u);
  if (e) d = Math.min(d, TW - 1 - u);
  // Inner corners: a diagonal neighbour is room and neither side next to it is.
  if (!n && !w && room(tx - 1, ty - 1)) d = Math.min(d, Math.max(u, v));
  if (!n && !e && room(tx + 1, ty - 1)) d = Math.min(d, Math.max(TW - 1 - u, v));
  if (!s && !w && room(tx - 1, ty + 1)) d = Math.min(d, Math.max(u, TH - 1 - v));
  if (!s && !e && room(tx + 1, ty + 1)) d = Math.min(d, Math.max(TW - 1 - u, TH - 1 - v));
  // A partition running back to front (room either side) is a thin wall: its top down the middle, the rooms' floors
  // (or the back wall's face) either side of it. One running across is all cap.
  if (w && e && !n && !s) {
    const c = Math.abs(u + 0.5 - TW / 2), half = 7;
    if (c <= half) return c > half - 1 ? shade(top, 1.45) : c > half - 2 ? shade(top, 1.2) : c < 1 ? shade(top, 0.85) : top;
    const nx = u < TW / 2 ? tx - 1 : tx + 1, gx = tx * TW + u, gy = ty * TH + v;
    if (walls.cls[ty * width + nx] === 1) {
      const fr = walls.floorRow[nx]!;
      return facePixel(look, gx, fr * TH - 1 - gy, fr * TH, nx, seed);
    }
    const kind = map.kinds[ty * width + nx]!;
    const px = kind === KIND_ID.rug ? RUGS[look.rug].border : material(KIND_OF[kind]!)[(gy % MAT_H) * MAT_W + (gx % MAT_W)]!;
    // The wall's foot shades the floor beside it.
    return c < half + 3 ? shade(px, 0.82) : px;
  }
  if ((n && s) || (w && e)) d = Math.min(d, 1);
  // The front wall (room above, or a partition coming down to it; nothing below): a cap, then the stub of its face.
  const partitionAbove = !n && ty > 0 && room(tx - 1, ty - 1) && room(tx + 1, ty - 1);
  const front = (n || partitionAbove) && !s && ty === height - 1;
  if (partitionAbove && front && v < CAP) d = Math.min(d, v);
  if (front && v >= CAP) {
    const h = TH - 1 - v;
    const c = facePixel({ ...look, windows: [] }, tx * TW + u, h + 6, STUB + 40, -1, seed);
    return shade(c, 0.72 + (h / STUB) * 0.1);
  }
  if (d >= CAP) return ROOM_VOID;
  if (d === 0) return shade(top, 1.5);
  if (d === 1) return shade(top, 1.25);
  if (d === CAP - 1) return mix(top, ROOM_VOID, 0.6);
  return hash01(tx * TW + u, ty * TH + v, seed + 91) < 0.06 ? shade(top, 0.9) : top;
}

// ── The rug ─────────────────────────────────────────────────────────────────

const RUGS: Readonly<Record<RugColour, { field: number; figure: number; border: number; line: number }>> = {
  red: { field: 0xa8443a, figure: 0xd8a05a, border: 0x3e4a6a, line: 0xe8d8b0 },
  blue: { field: 0x3e5a8a, figure: 0xe8d8b0, border: 0x9a3e36, line: 0xe8c878 },
  green: { field: 0x4e7a52, figure: 0xe8c878, border: 0x6a3a2a, line: 0xf0e2c0 },
  gold: { field: 0xc8964a, figure: 0x7a3a2a, border: 0x3e4a6a, line: 0xf2e6c4 }
};

/** A pixel of the rug at tile (tx, ty), (u, v) inside it: field, lozenges, a border band where it ends, fringe at the sides. */
export function rugPixel(map: GroundMap, look: RoomLook, tx: number, ty: number, u: number, v: number): number {
  const { width, height, kinds } = map, rug = KIND_ID.rug;
  const isRug = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && kinds[y * width + x] === rug;
  const pal = RUGS[look.rug];
  const dn = isRug(tx, ty - 1) ? 99 : v, ds = isRug(tx, ty + 1) ? 99 : TH - 1 - v;
  const dw = isRug(tx - 1, ty) ? 99 : u, de = isRug(tx + 1, ty) ? 99 : TW - 1 - u;
  const edge = Math.min(dn, ds, dw, de);
  // Fringe: the short ends (west and east) tassel out over the floor's first pixels.
  if ((dw < 2 || de < 2) && dn > 0 && ds > 0) return (v & 1) ? pal.line : shade(pal.line, 0.8);
  if (edge < 2) return shade(pal.border, 0.75);
  if (edge < 6) return pal.border;
  if (edge === 6) return pal.line;
  const gx = tx * TW + u, gy = ty * TH + v;
  const lx = ((gx % 24) + 24) % 24 - 12, ly = (((gy % 18) + 18) % 18 - 9) * 1.33;
  const d = Math.abs(lx) + Math.abs(ly);
  if (d < 3) return pal.line;
  if (d < 6) return pal.figure;
  if (d < 7) return shade(pal.field, 0.85);
  return bayer(gx, gy) < 0.08 ? shade(pal.field, 1.08) : pal.field;
}
