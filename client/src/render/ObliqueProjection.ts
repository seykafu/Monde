import type { TilePos } from "../combat/types";
import type { PixelPoint, Projection, ScreenDir, WorldRect } from "./Projection";
import { stepOnScreen } from "./ViewRotation";

// ─────────────────────────────────────────────────────────────────────────
// ObliqueProjection — the tilted ¾ "diorama" view (HD-2D plan, Approach C).
//
// The camera pitches down over the board instead of looking straight down.
// Three things follow from that, and together they are most of what makes
// a flat tactics grid read as a physical place:
//
//   1. FORESHORTENING. A tile's top face is `tileW` wide but only `tileH`
//      tall (tileH < tileW). The ground visibly recedes.
//   2. ELEVATION. Each tile has an integer height in levels. A raised tile
//      is drawn `elevation * elevStep` world pixels HIGHER on screen, so a
//      plateau stands up off the ground and a riverbed sinks into it.
//   3. SIDE FACES. Wherever a tile is higher than the tile in front of it
//      (the row below it on screen), the drop between them is a visible
//      south-facing wall. The whole board also sits on a slab whose front
//      edge shows as the base of the diorama.
//
// Crucially the grid stays AXIS-ALIGNED. A tile's top face is still a
// rectangle — just a shorter one, lifted by its elevation. That is why this
// projection was chosen over a rotated isometric diamond: every overlay in
// the game (move range, threat zones, target brackets, path preview) keeps
// drawing axis-aligned rectangles; it only needs `topFace()` instead of
// assuming a TILE_SIZE square. Maps keep their authored orientation, and
// "left/right facing" keeps meaning left/right on screen.
//
// Pure: no Phaser import, so the whole thing — including input picking
// through elevated terrain — is unit-tested in Node.
// ─────────────────────────────────────────────────────────────────────────

export interface ObliqueParams {
  /** World x of the grid's left edge. */
  originX: number;
  /** World y of row 0's top edge at elevation 0. */
  originY: number;
  /** Top-face width of one tile, world px. */
  tileW: number;
  /** Top-face height of one tile after foreshortening, world px. */
  tileH: number;
  /** World px one elevation level lifts a tile. */
  elevStep: number;
  /**
   * Thickness of the slab the board sits on, world px. Shown as the front
   * wall of the bottom row and below any tile that drops off the map edge.
   */
  slabDepth: number;
  gridWidth: number;
  gridHeight: number;
  /** Elevation in levels for a tile. Omitted → a flat board. */
  elevationAt?: (x: number, y: number) => number;
}

export class ObliqueProjection implements Projection {
  readonly originX: number;
  readonly originY: number;
  readonly tileW: number;
  readonly tileH: number;
  readonly elevStep: number;
  readonly slabDepth: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
  private readonly elev: (x: number, y: number) => number;

  constructor(p: ObliqueParams) {
    this.originX = p.originX;
    this.originY = p.originY;
    this.tileW = p.tileW;
    this.tileH = p.tileH;
    this.elevStep = p.elevStep;
    this.slabDepth = p.slabDepth;
    this.gridWidth = p.gridWidth;
    this.gridHeight = p.gridHeight;
    const f = p.elevationAt;
    this.elev = f ? (x, y) => f(x, y) : () => 0;
  }

  /** Elevation in levels; off-grid reads as 0 so edge faces measure to ground. */
  elevationAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.gridWidth || y >= this.gridHeight) return 0;
    return this.elev(x, y);
  }

  /**
   * World-space CENTRE of the tile's top face — where a unit's feet go, and
   * where every per-tile effect should anchor. Same contract as the
   * orthographic projection's tile centre, so call sites don't change.
   */
  tileToWorld(tile: { x: number; y: number }): PixelPoint {
    const top = this.topFace(tile);
    return { x: top.x + top.w / 2, y: top.y + top.h / 2 };
  }

  /** The visible top face of a tile, lifted by its elevation. */
  topFace(tile: { x: number; y: number }): WorldRect {
    return {
      x: this.originX + tile.x * this.tileW,
      y: this.originY + tile.y * this.tileH - this.elevationAt(tile.x, tile.y) * this.elevStep,
      w: this.tileW,
      h: this.tileH
    };
  }

  /**
   * Height in world px of the south-facing wall under a tile's top face:
   * how far its top sits above the top of the tile in front of it. Zero on
   * flat ground (the front neighbour's top face butts straight up against
   * it). The bottom row always shows the full slab, since nothing is in
   * front of it but the edge of the world.
   */
  frontFaceHeight(tile: { x: number; y: number }): number {
    const here = this.elevationAt(tile.x, tile.y);
    if (tile.y === this.gridHeight - 1) {
      return here * this.elevStep + this.slabDepth;
    }
    const inFront = this.elevationAt(tile.x, tile.y + 1);
    return Math.max(0, here - inFront) * this.elevStep;
  }

  /** The wall directly under a tile's top face (h may be 0). */
  frontFace(tile: { x: number; y: number }): WorldRect {
    const top = this.topFace(tile);
    return { x: top.x, y: top.y + top.h, w: top.w, h: this.frontFaceHeight(tile) };
  }

  /**
   * Draw/depth order key. Rows further down the screen are nearer the
   * camera and must paint over rows behind them; within a row, a raised
   * tile paints over a lower one so a wall occludes the floor behind it.
   * Callers scale this into Phaser depth bands.
   */
  depthKey(tile: { x: number; y: number }): number {
    return tile.y + this.elevationAt(tile.x, tile.y) * 0.001;
  }

  neighborOnScreen(tile: { x: number; y: number }, dir: ScreenDir): TilePos {
    return stepOnScreen(tile, dir);
  }

  /**
   * Inverse of tileToWorld for input picking, and elevation-aware: a raised
   * tile covers screen area that belongs to the rows BEHIND it, so we test
   * tiles front-to-back and return the first whose visible surface (top
   * face + its front wall) contains the point. That is exactly the painter's
   * order reversed, so the tile you see is the tile you click.
   */
  worldToTile(worldX: number, worldY: number): TilePos | null {
    const x = Math.floor((worldX - this.originX) / this.tileW);
    if (x < 0 || x >= this.gridWidth) return null;
    for (let y = this.gridHeight - 1; y >= 0; y--) {
      const top = this.topFace({ x, y });
      const bottom = top.y + top.h + this.frontFaceHeight({ x, y });
      if (worldY >= top.y && worldY < bottom) return { x, y };
    }
    return null;
  }

  /**
   * World-space bounds of everything the board draws, including raised
   * terrain poking above row 0 and the slab below the last row. Used to
   * size the camera so no part of the diorama is unreachable by panning.
   */
  bounds(): WorldRect {
    let minY = this.originY;
    for (let y = 0; y < this.gridHeight; y++) {
      for (let x = 0; x < this.gridWidth; x++) {
        minY = Math.min(minY, this.topFace({ x, y }).y);
      }
    }
    let maxY = this.originY + this.gridHeight * this.tileH;
    for (let x = 0; x < this.gridWidth; x++) {
      const f = this.frontFace({ x, y: this.gridHeight - 1 });
      maxY = Math.max(maxY, f.y + f.h);
    }
    return { x: this.originX, y: minY, w: this.gridWidth * this.tileW, h: maxY - minY };
  }
}
