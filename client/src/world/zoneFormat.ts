import { parse } from 'yaml';
import { Grid } from '../combat/Grid';
import type { MapDef, TerrainKind, ObstacleKind } from '../combat/types';
import { DEFAULT_LEGEND, TERRAIN_INFO, isFlow, isTownTerrain, type Flow, type LegendEntry, type TownTerrain } from './townTerrain';
import { TOWN_MANIFEST, metaOf, propBlock, type SpriteState, type TownManifest } from './townSprites';
import { scatter, type ScatterRule } from './scatter';
import { canLetter } from '../render/town/lettering';
import { DIORAMA_ELEV_STEP as ELEV, DIORAMA_TILE_H as TH, DIORAMA_TILE_W as TW } from '../render/dioramaConfig';

// ─────────────────────────────────────────────────────────────────────────────
// Zone files (content/zones/*.zone.yaml), GDD §16.4. Two formats compile to the same ZoneDef.
//
// v1, the greybox (still loaded): `legend:` maps characters to combat terrains, buildings are solid letter
// blocks (`building: <place id>`), `props:` are greybox kinds (lamp_post, bench, tree…).
//
// v2, the town (any file with a `terrain:` layer, or `format: 2`):
//
//   format: 2
//   id: old_quarter
//   name: Old Quarter
//   size: [40, 30]
//   terrain: |               # one character per tile, default legend in world/townTerrain.ts:
//     ,,,,,'''...            #   , grass  ' meadow  . cobble  b brick  p plaza  : gravel  r cart road
//     ,,..pppp..             #   s sand  h shingle  w wet sand  m garden soil  = boards (wharf, dock, bridge)
//                            #   _ stone steps  g weedy stone  ~ sea  o pond  - shallows
//                            #   > < ^ v river, the arrow pointing downstream
//   legend:                  # optional extra characters: { terrain, flow?, solid? }
//     X: { terrain: plaza, solid: true }
//   elevation: |             # optional digits 0–3, Ravage's rules (render/elevation.ts clamps the rise)
//   buildings:               # sprites from client/public/assets/town/manifest.json (kind: building)
//     - { id: bakery, sprite: bakery, at: [9, 2], door: [11, 6], state: auto }
//       # at: the footprint's top-left tile; the footprint (manifest `foot`) is solid; the door is the tile
//       # in front of the footprint's front edge, inside its columns. With an id the building IS that place
//       # (rect = footprint), so it is not listed again under places:. Without one it is scenery.
//       # state: restored | faded | auto (default; world/townSprites.ts resolveState); project: <id> optional
//     - { sprite: townhouse_b, at: [4, 17], home: home_03 }
//       # home: who lives there (town/occupancy.ts): a home id or a list of them (flats: [pub_rooms, roz_flat]),
//       # `home_NN` for a census household (A.1.3), `vacant` for a plain vacant home. A building whose id is a
//       # resident's home or a vacant_house_NN is its own home. Scenery houses (a `dwelling` sprite) must say.
//       # datestone: 1850 (a carved year over the door), sign: "A. MONDE|MAPS & PRINTS" (lettered on the
//       # sprite's sign panel, `|` breaks a line), number: 9 (a door number plate): lettered in code, exact
//   props:                   # sprites of kind prop
//     - { sprite: lamp_post, at: [15, 8] }        # solid?, flip?, state?, offset?: [dx, dy] px (moves it), lift?: px (draws it higher)
//     - { sprite: hedge, line: [[1, 1], [10, 1]] }               # one per tile along a straight line
//       # hedge, stone_wall and fence are drawn as autotiled runs (render/town/lineArt.ts): cells that touch join
//     - { sprite: mark_plaque, at: [5, 10], mark: OQ-2 }         # a Monde's Mark (§14.1): zone.marks lists them
//     - { sprite: welcome_sign, at: [26, 21], text: "WELCOME TO|MONDE|FOUNDED 1838" }   # lettered in code
//   scatter:                 # seeded set dressing (world/scatter.ts)
//     - { sprites: [tall_grass, bush_round], on: [grass], density: 0.05, seed: 3,
//         near: { kinds: [pond], radius: 2 }, keepout: { kinds: [cobble], radius: 1, doors: 2 } }
//   places:                  # open ground, as v1: { id, rect: [x, y, w, h], door }
//   edges:                   # as v1
//   spawn: [x, y]
//
// Collision is the ground (water and solid legend entries), building footprints and solid props (a prop's
// `block` in townSprites.ts, or `solid:`). Every door and edge cell must be walkable and reachable from the
// spawn; footprints and solid props may not overlap; sprites must exist; floating props go on water.
// A Mark must have ground to stand on beside it (its own tile or one next to it, reachable from the spawn)
// and must not be drawn behind a building or a tree.
// Lamp posts are lights. Integer tile coordinates name cells; continuous positions use centres at +0.5.
// ─────────────────────────────────────────────────────────────────────────────

export type Point = [number, number];
export interface Place { id: string; rect: [number, number, number, number]; door: Point }
export interface Edge { side: 'north' | 'south' | 'east' | 'west'; from: number; to: number; zone: string; arrive: Point }
export interface ZoneTile {
  terrain: TerrainKind;
  obstacle?: ObstacleKind;
  elev: number;
  solid?: boolean;
  building?: string;
  /** v2: the town ground kind. */
  kind?: TownTerrain;
  /** v2 rivers: which way the water runs. */
  flow?: Flow;
}

/** A building on a v2 board. */
export interface TownBuilding {
  /** The place it is; absent for scenery. */
  id?: string;
  sprite: string;
  /** Footprint top-left tile. */
  at: Point;
  /** [width, depth] in tiles (from the manifest). */
  foot: [number, number];
  door?: Point;
  state: SpriteState | 'auto';
  project?: string;
  flip: boolean;
  /** The homes inside (`home:`); empty: the building's own id decides (town/occupancy.ts buildingHomes). */
  homes: string[];
  /** A carved year over the door (§14.4 OQ-3's datestones). */
  datestone?: number;
  /** Lettered on the sprite's sign panel (`|` breaks a line). */
  sign?: string;
  /** A door number plate. */
  number?: number;
}

/** A Monde's Mark on a board (§14.1): where its plaque is and where the player stands to read it. */
export interface MarkSpot {
  /** The riddle id: `OQ-1` … */
  id: string;
  zone: string;
  /** The plaque's tile. */
  at: Point;
  /** A walkable tile at or beside it, reachable from the spawn (the plaque's own if it can be stood on). */
  stand: Point;
}

/** A prop on a v2 board (single placements, lines and scatter, in that order). */
export interface TownProp {
  sprite: string;
  /** Base tile. */
  at: Point;
  /** Offset from the base tile's centre, world px (moves where it stands, so its depth too). */
  dx: number;
  dy: number;
  /** Drawn this many px higher without changing where it stands (a cat on a bench). */
  lift: number;
  /** Blocks its `block` tiles. */
  solid: boolean;
  flip: boolean;
  state: SpriteState | 'auto';
  project?: string;
  from: 'prop' | 'line' | 'scatter';
  /** The Monde's Mark this plaque is (§14.1). */
  mark?: string;
  /** Lettered on the sprite's panel in code (`|` breaks a line): a welcome line, a boat's name. */
  text?: string;
}

export interface TownLayout {
  buildings: TownBuilding[];
  props: TownProp[];
}

export interface ZoneDef extends MapDef {
  tiles: ZoneTile[];
  places: Place[];
  props: { kind: string; at: Point }[];
  edges: Edge[];
  spawn: Point;
  /** Row-major [y][x]; buildings always block, even if solid is false. */
  walkability: boolean[][];
  format: 1 | 2;
  /** v2: the town's buildings and props. */
  town?: TownLayout;
  /** The Monde's Marks on this board (props with `mark:`), in file order. Empty on a v1 greybox. */
  marks: readonly MarkSpot[];
}

/** The Marks on a board, typed (the riddle system reads these). */
export const zoneMarks = (zone: Pick<ZoneDef, 'marks'>): readonly MarkSpot[] => zone.marks;

const terrains = ['grass', 'stone', 'dirt', 'wood', 'water', 'carpet', 'snow', 'mud', 'marble', 'sand', 'forest', 'wall', 'door', 'rubble', 'cobblestone', 'cracked_earth', 'ice', 'lava', 'moss_stone'] satisfies TerrainKind[];
const obstacles = ['none', 'hay', 'fence', 'wagon', 'barricade', 'pillar', 'throne', 'tree', 'rock', 'torch'] satisfies ObstacleKind[];
export const propArt: Record<string, ObstacleKind> = { lamp_post: 'torch', bench: 'hay', tree: 'tree', crate: 'hay', barrel: 'rock', sign: 'fence', fountain: 'pillar', bollard: 'pillar', gate: 'fence' };
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function object(v: unknown): Record<string, unknown> { check(v && typeof v === 'object' && !Array.isArray(v), 'Expected mapping'); return v as Record<string, unknown>; }
function string(v: unknown): string { check(typeof v === 'string' && v.length > 0, 'Expected nonempty string'); return v; }
function numbers(v: unknown, n: number): number[] { check(Array.isArray(v) && v.length === n && v.every(Number.isInteger), `Expected ${n} integers`); return v as number[]; }
function list(v: unknown): unknown[] { check(Array.isArray(v), 'Expected list'); return v; }
function bool(v: unknown, name: string): boolean | undefined { check(v === undefined || typeof v === 'boolean', `${name} must be boolean`); return v as boolean | undefined; }
function rows(v: unknown, w: number, h: number): string[] {
  const result = string(v).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  check(result.length === h && result.every(r => r.length === w), `Grid must have ${h} rows of ${w} characters`);
  return result;
}

/** Integer tile coordinates name cells; continuous player positions use cell centres at +0.5. */
export function compileZone(text: string, manifest: TownManifest = TOWN_MANIFEST): ZoneDef {
  const raw = object(parse(text));
  if (raw.format === 2 || raw.terrain !== undefined) return compileTown(raw, manifest);
  check(raw.format === undefined || raw.format === 1, 'Unknown zone format');
  return compileGreybox(raw);
}

// ── Shared parts ────────────────────────────────────────────────────────────

interface Frame { width: number; height: number; inside(p: number[]): boolean; point(v: unknown): Point }
function frame(raw: Record<string, unknown>): Frame {
  const [width, height] = numbers(raw.size, 2) as Point;
  check(width > 0 && height > 0, 'Size must be positive');
  const inside = ([x, y]: number[]) => x! >= 0 && y! >= 0 && x! < width && y! < height;
  const point = (v: unknown): Point => { const p = numbers(v, 2) as Point; check(inside(p), 'Point out of bounds'); return p; };
  return { width, height, inside, point };
}

function parsePlaces(raw: Record<string, unknown>, f: Frame): Place[] {
  return list(raw.places ?? []).map(v => {
    const p = object(v), rect = numbers(p.rect, 4) as Place['rect'];
    const [x, y, w, h] = rect;
    check(w > 0 && h > 0 && f.inside([x, y]) && f.inside([x + w - 1, y + h - 1]), 'Place rect out of bounds');
    const door = f.point(p.door);
    check(door[0] >= x - 1 && door[0] <= x + w && door[1] >= y - 1 && door[1] <= y + h, 'Door must touch its place');
    return { id: string(p.id), rect, door };
  });
}

function parseEdges(raw: Record<string, unknown>, f: Frame, walkable: (p: Point) => boolean): Edge[] {
  const edges = list(raw.edges ?? []).map(v => {
    const e = object(v);
    check(['north', 'south', 'east', 'west'].includes(String(e.side)), 'Unknown edge side');
    const side = e.side as Edge['side'];
    const [from, to] = numbers([e.from, e.to], 2) as Point;
    check(from >= 0 && to >= from && to < (side === 'north' || side === 'south' ? f.width : f.height), 'Edge range out of bounds');
    for (let n = from; n <= to; n++) check(walkable(edgeCell(f, side, n)), 'Edge on solid tile');
    const arrive = numbers(e.arrive, 2) as Point;
    check(arrive.every(n => n >= 0), 'Invalid arrival');
    return { side, from, to, zone: string(e.zone), arrive };
  });
  edges.forEach((e, i) => check(!edges.slice(0, i).some(other => other.side === e.side && e.from <= other.to && other.from <= e.to), 'Overlapping edges'));
  return edges;
}

const edgeCell = (f: Pick<Frame, 'width' | 'height'>, side: Edge['side'], n: number): Point =>
  side === 'north' ? [n, 0] : side === 'south' ? [n, f.height - 1] : side === 'west' ? [0, n] : [f.width - 1, n];

// ── v1: the greybox ─────────────────────────────────────────────────────────

function compileGreybox(raw: Record<string, unknown>): ZoneDef {
  const f = frame(raw);
  const { width, height } = f;
  const legend = Object.fromEntries(Object.entries(object(raw.legend)).map(([key, value]) => {
    check(key.length === 1, 'Legend keys must be single characters');
    const t = object(value);
    check(terrains.includes(t.terrain as TerrainKind), 'Unknown terrain');
    check(t.obstacle === undefined || obstacles.includes(t.obstacle as ObstacleKind), 'Unknown obstacle');
    check(t.elev === undefined || (Number.isInteger(t.elev) && Number(t.elev) >= 0 && Number(t.elev) <= 3), 'Elevation must be 0–3');
    check(t.solid === undefined || typeof t.solid === 'boolean', 'solid must be boolean');
    check(t.building === undefined || typeof t.building === 'string' && t.building.length > 0, 'building must be a place id');
    return [key, { ...t, elev: t.elev ?? 0 } as unknown as ZoneTile];
  }));
  const chars = rows(raw.tiles, width, height).join('');
  const elevations = raw.elevation === undefined ? undefined : rows(raw.elevation, width, height).join('');
  check(elevations === undefined || /^[0-3]+$/.test(elevations), 'Elevation must be digits 0–3');
  const tiles = [...chars].map((c, i) => { check(legend[c], `Unknown legend character: ${c}`); return { ...legend[c]!, elev: elevations ? Number(elevations[i]) : legend[c]!.elev }; });
  const places = parsePlaces(raw, f);
  check(new Set(places.map(p => p.id)).size === places.length, 'Duplicate place id');
  tiles.forEach((t, i) => {
    if (!t.building) return;
    const p = places.find(p => p.id === t.building);
    check(p, `Unknown building place: ${t.building}`);
    const [x, y, w, h] = p.rect;
    check(i % width >= x && i % width < x + w && Math.floor(i / width) >= y && Math.floor(i / width) < y + h, 'Building outside its rect');
  });
  const props = list(raw.props ?? []).map(v => {
    const p = object(v), kind = string(p.kind), at = f.point(p.at);
    check(Object.hasOwn(propArt, kind), `Unknown prop: ${kind}`);
    const tile = tiles[at[1] * width + at[0]]!;
    check(!tile.building && !tile.obstacle, 'Prop overlaps building or obstacle');
    tile.obstacle = propArt[kind];
    return { kind, at };
  });
  const map: MapDef = { id: string(raw.id), name: string(raw.name), width, height, tiles, startPositions: { player: [], enemy: [] } };
  const grid = new Grid(map);
  const walkability = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const t = tiles[y * width + x]!;
    return !t.building && !(t.solid ?? grid.tileAt({ x, y }).blocksMovement);
  }));
  const walkable = ([x, y]: Point) => walkability[y]?.[x] === true;
  places.forEach(p => check(walkable(p.door), `Door on solid tile: ${p.id}`));
  const spawn = f.point(raw.spawn);
  check(walkable(spawn), 'Spawn on solid tile');
  const edges = parseEdges(raw, f, walkable);
  return { ...map, tiles, places, props, edges, spawn, walkability, format: 1, marks: [] };
}

// ── v2: the town ────────────────────────────────────────────────────────────

const STATES = ['restored', 'faded', 'auto'] as const;
function spriteState(v: unknown, where: string): SpriteState | 'auto' {
  check(v === undefined || STATES.includes(v as never), `${where}: state must be restored, faded or auto`);
  return (v as SpriteState | 'auto' | undefined) ?? 'auto';
}

function compileTown(raw: Record<string, unknown>, manifest: TownManifest): ZoneDef {
  const f = frame(raw);
  const { width, height } = f;
  const id = string(raw.id);
  const at = (x: number, y: number) => y * width + x;

  // Ground.
  const legend: Record<string, LegendEntry> = { ...DEFAULT_LEGEND };
  for (const [key, value] of Object.entries(raw.legend === undefined ? {} : object(raw.legend))) {
    check(key.length === 1, 'Legend keys must be single characters');
    const t = object(value);
    check(isTownTerrain(t.terrain), `Unknown terrain: ${String(t.terrain)}`);
    check(t.flow === undefined || (t.terrain === 'river' && isFlow(t.flow)), 'flow is a compass direction, on river only');
    check(t.terrain !== 'river' || t.flow !== undefined, 'A river needs a flow');
    legend[key] = { terrain: t.terrain, flow: t.flow as Flow | undefined, solid: bool(t.solid, 'solid') };
  }
  const chars = rows(raw.terrain, width, height).join('');
  const elevations = raw.elevation === undefined ? undefined : rows(raw.elevation, width, height).join('');
  check(elevations === undefined || /^[0-3]+$/.test(elevations), 'Elevation must be digits 0–3');
  const tiles: ZoneTile[] = [...chars].map((c, i) => {
    const e = legend[c];
    check(e, `Unknown terrain character: ${c}`);
    return { terrain: TERRAIN_INFO[e.terrain].legacy, elev: elevations ? Number(elevations[i]) : 0, kind: e.terrain, ...(e.flow ? { flow: e.flow } : {}), ...(e.solid ? { solid: true } : {}) };
  });
  const isWater = (x: number, y: number) => TERRAIN_INFO[tiles[at(x, y)]!.kind!].water;
  // What stands on each tile: a building's name or a solid prop's, for clear overlap messages.
  const solidBy: (string | undefined)[] = new Array(width * height).fill(undefined);
  const standing: boolean[] = new Array(width * height).fill(false);
  const homeIds = new Set<string>();

  // Buildings.
  const buildings: TownBuilding[] = list(raw.buildings ?? []).map((v, n) => {
    const b = object(v);
    const sprite = string(b.sprite);
    const art = manifest[sprite];
    check(art, `Unknown sprite: ${sprite}`);
    check(art.kind === 'building' && art.foot, `Not a building sprite: ${sprite}`);
    const pid = b.id === undefined ? undefined : string(b.id);
    const name = pid ?? `${sprite} #${n + 1}`;
    const origin = f.point(b.at);
    const foot: [number, number] = [art.foot[0], art.foot[1]];
    check(f.inside([origin[0] + foot[0] - 1, origin[1] + foot[1] - 1]), `Footprint out of bounds: ${name}`);
    for (let y = origin[1]; y < origin[1] + foot[1]; y++) for (let x = origin[0]; x < origin[0] + foot[0]; x++) {
      check(!isWater(x, y), `Building on water: ${name}`);
      const other = solidBy[at(x, y)];
      check(!other, `Overlapping footprints: ${name} and ${other}`);
      solidBy[at(x, y)] = name;
      standing[at(x, y)] = true;
      if (pid) tiles[at(x, y)]!.building = pid;
    }
    const state = spriteState(b.state, name);
    check(state !== 'faded' || art.states.includes('faded'), `${name}: ${sprite} has no faded art`);
    let door: Point | undefined;
    if (b.door !== undefined) {
      door = f.point(b.door);
      check(door[1] === origin[1] + foot[1] && door[0] >= origin[0] && door[0] < origin[0] + foot[0], `Door must be on the front edge: ${name}`);
    }
    check(!pid || door, `A building place needs a door: ${name}`);
    // Who lives there (town/occupancy.ts). Scenery houses must say: a census household or a vacant home.
    const homes = b.home === undefined ? [] : (Array.isArray(b.home) ? b.home : [b.home]).map(h => {
      check(typeof h === 'string' && /^[a-z][a-z0-9_]*$/.test(h), `${name}: home is a home id or a list of them`);
      return h;
    });
    check(!homes.includes('vacant') || homes.length === 1, `${name}: a vacant home has nobody else in it`);
    check(pid || homes.length || !metaOf(sprite).dwelling, `Scenery house needs a home (home_NN or vacant): ${name}`);
    for (const h of homes) if (h !== 'vacant') {
      check(!homeIds.has(h), `Two buildings hold home ${h}`);
      homeIds.add(h);
    }
    check(b.datestone === undefined || (Number.isInteger(b.datestone) && Number(b.datestone) > 999 && Number(b.datestone) < 10000), `${name}: datestone is a year`);
    check(b.datestone === undefined || metaOf(sprite).lintel, `${name}: ${sprite} has no lintel for a datestone`);
    check(b.sign === undefined || metaOf(sprite).sign, `${name}: ${sprite} has no sign panel`);
    check(b.number === undefined || (Number.isInteger(b.number) && Number(b.number) > 0 && metaOf(sprite).plate), `${name}: number is a door number on a sprite with a plate`);
    return {
      ...(pid ? { id: pid } : {}), sprite, at: origin, foot, ...(door ? { door } : {}), state, ...(b.project !== undefined ? { project: string(b.project) } : {}),
      flip: bool(b.flip, 'flip') ?? false, homes,
      ...(b.datestone !== undefined ? { datestone: Number(b.datestone) } : {}),
      ...(b.sign !== undefined ? { sign: lettering(b.sign, name) } : {}),
      ...(b.number !== undefined ? { number: Number(b.number) } : {})
    };
  });

  // Props: single placements and lines.
  const props: TownProp[] = [];
  const place = (sprite: string, p: Point, opts: { solid?: boolean; flip?: boolean; state?: unknown; project?: unknown; dx?: number; dy?: number; lift?: number; mark?: string; text?: string }, from: TownProp['from']) => {
    const art = manifest[sprite];
    check(art, `Unknown sprite: ${sprite}`);
    check(art.kind === 'prop', `Not a prop sprite: ${sprite}`);
    const meta = metaOf(sprite);
    const name = `${sprite} at ${p.join(',')}`;
    const wet = isWater(p[0], p[1]);
    check(!wet || meta.water || meta.shore, `Prop on water: ${name}`);
    check(wet || !meta.water || meta.shore, `Floating prop on land: ${name}`);
    const under = solidBy[at(p[0], p[1])];
    check(!under || under.startsWith('prop '), `Prop inside a building: ${name} in ${under}`);
    const block = propBlock(sprite, p, opts.solid);
    for (const q of block) {
      check(f.inside(q), `Footprint out of bounds: ${name}`);
      const other = solidBy[at(q[0], q[1])];
      check(!other, `Overlapping footprints: ${name} and ${other}`);
    }
    for (const q of block) solidBy[at(q[0], q[1])] = `prop ${name}`;
    standing[at(p[0], p[1])] = true;
    props.push({
      sprite, at: p, dx: opts.dx ?? 0, dy: opts.dy ?? 0, lift: opts.lift ?? 0, solid: block.length > 0, flip: opts.flip ?? false,
      state: spriteState(opts.state, name), ...(opts.project !== undefined ? { project: string(opts.project) } : {}), from,
      ...(opts.mark ? { mark: opts.mark } : {}), ...(opts.text !== undefined ? { text: opts.text } : {})
    });
  };
  const markIds = new Set<string>();
  for (const v of list(raw.props ?? [])) {
    const p = object(v), sprite = string(p.sprite);
    const offset = p.offset === undefined ? [0, 0] : numbers(p.offset, 2);
    check(p.lift === undefined || (Number.isInteger(p.lift) && Number(p.lift) >= 0), 'lift is a whole number of px');
    const where = `${sprite} at ${String(p.at ?? p.line)}`;
    let mark: string | undefined;
    if (p.mark !== undefined) {
      mark = string(p.mark);
      check(/^(OQ|MR|WF|MB|CM|SH|LN)-\d$/.test(mark), `${where}: mark is a riddle id like OQ-1`);
      check(!markIds.has(mark), `Mark placed twice: ${mark}`);
      check(p.line === undefined, `${where}: a Mark is one plaque, not a line`);
      markIds.add(mark);
    }
    check(p.text === undefined || metaOf(sprite).letter, `${where}: ${sprite} has no panel to letter`);
    const text = p.text === undefined ? undefined : lettering(p.text, where);
    const opts = { solid: bool(p.solid, 'solid'), flip: bool(p.flip, 'flip'), state: p.state, project: p.project, lift: p.lift as number | undefined, mark, text };
    if (p.line !== undefined) {
      check(p.at === undefined, 'A prop has at or line, not both');
      const [a, b] = list(p.line).map(q => f.point(q));
      check(a && b && list(p.line).length === 2, 'line is two points');
      const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
      const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      check(dx === 0 || dy === 0 || Math.abs(b[0] - a[0]) === Math.abs(b[1] - a[1]), 'A line runs straight or at 45°');
      for (let i = 0; i <= steps; i++) place(sprite, [a[0] + dx * i, a[1] + dy * i], { ...opts, dx: offset[0], dy: offset[1] }, 'line');
    } else {
      place(sprite, f.point(p.at), { ...opts, dx: offset[0], dy: offset[1] }, 'prop');
    }
  }

  // Places: open ground from places:, plus every building with an id.
  const places = parsePlaces(raw, f);
  for (const b of buildings) if (b.id) places.push({ id: b.id, rect: [b.at[0], b.at[1], b.foot[0], b.foot[1]], door: b.door! });
  const seen = new Set<string>();
  for (const p of places) { check(!seen.has(p.id), `Duplicate place id: ${p.id}`); seen.add(p.id); }

  const walkableAt = (x: number, y: number): boolean => {
    const t = tiles[at(x, y)]!;
    return TERRAIN_INFO[t.kind!].walkable && !t.solid && !solidBy[at(x, y)];
  };
  const walkable = ([x, y]: Point) => f.inside([x, y]) && walkableAt(x, y);
  places.forEach(p => check(walkable(p.door), `Door on solid tile: ${p.id}`));
  const spawn = f.point(raw.spawn);
  check(walkable(spawn), 'Spawn on solid tile');
  const edges = parseEdges(raw, f, walkable);

  // Scatter, on what's still free.
  const reserved = new Set<string>([spawn.join(','), ...places.map(p => p.door.join(','))]);
  for (const e of edges) for (let n = e.from; n <= e.to; n++) reserved.add(edgeCell(f, e.side, n).join(','));
  const doors = places.map(p => p.door);
  list(raw.scatter ?? []).forEach((v, index) => {
    const s = object(v);
    const sprites = list(s.sprites).map(string);
    for (const sp of sprites) { check(manifest[sp], `Unknown sprite: ${sp}`); check(manifest[sp]!.kind === 'prop', `Not a prop sprite: ${sp}`); }
    const kinds = (v: unknown, name: string): TownTerrain[] => list(v).map(k => { check(isTownTerrain(k), `${name}: unknown terrain ${String(k)}`); return k; });
    check(typeof s.density === 'number' && s.density >= 0 && s.density <= 1, 'density is 0..1');
    check(Number.isInteger(s.seed), 'seed is an integer');
    const near = s.near === undefined ? undefined : (() => { const n = object(s.near); return { kinds: kinds(n.kinds, 'near'), radius: numbers([n.radius], 1)[0]! }; })();
    const keepout = s.keepout === undefined ? undefined : (() => {
      const k = object(s.keepout);
      return { ...(k.kinds !== undefined ? { kinds: kinds(k.kinds, 'keepout') } : {}), ...(k.radius !== undefined ? { radius: numbers([k.radius], 1)[0]! } : {}), ...(k.doors !== undefined ? { doors: numbers([k.doors], 1)[0]! } : {}) };
    })();
    const rule: ScatterRule = { sprites, on: kinds(s.on, 'on'), density: s.density as number, seed: s.seed as number, ...(near ? { near } : {}), ...(keepout ? { keepout } : {}), solid: bool(s.solid, 'solid') ?? false };
    const items = scatter(rule, {
      width, height, doors,
      terrain: (x, y) => tiles[at(x, y)]!.kind!,
      free: (x, y) => !standing[at(x, y)] && !solidBy[at(x, y)] && !tiles[at(x, y)]!.solid && !reserved.has(`${x},${y}`)
    }, index);
    for (const item of items) {
      const meta = metaOf(item.sprite), wet = isWater(item.at[0], item.at[1]);
      if (wet ? !(meta.water || meta.shore) : meta.water && !meta.shore) continue; // a lily wants water, a tuft land
      place(item.sprite, item.at, { solid: rule.solid, flip: item.flip, dx: item.dx, dy: item.dy }, 'scatter');
    }
  });

  // Collision, and the playability check: every door and edge cell reachable from the spawn.
  const walkability = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => walkableAt(x, y)));
  tiles.forEach((t, i) => { if (!walkability[Math.floor(i / width)]![i % width]) { t.solid = true; t.obstacle = 'rock'; } });
  const reached = new Uint8Array(width * height);
  const queue: Point[] = [spawn];
  while (queue.length) {
    const [x, y] = queue.pop()!;
    if (!walkable([x, y]) || reached[at(x, y)]) continue;
    reached[at(x, y)] = 1;
    queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
  for (const p of places) check(reached[at(p.door[0], p.door[1])], `Place unreachable from the spawn: ${p.id}`);
  for (const e of edges) for (let n = e.from; n <= e.to; n++) { const c = edgeCell(f, e.side, n); check(reached[at(c[0], c[1])], `Edge unreachable from the spawn: ${e.side} ${n}`); }

  // The Marks: ground to stand on beside each (its own tile first, then in front, the sides, behind), and art
  // no building, tree or other prop nearer the camera hides (props by the middle half of their art).
  const groundY = (x: number, y: number) => y * TH - tiles[at(x, Math.min(y, height - 1))]!.elev * ELEV;
  const drawn = (sprite: string, cx: number, baseY: number, lift = 0) => {
    const art = manifest[sprite]!;
    return { x0: cx - art.w / 2, x1: cx + art.w / 2, y0: baseY - lift - art.h, y1: baseY - lift, baseY };
  };
  const covers = (r: ReturnType<typeof drawn>, x: number, y: number, inset: number) =>
    x > r.x0 + inset && x < r.x1 - inset && y > r.y0 + Math.min(inset, 8) && y < r.y1;
  const marks: MarkSpot[] = props.filter(p => p.mark).map(p => {
    const stand = ([[0, 0], [0, 1], [1, 0], [-1, 0], [0, -1]] as const).map(([dx, dy]): Point => [p.at[0] + dx, p.at[1] + dy])
      .find(q => walkable(q) && reached[at(q[0], q[1])]);
    check(stand, `Mark ${p.mark} has no ground to stand on beside it`);
    const plaque = drawn(p.sprite, (p.at[0] + 0.5) * TW + p.dx, groundY(p.at[0], p.at[1]) + TH / 2 + p.dy, p.lift);
    const mx = (plaque.x0 + plaque.x1) / 2, my = (plaque.y0 + plaque.y1) / 2;
    for (const b of buildings) {
      const r = drawn(b.sprite, (b.at[0] + b.foot[0] / 2) * TW, groundY(b.at[0], b.at[1] + b.foot[1] - 1) + TH);
      check(!(r.baseY > plaque.baseY && covers(r, mx, my, 4)), `Mark ${p.mark} is hidden behind ${b.id ?? b.sprite}`);
    }
    for (const o of props) {
      const meta = metaOf(o.sprite);
      // Trees, boats, carts, anything standing in front; not what lies flat, hangs overhead or is the plaque's host.
      if (o === p || o.mark || meta.flat || meta.under || meta.overhead || o.from === 'scatter') continue;
      const r = drawn(o.sprite, (o.at[0] + 0.5) * TW + o.dx, groundY(o.at[0], o.at[1]) + TH / 2 + o.dy, o.lift);
      check(!(r.baseY > plaque.baseY && covers(r, mx, my, (r.x1 - r.x0) / 4)), `Mark ${p.mark} is hidden behind ${o.sprite} at ${o.at.join(',')}`);
    }
    return { id: p.mark!, zone: id, at: p.at, stand };
  });

  const map: MapDef = { id, name: string(raw.name), width, height, tiles, startPositions: { player: [], enemy: [] } };
  return { ...map, tiles, places, props: [], edges, spawn, walkability, format: 2, town: { buildings, props }, marks };
}

/** Text to letter in code: the pixel font's characters, `|` between lines. */
function lettering(v: unknown, where: string): string {
  const text = string(v);
  check(text.split('|').every(line => line.length > 0 && canLetter(line)), `${where}: text uses letters the pixel font lacks: ${text}`);
  return text;
}

/** Cross-file links are checked after all raw files have compiled. */
export function validateZoneLinks(zones: Record<string, ZoneDef>): void {
  const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' };
  for (const zone of Object.values(zones)) for (const edge of zone.edges) {
    const target = zones[edge.zone];
    check(target, `Missing target zone: ${edge.zone}`);
    check(target.walkability[edge.arrive[1]]?.[edge.arrive[0]], 'Arrival must be walkable and in bounds');
    check(target.edges.some(e => e.zone === zone.id && e.side === opposite[edge.side]), 'Missing reciprocal edge');
  }
}
