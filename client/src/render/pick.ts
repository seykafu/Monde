import type { TilePos } from "../combat/types";

// ─────────────────────────────────────────────────────────────────────────
// Picking on the tilted board: which tile does a pointer mean?
//
// A figure stands up off its tile, so on the ¾ board a unit's body covers
// the tile behind it — and the unit standing there. The old rule gave any
// overlap to the front-most sprite's bounding box, and let an empty move
// tile under the pointer beat any body. With your unit directly in front
// of an enemy, that left 8 of the enemy's 60 px clickable: its head
// selected the empty tile behind it, and everything lower selected your
// own unit.
//
// Now, in order:
//   1. While moving or attacking, a unit the click would ACT on (an
//      attack target) wins if the pointer is on its figure or on the tile
//      it stands on — even where another figure is drawn over it.
//   2. Otherwise, of the units whose figure is under the pointer (and the
//      one standing on the tile under it), the one whose body is NEAREST
//      the pointer wins — not simply the one in front.
//   3. An empty tile the active unit can move to still beats a non-target
//      body drawn over it, so walking behind a soldier stays possible.
//
// Pure: the scene measures figures and distances; this decides.
// ─────────────────────────────────────────────────────────────────────────

export interface PickCandidate {
  id: string;
  tile: TilePos;
  /** Pointer → the unit's body centre, world px. */
  d: number;
}

export interface PickInput {
  /** The ground tile under the pointer, or null off the board. */
  ground: TilePos | null;
  /** Units whose drawn figure is under the pointer. */
  hits: readonly PickCandidate[];
  /** The unit standing on the ground tile, if any (even if not under the pointer's pixel). */
  groundOccupant: PickCandidate | null;
  /** Units a click would act on right now (attack targets). */
  actionable: ReadonlySet<string>;
  /** An empty tile the active unit can move to. */
  isEmptyDestination: (t: TilePos) => boolean;
}

const same = (a: TilePos, b: TilePos): boolean => a.x === b.x && a.y === b.y;

export const pickTile = (i: PickInput): TilePos | null => {
  // 1. Targets first.
  if (i.actionable.size > 0) {
    let best: PickCandidate | null = null;
    for (const h of i.hits) {
      if (i.actionable.has(h.id) && (!best || h.d < best.d)) best = h;
    }
    const g = i.groundOccupant;
    if (g && i.actionable.has(g.id) && (!best || g.d < best.d)) best = g;
    if (best) return { ...best.tile };
  }
  // 2. The nearest body.
  let best: PickCandidate | null = null;
  for (const h of i.hits) if (!best || h.d < best.d) best = h;
  const g = i.groundOccupant;
  if (g && !i.hits.some((h) => h.id === g.id) && (!best || g.d < best.d)) best = g;
  if (!best) return i.ground ? { ...i.ground } : null;
  if (i.ground && same(i.ground, best.tile)) return { ...i.ground };
  // 3. Walking behind a soldier.
  if (i.ground && i.isEmptyDestination(i.ground)) return { ...i.ground };
  return { ...best.tile };
};
