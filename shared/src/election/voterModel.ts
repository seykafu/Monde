// The voter model (GDD §10.3; D14: a deterministic, seeded model). Pure: no I/O, no clock, no Math.random.
//
// For each voter v, three scores (§10.3):
//   Player(v) = 0.40·reg(v) + 0.35·record(v) + 0.15·promise(v) + social(v) + debate + evidence_player(v)
//   Vane(v)   = 0.35·vreg(v) + 0.30·port(v) + 0.20·fear(v) + social_vane(v) + vane_campaign(v) − evidence_vane(v)
//   Moss(v)   = 0.10 + 0.30·[v is a fisher, or rode the ferry 5+ times] + 0.10·moss_reg(v)
// The vote goes to the highest score plus a fixed per-voter jitter ε ~ N(0, 0.08) seeded by (world_seed, voter_id), so
// reloading a save never rerolls anyone. Turnout p = 0.55 + 0.004·Spirit + 0.10·[canvassed] + 0.10·[|Player − Vane| > 0.3],
// also seeded. Ties go to the postal votes of the Departed with Regard ≥ 40. Polls sample seeded eligible voters and
// print shares with an honest margin of error.
//
// The campaign terms (promise, debate, evidence, Vane's campaign moves, endorsements) come in through `extras`; Spring
// has none of them (§10.1: the campaign starts on Day 70), so a Spring count leaves them at 0.
import { seededUnit } from "../friendship";
import { PILLARS, type Pillar } from "../script/types";

export const CANDIDATES = ["fellow", "vane", "moss"] as const;
export type Candidate = (typeof CANDIDATES)[number];
export type PillarValues = Readonly<Record<Pillar, number>>;

/** §10.3's weights. */
export const WEIGHTS = {
  player: { reg: 0.4, record: 0.35, promise: 0.15 },
  vane: { vreg: 0.35, port: 0.3, fear: 0.2 },
  moss: { base: 0.1, ferry: 0.3, reg: 0.1 },
} as const;
/** record(v): a Pillar change of this many points is the whole of ±1 (§10.3, "/ 50"). */
export const RECORD_SCALE = 50;
/** fear(v) = max(0, (40 − Prosperity) / 40) × v's Prosperity value (§10.3). */
export const FEAR_LINE = 40;
/** reg(v) for someone who never met the player: 0.5 × the mean Regard of their friends, plus witnessed deeds (§10.3). */
export const REPUTATION_SHARE = 0.5;
/** social(v) = 0.15 × the mean lean of v's friends (affinity ≥ 40), propagated 2 rounds (§10.3). */
export const SOCIAL = { share: 0.15, rounds: 2 } as const;
/** ε ~ N(0, 0.08) (§10.3). */
export const JITTER_SD = 0.08;
/** §10.3 turnout. */
export const TURNOUT = { base: 0.55, perSpirit: 0.004, canvassed: 0.1, decided: 0.1, decidedGap: 0.3 } as const;
/** §10.3: residents aged 18+ who have lived in Monde 10+ days by the count. */
export const VOTING_AGE = 18;
export const RESIDENCY_DAYS = 10;
/** §10.3: a Departed resident's postal vote counts on a tie when they left with Regard ≥ 40. */
export const POSTAL_REGARD = 40;
/** §10.3: a Saturday poll samples 30 seeded eligible voters (about ±18%). */
export const POLL_SAMPLE = 30;

/** One resident as the count sees them. Regards and stances are on their own −100..100 scales. */
export interface Voter {
  id: string;
  /** A carded resident (quotable, and drawn with a portrait); false for the town's unnamed residents. */
  named: boolean;
  age: number;
  /** The zone they live in (the district their ballot is read out in, §10.5). */
  district: string;
  /** What they weigh (§9.3 `values`, summing to 1). */
  values: PillarValues;
  /** The day they came to live in Monde (1 for everyone here on Day 1). */
  arrivedDay: number;
  /** Regard toward the player, or null if they have never met (reg(v) is then their reputation). */
  regard: number | null;
  /** The player's deeds they witnessed or heard of (§9.6), in Regard points: part of a stranger's reputation. */
  deeds: number;
  /** Their opinion of Vane (vreg × 100). */
  vaneRegard: number;
  /** Their opinion of Old Moss (moss_reg × 100). */
  mossRegard: number;
  /** Their stance on `port_vane` (port × 100). */
  port: number;
  /** A fisher, or rode the ferry 5+ times (Moss's term). */
  ferryFolk: boolean;
  /** Who they count as friends (affinity ≥ 40), by voter id. */
  friends: readonly string[];
  canvassed?: boolean;
  /** A candidate votes for themselves. */
  candidate?: Candidate;
  /**
   * False for someone the player can't meet (springElectorate's stand-ins for the uncarded 192): they have no Regard to
   * report, so a friend's reputation reads only their friends who can. Default true.
   */
  meetable?: boolean;
}

/** The campaign's terms for one voter (§10.4, §10.6). All 0 in Spring. */
export interface CampaignTerms {
  promise: number;
  debate: number;
  evidencePlayer: number;
  evidenceVane: number;
  vaneCampaign: number;
  socialVane: number;
}
const NO_TERMS: CampaignTerms = { promise: 0, debate: 0, evidencePlayer: 0, evidenceVane: 0, vaneCampaign: 0, socialVane: 0 };

export interface ModelTown {
  worldSeed: number | string;
  /** The Pillars now (at the count or poll), and on Day 1 (record's baseline). */
  pillars: PillarValues;
  day1: PillarValues;
  extras?: (v: Voter) => Partial<CampaignTerms>;
}

export interface Scores {
  fellow: number;
  vane: number;
  moss: number;
  /** The parts, for the report and the tests. */
  parts: { reg: number; record: number; social: number; vreg: number; port: number; fear: number; mossReg: number };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** record(v) = Σ_p values_p(v) · (Pillar_p(now) − Pillar_p(Day 1)) / 50, clamped −1..1. */
export function record(values: PillarValues, now: PillarValues, day1: PillarValues): number {
  return clamp(PILLARS.reduce((sum, p) => sum + values[p] * (now[p] - day1[p]) / RECORD_SCALE, 0), -1, 1);
}

/** fear(v) = max(0, (40 − Prosperity) / 40) × v's Prosperity value. */
export const fear = (values: PillarValues, prosperity: number): number => Math.max(0, (FEAR_LINE - prosperity) / FEAR_LINE) * values.prosperity;

/**
 * reg(v): Regard/100 for someone who has met the player; otherwise reputation, 0.5 × the mean Regard of their friends
 * (a friend who never met the player counts as 0, a Stranger) plus witnessed deeds. Clamped −1..1.
 */
export function reg(v: Voter, byId: ReadonlyMap<string, Voter>): number {
  if (v.regard !== null) return clamp(v.regard / 100, -1, 1);
  const friends = v.friends.map(id => byId.get(id)).filter((f): f is Voter => !!f && !f.candidate && f.meetable !== false);
  const friendsRegard = mean(friends.map(f => f.regard ?? 0));
  return clamp((REPUTATION_SHARE * friendsRegard + v.deeds) / 100, -1, 1);
}

/** The Gaussian jitter for one voter and one candidate: N(0, 0.08), fixed by (world seed, voter id, candidate). */
export function jitter(worldSeed: number | string, voterId: string, candidate: Candidate): number {
  // GDD-GAP: §10.3 seeds one ε by (world_seed, voter_id); a single ε added to every score can't change anyone's vote,
  // so each candidate's score gets its own draw from the same seed.
  const u1 = 1 - seededUnit("vote-jitter", worldSeed, voterId, candidate, "u1"); // (0, 1]: log is finite
  const u2 = seededUnit("vote-jitter", worldSeed, voterId, candidate, "u2");
  return JITTER_SD * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Every resident's three scores, social propagated two rounds through the friendship graph. Everyone given is scored
 * (minors and the not-yet-eligible too: they are friends whose lean carries); eligibility only decides who votes.
 */
export function scoreAll(people: readonly Voter[], town: ModelTown): Map<string, Scores> {
  const byId = new Map(people.map(v => [v.id, v]));
  const base = new Map<string, Omit<Scores, "parts"> & { parts: Scores["parts"]; terms: CampaignTerms }>();
  for (const v of people) {
    const terms = { ...NO_TERMS, ...(town.extras?.(v) ?? {}) };
    const parts = {
      reg: reg(v, byId),
      record: record(v.values, town.pillars, town.day1),
      social: 0,
      vreg: clamp(v.vaneRegard / 100, -1, 1),
      port: clamp(v.port / 100, -1, 1),
      fear: fear(v.values, town.pillars.prosperity),
      mossReg: clamp(v.mossRegard / 100, -1, 1),
    };
    const W = WEIGHTS;
    base.set(v.id, {
      fellow: W.player.reg * parts.reg + W.player.record * parts.record + W.player.promise * terms.promise + terms.debate + terms.evidencePlayer,
      vane: W.vane.vreg * parts.vreg + W.vane.port * parts.port + W.vane.fear * parts.fear + terms.socialVane + terms.vaneCampaign - terms.evidenceVane,
      moss: W.moss.base + W.moss.ferry * (v.ferryFolk ? 1 : 0) + W.moss.reg * parts.mossReg,
      parts, terms,
    });
  }
  // GDD-GAP: §10.3 doesn't define a voter's "lean"; §10.2 uses it as the player's standing against the rival, so a lean
  // is Player − Vane. social_vane is named but not defined: the signed social term already carries friends who lean
  // Vane (a negative mean), so social_vane stays 0 until Vane's canvassing (§10.4 "Charm offensive") feeds it.
  let social = new Map<string, number>(people.map(v => [v.id, 0]));
  for (let round = 0; round < SOCIAL.rounds; round++) {
    const next = new Map<string, number>();
    for (const v of people) {
      const leans = v.friends.flatMap(id => {
        const f = byId.get(id), s = base.get(id);
        if (!f || !s || f.candidate) return [];
        return [s.fellow + (social.get(id) ?? 0) - s.vane];
      });
      next.set(v.id, SOCIAL.share * mean(leans));
    }
    social = next;
  }
  const out = new Map<string, Scores>();
  for (const v of people) {
    const b = base.get(v.id)!, s = social.get(v.id) ?? 0;
    out.set(v.id, { fellow: b.fellow + s, vane: b.vane, moss: b.moss, parts: { ...b.parts, social: s } });
  }
  return out;
}

export interface Ballot {
  id: string;
  choice: Candidate;
  /** The jittered scores the choice was made on. */
  scores: Record<Candidate, number>;
  /** How far the choice is ahead of the runner-up (0 when a candidate votes for themselves). */
  margin: number;
}

/** One voter's ballot: the highest jittered score (a candidate votes for themselves). */
export function ballot(v: Voter, s: Scores, worldSeed: number | string): Ballot {
  const scores = Object.fromEntries(CANDIDATES.map(c => [c, s[c] + jitter(worldSeed, v.id, c)])) as Record<Candidate, number>;
  if (v.candidate) return { id: v.id, choice: v.candidate, scores, margin: 0 };
  const ranked = [...CANDIDATES].sort((a, b) => scores[b] - scores[a] || CANDIDATES.indexOf(a) - CANDIDATES.indexOf(b));
  return { id: v.id, choice: ranked[0]!, scores, margin: scores[ranked[0]!] - scores[ranked[1]!] };
}

export interface Eligibility {
  /** The day of the count (or poll). */
  day: number;
  /** Lived here this many days by `day` (§10.3: 10). */
  residencyDays?: number;
}

/** §10.3: 18+, and lived in Monde 10+ days by the count. (Day 90's roll deadline is the same day for a Day-100 count.) */
export const isEligible = (v: Voter, e: Eligibility): boolean =>
  v.age >= VOTING_AGE && e.day - v.arrivedDay >= (e.residencyDays ?? RESIDENCY_DAYS);

/** §10.3 turnout for one voter. */
export function turnoutChance(s: Pick<Scores, "fellow" | "vane">, spirit: number, canvassed = false): number {
  const T = TURNOUT;
  return clamp(T.base + T.perSpirit * spirit + (canvassed ? T.canvassed : 0) + (Math.abs(s.fellow - s.vane) > T.decidedGap ? T.decided : 0), 0, 1);
}
export const turnsOut = (worldSeed: number | string, v: Voter, s: Scores, spirit: number): boolean =>
  seededUnit("turnout", worldSeed, v.id) < turnoutChance(s, spirit, v.canvassed);

export type Tally = Record<Candidate, number>;
const emptyTally = (): Tally => ({ fellow: 0, vane: 0, moss: 0 });
const sharesOf = (t: Tally): Tally => {
  const total = t.fellow + t.vane + t.moss;
  return total ? { fellow: t.fellow / total, vane: t.vane / total, moss: t.moss / total } : emptyTally();
};
/** The leader, or 'tie' when the top two have the same count. */
export function leader(t: Tally): Candidate | "tie" {
  const ranked = [...CANDIDATES].sort((a, b) => t[b] - t[a]);
  return t[ranked[0]!] === t[ranked[1]!] ? "tie" : ranked[0]!;
}

/**
 * §10.3: a tie at the top goes to the postal votes of the Departed who left with Regard ≥ 40 toward the player. They
 * vote for the Fellow, so they only count when the Fellow is one of the tied (GDD-GAP: a Vane–Moss tie stays a tie).
 */
export const postalVotes = (votes: Tally, departedRegard: readonly number[]): number =>
  leader(votes) === "tie" && votes.fellow === Math.max(votes.vane, votes.moss) ? departedRegard.filter(r => r >= POSTAL_REGARD).length : 0;

export interface CountResult {
  eligible: number;
  turnout: number;
  votes: Tally;
  /** 0..1 of the votes cast (postal votes included). */
  shares: Tally;
  winner: Candidate | "tie";
  /** Postal votes of the Departed, counted only to break a tie (§10.3). */
  postal: number;
  ballots: Ballot[];
}

/**
 * The count: every eligible voter who turns out casts their ballot. A tie at the top goes to the postal votes of the
 * Departed who left with Regard ≥ 40 (they vote for the Fellow).
 */
export function count(people: readonly Voter[], town: ModelTown, e: Eligibility, departedRegard: readonly number[] = []): CountResult {
  const scores = scoreAll(people, town);
  const voters = people.filter(v => isEligible(v, e));
  const ballots = voters.filter(v => turnsOut(town.worldSeed, v, scores.get(v.id)!, town.pillars.spirit))
    .map(v => ballot(v, scores.get(v.id)!, town.worldSeed));
  const votes = emptyTally();
  for (const b of ballots) votes[b.choice]++;
  const postal = postalVotes(votes, departedRegard);
  votes.fellow += postal;
  return { eligible: voters.length, turnout: voters.length ? ballots.length / voters.length : 0, votes, shares: sharesOf(votes), winner: leader(votes), postal, ballots };
}

export interface PollResult {
  sample: number;
  votes: Tally;
  shares: Tally;
  /** The honest margin of error, ±, as a share (1/√n: about ±18% for 30). */
  margin: number;
  leader: Candidate | "tie";
  ballots: Ballot[];
}

/** The 95% margin for a sample of n, rounded the way a newspaper prints it: 1/√n. */
export const marginOfError = (n: number): number => (n > 0 ? 1 / Math.sqrt(n) : 1);

/**
 * A poll: `sample` seeded eligible voters, each asked who they'd vote for (no turnout: they were asked). `key` names
 * the poll, so two polls draw different people and the same poll always draws the same ones.
 */
export function poll(people: readonly Voter[], town: ModelTown, e: Eligibility, key: string, sample = POLL_SAMPLE): PollResult {
  const scores = scoreAll(people, town);
  const asked = people.filter(v => isEligible(v, e))
    .map(v => ({ v, r: seededUnit("poll", town.worldSeed, key, v.id) }))
    .sort((a, b) => a.r - b.r || a.v.id.localeCompare(b.v.id))
    .slice(0, Math.max(0, sample)).map(x => x.v);
  const ballots = asked.map(v => ballot(v, scores.get(v.id)!, town.worldSeed));
  const votes = emptyTally();
  for (const b of ballots) votes[b.choice]++;
  return { sample: ballots.length, votes, shares: sharesOf(votes), margin: marginOfError(ballots.length), leader: leader(votes), ballots };
}
