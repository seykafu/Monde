import { describe, expect, it } from "vitest";
import {
  BIRTHDAY_PARTY, CAFE_DATE, ROMANCE_GROWTH, ROMANCE_LADDER, SEEDED_ROMANCES, atLeast, birthdayNotice, birthdaysOn,
  courtingCheck, courtingEventId, courtingMemoryText, courtingNotice, courtingReady, dateEventId, datingFlag, datingFlags,
  hasCrush, partyEventId, pickCourtships, romanceGrowth, romanceSeeded, romanticIntensity, throwsParty, type LadderEdge,
} from "../romance";
import { isBirthday } from "../economy";
import { areFamily, romanceEligibility, type RomanceCard } from "../friendship";
import { SavedFriendship, TieData, emptyFriendship } from "../friendshipData";

const edge = (extra: Partial<LadderEdge> = {}): LadderEdge =>
  ({ affinity: 75, feelingKind: "crush", feelingIntensity: 45, encounters: 6, tag: "spark", ...extra });

describe("the ladder's thresholds (§9.11.3)", () => {
  it("uses the GDD's numbers", () => {
    expect(ROMANCE_LADDER).toEqual({ crush: { affinity: 60, feeling: 40 }, courting: { affinity: 70, encounters: 5 } });
  });

  it("Crush: affinity ≥ 60 and a crush (or love) of 40 or more", () => {
    expect(hasCrush(edge({ affinity: 60, feelingIntensity: 40 }))).toBe(true);
    expect(hasCrush(edge({ affinity: 59, feelingIntensity: 90 }))).toBe(false);
    expect(hasCrush(edge({ affinity: 90, feelingIntensity: 39 }))).toBe(false);
    expect(hasCrush(edge({ feelingKind: "love", feelingIntensity: 40 }))).toBe(true);
    // Admiration and resentment aren't romance, however strong.
    expect(hasCrush(edge({ feelingKind: "admiration", feelingIntensity: 100 }))).toBe(false);
    expect(hasCrush(edge({ feelingKind: null, feelingIntensity: 0 }))).toBe(false);
    expect(romanticIntensity({ feelingKind: "resentment", feelingIntensity: 50 })).toBe(0);
    expect(romanticIntensity({ feelingKind: "crush", feelingIntensity: 33 })).toBe(33);
  });

  it("Courting: both at Crush, both ≥ 70 affinity, 5+ shared encounters", () => {
    expect(courtingCheck(edge({ affinity: 70 }), edge({ affinity: 70, encounters: 5 }))).toEqual({ ok: true });
    expect(courtingReady(edge(), edge())).toBe(true);
    // One-sided: a crush the other doesn't share is still a crush.
    expect(courtingCheck(edge(), edge({ feelingIntensity: 39 }))).toEqual({ ok: false, reason: "no_crush" });
    expect(courtingCheck(edge({ feelingKind: null, feelingIntensity: 0 }), edge())).toEqual({ ok: false, reason: "no_crush" });
    expect(courtingCheck(edge({ affinity: 69 }), edge())).toEqual({ ok: false, reason: "affinity" });
    expect(courtingCheck(edge(), edge({ affinity: 69 }))).toEqual({ ok: false, reason: "affinity" });
    expect(courtingCheck(edge({ encounters: 4 }), edge({ encounters: 9 }))).toEqual({ ok: false, reason: "encounters" });
    // Close friends (≥ 70 both ways) without feelings don't court.
    expect(courtingReady(edge({ affinity: 95, feelingKind: "admiration", feelingIntensity: 80 }), edge({ affinity: 95, feelingKind: null, feelingIntensity: 0 }))).toBe(false);
  });

  it("a resident courts one person: the warmer pair goes first, ties broken by the pair key", () => {
    const picked = pickCourtships([
      { a: "kasimir", b: "priya", mean: 74 },
      { a: "june", b: "priya", mean: 80 },
      { a: "bru", b: "kasimir", mean: 72 },
      { a: "ines", b: "teo", mean: 71 },
      { a: "augusta", b: "rosalind", mean: 71 },
    ]);
    expect(picked.map((c) => `${c.a}+${c.b}`)).toEqual(["june+priya", "bru+kasimir", "augusta+rosalind", "ines+teo"]);
    expect(pickCourtships([{ a: "x", b: "x", mean: 99 }])).toEqual([]);
  });

  it("orders the stages", () => {
    expect(atLeast("courting", "courting")).toBe(true);
    expect(atLeast("married", "courting")).toBe(true);
    expect(atLeast("courting", "together")).toBe(false);
    expect(atLeast(null, "courting")).toBe(false);
  });
});

describe("who may court (§9.11.3)", () => {
  it("knows family by `kin` when the tag says how they get on (Rook and Delphine are estranged)", () => {
    const rook: RomanceCard = { id: "rook", age: 33, kind: "canon", relationships: [{ id: "delphine", affinity: 75, trust: 30, tag: "estranged", kin: "mother", note: "" }] };
    const delphine: RomanceCard = { id: "delphine", age: 61, kind: "canon", relationships: [{ id: "rook", affinity: 65, trust: -45, tag: "estranged", note: "" }] };
    expect(areFamily(rook, delphine)).toBe(true);
    expect(areFamily(delphine, rook)).toBe(true);
    expect(romanceEligibility({ card: rook, flags: [] }, { card: delphine, flags: [] })).toEqual({ ok: false, reason: "family" });
    expect(areFamily({ ...rook, relationships: [{ ...rook.relationships[0]!, kin: undefined }] }, delphine)).toBe(false);
  });

  it("treats a Day-1 marriage as spoken for, and a courtship as spoken for to everyone else", () => {
    const adult = (id: string): RomanceCard => ({ id, age: 40, kind: "resident", relationships: [] });
    expect(romanceEligibility({ card: adult("a"), flags: ["married:c"] }, { card: adult("b"), flags: [] })).toEqual({ ok: false, reason: "taken" });
    expect(romanceEligibility({ card: adult("a"), flags: ["courting:b"] }, { card: adult("b"), flags: ["courting:a"] })).toEqual({ ok: true });
  });
});

describe("feelings from time together", () => {
  it("grows a seeded tie's crush by 5 after a warm encounter, once they count each other friends", () => {
    expect(ROMANCE_GROWTH).toEqual({ step: 5, minAffinity: 40 });
    const spark = edge({ affinity: 45, feelingKind: null, feelingIntensity: 0, tag: "spark" });
    expect(romanceSeeded(spark)).toBe(true);
    expect(romanceGrowth(spark, 2, true)).toEqual({ kind: "crush", delta: 5 });
    // Below Friend (40), time together warms them but not yet that way.
    expect(romanceGrowth({ ...spark, affinity: 39 }, 3, true)).toBeNull();
    // A cold encounter cools a crush they have, and does nothing to one they don't.
    expect(romanceGrowth(edge({ feelingIntensity: 20 }), -1, true)).toEqual({ kind: "crush", delta: -5 });
    expect(romanceGrowth(spark, -2, true)).toBeNull();
    expect(romanceGrowth(spark, 0, true)).toBeNull();
  });

  it("grows love if that's what they feel, and any romantic feeling the model has recorded", () => {
    expect(romanceGrowth(edge({ feelingKind: "love", feelingIntensity: 50, tag: "fond" }), 1, true)).toEqual({ kind: "love", delta: 5 });
    const modelSeeded = edge({ tag: "acquaintance", feelingKind: "crush", feelingIntensity: 10, affinity: 50 });
    expect(romanceSeeded(modelSeeded)).toBe(true);
    expect(romanceGrowth(modelSeeded, 3, true)).toEqual({ kind: "crush", delta: 5 });
  });

  it("never invents a feeling between friends nobody seeded, nor grows one between residents who may not court", () => {
    const friends = edge({ tag: "old_friend", feelingKind: "admiration", feelingIntensity: 30, affinity: 80 });
    expect(romanceSeeded(friends)).toBe(false);
    expect(romanceGrowth(friends, 3, true)).toBeNull();
    expect(romanceGrowth(edge(), 3, false)).toBeNull();
    expect(romanceGrowth(edge(), Number.NaN, true)).toBeNull();
  });
});

describe("what Courting brings", () => {
  it("maps the three seeded romances (§12.3) to their story flags, either way round", () => {
    expect(SEEDED_ROMANCES.map((r) => r.flag)).toEqual(["kasimir_priya_dating", "teo_ines_dating", "augusta_roz_dating"]);
    expect(datingFlag("priya", "kasimir")).toBe("kasimir_priya_dating");
    expect(datingFlag("teo", "ines")).toBe("teo_ines_dating");
    expect(datingFlag("rosalind", "augusta")).toBe("augusta_roz_dating");
    expect(datingFlag("june", "odile")).toBeNull();
  });

  it("sets a dating flag for a seeded pair courting or further, and only then", () => {
    expect(datingFlags([
      { a: "kasimir", b: "priya", romance: "courting" },
      { a: "augusta", b: "rosalind", romance: "together" },
      { a: "ines", b: "teo", romance: null },
      { a: "june", b: "odile", romance: "courting" },
    ])).toEqual(["augusta_roz_dating", "kasimir_priya_dating"]);
    expect(datingFlags([])).toEqual([]);
  });

  it("schedules a café date and words the notices", () => {
    expect(CAFE_DATE).toEqual({ place: "market_row.cafe_liss", daysAfter: 2, minute: 900, minutes: 60 });
    expect(courtingEventId("priya", "kasimir")).toBe("courting_kasimir+priya");
    expect(dateEventId("priya", "kasimir", 14)).toBe("date_kasimir+priya_14");
    expect(courtingNotice("Kasimir Wolanski", "Priya Ramaswamy")).toBe("Kasimir Wolanski and Priya Ramaswamy are courting.");
    // Hand-holding, walks and a café date (§9.13): nothing more is ever written for them.
    expect(courtingMemoryText("Priya")).toBe("Priya and I are courting now. We'll take tea at Café Liss.");
  });
});

describe("saved and restored", () => {
  it("keeps a tie's stage and crushes in the save, and reads older saves without them", () => {
    const tie = { a: "kasimir", b: "priya", label: "close_friends" as const, romance: "courting" as const, crush: ["kasimir", "priya"] };
    expect(TieData.parse(tie)).toEqual(tie);
    expect(TieData.parse({ a: "ines", b: "teo", label: "friends", romance: null })).toEqual({ a: "ines", b: "teo", label: "friends", romance: null });
    const saved = SavedFriendship.parse({ ...emptyFriendship(), ties: { day: 21, pairs: [tie] } });
    expect(saved.ties?.pairs[0]).toEqual(tie);
  });
});

describe("birthdays (§9.11.3 life events)", () => {
  const cards = [
    { id: "odile", name: "Odile Fournier", birthday: 4 },
    { id: "pell", name: "Edwina Pell", birthday: 8 },
    { id: "nell", name: "Nell Dunmore", birthday: 4 },
    { id: "new", name: "Ilse Maertens" },
  ];

  it("names everyone whose birthday it is, on the repeating 100-day calendar", () => {
    expect(birthdaysOn(cards, 4).map((c) => c.id)).toEqual(["odile", "nell"]);
    expect(birthdaysOn(cards, 104).map((c) => c.id)).toEqual(["odile", "nell"]);
    expect(isBirthday(8, 8)).toBe(true);
    expect(birthdayNotice(cards, 8)).toBe("Many happy returns today to Edwina Pell.");
    expect(birthdayNotice(cards, 4)).toBe("Many happy returns today to Odile Fournier and Nell Dunmore.");
    expect(birthdayNotice([...cards, { id: "x", name: "Bo", birthday: 4 }], 4)).toBe("Many happy returns today to Odile Fournier, Nell Dunmore and Bo.");
    expect(birthdayNotice(cards, 5)).toBeNull();
  });

  it("throws a party for a resident with 3+ friends", () => {
    expect(BIRTHDAY_PARTY.friends).toBe(3);
    expect(throwsParty(2)).toBe(false);
    expect(throwsParty(3)).toBe(true);
    expect(partyEventId("odile", 4)).toBe("birthday_party_odile_4");
  });
});
