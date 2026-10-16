// The §10.3 voter model, the Spring electorate and the Straw Poll (MVP G-11). §10.3 has no worked example, so the
// examples here are worked by hand from its formulas (each comment shows the arithmetic).
import { describe, expect, it } from "vitest";
import {
  CANDIDATES, DAY_ONE_ADULTS, FAIR_HEADCOUNT, JITTER_SD, ballot, count, fairBallots, fairBand, fear, isEligible, jitter,
  leader, percentages, poll, portPrior, postalVotes, quoteBand, record, reg, scoreAll, springElectorate, strawPoll,
  turnoutChance, type ElectorCard, type ModelTown, type Voter,
} from "../election";

const EVEN = { prosperity: 0.25, safety: 0.25, spirit: 0.25, charm: 0.25 };
const DAY1 = { prosperity: 18, safety: 30, spirit: 22, charm: 25 };
const voter = (id: string, over: Partial<Voter> = {}): Voter => ({
  id, named: true, age: 40, district: "old_quarter", values: EVEN, arrivedDay: 1, regard: null, deeds: 0,
  vaneRegard: 0, mossRegard: 0, port: 0, ferryFolk: false, friends: [], ...over,
});
const town = (pillars = DAY1, seed: number | string = 7): ModelTown => ({ worldSeed: seed, pillars, day1: DAY1 });

describe("§10.3 scores", () => {
  it("Player, Vane and Moss for one voter, by hand", () => {
    // Pillars moved +10 / 0 / +20 / +10 since Day 1; Prosperity is 28.
    const now = { prosperity: 28, safety: 30, spirit: 42, charm: 35 };
    const v = voter("v", { regard: 50, vaneRegard: 20, port: -30, mossRegard: 10 });
    const s = scoreAll([v], town(now)).get("v")!;
    // record = 0.25·(10 + 0 + 20 + 10)/50 = 0.2; Player = 0.40·0.5 + 0.35·0.2 = 0.27
    expect(s.parts.record).toBeCloseTo(0.2, 10);
    expect(s.fellow).toBeCloseTo(0.27, 10);
    // fear = (40 − 28)/40 · 0.25 = 0.075; Vane = 0.35·0.2 + 0.30·(−0.3) + 0.20·0.075 = −0.005
    expect(s.parts.fear).toBeCloseTo(0.075, 10);
    expect(s.vane).toBeCloseTo(-0.005, 10);
    // Moss = 0.10 + 0.30·0 + 0.10·0.1 = 0.11
    expect(s.moss).toBeCloseTo(0.11, 10);
  });

  it("record is clamped to −1..1 and fear is 0 once Prosperity reaches 40", () => {
    expect(record(EVEN, { prosperity: 100, safety: 100, spirit: 100, charm: 100 }, { prosperity: 0, safety: 0, spirit: 0, charm: 0 })).toBe(1);
    expect(fear(EVEN, 40)).toBe(0);
    expect(fear(EVEN, 0)).toBeCloseTo(0.25, 10);
  });

  it("a fisher (or a regular on the ferry) starts Moss at 0.40", () => {
    expect(scoreAll([voter("f", { ferryFolk: true })], town()).get("f")!.moss).toBeCloseTo(0.4, 10);
  });

  it("someone who never met the player goes on reputation: half their friends' mean Regard, plus deeds", () => {
    const a = voter("a", { regard: 60 }), b = voter("b"), x = voter("x", { friends: ["a", "b"], deeds: 10 });
    const byId = new Map([a, b, x].map(v => [v.id, v]));
    // (0.5 · mean(60, 0) + 10) / 100 = 0.25
    expect(reg(x, byId)).toBeCloseTo(0.25, 10);
    // Met: their own Regard and nothing else.
    expect(reg(a, byId)).toBeCloseTo(0.6, 10);
  });

  it("social is 0.15 × the friends' mean lean, carried two rounds", () => {
    // Prosperity 40 (no fear) and no change since Day 1 (no record).
    const calm = { prosperity: 40, safety: 30, spirit: 22, charm: 25 };
    // Y: met, Regard 100, nothing else → Player 0.40, Vane 0: lean 0.4. X counts Y a friend; Z counts X.
    const y = voter("y", { regard: 100 }), x = voter("x", { friends: ["y"] }), z = voter("z", { friends: ["x"] });
    const s = scoreAll([y, x, z], { worldSeed: 1, pillars: calm, day1: calm });
    // X: reputation 0.5·100/100 = 0.5 → Player 0.20; social 0.15·0.4 = 0.06 → 0.26
    expect(s.get("x")!.fellow).toBeCloseTo(0.26, 10);
    // Z: reputation 0.5·mean(X's Regard: never met, 0) = 0; round 1: 0.15·0.20 = 0.03; round 2: 0.15·(0.20 + 0.06) = 0.039
    expect(s.get("z")!.parts.social).toBeCloseTo(0.039, 10);
    expect(s.get("z")!.fellow).toBeCloseTo(0.039, 10);
  });
});

describe("§10.3 votes", () => {
  it("the jitter is fixed by world seed and voter, N(0, 0.08)", () => {
    expect(jitter(3, "pell", "fellow")).toBe(jitter(3, "pell", "fellow"));
    expect(jitter(3, "pell", "fellow")).not.toBe(jitter(4, "pell", "fellow"));
    const xs = Array.from({ length: 4000 }, (_, i) => jitter(11, `v${i}`, "vane"));
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    expect(Math.abs(m)).toBeLessThan(0.006);
    expect(sd).toBeGreaterThan(JITTER_SD * 0.94);
    expect(sd).toBeLessThan(JITTER_SD * 1.06);
  });

  it("a ballot goes to the highest jittered score; a candidate votes for themselves", () => {
    const v = voter("v", { regard: 100 });
    const s = scoreAll([v], town()).get("v")!;
    const b = ballot(v, s, 1);
    const top = [...CANDIDATES].sort((p, q) => b.scores[q] - b.scores[p])[0];
    expect(b.choice).toBe(top);
    expect(ballot(voter("moss", { candidate: "moss" }), s, 1).choice).toBe("moss");
  });

  it("turnout: 0.55 + 0.004·Spirit + 0.10 canvassed + 0.10 when the gap is over 0.3", () => {
    expect(turnoutChance({ fellow: 0.5, vane: 0.1 }, 50)).toBeCloseTo(0.85, 10);
    expect(turnoutChance({ fellow: 0.2, vane: 0.1 }, 50, true)).toBeCloseTo(0.85, 10);
    expect(turnoutChance({ fellow: 0.2, vane: 0.1 }, 0)).toBeCloseTo(0.55, 10);
  });

  it("eligibility: 18+, and 10 days in Monde by the count", () => {
    expect(isEligible(voter("a", { age: 17 }), { day: 25 })).toBe(false);
    expect(isEligible(voter("a", { arrivedDay: 16 }), { day: 25 })).toBe(false);
    expect(isEligible(voter("a", { arrivedDay: 15 }), { day: 25 })).toBe(true);
  });

  it("ties go to the postal votes of the Departed with Regard ≥ 40, when the Fellow is in the tie", () => {
    expect(leader({ fellow: 3, vane: 3, moss: 1 })).toBe("tie");
    expect(postalVotes({ fellow: 3, vane: 3, moss: 1 }, [55, 39, 40])).toBe(2);
    expect(postalVotes({ fellow: 4, vane: 3, moss: 1 }, [55])).toBe(0);
    expect(postalVotes({ fellow: 1, vane: 3, moss: 3 }, [55])).toBe(0);
  });

  it("a count is reproducible from the same inputs, and a reload never rerolls anyone", () => {
    const people = Array.from({ length: 60 }, (_, i) => voter(`v${i}`, { regard: (i % 7) * 10, vaneRegard: (i % 5) * 8 }));
    const a = count(people, town(), { day: 25 }), b = count(JSON.parse(JSON.stringify(people)) as Voter[], town(), { day: 25 });
    expect(b).toEqual(a);
    expect(a.eligible).toBe(60);
    expect(a.turnout).toBeGreaterThan(0.4);
    expect(a.shares.fellow + a.shares.vane + a.shares.moss).toBeCloseTo(1, 10);
  });

  it("a poll samples seeded voters and prints an honest margin (about ±18% for 30)", () => {
    const people = Array.from({ length: 100 }, (_, i) => voter(`v${i}`));
    const p = poll(people, town(), { day: 25 }, "sat-70");
    expect(p.sample).toBe(30);
    expect(p.margin).toBeCloseTo(0.183, 3);
    expect(poll(people, town(), { day: 25 }, "sat-70")).toEqual(p);
    const other = poll(people, town(), { day: 25 }, "sat-77");
    expect(other.ballots.map(b => b.id)).not.toEqual(p.ballots.map(b => b.id));
  });
});

// ── The Spring electorate ─────────────────────────────────────────────────────

const card = (id: string, age: number, home: string, over: Partial<ElectorCard> = {}): ElectorCard =>
  ({ id, name: id, age, kind: "canon", occupation: "baker", home, values: EVEN, relationships: [], ...over });
const CAST: ElectorCard[] = [
  ...["augusta", "bertrand", "delphine", "felix", "hollis", "ines", "june", "kasimir", "margo", "nell", "odile", "pell", "priya", "rook", "rosalind", "sable", "teo"]
    .map((id, i) => card(id, 30 + i, ["old_quarter.a", "market_row.b", "wharf.c", "millbrook.d"][i % 4]!)),
  card("tib", 11, "old_quarter.okafor_house"),
  card("ada", 38, "old_quarter.okafor_house", { kind: "resident", occupation: "Ferry ticket clerk" }),
  card("bru", 25, "millbrook.terrace_row", { kind: "resident", occupation: "Tollman, the crew's bruiser" }),
  card("nettie", 19, "millbrook.terrace_row", { kind: "resident", occupation: "Tollman, the lookout" }),
  card("moss", 74, "wharf.boathouse", { kind: "resident", occupation: "Skipper of the ferry Gannet" }),
  card("bastien", 6, "market_row.bakery", { kind: "animal" }),
  card("vane", 48, "offmap.city"),
];
const electorate = (over: { regard?: number; met?: boolean; flags?: string[]; seed?: number } = {}) => springElectorate({
  worldSeed: over.seed ?? 5, day: 25, cards: CAST, regard: () => over.regard ?? 0, met: () => over.met ?? false, arrivals: [],
  deeds: { scuffles: [], projects: [] }, flags: new Set(over.flags ?? []),
});

describe("the Spring electorate", () => {
  it("is Monde's 187 grown-ups (A.1.4): 17 of the core cast, the 4 carded people of the 192, and 166 more", () => {
    const people = electorate();
    const adults = people.filter(v => isEligible(v, { day: 25 }));
    expect(adults).toHaveLength(187);
    expect(Object.values(DAY_ONE_ADULTS).reduce((s, b) => s + b![0] + b![1] + b![2], 0)).toBe(170);
    expect(people.some(v => v.id === "vane" || v.id === "bastien")).toBe(false);
    expect(people.find(v => v.id === "tib")!.age).toBe(11);
    expect(people.find(v => v.id === "moss")!.candidate).toBe("moss");
    expect(people.filter(v => !v.named)).toHaveLength(166);
  });

  it("is the same town for the same world seed, and a different one for another", () => {
    expect(electorate({ seed: 9 })).toEqual(electorate({ seed: 9 }));
    expect(electorate({ seed: 9 }).map(v => v.values)).not.toEqual(electorate({ seed: 10 }).map(v => v.values));
  });

  it("strangers' values are A.2's archetype values jittered within ±0.10 and renormalised", () => {
    for (const v of electorate().filter(x => !x.named)) {
      const sum = v.values.prosperity + v.values.safety + v.values.spirit + v.values.charm;
      expect(sum).toBeCloseTo(1, 10);
      for (const w of Object.values(v.values)) expect(w).toBeGreaterThan(0.03);
    }
  });

  it("the Option Clause in the paper turns the town against Port Vane", () => {
    const before = electorate().reduce((s, v) => s + v.port, 0), after = electorate({ flags: ["option_public"] }).reduce((s, v) => s + v.port, 0);
    expect(after).toBeLessThan(before);
    expect(portPrior(EVEN, { tollman: true })).toBeGreaterThan(portPrior(EVEN, { fisher: true }));
  });

  it("a Fellow the whole town likes outpolls one nobody has met", () => {
    const pillars = { prosperity: 30, safety: 36, spirit: 45, charm: 48 };
    const liked = count(electorate({ regard: 60, met: true }), town(pillars), { day: 25 });
    const unknown = count(electorate(), town(DAY1), { day: 25 });
    expect(liked.shares.fellow).toBeGreaterThan(unknown.shares.fellow + 0.3);
    expect(unknown.winner).not.toBe("fellow");
  });
});

describe("the Spring Straw Poll", () => {
  it("takes one bean per grown-up at the fair: 28 / 65 / 169", () => {
    expect([fairBallots("low"), fairBallots("mid"), fairBallots("high")]).toEqual([28, 65, 169]);
    expect(FAIR_HEADCOUNT).toEqual({ low: 31, mid: 73, high: 190 });
    expect([fairBand(34.9), fairBand(35), fairBand(59.9), fairBand(60)]).toEqual(["low", "mid", "mid", "high"]);
  });

  it("prints whole percentages that add to 100, and the carded voters' leans", () => {
    const r = strawPoll(electorate({ regard: 30, met: true }), town({ prosperity: 25, safety: 32, spirit: 40, charm: 38 }), "mid");
    expect(r.ballots).toBe(65);
    const pct = percentages(r.shares);
    expect(pct.fellow + pct.vane + pct.moss).toBe(100);
    expect(r.margin).toBeCloseTo(1 / Math.sqrt(65), 3);
    expect(r.leans.length).toBe(20); // 21 carded grown-ups, less Moss (a candidate)
    expect(r.leans.every(l => quoteBand({ choice: l.choice, margin: 1 }) !== "torn")).toBe(true);
  });

  it("quote bands: torn under 0.04, a strong Fellow lean at 0.15", () => {
    expect(quoteBand({ choice: "vane", margin: 0.03 })).toBe("torn");
    expect(quoteBand({ choice: "fellow", margin: 0.2 })).toBe("fellow_strong");
    expect(quoteBand({ choice: "fellow", margin: 0.1 })).toBe("fellow");
    expect(quoteBand({ choice: "moss", margin: 0.1 })).toBe("moss");
  });
});
