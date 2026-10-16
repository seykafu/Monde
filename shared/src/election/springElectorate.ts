// The Spring electorate (MVP G-11): everyone the §10.3 model counts if Monde voted on Day 25, as Voters.
//
// Three kinds of people (Appendix A.1):
//   - the carded residents (the core cast and the four carded people inside the 192: Ada, Bru, Nettie, Old Moss), read
//     from their Persona Cards, the friendship mirror (Regard toward the player, who has met them, the dawn's ties);
//   - the rest of the 192 Day-1 residents. GDD-GAP: A.1.5's 192 have no cards in the MVP (only the four above do), so the
//     electorate stands them in, seeded by the world: A.1.5's archetype × age-band quotas, A.2's values with the card
//     jitter (±0.10, floor 0.05, cap 0.60, renormalised), homes by A.1.3's zone shares, and friends among the carded
//     residents of their zone and their own neighbours;
//   - the generated arrivals (G-02) who have lived here 10+ days by the poll (§10.3's residency rule, kept as is).
//
// GDD-GAP: the client doesn't mirror residents' stances (§9.4, server-side), and Day 1 has no authored opinion of Vane
// or Moss for most of the town. Until it does, `port`, `vreg` and `moss_reg` start from the priors below (from values,
// trade and who pays whom, §2.2), moved by what the town has learned (`option_public`). A stance the server does send
// (`stances`) replaces the prior.
import { FRIEND_AFFINITY, seededUnit } from "../friendship";
import { ARCHETYPE_BY_ID, type ArchetypeId } from "../arrivals/archetypes";
import { PILLARS, type Pillar } from "../script/types";
import type { Candidate, PillarValues, Voter } from "./voterModel";

/** The card fields the electorate reads. */
export interface ElectorCard {
  id: string;
  name: string;
  age: number;
  kind: string;
  occupation: string;
  home: string;
  values: PillarValues;
  relationships: readonly { id: string; affinity: number; tag?: string }[];
}

export interface ElectorArrival {
  card: ElectorCard;
  arrivedDay: number;
  household: string;
}

/** A tie between two residents as the dawn reports it (shared TieData). */
export interface ElectorTie { a: string; b: string; label: string }

export interface SpringDeeds {
  /** Scuffles the player fought (§7.8), and where. */
  scuffles: readonly { zone: string; won: boolean }[];
  /** Projects opened (§6.3), and the zone of their site. */
  projects: readonly { zone: string }[];
  /** Community-work tasks done in the last week (§8: "Being seen working is how Regard builds with people the player hasn't met yet"). */
  work?: number;
}

export interface ElectorateInput {
  worldSeed: number | string;
  /** The poll day. */
  day: number;
  /** The carded residents living in Monde (animals and anyone off the map are left out here). */
  cards: readonly ElectorCard[];
  /** Regard toward the player (the client's mirror), and whether they have met (talked, or shared a scene). */
  regard(id: string): number;
  met(id: string): boolean;
  arrivals: readonly ElectorArrival[];
  /** The dawn's ties; absent → the cards' Day-1 affinities. */
  ties?: readonly ElectorTie[];
  deeds: SpringDeeds;
  flags: ReadonlySet<string>;
  /** Stances by resident, when the server has sent them. */
  stances?(id: string): Readonly<Record<string, number>> | undefined;
}

// ── Appendix A.1 ────────────────────────────────────────────────────────────

/** A.1.5: the 192's adults by archetype, [young adults 18–35, adults 36–59, elders 60+]. */
export const DAY_ONE_ADULTS: Readonly<Partial<Record<ArchetypeId, readonly [number, number, number]>>> = {
  young_family: [6, 0, 0], school_family: [0, 14, 4], single_parent: [1, 3, 0], young_creative: [3, 0, 0],
  apprentice: [1, 0, 0], drifter: [5, 0, 0], remote_craftsperson: [1, 3, 2], shop_founder: [1, 5, 0],
  cook_baker: [1, 4, 0], builder: [0, 4, 1], fisher: [2, 9, 4], market_gardener: [0, 3, 0], mill_hand: [0, 13, 5],
  retired_couple: [0, 4, 30], widowed_elder: [0, 0, 22], retired_keeper: [0, 0, 3], retired_organizer: [0, 2, 5],
  birdwatcher: [0, 1, 1], retired_magician: [0, 0, 1], cartographer: [0, 1, 1], radio_tinkerer: [0, 2, 2],
};
/** A.1.5 "Named people inside the 192" who have cards: their slot is theirs (archetype, band). */
export const CARDED_IN_192: Readonly<Record<string, readonly [ArchetypeId, 0 | 1 | 2]>> = {
  bru: ["drifter", 0], nettie: ["apprentice", 0], ada: ["single_parent", 1], moss: ["fisher", 2],
};
/** A.1.5: the other Tollmen inside the 192 (Dex and Dom Calloway, Weasel Pike), all drifters. */
export const UNCARDED_TOLLMEN = 3;
/** A.1.4: nine of the mill hands are the out-of-work adults. */
export const UNEMPLOYED_MILL_HANDS = 9;
/** A.1.1 age bands. */
export const BANDS: readonly (readonly [number, number])[] = [[18, 35], [36, 59], [60, 88]];
/** A.1.3: residents per zone (of 210), the shares unnamed homes are drawn with. */
export const ZONE_SHARES: Readonly<Record<string, number>> = { millbrook: 85, old_quarter: 42, wharf: 36, market_row: 30, station_hill: 13, commons: 4 };

// ── Priors (GDD-GAP, see the head of the file) ──────────────────────────────

export const PRIORS = {
  /** Opinion of Vane: a polite stranger with forty jobs on offer (§2.2), paymaster of the Tollmen. */
  vane: { base: 5, spread: 12, millHand: 15, unemployed: 10, fisher: -15, tollman: 45, organizer: -10 },
  /** port_vane: wanted for jobs (Prosperity), feared for the Commons and the Wharf (Charm, Spirit, fishing). */
  port: { prosperity: 100, pivot: 0.25, commons: 60, commonsPivot: 0.45, unemployed: 15, fisher: -30, tollman: 30, employee: 40, spread: 10, optionPublic: -15 },
  /** Opinion of Old Moss: the fishers' own skipper. */
  moss: { base: 0, spread: 10, fisher: 25 },
  /** A tie label as an opinion of the other (for vreg and moss_reg from the dawn's ties). */
  tie: { acquaintances: 10, friends: 50, close_friends: 75, rivals: -30, enemies: -70 } as Readonly<Record<string, number>>,
  /** Townsfolk count this many carded neighbours and this many unnamed neighbours as friends. */
  friends: { carded: 2, unnamed: 2 },
} as const;

/**
 * Witnessed deeds (§9.6: a Scuffle is a town event everyone in sight remembers; an opening has its attendees), in Regard
 * points for a stranger's reputation. GDD-GAP: §10.3 adds "witnessed deeds" without numbers: a deed in your own zone
 * counts double one you heard of, a week's community work is seen town-wide (§8), and the whole is capped at a
 * Neighbor's worth.
 */
export const DEEDS = { scuffleWon: 6, scuffleLost: -3, project: 8, elsewhere: 0.5, work: 0.5, cap: 25 } as const;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const zoneOf = (place: string): string => place.split(".")[0] ?? place;
/** Uniform in [lo, hi) from the world seed and the parts. */
const between = (lo: number, hi: number, ...parts: (string | number)[]): number => lo + (hi - lo) * seededUnit(...parts);
const FISHER = /fisher|skipper|ferry|deckhand|boat/i;
const TOLLMAN = /tollm[ae]n/i;
const VANE_STAFF = /vane consolidated|assistant to silas vane/i;

/** A.2's card jitter: each default ±0.10, floor 0.05, cap 0.60, renormalised to 1. */
export function jitterValues(base: PillarValues, ...seed: (string | number)[]): PillarValues {
  const raw = Object.fromEntries(PILLARS.map(p => [p, clamp(base[p] + between(-0.1, 0.1, "values", ...seed, p), 0.05, 0.6)])) as Record<Pillar, number>;
  const sum = PILLARS.reduce((s, p) => s + raw[p], 0);
  return Object.fromEntries(PILLARS.map(p => [p, raw[p] / sum])) as Record<Pillar, number>;
}

/** port_vane's prior from what someone weighs and what they do. */
export function portPrior(values: PillarValues, traits: { fisher?: boolean; tollman?: boolean; unemployed?: boolean; employee?: boolean; optionPublic?: boolean }, noise = 0): number {
  const P = PRIORS.port;
  return clamp(P.prosperity * (values.prosperity - P.pivot) - P.commons * (values.charm + values.spirit - P.commonsPivot)
    + (traits.unemployed ? P.unemployed : 0) + (traits.fisher ? P.fisher : 0) + (traits.tollman ? P.tollman : 0)
    + (traits.employee ? P.employee : 0) + (traits.optionPublic ? P.optionPublic : 0) + noise, -100, 100);
}

/** Deeds a resident of `zone` has seen or heard of. */
export function deedsFor(zone: string, deeds: SpringDeeds): number {
  const near = (z: string) => (z === zone ? 1 : DEEDS.elsewhere);
  const sum = deeds.scuffles.reduce((s, d) => s + (d.won ? DEEDS.scuffleWon : DEEDS.scuffleLost) * near(d.zone), 0)
    + deeds.projects.reduce((s, d) => s + DEEDS.project * near(d.zone), 0) + DEEDS.work * (deeds.work ?? 0);
  return clamp(sum, -DEEDS.cap, DEEDS.cap);
}

/** The carded residents a resident counts as friends: the dawn's ties when there are any, else the cards (affinity ≥ 40). */
function cardFriends(card: ElectorCard, ties: readonly ElectorTie[] | undefined): string[] {
  if (ties) return ties.filter(t => (t.a === card.id || t.b === card.id) && (t.label === "friends" || t.label === "close_friends"))
    .map(t => (t.a === card.id ? t.b : t.a));
  return card.relationships.filter(r => r.affinity >= FRIEND_AFFINITY).map(r => r.id);
}

/** Someone's opinion of another (Vane, Moss): the dawn's tie if it names them, else the card, else null. */
function opinionOf(card: ElectorCard, other: string, ties: readonly ElectorTie[] | undefined): number | null {
  const tie = ties?.find(t => (t.a === card.id && t.b === other) || (t.b === card.id && t.a === other));
  if (tie && PRIORS.tie[tie.label] !== undefined) return PRIORS.tie[tie.label]!;
  const rel = card.relationships.find(r => r.id === other);
  return rel ? rel.affinity : null;
}

const CANDIDATE_OF: Readonly<Record<string, Candidate>> = { moss: "moss" };

/** Everyone, as Voters (minors included: their lean reaches their friends; eligibility decides who votes). */
export function springElectorate(input: ElectorateInput): Voter[] {
  const { worldSeed: seed, ties } = input;
  const optionPublic = input.flags.has("option_public");
  const out: Voter[] = [];
  const stance = (id: string, issue: string): number | undefined => input.stances?.(id)?.[issue];

  // The carded residents.
  const carded = input.cards.filter(c => c.kind !== "animal" && c.id !== "vane");
  for (const c of carded) {
    const fisher = FISHER.test(c.occupation), tollman = TOLLMAN.test(c.occupation), employee = VANE_STAFF.test(c.occupation);
    const P = PRIORS;
    out.push({
      id: c.id, named: true, age: c.age, district: zoneOf(c.home), values: c.values, arrivedDay: 1,
      regard: input.met(c.id) ? input.regard(c.id) : null,
      deeds: deedsFor(zoneOf(c.home), input.deeds),
      vaneRegard: opinionOf(c, "vane", ties) ?? P.vane.base + (tollman ? P.vane.tollman : 0) + (fisher ? P.vane.fisher : 0),
      mossRegard: c.id === "moss" ? 100 : opinionOf(c, "moss", ties) ?? P.moss.base + (fisher ? P.moss.fisher : 0),
      port: stance(c.id, "port_vane") ?? portPrior(c.values, { fisher, tollman, employee, optionPublic }),
      ferryFolk: fisher, friends: cardFriends(c, ties),
      ...(CANDIDATE_OF[c.id] ? { candidate: CANDIDATE_OF[c.id] } : {}),
    });
  }

  // The rest of the 192: adults only (the children and teens are too young to vote, and nobody quotes their lean). They
  // can't be met in the MVP, so their own reputation comes from their carded friends (meetable: false), while their
  // unnamed neighbours still pass their lean along through social(v).
  const hubs = new Map<string, string[]>();
  for (const v of out) if (v.age >= 18) hubs.set(v.district, [...(hubs.get(v.district) ?? []), v.id]);
  const allHubs = out.filter(v => v.age >= 18).map(v => v.id);
  const zones = Object.entries(ZONE_SHARES);
  const zoneTotal = zones.reduce((s, [, n]) => s + n, 0);
  const pickZone = (id: string): string => {
    let r = seededUnit("home", seed, id) * zoneTotal;
    for (const [zone, n] of zones) { if ((r -= n) < 0) return zone; }
    return zones[0]![0];
  };
  const townsfolk: Voter[] = [];
  let tollmenLeft = UNCARDED_TOLLMEN, unemployedLeft = UNEMPLOYED_MILL_HANDS;
  for (const [archetype, bands] of Object.entries(DAY_ONE_ADULTS) as [ArchetypeId, readonly [number, number, number]][]) {
    const a = ARCHETYPE_BY_ID.get(archetype)!;
    bands.forEach((n, band) => {
      const taken = Object.values(CARDED_IN_192).filter(([id, b]) => id === archetype && b === band).length;
      for (let k = 0; k < n - taken; k++) {
        const id = `tf_${archetype}_${band}_${k}`;
        const fisher = archetype === "fisher", millHand = archetype === "mill_hand";
        const tollman = archetype === "drifter" && tollmenLeft > 0 && (tollmenLeft--, true);
        const unemployed = millHand && unemployedLeft > 0 && (unemployedLeft--, true);
        const district = fisher ? "wharf" : millHand ? "millbrook" : pickZone(id);
        const values = jitterValues(a.values, seed, id);
        const V = PRIORS.vane, M = PRIORS.moss;
        const [lo, hi] = BANDS[band]!;
        townsfolk.push({
          id, named: false, age: Math.floor(between(lo, hi + 1, "age", seed, id)), district, values, arrivedDay: 1,
          regard: null, deeds: deedsFor(district, input.deeds),
          vaneRegard: clamp(V.base + (millHand ? V.millHand : 0) + (unemployed ? V.unemployed : 0) + (fisher ? V.fisher : 0)
            + (tollman ? V.tollman : 0) + (archetype === "retired_organizer" ? V.organizer : 0) + between(-V.spread, V.spread, "vreg", seed, id), -100, 100),
          mossRegard: clamp(M.base + (fisher ? M.fisher : 0) + between(-M.spread, M.spread, "mreg", seed, id), -100, 100),
          port: portPrior(values, { fisher, tollman, unemployed, optionPublic }, between(-PRIORS.port.spread, PRIORS.port.spread, "port", seed, id)),
          ferryFolk: fisher, friends: [], meetable: false,
        });
      }
    });
  }
  // Friends: carded neighbours of the same zone (any carded adult if the zone has none), and unnamed neighbours.
  const byZone = new Map<string, Voter[]>();
  for (const t of townsfolk) byZone.set(t.district, [...(byZone.get(t.district) ?? []), t]);
  const pick = <T>(xs: readonly T[], n: number, key: (x: T) => string, ...seedParts: (string | number)[]): T[] =>
    [...xs].map(x => ({ x, r: seededUnit(...seedParts, key(x)) })).sort((a, b) => a.r - b.r).slice(0, n).map(e => e.x);
  for (const t of townsfolk) {
    const near = hubs.get(t.district)?.length ? hubs.get(t.district)! : allHubs;
    const neighbours = (byZone.get(t.district) ?? []).filter(o => o.id !== t.id);
    t.friends = [...pick(near, PRIORS.friends.carded, id => id, "hub", seed, t.id), ...pick(neighbours, PRIORS.friends.unnamed, o => o.id, "nb", seed, t.id).map(o => o.id)];
  }
  out.push(...townsfolk);

  // The arrivals: their household, any relationships on their card, and a carded neighbour.
  for (const r of input.arrivals) {
    const c = r.card, district = zoneOf(c.home), fisher = FISHER.test(c.occupation);
    const household = input.arrivals.filter(o => o.household === r.household && o.card.id !== c.id).map(o => o.card.id);
    const near = hubs.get(district)?.length ? hubs.get(district)! : allHubs;
    out.push({
      id: c.id, named: true, age: c.age, district, values: c.values, arrivedDay: r.arrivedDay,
      regard: input.met(c.id) ? input.regard(c.id) : null, deeds: deedsFor(district, input.deeds),
      vaneRegard: opinionOf(c, "vane", ties) ?? PRIORS.vane.base,
      mossRegard: opinionOf(c, "moss", ties) ?? PRIORS.moss.base + (fisher ? PRIORS.moss.fisher : 0),
      port: stance(c.id, "port_vane") ?? portPrior(c.values, { fisher, optionPublic }),
      // Everyone off the Gannet rode the ferry once; a fisher's trade is the sea either way.
      ferryFolk: fisher,
      friends: [...new Set([...household, ...cardFriends(c, ties), ...pick(near, 1, id => id, "hub", seed, c.id)])],
    });
  }
  return out;
}

