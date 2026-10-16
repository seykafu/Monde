import { Grid } from '../Grid';
import type { TilePos } from '../types';
import type { ZoneDef } from '../../world/zoneFormat';

/** A real, collision-preserving window of the town; props/elevation retain their authored positions. */
export function cutArena(zone: ZoneDef, centre: TilePos, width = 10, height = 8): ZoneDef {
  width = Math.min(width, zone.width); height = Math.min(height, zone.height);
  const x0 = Math.max(0, Math.min(zone.width - width, Math.floor(centre.x) - Math.floor(width / 2)));
  const y0 = Math.max(0, Math.min(zone.height - height, Math.floor(centre.y) - Math.floor(height / 2)));
  const inside = ([x, y]: readonly number[]) => x! >= x0 && y! >= y0 && x! < x0 + width && y! < y0 + height;
  const shift = ([x, y]: [number, number]): [number, number] => [x - x0, y - y0];
  const tiles = Array.from({ length: width * height }, (_, i) => ({ ...zone.tiles[(y0 + Math.floor(i / width)) * zone.width + x0 + i % width]! }));
  return { ...zone, id: `${zone.id}:scuffle:${x0}:${y0}`, width, height, tiles,
    walkability: Array.from({ length: height }, (_, y) => zone.walkability[y0 + y]!.slice(x0, x0 + width)),
    places: [], edges: [], marks: [], props: zone.props.filter(p => inside(p.at)).map(p => ({ ...p, at: shift(p.at) })),
    spawn: shift([Math.floor(centre.x), Math.floor(centre.y)]), startPositions: { player: [], enemy: [] },
    ...(zone.town ? { town: {
      buildings: zone.town.buildings.filter(b => b.at[0] < x0 + width && b.at[0] + b.foot[0] > x0 && b.at[1] < y0 + height && b.at[1] + b.foot[1] > y0)
        .map(b => ({ ...b, at: shift(b.at), ...(b.door ? { door: shift(b.door) } : {}) })),
      props: zone.town.props.filter(p => inside(p.at)).map(p => ({ ...p, at: shift(p.at) }))
    } } : {}) };
}
export function arenaGrid(zone: ZoneDef): Grid {
  return new Grid({ ...zone, tiles: zone.tiles.map((t, i) => ({ ...t, obstacle: zone.walkability[Math.floor(i / zone.width)]![i % zone.width] ? 'none' : 'rock' })) });
}
/** Use one connected component: no unit can spawn stranded behind a bakery wall. */
export function deploymentTiles(zone: ZoneDef): TilePos[] {
  const grid = arenaGrid(zone), all: TilePos[][] = [], seen = new Set<string>();
  for (let y = 0; y < zone.height; y++) for (let x = 0; x < zone.width; x++) {
    const p = { x, y }, key = `${x},${y}`;
    if (seen.has(key) || grid.tileAt(p).blocksMovement) continue;
    const group = [p, ...grid.reachableTiles(p, zone.width * zone.height, () => false)];
    group.forEach(t => seen.add(`${t.x},${t.y}`)); all.push(group);
  }
  return (all.sort((a, b) => b.length - a.length)[0] ?? []).sort((a, b) => a.x - b.x || a.y - b.y);
}
