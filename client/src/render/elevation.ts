import type { MapDef, TerrainKind } from "../combat/types";
import { Grid } from "../combat/Grid";
import { toGrid, viewSize, type ViewRotation } from "./ViewRotation";

// Presentation-only terrain height for the ¾ diorama board.
//
// No map in the campaign was authored with height, so most of it comes from
// the terrain itself: a `wall` is a building block, a court wall or a sheer
// rock face and should stand up off the ground; `water` is a river, harbour
// or open sea and should sit below the bank. A map can override any tile
// with an explicit `elev` on its tile def where its design is ABOUT height
// (the mountain parapet).
//
// Combat never reads any of this. Grid builds tiles from terrain + obstacle
// alone, so no elevation here can change a move range, a hit chance or a
// line of sight.

export const TERRAIN_ELEVATION: Partial<Record<TerrainKind, number>> = {
  wall: 2,
  water: -1
};

/**
 * The most a tile may rise above a standable tile directly behind it, in
 * levels. One level is under half a tile's foreshortened depth (pinned by
 * a test on the shipped constants), so the tile behind keeps its centre in
 * view — the spot its unit stands on and the player clicks. Anything taller
 * in front of somewhere a unit can stand is lowered to this.
 */
export const MAX_RISE_IN_FRONT = 1;

/**
 * Height in levels for every cell of `map` as seen under view rotation `r`
 * (explicit `elev` wins), indexed by VIEW coordinates. At r = 0 view and
 * grid coincide.
 *
 * The clearance clamp runs in view space because "in front" is a screen
 * relation: turning the board puts different tiles in front of different
 * standable ground, so each view gets its own clamp. The same wall may
 * stand a level lower from one side than from another — that is the
 * price of every standable tile staying visible from every side.
 */
export const elevationFor = (map: MapDef, r: ViewRotation = 0): ((x: number, y: number) => number) => {
  const grid = new Grid(map);
  const { w: VW, h: VH } = viewSize(map.width, map.height, r);
  const cellAt = (vx: number, vy: number) => {
    const g = toGrid({ x: vx, y: vy }, map.width, map.height, r);
    return { g, cell: map.tiles[g.y * map.width + g.x] };
  };
  const h: number[][] = [];
  for (let y = 0; y < VH; y++) {
    const row: number[] = [];
    for (let x = 0; x < VW; x++) {
      const { cell } = cellAt(x, y);
      row.push(cell ? cell.elev ?? TERRAIN_ELEVATION[cell.terrain] ?? 0 : 0);
    }
    h.push(row);
  }
  // Clearance, front-to-back in one pass: a row is only ever constrained
  // by the (already final) row behind it, and clamping only lowers.
  // A tall wall directly in front of somewhere a unit can stand would
  // otherwise swallow that tile — the bridge's south parapet hid most of
  // the deck's last row before this. Blocking props (trees, rocks,
  // pillars) have nobody standing on them, so they impose nothing.
  for (let y = 1; y < VH; y++) {
    for (let x = 0; x < VW; x++) {
      if (grid.tileAt(cellAt(x, y - 1).g).blocksMovement) continue;
      h[y]![x] = Math.min(h[y]![x]!, h[y - 1]![x]! + MAX_RISE_IN_FRONT);
    }
  }
  return (x, y) => (x < 0 || y < 0 || x >= VW || y >= VH ? 0 : h[y]![x]!);
};
