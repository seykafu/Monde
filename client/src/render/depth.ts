// Depth bands for the battle world camera.
//
// Before the ¾ board, nearly everything in a battle sat at depth 0 and drew
// in creation order: tiles, props, overlays and units interleaved by
// accident, units never overlapped each other correctly, and a few objects
// used negative or ad-hoc depths that put them under the floor (the Ravage
// aura at -1 was drawn beneath the tiles and never seen).
//
// A tilted board needs a real layering contract, so here it is. Bands are
// wide apart on purpose; anything that sorts WITHIN a band does so with a
// small fractional offset that can never reach the next band.
//
//   BACKDROP        painted sky / distance, parallaxed behind everything
//   TERRAIN         tile tops and the walls under them, painter-sorted
//   TERRAIN         tile overlays (shimmer, foam, AO, grid) sort per row
//                   inside this band — see terrainOverlayDepth
//   TERRAIN_FX      reserved (was every terrain overlay; see above)
//   SHADOW          contact shadows of props and units
//   LIGHT           light pooling ON the ground: torch pools, Ravage aura
//   GROUND_OVERLAY  move / attack / danger / threat washes and contours
//   GROUND_MARK     path preview, hover cursor, active-unit ring
//   ACTORS          props and unit billboards, y-sorted by where their feet are
//   UNIT_HUD        HP bars and stance glyphs — always readable over actors
//   ACTIVE_ARROW    the bobbing ▼ over the unit whose turn it is
//
// Everything above (atmosphere 23, darkness 25, combat VFX 31-46, floaters
// 40+) keeps the values it already had.

export const DEPTH = {
  BACKDROP: -100,
  BACKDROP_DIM: -99,
  BOARD_SHADOW: -50,
  TERRAIN: 0,
  TERRAIN_FX: 1,
  CLOUD_SHADOW: 1.5,
  SHADOW: 2,
  LIGHT: 3,
  /**
   * Shadows thrown BY a torch: above its light pool, because a shadow is
   * where that light doesn't land. (Sun shadows sit at SHADOW, under the
   * pools — torchlight can fall into a shadow the sun made.)
   */
  TORCH_SHADOW: 3.2,
  GROUND_OVERLAY: 4,
  GROUND_MARK: 5,
  ACTORS: 10,
  UNIT_HUD: 14,
  ACTIVE_ARROW: 15,
  ATMOSPHERE: 23,
  DARKNESS: 25,
  /** Tactical marks lifted above the fog on dark battles, so they stay readable. */
  OVER_DARK: 26,
  FLOATER: 40
} as const;

/**
 * Terrain depth for a tile. `key` is Projection.depthKey (row + a hair for
 * elevation), scaled far below 1 so the whole board stays inside TERRAIN.
 */
export const terrainDepth = (key: number): number => DEPTH.TERRAIN + key * 1e-4;

/**
 * Depth for things painted ON row `row`'s top faces: water shimmer, shore
 * foam, ambient occlusion, grid lines. Above every tile, face and lip of
 * that row (keys row-0.001 … row+0.006, faces +0.5, lips +0.6), below every
 * tile of the row in front — so a raised tile in front hides them exactly
 * as it hides the ground they sit on. A single band above ALL terrain let a
 * sunk river's shimmer and a courtyard's grid draw across the front of the
 * wall standing before them.
 */
export const terrainOverlayDepth = (row: number): number => terrainDepth(row + 0.8);

/**
 * Actor depth from the world y of an actor's FEET. Nearer the camera =
 * further down the screen = drawn later. 5e-5 per px keeps a 4000px-tall
 * board inside the band (10 → 10.2).
 */
export const actorDepth = (footY: number): number => DEPTH.ACTORS + footY * 5e-5;
