// The Day-1 census skeleton (MVP M-03 step 1; GDD Appendix A.1, A.1.5, A.2, A.3.3–A.3.5): the 123 households and 210
// homed residents before anyone's card is written, built to close every A.1 table. Pure and seeded: the same seed,
// pins, homes, library and cards give the same skeleton (content/census/day1.yaml is one, frozen).
//
// buildSkeleton, step by step (each step draws from its own seeded stream, so changing one leaves the others be):
//   1. layout     the pinned households (content/census/pins.yaml), then A.1.2's remaining types × zones.
//   2. minors     which school-age minors are pupils and which teens (A.1.1 by zone), and their archetypes (A.1.5).
//   3. archetypes the identities (J young_family, K and M single_parent, L and N school_family), then the rest of
//                 A.1.5's quotas household by household: retired couples into the B and C households (they can't live
//                 alone), the other pairs one archetype where the quota allows (A.3.3), and the people living alone
//                 take what is left, which always closes. Fishers lean to the Wharf, mill hands to Millbrook.
//   4. ages       inside band and archetype range (A.2), V04's parent and couple gaps, the exact pupil ages (A.1.1).
//   5. work       A.1.4's job rows × band and its statuses (90 employed, 13 out of work of whom 9 adult mill hands,
//                 8 carers, 11 unable to work, 12 commuters), four teens with Saturday jobs.
//   6. presentation by A.2's weights; 7. homes (homes.yaml, beds >= ceil(size / 2)); 8. portraits (portraitPlan.ts,
//   D1); 9. surnames and first-name options (V03); 10. birthdays; 11. years in Monde; 12. links.
import type { ArchetypeId, Presentation } from "../arrivals/archetypes";
import { ARCHETYPE_BY_ID } from "../arrivals/archetypes";
import { BAND_AGES, bandOf, type AgeBand, type PortraitEntry } from "../arrivals/library";
import { FAMILY_NAMES, FAMOUS_NAMES, FIRST_NAMES, RESERVED_FAMILY_NAMES, RESERVED_FIRST_NAMES, foldName } from "../arrivals/names";
import { SeededRng } from "../arrivals/rng";
import type { CardLook } from "../look";
import {
  ARCHETYPE_QUOTAS, CENSUS_BANDS, CENSUS_ZONES, COMMUTER_ROW, CORE_HOMED, CORE_JOBS, HOUSEHOLD_TYPES, JOB_ROWS, MINORS_BY_ZONE, OUT_OF_WORK_MILL_HANDS,
  PUPIL_AGES, STATUS_TABLE, TEEN_SATURDAY_JOBS, TYPES_BY_ZONE, TYPE_IDENTITY, rowJobs, shapeOf,
  type CensusZone, type Employment, type HouseholdType, type CensusRole, type MinorKind,
} from "./day1Tables";
import { bedsNeeded, homeZone, isVacantHome, type HomeRegistry } from "./homes";
import { isNamedPin, type PinMember, type Pins } from "./pins";
import { planPortraits, type PortraitChoice, type PortraitPerson } from "./portraitPlan";

// ── Output ──────────────────────────────────────────────────────────────────

export type MemberKind = "core" | "carded" | "named" | "anonymous";
export type Pronoun = "she/her" | "he/him" | "they/them";
export interface SkeletonJob { row: number; title: string; workplace: string }

export interface SkeletonMember {
  slot: string;
  /** Pinned people's ids; null until the card is written. */
  id: string | null;
  name: string | null;
  kind: MemberKind;
  role: CensusRole;
  band: AgeBand;
  minor: MinorKind | null;
  age: number;
  age_range: [number, number];
  archetype: ArchetypeId | null;
  presentation: Presentation;
  pronoun_default: Pronoun;
  employment: Employment;
  job: SkeletonJob | null;
  /** Teens only: where the Saturday job is (A.1.4, four of them). */
  saturday_job: string | null;
  surname: string | null;
  /** Six first names to choose from (anonymous people only): none core, none held, none a household-mate's. */
  first_names: string[];
  /** Day of the 100-day calendar (§3.2); null for the core cast (their cards own it). */
  birthday: number | null;
  portrait: PortraitChoice;
  note?: string;
}

/**
 * Where a household is in M-03: `skeleton` (drawn by the seed) or `pinned` (held by pins.yaml) until its cards are
 * written (step 2, tools/gen-residents.ts: `drafted`), then `curated` once Kasey has edited them.
 */
export type HouseholdStatus = "skeleton" | "pinned" | "drafted" | "curated";

/** The card-writing step's ledger for one household (M-03 step 2). */
export interface GenerationRecord {
  prompt: "census-v1";
  /** Model calls made for it (0 before it is written; a template after six failures still counts them). */
  attempts: number;
  source: "model" | "template" | null;
  /** The household's inputs when its cards were written (generate.ts censusInputHash): a later change is warned about. */
  input_hash: string | null;
  cost_usd: number;
  /** ISO date-time of the write. */
  written_at?: string;
}

export interface SkeletonHousehold {
  id: string;
  type: HouseholdType;
  zone: CensusZone;
  home: string;
  archetype: ArchetypeId | null;
  surname: string | null;
  /** Null where a card already says. */
  years_in_monde: number | null;
  status: HouseholdStatus;
  members: SkeletonMember[];
  /** The card-writing step's ledger (M-03 step 2). Null when every member already has a card. */
  generation: GenerationRecord | null;
}

/** A fresh household ledger, as the skeleton writes it. */
export const blankGeneration = (): GenerationRecord => ({ prompt: "census-v1", attempts: 0, source: null, input_hash: null, cost_usd: 0 });

/**
 * The skeleton as the seed built it, without M-03 step 2's progress (statuses, generation records, the ids and names
 * the written cards gave anonymous members): what `buildSkeleton` reproduces from the seed.
 */
export function censusProgressReset(sk: Day1Skeleton, pinned: ReadonlySet<string>): Day1Skeleton {
  return {
    ...sk,
    households: sk.households.map(h => ({
      ...h,
      status: pinned.has(h.id) ? "pinned" : "skeleton",
      generation: h.generation ? blankGeneration() : null,
      members: h.members.map(m => (m.kind === "anonymous" ? { ...m, id: null, name: null } : m)),
    })),
  };
}

export interface SkeletonLink { a: string; b: string; tag: string; note: string; source: "pin" | "mirror" }

export interface Day1Skeleton {
  version: 1;
  seed: string;
  library: { rows: number; assigned: number; reserve: Record<AgeBand, number> };
  households: SkeletonHousehold[];
  links: SkeletonLink[];
}

/** What the skeleton reads from a persona card (content/residents). */
export interface CensusCard {
  id: string;
  name: string;
  age: number;
  pronouns: string;
  kind: string;
  home: string;
  look?: CardLook;
  relationships: readonly { id: string; tag?: string; affinity: number; trust: number }[];
}

// ── Working state ───────────────────────────────────────────────────────────

interface Draft {
  slot: string;
  role: CensusRole;
  band: AgeBand | "minor";
  minor: MinorKind | null;
  kind: MemberKind;
  id: string | null;
  name: string | null;
  archetype: ArchetypeId | null | undefined;
  presentation?: Presentation;
  presentationFixed: boolean;
  age?: number;
  ageFixed?: readonly [number, number];
  range?: [number, number];
  employment?: Employment;
  job?: SkeletonJob | null;
  saturday: string | null;
  surname: string | null | undefined;
  firstNames: string[];
  birthday: number | null;
  portrait?: PortraitChoice;
  note?: string;
  twin?: string;
  card?: CensusCard;
}
interface DraftHousehold {
  id: string;
  type: HouseholdType;
  zone: CensusZone;
  pinned: boolean;
  home: string | null;
  surname: string | null | undefined;
  members: Draft[];
  years: number | null | undefined;
}

const PRONOUN: Readonly<Record<Presentation, Pronoun>> = { f: "she/her", m: "he/him", a: "they/them" };
const presentationOfPronouns = (p: string): Presentation => (p.startsWith("she") ? "f" : p.startsWith("he") ? "m" : "a");
/** GDD-GAP: A.2 weights the adults' presentation only (as in draw.ts): children split evenly. */
const CHILD_PRESENTATION: Readonly<Record<Presentation, number>> = { f: 48, m: 48, a: 4 };
const ZONE_SHORT: Readonly<Record<CensusZone, string>> = { millbrook: "mb", old_quarter: "oq", market_row: "mr", wharf: "wf", station_hill: "sh", commons: "cm" };

function fail(msg: string): never { throw new Error(`census skeleton: ${msg}`); }
const bandOfMinorAge = (age: number): MinorKind => (age < 5 ? "under_five" : age <= 12 ? "pupil" : "teen");
const memberBand = (m: Draft): AgeBand => (m.band === "minor" ? (m.minor === "teen" ? "teen" : "child") : m.band);

/** Efraimidis–Spirakis: a seeded order that puts heavier items first more often. */
function weightedOrder<T>(items: readonly T[], weight: (t: T) => number, rng: SeededRng): T[] {
  return items.map(t => ({ t, k: Math.pow(rng.next() || 1e-12, 1 / Math.max(1e-9, weight(t))) })).sort((a, b) => b.k - a.k).map(x => x.t);
}
function shuffle<T>(items: readonly T[], rng: SeededRng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = rng.int(0, i); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

// ── 1. Layout ───────────────────────────────────────────────────────────────

function layout(pins: Pins, cards: ReadonlyMap<string, CensusCard>): DraftHousehold[] {
  const out: DraftHousehold[] = [];
  const pinnedCount = new Map<string, number>();
  const seen = new Set<string>();
  for (const h of pins.households) {
    if (seen.has(h.id)) fail(`two pinned households are called ${h.id}`);
    seen.add(h.id);
    const shape = shapeOf(h.type, h.zone);
    if (shape.length !== h.members.length) fail(`${h.id}: a type ${h.type} household in ${h.zone} has ${shape.length} members, the pin lists ${h.members.length}`);
    const members = h.members.map((pm, i) => pinnedMember(h.id, pm, shape[i]!, i, pins, cards));
    for (const m of members) if (m.card && h.home && m.card.home !== h.home) fail(`${h.id}: ${m.id}'s card says home ${m.card.home}, the pin says ${h.home}`);
    out.push({ id: h.id, type: h.type, zone: h.zone, pinned: true, home: h.home, surname: h.surname, members, years: members.some(m => m.card) ? null : undefined });
    pinnedCount.set(`${h.type}|${h.zone}`, (pinnedCount.get(`${h.type}|${h.zone}`) ?? 0) + 1);
  }
  for (const type of HOUSEHOLD_TYPES) for (const zone of CENSUS_ZONES) {
    const want = TYPES_BY_ZONE[type][zone] ?? 0, pinned = pinnedCount.get(`${type}|${zone}`) ?? 0;
    if (pinned > want) fail(`${pinned} pinned type ${type} households in ${zone}; A.1.2 has ${want}`);
    for (let n = 1; n <= want - pinned; n++) {
      const id = `${ZONE_SHORT[zone]}_${type.toLowerCase()}${String(n).padStart(2, "0")}`;
      const members = shapeOf(type, zone).map((s, i): Draft => ({
        slot: `m${i + 1}`, role: s.role, band: s.band, minor: s.minor === "under_five" ? "under_five" : null, kind: "anonymous", id: null, name: null,
        archetype: undefined, presentationFixed: false, saturday: null, surname: undefined, firstNames: [], birthday: null,
      }));
      out.push({ id, type, zone, pinned: false, home: null, surname: undefined, members, years: undefined });
    }
  }
  return out;
}

function pinnedMember(household: string, pm: PinMember, shape: ReturnType<typeof shapeOf>[number], i: number, pins: Pins, cards: ReadonlyMap<string, CensusCard>): Draft {
  const base: Draft = {
    slot: `m${i + 1}`, role: shape.role, band: shape.band, minor: shape.minor === "under_five" ? "under_five" : null, kind: "anonymous", id: null, name: null,
    archetype: undefined, presentationFixed: false, saturday: null, surname: undefined, firstNames: [], birthday: null,
  };
  const checkBand = (age: number, who: string) => {
    const band = bandOf(age);
    if (shape.band === "minor") {
      if (band !== "child" && band !== "teen") fail(`${household}: ${who} (${age}) can't fill a minor's slot`);
      const kind = bandOfMinorAge(age);
      if (shape.minor === "under_five" ? kind !== "under_five" : kind === "under_five") fail(`${household}: ${who} (${age}) doesn't fit slot ${base.slot}`);
      return kind;
    }
    if (band !== shape.band) fail(`${household}: ${who} is ${age} (${band}), slot ${base.slot} is ${shape.band}`);
    return null;
  };
  if ("card" in pm) {
    const card = cards.get(pm.card) ?? fail(`${household}: no card for ${pm.card}`);
    const core = CORE_HOMED.includes(card.id);
    const person = pins.people[card.id];
    if (!core && !(person && !isNamedPin(person))) fail(`${household}: ${card.id} has a card but isn't core cast or a carded person in pins.people`);
    const minor = checkBand(card.age, card.id);
    return {
      ...base, kind: core ? "core" : "carded", id: card.id, name: card.name, minor: minor ?? base.minor,
      archetype: core ? null : (person as { archetype: ArchetypeId }).archetype,
      presentation: presentationOfPronouns(card.pronouns), presentationFixed: true, age: card.age, ageFixed: [card.age, card.age],
      surname: surnameOf(card.name), card,
    };
  }
  if ("person" in pm) {
    const person = pins.people[pm.person] ?? fail(`${household}: no person ${pm.person} in pins.people`);
    if (!isNamedPin(person)) fail(`${household}: ${pm.person} is carded; list them as { card: ${pm.person} }`);
    const [lo, hi] = Array.isArray(person.age) ? person.age : [person.age, person.age];
    const minor = checkBand(lo, pm.person);
    if (bandOf(hi) !== bandOf(lo)) fail(`${pm.person}: the age range ${lo}-${hi} crosses a band`);
    return {
      ...base, kind: "named", id: pm.person, name: person.name, minor: minor ?? base.minor, archetype: person.archetype,
      presentation: person.presentation, presentationFixed: true, ageFixed: [lo, hi], ...(lo === hi ? { age: lo } : {}),
      surname: surnameOf(person.name), twin: person.twin_of,
    };
  }
  const s = pm.slot;
  if (s.band && shape.band !== "minor" && s.band !== shape.band) fail(`${household}: slot ${base.slot} is ${shape.band}, the pin says ${s.band}`);
  return {
    ...base, archetype: s.archetype, ...(s.presentation ? { presentation: s.presentation, presentationFixed: true } : {}),
    surname: s.surname === undefined ? undefined : s.surname, note: s.note,
  };
}

/** "Barnaby \"Barney\" Dunmore" → Dunmore; "Rev. Alma Cobb" → Cobb. */
const surnameOf = (name: string): string => name.replace(/"[^"]*"\s*/g, "").trim().split(/\s+/).at(-1)!;
const firstNameOf = (name: string): string => name.replace(/^(Rev\.|Captain|Dr\.)\s+/, "").replace(/"[^"]*"\s*/g, "").trim().split(/\s+/)[0]!;

// ── 2. Minors ───────────────────────────────────────────────────────────────

type Quota = Map<string, number>;
const qkey = (a: ArchetypeId, band: AgeBand) => `${a}|${band}`;

function quotaLeft(households: readonly DraftHousehold[]): Quota {
  const q: Quota = new Map();
  for (const [a, row] of Object.entries(ARCHETYPE_QUOTAS) as [ArchetypeId, readonly number[]][])
    CENSUS_BANDS.forEach((b, i) => { if (row[i]) q.set(qkey(a, b), row[i]!); });
  for (const h of households) for (const m of h.members) {
    if (m.kind === "core" || !m.archetype || (m.band === "minor" && m.minor === null)) continue;
    const k = qkey(m.archetype, memberBand(m));
    q.set(k, (q.get(k) ?? 0) - 1);
  }
  return q;
}

function assignMinors(households: DraftHousehold[], rng: SeededRng): void {
  // Under-fives and pinned minors take their archetype from the household's identity.
  for (const h of households) for (const m of h.members) {
    if (m.band !== "minor" || m.archetype !== undefined) continue;
    const identity = TYPE_IDENTITY[h.type];
    if (m.minor === "under_five") m.archetype = identity ?? fail(`${h.id}: an under-five outside J, K or M`);
  }
  const zoneNeed = new Map<string, number>();
  for (const z of CENSUS_ZONES) for (const k of ["pupil", "teen"] as const) zoneNeed.set(`${z}|${k}`, MINORS_BY_ZONE[z][k]);
  for (const z of CENSUS_ZONES) if (households.filter(h => h.zone === z).flatMap(h => h.members).filter(m => m.minor === "under_five").length !== MINORS_BY_ZONE[z].under_five)
    fail(`${z}: the household types don't hold A.1.1's ${MINORS_BY_ZONE[z].under_five} under-fives`);
  const open: { h: DraftHousehold; m: Draft }[] = [];
  for (const h of households) for (const m of h.members) {
    if (m.band !== "minor" || m.minor === "under_five") continue;
    if (m.minor) { zoneNeed.set(`${h.zone}|${m.minor}`, zoneNeed.get(`${h.zone}|${m.minor}`)! - 1); continue; }
    open.push({ h, m });
  }
  const q = quotaLeft(households);
  const options = (h: DraftHousehold): [MinorKind, ArchetypeId][] => h.type === "M"
    ? [["pupil", "single_parent"], ["teen", "single_parent"]]
    : [["pupil", "school_family"], ["teen", "school_family"], ["teen", "apprentice"]];
  const order = shuffle(open, rng);
  const pick: [MinorKind, ArchetypeId][] = [];
  const minorQuota = (a: ArchetypeId) => (q.get(qkey(a, "child")) ?? 0) + (q.get(qkey(a, "teen")) ?? 0);
  // Every slot left must be filled: each zone's pupils and teens, and each archetype's children and teens, exactly.
  const closes = (from: number): boolean => {
    const rest = order.slice(from);
    for (const z of CENSUS_ZONES) if ((zoneNeed.get(`${z}|pupil`) ?? 0) + (zoneNeed.get(`${z}|teen`) ?? 0) !== rest.filter(o => o.h.zone === z).length) return false;
    const m = rest.filter(o => o.h.type === "M").length;
    return minorQuota("single_parent") === m && minorQuota("school_family") + minorQuota("apprentice") === rest.length - m
      && [...zoneNeed.values()].every(v => v >= 0);
  };
  if (!closes(0)) fail("the school-age minors' slots can't hold A.1.1's pupils and teens and A.1.5's quotas");
  const go = (i: number): boolean => {
    if (i === order.length) return [...zoneNeed.values()].every(v => v === 0) && [...q.entries()].every(([k, v]) => !(k.endsWith("|child") || k.endsWith("|teen")) || v === 0);
    if (!closes(i)) return false;
    const { h } = order[i]!;
    for (const [kind, a] of shuffle(options(h), rng)) {
      const zk = `${h.zone}|${kind}`, ak = qkey(a, kind === "teen" ? "teen" : "child");
      if ((zoneNeed.get(zk) ?? 0) <= 0 || (q.get(ak) ?? 0) <= 0) continue;
      // A school family stays one: at most one teen apprentice in an L or N household.
      if (a === "apprentice" && order.some((o, j) => j < i && o.h === h && pick[j]![1] === "apprentice")) continue;
      zoneNeed.set(zk, zoneNeed.get(zk)! - 1); q.set(ak, q.get(ak)! - 1); pick[i] = [kind, a];
      if (go(i + 1)) return true;
      zoneNeed.set(zk, zoneNeed.get(zk)! + 1); q.set(ak, q.get(ak)! + 1);
    }
    return false;
  };
  if (!go(0)) fail("no way to split the school-age minors between pupils and teens that closes A.1.1 and A.1.5");
  order.forEach(({ m }, i) => { m.minor = pick[i]![0]; m.archetype = pick[i]![1]; });
}

// ── 3. Archetypes ───────────────────────────────────────────────────────────

/** A.3.3: who can live alone, who in a couple, as siblings or flatmates, and how likely each shape is. */
const SOLO: Readonly<Partial<Record<ArchetypeId, number>>> = {
  young_creative: 0.6, apprentice: 1, drifter: 0.85, remote_craftsperson: 0.6, shop_founder: 0.6, cook_baker: 0.85, builder: 0.6,
  fisher: 0.55, market_gardener: 0.6, mill_hand: 0.6, widowed_elder: 0.9, retired_keeper: 0.7, retired_organizer: 0.6,
  birdwatcher: 0.85, retired_magician: 0.7, cartographer: 0.85, radio_tinkerer: 0.6,
};
const PAIR: Readonly<Partial<Record<ArchetypeId, number>>> = {
  retired_couple: 1, young_creative: 0.4, remote_craftsperson: 0.4, shop_founder: 0.4, cook_baker: 0.15, builder: 0.4, fisher: 0.25,
  market_gardener: 0.4, mill_hand: 0.4, retired_keeper: 0.3, retired_organizer: 0.4, birdwatcher: 0.15, retired_magician: 0.3,
  cartographer: 0.15, radio_tinkerer: 0.4, drifter: 0.15,
};
/**
 * Couples of two archetypes: allowed, since A.1.5's quotas need a few (three young couples from nine young adults of six
 * archetypes), but rare while a same-archetype couple is left. An adult with an elder parent: common.
 */
const MIXED_PAIR = 0.003, MIXED_PARENT = 0.6;
/** Zone leanings (Kasey, M-03): fishers to the Wharf, mill hands to Millbrook; the oddballs where A.1.5 puts them. */
const LEAN: Readonly<Partial<Record<ArchetypeId, Readonly<Partial<Record<CensusZone, number>>>>>> = {
  fisher: { wharf: 10, market_row: 1, old_quarter: 0.4, millbrook: 0.15, station_hill: 0.15, commons: 0.3 },
  mill_hand: { millbrook: 10, station_hill: 1.5, old_quarter: 0.3, market_row: 0.3, wharf: 0.15, commons: 0.15 },
  market_gardener: { commons: 3, millbrook: 1.5 },
  birdwatcher: { commons: 3, wharf: 1.5 },
  retired_keeper: { wharf: 3, station_hill: 2 },
  cartographer: { old_quarter: 1.5 },
  young_creative: { market_row: 1.5, old_quarter: 1.5 },
  drifter: { wharf: 1.5, market_row: 1.5 },
  cook_baker: { market_row: 1.5 },
};
const lean = (a: ArchetypeId, zone: CensusZone): number => LEAN[a]?.[zone] ?? 1;

/** A household's members still without an archetype (one, or a pair). */
interface Unit { h: DraftHousehold; members: Draft[] }


/** Can two people of these archetypes be this pair (V04's couple gap, a sibling's, a parent's 18 years)? */
function pairAgesFit(h: DraftHousehold, [m1, m2]: readonly Draft[], a: ArchetypeId, b: ArchetypeId): boolean {
  const [l1, h1] = rangeFor({ ...m1!, archetype: a }, h), [l2, h2] = rangeFor({ ...m2!, archetype: b }, h);
  if (m2!.role === "parent" || m2!.role === "grandparent") return h2 >= l1 + 18 && l2 <= h1 + (h.type === "O" ? 65 : 45);
  const gap = m2!.role === "sibling" ? 12 : 25;
  return l2 <= h1 + gap && l1 - gap <= h2;
}

function assignArchetypes(households: DraftHousehold[], rng: SeededRng): void {
  for (const h of households) {
    const identity = TYPE_IDENTITY[h.type];
    if (identity) for (const m of h.members) if (m.archetype === undefined && m.band !== "minor") m.archetype = identity;
  }
  const q = quotaLeft(households);
  const units: Unit[] = [];
  for (const h of households) {
    const open = h.members.filter(m => m.archetype === undefined);
    if (!open.length) continue;
    if (open.length > 2) fail(`${h.id}: ${open.length} members without an archetype`);
    units.push({ h, members: open });
  }
  // Remaining quota per band must equal the open slots per band.
  for (const b of CENSUS_BANDS) {
    const slots = units.reduce((s, u) => s + u.members.filter(m => memberBand(m) === b).length, 0);
    const quota = [...q.entries()].filter(([k]) => k.endsWith(`|${b}`)).reduce((s, [, v]) => s + v, 0);
    if (slots !== quota) fail(`${b}: ${slots} open slots but ${quota} people left in A.1.5's quotas`);
  }
  const take = (u: Unit, arch: readonly ArchetypeId[]) => arch.forEach((a, i) => {
    const k = qkey(a, memberBand(u.members[i]!));
    if ((q.get(k) ?? 0) <= 0) fail(`${u.h.id}: no ${k} left`);
    q.set(k, q.get(k)! - 1);
    u.members[i]!.archetype = a;
  });
  const left = (k: string) => q.get(k) ?? 0;
  const pairs = units.filter(u => u.members.length === 2), singles = units.filter(u => u.members.length === 1);
  // 1. Retired couples are couples (A.3.3): A.1.5's four adults are the younger partners of an elder (type C), the rest
  //    elder couples (type B). Which C and B households they are is the seed's.
  const rcAdults = left(qkey("retired_couple", "adult")), rcElders = left(qkey("retired_couple", "elder"));
  const cs = shuffle(pairs.filter(u => u.h.type === "C"), rng), bs = shuffle(pairs.filter(u => u.h.type === "B"), rng);
  const bCouples = (rcElders - rcAdults) / 2;
  if (rcAdults > cs.length || !Number.isInteger(bCouples) || bCouples > bs.length) fail(`A.1.5's retired couples (${rcAdults} adults, ${rcElders} elders) don't fit the C and B households`);
  for (const u of [...cs.slice(0, rcAdults), ...bs.slice(0, bCouples)]) take(u, ["retired_couple", "retired_couple"]);
  // 2. The other pairs, one archetype for both where the quota allows (A.3.3), two where it doesn't, leaning by zone.
  const able = (b: AgeBand) => [...q.entries()].filter(([k, v]) => v > 0 && k.endsWith(`|${b}`)).map(([k]) => k.split("|")[0] as ArchetypeId).filter(a => a !== "retired_couple");
  for (const u of shuffle(pairs.filter(u => u.members.every(m => m.archetype === undefined)), rng)) {
    const [m1, m2] = u.members as [Draft, Draft];
    const parent = m2.role === "parent" || m2.role === "grandparent";
    const options: (readonly [readonly [ArchetypeId, ArchetypeId], number])[] = [];
    for (const a of able(memberBand(m1))) for (const b of able(memberBand(m2))) {
      const same = a === b;
      const k1 = qkey(a, memberBand(m1)), k2 = qkey(b, memberBand(m2));
      if (same && k1 === k2 && left(k1) < 2) continue;
      // Widowed elders live alone, or with an adult child (A.3.3).
      if (!parent && (a === "widowed_elder" || b === "widowed_elder")) continue;
      if (!pairAgesFit(u.h, u.members, a, b)) continue;
      const w = same ? (PAIR[a] ?? 0) : parent ? MIXED_PARENT * (SOLO[a] ?? 0.2) * (b === "widowed_elder" ? 2 : SOLO[b] ?? 0.2) : MIXED_PAIR;
      if (w <= 0) continue;
      options.push([[a, b], w * left(k1) * left(k2) * Math.sqrt(lean(a, u.h.zone) * lean(b, u.h.zone))]);
    }
    const pick = rng.weighted(options) ?? fail(`${u.h.id}: no pair of archetypes fits ${u.members.map(memberBand).join(" + ")}`);
    take(u, pick);
  }
  // 3. Everyone living alone (and the flatmates) takes what's left of their band, leaning by zone.
  for (const u of shuffle(singles, rng)) {
    const band = memberBand(u.members[0]!);
    const options = able(band).map(a => [a, (SOLO[a] ?? 0) * left(qkey(a, band)) * lean(a, u.h.zone)] as const);
    const pick = rng.weighted(options) ?? fail(`${u.h.id}: nobody left in A.1.5's ${band} quotas who lives alone`);
    take(u, [pick]);
  }
  for (const [k, v] of q) if (v !== 0) fail(`A.1.5 ${k}: ${v} left over`);
}

// ── 4. Ages ─────────────────────────────────────────────────────────────────

/** GDD-GAP: A.2's range for a role (A.3.3's shapes: a school family's grandparent is 60–78), cut to the band. */
function rangeFor(m: Draft, h: DraftHousehold): [number, number] {
  const band = memberBand(m);
  const [bl, bh] = band === "elder" ? [60, 90] : BAND_AGES[band];
  if (m.minor === "under_five") return [0, 4];
  if (m.minor === "pupil") return [5, 12];
  if (m.minor === "teen") return m.archetype === "apprentice" ? [15, 17] : [13, 17];
  const a = m.archetype ? ARCHETYPE_BY_ID.get(m.archetype) : undefined;
  let [lo, hi] = a ? a.age : [bl, bh];
  if (m.role === "grandparent" && h.type === "N") [lo, hi] = [60, 78];
  const l = Math.max(lo, bl), u = Math.min(hi, bh);
  if (l <= u) return [l, u];
  // GDD-GAP: A.1.5 puts some people outside their archetype's A.2 range (four adults in retired_couple, whose range is
  // 60–78): they take the five years of their band nearest it.
  return hi < bl ? [bl, Math.min(bh, bl + 4)] : [Math.max(bl, bh - 4), bh];
}

function assignAges(households: DraftHousehold[], rng: SeededRng): void {
  // Pupils: exactly A.1.1's ages, siblings never the same age (no generated twins).
  const pupils = households.flatMap(h => h.members.filter(m => m.minor === "pupil").map(m => ({ h, m })));
  const pool = [...PUPIL_AGES];
  for (const { m } of pupils) if (m.age !== undefined) {
    const i = pool.indexOf(m.age);
    if (i < 0) fail(`a pinned pupil is ${m.age}, not one of A.1.1's ages`);
    pool.splice(i, 1);
  }
  const free = pupils.filter(p => p.m.age === undefined);
  if (free.length !== pool.length) fail(`${free.length} pupils for ${pool.length} pupil ages`);
  for (let tries = 0; ; tries++) {
    if (tries > 500) fail("no way to give the pupils A.1.1's ages without two siblings of one age");
    const ages = shuffle(pool, rng);
    const ok = free.every((p, i) => !p.h.members.some(o => o !== p.m && o.minor === "pupil" && (o.age ?? ages[free.findIndex(f => f.m === o)]) === ages[i]));
    if (!ok) continue;
    free.forEach((p, i) => { p.m.age = ages[i]!; p.m.range = [5, 12]; });
    break;
  }
  for (const h of households) {
    const taken = new Set(h.members.filter(m => m.age !== undefined && m.band === "minor").map(m => m.age!));
    for (const m of h.members) {
      if (m.band !== "minor") continue;
      const [lo, hi] = rangeFor(m, h);
      m.range ??= [lo, hi];
      if (m.age === undefined) {
        const options = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter(a => !taken.has(a));
        m.age = rng.pick(options.length ? options : [lo]);
        taken.add(m.age);
      }
    }
    const kids = h.members.filter(m => m.band === "minor").map(m => m.age!);
    const oldestKid = kids.length ? Math.max(...kids) : -Infinity;
    const head = h.members[0]!;
    const draw = (m: Draft, lo: number, hi: number, near?: number, spread = 5) => {
      if (m.ageFixed) {
        const [fl, fh] = [Math.max(m.ageFixed[0], lo), Math.min(m.ageFixed[1], hi)];
        if (m.age !== undefined) { m.range = [m.ageFixed[0], m.ageFixed[1]]; return; }
        if (fl > fh) fail(`${h.id}/${m.slot}: the pinned age ${m.ageFixed.join("-")} doesn't fit ${lo}-${hi}`);
        m.age = rng.int(fl, fh); m.range = [fl, fh];
        return;
      }
      if (lo > hi) fail(`${h.id}/${m.slot} (${m.archetype}): no age fits ${lo}-${hi}`);
      m.range = [lo, hi];
      if (near === undefined) { m.age = rng.int(lo, hi); return; }
      // A partner's age clusters round the head's (most couples within a few years).
      for (let t = 0; t < 20; t++) {
        const a = Math.round(near + (rng.next() + rng.next() + rng.next() - 1.5) * 2 * spread);
        if (a >= lo && a <= hi) { m.age = a; return; }
      }
      m.age = Math.min(hi, Math.max(lo, Math.round(near)));
    };
    // The head: old enough for the children and young enough for their own parent (V04: 18+ years either way).
    const [hl, hh] = rangeFor(head, h);
    const elderMember = h.members.find(m => m.role === "parent" || m.role === "grandparent");
    const elderHi = elderMember ? elderMember.age ?? elderMember.ageFixed?.[1] ?? rangeFor(elderMember, h)[1] : undefined;
    draw(head, Math.max(hl, h.members.slice(1).some(m => m.band === "minor") ? oldestKid + 18 : hl), Math.min(hh, elderHi !== undefined ? elderHi - 18 : hh));
    for (const m of h.members.slice(1)) {
      if (m.band === "minor") continue;
      const [lo, hi] = rangeFor(m, h);
      const headAge = head.age!;
      if (m.role === "partner") draw(m, Math.max(lo, headAge - 25, kids.length ? oldestKid + 18 : lo), Math.min(hi, headAge + 25), headAge, 4);
      else if (m.role === "sibling") draw(m, Math.max(lo, headAge - 12), Math.min(hi, headAge + 12), headAge, 5);
      else if (m.role === "parent" || m.role === "grandparent") draw(m, Math.max(lo, headAge + 18), Math.min(hi, headAge + (h.type === "O" ? 65 : 45)), headAge + 28, 6);
      else draw(m, lo, hi);
    }
    for (const m of h.members) if (m.range && m.age !== undefined && (m.age < m.range[0] || m.age > m.range[1])) fail(`${h.id}/${m.slot}: age ${m.age} outside ${m.range.join("-")}`);
  }
}

// ── 5. Work ─────────────────────────────────────────────────────────────────

const ADULT_BAND_INDEX: Readonly<Partial<Record<AgeBand, number>>> = { young_adult: 0, adult: 1, elder: 2 };

/** GDD-GAP: A.1.4 gives the rows' sizes, not who fits them. Order: the rows most tied to one archetype first. */
const ROW_ORDER = [16, 17, 9, 8, 11, 4, 20, 14, 18, 10, 5, 6, 7, 3, 1, 15, 24, 19];
const ZONE_ROW_BONUS: Readonly<Record<number, Readonly<Partial<Record<CensusZone, number>>>>> = {
  8: { wharf: 2 }, 9: { wharf: 2 }, 10: { wharf: 2 }, 11: { wharf: 2 }, 3: { millbrook: 1.5 }, 14: { commons: 2.5 },
  20: { millbrook: 1, wharf: 1 }, 4: { market_row: 1 }, 5: { market_row: 1 }, 6: { market_row: 1 }, 7: { market_row: 1 }, 1: { old_quarter: 1 },
};

function assignWork(households: DraftHousehold[], pins: Pins, rng: SeededRng): void {
  const all = households.flatMap(h => h.members.map(m => ({ h, m })));
  const jobsLeft = new Map(JOB_ROWS.map(r => [r.row, rowJobs(r)]));
  const bandsLeft = new Map(JOB_ROWS.map(r => [r.row, [...r.bands]]));
  const status = new Map<string, number[]>(Object.entries(STATUS_TABLE).map(([k, v]) => [k, [...v]]));
  const take = (m: Draft, row: number, title?: string, workplace?: string) => {
    const left = bandsLeft.get(row)!, bi = ADULT_BAND_INDEX[memberBand(m)];
    if (bi === undefined || left[bi]! <= 0) fail(`${m.id ?? m.slot}: no ${memberBand(m)} job left in A.1.4 row ${row}`);
    left[bi]!--;
    // The row's job by that title if it lists one, else its next job.
    const jobs = jobsLeft.get(row)!;
    const named = title === undefined ? -1 : jobs.findIndex(j => j.title === title);
    const job = jobs.splice(Math.max(0, named), 1)[0]!;
    m.employment = "employed";
    m.job = { row, title: title ?? job.title, workplace: workplace ?? job.place };
    status.get("employed")![bi]!--;
  };
  const setStatus = (m: Draft, s: "out_of_work" | "carer" | "retired" | "unable") => {
    const bi = ADULT_BAND_INDEX[memberBand(m)]!;
    if (status.get(s)![bi]! <= 0) fail(`${m.id ?? m.slot}: A.1.4 has no more ${memberBand(m)} ${s}`);
    status.get(s)![bi]!--;
    m.employment = s; m.job = null;
  };
  // Minors.
  for (const { m } of all) if (m.band === "minor") { m.employment = m.minor === "under_five" ? "under_five" : m.minor === "pupil" ? "pupil" : "lessons"; m.job = null; }
  // The core cast, the carded and the named: their own rows.
  for (const { m } of all) {
    if (m.band === "minor") continue;
    if (m.kind === "core") {
      const j = CORE_JOBS[m.id!] ?? fail(`no A.1.4 place for core ${m.id}`);
      if (j === "retired") setStatus(m, "retired");
      else if (j !== "pupil") take(m, j.row, j.title, j.workplace);
      continue;
    }
    const pin = m.id ? pins.people[m.id] : undefined;
    if (pin?.job) take(m, pin.job.row, pin.job.title, pin.job.workplace);
  }
  // GDD-GAP: §12.4 calls Raman retired; the other named elders with no job (Ilona, Quist, Marchetti, Frane) are retired
  // too (A.2: widowed elders, birdwatchers, magicians and tinkerers keep hobbies, not posts).
  for (const { m } of all) if (m.kind === "named" && !m.employment && memberBand(m) === "elder") setStatus(m, "retired");
  const open = (band: AgeBand) => all.filter(({ m }) => memberBand(m) === band && m.band !== "minor" && !m.employment);
  // 1. Out of work: A.1.5's nine adult mill hands, Millbrook's first.
  const millHands = open("adult").filter(({ m }) => m.archetype === "mill_hand");
  if (millHands.length < OUT_OF_WORK_MILL_HANDS) fail(`only ${millHands.length} adult mill hands for A.1.5's nine out of work`);
  for (const { m } of weightedOrder(millHands, ({ h }) => (h.zone === "millbrook" ? 3 : 1), rng).slice(0, OUT_OF_WORK_MILL_HANDS)) setStatus(m, "out_of_work");
  // 2. Carers: the young adults are full-time parents (A.1.1: "three are full-time parents"), one per household.
  const caring = new Set<string>();
  const carers = (band: AgeBand, n: number, ok: (h: DraftHousehold, m: Draft) => boolean, weight: (h: DraftHousehold) => number) => {
    const pool = open(band).filter(({ h, m }) => ok(h, m));
    let k = 0;
    for (const { h, m } of weightedOrder(pool, ({ h }) => weight(h), rng)) {
      if (k >= n) break;
      if (caring.has(h.id)) continue;
      caring.add(h.id); setStatus(m, "carer"); k++;
    }
    if (k < n) fail(`only ${k} of ${n} ${band} carers placed`);
  };
  carers("young_adult", STATUS_TABLE.carer[0], h => h.type === "J" || h.type === "K", h => (h.type === "J" ? 3 : 1));
  // Adults care for children or a parent (A.1.4): households with minors or an elder.
  carers("adult", STATUS_TABLE.carer[1], h => ["C", "L", "M", "N", "P"].includes(h.type), h => ({ P: 4, N: 3, C: 2, L: 2, M: 1 } as Record<string, number>)[h.type] ?? 1);
  // 3. The job rows, most specific first: the best-suited person of each band, one commuter per household at most.
  const commuting = new Set<string>();
  for (const rowNo of ROW_ORDER) {
    const row = JOB_ROWS.find(r => r.row === rowNo)!;
    (["young_adult", "adult", "elder"] as const).forEach((band, bi) => {
      let n = bandsLeft.get(rowNo)![bi]!;
      while (n-- > 0) {
        const pool = open(band).filter(({ h }) => rowNo !== COMMUTER_ROW || (!commuting.has(h.id) && h.type !== "K" && h.type !== "M"));
        if (!pool.length) fail(`no ${band} left for A.1.4 row ${rowNo}`);
        const score = ({ h, m }: { h: DraftHousehold; m: Draft }) => {
          const pref = row.prefer.indexOf(m.archetype as ArchetypeId);
          return (pref >= 0 ? 4 - pref * 0.4 : 0) + (ZONE_ROW_BONUS[rowNo]?.[h.zone] ?? 0) + rng.next() * 1.5;
        };
        const best = pool.map(p => ({ p, s: score(p) })).sort((a, b) => b.s - a.s)[0]!.p;
        if (rowNo === COMMUTER_ROW) commuting.add(best.h.id);
        take(best.m, rowNo);
      }
    });
  }
  // 4. The rest: young adults out of work (A.1.4: mostly ex-mill and ex-cannery), adults unable to work, elders retired.
  for (const { m } of open("young_adult")) setStatus(m, "out_of_work");
  for (const { m } of open("adult")) setStatus(m, "unable");
  for (const { m } of open("elder")) setStatus(m, "retired");
  for (const [k, v] of status) if (v.some(x => x !== 0)) fail(`A.1.4's ${k} doesn't close: ${v.join("/")} left`);
  for (const [row, v] of bandsLeft) if (v.some(x => x !== 0)) fail(`A.1.4 row ${row} doesn't close: ${v.join("/")} left`);
  // Saturday jobs (A.1.4: four teens), apprentices first, with a master's workplace (A.2 apprentice).
  const masters = ["market_row.bakery", "millbrook.kasimir_workshop", "wharf.boathouse", "old_quarter.lantern_office", "wharf.fish_market", "market_row.general_store"];
  const teens = all.filter(({ m }) => m.minor === "teen");
  for (const [i, { m }] of weightedOrder(teens, ({ m }) => (m.archetype === "apprentice" ? 20 : 1), rng).slice(0, TEEN_SATURDAY_JOBS).entries())
    m.saturday = masters[i % masters.length]!;
}

// ── 6. Presentation ─────────────────────────────────────────────────────────

function assignPresentation(households: DraftHousehold[], rng: SeededRng): void {
  for (const h of households) for (const m of h.members) {
    if (m.presentation) continue;
    const w = m.band === "minor" ? CHILD_PRESENTATION : ARCHETYPE_BY_ID.get(m.archetype!)!.presentation;
    m.presentation = rng.weighted([["f", w.f], ["m", w.m], ["a", w.a]] as const) ?? "f";
  }
}

// ── 7. Homes ────────────────────────────────────────────────────────────────

function assignHomes(households: DraftHousehold[], homes: HomeRegistry, rng: SeededRng): void {
  const taken = new Set<string>();
  for (const h of households) {
    if (!h.home) continue;
    const entry = homes.get(h.home) ?? fail(`${h.id}: home ${h.home} isn't in homes.yaml`);
    if (homeZone(h.home) !== h.zone) fail(`${h.id}: home ${h.home} isn't in ${h.zone}`);
    if (isVacantHome(h.home)) fail(`${h.id}: ${h.home} is vacant stock`);
    if (taken.has(h.home)) fail(`two households in ${h.home}`);
    if (entry.beds < bedsNeeded(h.members.length)) fail(`${h.id}: ${h.home} has ${entry.beds} beds for ${h.members.length}`);
    taken.add(h.home);
  }
  for (const zone of CENSUS_ZONES) {
    const free = [...homes.keys()].filter(id => homeZone(id) === zone && !isVacantHome(id) && !taken.has(id));
    const need = households.filter(h => h.zone === zone && !h.home);
    if (free.length !== need.length) fail(`${zone}: ${need.length} households for ${free.length} free homes (homes.yaml)`);
    const wantsGround = (h: DraftHousehold) => h.members.every(m => memberBand(m) === "elder") || h.members.some(m => m.archetype === "retired_couple" || m.archetype === "widowed_elder");
    const wantsBench = (h: DraftHousehold) => h.members.some(m => m.archetype === "radio_tinkerer") ? 2 : h.members.some(m => m.archetype === "remote_craftsperson" || m.archetype === "builder") ? 1 : 0;
    const order = shuffle(need, rng).sort((a, b) => bedsNeeded(b.members.length) - bedsNeeded(a.members.length) || wantsBench(b) - wantsBench(a) || Number(wantsGround(b)) - Number(wantsGround(a)));
    const left = new Set(free);
    for (const h of order) {
      const n = bedsNeeded(h.members.length);
      const scored = [...left].map(id => {
        const e = homes.get(id)!;
        if (e.beds < n) return null;
        let s = -(e.beds - n) * 1.5 + rng.next();
        if (wantsGround(h)) s += e.ground_floor ? 3 : -2;
        else if (e.ground_floor) s -= 0.5;
        s += e.bench ? wantsBench(h) * 3 - 0.3 : -wantsBench(h) * 3;
        return { id, s };
      }).filter((x): x is { id: string; s: number } => x !== null).sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));
      const best = scored[0] ?? fail(`${h.id}: no home in ${zone} with ${n} beds`);
      h.home = best.id; left.delete(best.id);
    }
  }
}

// ── 9. Names ────────────────────────────────────────────────────────────────

function assignNames(households: DraftHousehold[], cards: ReadonlyMap<string, CensusCard>, rng: SeededRng): void {
  const usedSurnames = new Set<string>([...RESERVED_FAMILY_NAMES, ...[...cards.values()].map(c => surnameOf(c.name))].map(foldName));
  for (const h of households) {
    if (typeof h.surname === "string") usedSurnames.add(foldName(h.surname));
    for (const m of h.members) if (typeof m.surname === "string") usedSurnames.add(foldName(m.surname));
  }
  const bank = shuffle(FAMILY_NAMES, rng);
  const fresh = (): string => {
    const s = bank.find(n => !usedSurnames.has(foldName(n))) ?? fail("the family-name bank ran out");
    usedSurnames.add(foldName(s));
    return s;
  };
  for (const h of households) {
    if (h.surname === undefined) h.surname = fresh();
    for (const m of h.members) {
      if (m.surname !== undefined) continue;
      if (h.surname === null) { m.surname = fresh(); continue; }
      // A.3.6's "same_surname": partners keep their own a third of the time; flatmates always.
      if (m.role === "flatmate" || (m.role === "partner" && rng.chance(1 / 3))) m.surname = fresh();
      else m.surname = h.surname;
    }
  }
  // First-name options. V03: never a core or reserved name, never one a resident already has, never shared inside a
  // household, at most two people town-wide whose first option is the same (so the default picks are clean).
  const held = new Set<string>([...RESERVED_FIRST_NAMES.map(foldName), ...[...cards.values()].map(c => foldName(firstNameOf(c.name)))]);
  for (const h of households) for (const m of h.members) if (m.name) held.add(foldName(firstNameOf(m.name)));
  const famous = new Set(FAMOUS_NAMES.map(foldName));
  const offered = new Map<string, number>(), first = new Map<string, number>();
  const ordered = shuffle(households.flatMap(h => h.members.filter(m => m.kind === "anonymous").map(m => ({ h, m }))), rng);
  for (const { h, m } of ordered) {
    const mates = new Set(h.members.flatMap(o => o.firstNames.map(foldName)));
    const pool = FIRST_NAMES[m.presentation!].filter(n => !held.has(foldName(n)) && !mates.has(foldName(n)) && !famous.has(foldName(`${n} ${m.surname}`)));
    const jitter = new Map(pool.map(n => [n, rng.next()]));
    const byUse = [...pool].sort((a, b) => (offered.get(a) ?? 0) - (offered.get(b) ?? 0) || jitter.get(a)! - jitter.get(b)!);
    const lead = [...pool].sort((a, b) => (first.get(a) ?? 0) - (first.get(b) ?? 0) || (offered.get(a) ?? 0) - (offered.get(b) ?? 0) || jitter.get(a)! - jitter.get(b)!)[0];
    if (!lead || (first.get(lead) ?? 0) >= 2) fail(`no first name left for ${h.id}/${m.slot}`);
    const options = [lead, ...byUse.filter(n => n !== lead).slice(0, 5)];
    if (options.length < 6) fail(`only ${options.length} first names for ${h.id}/${m.slot}`);
    m.firstNames = options;
    first.set(lead, (first.get(lead) ?? 0) + 1);
    for (const n of options) offered.set(n, (offered.get(n) ?? 0) + 1);
  }
}

// ── 10. Birthdays ───────────────────────────────────────────────────────────

/** GDD-GAP: A.1 gives no birthdays. On §3.2's 100-day calendar, spread evenly: every day one, then a second, at most two. */
function assignBirthdays(households: DraftHousehold[], rng: SeededRng): void {
  const people = households.flatMap(h => h.members.filter(m => m.kind !== "core"));
  const slots = [...shuffle(Array.from({ length: 100 }, (_, i) => i + 1), rng), ...shuffle(Array.from({ length: 100 }, (_, i) => i + 1), rng)];
  if (people.length > slots.length) fail(`${people.length} birthdays for 200 days' slots`);
  const byId = new Map(people.filter(m => m.id).map(m => [m.id!, m]));
  for (const m of people) {
    if (m.birthday !== null) continue;
    const twin = m.twin ? byId.get(m.twin) : undefined;
    if (twin) {
      // Twins share a day with both slots free.
      const day = slots.find((d, i) => slots.indexOf(d, i + 1) >= 0)!;
      slots.splice(slots.indexOf(day), 1); slots.splice(slots.indexOf(day), 1);
      m.birthday = day; twin.birthday = day;
      continue;
    }
    m.birthday = slots.shift()!;
  }
}

// ── 11. Years in Monde ──────────────────────────────────────────────────────

/**
 * GDD-GAP: A.1 doesn't say how long anyone has lived here. The skeleton draws it from the household's head: a third or
 * more were born here; most of the rest came before the mill closed (14 years ago, A.4) and few since; drifters are
 * recent ("just passing through", A.2).
 */
function assignYears(households: DraftHousehold[], rng: SeededRng): void {
  for (const h of households) {
    if (h.years !== undefined) continue;
    const head = h.members[0]!;
    const age = head.age!;
    if (head.archetype === "drifter") { h.years = Math.min(age - 15, rng.int(1, 6)); continue; }
    const band = memberBand(head);
    const born = band === "elder" ? 0.45 : band === "adult" ? 0.4 : 0.3;
    if (rng.chance(born)) { h.years = age; continue; }
    const [lo, hi] = band === "elder" ? [15, Math.min(55, age - 18)] : band === "adult" ? [12, Math.min(35, age - 16)] : [1, Math.min(12, age - 16)];
    h.years = rng.int(Math.min(lo, hi), Math.max(lo, hi));
  }
}

// ── The whole skeleton ──────────────────────────────────────────────────────

/** Build the Day-1 skeleton. Throws, naming the table, when the tables can't close with these pins and homes. */
export function buildSkeleton(seed: string, pins: Pins, homes: HomeRegistry, library: readonly PortraitEntry[], cardList: readonly CensusCard[]): Day1Skeleton {
  const rng = (step: string) => SeededRng.of(seed, "census", step);
  const cards = new Map(cardList.map(c => [c.id, c]));
  for (const id of CORE_HOMED) if (!cards.has(id)) fail(`no card for core resident ${id}`);
  const households = layout(pins, cards);
  const placed = new Set(households.flatMap(h => h.members.map(m => m.id).filter(Boolean)));
  for (const id of CORE_HOMED) if (!placed.has(id)) fail(`core resident ${id} is in no pinned household`);
  for (const id of Object.keys(pins.people)) if (!placed.has(id)) fail(`pinned person ${id} is in no household`);
  assignMinors(households, rng("minors"));
  assignArchetypes(households, rng("archetypes"));
  assignAges(households, rng("ages"));
  assignWork(households, pins, rng("work"));
  assignPresentation(households, rng("presentation"));
  assignHomes(households, homes, rng("homes"));

  // 8. Portraits (D1).
  const keyOf = (h: DraftHousehold, m: Draft) => m.id ?? `${h.id}/${m.slot}`;
  const tied = new Set<string>();
  for (const c of cards.values()) for (const r of c.relationships) tied.add(r.id);
  for (const l of pins.links) {
    if (cards.has(l.a)) tied.add(l.b);
    if (cards.has(l.b)) tied.add(l.a);
  }
  const people: PortraitPerson[] = households.flatMap(h => h.members.map(m => {
    const parent = m.band === "minor" ? h.members.find(o => o.band !== "minor" && (o.role === "adult" || o.role === "partner")) : undefined;
    return {
      key: keyOf(h, m), household: h.id, zone: h.zone, kind: m.kind, band: memberBand(m), age: m.age!, presentation: m.presentation!,
      presentationFixed: m.presentationFixed, archetype: m.archetype ?? null, jobRow: m.job?.row ?? null, workplace: m.job?.workplace ?? null,
      underFive: m.minor === "under_five", cardTie: tied.has(keyOf(h, m)),
      ...(parent ? { parent: keyOf(h, parent) } : {}), ...(m.twin ? { twin: m.twin } : {}),
      ...(m.card?.look?.kind === "human" ? { look: m.card.look } : {}),
    };
  }));
  const plan = planPortraits(people, library, step => rng(`portraits:${step}`));
  for (const h of households) for (const m of h.members) {
    const k = keyOf(h, m);
    m.portrait = m.kind === "core" || m.kind === "carded" ? { source: "card", id: m.id! } : plan.choices.get(k)!;
    const p = plan.presentation.get(k);
    if (p) m.presentation = p;
  }
  // Names after portraits: an androgynous bust changes a person's presentation, and so their name bank.
  assignNames(households, cards, rng("names"));
  assignBirthdays(households, rng("birthdays"));
  assignYears(households, rng("years"));

  // 12. Links: the pins' and the cards' mirrors.
  const links: SkeletonLink[] = [
    ...pins.links.map(l => ({ ...l, source: "pin" as const })),
    ...pins.mirrors.map(mi => ({ a: mi.to, b: mi.from, tag: mi.tag, note: `${mi.from}'s card: ${mi.tag} (${mi.affinity}/${mi.trust}); ${mi.to}'s card returns it.`, source: "mirror" as const })),
  ];

  const out: SkeletonHousehold[] = households.map(h => {
    const generated = h.members.filter(m => m.kind !== "core");
    const toWrite = h.members.some(m => m.kind === "named" || m.kind === "anonymous");
    return {
      id: h.id, type: h.type, zone: h.zone, home: h.home!,
      archetype: (generated.find(m => m.role !== "child") ?? generated[0])?.archetype ?? null,
      surname: h.surname ?? null, years_in_monde: h.years ?? null, status: h.pinned ? "pinned" : "skeleton",
      members: h.members.map((m): SkeletonMember => ({
        slot: m.slot, id: m.id, name: m.name, kind: m.kind, role: m.role, band: memberBand(m), minor: m.band === "minor" ? m.minor : null,
        age: m.age!, age_range: m.range ?? [m.age!, m.age!], archetype: m.archetype ?? null, presentation: m.presentation!,
        pronoun_default: m.card ? (m.card.pronouns as Pronoun) : PRONOUN[m.presentation!], employment: m.employment!, job: m.job ?? null,
        saturday_job: m.saturday, surname: m.surname ?? null, first_names: m.firstNames, birthday: m.birthday, portrait: m.portrait!,
        ...(m.note ? { note: m.note } : {}),
      })),
      generation: toWrite ? blankGeneration() : null,
    };
  });
  return {
    version: 1, seed,
    library: { rows: library.length, assigned: [...plan.choices.values()].filter(c => c.source === "library").length, reserve: plan.reserve },
    households: out, links,
  };
}
