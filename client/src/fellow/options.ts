// The Fellowship application's fields (GDD §11.1) as data: every option, its words on Pell's form, and how
// the likeness choices become a CharacterLook for the rig. Pure: no Phaser, no DOM (FellowshipScene draws it).
//
// Voice: Pell wrote this form at two in the morning. Plain words, a little wry, nothing modern.

import {
  BACKGROUNDS, BUILDS, HAIR_STYLES, HEIGHTS, LOVES, PRESET_PRONOUNS, WHY_MONDE, checkCustomPronouns, checkName,
  type Background, type Build, type HairStyle, type Height, type Love, type PlayerProfile, type WhyMonde
} from '@monde/shared';
import { CLOTH_COLOURS, EYE_COLOURS, HAIR_COLOURS, SKIN_TONES, luma, type CharacterLook } from '../render/character/look';

// ── Outfits: §11.1's six starter outfits × 3 recolourable slots ─────────────

export const STARTER_OUTFITS = ['jumper', 'smock', 'pinafore', 'apron', 'coat', 'dungarees'] as const;
export type StarterOutfit = (typeof STARTER_OUTFITS)[number];
export type Slots = readonly [number, number, number];

type Garments = Pick<CharacterLook, 'outfit' | 'top' | 'trim' | 'bottom' | 'bottomStyle' | 'shoes' | 'accessory' | 'accessoryColour'>;
export interface OutfitDef {
  id: StarterOutfit;
  name: string;
  /** The three recolourable slots, as the form labels them. */
  slots: readonly [string, string, string];
  /** Each slot's starting colour (CLOTH_COLOURS indices). */
  defaults: Slots;
  dress(c: readonly [number, number, number]): Garments;
}

/** Boots for outfits whose three slots are all cloth. */
const BOOTS = 0x4a3428, DARK_BOOTS = 0x2f2a28;
/** An accessory colour that isn't drawn (keeps look keys stable). */
const UNUSED = 0xe8dcc0;

export const OUTFITS: Readonly<Record<StarterOutfit, OutfitDef>> = {
  jumper: {
    id: 'jumper', name: 'Knitted jumper', slots: ['Jumper', 'Trousers', 'Boots'], defaults: [0, 1, 2],
    dress: ([a, b, c]) => ({ outfit: 'jumper', top: a, bottom: b, bottomStyle: 'trousers', shoes: c, accessory: 'none', accessoryColour: UNUSED })
  },
  smock: {
    id: 'smock', name: "Fisher's smock", slots: ['Smock', 'Trousers', 'Neckerchief'], defaults: [5, 6, 3],
    dress: ([a, b, c]) => ({ outfit: 'smock', top: a, bottom: b, bottomStyle: 'trousers', shoes: BOOTS, accessory: 'scarf', accessoryColour: c })
  },
  pinafore: {
    id: 'pinafore', name: 'Pinafore', slots: ['Pinafore', 'Blouse', 'Shoes'], defaults: [3, 9, 2],
    dress: ([a, b, c]) => ({ outfit: 'pinafore', top: a, trim: b, bottom: a, bottomStyle: 'skirt', shoes: c, accessory: 'none', accessoryColour: UNUSED })
  },
  apron: {
    id: 'apron', name: 'Workshop apron', slots: ['Shirt', 'Apron', 'Trousers'], defaults: [5, 15, 10],
    dress: ([a, b, c]) => ({ outfit: 'apron', top: a, bottom: c, bottomStyle: 'trousers', shoes: BOOTS, accessory: 'apron', accessoryColour: b })
  },
  coat: {
    id: 'coat', name: 'Harbour coat', slots: ['Coat', 'Scarf', 'Trousers'], defaults: [6, 4, 13],
    dress: ([a, b, c]) => ({ outfit: 'coat', top: a, bottom: c, bottomStyle: 'trousers', shoes: DARK_BOOTS, accessory: 'scarf', accessoryColour: b })
  },
  dungarees: {
    id: 'dungarees', name: 'Dungarees', slots: ['Dungarees', 'Shirt', 'Boots'], defaults: [6, 9, 1],
    dress: ([a, b, c]) => ({ outfit: 'dungarees', top: a, trim: b, bottom: a, bottomStyle: 'trousers', shoes: c, accessory: 'none', accessoryColour: UNUSED })
  }
};

// ── Likeness choices ────────────────────────────────────────────────────────

/** The likeness half of the form: ids and palette indices, so every value is one the form offers. */
export interface LookChoices {
  build: Build;
  height: Height;
  /** SKIN_TONES index. */
  skin: number;
  hairStyle: HairStyle;
  /** HAIR_COLOURS index. */
  hair: number;
  /** EYE_COLOURS index. */
  eyes: number;
  outfit: StarterOutfit;
  /** CLOTH_COLOURS indices for the outfit's three slots. */
  slots: Slots;
}

/** "Rub it out": the same look as render/character/look.ts DEFAULT_PLAYER_LOOK. */
export const DEFAULT_CHOICES: LookChoices = {
  build: 'medium', height: 'tall', skin: 0, hairStyle: 'short', hair: 1, eyes: 0, outfit: 'jumper', slots: OUTFITS.jumper.defaults
};

export function lookFromChoices(c: LookChoices): CharacterLook {
  const slots = c.slots.map(i => CLOTH_COLOURS[i]!) as unknown as [number, number, number];
  return {
    kind: 'human', build: c.build, height: c.height,
    skin: SKIN_TONES[c.skin]!, hair: HAIR_COLOURS[c.hair]!, hairStyle: c.hairStyle, eyes: EYE_COLOURS[c.eyes]!,
    ...OUTFITS[c.outfit].dress(slots)
  };
}

const indexOf = (list: readonly number[], colour: number | undefined): number => Math.max(0, colour === undefined ? 0 : list.indexOf(colour));

/** The choices that draw `look` (best effort: a colour the form doesn't offer becomes the first swatch). */
export function choicesFromLook(look: CharacterLook): LookChoices {
  const outfit = (STARTER_OUTFITS as readonly string[]).includes(look.outfit ?? '') ? look.outfit as StarterOutfit : 'jumper';
  // Read each slot back from whichever garment the outfit put it on.
  const probe = OUTFITS[outfit].dress([-1, -2, -3]);
  const slotColour = (k: number): number | undefined => {
    for (const key of ['top', 'trim', 'bottom', 'shoes', 'accessoryColour'] as const) if (probe[key] === -1 - k) return look[key];
    return undefined;
  };
  return {
    build: look.build ?? 'medium', height: look.height ?? 'tall',
    skin: indexOf(SKIN_TONES, look.skin), hairStyle: look.hairStyle, hair: indexOf(HAIR_COLOURS, look.hair), eyes: indexOf(EYE_COLOURS, look.eyes),
    outfit, slots: [0, 1, 2].map(k => indexOf(CLOTH_COLOURS, slotColour(k))) as unknown as Slots
  };
}

/** "Leave it to chance": any likeness the form allows (`rand` returns [0, 1)). */
export function randomChoices(rand: () => number = Math.random): LookChoices {
  const any = <T>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]!;
  const index = (n: number): number => Math.min(n - 1, Math.floor(rand() * n));
  // Three different cloth colours, so the slots read as separate pieces.
  const cloth: number[] = [];
  for (let k = 0; k < 3; k++) {
    let i = index(CLOTH_COLOURS.length);
    while (cloth.includes(i)) i = (i + 1) % CLOTH_COLOURS.length;
    cloth.push(i);
  }
  return {
    build: any(BUILDS), height: any(HEIGHTS), skin: index(SKIN_TONES.length), hairStyle: any(HAIR_STYLES),
    hair: index(HAIR_COLOURS.length), eyes: index(EYE_COLOURS.length), outfit: any(STARTER_OUTFITS),
    slots: cloth as unknown as Slots
  };
}

// ── Words on the form ───────────────────────────────────────────────────────

export const FORM_TEXT = {
  office: 'Town of Monde · Office of the Mayor',
  title: 'Application for the Revitalization Fellowship',
  smallPrint: 'Please print clearly. The council will read this. (They won\'t.)',
  pages: ['I. Particulars', 'II. Likeness'] as const,
  likenessNote: 'For the noticeboard, so folk know you on sight.',
  signed: 'Signed',
  sign: 'Sign',
  randomise: 'Leave it to chance',
  reset: 'Rub it out',
  turn: 'Turn about',
  keys: '↑ ↓ choose a line · ← → change it · type your name in its box · Enter presses a button · the mouse works too',
  back: 'Esc goes back'
} as const;

export interface FieldText { label: string; hint: string }
export const FIELD_TEXT = {
  name: { label: 'Name', hint: "What we'll shout across the harbour." },
  pronouns: { label: 'Pronouns', hint: 'So nobody gets it wrong twice.' },
  custom: { label: 'In your words', hint: 'Fill in the gaps.' },
  background: { label: 'Background', hint: 'What you bring besides the bag.' },
  why: { label: 'Why Monde?', hint: 'Tick one. Only Pell reads these.' },
  loves: { label: 'Something you love', hint: 'Folk who love it too will warm to you sooner.' },
  build: { label: 'Build', hint: '' },
  height: { label: 'Height', hint: '' },
  skin: { label: 'Complexion', hint: '' },
  hairStyle: { label: 'Hair', hint: '' },
  hair: { label: 'Hair colour', hint: '' },
  eyes: { label: 'Eyes', hint: '' },
  outfit: { label: 'Clothes', hint: '' }
} as const satisfies Record<string, FieldText>;

/** The custom pronoun boxes, as the gaps in three little sentences (subject, object, possessive). */
export const CUSTOM_PRONOUN_GAPS = [['', 'came by'], ['ask', ''], ['', 'bag']] as const;
export const CUSTOM_PRONOUN_EXAMPLE = ['xe', 'xem', 'xyr'] as const;

export const PRONOUN_OPTIONS = [...PRESET_PRONOUNS, 'custom'] as const;
export type PronounOption = (typeof PRONOUN_OPTIONS)[number];
export const PRONOUN_TEXT: Record<PronounOption, string> = { 'she/her': 'she/her', 'he/him': 'he/him', 'they/them': 'they/them', custom: 'Other…' };

export interface BackgroundText { name: string; who: string; start: string; perk: string }
/** §11.1's Background table, each start and perk in a sentence. */
export const BACKGROUND_TEXT: Readonly<Record<Background, BackgroundText>> = {
  homecomer: {
    name: 'Homecomer', who: 'Lived in Monde till you were twelve.',
    start: 'Pell, Bertrand, Odile, Hollis, Roz and Delphine remember you: they start at Regard 20.',
    perk: 'The elders lean your way a touch come the vote.'
  },
  tinkerer: {
    name: 'Tinkerer', who: 'Fixes things, mostly so as not to talk about things.',
    start: 'You start with Handiwork 2.',
    perk: 'Your own hours count half again on projects, and your first puzzle hint is free.'
  },
  scrapper: {
    name: 'Scrapper', who: "Has been in fights, and didn't care for them.",
    start: 'You start with Grit 2, and 5 more Grit to stand on.',
    perk: 'Talking someone down works a little more often; the Tollmen start out warier of you.'
  },
  organizer: {
    name: 'Organizer', who: 'Has run things before. It went badly once.',
    start: 'You start with Heart 2.',
    perk: 'Community work does a quarter more for the town, and volunteers say yes sooner.'
  }
};

export const WHY_TEXT: Readonly<Record<WhyMonde, string>> = {
  fresh_start: 'A fresh start', to_help: 'To help', running: 'Running from something', curious: 'Curious'
};
export const LOVE_TEXT: Readonly<Record<Love, string>> = Object.fromEntries(LOVES.map(l => [l, l[0]!.toUpperCase() + l.slice(1)])) as Record<Love, string>;
export const BUILD_TEXT: Readonly<Record<Build, string>> = { narrow: 'Narrow', medium: 'Middling', broad: 'Broad' };
export const HEIGHT_TEXT: Readonly<Record<Height, string>> = { short: 'Shorter', tall: 'Taller' };
export const HAIR_STYLE_TEXT: Readonly<Record<HairStyle, string>> = {
  short: 'Short and tidy', cropped: 'Cropped', bob: 'Bob', long: 'Long and loose', ponytail: 'Ponytail', bun: 'Bun',
  curly: 'Curls', braids: 'Plaits', buzz: 'Clipped close', pigtails: 'Bunches', swept: 'Swept aside', tufty: 'Tufty'
};
export const HAIR_COLOUR_TEXT = ['Peat', 'Chestnut', 'Pewter', 'Ink', 'Rust', 'Straw', 'Walnut', 'Night', 'Sea-salt', 'Copper', 'Honey', 'Ash'] as const;
export const EYE_TEXT = ['Peat brown', 'Sea blue', 'Moss green', 'Hazel', 'Slate', 'Amber', 'Flint grey', 'Sloe'] as const;
export const CLOTH_TEXT = ['Sea-glass', 'Bark', 'Peat', 'Brick', 'Mustard', 'Harbour blue', 'Navy', 'Kelp', 'Heather', 'Cream', 'Olive', 'Russet', 'Rosehip', 'Coal', 'Pebble', 'Toffee'] as const;
/** Skin swatches in the order the form shows them: lightest to darkest. */
export const SKIN_ORDER: readonly number[] = SKIN_TONES.map((c, i) => [luma(c), i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);

// ── The whole form ──────────────────────────────────────────────────────────

export interface FormState {
  name: string;
  pronouns: PronounOption;
  /** Subject, object, possessive (when `pronouns` is custom). */
  custom: [string, string, string];
  background: Background;
  why: WhyMonde;
  loves: Love;
  look: LookChoices;
}

/** A fresh form: no name yet, the defaults ticked. */
export function blankForm(): FormState {
  return { name: '', pronouns: 'they/them', custom: ['', '', ''], background: BACKGROUNDS[0], why: WHY_MONDE[0], loves: LOVES[0], look: { ...DEFAULT_CHOICES } };
}

/** The form filled in from a profile and look (opening it a second time, e.g. the story's {charcreate}). */
export function formFrom(profile: PlayerProfile | null, look: CharacterLook | null): FormState {
  const form = blankForm();
  if (look) form.look = choicesFromLook(look);
  if (!profile) return form;
  const preset = (PRESET_PRONOUNS as readonly string[]).includes(profile.pronouns);
  return {
    ...form, name: profile.name, background: profile.background, why: profile.why, loves: profile.loves,
    pronouns: preset ? profile.pronouns as PronounOption : 'custom',
    custom: preset ? ['', '', ''] : profile.pronouns.split('/').slice(0, 3).concat(['', '', '']).slice(0, 3) as [string, string, string]
  };
}

export type FormProblem = { field: 'name' | 'custom'; problem: string };
export type FormResult = { ok: true; profile: PlayerProfile; look: CharacterLook } | { ok: false; problems: FormProblem[] };

/** Check the whole form; problems are worded for the form, in the order the fields appear. */
export function readForm(form: FormState): FormResult {
  const problems: FormProblem[] = [];
  const name = checkName(form.name);
  if (!name.ok) problems.push({ field: 'name', problem: name.problem });
  let pronouns: string = form.pronouns;
  if (form.pronouns === 'custom') {
    const words = form.custom.map(w => w.trim().toLowerCase());
    const problem = checkCustomPronouns(words);
    if (problem) problems.push({ field: 'custom', problem });
    pronouns = words.join('/');
  }
  if (problems.length || !name.ok) return { ok: false, problems };
  return { ok: true, profile: { name: name.name, pronouns, background: form.background, why: form.why, loves: form.loves }, look: lookFromChoices(form.look) };
}
