import { describe, expect, it } from "vitest";
import {
  AFFINITY_SOURCES, EMPTY_TALK_LEDGER, PAIR_EMOTES, REGARD_EARNING, ambientEncounterDelta, applyAffinity, applyTalkDelta,
  applyTalkTurn, areFamily, areFriends, clampSourceDelta, driftDelta, encounterChance, encounterRoll, gainedWholeHeart,
  giftRegard, heartRow, heartsOf, labelForMean, meetingDelta, neglectDelta, pairKey, pairLabel, pairMean,
  romanceEligibility, romanceFlag, romancePartners, romanceStageOf, tieMilestone,
  type AffinityEdge, type PairLabel, type RomanceCard, type TalkLedger,
} from "../friendship";
import { LIMITS } from "../clamps";
import { regardTier } from "../state";

describe("hearts (§9.11.1)", () => {
  it("shows one heart per 10 Regard, half hearts at 5, and a cracked heart below 0", () => {
    const cases: [number, number][] = [[-30, 0], [0, 0], [4, 0], [5, 0.5], [9, 0.5], [10, 1], [19, 1.5], [39, 3.5], [40, 4], [69, 6.5], [70, 7], [100, 10], [140, 10]];
    for (const [regard, hearts] of cases) expect(heartsOf(regard), `regard ${regard}`).toBe(hearts);
    expect(heartRow(-1)).toEqual({ hearts: 0, full: 0, half: false, cracked: true });
    expect(heartRow(0)).toEqual({ hearts: 0, full: 0, half: false, cracked: false });
    expect(heartRow(45)).toEqual({ hearts: 4.5, full: 4, half: true, cracked: false });
  });

  it("lines up with the Regard tiers (§10.2)", () => {
    expect([regardTier(19), heartRow(19).full]).toEqual(["Stranger", 1]);
    expect([regardTier(20), heartRow(20).full]).toEqual(["Neighbor", 2]);
    expect([regardTier(40), heartRow(40).full]).toEqual(["Friend", 4]);
    expect([regardTier(70), heartRow(70).full]).toEqual(["Confidant", 7]);
  });

  it("chimes only for a new whole heart", () => {
    expect(gainedWholeHeart(38, 40)).toBe(true);
    expect(gainedWholeHeart(40, 44)).toBe(false);
    expect(gainedWholeHeart(41, 46)).toBe(false);
    expect(gainedWholeHeart(-5, 10)).toBe(true);
    expect(gainedWholeHeart(50, 40)).toBe(false);
  });
});

describe("earning Regard (§9.11.2)", () => {
  it("values gifts by reaction, doubled on birthdays", () => {
    expect(["love", "like", "neutral", "dislike"].map((r) => giftRegard(r as "love"))).toEqual([8, 4, 1, -4]);
    expect(giftRegard("love", { birthday: true })).toBe(16);
    expect(giftRegard("dislike", { birthday: true })).toBe(-8);
  });

  it("caps a day's conversation gains at +6 and never caps a loss", () => {
    expect(applyTalkDelta(4, 0)).toEqual({ applied: 4, gains: 4, capped: false });
    expect(applyTalkDelta(4, 4)).toEqual({ applied: 2, gains: 6, capped: true });
    expect(applyTalkDelta(3, 6)).toEqual({ applied: 0, gains: 6, capped: true });
    expect(applyTalkDelta(-5, 6)).toEqual({ applied: -5, gains: 6, capped: false });
    expect(applyTalkDelta(0, 6)).toEqual({ applied: 0, gains: 6, capped: false });
    expect(applyTalkDelta(2.6, 0).applied).toBe(3);
  });

  it("gives the first chat of the day +1 inside the cap, then the reply judgments", () => {
    const first = applyTalkTurn(10, EMPTY_TALK_LEDGER, 3, 0);
    expect(first.change).toEqual({ before: 10, after: 11, delta: 1, hearts_before: 1, hearts_after: 1, first_chat: true, capped: false });
    expect(first.ledger).toEqual({ day: 3, gains: 1, lastTalkDay: 3 });
    const second = applyTalkTurn(first.regard, first.ledger, 3, 5);
    expect(second.change).toMatchObject({ delta: 5, first_chat: false, capped: false });
    const third = applyTalkTurn(second.regard, second.ledger, 3, 4);
    expect(third.change).toMatchObject({ delta: 0, capped: true, after: 16 });
    const rude = applyTalkTurn(third.regard, third.ledger, 3, -3);
    expect(rude.change).toMatchObject({ delta: -3, after: 13 });
    expect(rude.ledger.gains).toBe(6);
    // The next day starts over.
    const tomorrow = applyTalkTurn(rude.regard, rude.ledger, 4, 5);
    expect(tomorrow.change).toMatchObject({ delta: 6, first_chat: true, capped: false });
    expect(tomorrow.ledger).toEqual({ day: 4, gains: 6, lastTalkDay: 4 });
  });

  it("never resets the cap or repeats the first chat for a turn stamped with an earlier day", () => {
    const today = { day: 5, gains: 6, lastTalkDay: 5 };
    const stale = applyTalkTurn(30, today, 4, 4);
    expect(stale.change).toMatchObject({ delta: 0, first_chat: false, capped: true });
    expect(stale.ledger).toEqual(today);
  });

  it("clamps to −100..100 and reports what actually moved", () => {
    const top = applyTalkTurn(98, { day: 2, gains: 0, lastTalkDay: 1 }, 2, 5);
    expect(top.change).toMatchObject({ before: 98, after: 100, delta: 2, hearts_after: 10 });
    const bottom = applyTalkTurn(-98, { day: 2, gains: 3, lastTalkDay: 2 }, 2, -5);
    expect(bottom.change).toMatchObject({ after: -100, delta: -2 });
  });

  it("lets a player who talks well every day reach Friend (4 hearts) by Day 10, +6 a day at most", () => {
    let regard = 0;
    let ledger: TalkLedger = EMPTY_TALK_LEDGER;
    let friendDay: number | null = null;
    for (let day = 1; day <= 10; day++) {
      const start = regard;
      for (const proposed of [3, 4, 2, 5]) ({ regard, ledger } = applyTalkTurn(regard, ledger, day, proposed));
      expect(regard - start).toBe(REGARD_EARNING.talkDailyCap);
      if (friendDay === null && heartRow(regard).full >= 4) friendDay = day;
    }
    expect(friendDay).toBe(7);
  });

  it("applies neglect every 3 days without a word, only above 40, never below it", () => {
    expect([6, 7, 8, 9, 10, 11].map((day) => neglectDelta(50, 5, day))).toEqual([0, 0, -1, 0, 0, -1]);
    expect(neglectDelta(41, 5, 8)).toBe(-1);
    expect(neglectDelta(40, 5, 8)).toBe(0);
    expect(neglectDelta(30, 5, 8)).toBe(0);
    expect(neglectDelta(50, null, 3)).toBe(-1);
    expect(neglectDelta(50, 8, 8)).toBe(0);
  });
});

describe("pair labels (§9.11.3)", () => {
  it("labels a pair by the mean of both directions", () => {
    const cases: [number | null, number | null, PairLabel][] = [
      [null, null, "strangers"], [0, 0, "acquaintances"], [45, 35, "friends"], [39, 40, "acquaintances"],
      [70, 70, "close_friends"], [80, 59, "friends"], [-19, -19, "acquaintances"], [-19, -20, "acquaintances"],
      [-20, -20, "rivals"], [-59, -60, "rivals"], [-60, -60, "enemies"], [-100, 20, "rivals"], [50, null, "acquaintances"],
      [null, 90, "friends"],
    ];
    for (const [ab, ba, label] of cases) expect(pairLabel(ab, ba), `${ab}/${ba}`).toBe(label);
    expect(pairMean(null, undefined)).toBeNull();
    expect(labelForMean(-19.5)).toBe("acquaintances");
    expect(labelForMean(-59.5)).toBe("rivals");
    expect(areFriends(40, 40)).toBe(true);
    expect(areFriends(60, 10)).toBe(false);
    expect(areFriends(null, null)).toBe(false);
  });

  it("gives Friends ♪, Close friends ♥, Rivals … and Enemies 💢", () => {
    expect(PAIR_EMOTES.friends?.glyph).toBe("♪");
    expect(PAIR_EMOTES.close_friends?.glyph).toBe("♥");
    expect(PAIR_EMOTES.rivals?.glyph).toBe("…");
    expect(PAIR_EMOTES.enemies?.glyph).toBe("💢");
    expect([PAIR_EMOTES.strangers, PAIR_EMOTES.acquaintances]).toEqual([null, null]);
  });

  it("records warming, cooling and making up as milestones, and nothing else", () => {
    expect(tieMilestone("acquaintances", "friends")).toBe("became_friends");
    expect(tieMilestone("friends", "close_friends")).toBe("became_close_friends");
    expect(tieMilestone("acquaintances", "close_friends")).toBe("became_close_friends");
    expect(tieMilestone("acquaintances", "rivals")).toBe("became_rivals");
    expect(tieMilestone("friends", "rivals")).toBe("became_rivals");
    expect(tieMilestone("rivals", "enemies")).toBe("became_enemies");
    expect(tieMilestone("rivals", "acquaintances")).toBe("made_up");
    expect(tieMilestone("enemies", "acquaintances")).toBe("made_up");
    for (const [from, to] of [["close_friends", "friends"], ["friends", "acquaintances"], ["enemies", "rivals"], ["strangers", "acquaintances"], ["friends", "friends"]] as const) {
      expect(tieMilestone(from, to), `${from}→${to}`).toBeNull();
    }
  });
});

describe("what moves affinity (§9.11.3)", () => {
  const edge = (affinity: number, netDay: number | null = null, net = 0): AffinityEdge => ({ affinity, netDay, net });

  it("clamps each source to its range", () => {
    expect(clampSourceDelta("encounter", 5)).toBe(3);
    expect(clampSourceDelta("encounter", -9)).toBe(-3);
    expect(clampSourceDelta("together", 4)).toBe(1);
    expect(clampSourceDelta("together", -1)).toBe(0);
    expect(clampSourceDelta("meeting", -4)).toBe(-1);
    expect(clampSourceDelta("gossip", 14)).toBe(10);
    expect(clampSourceDelta("introduce_favor", 25)).toBe(10);
    expect(clampSourceDelta("drift", -3)).toBe(-1);
    expect(LIMITS.gossip.relationship).toBe(AFFINITY_SOURCES.encounter);
  });

  it("caps a pair's net change at ±6 a day, each direction, apart from the Favor and the ladder", () => {
    let e = edge(10);
    const steps: number[] = [];
    for (const [delta, source] of [[3, "encounter"], [1, "together"], [10, "gossip"], [-2, "encounter"], [3, "encounter"]] as const) {
      const r = applyAffinity(e, 5, delta, source);
      steps.push(r.applied);
      e = r.edge;
    }
    expect(steps).toEqual([3, 1, 2, -2, 2]);
    expect(e).toEqual({ affinity: 16, netDay: 5, net: 6 });
    const favor = applyAffinity(e, 5, 10, "introduce_favor");
    expect(favor).toEqual({ applied: 10, edge: { affinity: 26, netDay: 5, net: 6 } });
    const tomorrow = applyAffinity(favor.edge, 6, -10, "gossip");
    expect(tomorrow).toEqual({ applied: -6, edge: { affinity: 20, netDay: 6, net: -6 } });
    expect(applyAffinity(edge(98), 1, 3, "encounter")).toEqual({ applied: 2, edge: { affinity: 100, netDay: 1, net: 2 } });
  });

  it("scores a town meeting by sides when both care (30+)", () => {
    expect(meetingDelta(40, 35)).toBe(1);
    expect(meetingDelta(-40, -90)).toBe(1);
    expect(meetingDelta(40, -30)).toBe(-1);
    expect(meetingDelta(29, -80)).toBe(0);
  });

  it("drifts 1 toward 40 for every week apart, only above 40", () => {
    expect([10, 12, 13, 19, 20].map((day) => driftDelta(60, 6, day))).toEqual([0, 0, -1, 0, -1]);
    expect(driftDelta(41, 0, 7)).toBe(-1);
    expect(driftDelta(40, 0, 7)).toBe(0);
    expect(driftDelta(-50, 0, 7)).toBe(0);
    expect(driftDelta(55, null, 14)).toBe(-1);
  });

  it("applies the Ambient rule from the two moods and the pair's affinity", () => {
    expect(ambientEncounterDelta(0, 30, 10)).toBe(1);
    expect(ambientEncounterDelta(0, 30, -50)).toBe(1);
    expect(ambientEncounterDelta(-70, 0, -10)).toBe(-1);
    expect(ambientEncounterDelta(-70, 0, 10)).toBe(0);
    expect(ambientEncounterDelta(-70, 0, null)).toBe(0);
    expect(ambientEncounterDelta(-30, 0, -10)).toBe(0); // "low" is neither even nor glum
  });
});

describe("encounters (§9.11.3)", () => {
  it("makes meeting likelier with affinity and with a plan", () => {
    expect(encounterChance(null, false)).toBeCloseTo(0.3);
    expect(encounterChance(60, false)).toBeCloseTo(0.48);
    expect(encounterChance(-60, false)).toBeCloseTo(0.12);
    expect(encounterChance(-100, false)).toBeCloseTo(0.05);
    expect(encounterChance(0, true)).toBeCloseTo(0.8);
    expect(encounterChance(100, true)).toBeCloseTo(0.95);
    for (let m = -100; m < 100; m += 10) expect(encounterChance(m + 10, false)).toBeGreaterThanOrEqual(encounterChance(m, false));
  });

  it("rolls the same number for a world, day and pair, whichever way round", () => {
    expect(encounterRoll(1234, 5, "odile", "june")).toBe(encounterRoll(1234, 5, "june", "odile"));
    expect(encounterRoll(1234, 5, "odile", "june")).not.toBe(encounterRoll(1234, 6, "odile", "june"));
    expect(encounterRoll(1234, 5, "odile", "june")).not.toBe(encounterRoll(1235, 5, "odile", "june"));
    expect(pairKey("odile", "june")).toBe("june+odile");
    const rolls = Array.from({ length: 2000 }, (_, i) => encounterRoll(7, i, "a", "b"));
    expect(rolls.every((r) => r >= 0 && r < 1)).toBe(true);
    const mean = rolls.reduce((s, r) => s + r, 0) / rolls.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(rolls.filter((r) => r < 0.3).length / rolls.length).toBeCloseTo(0.3, 1);
  });
});

describe("romance rules (§9.11.3)", () => {
  const card = (id: string, age: number, extra: Partial<RomanceCard> = {}): RomanceCard =>
    ({ id, age, kind: "canon", relationships: [], ...extra });
  const who = (c: RomanceCard, flags: string[] = []) => ({ card: c, flags });

  it("allows two unattached adults who aren't family", () => {
    expect(romanceEligibility(who(card("priya", 29)), who(card("kasimir", 38)))).toEqual({ ok: true });
  });

  it("refuses minors, animals, family, opt-outs and anyone already courting someone else", () => {
    const tib = card("tib", 11);
    const ada = card("ada", 38, { relationships: [{ id: "tib", affinity: 90, trust: 90, tag: "son", note: "" }] });
    expect(romanceEligibility(who(tib), who(card("june", 22)))).toEqual({ ok: false, reason: "minor" });
    expect(romanceEligibility(who(card("bastien", 6, { kind: "animal" })), who(card("odile", 64)))).toEqual({ ok: false, reason: "animal" });
    expect(romanceEligibility(who(ada), who(card("tib2", 30, { relationships: [{ id: "ada", affinity: 1, trust: 1, tag: "Cousin", note: "" }] })))).toEqual({ ok: false, reason: "family" });
    expect(areFamily(ada, tib)).toBe(true);
    expect(romanceEligibility(who(card("a", 40, { romance: false })), who(card("b", 40)))).toEqual({ ok: false, reason: "opted_out" });
    expect(romanceEligibility(who(card("a", 40), [romanceFlag("courting", "c")]), who(card("b", 40)))).toEqual({ ok: false, reason: "taken" });
    expect(romanceEligibility(who(card("a", 40), [romanceFlag("together", "b")]), who(card("b", 40)))).toEqual({ ok: true });
    expect(romanceEligibility(who(card("a", 40)), who(card("a", 40)))).toEqual({ ok: false, reason: "same" });
  });

  it("reads the pair's stage from either resident's flags", () => {
    expect(romancePartners(["met_player", "courting:roz", "together:", "nonsense:x"])).toEqual([{ stage: "courting", id: "roz" }]);
    expect(romanceStageOf("augusta", ["courting:roz"], "roz", [])).toBe("courting");
    expect(romanceStageOf("augusta", ["courting:roz"], "roz", ["together:augusta"])).toBe("together");
    expect(romanceStageOf("augusta", ["courting:roz"], "teo", [])).toBeNull();
  });
});
