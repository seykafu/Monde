/**
 * What the scene compiler validates against: declared flags (content/flags.yaml + rule patterns), resident cards
 * (speaker ids and their portrait_expressions), speakers without cards, and optionally the place registry.
 * Built from YAML text so this module stays free of Node APIs; tools and tests read the files.
 */
import YAML from "yaml";
import { STANDARD_EXPRESSIONS } from "../persona";

/** Flags declared by rule rather than listed (keep in step with tools/lint-content.ts). */
export const FLAG_PATTERNS: readonly RegExp[] = [
  /^pz(?:01|02|03|04|05|06|13|15|18)_solved$/,
  /^met_[a-z0-9_]+$/,
  /^project_[a-z0-9_]+_done$/,
  /^romance_\d_bloomed$/,
  /^s\d{2}[a-z]?_done$/,
  /^ending_e\d(_seen)?$/,
];

/** Speakers with no persona card (GDD §13.3–13.4). They use the standard eight expressions. */
export const FEATURED_SPEAKERS = ["bru", "nettie", "dex", "dom", "weasel", "moss", "ada", "arrival"] as const;

/** Romance-pair aliases (`pair1_a` … `pair3_b`, §13.5a), filled at runtime from the first couples to bloom. */
export const PAIR_ALIAS = /^pair\d_[ab]$/;

export interface SceneRegistry {
  flags: ReadonlySet<string>;
  flagPatterns: readonly RegExp[];
  /** Card id → portrait_expressions. */
  residents: ReadonlyMap<string, readonly string[]>;
  /** Speaker ids without a card (standard expressions). */
  featured: ReadonlySet<string>;
  /** `zone.place` ids; when given, an unknown header `place` is a warning. */
  places?: ReadonlySet<string>;
}

export function makeRegistry(input: {
  flags: Iterable<string>;
  residents: Iterable<readonly [string, readonly string[]]> | Record<string, readonly string[]>;
  featured?: Iterable<string>;
  places?: Iterable<string>;
  flagPatterns?: readonly RegExp[];
}): SceneRegistry {
  const res = Symbol.iterator in input.residents
    ? new Map(input.residents as Iterable<readonly [string, readonly string[]]>)
    : new Map(Object.entries(input.residents as Record<string, readonly string[]>));
  return {
    flags: new Set(input.flags),
    flagPatterns: input.flagPatterns ?? FLAG_PATTERNS,
    residents: res,
    featured: new Set(input.featured ?? FEATURED_SPEAKERS),
    ...(input.places ? { places: new Set(input.places) } : {}),
  };
}

/** Build a registry from the raw text of content/flags.yaml, content/residents/*.yaml and content/places/places.yaml. */
export function registryFromContent(input: { flagsYaml: string; residentYamls: string[]; placesYaml?: string }): SceneRegistry {
  const flagsDoc = YAML.parse(input.flagsYaml) as { flags?: unknown };
  const flags = Array.isArray(flagsDoc?.flags) ? flagsDoc.flags.filter((f): f is string => typeof f === "string") : [];
  const residents: [string, string[]][] = [];
  for (const text of input.residentYamls) {
    const card = YAML.parse(text) as { id?: unknown; portrait_expressions?: unknown };
    if (typeof card?.id !== "string") continue;
    const ex = Array.isArray(card.portrait_expressions) ? card.portrait_expressions.filter((e): e is string => typeof e === "string") : [];
    residents.push([card.id, ex.length ? ex : [...STANDARD_EXPRESSIONS]]);
  }
  let places: string[] | undefined;
  if (input.placesYaml) {
    const doc = YAML.parse(input.placesYaml) as Record<string, unknown>;
    places = [];
    for (const [zone, ids] of Object.entries(doc ?? {})) if (Array.isArray(ids)) for (const id of ids) places.push(`${zone}.${id}`);
  }
  return makeRegistry({ flags, residents, ...(places ? { places } : {}) });
}

export function flagDeclared(reg: SceneRegistry, flag: string): boolean {
  return reg.flags.has(flag) || reg.flagPatterns.some((r) => r.test(flag));
}

/** A place is known if registered, or a generated home `<zone>.home_NN` (Appendix A.1.3). */
export function placeKnown(reg: SceneRegistry, place: string): boolean {
  return !reg.places || reg.places.has(place) || /^[a-z_]+\.home_\d{2,3}$/.test(place);
}

/** Portrait expressions a speaker may use, or null if the speaker is unknown. */
export function speakerExpressions(reg: SceneRegistry, speaker: string): readonly string[] | null {
  const card = reg.residents.get(speaker);
  if (card) return card;
  if (reg.featured.has(speaker) || PAIR_ALIAS.test(speaker)) return STANDARD_EXPRESSIONS;
  return null;
}
