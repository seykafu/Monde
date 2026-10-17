// Writing the Day-1 residents' cards (MVP M-03 step 2; GDD Appendix A.1.5, A.3.6–A.3.8): one call per household with
// MODE: native, repaired where the engine can (arrivals/repair.ts), validated with the census's profile, retried with
// the errors that remain fed back, and the template card when the model can't get there. Pure and I/O-free: the
// writer (the model, through the server's census endpoint or in process) and the store (the files) are injected, so
// tools/gen-residents.ts runs it for real and censusGenerate.test.ts runs it with a fake mind.
//
// Order (Kasey, M-03): the named people's and pinned households first (A.1.5, §12.4), then zone by zone (the open boards
// first) and street by street, four households at a time. Idempotent: a household whose cards exist, or whose status
// is past skeleton, is skipped (only `regen` rewrites one), and each written household keeps the hash of its inputs so
// a later change to the skeleton is warned about.
import YAML from "yaml";
import type { ArchetypeId } from "../arrivals/archetypes";
import {
  RELATION_TAGS, assignedWorkplace, cardsFromHousehold, validateHousehold, type ArrivalHouseholdOutput, type RequiredLink,
  type ValidationContext,
} from "../arrivals/card";
import type { HouseholdDraw, MemberDraw } from "../arrivals/draw";
import { portraitById, tagsOfEntry } from "../arrivals/library";
import { NATIVE_PROMPT_VERSION, NATIVE_SYSTEM_BLOCKS, nativeMaxTokens, nativeTemplateHousehold, nativeUserMessage, type NativePromptContext } from "../arrivals/native";
import { RESERVED_FIRST_NAMES } from "../arrivals/names";
import { parseJsonObject } from "../arrivals/householdJson";
import { repairHousehold } from "../arrivals/repair";
import { hashParts } from "../arrivals/rng";
import { whimFor } from "../arrivals/whims";
import { FAMILY_TAGS } from "../friendship";
import type { PersonaCard } from "../persona";
import { CENSUS_ZONES, OPEN_BOARDS, type CensusZone } from "./day1Tables";
import { homeLabel, homeZone, type HomeRegistry } from "./homes";
import { isNamedPin, type Pins } from "./pins";
import { blankGeneration, type Day1Skeleton, type SkeletonHousehold, type SkeletonMember } from "./skeleton";

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface CensusInput {
  /** The skeleton, written to as households are drafted (statuses, generation records, the members' ids and names). */
  skeleton: Day1Skeleton;
  pins: Pins;
  homes: HomeRegistry;
  /** Registered place ids (content/places/places.yaml). */
  places: ReadonlySet<string>;
  /** The hand-written cards (content/residents/*.yaml): the core cast and the four carded people. */
  cards: readonly PersonaCard[];
  /** The Day-1 cards written so far (content/residents/day1/), by id; the run adds to it. */
  written: Map<string, PersonaCard>;
  /** V11: the gift catalog's tags (content/items.yaml). */
  giftTags: readonly string[];
  /** V16: the server's lexical filters, when the caller has them. */
  banned?: (text: string) => readonly string[];
}

/** A.3.8: two retries with the errors fed back, then a second round of three with a new whim, then the template. */
export const CENSUS_ROUNDS = 2;
export const CENSUS_ATTEMPTS_PER_ROUND = 3;
export const CENSUS_CONCURRENCY = 4;

/** The households to write, in write order: the pinned ones (named people and their kin), then by zone and street. */
export function censusOrder(sk: Day1Skeleton, homes: HomeRegistry, pins: Pins): SkeletonHousehold[] {
  const pinned = pins.households.map(p => p.id);
  const homeOrder = new Map([...homes.keys()].map((id, i) => [id, i]));
  const streetOrder = new Map<string, number>();
  for (const [id, e] of homes) if (!streetOrder.has(`${homeZone(id)}|${e.street}`)) streetOrder.set(`${homeZone(id)}|${e.street}`, streetOrder.size);
  // The open boards first: the player meets those people on Day 1.
  const zones: CensusZone[] = [...OPEN_BOARDS, ...CENSUS_ZONES.filter(z => !OPEN_BOARDS.includes(z))];
  const toWrite = sk.households.filter(h => h.generation);
  const first = pinned.map(id => toWrite.find(h => h.id === id)).filter((h): h is SkeletonHousehold => !!h);
  const rest = toWrite.filter(h => !pinned.includes(h.id)).sort((a, b) => {
    const street = (h: SkeletonHousehold) => streetOrder.get(`${h.zone}|${homes.get(h.home)?.street}`) ?? 0;
    return zones.indexOf(a.zone) - zones.indexOf(b.zone) || street(a) - street(b) || (homeOrder.get(a.home) ?? 0) - (homeOrder.get(b.home) ?? 0);
  });
  return [...first, ...rest];
}

const toWrite = (m: SkeletonMember) => m.kind === "named" || m.kind === "anonymous";
const isWritten = (h: SkeletonHousehold) => h.status === "drafted" || h.status === "curated";

/** "No. 7 Terrace Row, ground floor, room for a workbench" (homes.yaml). */
export function homeLine(homes: HomeRegistry, id: string): string {
  const e = homes.get(id);
  if (!e) return id;
  return [homeLabel(e), e.ground_floor ? "ground floor" : "upstairs", ...(e.bench ? ["room for a workbench"] : [])].join(", ");
}

/** A kin link's note as the word a household tie carries ("Twins (§12.4)." → twin); none: the roles say (A.1.2). */
const kinWord = (note: string): string | null => (/twin/i.test(note) ? "twin" : /cousin/i.test(note) ? "cousin" : /husband|wife/i.test(note) ? "spouse" : null);

interface Who { id: string; name: string; line: string }

/** Everyone with a card or a fixed id: the hand-written cards, the written Day-1 cards, the named people still to write. */
function roster(input: CensusInput): Map<string, Who> {
  const out = new Map<string, Who>();
  for (const c of input.cards) out.set(c.id, { id: c.id, name: c.name, line: c.occupation });
  for (const c of input.written.values()) out.set(c.id, { id: c.id, name: c.name, line: c.occupation });
  for (const [id, p] of Object.entries(input.pins.people)) if (isNamedPin(p) && !out.has(id)) out.set(id, { id, name: p.name, line: p.job?.title ?? p.archetype.replace(/_/g, " ") });
  return out;
}

/** The slot of a skeleton reference (`id`, or `household/slot`) inside household `h`. */
function slotIn(h: SkeletonHousehold, ref: string): string | null {
  if (ref.startsWith(`${h.id}/`)) return ref.slice(h.id.length + 1);
  return h.members.find(m => m.id === ref)?.slot ?? null;
}

/** A skeleton reference as a resident, if it is one yet (a slot in another household once its card is written). */
function resolveRef(input: CensusInput, ref: string, people: ReadonlyMap<string, Who>): Who | null {
  const slash = ref.indexOf("/");
  if (slash < 0) return people.get(ref) ?? null;
  const h = input.skeleton.households.find(x => x.id === ref.slice(0, slash));
  const m = h?.members.find(x => x.slot === ref.slice(slash + 1));
  return m?.id ? people.get(m.id) ?? null : null;
}

/**
 * The ties household `h`'s cards must make (native V14) and the kin words for ties inside it. From the skeleton's links:
 * the pins' kin, and the mirrors (a hand-written card's tie to a named person, which their card must return).
 */
export function censusLinks(input: CensusInput, h: SkeletonHousehold): { required: RequiredLink[]; ties: { a: string; b: string; word: string }[] } {
  const people = roster(input);
  const required = new Map<string, RequiredLink>();
  const ties: { a: string; b: string; word: string }[] = [];
  for (const l of input.skeleton.links) {
    const sa = slotIn(h, l.a), sb = slotIn(h, l.b);
    if (sa && sb) { const word = l.tag === "kin" ? kinWord(l.note) : null; if (word) ties.push({ a: sa, b: sb, word }); continue; }
    const [slot, other] = sa ? [sa, l.b] : sb ? [sb, l.a] : [null, null];
    if (!slot || !other) continue;
    // A mirror binds only the named person (a) to the card that made the tie (b).
    if (l.source === "mirror" && !sa) continue;
    const who = resolveRef(input, other, people);
    if (!who) continue;
    let tag: RequiredLink["tag"] = null, hint = l.note;
    if (l.source === "mirror") {
      const mirror = input.pins.mirrors.find(mi => mi.to === l.a && mi.from === l.b);
      if (FAMILY_TAGS.has(l.tag)) tag = "kin";
      hint = `${who.name}'s card ties to them as "${l.tag}" (affinity ${mirror?.affinity ?? "?"}, trust ${mirror?.trust ?? "?"}); return it`;
    } else if (l.tag === "kin") tag = "kin";
    else if ((RELATION_TAGS as readonly string[]).includes(l.tag)) tag = l.tag as RequiredLink["tag"];
    const key = `${slot}|${who.id}`;
    const prev = required.get(key);
    required.set(key, prev ? { ...prev, tag: prev.tag ?? tag, hint: `${prev.hint} ${hint}` } : { slot, id: who.id, name: who.name, tag, hint });
  }
  return { required: [...required.values()], ties };
}

const SEED_ROLES: Readonly<Record<string, MemberDraw["role"]>> = {
  adult: "adult", partner: "partner", sibling: "sibling", flatmate: "flatmate", child: "child", grandparent: "grandparent", parent: "parent",
};

/**
 * A.3.1's draw for a Day-1 household, with the skeleton's facts (MODE: native): only the members still to write; the
 * carded ones are housemates.
 */
export function nativeDrawFor(input: CensusInput, h: SkeletonHousehold): HouseholdDraw {
  const cards = new Map([...input.cards, ...input.written.values()].map(c => [c.id, c]));
  const entry = input.homes.get(h.home);
  const { ties } = censusLinks(input, h);
  const members = h.members.filter(toWrite).map((m): MemberDraw => {
    const p = m.portrait;
    const pin = m.id ? input.pins.people[m.id] : undefined;
    const named = pin && isNamedPin(pin) ? pin : null;
    const slotPin = input.pins.households.find(x => x.id === h.id)?.members[Number(m.slot.slice(1)) - 1];
    const voice = named?.voice ?? "start from the archetype's voice note";
    const seed = named ? `${named.hook} Voice: ${/[.!?]['"’]?$/.test(voice) ? voice : `${voice}.`}` : slotPin && "slot" in slotPin ? slotPin.slot.note : null;
    // GDD-GAP: the skeleton leaves years_in_monde null in the households a card shares (it says nothing about them): a
    // lodger has been here a couple of years, anyone else was born here.
    const years = h.years_in_monde ?? (m.role === "flatmate" ? Math.min(m.age, 2) : m.age);
    return {
      slot: m.slot, role: SEED_ROLES[m.role] ?? "adult", age_min: m.age, age_max: m.age, age: m.age, band: m.band, presentation: m.presentation,
      pronoun_default: m.pronoun_default,
      portrait: p.source === "library" ? p.id : "procedural",
      tags: p.source === "procedural" ? p.tags : tagsOfEntry(portraitById(p.id)!),
      ...(p.source === "procedural" ? { look: p.look } : {}),
      archetype: (m.archetype ?? h.archetype) as ArchetypeId,
      native: {
        kind: m.kind === "named" ? "named" : "anonymous",
        pinned: m.id && (named || (m.name_fixed && m.name)) ? { id: m.id, name: named ? named.name : m.name! } : null,
        employment: m.employment, job: m.job ? { row: m.job.row, title: m.job.title, workplace: m.job.workplace } : null,
        saturday_job: m.saturday_job, minor: m.minor, years_in_monde: Math.min(m.age, Math.max(0, years)),
        first_names: [...m.first_names], surname: m.surname ?? h.surname ?? "", birthday: m.birthday, seed,
      },
    };
  });
  const housemates = h.members.filter(m => !toWrite(m) && m.id).map(m => {
    const c = cards.get(m.id!)!;
    return { slot: m.slot, id: c.id, name: c.name, role: m.role, pronouns: c.pronouns, age: c.age, line: c.occupation };
  });
  return {
    id: h.id, archetype: h.archetype!, day: 1, slot: input.skeleton.households.indexOf(h), youth: false,
    beds: entry?.beds ?? 1, prob: 1, members,
    native: { type: h.type, zone: h.zone, home: { id: h.home, line: homeLine(input.homes, h.home), beds: entry?.beds ?? 1 }, surname: h.surname, housemates, ties },
  };
}

const firstOf = (name: string): string => name.replace(/^(Rev\.|Captain|Dr\.)\s+/, "").replace(/"[^"]*"\s*/g, "").trim().split(/\s+/)[0] ?? "";
/** The cast who never appear in a native prompt's list: the cat, and the man who isn't a resident until Day 48. */
const NOT_NEIGHBOURS = new Set(["bastien", "vane"]);
/** A.3.6 asks for 6–10 people they might know. */
export const KNOWN_MIN = 6, KNOWN_MAX = 10;

/** A.3.6's ctx for a Day-1 household: people they might know, the required ties, names to avoid, the whim. */
export function nativeContextFor(input: CensusInput, h: SkeletonHousehold, draw: HouseholdDraw, whim: string, validatorErrors: readonly string[] = []): NativePromptContext {
  const people = roster(input);
  const { required } = censusLinks(input, h);
  const own = new Set([...h.members.map(m => m.id).filter((x): x is string => !!x)]);
  const all = [...input.cards, ...input.written.values()].filter(c => c.kind !== "animal" && !own.has(c.id) && !NOT_NEIGHBOURS.has(c.id));
  const known = new Map<string, { id: string; name: string; line: string }>();
  const add = (id: string, name: string, line: string) => { if (!known.has(id) && !own.has(id)) known.set(id, { id, name, line }); };
  for (const l of required) add(l.id, l.name, people.get(l.id)?.line ?? "known for years");
  const home = h.home;
  const workplaces = new Set(draw.members.map(m => assignedWorkplace(m, home)).filter((w): w is string => !!w && w !== home && w !== "offmap.city"));
  for (const c of all) if (workplaces.has(c.workplace) && known.size < KNOWN_MAX) add(c.id, c.name, `${c.occupation}; works at ${c.workplace} too`);
  const street = input.homes.get(home)?.street;
  for (const c of input.written.values()) if (street && input.homes.get(c.home)?.street === street && homeZone(c.home) === h.zone && known.size < KNOWN_MAX && !own.has(c.id))
    add(c.id, c.name, `${c.occupation}; a neighbour on ${street}`);
  for (const c of input.cards) if (c.kind !== "animal" && homeZone(c.home) === h.zone && !NOT_NEIGHBOURS.has(c.id) && known.size < KNOWN_MAX) add(c.id, c.name, c.occupation);
  // The town's best-known faces fill the list to six.
  for (const id of ["pell", "odile", "rosalind", "nell", "felix", "margo", "kasimir", "augusta", "priya", "moss"]) {
    if (known.size >= KNOWN_MIN) break;
    const c = input.cards.find(x => x.id === id);
    if (c) add(c.id, c.name, c.occupation);
  }
  // AVOID: the story's reserved first names and any already worn twice (V03); full names are V03's to catch.
  const uses = new Map<string, number>();
  for (const w of people.values()) { const f = firstOf(w.name); uses.set(f, (uses.get(f) ?? 0) + 1); }
  const avoidFirst = [...new Set([...RESERVED_FIRST_NAMES, ...[...uses].filter(([, n]) => n >= 2).map(([f]) => f)])];
  return {
    knownResidents: [...known.values()], requiredLinks: required, avoidFirst, avoidFull: [], whim,
    ...(validatorErrors.length ? { validatorErrors: validatorErrors.map(e => e.slice(0, 400)).slice(0, 20) } : {}),
  };
}

/** The validator's context for a Day-1 household (profile "native"); `novelty: false` leaves V19 out (the template). */
export function nativeValidationContext(input: CensusInput, h: SkeletonHousehold, draw: HouseholdDraw, opts: { novelty?: boolean } = {}): ValidationContext {
  // Everyone, the household's named people included: a tie the model writes to "dom" rather than slot m2 still lands.
  const residents = new Map([...roster(input)].map(([id, w]) => [id, { name: w.name }]));
  const { required } = censusLinks(input, h);
  // Native V03: the surnames of the households a kin link joins this one to.
  const kinSurnames = new Set<string>();
  for (const l of input.skeleton.links) {
    if (l.tag !== "kin") continue;
    for (const [mine, theirs] of [[l.a, l.b], [l.b, l.a]] as const) {
      if (!slotIn(h, mine) || slotIn(h, theirs)) continue;
      const hid = theirs.includes("/") ? theirs.slice(0, theirs.indexOf("/")) : input.skeleton.households.find(x => x.members.some(m => m.id === theirs))?.id;
      const other = input.skeleton.households.find(x => x.id === hid);
      for (const m of other?.members ?? []) if (m.surname) kinSurnames.add(m.surname);
    }
  }
  // V19: the written cards' backstories by archetype, in the order their households were written.
  const recent = new Map<string, string[]>();
  if (opts.novelty !== false) {
    const order = new Map(input.skeleton.households.map(x => [x.id, x.generation?.written_at ?? ""]));
    const cards = [...input.written.values()].filter(c => c.household !== h.id && c.generated_by === "model")
      .sort((a, b) => (order.get(a.household ?? "") ?? "").localeCompare(order.get(b.household ?? "") ?? "") || a.id.localeCompare(b.id));
    for (const c of cards) if (c.archetype) recent.set(c.archetype, [...(recent.get(c.archetype) ?? []), c.backstory]);
  }
  // Native V03: the surnames the skeleton gave everyone else, so two households never end up sharing one.
  const own = new Set([h.surname, ...h.members.map(m => m.surname)].filter((x): x is string => !!x));
  const otherSurnames = [...new Set(input.skeleton.households.filter(x => x.id !== h.id).flatMap(x => [x.surname, ...x.members.map(m => m.surname)])
    .filter((x): x is string => !!x && !own.has(x) && !kinSurnames.has(x)))];
  return {
    places: input.places, residents, home: h.home, profile: "native", giftTags: input.giftTags, recentBackstories: recent,
    requiredLinks: required, kinSurnames: [...kinSurnames], otherSurnames, ...(input.banned ? { banned: input.banned } : {}),
  };
}

/** The ids no new card may take: everyone's, the named people's, and every id a hand-written card names (absent people). */
function takenIds(input: CensusInput): Set<string> {
  const out = new Set<string>([...input.cards.map(c => c.id), ...input.written.keys(), ...Object.keys(input.pins.people)]);
  for (const c of input.cards) for (const r of c.relationships) out.add(r.id);
  return out;
}

/** The household's inputs, hashed: its skeleton entry (without progress), its links and pins, the prompt version. */
export function censusInputHash(input: CensusInput, h: SkeletonHousehold): string {
  const strip = { ...h, status: null, generation: null, members: h.members.map(m => (m.kind === "anonymous" ? { ...m, id: null, name: null } : m)) };
  const refs = new Set([...h.members.map(m => m.id).filter(Boolean), ...h.members.map(m => `${h.id}/${m.slot}`)]);
  const links = input.skeleton.links.filter(l => refs.has(l.a) || refs.has(l.b));
  const pins = h.members.map(m => (m.id ? input.pins.people[m.id] ?? null : null));
  const pinHousehold = input.pins.households.find(p => p.id === h.id) ?? null;
  const text = JSON.stringify({ v: NATIVE_PROMPT_VERSION, system: NATIVE_SYSTEM_BLOCKS.map(b => hashParts(b)), h: strip, links, pins, pinHousehold, home: input.homes.get(h.home) ?? null });
  return `${hashParts("census-a", text).toString(16).padStart(8, "0")}${hashParts("census-b", text).toString(16).padStart(8, "0")}`;
}

// ── The run ─────────────────────────────────────────────────────────────────

export interface CensusUsage { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
const NO_USAGE: CensusUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** What one model call came back with (the server's census endpoint, or the SDK in process). */
export type CensusWriterResult =
  | { kind: "text"; text: string; stop_reason: string; usage: CensusUsage; cost_usd: number }
  /** A refusal, the token cap, or another stop reason: no text to read (AGENTS.md: check stop_reason first). */
  | { kind: "stop"; stop_reason: string; usage: CensusUsage; cost_usd: number }
  /** The census budget or the global daily cap is spent: the run stops. */
  | { kind: "budget"; message: string }
  /** Transport or API trouble: the household stays unwritten for the next run (`fatal`: stop the run, e.g. a 401). */
  | { kind: "error"; message: string; fatal?: boolean };
export type CensusWriter = (draw: HouseholdDraw, ctx: NativePromptContext) => Promise<CensusWriterResult>;

export interface CensusStore {
  /** Households that have card files (by the cards' `household`). */
  householdsWithCards(): ReadonlySet<string>;
  writeCards(h: SkeletonHousehold, cards: readonly PersonaCard[]): void | Promise<void>;
  /** --regen: remove a household's card files. */
  removeCards(householdId: string): void | Promise<void>;
  saveSkeleton(sk: Day1Skeleton): void | Promise<void>;
  log(line: string): void;
}

export interface CensusPrices { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface CensusRunOptions {
  writer?: CensusWriter;
  store: CensusStore;
  /** Households written at once (four). */
  concurrency?: number;
  /** The one household to rewrite even though it is written (its card files are removed first). */
  regen?: string | null;
  /** Build the prompts and estimate the cost; call nothing, write nothing. */
  dryRun?: boolean;
  /** Write at most this many households (a trial run). */
  limit?: number;
  /**
   * Development (M-03 step 3): every household's A.3.8 template card, no model call (no writer needed). The cards are
   * flagged generated_by: template like any template fallback.
   */
  templateOnly?: boolean;
  prices?: CensusPrices;
  now?: () => Date;
}

export interface CensusEstimate {
  households: number;
  members: number;
  /** Expected calls: one per household plus the retries the GDD-GAP rate below assumes. */
  calls: number;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
  cost_usd: number;
  /** Every household failing six times at its max_tokens: the ceiling. */
  worst_cost_usd: number;
}

export interface CensusRunResult {
  pending: string[];
  written: { id: string; source: "model" | "template"; attempts: number; cost_usd: number }[];
  skipped: string[];
  failed: { id: string; reason: string }[];
  /** Written households whose inputs changed since (warned, not rewritten). */
  stale: string[];
  stopped: "budget" | "errors" | null;
  calls: number;
  usage: CensusUsage;
  cost_usd: number;
  prompts: { id: string; text: string }[];
  estimate: CensusEstimate | null;
}

/** GDD-GAP: chars per token for the estimate (English prose with ids); the API's usage is the truth. */
export const CHARS_PER_TOKEN = 3.5;
/** GDD-GAP: A.3.6's "about 1.6k output for a two-person household": 150 + 800 per member. */
export const OUTPUT_PER_MEMBER = 800, OUTPUT_PER_HOUSEHOLD = 150;
/** GDD-GAP: the share of households assumed to need a retry, for the expected-cost line. */
export const RETRY_RATE = 0.3;

const tokensOf = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

/** The dry run's estimate from the prompts it built. */
export function estimateCensus(prompts: readonly { text: string; size: number }[], prices: CensusPrices): CensusEstimate {
  const system = tokensOf(NATIVE_SYSTEM_BLOCKS.join("\n\n"));
  const perMtok = (n: number, p: number) => (n * p) / 1e6;
  let input = 0, output = 0, worstOut = 0, members = 0;
  for (const p of prompts) { input += tokensOf(p.text); output += OUTPUT_PER_HOUSEHOLD + OUTPUT_PER_MEMBER * p.size; worstOut += nativeMaxTokens(p.size); members += p.size; }
  const calls = Math.round(prompts.length * (1 + RETRY_RATE));
  const scale = 1 + RETRY_RATE;
  // The system blocks are cached: written once (1.25×), then read (0.1×) by every later call inside the five minutes.
  const cost = perMtok(input * scale, prices.input) + perMtok(output * scale, prices.output) + perMtok(system, prices.cacheWrite) + perMtok(system * Math.max(0, calls - 1), prices.cacheRead);
  const worstCalls = prompts.length * CENSUS_ROUNDS * CENSUS_ATTEMPTS_PER_ROUND;
  const worst = perMtok(input * CENSUS_ROUNDS * CENSUS_ATTEMPTS_PER_ROUND, prices.input) + perMtok(worstOut * CENSUS_ROUNDS * CENSUS_ATTEMPTS_PER_ROUND, prices.output) + perMtok(system * worstCalls, prices.cacheWrite);
  return {
    households: prompts.length, members, calls, input_tokens: Math.round(input * scale), cached_tokens: system * calls, output_tokens: Math.round(output * scale),
    cost_usd: Math.round(cost * 10000) / 10000, worst_cost_usd: Math.round(worst * 10000) / 10000,
  };
}

/** Haiku 5.5's prices (server/src/mind/pricing.ts is the source; the tool passes those). */
export const DEFAULT_CENSUS_PRICES: CensusPrices = { input: 0.10, output: 0.50, cacheRead: 0.01, cacheWrite: 0.125 };

/** A one-at-a-time lock (commits re-validate against the roster as it stands, then write). */
function mutex(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

const addUsage = (a: CensusUsage, b: CensusUsage): CensusUsage => ({
  input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens,
  cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens, cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
});

/** Write every Day-1 household still to write (or, dry, say what that would cost). */
export async function runCensus(input: CensusInput, options: CensusRunOptions): Promise<CensusRunResult> {
  const { store } = options;
  const now = options.now ?? (() => new Date());
  const sk = input.skeleton;
  const pinnedIds = new Set(input.pins.households.map(p => p.id));
  const result: CensusRunResult = { pending: [], written: [], skipped: [], failed: [], stale: [], stopped: null, calls: 0, usage: { ...NO_USAGE }, cost_usd: 0, prompts: [], estimate: null };
  if (options.regen) {
    const h = sk.households.find(x => x.id === options.regen);
    if (!h?.generation) throw new Error(`--regen ${options.regen}: no household with cards to write by that id`);
    if (!options.dryRun) {
      await store.removeCards(h.id);
      for (const [id, c] of input.written) if (c.household === h.id) input.written.delete(id);
      // The same people, written again: their ids and names stay (cards elsewhere tie to them by id), as fixed names.
      for (const m of h.members) if (m.kind === "anonymous" && m.id && m.name) m.name_fixed = true;
      h.status = pinnedIds.has(h.id) ? "pinned" : "skeleton";
      h.generation = blankGeneration();
      store.log(`regen ${h.id}: its cards were removed; its people keep their names and ids`);
    }
  }
  const withCards = store.householdsWithCards();
  const due: SkeletonHousehold[] = [];
  for (const h of censusOrder(sk, input.homes, input.pins)) {
    const regen = options.regen === h.id;
    if (!regen && (isWritten(h) || withCards.has(h.id))) {
      result.skipped.push(h.id);
      if (h.generation?.input_hash && h.generation.input_hash !== censusInputHash(input, h)) {
        result.stale.push(h.id);
        store.log(`warning: ${h.id}'s skeleton inputs changed after its cards were written (--regen ${h.id} rewrites it)`);
      }
      continue;
    }
    due.push(h);
  }
  const batch = options.limit !== undefined ? due.slice(0, options.limit) : due;
  result.pending = batch.map(h => h.id);

  if (options.dryRun) {
    const sized: { text: string; size: number }[] = [];
    for (const h of batch) {
      const draw = nativeDrawFor(input, h);
      const text = nativeUserMessage(draw, nativeContextFor(input, h, draw, whimFor(sk.seed, h.id, 1)));
      result.prompts.push({ id: h.id, text });
      sized.push({ text, size: draw.members.length });
    }
    result.estimate = estimateCensus(sized, options.prices ?? DEFAULT_CENSUS_PRICES);
    return result;
  }
  const writer = options.writer;
  if (!writer && !options.templateOnly) throw new Error("runCensus: a writer is needed unless dryRun or templateOnly");

  const lock = mutex();
  let consecutiveErrors = 0;
  /**
   * Repair a model's reply and validate it against the roster as it is now, then write the cards and the skeleton's
   * record. The errors are what the repair couldn't fix: only those go back on a retry.
   */
  const commit = (h: SkeletonHousehold, draw: HouseholdDraw, raw: unknown, source: "model" | "template", attempts: number, cost: number) => lock(async () => {
    const vctx = nativeValidationContext(input, h, draw, { novelty: source === "model" });
    const repaired = source === "model" ? repairHousehold(raw, draw, vctx) : { output: raw, adjustments: [] };
    if (repaired.adjustments.length) store.log(`${h.id} attempt ${attempts}: ${repaired.adjustments.length} repairs (${repaired.adjustments.join(" | ")})`);
    const v = validateHousehold(repaired.output, draw, vctx);
    if (!v.ok) return { ok: false as const, errors: v.errors };
    const built = cardsFromHousehold(v.output as ArrivalHouseholdOutput, draw, takenIds(input), h.home, { profile: "native", generatedBy: source });
    const cards = built.map(b => b.card);
    for (const c of cards) input.written.set(c.id, c);
    const bySlot = new Map(draw.members.map((m, i) => [m.slot, cards[i]!]));
    for (const m of h.members) { const c = bySlot.get(m.slot); if (c) { m.id = c.id; m.name = c.name; } }
    h.status = "drafted";
    h.generation = { prompt: NATIVE_PROMPT_VERSION, attempts, source, input_hash: censusInputHash(input, h), cost_usd: Math.round(cost * 1e6) / 1e6, written_at: now().toISOString() };
    await store.writeCards(h, cards);
    await store.saveSkeleton(sk);
    return { ok: true as const, warnings: v.warnings };
  });

  const writeOne = async (h: SkeletonHousehold): Promise<void> => {
    const draw = nativeDrawFor(input, h);
    let attempts = 0, cost = 0;
    for (let round = 0; round < (options.templateOnly ? 0 : CENSUS_ROUNDS); round++) {
      // A.3.8: the second round starts over (a new whim, no errors carried).
      let errors: string[] = [];
      for (let k = 0; k < CENSUS_ATTEMPTS_PER_ROUND; k++) {
        if (result.stopped) { result.failed.push({ id: h.id, reason: `stopped (${result.stopped})` }); return; }
        attempts++;
        const ctx = nativeContextFor(input, h, draw, whimFor(sk.seed, h.id, attempts), errors);
        const res = await writer!(draw, ctx);
        if (res.kind === "budget") { result.stopped = "budget"; result.failed.push({ id: h.id, reason: `budget: ${res.message}` }); store.log(`budget: ${res.message}; stopping`); return; }
        if (res.kind === "error") {
          // The wire, not the words: leave the household for the next run.
          if (++consecutiveErrors >= 3 || res.fatal) result.stopped = "errors";
          result.failed.push({ id: h.id, reason: res.message });
          store.log(`${h.id}: ${res.message}`);
          return;
        }
        consecutiveErrors = 0;
        result.calls++;
        result.usage = addUsage(result.usage, res.usage);
        result.cost_usd += res.cost_usd;
        cost += res.cost_usd;
        if (res.kind === "stop") {
          errors = res.stop_reason === "max_tokens" ? ["V20 the answer ran past the token budget: keep every field to its limit"] : [];
          store.log(`${h.id} attempt ${attempts}: stop_reason ${res.stop_reason}`);
          continue;
        }
        let raw: unknown = null;
        raw = parseJsonObject(res.text);
        if (raw === undefined) { errors = ["V01 not one JSON object"]; continue; }
        const done = await commit(h, draw, raw, "model", attempts, cost);
        if (done.ok) { result.written.push({ id: h.id, source: "model", attempts, cost_usd: cost }); store.log(`${h.id}: written (attempt ${attempts})`); return; }
        errors = done.errors;
        store.log(`${h.id} attempt ${attempts}: ${errors.length} validation errors (${errors.slice(0, 2).join(" | ")})`);
      }
    }
    // A.3.8: the template card, flagged generated_by: template.
    const vctx = nativeValidationContext(input, h, draw, { novelty: false });
    const done = await commit(h, draw, nativeTemplateHousehold(draw, vctx, sk.seed), "template", attempts, cost);
    if (done.ok) { result.written.push({ id: h.id, source: "template", attempts, cost_usd: cost }); store.log(options.templateOnly ? `${h.id}: template card` : `${h.id}: template card after ${attempts} attempts`); }
    else { result.failed.push({ id: h.id, reason: `template failed: ${done.errors.join(" | ")}` }); store.log(`${h.id}: the template card failed validation: ${done.errors.join(" | ")}`); }
  };

  // Four at a time, in order.
  const queue = [...batch];
  const workers = Array.from({ length: Math.max(1, options.concurrency ?? CENSUS_CONCURRENCY) }, async () => {
    while (queue.length && !result.stopped) await writeOne(queue.shift()!);
  });
  await Promise.all(workers);
  for (const h of queue) result.failed.push({ id: h.id, reason: `not started (${result.stopped})` });
  return result;
}

// ── Card files (content/residents/day1/<id>.yaml) ───────────────────────────

const FLOW_KEYS = new Set(["big5", "values", "hair", "outfit", "accessory", "headwear", "face", "portrait_expressions", "traits", "tics", "never_says", "reveal", "likes", "dislikes", "fears", "chores"]);

/** A written card as its file: the header line, then the card, routine and ties one per line. */
export function stringifyGeneratedCard(card: PersonaCard, curated: string | null = null): string {
  const doc = new YAML.Document(card);
  YAML.visit(doc, {
    Pair(_, pair) {
      const key = YAML.isScalar(pair.key) ? String(pair.key.value) : "";
      if (FLOW_KEYS.has(key) && (YAML.isMap(pair.value) || YAML.isSeq(pair.value))) pair.value.flow = true;
      if ((key === "weekday" || key === "weekend" || key === "relationships") && YAML.isSeq(pair.value))
        for (const item of pair.value.items) if (YAML.isMap(item)) item.flow = true;
      // Times stay strings to every YAML reader ("07:00", as the hand-written cards have them).
      if (key === "at" && YAML.isScalar(pair.value)) pair.value.type = "QUOTE_DOUBLE";
    },
  });
  const header = `# Generated (${NATIVE_PROMPT_VERSION}) for ${card.household ?? "?"}; curated ${curated ?? "not yet"}. Edit here.`;
  return `${header}\n${doc.toString({ lineWidth: 110, flowCollectionPadding: true })}`;
}
