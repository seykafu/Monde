// What a character looks like, as plain data (GDD §11.1 creation fields, §16.1/§16.5 sprite style).
//
// The client's procedural rig (client/src/render/character/) draws any CharacterLookData; the save keeps
// the player's (save.ts `fellow.look`). Colours are 0xRRGGBB; the rig derives shade, light and outline
// tones from each. Pure: no Phaser, no DOM.
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
}).strict();
export type CharacterLookData = z.infer<typeof CharacterLookData>;
