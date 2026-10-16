// The portrait library (GDD §16.2 "Resident library", Appendix A.3.5 portrait-first selection). Pure.
//
// Generated residents don't get portraits drawn at runtime: each is given one of a fixed set of library busts
// (content/portraits/library.json, drawn by scripts/art/gen_portraits.py --library, six expressions each). Every
// entry is tagged with the look the paper-doll rig draws for the same person, so the arrival's walking sprite and
// their dialogue bust agree: the card's `look` is the library entry's.
//
// GDD-GAP: A.3.5 sizes the library at 526+ busts and never reuses one while its owner lives in Monde. The MVP library
// is 16 busts, so a bust can be shared; the picker strongly prefers unused ones (and never repeats one inside a
// household while another fits).
import { z } from "zod";
import data from "../../../content/portraits/library.json";
import { CardHumanLook, HAIR_COLOURS, SKIN_TONES, swatchColour } from "../look";
import type { Presentation } from "./archetypes";
import type { SeededRng } from "./rng";

export const AGE_BANDS = ["child", "teen", "young_adult", "adult", "elder"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
/** A.3.7 V04: child 0–12, teen 13–17, young adult 18–35, adult 36–59, elder 60+. */
export const BAND_AGES: Readonly<Record<AgeBand, readonly [number, number]>> = {
  child: [0, 12], teen: [13, 17], young_adult: [18, 35], adult: [36, 59], elder: [60, 110],
};
export const bandOf = (age: number): AgeBand =>
  AGE_BANDS.find(b => age >= BAND_AGES[b][0] && age <= BAND_AGES[b][1]) ?? "elder";

export const PortraitEntry = z.object({
  /** `lib_<presentation><age>_<nnn>` (A.3.5's record id). */
  id: z.string().regex(/^lib_[fma]\d{2}_\d{3}$/),
  band: z.enum(AGE_BANDS),
  /** The age it was drawn at. */
  age: z.number().int().min(0).max(110),
  presentation: z.enum(["f", "m", "a"]),
  /** 1 (lightest) to 6 (deepest), A.3.5. */
  skin: z.number().int().min(1).max(6),
  skin_word: z.string(),
  /** The hair as words (V06's check: a card's appearance mustn't contradict it). */
  hair_word: z.string(),
  attire: z.array(z.string()).min(1),
  build: z.enum(["slight", "average", "broad"]),
  caption: z.string(),
  look: CardHumanLook,
});
export type PortraitEntry = z.infer<typeof PortraitEntry>;

export const PORTRAIT_LIBRARY: readonly PortraitEntry[] = z.array(PortraitEntry).parse((data as { portraits: unknown }).portraits);
const BY_ID = new Map(PORTRAIT_LIBRARY.map(p => [p.id, p]));
export const portraitById = (id: string): PortraitEntry | undefined => BY_ID.get(id);
export const isLibraryPortrait = (id: string): boolean => /^lib_[fma]\d{2}_\d{3}$/.test(id);

/** What a member's portrait should be. */
export interface PortraitWant {
  band: AgeBand;
  presentation: Presentation;
  /** The archetype's attire tags (A.3.5 step 4: +2 each). */
  attire: readonly string[];
  /** A.3.5 step 5: children lean to within ±1 of a parent's skin. */
  nearSkin?: number;
  /** A look to match (a person who already has one: an old save's card whose portrait went missing). */
  look?: CardHumanLook;
}

/** Brightness of a 0xRRGGBB colour, 0..1. */
const luma = (c: number): number => (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;

/** How well a look matches an entry's look: hair style and colour, skin, glasses, headwear (0..8). */
export function lookMatch(a: CardHumanLook, b: CardHumanLook): number {
  const skin = 1 - Math.min(1, Math.abs(luma(swatchColour(a.skin, SKIN_TONES)) - luma(swatchColour(b.skin, SKIN_TONES))) * 3);
  const hair = 1 - Math.min(1, Math.abs(luma(swatchColour(a.hair.colour, HAIR_COLOURS)) - luma(swatchColour(b.hair.colour, HAIR_COLOURS))) * 2.5);
  return 3 * skin + 2 * hair + (a.hair.style === b.hair.style ? 1.5 : 0)
    + ((a.glasses ?? "none") === (b.glasses ?? "none") ? 0.75 : 0)
    + ((a.headwear?.kind ?? "none") === (b.headwear?.kind ?? "none") ? 0.75 : 0);
}

/** The picker's score for one entry (higher is better). `uses`: how many living residents wear it already. */
export function scorePortrait(entry: PortraitEntry, want: PortraitWant, uses: number): number {
  let score = 0;
  // A.3.5 step 3: presentation by the archetype's weights; an androgynous bust fits either at a cost.
  if (entry.presentation === want.presentation) score += 3;
  else if (entry.presentation === "a" || want.presentation === "a") score += 1;
  score += 2 * entry.attire.filter(t => want.attire.includes(t)).length;
  if (want.nearSkin !== undefined && Math.abs(entry.skin - want.nearSkin) <= 1) score += 2;
  if (want.look) score += lookMatch(want.look, entry.look);
  // GDD-GAP: A.3.4 rule 5 never reuses a portrait; with 16 busts the picker only avoids it.
  score -= 4 * uses;
  return score;
}

const BAND_ORDER: Readonly<Record<AgeBand, readonly AgeBand[]>> = {
  child: ["child", "teen"], teen: ["teen", "child", "young_adult"], young_adult: ["young_adult", "teen", "adult"],
  adult: ["adult", "young_adult", "elder"], elder: ["elder", "adult"],
};

/**
 * Pick a library portrait (A.3.5): the band first (relaxed to the nearest band when it has none), then the best
 * scores; uniformly among the entries within a point and a half of the best (A.3.5 step 5's "top five", scaled to
 * the MVP library).
 */
export function assignPortrait(want: PortraitWant, rng: SeededRng, uses: ReadonlyMap<string, number>, library: readonly PortraitEntry[] = PORTRAIT_LIBRARY): PortraitEntry {
  for (const band of BAND_ORDER[want.band]) {
    const pool = library.filter(p => p.band === band);
    if (!pool.length) continue;
    const scored = pool.map(p => ({ p, s: scorePortrait(p, want, uses.get(p.id) ?? 0) })).sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id));
    const best = scored[0]!.s;
    const top = scored.filter(x => x.s >= best - 1.5).slice(0, 3);
    return rng.pick(top).p;
  }
  throw new Error(`the portrait library has nothing near band ${want.band}`);
}

/** The best entry for a look (no randomness): a card that kept its look but lost its portrait. */
export function matchPortrait(look: CardHumanLook, band: AgeBand, presentation: Presentation, uses: ReadonlyMap<string, number> = new Map()): PortraitEntry {
  for (const b of BAND_ORDER[band]) {
    const pool = PORTRAIT_LIBRARY.filter(p => p.band === b);
    if (!pool.length) continue;
    return pool.map(p => ({ p, s: scorePortrait(p, { band, presentation, attire: [], look }, uses.get(p.id) ?? 0) }))
      .sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id))[0]!.p;
  }
  return PORTRAIT_LIBRARY[0]!;
}
