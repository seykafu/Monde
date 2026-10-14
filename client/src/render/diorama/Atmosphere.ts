import Phaser from "phaser";
import { GAME_HEIGHT, GAME_WIDTH } from "../../util/constants";

// Ambient battlefield atmosphere — a subtle, biome-driven particle layer
// (drifting snow, rising embers, blowing dust, floating motes). Part of the
// "HD-2D-lite" Tier 1 pass: pure visual flavour that reads as production
// value without touching combat, input, or layout.
//
// The emitter is a plain world-space GameObject. BattleScene creates it
// BEFORE its UI-pin snapshot, so the two-camera split auto-routes it to the
// world camera (it inherits the cinematic bloom/grade) and the UI camera
// ignores it. Phaser destroys it on scene shutdown — no manual teardown.

export type AtmosphereKind = "snow" | "embers" | "dust" | "motes" | "none";

const DOT_TEX = "atmo_dot";

// One soft radial-gradient dot, tinted per emitter. Mirrors the cached
// canvas-texture pattern in RavageVfx.ts.
export const ensureDotTexture = (scene: Phaser.Scene): string => {
  if (scene.textures.exists(DOT_TEX)) return DOT_TEX;
  const size = 16;
  const tex = scene.textures.createCanvas(DOT_TEX, size, size);
  if (!tex) return DOT_TEX;
  const ctx = tex.getContext();
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
  return DOT_TEX;
};

// Build the per-kind emitter config. Values are deliberately subtle —
// atmosphere should sit under the action, not compete with it.
const configFor = (
  kind: Exclude<AtmosphereKind, "none">
): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig => {
  const W = GAME_WIDTH;
  const H = GAME_HEIGHT;
  switch (kind) {
    case "snow":
      return {
        x: { min: -20, max: W + 20 }, y: -10,
        lifespan: 13000,
        speedY: { min: 30, max: 70 }, speedX: { min: -18, max: 18 },
        scale: { min: 0.22, max: 0.5 },
        alpha: { start: 0.75, end: 0.55 },
        tint: 0xeef3fa,
        frequency: 170, quantity: 1
      };
    case "embers":
      return {
        x: { min: 0, max: W }, y: H + 10,
        lifespan: 6000,
        speedY: { min: -65, max: -28 }, speedX: { min: -14, max: 14 },
        scale: { start: 0.45, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: [0xff8a3a, 0xffb866, 0xff6a2a],
        blendMode: Phaser.BlendModes.ADD,
        frequency: 110, quantity: 1
      };
    case "dust":
      return {
        x: -20, y: { min: H * 0.2, max: H },
        lifespan: 11000,
        speedX: { min: 18, max: 55 }, speedY: { min: -6, max: 8 },
        scale: { min: 0.18, max: 0.4 },
        alpha: { start: 0.28, end: 0 },
        tint: 0xd8c79a,
        frequency: 200, quantity: 1
      };
    case "motes":
      return {
        x: { min: 0, max: W }, y: { min: 0, max: H },
        lifespan: 8000,
        speedX: { min: -10, max: 10 }, speedY: { min: -10, max: 6 },
        scale: { min: 0.18, max: 0.36 },
        alpha: { start: 0.3, end: 0 },
        tint: 0xc7d3c4,
        blendMode: Phaser.BlendModes.ADD,
        frequency: 240, quantity: 1
      };
  }
};

// Create the atmosphere emitter at the given render depth (above units, below
// the HUD / fog overlays). Returns null for "none" so callers can no-op.
export const createAtmosphere = (
  scene: Phaser.Scene,
  kind: AtmosphereKind,
  depth: number
): Phaser.GameObjects.Particles.ParticleEmitter | null => {
  if (kind === "none") return null;
  const tex = ensureDotTexture(scene);
  const emitter = scene.add.particles(0, 0, tex, configFor(kind));
  emitter.setDepth(depth);
  return emitter;
};
