// The character sprite-sheet contract: one layout shared by drawn sheets and the procedural rig.
//
// Files (served from client/public, resolved against import.meta.env.BASE_URL):
//
//   assets/sprites/manifest.json      which characters have a drawn sheet: { "<id>": true | {…meta} }
//   assets/sprites/<id>/walk.png      the sheet
//   assets/sprites/<id>/<id>.json     optional meta, fetched only when the manifest entry says "json": true
//
// A character id is a resident id (the persona card's `sprite`, which equals its id) or "player".
// Anyone missing from the manifest is drawn by the procedural rig (rig.ts), so nothing is fetched for
// them and there are no 404s.
//
// The sheet is a grid of equal cells (default 32×48), feet on the cell's bottom row (or `footY`):
//   rows    = facings, in `rows` order (default down, left, right, up). A sheet may leave out "right"
//             (or "left"); it is drawn as the other one mirrored. GDD §16.5's three-row sheets are
//             rows ["down", "right", "up"].
//   columns = `idle` idle frames, then `walk` walk frames. With `blink: true` the last idle column is
//             a blink (shown for a moment now and then), not part of the breathing cycle.
//             Walk frames are one cycle starting on a contact: left foot forward, passing, right foot
//             forward, passing (4 frames; 6 or 8 work too: the contacts are frame 0 and walk/2).
//             With `idle: 0` the character stands on walk frame 1 (the first passing pose).
// Timing: `fps.idle` is the breathing rate; `fps.walk` is frames per second at the player's walking
// pace (4 tiles/s). Walk frames advance by distance walked (`walk` frames per walk/fps.walk×4 tiles),
// so feet keep pace with the ground at any speed and stop when the body does.
// Pure: no Phaser, no DOM.

export const FACINGS = ['down', 'left', 'right', 'up'] as const;
export type Facing = (typeof FACINGS)[number];

export const FRAME_W = 32;
export const FRAME_H = 48;
/** The pace `fps.walk` is quoted at: world/player.ts PLAYER_SPEED. */
export const REFERENCE_SPEED = 4;

export interface SheetLayout {
  frameWidth: number;
  frameHeight: number;
  /** Facing per row, top to bottom. */
  rows: readonly Facing[];
  /** Idle columns (including the blink column when `blink`). */
  idle: number;
  walk: number;
  blink: boolean;
  /** Breathing frames per second. */
  idleFps: number;
  /** Tiles walked per walk frame. */
  stride: number;
  /** The ground row inside a cell, px from the top (the sprite's origin). */
  footY: number;
  /** World scale the cell is drawn at (GDD §16.1's 32×40 cells show at 1.5). */
  scale: number;
}

/** Meta as written in the manifest or `<id>.json` (every field optional). */
export interface SheetMeta {
  frameWidth?: number;
  frameHeight?: number;
  rows?: Facing[];
  idle?: number;
  walk?: number;
  blink?: boolean;
  fps?: { idle?: number; walk?: number };
  footY?: number;
  scale?: number;
  /** Also fetch `<id>/<id>.json` and lay it over this entry. */
  json?: boolean;
}

/** GDD §16.5 town states: idle 2, walk 4; four rows. What a drawn sheet is assumed to be unless its meta says otherwise. */
export const DEFAULT_LAYOUT: SheetLayout = {
  frameWidth: FRAME_W, frameHeight: FRAME_H, rows: FACINGS, idle: 2, walk: 4, blink: false,
  idleFps: 0.8, stride: REFERENCE_SPEED / 9, footY: FRAME_H, scale: 1
};

/** The procedural rig's sheet: the default layout plus a blink column. */
export const PROCEDURAL_LAYOUT: SheetLayout = { ...DEFAULT_LAYOUT, idle: 3, blink: true };

const isFacing = (v: unknown): v is Facing => typeof v === 'string' && (FACINGS as readonly string[]).includes(v);
const posInt = (v: unknown, max: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined;
const posNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** Validate one meta object; unknown or bad fields are reported and ignored. */
export function parseMeta(raw: unknown, problems: string[] = [], where = 'meta'): SheetMeta {
  if (raw === true) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { problems.push(`${where}: expected true or an object`); return {}; }
  const o = raw as Record<string, unknown>, meta: SheetMeta = {};
  const int = (key: 'frameWidth' | 'frameHeight' | 'idle' | 'walk' | 'footY', max: number) => {
    if (o[key] === undefined) return;
    const v = posInt(o[key], max);
    if (v === undefined) problems.push(`${where}.${key}: expected an integer 0..${max}`);
    else meta[key] = v;
  };
  int('frameWidth', 512); int('frameHeight', 512); int('idle', 16); int('walk', 16); int('footY', 512);
  if (o.rows !== undefined) {
    const rows = Array.isArray(o.rows) ? o.rows : [];
    if (!rows.length || !rows.every(isFacing) || new Set(rows).size !== rows.length) problems.push(`${where}.rows: expected distinct facings from ${FACINGS.join('/')}`);
    else meta.rows = rows;
  }
  if (o.blink !== undefined) { if (typeof o.blink === 'boolean') meta.blink = o.blink; else problems.push(`${where}.blink: expected a boolean`); }
  if (o.json !== undefined) { if (typeof o.json === 'boolean') meta.json = o.json; else problems.push(`${where}.json: expected a boolean`); }
  if (o.scale !== undefined) { const v = posNum(o.scale); if (v === undefined) problems.push(`${where}.scale: expected a positive number`); else meta.scale = v; }
  if (o.fps !== undefined) {
    const f = o.fps as Record<string, unknown> | null;
    if (!f || typeof f !== 'object') problems.push(`${where}.fps: expected { idle?, walk? }`);
    else {
      meta.fps = {};
      for (const key of ['idle', 'walk'] as const) {
        if (f[key] === undefined) continue;
        const v = posNum(f[key]);
        if (v === undefined) problems.push(`${where}.fps.${key}: expected a positive number`);
        else meta.fps[key] = v;
      }
    }
  }
  return meta;
}

/** The manifest: character id → meta. Bad entries are dropped (and reported). */
export function parseManifest(raw: unknown, problems: string[] = []): Map<string, SheetMeta> {
  const out = new Map<string, SheetMeta>();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { problems.push('manifest: expected an object'); return out; }
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z0-9_-]+$/i.test(id)) { problems.push(`manifest: bad character id "${id}"`); continue; }
    if (entry === false || entry === null) continue;
    const before = problems.length;
    const meta = parseMeta(entry, problems, id);
    if (problems.length === before || typeof entry === 'object') out.set(id, meta);
  }
  return out;
}

/** A full layout from meta (manifest entry, then `<id>.json` over it). Throws if the result can't index a sheet. */
export function layoutFrom(...metas: SheetMeta[]): SheetLayout {
  const m: SheetMeta = Object.assign({}, ...metas);
  const fps = Object.assign({}, ...metas.map(x => x.fps ?? {})) as { idle?: number; walk?: number };
  const frameHeight = m.frameHeight ?? DEFAULT_LAYOUT.frameHeight;
  const layout: SheetLayout = {
    frameWidth: m.frameWidth ?? DEFAULT_LAYOUT.frameWidth, frameHeight,
    rows: m.rows ?? DEFAULT_LAYOUT.rows,
    idle: m.idle ?? DEFAULT_LAYOUT.idle, walk: m.walk ?? DEFAULT_LAYOUT.walk, blink: m.blink ?? false,
    idleFps: fps.idle ?? DEFAULT_LAYOUT.idleFps,
    stride: fps.walk ? REFERENCE_SPEED / fps.walk : DEFAULT_LAYOUT.stride,
    footY: m.footY ?? frameHeight, scale: m.scale ?? 1
  };
  if (layout.walk < 2) throw new Error('sheet layout: needs at least 2 walk frames');
  if (layout.blink && layout.idle < 2) throw new Error('sheet layout: a blink column needs a breathing column before it');
  if (!layout.rows.includes('down') || !layout.rows.includes('up') || !(layout.rows.includes('left') || layout.rows.includes('right')))
    throw new Error('sheet layout: rows need down, up and at least one of left/right');
  return layout;
}

export const columns = (layout: SheetLayout): number => layout.idle + layout.walk;
/** Breathing frames (idle columns minus the blink). */
export const breathFrames = (layout: SheetLayout): number => layout.idle - (layout.blink ? 1 : 0);

export type FrameKind = 'idle' | 'blink' | 'walk';

/**
 * The cell to show: frame number (row-major, as Phaser numbers a sheet's frames) and whether to mirror it.
 * `index` is within the kind (idle breath index, or walk index); a sheet without idle stands on walk frame 1.
 */
export function frameFor(layout: SheetLayout, facing: Facing, kind: FrameKind, index: number): { frame: number; flipX: boolean } {
  let row = layout.rows.indexOf(facing), flipX = false;
  if (row < 0) {
    const mirror: Facing = facing === 'left' ? 'right' : facing === 'right' ? 'left' : facing;
    row = layout.rows.indexOf(mirror);
    flipX = true;
    if (row < 0) row = 0;
  }
  let col: number;
  if (kind === 'walk') col = layout.idle + mod(index, layout.walk);
  else if (kind === 'blink' && layout.blink) col = layout.idle - 1;
  else {
    const breaths = breathFrames(layout);
    col = breaths > 0 ? mod(index, breaths) : layout.idle + 1;
  }
  return { frame: row * columns(layout) + col, flipX };
}

const mod = (n: number, m: number): number => ((Math.floor(n) % m) + m) % m;
