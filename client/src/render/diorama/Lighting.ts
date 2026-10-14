import Phaser from "phaser";

// Dynamic torch lighting (Tier 1 HD-2D-lite). Warm, flickering light pools
// placed at every `torch` obstacle on the map. This is the safe, high-ROI
// slice of "dynamic lighting": additive radial glows + a flicker tween (the
// same cached-canvas + ADD-blend pattern as RavageVfx), NOT a full Light2D
// pipeline switch. It needs no normal-map art and can't render sprites
// black; it just brightens the scene around each flame. (Full normal-mapped
// Light2D remains a future, flag-gated step — see docs/RAVAGE_HD2D_PLAN.md.)
//
// The glow is created in BattleScene's tile loop, BEFORE the UI-pin
// snapshot, so it's a world object: routed to the world camera, ignored by
// the UI camera, and pooling UNDER unit sprites (so units stand "in" the
// light). On dark/fog battles it reads strongest, the warm pool punching
// through the fog-of-war darkness.

const TORCH_TEX = "torch_glow";

const ensureTorchGlowTexture = (scene: Phaser.Scene): string => {
  if (scene.textures.exists(TORCH_TEX)) return TORCH_TEX;
  const size = 84;
  const tex = scene.textures.createCanvas(TORCH_TEX, size, size);
  if (!tex) return TORCH_TEX;
  const ctx = tex.getContext();
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 2, c, c, c);
  g.addColorStop(0, "rgba(255,184,96,0.85)");
  g.addColorStop(0.4, "rgba(255,132,52,0.38)");
  g.addColorStop(1, "rgba(255,104,32,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
  return TORCH_TEX;
};

export interface TorchGlowOptions {
  depth?: number;
  /** Base scale the flicker breathes around. Unequal x/y lays the glow
   *  flat on foreshortened ground. */
  scaleX?: number;
  scaleY?: number;
}

// Place a flickering warm glow at (x, y). Each glow gets a randomized
// flicker phase/period so a row of torches shimmers independently rather
// than pulsing in lockstep.
//
// With no options this is the original flat-board behaviour (a round glow
// nudged 4px up from the tile centre). With options the position is taken
// exactly, and the flicker scales AROUND the given base scale — tweening
// `scale` directly would flatten a foreshortened pool back into a circle
// on the first frame.
export const addTorchGlow = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  opts?: TorchGlowOptions
): Phaser.GameObjects.Image => {
  const key = ensureTorchGlowTexture(scene);
  const sx = opts?.scaleX ?? 1;
  const sy = opts?.scaleY ?? 1;
  const glow = scene.add.image(x, opts ? y : y - 4, key)
    .setOrigin(0.5)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setScale(sx, sy);
  if (opts?.depth !== undefined) glow.setDepth(opts.depth);
  scene.tweens.add({
    targets: glow,
    alpha: { from: 0.6, to: 1.0 },
    scaleX: { from: sx * 0.9, to: sx * 1.1 },
    scaleY: { from: sy * 0.9, to: sy * 1.1 },
    yoyo: true,
    repeat: -1,
    duration: 360 + Math.floor(Math.random() * 280),
    delay: Math.floor(Math.random() * 320),
    ease: "Sine.easeInOut"
  });
  return glow;
};
