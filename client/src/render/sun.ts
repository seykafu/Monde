// The sun on the ¾ board.
//
// The board is lit by a low sun in the west-south-west, off the viewer's
// left shoulder: raised tops catch light along their west and front edges
// and fall into shade on the east. (Walls stay darker than the tops above
// them because tops face the whole sky; ambient occlusion is sky-light,
// not sun, and falls on every side.) Figures standing on it had only a round contact blob under their
// feet — lit from nowhere. A cast shadow, the figure's own silhouette laid
// on the ground and thrown away from the light, puts them IN the same
// light as the board, and it is the strongest single cue that a figure is
// standing on a surface rather than pasted over a picture.
//
// With the sun low at the front-left, shadows fall up the board to the
// north-east: behind the figures, onto open ground. (Thrown toward the
// camera they landed under each unit's own HP bar and the row in front,
// and could hardly be seen.)
//
// A silhouette is the figure's texture tinted black, squashed about a
// foot-level origin so it stays planted, and leaned over to the north-east.
// Off on dark battles, where the light is torches and there is no sun.

export interface Sun {
  /** Lean of the silhouette, degrees clockwise from upright. */
  angle: number;
  /** Length of the shadow as a fraction of the figure's height. */
  squash: number;
  /** Opacity of the shadow. */
  alpha: number;
}

export const SUN: Sun = { angle: 58, squash: 0.55, alpha: 0.32 };

/**
 * Where the feet are in a unit sheet frame, as an origin-y fraction. The
 * sheets are foot-anchored with a few rows of padding under the boots:
 * row 36 of 40 is where the figure meets the ground.
 */
export const UNIT_FOOT_ORIGIN = 0.9;

/**
 * The shadow a flame throws on a figure standing at (x, y): leaning straight
 * away from the light, longer the further out the figure stands (a torch
 * is barely above head height), darkest close in and gone at the edge of
 * the light. Null when the figure is outside every light's reach.
 */
export const torchShadow = (
  x: number,
  y: number,
  lights: ReadonlyArray<{ x: number; y: number; radius: number }>
): Sun | null => {
  let best: { dx: number; dy: number; d: number; r: number } | null = null;
  for (const l of lights) {
    const dx = x - l.x, dy = y - l.y, d = Math.hypot(dx, dy);
    if (d < l.radius && (!best || d / l.radius < best.d / best.r)) best = { dx, dy, d, r: l.radius };
  }
  if (!best || best.d < 4) return null;
  const falloff = 1 - best.d / best.r;
  // How much the shadow points toward the camera (down the board): 0 for
  // a sideways or up-board shadow, 1 straight at the viewer. Shadows are
  // drawn in one band above the terrain, so a long one thrown forward
  // would lie across the face of a raised tile in front — where no shadow
  // could land. Toward the camera they are shortened to stay about the
  // caster's own footing (and there the figure mostly covers them anyway).
  const forward = Math.max(0, best.dy / best.d);
  return {
    // Upright rotated clockwise by θ points along (sin θ, -cos θ).
    angle: Math.atan2(best.dx, -best.dy) * 180 / Math.PI,
    // Long: a torch stands barely above head height. A shadow thrown
    // sideways lies along the ground at foot level, right where the HP bar
    // sits, and a short one was hidden under it.
    squash: Math.min(1.15, 0.55 + best.d / 90) * (1 - 0.55 * forward),
    // Linear: squared, a figure one tile from the flame got 16% and the
    // shadow was lost in the cobbles.
    alpha: 0.7 * falloff
  };
};

/** Lay a black silhouette of `src`'s current look on the ground. */
export const castFrom = (
  shadow: Phaser.GameObjects.Image,
  src: { scaleX: number; scaleY: number; flipX: boolean },
  sun: Sun
): void => {
  shadow.setScale(Math.abs(src.scaleX), Math.abs(src.scaleY) * sun.squash);
  shadow.setFlipX(src.flipX);
  shadow.setAngle(sun.angle);
};
