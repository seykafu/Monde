import type { MapDef, ObstacleKind, TerrainKind, Tile, TilePos } from "./types";
import { manhattan } from "../util/math";

// Defender damage multiplier per terrain (1.0 = neutral, <1.0 = cover).
// Most terrains stay neutral so existing battles are unaffected; tiles that
// naturally provide cover (forest canopy, broken stone) get a small benefit.
const TERRAIN_DEFEND_BONUS: Record<TerrainKind, number> = {
  grass: 1.0,
  stone: 1.0,
  dirt: 1.0,
  wood: 1.0,
  carpet: 1.0,
  water: 1.0,
  snow: 1.0,
  mud: 1.0,
  // Main asset set
  marble: 1.0,
  sand: 1.0,
  forest: 0.90,   // canopy cover
  wall: 1.0,
  door: 1.0,
  rubble: 0.92,   // broken stone offers some cover
  // Bonus asset set
  cobblestone: 1.0,
  cracked_earth: 1.0,
  ice: 1.0,
  lava: 1.0,
  moss_stone: 1.0
};

const OBSTACLE_PROFILE: Record<
  ObstacleKind,
  { blocksMovement: boolean; blocksLineOfSight: boolean; defendBonus: number; hitPenalty: number }
> = {
  none: { blocksMovement: false, blocksLineOfSight: false, defendBonus: 1.0, hitPenalty: 0 },
  hay: { blocksMovement: true, blocksLineOfSight: true, defendBonus: 1.0, hitPenalty: 0 },
  fence: { blocksMovement: false, blocksLineOfSight: false, defendBonus: 0.85, hitPenalty: 10 },
  wagon: { blocksMovement: true, blocksLineOfSight: true, defendBonus: 1.0, hitPenalty: 0 },
  barricade: { blocksMovement: false, blocksLineOfSight: false, defendBonus: 0.85, hitPenalty: 10 },
  pillar: { blocksMovement: true, blocksLineOfSight: true, defendBonus: 1.0, hitPenalty: 0 },
  throne: { blocksMovement: false, blocksLineOfSight: false, defendBonus: 0.80, hitPenalty: 5 },
  tree: { blocksMovement: true, blocksLineOfSight: true, defendBonus: 1.0, hitPenalty: 0 },
  rock: { blocksMovement: true, blocksLineOfSight: true, defendBonus: 1.0, hitPenalty: 0 },
  torch: { blocksMovement: true, blocksLineOfSight: false, defendBonus: 1.0, hitPenalty: 0 }
};

export class Grid {
  readonly width: number;
  readonly height: number;
  private readonly tiles: Tile[];

  constructor(map: MapDef) {
    this.width = map.width;
    this.height = map.height;
    this.tiles = map.tiles.map((t, idx) => {
      const x = idx % map.width;
      const y = Math.floor(idx / map.width);
      const obstacle: ObstacleKind = t.obstacle ?? "none";
      const profile = OBSTACLE_PROFILE[obstacle];
      // Defender bonus is multiplicative — fence overrides terrain.
      const defendBonus = profile.defendBonus * TERRAIN_DEFEND_BONUS[t.terrain];
      return {
        pos: { x, y },
        terrain: t.terrain,
        obstacle,
        defendBonus,
        blocksMovement: profile.blocksMovement,
        blocksLineOfSight: profile.blocksLineOfSight,
        hitPenalty: profile.hitPenalty
      };
    });
  }

  inBounds(p: TilePos): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
  }

  tileAt(p: TilePos): Tile {
    return this.tiles[p.y * this.width + p.x] as Tile;
  }

  // BFS from start, respecting obstacles and a blocked-tile predicate.
  reachableTiles(
    start: TilePos,
    range: number,
    isBlockedByUnit: (p: TilePos) => boolean
  ): TilePos[] {
    const seen = new Set<string>();
    const result: TilePos[] = [];
    const queue: { pos: TilePos; dist: number }[] = [{ pos: start, dist: 0 }];
    seen.add(`${start.x},${start.y}`);
    while (queue.length) {
      const { pos, dist } = queue.shift()!;
      if (dist > 0) result.push(pos);
      if (dist >= range) continue;
      for (const n of this.neighbors4(pos)) {
        const key = `${n.x},${n.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const tile = this.tileAt(n);
        if (tile.blocksMovement) continue;
        if (isBlockedByUnit(n)) continue;
        queue.push({ pos: n, dist: dist + 1 });
      }
    }
    return result;
  }

  neighbors4(p: TilePos): TilePos[] {
    const out: TilePos[] = [];
    const candidates = [
      { x: p.x + 1, y: p.y },
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x, y: p.y - 1 }
    ];
    for (const c of candidates) if (this.inBounds(c)) out.push(c);
    return out;
  }

  // Find a path; standard BFS with reconstruction. Returns positions excluding start.
  pathTo(start: TilePos, goal: TilePos, isBlockedByUnit: (p: TilePos) => boolean): TilePos[] | null {
    const seen = new Map<string, string>();
    const startKey = `${start.x},${start.y}`;
    seen.set(startKey, "");
    const queue: TilePos[] = [start];
    const goalKey = `${goal.x},${goal.y}`;
    while (queue.length) {
      const cur = queue.shift()!;
      const curKey = `${cur.x},${cur.y}`;
      if (curKey === goalKey) {
        // reconstruct
        const path: TilePos[] = [];
        let key: string | undefined = curKey;
        while (key && key !== startKey) {
          const [x, y] = key.split(",").map(Number);
          path.unshift({ x, y });
          key = seen.get(key);
        }
        return path;
      }
      for (const n of this.neighbors4(cur)) {
        const nk = `${n.x},${n.y}`;
        if (seen.has(nk)) continue;
        const tile = this.tileAt(n);
        if (tile.blocksMovement) continue;
        if (isBlockedByUnit(n) && nk !== goalKey) continue;
        seen.set(nk, curKey);
        queue.push(n);
      }
    }
    return null;
  }

  // Tiles within attackRange of attacker, accounting for class minimum distance (e.g., archers can't shoot adjacent).
  attackTargetTiles(from: TilePos, minRange: number, maxRange: number): TilePos[] {
    const out: TilePos[] = [];
    for (let dy = -maxRange; dy <= maxRange; dy++) {
      for (let dx = -maxRange; dx <= maxRange; dx++) {
        const d = Math.abs(dx) + Math.abs(dy);
        if (d < minRange || d > maxRange) continue;
        const t: TilePos = { x: from.x + dx, y: from.y + dy };
        if (!this.inBounds(t)) continue;
        out.push(t);
      }
    }
    return out;
  }

  isMeleeAdjacent(a: TilePos, b: TilePos): boolean {
    return manhattan(a.x, a.y, b.x, b.y) === 1;
  }
}
