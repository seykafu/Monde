import type { TilePos } from "../combat/types";
import type { PixelPoint, Projection, ScreenDir, WorldRect } from "./Projection";

// ─────────────────────────────────────────────────────────────────────────
// View rotation — turning the ¾ board in 90° steps.
//
// On a tilted board the rows in front hide part of the rows behind them:
// a soldier's body stands over the tile behind him, a wall over the floor
// behind it. Turning the board lets the player look from another side and
// see (and click) what was hidden.
//
// Nothing about the battle rotates. Combat, the Grid, every TilePos in the
// game stays in GRID space. Rotation is a VIEW mapping layered over the
// projection: grid cell (x, y) is drawn at view cell toView(x, y), and the
// tilted projection lays out VIEW cells exactly as it always laid out grid
// cells. RotatedProjection composes the two, so every call site keeps
// passing grid tiles and getting world pixels back.
//
// Rotation r turns the board r quarter-turns clockwise on screen:
//   r = 0  as authored — north at the back
//   r = 1  north on the right, west at the back
//   r = 2  north at the front
//   r = 3  north on the left, east at the back
//
// Pure: no Phaser, unit-tested with the projections it wraps.
// ─────────────────────────────────────────────────────────────────────────

export type ViewRotation = 0 | 1 | 2 | 3;

export const normalizeRotation = (r: number): ViewRotation => (((r % 4) + 4) % 4) as ViewRotation;

/** View dimensions of a W×H grid under rotation r. */
export const viewSize = (w: number, h: number, r: ViewRotation): { w: number; h: number } =>
  r % 2 === 0 ? { w, h } : { w: h, h: w };

/** Grid cell → the view cell it is drawn at. */
export const toView = (t: { x: number; y: number }, w: number, h: number, r: ViewRotation): TilePos => {
  switch (r) {
    case 0: return { x: t.x, y: t.y };
    case 1: return { x: h - 1 - t.y, y: t.x };
    case 2: return { x: w - 1 - t.x, y: h - 1 - t.y };
    case 3: return { x: t.y, y: w - 1 - t.x };
  }
};

/** View cell → the grid cell drawn there. Inverse of toView. */
export const toGrid = (v: { x: number; y: number }, w: number, h: number, r: ViewRotation): TilePos => {
  switch (r) {
    case 0: return { x: v.x, y: v.y };
    case 1: return { x: v.y, y: h - 1 - v.x };
    case 2: return { x: w - 1 - v.x, y: h - 1 - v.y };
    case 3: return { x: w - 1 - v.y, y: v.x };
  }
};

const STEP: Record<ScreenDir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 }
};

/** The cell one step from `t` in a screen direction, in an UNrotated view. */
export const stepOnScreen = (t: { x: number; y: number }, dir: ScreenDir): TilePos =>
  ({ x: t.x + STEP[dir].dx, y: t.y + STEP[dir].dy });

/**
 * A projection over GRID tiles that draws them rotated. `inner` lays out
 * VIEW cells (it must be built for the view's dimensions, with any
 * elevation expressed in view coordinates).
 */
export class RotatedProjection implements Projection {
  readonly gridWidth: number;
  readonly gridHeight: number;

  constructor(
    readonly inner: Projection,
    gridWidth: number,
    gridHeight: number,
    readonly rotation: ViewRotation
  ) {
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
  }

  /** Grid cell → view cell under this projection's rotation. */
  view(t: { x: number; y: number }): TilePos {
    return toView(t, this.gridWidth, this.gridHeight, this.rotation);
  }

  /** View cell → grid cell under this projection's rotation. */
  grid(v: { x: number; y: number }): TilePos {
    return toGrid(v, this.gridWidth, this.gridHeight, this.rotation);
  }

  tileToWorld(tile: { x: number; y: number }): PixelPoint {
    return this.inner.tileToWorld(this.view(tile));
  }

  worldToTile(worldX: number, worldY: number): TilePos | null {
    const v = this.inner.worldToTile(worldX, worldY);
    return v ? this.grid(v) : null;
  }

  topFace(tile: { x: number; y: number }): WorldRect {
    return this.inner.topFace(this.view(tile));
  }

  frontFaceHeight(tile: { x: number; y: number }): number {
    return this.inner.frontFaceHeight(this.view(tile));
  }

  depthKey(tile: { x: number; y: number }): number {
    return this.inner.depthKey(this.view(tile));
  }

  neighborOnScreen(tile: { x: number; y: number }, dir: ScreenDir): TilePos {
    return this.grid(stepOnScreen(this.view(tile), dir));
  }

  bounds(): WorldRect {
    return this.inner.bounds();
  }
}
