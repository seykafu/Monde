/**
 * Where a speech bubble goes over a resident (pure: no Phaser). World pixels in, world pixels out.
 *
 * The bubble sits over the speaker's head with its tail pointing down at them, centred on them but kept inside the
 * camera's view and clear of the HUD: the zone title and controls along the top left, the clock and Pillar strip top
 * right, the E prompt and toasts along the bottom. Near the top of the screen it flips under the speaker's feet, tail
 * up, rather than slide under the clock.
 */
import { screenToSource, type KeystoneParams } from '../../render/keystone';

export interface BubbleAnchor {
  /** The speaker's x and the top of their head (or what's drawn over it), world px. */
  x: number;
  headY: number;
  /** Their feet, world px (a flipped bubble hangs below them). */
  footY: number;
}
export interface ViewRect { x: number; y: number; width: number; height: number }
export interface BubbleSafe { top: number; bottom: number; side: number }
export interface BubblePlacement { left: number; top: number; flipped: boolean; /** The tail's x, world px. */ tailX: number }

/** The tail's height, px. */
export const TAIL = 6;

/**
 * HUD-free margins of the view, in un-warped camera pixels (the camera's perspective pipeline squeezes the top of the
 * image, so a screen band maps to a slightly smaller one in the source). Screen design px: the clock and Pillar strip
 * reach y 156, the toast and E prompt start at y 620.
 */
export function hudSafe(width: number, height: number, keystone: KeystoneParams, screen = { top: 162, bottom: 104, side: 18 }): BubbleSafe {
  const top = screenToSource(width / 2, screen.top, width, height, keystone)?.y ?? screen.top;
  const bottom = screenToSource(width / 2, height - screen.bottom, width, height, keystone)?.y ?? height - screen.bottom;
  return { top, bottom: height - bottom, side: screen.side };
}

export function placeBubble(box: { w: number; h: number }, anchor: BubbleAnchor, view: ViewRect, safe: BubbleSafe): BubblePlacement {
  const minX = view.x + safe.side, maxX = view.x + view.width - safe.side;
  const left = Math.round(Math.max(minX, Math.min(maxX - box.w, anchor.x - box.w / 2)));
  let top = Math.round(anchor.headY - TAIL - box.h);
  let flipped = false;
  if (top < view.y + safe.top) {
    flipped = true;
    top = Math.round(anchor.footY + 4 + TAIL);
  }
  // Never below the bottom band either (a speaker at the very bottom: keep the bubble over them, under the HUD line).
  top = Math.min(top, Math.round(view.y + view.height - safe.bottom - box.h));
  const tailX = Math.round(Math.max(left + 8, Math.min(left + box.w - 8, anchor.x)));
  return { left, top, flipped, tailX };
}
