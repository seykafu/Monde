// What a character looks like, as data (GDD §11.1 creation fields, §16.1/§16.5 sprite style).
//
// The procedural rig (rig.ts) draws any CharacterLook; W-07 character creation will build one from the
// Fellowship application, and residents get one from their id and roster colour until real sheets
// exist. Pure: no Phaser, no DOM.

export const HAIR_STYLES = ['short', 'cropped', 'bob', 'long', 'ponytail', 'bun'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
export const BOTTOM_STYLES = ['trousers', 'shorts', 'skirt'] as const;
export type BottomStyle = (typeof BOTTOM_STYLES)[number];
export const ACCESSORIES = ['none', 'scarf', 'apron', 'glasses'] as const;
export type Accessory = (typeof ACCESSORIES)[number];

export interface CharacterLook {
  kind: 'human';
  /** Colours are 0xRRGGBB; the rig derives shade, light and outline tones from each. */
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  eyes: number;
  /** Shirt, jumper or jacket. */
  top: number;
  bottom: number;
  bottomStyle: BottomStyle;
  shoes: number;
  accessory: Accessory;
  /** Scarf / apron colour (glasses use a dark frame whatever this is). */
  accessoryColour: number;
}

/** Bastien and any later animals: a small cat rig with the same sheet layout. */
export interface CatLook {
  kind: 'cat';
  fur: number;
  /** Stripes (a tabby) or patches; same as fur for a plain coat. */
  markings: number;
  /** Bib, socks and muzzle. */
  bib: number;
  eyes: number;
  collar: number;
}

export type Look = CharacterLook | CatLook;

// ── Palettes ────────────────────────────────────────────────────────────────
// GDD §11.1 asks for 10 skin swatches and 12 hair colours; these are the placeholder ramps' base tones
// (the first six skins and seven hairs are the colours the old resident billboards used).

export const SKIN_TONES = [0xf2d5b3, 0xe3b48c, 0xc68e64, 0x8d5a3b, 0xf6e1cb, 0xa86f48, 0xfbe3c8, 0xd9a274, 0x6e4430, 0xb8825a] as const;
export const HAIR_COLOURS = [0x3b2a20, 0x6b4a2b, 0xb7b2a8, 0x1f1a17, 0x9c4a26, 0xd9c28a, 0x50392b, 0x2c2a3a, 0xe2e0d8, 0x7a3b2a, 0xc98b4a, 0x5c5048] as const;
export const EYE_COLOURS = [0x3a2a22, 0x4a6b8a, 0x4f6b3a, 0x6b4a2b, 0x2e3a4a, 0x7a6a3a, 0x3b3b3b, 0x5a3a5a] as const;
const BOTTOMS = [0x5b4636, 0x46536a, 0x4d5a3c, 0x6b5a48, 0x4a4552, 0x7a4b3a, 0x48586a, 0x5e4b5e] as const;
const SHOES = [0x4a3428, 0x2f2a28, 0x5e3f2c, 0x3d3a44, 0x6a4a34] as const;
const ACCENTS = [0xe8dcc0, 0xc0504d, 0xd9a93a, 0x6a8fb5, 0x8a6aa8, 0x5fa36a] as const;

/** The player before W-07 character creation: short brown hair, a teal jumper, brown trousers and boots. */
export const DEFAULT_PLAYER_LOOK: CharacterLook = {
  kind: 'human', skin: 0xf2d5b3, hair: 0x6b4a2b, hairStyle: 'short', eyes: 0x3a2a22,
  top: 0x3f9e94, bottom: 0x6b4f3a, bottomStyle: 'trousers', shoes: 0x4a3428,
  accessory: 'none', accessoryColour: 0xe8dcc0
};

/** Bastien (content/residents/bastien.yaml): an orange tabby with a white bib. */
export const BASTIEN_LOOK: CatLook = { kind: 'cat', fur: 0xd98a3d, markings: 0xa8592a, bib: 0xf4ecdc, eyes: 0x9bbf4a, collar: 0xc0504d };

/** FNV-1a, the same hash sim/plans uses for per-resident variety (kept local so this module stays leaf). */
export function lookHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const pick = <T>(list: readonly T[], n: number): T => list[(((n >>> 0) % list.length) + list.length) % list.length]!;

/**
 * A resident's placeholder look: their roster colour on the top, everything else varied by id.
 * Skin and hair come from the same palettes and hash bits as the old billboards (read unsigned: the old
 * signed read gave about half the residents no hair colour at all).
 */
export function residentLook(id: string, colour: number): CharacterLook {
  const h = lookHash(id);
  const skin = pick(SKIN_TONES.slice(0, 6), h), hair = pick(HAIR_COLOURS.slice(0, 7), h >>> 4);
  const r = lookHash(`${id}:look`);
  const accessory: Accessory = r % 7 === 0 ? 'glasses' : r % 7 === 1 ? 'scarf' : r % 7 === 2 ? 'apron' : 'none';
  return {
    kind: 'human', skin, hair, hairStyle: pick(HAIR_STYLES, r >>> 3), eyes: pick(EYE_COLOURS, r >>> 6),
    top: colour, bottom: pick(BOTTOMS, r >>> 9), bottomStyle: (r >>> 12) % 4 === 0 ? 'skirt' : (r >>> 12) % 4 === 1 ? 'shorts' : 'trousers',
    shoes: pick(SHOES, r >>> 15), accessory, accessoryColour: pick(ACCENTS, r >>> 18)
  };
}

/** A stable key for a look, so two characters with the same look share one texture. */
export function lookKey(look: Look): string {
  return Object.entries(look).map(([k, v]) => `${k}=${typeof v === 'number' ? v.toString(16) : v}`).join(',');
}

// ── Colour helpers ──────────────────────────────────────────────────────────

const ch = (c: number, s: number): number => (c >> s) & 0xff;
const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const rgb = (r: number, g: number, b: number): number => (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
export const mix = (a: number, b: number, t: number): number =>
  rgb(ch(a, 16) + (ch(b, 16) - ch(a, 16)) * t, ch(a, 8) + (ch(b, 8) - ch(a, 8)) * t, ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t);
export const scale = (c: number, f: number): number => rgb(ch(c, 16) * f, ch(c, 8) * f, ch(c, 0) * f);

/** The warm near-black every outline leans toward (§16.1: soft dark outlines, never pure black). */
export const INK = 0x2a1c22;
const SHADE_TINT = 0x3b2f5e;   // shadows lean cool
const LIGHT_TINT = 0xfff1c9;   // highlights lean warm

/**
 * A material's tones: light, base, shade, its outline, and the line it draws where it overlaps another
 * part (`inner`). Clothes keep their outline there, so limbs and layers separate; `soft` materials
 * (skin, hair) use their shade instead, which reads as the shadow under a fringe or a chin. Inner lines
 * reuse tones the sprite already has, so a frame stays near GDD §16.1's 16–24 colours.
 */
export interface Ramp { light: number; base: number; shade: number; line: number; inner: number }
export function ramp(base: number, soft = false): Ramp {
  const shade = mix(scale(base, 0.74), SHADE_TINT, 0.16), line = mix(scale(base, 0.42), INK, 0.6);
  return { light: mix(base, LIGHT_TINT, 0.28), base, shade, line, inner: soft ? shade : line };
}
/** The same material on a far limb (side view): flat in its own shade, no new colours. */
export const farRamp = (r: Ramp): Ramp => ({ light: r.shade, base: r.shade, shade: r.shade, line: r.line, inner: r.line });
