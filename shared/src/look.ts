// What a character looks like, as plain data (GDD §11.1 creation fields, §16.1/§16.5 sprite style).
//
// The client's procedural rig (client/src/render/character/) draws any CharacterLookData; the save keeps
// the player's (save.ts `fellow.look`). Colours are 0xRRGGBB; the rig derives shade, light and outline
// tones from each. Persona cards describe a resident's look with CardLook (an index into these palettes or a
// "#rrggbb" string per colour); the client resolves it into the sprite's look and the dialogue bust's.
// Pure: no Phaser, no DOM.
import { z } from "zod";

/** §11.1: 3 sprite bodies × 2 heights. */
export const BUILDS = ["narrow", "medium", "broad"] as const;
export type Build = (typeof BUILDS)[number];
export const HEIGHTS = ["short", "tall"] as const;
export type Height = (typeof HEIGHTS)[number];

/** §11.1: 12 hair styles. The first six are the ones residents' placeholder looks pick from. */
export const HAIR_STYLES = [
  "short", "cropped", "bob", "long", "ponytail", "bun",
  "curly", "braids", "buzz", "pigtails", "swept", "tufty",
] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const BOTTOM_STYLES = ["trousers", "shorts", "skirt"] as const;
export type BottomStyle = (typeof BOTTOM_STYLES)[number];
export const ACCESSORIES = ["none", "scarf", "apron", "glasses"] as const;
export type Accessory = (typeof ACCESSORIES)[number];

/**
 * How the top is cut. `plain` is the residents' placeholder (a top over a bottom); the other six are §11.1's
 * starter outfits (client/src/fellow/options.ts names them and maps their 3 recolourable slots).
 */
export const OUTFIT_CUTS = ["plain", "jumper", "smock", "pinafore", "apron", "coat", "dungarees"] as const;
export type OutfitCut = (typeof OUTFIT_CUTS)[number];

/** Caps a resident can wear over their hair (the rig draws each in front, back and side views). */
export const HEADWEAR_KINDS = ["none", "flat_cap", "peaked_cap", "knit_cap"] as const;
export type HeadwearKind = (typeof HEADWEAR_KINDS)[number];

/**
 * Spectacles, as the dialogue bust draws them. The worn ones sit on the nose (the sprite shows them as its
 * `glasses` accessory); `on_head` is pushed up into the hair and the sprite leaves it out.
 */
export const GLASSES_STYLES = ["none", "round", "halfmoon", "heavy", "on_head"] as const;
export type GlassesStyle = (typeof GLASSES_STYLES)[number];
export const WORN_GLASSES: readonly GlassesStyle[] = ["round", "halfmoon", "heavy"];

// ── Palettes ────────────────────────────────────────────────────────────────
// GDD §11.1: 10 skin swatches, 12 hair colours, 8 eye colours; §16.5: 16 cloth colours. These are the ramps'
// base tones (the first six skins and seven hairs are the colours the old resident billboards used, so
// residents keep indexing them in this order; the Fellowship form shows skins sorted light to dark). Persona
// cards' looks and the form both index them, so the order is fixed: add at the end, never reorder.

export const SKIN_TONES = [0xf2d5b3, 0xe3b48c, 0xc68e64, 0x8d5a3b, 0xf6e1cb, 0xa86f48, 0xfbe3c8, 0xd9a274, 0x6e4430, 0xb8825a] as const;
export const HAIR_COLOURS = [0x3b2a20, 0x6b4a2b, 0xb7b2a8, 0x1f1a17, 0x9c4a26, 0xd9c28a, 0x50392b, 0x2c2a3a, 0xe2e0d8, 0x7a3b2a, 0xc98b4a, 0x5c5048] as const;
export const EYE_COLOURS = [0x3a2a22, 0x4a6b8a, 0x4f6b3a, 0x6b4a2b, 0x2e3a4a, 0x7a6a3a, 0x3b3b3b, 0x5a3a5a] as const;
/** Cloth for the starter outfits' recolourable slots and the residents' clothes: warm, bright and sea-glass, per §16.1's palette. */
export const CLOTH_COLOURS = [
  0x3f9e94, 0x6b4f3a, 0x4a3428, 0xc0504d, 0xd9a93a, 0x6a8fb5, 0x46536a, 0x5fa36a,
  0x8a6aa8, 0xe8dcc0, 0x4d5a3c, 0x7a4b3a, 0xd98a7a, 0x2f2a28, 0x9aa3a8, 0xb8865a
] as const;

const colour = z.number().int().min(0).max(0xffffff);

export const CharacterLookData = z.object({
  kind: z.literal("human"),
  skin: colour,
  hair: colour,
  hairStyle: z.enum(HAIR_STYLES),
  eyes: colour,
  /** Shirt, jumper or jacket (a bib cut's bib). */
  top: colour,
  bottom: colour,
  bottomStyle: z.enum(BOTTOM_STYLES),
  shoes: colour,
  accessory: z.enum(ACCESSORIES),
  /** Scarf / apron colour (glasses use a dark frame whatever this is). */
  accessoryColour: colour,
  /** Absent: medium. */
  build: z.enum(BUILDS).optional(),
  /** Absent: tall (the residents' height). */
  height: z.enum(HEIGHTS).optional(),
  /** Absent: plain. */
  outfit: z.enum(OUTFIT_CUTS).optional(),
  /** The layer under a bib (pinafore blouse, dungaree shirt): sleeves and shoulders. Absent: the top's colour. */
  trim: colour.optional(),
  /** A cap over the hair (residents' card looks; the player's look never sets one). Absent: none. */
  headwear: z.enum(HEADWEAR_KINDS).optional(),
  /** The cap's colour. Absent: slate. */
  headwearColour: colour.optional(),
}).strict();
export type CharacterLookData = z.infer<typeof CharacterLookData>;

// ── A persona card's look (content/residents/*.yaml `look:`) ────────────────

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A colour in a card's look: an index into `palette` (named `name` in messages), or a "#rrggbb" string. */
function swatch(name: string, palette: readonly number[]) {
  return z.union([z.number(), z.string()]).superRefine((v, ctx) => {
    if (typeof v === "string") {
      if (!HEX.test(v)) ctx.addIssue({ code: "custom", message: `"${v}" is not a colour: use a ${name} index or "#rrggbb" (quoted)` });
    } else if (!Number.isInteger(v) || v < 0 || v >= palette.length) {
      ctx.addIssue({ code: "custom", message: `${name} index ${v} is out of range (0–${palette.length - 1})` });
    }
  });
}
const skinSwatch = swatch("SKIN_TONES", SKIN_TONES);
const hairSwatch = swatch("HAIR_COLOURS", HAIR_COLOURS);
const eyeSwatch = swatch("EYE_COLOURS", EYE_COLOURS);
const clothSwatch = swatch("CLOTH_COLOURS", CLOTH_COLOURS);
export type Swatch = number | string;

/** A swatch's 0xRRGGBB: `palette[index]`, or the hex string. Out-of-range indices wrap (the schema rejects them first). */
export function swatchColour(value: Swatch, palette: readonly number[]): number {
  if (typeof value === "string") return parseInt(value.slice(1), 16);
  const n = palette.length;
  return palette[((Math.trunc(value) % n) + n) % n]!;
}

/**
 * A person's look on their card: everything the sprite and the dialogue bust draw. `glasses` is the bust's style;
 * a worn style (round, halfmoon, heavy) is the sprite's `glasses` accessory, so `accessory.kind` must say
 * glasses too (the content linter checks). `face` details are the bust's (the sprite is too small for them).
 */
export const CardHumanLook = z.object({
  kind: z.literal("human"),
  skin: skinSwatch,
  hair: z.object({ style: z.enum(HAIR_STYLES), colour: hairSwatch }).strict(),
  eyes: eyeSwatch,
  build: z.enum(BUILDS),
  height: z.enum(HEIGHTS),
  outfit: z.object({
    cut: z.enum(OUTFIT_CUTS),
    top: clothSwatch,
    bottom: clothSwatch,
    bottom_style: z.enum(BOTTOM_STYLES),
    shoes: clothSwatch,
    /** The layer under a pinafore's or dungarees' bib. */
    trim: clothSwatch.optional(),
  }).strict(),
  /** Absent colour: cream. Glasses ignore it (a dark frame). */
  accessory: z.object({ kind: z.enum(ACCESSORIES), colour: clothSwatch.optional() }).strict(),
  glasses: z.enum(GLASSES_STYLES).optional(),
  headwear: z.object({ kind: z.enum(HEADWEAR_KINDS), colour: clothSwatch.optional() }).strict().optional(),
  face: z.object({
    moustache: z.boolean().optional(),
    freckles: z.boolean().optional(),
    /** Dark hair going grey at the sides. */
    grey_temples: z.boolean().optional(),
    /** A tuft that won't lie flat (the bust's hair style). */
    cowlick: z.boolean().optional(),
    stubble: z.boolean().optional(),
  }).strict().optional(),
}).strict();
export type CardHumanLook = z.infer<typeof CardHumanLook>;

/** An animal's look (Bastien). Fur colours index HAIR_COLOURS; an absent collar takes the resident's roster colour. */
export const CardCatLook = z.object({
  kind: z.literal("cat"),
  fur: hairSwatch,
  /** Stripes or patches; the fur's colour for a plain coat. */
  markings: hairSwatch,
  /** Bib, socks and muzzle. */
  bib: hairSwatch,
  eyes: eyeSwatch,
  collar: clothSwatch.optional(),
}).strict();
export type CardCatLook = z.infer<typeof CardCatLook>;

export const CardLook = z.discriminatedUnion("kind", [CardHumanLook, CardCatLook]);
export type CardLook = z.infer<typeof CardLook>;

const inRange = (v: Swatch, palette: readonly number[]): boolean =>
  typeof v === "string" ? HEX.test(v) : Number.isInteger(v) && v >= 0 && v < palette.length;

/**
 * What's wrong with a card's look beyond its shape (the content linter's cross-checks): an animal needs a cat
 * look and a person a human one; every swatch in range; a worn glasses style if and only if the accessory is
 * glasses. Empty when all is well, or when the card has no look (the linter warns about that separately).
 */
export function cardLookProblems(card: { kind: string; look?: CardLook | undefined }): string[] {
  const look = card.look, out: string[] = [];
  if (!look) return out;
  const animal = card.kind === "animal";
  if (animal && look.kind !== "cat") out.push(`look.kind is ${look.kind}, but an animal card needs a cat look`);
  if (!animal && look.kind !== "human") out.push(`look.kind is ${look.kind}, but a ${card.kind} card needs a human look`);
  const check = (path: string, v: Swatch | undefined, palette: readonly number[], name: string) => {
    if (v !== undefined && !inRange(v, palette)) out.push(`look.${path}: ${JSON.stringify(v)} is not a ${name} index (0–${palette.length - 1}) or "#rrggbb"`);
  };
  if (look.kind === "cat") {
    check("fur", look.fur, HAIR_COLOURS, "HAIR_COLOURS");
    check("markings", look.markings, HAIR_COLOURS, "HAIR_COLOURS");
    check("bib", look.bib, HAIR_COLOURS, "HAIR_COLOURS");
    check("eyes", look.eyes, EYE_COLOURS, "EYE_COLOURS");
    check("collar", look.collar, CLOTH_COLOURS, "CLOTH_COLOURS");
    return out;
  }
  check("skin", look.skin, SKIN_TONES, "SKIN_TONES");
  check("hair.colour", look.hair.colour, HAIR_COLOURS, "HAIR_COLOURS");
  check("eyes", look.eyes, EYE_COLOURS, "EYE_COLOURS");
  for (const k of ["top", "bottom", "shoes", "trim"] as const) check(`outfit.${k}`, look.outfit[k], CLOTH_COLOURS, "CLOTH_COLOURS");
  check("accessory.colour", look.accessory.colour, CLOTH_COLOURS, "CLOTH_COLOURS");
  check("headwear.colour", look.headwear?.colour, CLOTH_COLOURS, "CLOTH_COLOURS");
  const worn = WORN_GLASSES.includes(look.glasses ?? "none");
  if (worn && look.accessory.kind !== "glasses")
    out.push(`look.glasses is ${look.glasses} (worn), so accessory.kind must be glasses (it is ${look.accessory.kind})`);
  if (!worn && look.accessory.kind === "glasses")
    out.push(`look.accessory.kind is glasses, so look.glasses needs a worn style (round, halfmoon or heavy)`);
  return out;
}
