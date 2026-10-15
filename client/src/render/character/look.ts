// What a character looks like, as data (GDD §11.1 creation fields, §16.1/§16.5 sprite style).
//
// The procedural rig (rig.ts) draws any CharacterLook. The shape of the data (and its zod schema, for saves),
// the palettes and the persona cards' `look` block live in @monde/shared look.ts; this module adds the
// defaults, the resolver from a card's look (lookFromCard) and the hash looks for residents without one.
// W-07 character creation (fellow/options.ts) builds the player's from the Fellowship application.
// Pure: no Phaser, no DOM.

import type { Accessory, BottomStyle, Build, CardLook, CharacterLookData, HairStyle, HeadwearKind, Height, OutfitCut } from '@monde/shared';
import { CLOTH_COLOURS, EYE_COLOURS, HAIR_COLOURS, HAIR_STYLES, SKIN_TONES, WORN_GLASSES, swatchColour } from '@monde/shared';

export {
  ACCESSORIES, BOTTOM_STYLES, BUILDS, CLOTH_COLOURS, EYE_COLOURS, HAIR_COLOURS, HAIR_STYLES, HEADWEAR_KINDS, HEIGHTS,
  OUTFIT_CUTS, SKIN_TONES
} from '@monde/shared';
export type { Accessory, BottomStyle, Build, HairStyle, HeadwearKind, Height, OutfitCut } from '@monde/shared';

export interface CharacterLook {
  kind: 'human';
  /** Colours are 0xRRGGBB; the rig derives shade, light and outline tones from each. */
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  eyes: number;
  /** Shirt, jumper or jacket (a bib cut's bib). */
  top: number;
  bottom: number;
  bottomStyle: BottomStyle;
  shoes: number;
  accessory: Accessory;
  /** Scarf / apron colour (glasses use a dark frame whatever this is). */
  accessoryColour: number;
  /** §11.1's three builds. Absent: medium. */
  build?: Build;
  /** §11.1's two heights. Absent: tall (the residents' height). */
  height?: Height;
  /** How the top is cut (§11.1's six starter outfits, or the residents' plain top). Absent: plain. */
  outfit?: OutfitCut;
  /** The layer under a bib (a pinafore's blouse, dungarees' shirt): sleeves and shoulders. Absent: the top. */
  trim?: number;
  /** A cap over the hair (residents' card looks only). Absent: none. */
  headwear?: HeadwearKind;
  /** The cap's colour. Absent: DEFAULT_CAP. */
  headwearColour?: number;
}

// The client's look and the save's schema must describe the same thing.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const lookMatchesSchema: Same<CharacterLook, CharacterLookData> = true;
void lookMatchesSchema;

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
// SKIN_TONES, HAIR_COLOURS, EYE_COLOURS and CLOTH_COLOURS (GDD §11.1, §16.5) live in @monde/shared look.ts
// (persona cards index them too) and are re-exported above. The hash looks also pick from these:
const BOTTOMS = [0x5b4636, 0x46536a, 0x4d5a3c, 0x6b5a48, 0x4a4552, 0x7a4b3a, 0x48586a, 0x5e4b5e] as const;
const SHOES = [0x4a3428, 0x2f2a28, 0x5e3f2c, 0x3d3a44, 0x6a4a34] as const;
const ACCENTS = [0xe8dcc0, 0xc0504d, 0xd9a93a, 0x6a8fb5, 0x8a6aa8, 0x5fa36a] as const;

/**
 * The player before the Fellowship application is signed (and after "Rub it out"): short brown hair, a teal
 * knitted jumper, brown trousers and boots. fellow/options.ts DEFAULT_CHOICES describes the same look.
 */
export const DEFAULT_PLAYER_LOOK: CharacterLook = {
  kind: 'human', skin: 0xf2d5b3, hair: 0x6b4a2b, hairStyle: 'short', eyes: 0x3a2a22,
  top: 0x3f9e94, bottom: 0x6b4f3a, bottomStyle: 'trousers', shoes: 0x4a3428,
  accessory: 'none', accessoryColour: 0xe8dcc0,
  build: 'medium', height: 'tall', outfit: 'jumper'
};

/** Bastien (content/residents/bastien.yaml): an orange tabby with a white bib. */
export const BASTIEN_LOOK: CatLook = { kind: 'cat', fur: 0xd98a3d, markings: 0xa8592a, bib: 0xf4ecdc, eyes: 0x9bbf4a, collar: 0xc0504d };

/** A cap whose card gives no colour: slate. */
export const DEFAULT_CAP = 0x46536a;
/** An apron or scarf whose card gives no colour: cream. */
const DEFAULT_ACCENT = 0xe8dcc0;

/**
 * A card's look (content/residents/*.yaml `look:`) as the rig draws it. Palette indices and "#rrggbb" strings
 * become colours; a worn glasses style is the glasses accessory; a cat's absent collar takes `colour` (the
 * resident's roster colour). The face details are the dialogue bust's (portraitModel.ts reads them).
 */
export function lookFromCard(look: CardLook, colour: number): Look {
  if (look.kind === 'cat') {
    return {
      kind: 'cat', fur: swatchColour(look.fur, HAIR_COLOURS), markings: swatchColour(look.markings, HAIR_COLOURS),
      bib: swatchColour(look.bib, HAIR_COLOURS), eyes: swatchColour(look.eyes, EYE_COLOURS),
      collar: look.collar === undefined ? colour : swatchColour(look.collar, CLOTH_COLOURS)
    };
  }
  const cloth = (v: number | string) => swatchColour(v, CLOTH_COLOURS);
  const worn = WORN_GLASSES.includes(look.glasses ?? 'none');
  const out: CharacterLook = {
    kind: 'human', skin: swatchColour(look.skin, SKIN_TONES), hair: swatchColour(look.hair.colour, HAIR_COLOURS),
    hairStyle: look.hair.style, eyes: swatchColour(look.eyes, EYE_COLOURS),
    top: cloth(look.outfit.top), bottom: cloth(look.outfit.bottom), bottomStyle: look.outfit.bottom_style, shoes: cloth(look.outfit.shoes),
    accessory: worn ? 'glasses' : look.accessory.kind,
    accessoryColour: look.accessory.colour === undefined ? DEFAULT_ACCENT : cloth(look.accessory.colour),
    build: look.build, height: look.height, outfit: look.outfit.cut
  };
  if (look.outfit.trim !== undefined) out.trim = cloth(look.outfit.trim);
  if (look.headwear && look.headwear.kind !== 'none') {
    out.headwear = look.headwear.kind;
    out.headwearColour = look.headwear.colour === undefined ? DEFAULT_CAP : cloth(look.headwear.colour);
  }
  return out;
}

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
 * signed read gave about half the residents no hair colour at all). Hair styles come from the first six, so
 * residents look the same as before §11.1's extra styles and builds existed.
 */
export function residentLook(id: string, colour: number): CharacterLook {
  const h = lookHash(id);
  const skin = pick(SKIN_TONES.slice(0, 6), h), hair = pick(HAIR_COLOURS.slice(0, 7), h >>> 4);
  const r = lookHash(`${id}:look`);
  const accessory: Accessory = r % 7 === 0 ? 'glasses' : r % 7 === 1 ? 'scarf' : r % 7 === 2 ? 'apron' : 'none';
  return {
    kind: 'human', skin, hair, hairStyle: pick(HAIR_STYLES.slice(0, 6), r >>> 3), eyes: pick(EYE_COLOURS, r >>> 6),
    top: colour, bottom: pick(BOTTOMS, r >>> 9), bottomStyle: (r >>> 12) % 4 === 0 ? 'skirt' : (r >>> 12) % 4 === 1 ? 'shorts' : 'trousers',
    shoes: pick(SHOES, r >>> 15), accessory, accessoryColour: pick(ACCENTS, r >>> 18)
  };
}

/** A stable key for a look, so two characters with the same look share one texture (key order and absent fields don't matter). */
export function lookKey(look: Look): string {
  return Object.entries(look).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toString(16) : v}`).join(',');
}

// ── Colour helpers ──────────────────────────────────────────────────────────

const ch = (c: number, s: number): number => (c >> s) & 0xff;
const clampByte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const rgb = (r: number, g: number, b: number): number => (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
export const mix = (a: number, b: number, t: number): number =>
  rgb(ch(a, 16) + (ch(b, 16) - ch(a, 16)) * t, ch(a, 8) + (ch(b, 8) - ch(a, 8)) * t, ch(a, 0) + (ch(b, 0) - ch(a, 0)) * t);
export const scale = (c: number, f: number): number => rgb(ch(c, 16) * f, ch(c, 8) * f, ch(c, 0) * f);
/** Perceived lightness 0..255 (Rec. 601 weights), for sorting swatches. */
export const luma = (c: number): number => 0.299 * ch(c, 16) + 0.587 * ch(c, 8) + 0.114 * ch(c, 0);

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
