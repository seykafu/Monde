// Portraits for the Day-1 census (MVP M-03, Kasey's D1; GDD Appendix A.3.5, §16.2). Pure.
//
// The library is far smaller than A.3.5's 526 busts, so the Day-1 town shares it out by how often the player will see
// someone. Every generated member gets a visibility score:
//   +5  named canon (§12.4, A.1.5)
//   +3  works at a public-facing place on an open board (shops, pub, café, fish market, ferry and ticket booth,
//       boathouse, harbour boats, library, Town Hall, chapel, market stall)
//   +2  lives on an open board
//   +1  named by a carded resident, or kin of one
//   −2  a weekly commuter (away Tuesday to Friday)
//   −3  under five
// Within each age band library identities go to the highest scores until the band's allowance runs out: the band's
// library rows less a reserve held for Spring's arrivals (20%, at least 2). A bust is matched by presentation, drawn age,
// attire and, for a child, a parent's skin. Two colour variants of one master never go to unrelated people in the same
// zone, or to two people who work in one place (twins may share a master in two colours). Everyone else gets a seeded procedural look (portrait = their own id;
// the client draws the procedural bust from the card's look), skin balanced against the library's mix, a child within
// one skin step of a parent and, half the time, the parent's hair. tagsFromLook gives any look A.3.5-style tags, so the
// card prompt sees the same kind of tags either way.
import type { ArchetypeId, Presentation } from "../arrivals/archetypes";
import { ARCHETYPE_BY_ID } from "../arrivals/archetypes";
import { AGE_REACH, agePenalty, masterOf, type AgeBand, type PortraitEntry } from "../arrivals/library";
import type { SeededRng } from "../arrivals/rng";
import { CLOTH_COLOURS, HAIR_COLOURS, type CardHumanLook, type HairStyle, type OutfitCut } from "../look";
import { CENSUS_BANDS, COMMUTER_ROW, OPEN_BOARDS, PUBLIC_ROWS, type CensusZone } from "./day1Tables";

// ── Tags ────────────────────────────────────────────────────────────────────

/** A.3.5's skin scale (1 lightest … 6 deepest) for each SKIN_TONES index, and the library's words for it. */
export const SKIN_SCALE: readonly { scale: number; word: string }[] = [
  { scale: 2, word: "fair" }, { scale: 2, word: "fair" }, { scale: 3, word: "tan" }, { scale: 5, word: "dark brown" },
  { scale: 1, word: "pale" }, { scale: 4, word: "brown" }, { scale: 1, word: "pale" }, { scale: 3, word: "olive" },
  { scale: 6, word: "deep brown" }, { scale: 4, word: "golden brown" },
];
/** The SKIN_TONES indices on each step of the scale. */
export const SKIN_INDICES: Readonly<Record<number, readonly number[]>> = { 1: [4, 6], 2: [0, 1], 3: [7, 2], 4: [5, 9], 5: [3], 6: [8] };
export const HAIR_WORDS: readonly string[] = [
  "dark brown", "light brown", "grey", "black", "copper", "sandy blond", "chestnut", "blue-black", "white", "auburn", "ginger", "salt-and-pepper",
];
export const CLOTH_WORDS: readonly string[] = [
  "teal", "brown", "dark brown", "brick-red", "mustard", "sky-blue", "slate-blue", "green", "plum", "cream", "olive", "rust", "rose", "charcoal", "grey", "tan",
];
const CUT_TAG: Readonly<Record<OutfitCut, string | null>> = { plain: null, jumper: "jumper", smock: "smock", pinafore: "pinafore", apron: "apron", coat: "coat", dungarees: "dungarees" };
const BUILD_TAG = { narrow: "slight", medium: "average", broad: "broad" } as const;

/** The A.3.5 record a procedural look stands in for (what the card prompt reads beside a library bust's). */
export interface PortraitTags {
  band: AgeBand;
  presentation: Presentation;
  skin: number;
  skin_word: string;
  hair_word: string;
  hair_style: HairStyle;
  attire: string[];
  build: "slight" | "average" | "broad";
  caption: string;
}

const swatchIndex = (v: number | string, n: number): number => (typeof v === "number" ? v : 0) % n;

/** A.3.5-style tags from any look (the attire tags the library uses: cut, cap, glasses, scarf, apron). */
export function tagsFromLook(look: CardHumanLook, who: { band: AgeBand; presentation: Presentation; age: number }): PortraitTags {
  const skin = SKIN_SCALE[swatchIndex(look.skin, SKIN_SCALE.length)]!;
  const hairWord = HAIR_WORDS[swatchIndex(look.hair.colour, HAIR_COLOURS.length)]!;
  const attire: string[] = [];
  const cut = CUT_TAG[look.outfit.cut];
  if (cut) attire.push(cut);
  if (look.headwear && look.headwear.kind !== "none") attire.push(look.headwear.kind);
  if (look.glasses && look.glasses !== "none") attire.push("glasses");
  if (look.accessory.kind === "scarf" || look.accessory.kind === "apron") attire.push(look.accessory.kind);
  if (!attire.length) attire.push(look.outfit.bottom_style === "skirt" ? "skirt" : "shirt");
  const tags: PortraitTags = {
    band: who.band, presentation: who.presentation, skin: skin.scale, skin_word: skin.word, hair_word: hairWord,
    hair_style: look.hair.style, attire: [...new Set(attire)], build: BUILD_TAG[look.build], caption: "",
  };
  tags.caption = captionFor(look, tags, who.age);
  return tags;
}

const AGE_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen"];
const decade = (age: number): string => ({ 2: "twenties", 3: "thirties", 4: "forties", 5: "fifties" } as Record<number, string>)[Math.floor(age / 10)] ?? "twenties";

/** "A man in his forties with short salt-and-pepper hair, a navy jumper and a flat cap." (agelessCaption strips the age.) */
function captionFor(look: CardHumanLook, t: PortraitTags, age: number): string {
  const p = t.presentation;
  const pos = p === "f" ? "her" : p === "m" ? "his" : "their";
  const noun = (f: string, m: string, a: string) => (p === "f" ? f : p === "m" ? m : a);
  const who = t.band === "child" ? `${age < 2 ? "A baby" : `A small ${noun("girl", "boy", "child")}`} of about ${AGE_WORDS[Math.max(1, age)]}`
    : t.band === "teen" ? `A ${noun("girl", "boy", "teenager")} of about ${AGE_WORDS[age]}`
      : t.band === "young_adult" ? `A young ${noun("woman", "man", "person")} in ${pos} ${decade(age)}`
        : t.band === "adult" ? `A ${noun("woman", "man", "person")} in ${pos} ${decade(age)}`
          : `An older ${noun("woman", "man", "person")}`;
  const c = t.hair_word;
  const a = (word: string) => (/^[aeiou]/.test(word) ? `an ${word}` : `a ${word}`);
  const hair: Record<HairStyle, string> = {
    short: `short ${c} hair`, cropped: `close-cropped ${c} hair`, bob: `${a(c)} bob`, long: `long ${c} hair`,
    ponytail: `${c} hair in a ponytail`, bun: `${c} hair in a bun`, curly: `${c} curls`, braids: `${c} braids`,
    buzz: `${c} hair shaved close`, pigtails: `${c} pigtails`, swept: `${c} hair swept back`, tufty: `tufty ${c} hair`,
  };
  const top = CLOTH_WORDS[swatchIndex(look.outfit.top, CLOTH_COLOURS.length)]!;
  const cutWord = look.outfit.cut === "plain" ? "shirt" : look.outfit.cut === "dungarees" ? "dungarees" : look.outfit.cut;
  const parts = [hair[look.hair.style], look.outfit.cut === "dungarees" ? `${top} dungarees` : `${a(top)} ${cutWord}`];
  if (look.headwear && look.headwear.kind !== "none") parts.push(`${a(CLOTH_WORDS[swatchIndex(look.headwear.colour ?? 14, CLOTH_COLOURS.length)]!)} ${look.headwear.kind.replace("_", " ")}`);
  if (look.glasses && look.glasses !== "none") parts.push(look.glasses === "on_head" ? "glasses pushed up into the hair" : `${look.glasses === "halfmoon" ? "half-moon" : look.glasses} glasses`);
  if (look.accessory.kind === "scarf") parts.push(`${a(CLOTH_WORDS[swatchIndex(look.accessory.colour ?? 9, CLOTH_COLOURS.length)]!)} scarf`);
  if (look.face?.moustache) parts.push("a moustache");
  if (look.face?.freckles) parts.push("freckles");
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]!;
  return `${who} with ${list}.`;
}

// ── Procedural looks ────────────────────────────────────────────────────────

interface Style { cuts: readonly OutfitCut[]; cap?: [HeadwearKind, number]; glasses?: number; scarf?: number; apron?: boolean; broad?: number }
type HeadwearKind = "flat_cap" | "peaked_cap" | "knit_cap";
/** How each archetype dresses (A.2's portrait attire, in the rig's vocabulary). */
const STYLE: Readonly<Partial<Record<ArchetypeId, Style>>> = {
  young_family: { cuts: ["jumper", "coat", "plain"], cap: ["knit_cap", 0.2], scarf: 0.2 },
  school_family: { cuts: ["jumper", "coat", "plain"], scarf: 0.3 },
  single_parent: { cuts: ["coat", "plain", "jumper"], scarf: 0.4 },
  young_creative: { cuts: ["smock", "plain", "coat"], scarf: 0.5 },
  apprentice: { cuts: ["apron", "dungarees", "plain"] },
  drifter: { cuts: ["coat", "plain"], cap: ["knit_cap", 0.2], scarf: 0.2 },
  remote_craftsperson: { cuts: ["apron", "smock"], scarf: 0.4 },
  shop_founder: { cuts: ["plain", "coat"], glasses: 0.3 },
  cook_baker: { cuts: ["apron", "plain"], apron: true },
  builder: { cuts: ["dungarees", "plain", "jumper"], cap: ["flat_cap", 0.4], broad: 0.45 },
  fisher: { cuts: ["jumper", "coat"], cap: ["knit_cap", 0.5], broad: 0.4 },
  market_gardener: { cuts: ["dungarees", "jumper"], scarf: 0.2 },
  mill_hand: { cuts: ["plain", "jumper"], cap: ["flat_cap", 0.5], broad: 0.35 },
  retired_couple: { cuts: ["coat", "plain", "pinafore"], glasses: 0.4, scarf: 0.3 },
  widowed_elder: { cuts: ["pinafore", "plain", "coat"], glasses: 0.45, scarf: 0.4 },
  retired_keeper: { cuts: ["jumper", "coat"], cap: ["peaked_cap", 0.6], broad: 0.3 },
  retired_organizer: { cuts: ["coat", "plain"], glasses: 0.6 },
  birdwatcher: { cuts: ["coat"], glasses: 0.3, scarf: 0.3 },
  retired_magician: { cuts: ["coat", "plain"], scarf: 0.6 },
  cartographer: { cuts: ["coat", "plain"], glasses: 0.4 },
  radio_tinkerer: { cuts: ["smock", "apron"], glasses: 0.5 },
};
const CHILD_STYLE: Style = { cuts: ["jumper", "plain", "pinafore", "dungarees"], scarf: 0.2 };

const STYLES_F: readonly HairStyle[] = ["bob", "long", "ponytail", "bun", "curly", "braids"];
const STYLES_M: readonly HairStyle[] = ["short", "cropped", "buzz", "curly", "swept", "tufty"];
const STYLES_A: readonly HairStyle[] = ["short", "cropped", "bob", "curly", "swept", "tufty"];
const STYLES_ELDER_F: readonly HairStyle[] = ["bun", "short", "bob", "curly"];
const STYLES_ELDER_M: readonly HairStyle[] = ["short", "cropped", "tufty", "swept"];
/** Natural hair by skin step (HAIR_COLOURS indices, weighted by repetition). */
const HAIR_BY_SKIN: Readonly<Record<number, readonly number[]>> = {
  1: [0, 1, 1, 5, 5, 6, 9, 10, 4, 3], 2: [0, 0, 1, 5, 6, 6, 9, 10, 4, 3], 3: [0, 0, 3, 3, 6, 6, 1, 9],
  4: [0, 3, 3, 3, 6, 7], 5: [3, 3, 3, 0, 7], 6: [3, 3, 3, 7, 0],
};
const GREYS: readonly number[] = [2, 2, 8, 8, 8, 11, 11];
const isNatural = (c: number): boolean => ![2, 8, 11].includes(c);

export interface LookWant {
  band: AgeBand;
  age: number;
  presentation: Presentation;
  archetype: ArchetypeId | null;
  /** Skin step (1–6) to draw from: the balancer's pick. */
  skin: number;
  /** A parent's hair colour (HAIR_COLOURS index): a child takes it half the time. */
  parentHair?: number;
}

/** A seeded look the rig can draw (cardLookProblems is clean on every one). */
export function proceduralLook(w: LookWant, rng: SeededRng): CardHumanLook {
  const minor = w.band === "child" || w.band === "teen";
  const style = minor ? CHILD_STYLE : STYLE[w.archetype ?? "widowed_elder"] ?? { cuts: ["plain", "coat"] };
  const skinIdx = rng.pick(SKIN_INDICES[w.skin]!);
  const elder = w.band === "elder";
  let colour: number;
  if (w.parentHair !== undefined && isNatural(w.parentHair) && minor && rng.chance(0.5)) colour = w.parentHair;
  else if (elder) colour = rng.chance(0.08) ? rng.pick(HAIR_BY_SKIN[w.skin]!) : rng.pick(GREYS);
  else if (w.band === "adult" && w.age >= 45 && rng.chance(0.3)) colour = rng.pick([11, 2]);
  else colour = rng.pick(HAIR_BY_SKIN[w.skin]!);
  const styles = w.presentation === "f" ? (elder ? STYLES_ELDER_F : w.band === "child" ? [...STYLES_F, "pigtails" as const] : STYLES_F)
    : w.presentation === "m" ? (elder ? STYLES_ELDER_M : STYLES_M) : STYLES_A;
  const cuts = style.cuts.filter(c => c !== "pinafore" || w.presentation !== "m");
  const cut = rng.pick(cuts.length ? cuts : ["plain"] as const);
  const cloth = () => rng.int(0, CLOTH_COLOURS.length - 1);
  const broad = style.broad ?? 0.15;
  const build = minor ? (rng.chance(0.6) ? "narrow" : "medium") : rng.chance(broad) ? "broad" : rng.chance(0.55) ? "medium" : "narrow";
  const skirt = w.presentation === "f" ? rng.chance(0.4) : w.presentation === "a" ? rng.chance(0.1) : false;
  const bottomStyle = w.band === "child" && rng.chance(0.3) ? "shorts" : skirt ? "skirt" : "trousers";
  const look: CardHumanLook = {
    kind: "human",
    skin: skinIdx,
    hair: { style: rng.pick(styles), colour },
    eyes: rng.int(0, 7),
    build,
    height: w.band === "child" ? "short" : w.band === "teen" ? (rng.chance(0.5) ? "short" : "tall") : rng.chance(0.55) ? "tall" : "short",
    outfit: { cut, top: cloth(), bottom: cloth(), bottom_style: bottomStyle, shoes: cloth(), ...(cut === "pinafore" || cut === "dungarees" ? { trim: cloth() } : {}) },
    accessory: { kind: "none" },
  };
  const glasses = !minor && rng.chance((style.glasses ?? 0.1) * (elder ? 1.4 : 1));
  if (glasses) {
    const kind = w.archetype === "radio_tinkerer" && rng.chance(0.6) ? "on_head" : rng.pick(["round", "halfmoon", "heavy"] as const);
    look.glasses = kind;
    if (kind !== "on_head") look.accessory = { kind: "glasses" };
  }
  if (look.accessory.kind === "none") {
    if (style.apron && cut !== "apron") look.accessory = { kind: "apron", colour: cloth() };
    else if (rng.chance(style.scarf ?? 0.1)) look.accessory = { kind: "scarf", colour: cloth() };
  }
  if (style.cap && rng.chance(style.cap[1])) look.headwear = { kind: style.cap[0], colour: cloth() };
  const face: NonNullable<CardHumanLook["face"]> = {};
  if (w.presentation === "m" && !minor && rng.chance(0.25)) face.moustache = true;
  if (w.presentation !== "f" && (w.band === "adult" || w.band === "young_adult") && rng.chance(0.2)) face.stubble = true;
  if (minor && w.skin <= 3 && rng.chance(0.3)) face.freckles = true;
  if (w.band === "adult" && w.age >= 40 && isNatural(colour) && rng.chance(0.25)) face.grey_temples = true;
  if (Object.keys(face).length) look.face = face;
  return look;
}

/** A look's skin step (1–6). */
export const skinStep = (look: Pick<CardHumanLook, "skin">): number => SKIN_SCALE[swatchIndex(look.skin, SKIN_SCALE.length)]!.scale;

// ── The plan ────────────────────────────────────────────────────────────────

/** What the planner reads about each person. */
export interface PortraitPerson {
  /** `household/slot`. */
  key: string;
  household: string;
  zone: CensusZone;
  kind: "core" | "carded" | "named" | "anonymous";
  band: AgeBand;
  age: number;
  presentation: Presentation;
  /** Fixed by canon (named people): the bust must match. */
  presentationFixed: boolean;
  archetype: ArchetypeId | null;
  jobRow: number | null;
  workplace: string | null;
  underFive: boolean;
  /** Named by a carded resident's card, or kin of a carded resident. */
  cardTie: boolean;
  /** `household/slot` of the parent whose skin a child follows. */
  parent?: string;
  /** `household/slot` of a twin: may share a master in two colours. */
  twin?: string;
  /** Core and carded people: the card's look (their skin counts toward the town's mix). */
  look?: CardHumanLook;
}

export type PortraitChoice =
  | { source: "card"; id: string }
  | { source: "library"; id: string }
  | { source: "procedural"; look: CardHumanLook; tags: PortraitTags };

export interface PortraitPlan {
  choices: Map<string, PortraitChoice>;
  /** People whose presentation the bust changed (an androgynous bust for an unpinned person). */
  presentation: Map<string, Presentation>;
  allowance: Record<AgeBand, number>;
  reserve: Record<AgeBand, number>;
  scores: Map<string, number>;
}

/** D1's score. */
export function visibilityScore(p: PortraitPerson): number {
  let s = 0;
  if (p.kind === "named" || p.kind === "carded") s += 5;
  const zoneOf = p.workplace ? p.workplace.slice(0, p.workplace.indexOf(".")) : null;
  if (p.jobRow !== null && PUBLIC_ROWS.has(p.jobRow) && zoneOf && (OPEN_BOARDS as readonly string[]).includes(zoneOf)) s += 3;
  if ((OPEN_BOARDS as readonly string[]).includes(p.zone)) s += 2;
  if (p.cardTie) s += 1;
  if (p.jobRow === COMMUTER_ROW) s -= 2;
  if (p.underFive) s -= 3;
  return s;
}

/** D1: the reserve each band keeps for Spring's arrivals (20% of its rows, at least 2), and what's left to assign. */
export function bandAllowance(library: readonly PortraitEntry[]): { allowance: Record<AgeBand, number>; reserve: Record<AgeBand, number> } {
  const allowance = {} as Record<AgeBand, number>, reserve = {} as Record<AgeBand, number>;
  for (const band of CENSUS_BANDS) {
    const n = library.filter(e => e.band === band).length;
    reserve[band] = Math.min(n, Math.max(2, Math.ceil(0.2 * n)));
    allowance[band] = n - reserve[band];
  }
  return { allowance, reserve };
}

/**
 * Plan every generated person's portrait. Core and carded people keep their card's (`source: card`); the rest get a
 * library identity or a procedural look as D1 says. Bands go elder first, so a child's parent already has a skin.
 */
export function planPortraits(people: readonly PortraitPerson[], library: readonly PortraitEntry[], rngFor: (step: string) => SeededRng): PortraitPlan {
  const { allowance, reserve } = bandAllowance(library);
  const choices = new Map<string, PortraitChoice>();
  const presentation = new Map<string, Presentation>();
  const scores = new Map<string, number>();
  /** Skin steps worn so far (cards' looks and every choice), for the balancer and a child's parent. */
  const skinOf = new Map<string, number>();
  const hairOf = new Map<string, number>();
  const libraryShare = new Map<number, number>();
  for (const e of library) libraryShare.set(e.skin, (libraryShare.get(e.skin) ?? 0) + 1 / library.length);
  const worn = new Map<number, number>();
  const wear = (key: string, skin: number, hair?: number) => {
    skinOf.set(key, skin); worn.set(skin, (worn.get(skin) ?? 0) + 1);
    if (hair !== undefined) hairOf.set(key, hair);
  };
  for (const p of people) {
    if (p.kind === "core" || p.kind === "carded") {
      choices.set(p.key, { source: "card", id: p.key });
      if (p.look) wear(p.key, skinStep(p.look), typeof p.look.hair.colour === "number" ? p.look.hair.colour : undefined);
    }
  }
  const used = new Set<string>();
  /** master → the zones it is worn in and by whom. */
  const masterWear = new Map<string, { zone: CensusZone; key: string; workplace: string | null }[]>();
  const pickRng = rngFor("library");
  const lookRng = rngFor("procedural");
  const orderRng = rngFor("order");
  for (const band of [...CENSUS_BANDS].reverse()) {
    const pool = people.filter(p => p.band === band && (p.kind === "named" || p.kind === "anonymous"));
    const jitter = new Map(pool.map(p => [p.key, orderRng.next()]));
    for (const p of pool) scores.set(p.key, visibilityScore(p));
    const order = [...pool].sort((a, b) => scores.get(b.key)! - scores.get(a.key)! || jitter.get(a.key)! - jitter.get(b.key)!);
    let left = allowance[band];
    for (const p of order) {
      if (left <= 0) break;
      const parentSkin = p.parent ? skinOf.get(p.parent) : undefined;
      const archetypeAttire = p.archetype ? ARCHETYPE_BY_ID.get(p.archetype)?.attire ?? [] : [];
      let best: { e: PortraitEntry; s: number } | null = null;
      for (const e of library) {
        if (e.band !== band || used.has(e.id) || Math.abs(e.age - p.age) > AGE_REACH[band]) continue;
        if (e.presentation !== p.presentation && (p.presentationFixed || (e.presentation !== "a" && p.presentation !== "a"))) continue;
        const wearers = masterWear.get(masterOf(e)) ?? [];
        // Not in one zone, nor at one workplace (the Tollmen walk the round together), unless they're twins.
        if (wearers.some(w => (w.zone === p.zone || (w.workplace !== null && w.workplace === p.workplace)) && w.key !== p.twin)) continue;
        let s = (e.presentation === p.presentation ? 10 : 2) - agePenalty(e, p.age);
        s += 2 * e.attire.filter(t => archetypeAttire.includes(t)).length;
        if (parentSkin !== undefined) s += Math.abs(e.skin - parentSkin) <= 1 ? 3 : -3;
        // A.3.5 step 4: lean toward the skin the town has least of, against the library's own mix.
        const total = [...worn.values()].reduce((a, b) => a + b, 0) + 1;
        s += 4 * ((libraryShare.get(e.skin) ?? 0) - (worn.get(e.skin) ?? 0) / total);
        s += 0.5 * pickRng.next();
        if (!best || s > best.s) best = { e, s };
      }
      if (!best) continue;
      used.add(best.e.id);
      left--;
      choices.set(p.key, { source: "library", id: best.e.id });
      if (best.e.presentation !== p.presentation) presentation.set(p.key, best.e.presentation);
      masterWear.set(masterOf(best.e), [...(masterWear.get(masterOf(best.e)) ?? []), { zone: p.zone, key: p.key, workplace: p.workplace }]);
      const hair = best.e.look.hair.colour;
      wear(p.key, best.e.skin, typeof hair === "number" ? hair : undefined);
    }
    // Everyone else in the band: a procedural look, skin balanced against the library's mix.
    for (const p of [...pool].sort((a, b) => a.key.localeCompare(b.key))) {
      if (choices.has(p.key)) continue;
      const parentSkin = p.parent ? skinOf.get(p.parent) : undefined;
      const total = [...worn.values()].reduce((a, b) => a + b, 0) + 1;
      const steps = [1, 2, 3, 4, 5, 6].filter(s => parentSkin === undefined || Math.abs(s - parentSkin) <= 1);
      const weights = steps.map(s => [s, Math.max(0.05, (libraryShare.get(s) ?? 0) * total - (worn.get(s) ?? 0) + 0.5)] as const);
      const skin = lookRng.weighted(weights) ?? steps[0]!;
      const look = proceduralLook({ band, age: p.age, presentation: p.presentation, archetype: p.archetype, skin, parentHair: p.parent ? hairOf.get(p.parent) : undefined }, lookRng);
      choices.set(p.key, { source: "procedural", look, tags: tagsFromLook(look, { band, presentation: p.presentation, age: p.age }) });
      wear(p.key, skin, look.hair.colour as number);
    }
  }
  return { choices, presentation, allowance, reserve, scores };
}
