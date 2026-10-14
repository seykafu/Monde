// Geometry of the ¾ diorama board. Pure constants, no Phaser import, so the
// invariants between them are unit-tested (see ObliqueProjection.test.ts).
//
// Units are 44×55 billboards on 48px-wide tiles. The numbers below are the
// ones that were tuned by eye against captured frames of every biome; the
// relationships between them are the part that must not drift.

import { TILE_SIZE } from "../util/constants";

/** Tile top-face width — unchanged from the flat board, so maps still fit. */
export const DIORAMA_TILE_W = TILE_SIZE;

/**
 * Foreshortened top-face depth. 0.75 of the width reads as a clear camera
 * pitch without squashing the painted tiles into stripes.
 */
export const DIORAMA_TILE_H = 36;

/**
 * World px one elevation level lifts a tile. MUST stay under half of
 * DIORAMA_TILE_H: a one-level rise then covers less than half of the tile
 * behind it, so that tile's centre — where its unit stands and where the
 * player naturally clicks — stays visible. Two-level walls do cover the
 * centre behind them; that is correct occlusion, and unit sprites always
 * draw above terrain so nobody vanishes behind a wall.
 */
export const DIORAMA_ELEV_STEP = 14;

/** Thickness of the slab under the board, shown along its front edge. */
export const DIORAMA_SLAB_DEPTH = 30;

/**
 * Where a unit's feet sit, measured down from the centre of its tile's top
 * face. Slightly in front of centre, so a standing figure reads as ON the
 * tile rather than hovering over its back edge.
 */
export const DIORAMA_FOOT_DY = 8;

/** Unit billboard size on the flat board (the original look). */
export const UNIT_FLAT_W = 44;
export const UNIT_FLAT_H = 55;

/**
 * Unit billboard size on the diorama. The sheets are 32×40 pixel art;
 * 48×60 is exactly 1.5×, which the 2× render buffer turns into a clean 3×
 * device scale — every art pixel the same size on screen. The flat board's
 * 44×55 was a non-integer 2.75×, which is why sprite edges shimmered.
 * Bigger AND crisper, and figures standing on a receding board need the
 * extra size to stay readable in the back rows.
 */
export const UNIT_DIORAMA_W = 48;
export const UNIT_DIORAMA_H = 60;

/**
 * Camera tilt for the keystone perspective pass (render/keystone.ts): the
 * top of the screen is drawn at (1 − k) scale. 0.12 makes the far rows of a
 * board visibly recede without making distant units hard to read.
 */
export const DIORAMA_PERSPECTIVE_K = 0.12;
