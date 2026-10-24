import type { WorldRect } from '../render/Projection';

/** A rectangle of the 1280×720 design, px. */
export interface PageRect { x: number; y: number; w: number; h: number }

/** Where the Scuffle's world camera looks: its zoom over the design, and the world point at the page's top-left. */
export interface ArenaFrame { zoom: number; scrollX: number; scrollY: number }

export interface FitOptions {
  /** Never drawn closer than this. */
  maxZoom: number;
  /** World px kept clear above the board, where the back row's fighters stand up into. */
  headroom: number;
  /** Design px kept clear inside the page's edges. */
  pad: number;
}

/**
 * Frame the board (ObliqueProjection.bounds) on its page: as large as fits, centred across and sat on the page's floor,
 * so any spare height goes above the back row, where the buildings rise.
 */
export function frameArena(board: WorldRect, page: PageRect, fit: FitOptions): ArenaFrame {
  const zoom = Math.min(fit.maxZoom, (page.w - 2 * fit.pad) / board.w, (page.h - 2 * fit.pad) / (board.h + fit.headroom));
  const left = (page.w - board.w * zoom) / 2, top = page.h - fit.pad - board.h * zoom;
  return { zoom, scrollX: board.x - left / zoom, scrollY: board.y - top / zoom };
}
