// Keystone perspective — the camera tilt on the ¾ battle board.
//
// The oblique projection foreshortens the board uniformly, which reads as
// "tilted" but not as "receding": a flat map still looks like a flat grid
// seen at an angle. Real perspective shrinks things with distance. This
// module is that shrink, applied to the world camera's finished image by
// PerspectivePipeline, so tiles, walls, units, overlays and effects all
// recede together with no per-object math anywhere.
//
// The model, in normalized screen space (u across 0..1, t = distance UP
// from the bottom edge 0..1):
//
//   horizontal scale at height t:   w(t) = 1 − k·t
//   vertical: screen height t shows source height s = −ln(1 − k·t) / k
//
// The vertical term is chosen so dt/ds = w(t): at every height the image is
// scaled by the SAME factor on both axes. That's what makes it perspective
// rather than a keystone squash — a soldier near the top of the screen is
// smaller, not thinner. Lines of tiles stay straight and converge toward a
// vanishing point above the screen.
//
// These functions are the single source of truth. The GLSL in
// PerspectivePipeline implements screenToSource verbatim, and input picking
// runs pointers back through the same function, so the tile you see under
// the pointer is the tile that gets clicked. Pure — no Phaser — and tested.

export interface KeystoneParams {
  /** Tilt strength k: the top edge of the screen is scaled by (1 − k). */
  k: number;
  /** Optical axis as a fraction of the screen width (the playfield centre). */
  centerX: number;
}

/**
 * Screen pixel → the pixel of the un-warped camera image shown there.
 * `null` where the warp reveals nothing (outside the camera image).
 */
export const screenToSource = (
  X: number,
  Y: number,
  W: number,
  H: number,
  p: KeystoneParams
): { x: number; y: number } | null => {
  const u = X / W;
  const t = 1 - Y / H;
  const w = 1 - p.k * t;
  if (w <= 0) return null;
  const us = p.centerX + (u - p.centerX) / w;
  const s = p.k === 0 ? t : -Math.log(1 - p.k * t) / p.k;
  // A hair of tolerance: a point exactly on the image edge must survive a
  // round trip that lands it at 1.0000000001.
  const EPS = 1e-9;
  if (us < -EPS || us > 1 + EPS || s < -EPS || s > 1 + EPS) return null;
  return { x: Math.min(1, Math.max(0, us)) * W, y: (1 - Math.min(1, Math.max(0, s))) * H };
};

/** Un-warped camera pixel → where it lands on screen. Inverse of the above. */
export const sourceToScreen = (
  x: number,
  y: number,
  W: number,
  H: number,
  p: KeystoneParams
): { x: number; y: number } => {
  const us = x / W;
  const s = 1 - y / H;
  const t = p.k === 0 ? s : (1 - Math.exp(-p.k * s)) / p.k;
  const w = 1 - p.k * t;
  const u = p.centerX + (us - p.centerX) * w;
  return { x: u * W, y: (1 - t) * H };
};
