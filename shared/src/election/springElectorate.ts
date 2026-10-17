// The Spring electorate (MVP G-11): everyone the §10.3 model counts if Monde voted on Day 25, as Voters.
//
// Two kinds of people (Appendix A.1):
//   - the carded residents: the hand-written cast and, once the census is written (MVP M-03), the Day-1 census's 188,
//     read from their Persona Cards (values, home, occupation, the census's archetype and employment, their ties) and
//     the friendship mirror (Regard toward the player, who has met them, the dawn's ties). Without the census's cards
//     the electorate is the hand-written 24 alone: there are no stand-ins any more;
//   - the generated arrivals (G-02) who have lived here 10+ days by the poll (§10.3's residency rule, kept as is).
//
// GDD-GAP: the client doesn't mirror residents' stances (§9.4, server-side), and Day 1 has no authored opinion of Vane
// or Moss for most of the town. Until it does, `port`, `vreg` and `moss_reg` start from the priors below (from values,
// trade and who pays whom, §2.2), moved by what the town has learned (`option_public`). A stance the server does send
// (`stances`) replaces the prior.
import { FRIEND_AFFINITY, seededUnit } from "../friendship";
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
  /** The census's fields (MVP M-03; absent on the hand-written cards): A.2's archetype and A.1.4's employment. */
  archetype?: string;
  employment?: string;
  workplace?: string;
  /** `generated_by`: a census card's opinions carry the priors' spread (an unauthored town has a range of views). */
  generated?: boolean;
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

// ── Who someone is, from their card ─────────────────────────────────────────

const FISHER = /fisher|skipper|ferry|deckhand|boat/i;
const TOLLMAN = /tollm[ae]n/i;
const VANE_STAFF = /vane consolidated|assistant to silas vane/i;
const TOLLMEN_HIDEOUT = "briar_woods.tollmen_hideout";

/** The traits the priors read, from the card's own fields (the census's archetype and employment where it has them). */
export function electorTraits(c: Pick<ElectorCard, "occupation" | "archetype" | "employment" | "workplace">) {
  return {
    fisher: c.archetype === "fisher" || FISHER.test(c.occupation),
    tollman: TOLLMAN.test(c.occupation) || c.workplace === TOLLMEN_HIDEOUT,
    unemployed: c.employment === "out_of_work",
    millHand: c.archetype === "mill_hand",
    organizer: c.archetype === "retired_organizer",
    employee: VANE_STAFF.test(c.occupation),
  };
}

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
  const P = PRIORS;

  // The carded residents: the hand-written cast and the Day-1 census.
  const carded = input.cards.filter(c => c.kind !== "animal" && c.id !== "vane");
  for (const c of carded) {
    const t = electorTraits(c);
    // A census card's opinions spread around the prior (the stand-ins' old ± spread); the hand-written cast's don't.
    const noise = (spread: number, what: string) => (c.generated ? between(-spread, spread, what, seed, c.id) : 0);
    out.push({
      id: c.id, named: true, age: c.age, district: zoneOf(c.home), values: c.values, arrivedDay: 1,
      regard: input.met(c.id) ? input.regard(c.id) : null,
      deeds: deedsFor(zoneOf(c.home), input.deeds),
      vaneRegard: opinionOf(c, "vane", ties) ?? clamp(P.vane.base + (t.millHand ? P.vane.millHand : 0) + (t.unemployed ? P.vane.unemployed : 0)
        + (t.fisher ? P.vane.fisher : 0) + (t.tollman ? P.vane.tollman : 0) + (t.organizer ? P.vane.organizer : 0) + noise(P.vane.spread, "vreg"), -100, 100),
      mossRegard: c.id === "moss" ? 100 : opinionOf(c, "moss", ties) ?? clamp(P.moss.base + (t.fisher ? P.moss.fisher : 0) + noise(P.moss.spread, "mreg"), -100, 100),
      port: stance(c.id, "port_vane") ?? portPrior(c.values, { fisher: t.fisher, tollman: t.tollman, unemployed: t.unemployed, employee: t.employee, optionPublic }, noise(P.port.spread, "port")),
      ferryFolk: t.fisher, friends: cardFriends(c, ties),
      ...(CANDIDATE_OF[c.id] ? { candidate: CANDIDATE_OF[c.id] } : {}),
    });
  }

  // The arrivals: their household, any relationships on their card, and a carded neighbour.
  const hubs = new Map<string, string[]>();
  for (const v of out) if (v.age >= 18) hubs.set(v.district, [...(hubs.get(v.district) ?? []), v.id]);
  const allHubs = out.filter(v => v.age >= 18).map(v => v.id);
  const pick = <T>(xs: readonly T[], n: number, key: (x: T) => string, ...seedParts: (string | number)[]): T[] =>
    [...xs].map(x => ({ x, r: seededUnit(...seedParts, key(x)) })).sort((a, b) => a.r - b.r).slice(0, n).map(e => e.x);
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
