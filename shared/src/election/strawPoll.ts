// The Spring Straw Poll (MVP G-11; MVP_PLAN §1: "runs the real voter model (§10.3): 'if the town voted today…'").
//
// At the Bloom Fair (Day 25, S10c) the Lantern asks the fair's grown-ups who they'd back if an election were held
// tomorrow and the Fellow stood against Mr. Vane and Old Moss: one bean in one of three jam jars. The ballots are §10.3
// ballots (scores plus the seeded jitter) from a seeded sample of the eligible voters, as big as the fair's crowd, and
// the paper prints them with an honest margin of error (§10.3: "polls are noisy on purpose"). The same model is also
// run over the whole electorate with turnout (`town`): what a real Day-25 count would have said, kept for the soak (H5)
// and the End-of-Spring report.
import { z } from "zod";
import { CANDIDATES, ballot, count, isEligible, marginOfError, poll, scoreAll, type Ballot, type Candidate, type ModelTown, type Voter } from "./voterModel";

/** §13.3a: Bloom Fair headcounts by Spirit band (31 / 73 / 190). */
export const FAIR_HEADCOUNT = { low: 31, mid: 73, high: 190 } as const;
export type FairBand = keyof typeof FAIR_HEADCOUNT;
/** A.1.4: 187 of the 210 are 18+. The jars take one bean per grown-up in the crowd. */
export const ADULT_SHARE = 187 / 210;
/** S10a's bands: Spirit < 35 low, < 60 mid, else high. */
export const fairBand = (spirit: number): FairBand => (spirit < 35 ? "low" : spirit < 60 ? "mid" : "high");
export const fairBallots = (band: FairBand): number => Math.round(FAIR_HEADCOUNT[band] * ADULT_SHARE);
/** The Spring framing of §10.3's eligibility: the poll is on Day 25, so 10+ days here means here by Day 15. */
export const SPRING_POLL_DAY = 25;

/** What a quoted resident's lean sounds like. `torn`: their top two are within a bean's width. */
export const QUOTE_BANDS = ["fellow_strong", "fellow", "torn", "vane", "moss"] as const;
export type QuoteBand = (typeof QUOTE_BANDS)[number];
/** GDD-GAP: no band edges in §10.3; a clear lean is 0.15 of score ahead, a torn voter less than 0.04. */
export const QUOTE_EDGES = { strong: 0.15, torn: 0.04 } as const;
export function quoteBand(b: Pick<Ballot, "choice" | "margin">): QuoteBand {
  if (b.margin < QUOTE_EDGES.torn) return "torn";
  if (b.choice === "fellow") return b.margin >= QUOTE_EDGES.strong ? "fellow_strong" : "fellow";
  return b.choice;
}

const tally = z.object({ fellow: z.number(), vane: z.number(), moss: z.number() });
const candidate = z.enum(CANDIDATES);
/** The saved poll (SaveGame.finale.poll), as the card, the Dawn Report and the End-of-Spring report read it. */
export const StrawPollRecord = z.object({
  day: z.number().int().positive(),
  band: z.enum(["low", "mid", "high"]),
  /** The jars: beans per candidate, shares 0..1, and the ± margin as a share. */
  ballots: z.number().int().nonnegative(),
  votes: tally,
  shares: tally,
  margin: z.number().nonnegative(),
  leader: z.union([candidate, z.literal("tie")]),
  /** The same model over the whole electorate with §10.3 turnout. */
  town: z.object({ eligible: z.number().int().nonnegative(), turnout: z.number(), shares: tally, winner: z.union([candidate, z.literal("tie")]) }),
  /** Every carded voter's lean (who they'd back and how firmly), for the quotes and the report. */
  leans: z.array(z.object({ id: z.string(), choice: candidate, band: z.enum(QUOTE_BANDS) })),
});
export type StrawPollRecord = z.infer<typeof StrawPollRecord>;

const round3 = (t: Record<Candidate, number>): Record<Candidate, number> =>
  ({ fellow: Math.round(t.fellow * 1000) / 1000, vane: Math.round(t.vane * 1000) / 1000, moss: Math.round(t.moss * 1000) / 1000 });

/** Run the Straw Poll: the fair's jars, the whole-town count, and the carded voters' leans. */
export function strawPoll(people: readonly Voter[], town: ModelTown, band: FairBand, day = SPRING_POLL_DAY): StrawPollRecord {
  const e = { day };
  const jars = poll(people, town, e, `spring-straw-poll-${day}`, fairBallots(band));
  const all = count(people, town, e);
  const scores = scoreAll(people, town);
  const leans = people.filter(v => v.named && isEligible(v, e) && !v.candidate).map(v => {
    const b = ballot(v, scores.get(v.id)!, town.worldSeed);
    return { id: v.id, choice: b.choice, band: quoteBand(b) };
  });
  return {
    day, band, ballots: jars.sample, votes: jars.votes, shares: round3(jars.shares), margin: Math.round(marginOfError(jars.sample) * 1000) / 1000,
    leader: jars.leader,
    town: { eligible: all.eligible, turnout: Math.round(all.turnout * 1000) / 1000, shares: round3(all.shares), winner: all.winner },
    leans,
  };
}

/** Whole percentages that add to 100 (largest remainder), in candidate order. */
export function percentages(shares: Record<Candidate, number>): Record<Candidate, number> {
  const total = CANDIDATES.reduce((s, c) => s + shares[c], 0);
  if (!total) return { fellow: 0, vane: 0, moss: 0 };
  const raw = CANDIDATES.map(c => ({ c, v: (shares[c] / total) * 100 }));
  const out = Object.fromEntries(raw.map(r => [r.c, Math.floor(r.v)])) as Record<Candidate, number>;
  let left = 100 - CANDIDATES.reduce((s, c) => s + out[c], 0);
  for (const r of [...raw].sort((a, b) => (b.v % 1) - (a.v % 1))) { if (left-- <= 0) break; out[r.c]++; }
  return out;
}
