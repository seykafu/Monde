import { parse } from 'yaml';
import { Grid } from '../combat/Grid';
import type { MapDef, TerrainKind, ObstacleKind } from '../combat/types';

export type Point = [number, number];
export interface Place { id: string; rect: [number, number, number, number]; door: Point }
export interface Edge { side: 'north' | 'south' | 'east' | 'west'; from: number; to: number; zone: string; arrive: Point }
export interface ZoneTile { terrain: TerrainKind; obstacle?: ObstacleKind; elev: number; solid?: boolean; building?: string }
export interface ZoneDef extends MapDef {
  tiles: ZoneTile[];
  places: Place[];
  props: { kind: string; at: Point }[];
  edges: Edge[];
  spawn: Point;
  /** Row-major [y][x]; buildings always block, even if solid is false. */
  walkability: boolean[][];
}
const terrains = ['grass', 'stone', 'dirt', 'wood', 'water', 'carpet', 'snow', 'mud', 'marble', 'sand', 'forest', 'wall', 'door', 'rubble', 'cobblestone', 'cracked_earth', 'ice', 'lava', 'moss_stone'] satisfies TerrainKind[];
const obstacles = ['none', 'hay', 'fence', 'wagon', 'barricade', 'pillar', 'throne', 'tree', 'rock', 'torch'] satisfies ObstacleKind[];
export const propArt: Record<string, ObstacleKind> = { lamp_post: 'torch', bench: 'hay', tree: 'tree', crate: 'hay', barrel: 'rock', sign: 'fence', fountain: 'pillar', bollard: 'pillar', gate: 'fence' };
function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function object(v: unknown): Record<string, unknown> { check(v && typeof v === 'object' && !Array.isArray(v), 'Expected mapping'); return v as Record<string, unknown>; }
function string(v: unknown): string { check(typeof v === 'string' && v.length > 0, 'Expected nonempty string'); return v; }
function numbers(v: unknown, n: number): number[] { check(Array.isArray(v) && v.length === n && v.every(Number.isInteger), `Expected ${n} integers`); return v as number[]; }
function list(v: unknown): unknown[] { check(Array.isArray(v), 'Expected list'); return v; }
function rows(v: unknown, w: number, h: number): string[] {
  const result = string(v).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  check(result.length === h && result.every(r => r.length === w), `Grid must have ${h} rows of ${w} characters`);
  return result;
}

/** Integer tile coordinates name cells; continuous player positions use cell centres at +0.5. */
export function compileZone(text: string): ZoneDef {
  const raw = object(parse(text));
  const [width, height] = numbers(raw.size, 2) as Point;
  check(width > 0 && height > 0, 'Size must be positive');
  const inside = ([x, y]: number[]) => x! >= 0 && y! >= 0 && x! < width && y! < height;
  const point = (v: unknown): Point => { const p = numbers(v, 2) as Point; check(inside(p), 'Point out of bounds'); return p; };
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
  const places = list(raw.places ?? []).map(v => {
    const p = object(v), rect = numbers(p.rect, 4) as Place['rect'];
    const [x, y, w, h] = rect;
    check(w > 0 && h > 0 && inside([x, y]) && inside([x + w - 1, y + h - 1]), 'Place rect out of bounds');
    const door = point(p.door);
    check(door[0] >= x - 1 && door[0] <= x + w && door[1] >= y - 1 && door[1] <= y + h, 'Door must touch its place');
    return { id: string(p.id), rect, door };
  });
  check(new Set(places.map(p => p.id)).size === places.length, 'Duplicate place id');
  tiles.forEach((t, i) => {
    if (!t.building) return;
    const p = places.find(p => p.id === t.building);
    check(p, `Unknown building place: ${t.building}`);
    const [x, y, w, h] = p.rect;
    check(i % width >= x && i % width < x + w && Math.floor(i / width) >= y && Math.floor(i / width) < y + h, 'Building outside its rect');
  });
  const props = list(raw.props ?? []).map(v => {
    const p = object(v), kind = string(p.kind), at = point(p.at);
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
  const spawn = point(raw.spawn);
  check(walkable(spawn), 'Spawn on solid tile');
  const edges = list(raw.edges ?? []).map(v => {
    const e = object(v);
    check(['north', 'south', 'east', 'west'].includes(String(e.side)), 'Unknown edge side');
    const side = e.side as Edge['side'];
    const [from, to] = numbers([e.from, e.to], 2) as Point;
    check(from >= 0 && to >= from && to < (side === 'north' || side === 'south' ? width : height), 'Edge range out of bounds');
    for (let n = from; n <= to; n++) check(walkable(side === 'north' ? [n, 0] : side === 'south' ? [n, height - 1] : side === 'west' ? [0, n] : [width - 1, n]), 'Edge on solid tile');
    const arrive = numbers(e.arrive, 2) as Point;
    check(arrive.every(n => n >= 0), 'Invalid arrival');
    return { side, from, to, zone: string(e.zone), arrive };
  });
  edges.forEach((e, i) => check(!edges.slice(0, i).some(other => other.side === e.side && e.from <= other.to && other.from <= e.to), 'Overlapping edges'));
  return { ...map, tiles, places, props, edges, spawn, walkability };
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
