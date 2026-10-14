export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;
export const TILE_SIZE = 48;

// Native-resolution rendering (Tier 0, step 2).
//
// The game's logical/design coordinate space stays 1280x720 everywhere
// (all layout, all `GAME_WIDTH`/`GAME_HEIGHT` math is unchanged). This
// factor only enlarges the actual canvas backing buffer: the Phaser game
// is created at GAME_* x RENDER_SCALE, and every camera is set to render
// the 1280x720 design onto that bigger buffer (zoom = RENDER_SCALE, with
// a top-left pivot so pinned UI and scrolling world objects both map
// cleanly). The net effect: the game renders at ~native resolution
// instead of upscaling a 720p frame, so text is crisp on every monitor
// and the SSAA art shows its detail.
//
//   1 -> OFF (720p buffer, upscaled to the window — the old blurry path).
//   2 -> render at 2x (2560x1440 buffer; the window scale becomes a crisp
//        DOWNSCALE on typical displays instead of a blurry upscale).
//
// ON since the text-clarity pivot: the 720p-buffer upscale was the root
// cause of soft/blurry text on every monitor larger than 1280x720, and no
// amount of glyph-density patching (crispText) could fix the final canvas
// stretch. All pointer-picking paths route through camera.getWorldPoint /
// RENDER_SCALE-aware math, so input stays correct under the zoom. To
// fall back, set 1 — everything degrades gracefully to the old path.
// Typed `number` (not the literal) so flag checks like `rs === 1` in
// renderScale.ts stay valid comparisons whichever value is set here.
//
// Runtime escape hatch: `?rs=1` on the URL forces the old 720p path for a
// session (and `?rs=2` forces native-res) without a rebuild — so a playtest
// that hits any native-res regression can fall back instantly. The window
// guard keeps this file importable under Node (vitest imports it through
// the content graph).
const rsOverride = typeof window !== "undefined"
  ? Number(new URLSearchParams(window.location.search).get("rs"))
  : 0;

// Native-res requires the WebGL renderer. On machines where WebGL is
// refused (driver blocklists, remote desktops — the same machines
// main.ts's type:AUTO rescues with the Canvas renderer), the camera
// zoom patch renders a zoomed, cropped frame: the title screen showed
// the top-left half of itself at 2x. Probe once here and let those
// machines take the documented rs=1 degradation path automatically.
const webglAvailable = (() => {
  if (typeof window === "undefined") return true; // Node / vitest import
  try {
    const probe = document.createElement("canvas");
    return !!(probe.getContext("webgl2") || probe.getContext("webgl"));
  } catch {
    return false;
  }
})();

export const RENDER_SCALE: number =
  rsOverride === 1 || rsOverride === 2 ? rsOverride
  : webglAvailable ? 2 : 1;


// HD procedural-art supersampling factor. Every procedurally generated
// texture (units, portraits, tiles, backdrops) is drawn into a buffer
// ART_SCALE× larger than its logical size, then downsampled back to the
// logical dimensions with smoothing (SSAA). The texture keeps its
// original logical size — so layout, placement, and display code are
// unchanged — but carries anti-aliased, higher-fidelity detail
// (smoother gradients, rounder curves, cleaner edges). One knob:
//   1 → original crisp-pixel behaviour (no supersampling)
//   2 → 2× SSAA (default; the "HD-2× procedural art track")
//   3/4 → diminishing returns, more memory + generation cost.
export const ART_SCALE = 2;

// Per-generator overrides. The larger art (portraits, tiles, backdrops)
// has the headroom to benefit from SSAA without looking muddy, so it runs
// at the full ART_SCALE. Unit sprites are tiny (32×40) hand-placed pixel
// art where downsampling softens the deliberate hard edges, so they stay
// crisp (scale 1) by default — bump UNIT_ART_SCALE to ART_SCALE after a
// visual pass if you'd rather have the anti-aliased look on them too.
export const UNIT_ART_SCALE = 1;
export const PORTRAIT_ART_SCALE = ART_SCALE;
export const TILE_ART_SCALE = ART_SCALE;
export const BACKDROP_ART_SCALE = ART_SCALE;



export const COLORS = {
  bgDeep: 0x202820,
  bgPanel: 0x303b32,
  panelEdge: 0x2a2a3a,
  gold: 0xc9b07a,
  goldBright: 0xf2d997,
  blood: 0xb84141,
  steel: 0x6c7281,
  parchment: 0xe8d8a6,
  player: 0x6db2ff,
  enemy: 0xd05a4a,
  ally: 0x6ed09a,
  ready: 0xffd45a,
  defensive: 0x8ad6ff,
  threat: 0xff6e5a,
  moveTile: 0x4d8aff,
  attackTile: 0xff5a4d,
  hover: 0xfff7c4
} as const;

export const FONT_TITLE = '700 56px "Times New Roman", serif';
export const FONT_HEADER = '600 22px serif';
export const FONT_BODY = '400 16px "Georgia", "Times New Roman", serif';
export const FONT_UI = '600 14px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
export const FONT_MONO = '12px "Consolas", "Menlo", monospace';

// Neutral system-font placeholders until Monde art direction lands.
export const FAMILY_DISPLAY = '"Times New Roman", serif';
export const FAMILY_HEADING = '"Times New Roman", serif';
export const FAMILY_BODY    = '"Georgia", "Times New Roman", serif';
export const FAMILY_UI      = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
export const FAMILY_MONO    = '"Consolas", "Menlo", monospace';

// Typography scale — single source of truth for Phaser TextStyle objects.
// All scenes should pull from this rather than hand-rolling fontFamily/fontSize.
import type Phaser from "phaser";
type TS = Phaser.Types.GameObjects.Text.TextStyle;

const SHADOW_DEEP = { offsetX: 0, offsetY: 3, color: "#000", blur: 10, fill: true, stroke: true };
const SHADOW_SOFT = { offsetX: 0, offsetY: 2, color: "#000", blur: 6,  fill: true, stroke: false };

export const TYPO = {
  display: {
    fontFamily: FAMILY_DISPLAY,
    fontSize: "120px",
    color: "#f4d999",
    stroke: "#1a0e04",
    strokeThickness: 8,
    shadow: { offsetX: 0, offsetY: 4, color: "#000", blur: 18, fill: true, stroke: true }
  } as TS,
  title: {
    fontFamily: FAMILY_DISPLAY,
    fontSize: "32px",
    color: "#f4d999",
    stroke: "#1a0e04",
    strokeThickness: 5,
    shadow: SHADOW_DEEP
  } as TS,
  h1: {
    fontFamily: FAMILY_HEADING,
    fontSize: "26px",
    color: "#f4d999",
    stroke: "#1a0e04",
    strokeThickness: 4,
    shadow: SHADOW_SOFT
  } as TS,
  h2: {
    fontFamily: FAMILY_HEADING,
    fontSize: "20px",
    color: "#e8c97c",
    stroke: "#1a0e04",
    strokeThickness: 3,
    shadow: SHADOW_SOFT
  } as TS,
  speaker: {
    fontFamily: FAMILY_HEADING,
    fontSize: "22px",
    color: "#f4d999",
    stroke: "#000",
    strokeThickness: 3,
    shadow: SHADOW_SOFT
  } as TS,
  body: {
    fontFamily: FAMILY_BODY,
    fontSize: "20px",
    color: "#f3ecd9",
    stroke: "#000",
    strokeThickness: 2,
    shadow: SHADOW_SOFT
  } as TS,
  bodyItalic: {
    fontFamily: FAMILY_BODY,
    fontSize: "20px",
    color: "#dccfa8",
    fontStyle: "italic",
    stroke: "#000",
    strokeThickness: 2,
    shadow: SHADOW_SOFT
  } as TS,
  caption: {
    fontFamily: FAMILY_BODY,
    fontSize: "16px",
    color: "#c9b07a",
    stroke: "#000",
    strokeThickness: 2
  } as TS,
  ui: {
    fontFamily: FAMILY_UI,
    fontSize: "14px",
    color: "#dde6ef",
    stroke: "#000",
    strokeThickness: 2
  } as TS,
  uiBold: {
    fontFamily: FAMILY_UI,
    fontSize: "14px",
    fontStyle: "600",
    color: "#f4e4b0",
    stroke: "#000",
    strokeThickness: 2
  } as TS,
  micro: {
    fontFamily: FAMILY_UI,
    fontSize: "11px",
    color: "#a0a8b8",
    stroke: "#000",
    strokeThickness: 2
  } as TS,
  mono: {
    fontFamily: FAMILY_MONO,
    fontSize: "12px",
    color: "#aab2c0"
  } as TS
} as const;

export const GAME_STATE_KEY = "monde:save:v1";
