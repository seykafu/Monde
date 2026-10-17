// The real Day-1 inputs (content/), loaded the way tools/gen-residents.ts loads them, for the M-03 step 2 tests. The
// written cards start empty: tests write into memory, never into content/.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import {
  ItemCatalog, PersonaCard, SeededRng, WHIMS, nativeDrawFor, nativeTemplateHousehold, nativeValidationContext, parseHomes, parsePins, type ArrivalHouseholdOutput,
  type CensusInput, type Day1Skeleton, type HouseholdDraw, type SkeletonHousehold,
} from "../index";
import { censusProgressReset } from "../census/skeleton";

const root = resolve(import.meta.dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

export const pins = parsePins(YAML.parse(read("content/census/pins.yaml")));
export const homes = parseHomes(YAML.parse(read("content/places/homes.yaml")));
const placesDoc = YAML.parse(read("content/places/places.yaml")) as Record<string, string[]>;
export const places = new Set(Object.entries(placesDoc).flatMap(([zone, ids]) => ids.map(id => `${zone}.${id}`)));
export const giftTags = [...new Set(ItemCatalog.parse(YAML.parse(read("content/items.yaml"))).flatMap(i => i.tags))];
export const handCards = readdirSync(resolve(root, "content/residents")).filter(f => f.endsWith(".yaml")).sort()
  .map(f => PersonaCard.parse(YAML.parse(read(`content/residents/${f}`))));
const frozen = censusProgressReset(YAML.parse(read("content/census/day1.yaml")) as Day1Skeleton, new Set(pins.households.map(h => h.id)));

/** A fresh input: the skeleton as the seed built it, nothing written yet. */
export function censusInput(): CensusInput {
  return { skeleton: structuredClone(frozen), pins, homes, places, cards: handCards, written: new Map(), giftTags };
}

export const household = (input: CensusInput, id: string): SkeletonHousehold => {
  const h = input.skeleton.households.find(x => x.id === id);
  if (!h) throw new Error(`no household ${id}`);
  return h;
};

/** A household that matches: the first in file order. */
export const findHousehold = (input: CensusInput, test: (h: SkeletonHousehold) => boolean): SkeletonHousehold => {
  const h = input.skeleton.households.find(x => x.generation && test(x));
  if (!h) throw new Error("no household matches");
  return h;
};

/**
 * A model-like answer for a household: the template household rewritten in its own words (a fresh backstory per
 * member, values moved off the defaults), so it passes the native validator.
 */
export function modelAnswer(input: CensusInput, h: SkeletonHousehold, draw: HouseholdDraw = nativeDrawFor(input, h), salt = "a"): ArrivalHouseholdOutput {
  const out = nativeTemplateHousehold(draw, nativeValidationContext(input, h, draw, { novelty: false }), `${salt}-${h.id}`);
  const rng = SeededRng.of(salt, h.id, "backstory");
  out.members.forEach((m, i) => {
    // Words drawn at random, so no two backstories share a four-word run (V19).
    const words = Array.from({ length: 24 }, () => rng.pick(WHIMS).split(" ").at(-1)!);
    m.backstory = `${m.name.split(" ")[0]} ${i} remembers ${words.join(" ")}.`;
    m.values = { ...m.values, prosperity: Math.round((m.values.prosperity + 0.05) * 100) / 100, safety: Math.round((m.values.safety - 0.05) * 100) / 100 };
  });
  return out;
}
