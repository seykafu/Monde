// The engine's repair of a household reply before validation (A.3.7; "the model proposes, the engine disposes"): one
// test per repair, in the shapes the 2026-10-17 staging trial failed on (every reply parsed; every household failed all
// six attempts on these), the adjustments it reports, idempotency, and a passing reply coming back untouched.
import { describe, expect, it } from "vitest";
import {
  ROUTINE_PLACES, SeededRng, VERBS, censusOrder, clockTime, coinsFor, countWords, currencyHit, drawHousehold, nativeDrawFor, nativeTemplateHousehold,
  nativeValidationContext, nudgeBig5, pronounsOf, relationTagOf, repairHousehold, routineVerbFor, storyRoleOf, templateHousehold, trimToWords,
  validateHousehold, verbOf, type ArrivalHouseholdOutput, type HouseholdDraw, type SkeletonHousehold, type ValidationContext,
} from "../index";
import { censusInput, household, modelAnswer } from "./censusFixtures";

const codes = (v: ReturnType<typeof validateHousehold>) => (v.ok ? [] : v.errors);
const rules = (v: ReturnType<typeof validateHousehold>) => [...new Set(codes(v).map(e => e.split(" ")[0]))].sort();
const native = (id: string) => {
  const input = censusInput();
  const h = household(input, id);
  const draw = nativeDrawFor(input, h);
  const vctx = nativeValidationContext(input, h, draw);
  return { input, h, draw, vctx, out: modelAnswer(input, h, draw) };
};
const repair = (out: unknown, draw: HouseholdDraw, vctx: ValidationContext) => {
  const r = repairHousehold(out, draw, vctx);
  return { ...r, card: r.output as ArrivalHouseholdOutput };
};
const big5 = (open: number, conscientious: number, extravert: number, agreeable: number, neurotic: number) => ({ open, conscientious, extravert, agreeable, neurotic });

/** What the trial's replies looked like: a summary of 27-30 words (25 at most), a backstory of 140-146 (120 at most). */
const BARNEY_SUMMARY = "Barney has kept the till at Dunmore's for thirty years and lives in the flat above it. His sister Nell runs the fish market and visits on Sundays after chapel.";
const BARNEY_BACKSTORY = "Barney was born in the flat over the shop and has never slept anywhere else for more than a week. He started on the counter at twelve, standing on a crate to reach the till. When the mill closed he kept the shop open on credit for a whole winter, and half the street still owes him for it. He tells everyone the ledger is lost. It is in the biscuit tin under his bed, and he reads it some nights. His sister Nell left for Carrow at nineteen and came back at twenty-two, and he has never asked her why. He thinks the town will be full again by the time he retires. He wants Nell to admit, just once, that he was right to stay. He hand-letters the price cards every Monday, and he would rather nobody knew how long each one takes him.";
const BARNEY_KEPT = BARNEY_BACKSTORY.slice(0, BARNEY_BACKSTORY.indexOf(" He wants Nell"));

/** Barney's household (one member, two required ties) written the way the trial's replies failed. */
function barneyAsTrialWrote() {
  const t = native("dunmore_barney");
  const m = t.out.members[0]!;
  t.out.household.summary = BARNEY_SUMMARY;
  m.backstory = BARNEY_BACKSTORY;
  const day = m.routine.weekend;
  const street = day.findIndex(e => e.where === "market_row.market_street");
  day[street]!.where = "market_street";
  m.relationships = [
    // Nell's hand-written card has Barney at affinity 70, trust 80; the prompt told him to return it.
    { id: "nell", affinity: 70, trust: 80, tag: "family" as never, note: "His sister; thinks he never really left." },
    { id: "bru", affinity: 40, trust: 35, tag: "neighbour" as never, note: "Lends him a ladder and won't say why." },
    { id: "m1", affinity: 60, trust: 60, tag: "kin", note: "Same roof." },
    { id: "odile", affinity: 75, trust: 40, tag: "friend", note: "Buys her rye on credit." },
  ];
  m.likes = ["pigeons", "puzzles", "a quiet till"];
  return { ...t, street };
}

describe("lengths (V07, V06)", () => {
  it("trims at the last sentence that fits, else the last whole word, and only when over", () => {
    expect(countWords(BARNEY_BACKSTORY)).toBe(146);
    expect(trimToWords(BARNEY_BACKSTORY, 120)).toBe(BARNEY_KEPT);
    expect(countWords(BARNEY_SUMMARY)).toBe(30);
    expect(trimToWords(BARNEY_SUMMARY, 25)).toBe("Barney has kept the till at Dunmore's for thirty years and lives in the flat above it.");
    // One long sentence: whole words, an ellipsis, never half a word.
    const one = "Barney keeps the till at Dunmore's and lives above it, and his sister Nell runs the fish market down on the Wharf and visits every Sunday after chapel.";
    expect(trimToWords(one, 25)).toBe("Barney keeps the till at Dunmore's and lives above it, and his sister Nell runs the fish market down on the Wharf and visits every…");
    // A sentence that keeps under half the cap loses to the word cut (fitText's rule).
    expect(trimToWords("Short one. Then a much longer second sentence that runs on past the cap by a word or two more.", 12)).toBe("Short one. Then a much longer second sentence that runs on past…");
    expect(trimToWords(BARNEY_KEPT, 120)).toBe(BARNEY_KEPT);
  });

  it("brings the trial's 30-word summary and 146-word backstory within 25 and 120, and the household passes", () => {
    const { draw, vctx, out } = native("dunmore_barney");
    out.household.summary = BARNEY_SUMMARY;
    out.members[0]!.backstory = BARNEY_BACKSTORY;
    // Both are past A.3.7's 10% (the validator alone cuts 26-27 words at a sentence, and fails these).
    expect(codes(validateHousehold(out, draw, vctx))).toEqual(["V07 household.summary is 30 words; at most 25", "V07 members[0].backstory is 146 words; at most 120"]);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual(["V07 household.summary trimmed from 30 to 17 words", "V07 members[0].backstory trimmed from 146 to 114 words"]);
    expect(r.card.members[0]!.backstory).toBe(BARNEY_KEPT);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
  });

  it("trims the other capped texts too: occupation, register, samples, dream, stages, secrets, a three-sentence appearance", () => {
    const { draw, vctx, out } = native("dunmore_barney");
    const m = out.members[0]!;
    m.occupation = "keeps the till and the stockroom at Dunmore's General Store on Market Row, six days a week";
    m.appearance = `${m.appearance} He keeps a pencil behind one ear. The other ear has a second one.`;
    m.dream.text = `${m.dream.text} He has said so to nobody, not even Nell, and he would deny it if anyone asked him straight out.`;
    m.secrets = [{ text: "He can still recite the whole of the 1971 price list from memory, and does, very quietly, when the shop is empty and the kettle is on.", reveal: { regard_min: 60 } }];
    const r = repair(out, draw, vctx);
    expect(r.adjustments.map(a => a.split(" trimmed")[0])).toEqual(["V07 members[0].occupation", "V06 members[0].appearance", "V07 members[0].dream.text", "V07 members[0].secrets[0].text"]);
    expect(r.adjustments[1]).toMatch(/; 4 to 2 sentences$/);
    expect(r.card.members[0]!.occupation).toBe("keeps the till and the stockroom at Dunmore's General Store on Market…");
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
  });

  it("leaves an appearance alone when every cut would lose the one thing the portrait wears", () => {
    const { draw, vctx, out } = native("dunmore_barney");
    const m = out.members[0]!;
    m.appearance = "Broad and grey at the temples. Ink on his thumb from the price cards. Never seen without the brown work jacket.";
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual(["V06 members[0].appearance must be 1-2 sentences of at most 40 words"]);
  });
});

describe("enums (V01, V05, V13, V18)", () => {
  it("maps relationship tags through the synonym table", () => {
    for (const w of ["family", "brother", "Sister", "mother", "father", "son", "daughter", "cousin", "spouse", "husband", "wife", "partner", "sibling", "older brother", "brother-in-law", "Grandmother"])
      expect(relationTagOf(w), w).toBe("kin");
    for (const w of ["neighbour", "neighbor", "Neighbours", "colleague", "pal", "mate", "old friend", "crew"]) expect(relationTagOf(w), w).toBe("friend");
    for (const w of ["dislike", "enemy"]) expect(relationTagOf(w), w).toBe("rival");
    for (const w of ["cautious", "suspicious"]) expect(relationTagOf(w), w).toBe("wary");
    expect(relationTagOf("interested")).toBe("curious");
    expect(relationTagOf("Fond")).toBe("fond");
    for (const w of ["embarrassed", "not friendly", "", null]) expect(relationTagOf(w), String(w)).toBeNull();
  });

  it("an unknown tag is fond with positive affinity; otherwise the tie goes, unless it's the last", () => {
    const { draw, vctx, out } = native("dunmore_barney");
    const m = out.members[0]!;
    m.relationships.push(
      { id: "odile", affinity: 20, trust: 25, tag: "embarrassed" as never, note: "Owes her for a tray of buns." },
      { id: "pell", affinity: -10, trust: 0, tag: "grudging" as never, note: "Still sore about the bins." },
    );
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      'V01 members[0].relationships "odile".tag "embarrassed" → "fond" (not a tag; positive affinity)',
      'V01 members[0].relationships "pell": dropped ("grudging" is not a tag, affinity -10)',
    ]);
    expect(r.card.members[0]!.relationships.map(x => x.id)).toEqual(["nell", "bru", "odile"]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
    // A required tie keeps its place and takes the tag the engine requires.
    const kin = native("dunmore_barney");
    kin.out.members[0]!.relationships[0]!.tag = "fond";
    const k = repair(kin.out, kin.draw, kin.vctx);
    expect(k.adjustments).toEqual(['V14 members[0].relationships "nell".tag "fond" → "kin" (a required kin tie)']);
    // The last tie, unknowable: left for V01 to explain.
    const one = native("ramaswamy");
    one.out.members[0]!.relationships = [{ id: "pell", affinity: -5, trust: 10, tag: "grudging" as never, note: "Never liked the mayor." }];
    expect(repair(one.out, one.draw, one.vctx).adjustments).toEqual([]);
  });

  it("pronouns, story roles and routine verbs in another spelling", () => {
    expect([pronounsOf("He/Him"), pronounsOf("she"), pronounsOf("they / them / theirs"), pronounsOf("she/they"), pronounsOf("it")]).toEqual(["he/him", "she/her", "they/them", null, null]);
    expect([storyRoleOf("Favour-giver"), storyRoleOf("shop keeper"), storyRoleOf("teacher"), storyRoleOf(null)]).toEqual(["favor_giver", "shopkeeper", "none", "none"]);
    expect([verbOf("Socialising"), verbOf("napping"), verbOf("reads"), verbOf("playing music"), verbOf("loiter")]).toEqual(["socialize", "nap", "read", "play_music", null]);
    const { draw, vctx, out } = native("dunmore_barney");
    const m = out.members[0]!;
    m.pronouns = "He/Him" as never;
    m.story_role = "Shop keeper" as never;
    m.routine.weekday[1]!.do = "Working" as never;
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      'V05 members[0].pronouns "He/Him" → "he/him"', 'V18 members[0].story_role "Shop keeper" → "shopkeeper"', 'V13 members[0].routine.weekday[1].do "Working" → "work"',
    ]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
  });
});

describe("place ids (V13)", () => {
  it("gives a bare local id its zone when exactly one place has it, and leaves the rest for V13", () => {
    const { draw, vctx, out, h } = native("dunmore_barney");
    const m = out.members[0]!;
    const street = m.routine.weekend.findIndex(e => e.where === "market_row.market_street");
    m.routine.weekend[street]!.where = "market_street";
    m.workplace = "general_store";
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      'V13 members[0].workplace "general_store" → "market_row.general_store"',
      `V13 members[0].routine.weekend[${street}].where "market_street" → "market_row.market_street"`,
    ]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
    // "home" is the household's home; "home_07" is in several zones, so it stays for V13 to name.
    m.routine.weekend[0]!.where = "home";
    m.routine.weekend[street]!.where = "home_07";
    const again = repair(out, draw, vctx);
    expect(again.card.members[0]!.routine.weekend[0]!.where).toBe(h.home);
    expect(again.card.members[0]!.routine.weekend[street]!.where).toBe("home_07");
    expect(codes(validateHousehold(again.output, draw, vctx))).toEqual([`V13 members[0].routine.weekend: "home_07" is not a place id`]);
  });
});

describe("relationships (V14)", () => {
  it("keeps a required tie's numbers (Nell's card has Barney at 70), drops a tie to themself, holds the rest to ±60", () => {
    const { draw, vctx, out } = native("dunmore_barney");
    const m = out.members[0]!;
    m.relationships = [
      { id: "nell", affinity: 70, trust: 80, tag: "kin", note: "His sister." },
      { id: "bru", affinity: 40, trust: 35, tag: "friend", note: "Lends him a ladder." },
      { id: "m1", affinity: 60, trust: 60, tag: "kin", note: "Same roof." },
      { id: "odile", affinity: 75, trust: 32.5, tag: "friend", note: "Buys her rye on credit." },
    ];
    // A non-integer fails the contract before V14 looks; with whole numbers, V14 names the rest.
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([expect.stringMatching(/^V01 not the contract: members\.0\.relationships\.3\.trust .*int/)]);
    const whole = structuredClone(out);
    whole.members[0]!.relationships[3]!.trust = 32;
    expect(codes(validateHousehold(whole, draw, vctx))).toEqual([
      "V14 members[0].relationships: a member can't relate to themself",
      'V14 members[0].relationships "odile": affinity and trust must be integers within ±60',
    ]);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      'V14 members[0].relationships: dropped the tie to themself ("m1")',
      'V14 members[0].relationships "odile".affinity 75 → 60 (within ±60)',
      'V14 members[0].relationships "odile".trust 32.5 → 33',
    ]);
    expect(r.card.members[0]!.relationships.find(x => x.id === "nell")).toMatchObject({ affinity: 70, trust: 80 });
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
    // Pinned by id, the same: Barney's own id is no tie either.
    m.relationships[2]!.id = "barney";
    expect(repair(out, draw, vctx).adjustments[0]).toBe('V14 members[0].relationships: dropped the tie to themself ("barney")');
  });

  it("the native validator exempts required ties from ±60, and counts housemates as the household", () => {
    const { draw, vctx, out } = native("dunmore_barney");
    out.members[0]!.relationships[0] = { id: "nell", affinity: 70, trust: 80, tag: "kin", note: "His sister." };
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([]);
    out.members[0]!.relationships.push({ id: "odile", affinity: 61, trust: 0, tag: "fond", note: "Buys her rye." });
    expect(codes(validateHousehold(out, draw, vctx))).toEqual(['V14 members[0].relationships "odile": affinity and trust must be integers within ±60']);
    const raman = native("ramaswamy");
    raman.out.members[0]!.relationships = [{ id: "priya", affinity: 85, trust: 90, tag: "kin", note: "His daughter; the house is hers." }];
    expect(codes(validateHousehold(raman.out, raman.draw, raman.vctx))).toEqual([]);
  });

  it("a housemate's slot becomes their id; a second tie to one person goes", () => {
    const { draw, vctx, out } = native("ramaswamy");
    // Raman is m2; his daughter Priya (m1) has a hand-written card, so her slot isn't one the model writes.
    out.members[0]!.relationships = [
      { id: "m1", affinity: 85, trust: 90, tag: "daughter" as never, note: "The house is hers; he pretends otherwise." },
      { id: "priya", affinity: 80, trust: 80, tag: "kin", note: "His daughter." },
      { id: "Pell", affinity: 10, trust: 15, tag: "curious", note: "The mayor." },
    ];
    expect(codes(validateHousehold({ ...out, members: [{ ...out.members[0]!, relationships: out.members[0]!.relationships.map(r => ({ ...r, tag: "kin" as const })) }] }, draw, vctx)))
      .toEqual([
        'V14 members[0].relationships: "m1" is not a resident or a household slot', 'V14 members[0].relationships "m1": affinity and trust must be integers within ±60',
        'V14 members[0].relationships: "Pell" is not a resident or a household slot',
      ]);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      `V14 members[0].relationships "m1" → "priya" (a housemate's slot)`,
      'V14 members[0].relationships: dropped a second tie to "priya"',
      'V14 members[0].relationships "Pell" → "pell"',
      'V01 members[0].relationships "priya".tag "daughter" → "kin"',
    ]);
    expect(r.card.members[0]!.relationships).toEqual([
      { id: "priya", affinity: 85, trust: 90, tag: "kin", note: "The house is hers; he pretends otherwise." },
      { id: "pell", affinity: 10, trust: 15, tag: "curious", note: "The mayor." },
    ]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
  });

  it("leaves another member's slot as written: assembly resolves it to the household tie", () => {
    const { draw, vctx, out } = native("calloway");
    expect(out.members[0]!.relationships.map(r => r.id)).toContain("m2");
    out.members[0]!.relationships.push({ id: "dom", affinity: 80, trust: 80, tag: "kin", note: "His twin." });
    const r = repair(out, draw, vctx);
    // m2 is Dom (pinned): the second tie to him goes, the slot stays.
    expect(r.adjustments).toEqual(['V14 members[0].relationships: dropped a second tie to "dom"']);
    expect(r.card.members[0]!.relationships.map(x => x.id)).toEqual(["rook", "m2", "m3"]);
  });
});

describe("likes (V11)", () => {
  it("adds the archetype's likes until two qualify, keeping the model's own", () => {
    const { draw, vctx, out } = native("dunmore_barney");
    out.members[0]!.likes = ["pigeons", "puzzles", "a quiet till"];
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([expect.stringMatching(/^V11 members\[0\]\.likes: at least two must come from the archetype's list/)]);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual(['V11 members[0].likes: added "a till that rings", "hand-lettered signs" from the archetype\'s list']);
    expect(r.card.members[0]!.likes).toEqual(["pigeons", "puzzles", "a quiet till", "a till that rings", "hand-lettered signs"]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
  });

  it("drops the model's last non-qualifying likes to stay within five, never a qualifying one, and skips a dislike", () => {
    const { draw, vctx, out } = native("dunmore_barney");
    const m = out.members[0]!;
    // One qualifies (a gift: tea), and it's the last.
    m.likes = ["pigeons", "puzzles", "a quiet till", "the shipping forecast", "strong tea"];
    m.dislikes = ["a till that rings", "wet umbrellas", "being hurried"];
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([`V11 members[0].likes: added "hand-lettered signs" from the archetype's list; dropped "the shipping forecast" to stay within 5`]);
    expect(r.card.members[0]!.likes).toEqual(["pigeons", "puzzles", "a quiet till", "strong tea", "hand-lettered signs"]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
  });
});

describe("Big Five (V08)", () => {
  const maud = () => {
    const t = native("szabo_maud");
    const [m1, m2, m3] = t.out.members;
    m1!.personality.big5 = big5(8, 76, 76, 79, 49);
    m2!.personality.big5 = big5(59, 36, 59, 53, 81);
    // Jo, written a few points off his father on every trait.
    m3!.personality.big5 = big5(12, 70, 80, 75, 49);
    return t;
  };

  it("nudges the second member just apart, seeded by the household, within 0-100", () => {
    const { draw, vctx, out } = maud();
    expect(codes(validateHousehold(out, draw, vctx))).toEqual(["V08 members[0] and members[2] have too-similar Big Five scores"]);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0]).toMatch(/^V08 members\[2\]\.personality\.big5 nudged apart from members\[0\]: /);
    const before = out.members[2]!.personality.big5, after = r.card.members[2]!.personality.big5;
    const moved = (Object.keys(before) as (keyof typeof before)[]).filter(k => before[k] !== after[k]);
    expect(moved).toHaveLength(2);
    // Exactly 15 from the father on each moved trait: just enough. The cheapest pair here costs 20.
    for (const k of moved) expect(Math.abs(after[k] - out.members[0]!.personality.big5[k])).toBe(15);
    expect(moved.reduce((s, k) => s + Math.abs(after[k] - before[k]), 0)).toBe(20);
    expect(Object.values(after).every(v => Number.isInteger(v) && v >= 0 && v <= 100)).toBe(true);
    expect(repair(out, draw, vctx).card).toEqual(r.card);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
    // Members 0 and 1 were already apart: untouched.
    expect(r.card.members.slice(0, 2).map(m => m.personality.big5)).toEqual(out.members.slice(0, 2).map(m => m.personality.big5));
  });

  it("keeps a member's one strong trait (V08's 70+ or 30-), even when losing it would be cheaper", () => {
    const me = big5(50, 50, 50, 50, 28);
    // The cheapest move (neurotic 28 → 32, open 50 → 35: 19 points) would leave nothing at 70+ or 30-.
    const next = nudgeBig5(me, [big5(50, 50, 50, 50, 17)], SeededRng.of("t"))!;
    expect(next.neurotic).toBe(28);
    expect(Object.values(next).filter(v => v === 35 || v === 65)).toHaveLength(2);
    // Same seed, same answer; nothing to do, no move.
    expect(nudgeBig5(big5(12, 70, 80, 75, 49), [big5(8, 76, 76, 79, 49)], SeededRng.of("a"))).toEqual(nudgeBig5(big5(12, 70, 80, 75, 49), [big5(8, 76, 76, 79, 49)], SeededRng.of("a")));
    expect(nudgeBig5(big5(8, 76, 76, 79, 49), [big5(59, 36, 59, 53, 81)], SeededRng.of("a"))).toEqual(big5(8, 76, 76, 79, 49));
  });
});

describe("the whole repair", () => {
  it("reports every change, in order, for the trial's failures; the household then passes", () => {
    const { draw, vctx, out, street } = barneyAsTrialWrote();
    expect(validateHousehold(out, draw, vctx)).toMatchObject({ ok: false, errors: [expect.stringMatching(/^V01 not the contract: members\.0\.relationships\.0\.tag/)] });
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      "V07 household.summary trimmed from 30 to 17 words",
      "V07 members[0].backstory trimmed from 146 to 114 words",
      `V13 members[0].routine.weekend[${street}].where "market_street" → "market_row.market_street"`,
      'V14 members[0].relationships: dropped the tie to themself ("m1")',
      'V01 members[0].relationships "nell".tag "family" → "kin"',
      'V01 members[0].relationships "bru".tag "neighbour" → "friend"',
      'V14 members[0].relationships "odile".affinity 75 → 60 (within ±60)',
      'V11 members[0].likes: added "a till that rings", "hand-lettered signs" from the archetype\'s list',
    ]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
  });

  it("is idempotent: a repaired reply repairs to itself", () => {
    const cases = [barneyAsTrialWrote(), (() => {
      const t = native("szabo_maud");
      t.out.members[2]!.personality.big5 = { ...t.out.members[0]!.personality.big5 };
      t.out.members[1]!.relationships[0]!.tag = "cousin" as never;
      return t;
    })()];
    for (const { draw, vctx, out } of cases) {
      const once = repair(out, draw, vctx);
      expect(once.adjustments.length).toBeGreaterThan(0);
      const twice = repair(once.output, draw, vctx);
      expect(twice.adjustments).toEqual([]);
      expect(twice.output).toEqual(once.output);
    }
  });

  it("returns a reply that already passes unchanged, and never touches its input", () => {
    const input = censusInput();
    for (const h of censusOrder(input.skeleton, input.homes, input.pins) as SkeletonHousehold[]) {
      const draw = nativeDrawFor(input, h);
      const vctx = nativeValidationContext(input, h, draw);
      for (const out of [modelAnswer(input, h, draw), nativeTemplateHousehold(draw, vctx, input.skeleton.seed)]) {
        const r = repairHousehold(out, draw, vctx);
        expect(r.adjustments, h.id).toEqual([]);
        expect(r.output, h.id).toEqual(out);
      }
    }
    const { draw, vctx, out } = barneyAsTrialWrote();
    const copy = structuredClone(out);
    repairHousehold(out, draw, vctx);
    expect(out).toEqual(copy);
    expect(repairHousehold("not a household", draw, vctx)).toEqual({ output: "not a household", adjustments: [] });
  });
});

describe("an arrival household (the server's profile: ±30 outside, one like from the list)", () => {
  const PLACES = new Set([...ROUTINE_PLACES.map(p => p.id), "millbrook.school", "wharf.fish_market", "old_quarter.town_hall"]);
  const vctx: ValidationContext = { places: PLACES, residents: new Map([["pell", { name: "Edwina Pell" }], ["odile", { name: "Odile Fournier" }]]) };
  const draw = drawHousehold({
    seed: 7, day: 8, slot: 0, youthShare: 0.48, recent: [], alive: new Map(), portraitUses: new Map(), archetype: "retired_couple",
    facts: { day: 8, pillars: { prosperity: 21, safety: 33, spirit: 33, charm: 44 }, flags: new Set(), freeHomes: [{ home: "old_quarter.vacant_house_47", beds: 3 }], unrestoredHomes: 60, pupils: 9, storefrontsFree: 0 },
  })!;
  const answer = (): ArrivalHouseholdOutput => {
    const out = structuredClone(templateHousehold(draw, vctx, "model"));
    out.members.forEach(m => {
      m.backstory = `${m.name.split(" ")[0]} kept the books for a chandler in Port Sallow for eleven years and was wrong about the tides every single spring. Came for the light.`;
      m.voice.samples = ["Can't say I mind the wind.", "That's the third gull today. They've a system.", "Right. I'll put the kettle on."];
      m.values = { prosperity: m.values.prosperity + 0.05, safety: m.values.safety - 0.05, spirit: m.values.spirit, charm: m.values.charm };
    });
    return out;
  };

  it("repairs the same failures on the arrival rules, and a passing reply is left alone", () => {
    expect(repairHousehold(answer(), draw, vctx)).toEqual({ output: answer(), adjustments: [] });
    const out = answer();
    const [a, b] = out.members;
    out.household.summary = "They sold the chandlery in Port Sallow after forty years of tide tables and came for a quieter harbour, a garden, and a bench that faces the water at evening.";
    a!.relationships = [{ id: "m2", affinity: 90, trust: 85, tag: "husband" as never, note: "Forty years and counting." }, { id: "pell", affinity: 45, trust: 20, tag: "neighbor" as never, note: "Met the boat." }];
    a!.routine.weekend[1]!.where = "cafe_liss";
    a!.likes = ["crosswords", "the shipping forecast", "a dry cellar"];
    b!.personality.big5 = { ...a!.personality.big5 };
    const r = repair(out, draw, vctx);
    expect(r.adjustments.map(x => x.split(/ (?:trimmed|→|nudged|added)/)[0])).toEqual([
      "V07 household.summary", 'V13 members[0].routine.weekend[1].where "cafe_liss"', 'V01 members[0].relationships "m2".tag "husband"',
      'V01 members[0].relationships "pell".tag "neighbor"', 'V14 members[0].relationships "pell".affinity 45', "V11 members[0].likes:", "V08 members[1].personality.big5",
    ]);
    expect(r.card.members[0]!.relationships).toEqual([
      { id: "m2", affinity: 90, trust: 85, tag: "kin", note: "Forty years and counting." }, { id: "pell", affinity: 30, trust: 20, tag: "friend", note: "Met the boat." },
    ]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
    expect(rules(validateHousehold({ ...r.card, household: { ...r.card.household, summary: out.household.summary } }, draw, vctx))).toEqual(["V07"]);
  });

  it("gives an arrival's day V13's shape at home.own, and maps its verbs", () => {
    const out = answer();
    const day = out.members[0]!.routine.weekday;
    day[day.length - 1] = { at: "22:00", do: "socialize", where: "market_row.gull_and_anchor" };
    day[1]!.do = "stroll" as never;
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([expect.stringMatching(/^V01 not the contract: members\.0\.routine\.weekday\.1\.do/)]);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      'V13 members[0].routine.weekday[1].do "stroll" → "walk"', 'V13 members[0].routine.weekday: added "23:00" sleep at home.own (the day ends at home)',
    ]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
    expect(repair(r.output, draw, vctx).adjustments).toEqual([]);
  });
});

// ── The full census run (2026-10-17): 35 of 107 households fell back to the template on these ─────────────────────

/** V16 as the server and the census tool wire it: the lexical filters (none of these trip them) and the money matcher. */
const withMoney = (vctx: ValidationContext): ValidationContext => ({ ...vctx, banned: (t: string) => (currencyHit(t) ? ["money"] : []) });
const at = (time: string, verb: string, where: string) => ({ at: time, do: verb as never, where });

describe("money is coins (V16)", () => {
  it("swaps each money word for coins, keeping the number (the table next to the repair)", () => {
    for (const [from, to] of [
      ["Now where was I? The bread. A penny, it was. A penny.", "Now where was I? The bread. A coin, it was. A coin."],
      ["One penny, and he wanted change.", "One coin, and he wanted change."],
      ["Ten pence the loaf.", "Ten coins the loaf."], ["Twelve ha'pennies for the lot.", "Twelve coins for the lot."], ["Three pennies in the jar.", "Three coins in the jar."],
      ["Pennies, all of it.", "Coins, all of it."], ["PENNIES!", "COINS!"], ["a few pence", "a few coins"],
      ["Not worth a ha’penny.", "Not worth a coin."], ["A farthing a day, my mother said.", "A coin a day, my mother said."],
      ["Tuppence for the paper.", "Two coins for the paper."], ["Sixpence, and not a penny more.", "Six coins, and not a coin more."], ["A sixpence under the pillow.", "A coin under the pillow."],
      ["Every shilling went on coal.", "Every coin went on coal."], ["the last few shillings", "the last few coins"],
      // Old-money sums with a flagged word in them.
      ["Four and sixpence, the boots were.", "A few coins, the boots were."], ["Two shillings and sixpence a week.", "A few coins a week."],
      ["Two shillings and six, and we called it dear.", "A few coins, and we called it dear."], ["one and a ha'penny for the bun", "a few coins for the bun"],
      // The rest of the matcher: pounds as money, dollars, quid, cents, a money sign.
      ["Five pounds, dear.", "Five coins, dear."], ["A pound a week, the Tollmen want.", "A coin a week, the Tollmen want."], ["A pound note in his hat.", "A coin in his hat."],
      ["Fifty quid, he said.", "Fifty coins, he said."], ["Not a cent from the Fund.", "Not a coin from the Fund."], ["It's £5 at the hatch.", "It's 5 coins at the hatch."],
      ["He rode a penny-farthing to school.", "He rode a high-wheeler to school."],
    ] as const) {
      expect(coinsFor(from)?.text, from).toBe(to);
      expect(currencyHit(to), to).toBeNull();
    }
    expect(coinsFor("Sixpence, and not a penny more.")?.swaps).toEqual([["Sixpence", "Six coins"], ["penny", "coin"]]);
  });

  it("touches only what V16 flags: the penny whistle, the penny dropping, a pound of flour, a bare old-money sum", () => {
    for (const t of ["June's penny whistle.", "Then the penny dropped.", "A pound of rye flour.", "The guinea fowl got out.", "Four and six, it was.", "Rye's two coins."])
      expect(coinsFor(t), t).toBeNull();
    expect(coinsFor("June's penny whistle cost a penny. Then the penny dropped.")?.text).toBe("June's penny whistle cost a coin. Then the penny dropped.");
    expect(coinsFor("A pound of flour and two pennies.")?.text).toBe("A pound of flour and two coins.");
    expect(coinsFor("Four and six, not a penny less.")?.text).toBe("Four and six, not a coin less.");
  });

  it("repairs every text V16 scans, and the household passes V16", () => {
    const { draw, vctx: plain, out } = native("dunmore_barney");
    const vctx = withMoney(plain);
    const m = out.members[0]!;
    out.household.summary = "Barney keeps the till at Dunmore's and has never been paid more than ten shillings a week.";
    m.backstory = `${m.backstory} He still counts the float in pennies and ha'pennies.`;
    m.beliefs[0] = "Bread was four and sixpence a loaf when the mill shut.";
    m.voice.samples[2] = "Now where was I? The bread. A penny, it was. A penny.";
    m.relationships[0]!.note = "His sister; still owes him tuppence.";
    expect(codes(validateHousehold(out, draw, vctx))).toEqual(["V16 members[0]: banned language (money)", "V16 household.summary: banned language"]);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      'V16 household.summary "shillings" → "coins"',
      `V16 members[0].backstory "pennies" → "coins", "ha'pennies" → "coins"`,
      'V16 members[0].beliefs[0] "four and sixpence" → "a few coins"',
      'V16 members[0].voice.samples[2] "penny" → "coin", "penny" → "coin"',
      'V16 members[0].relationships[0].note "tuppence" → "two coins"',
    ]);
    const card = r.card.members[0]!;
    expect(card.voice.samples[2]).toBe("Now where was I? The bread. A coin, it was. A coin.");
    expect(card.beliefs[0]).toBe("Bread was a few coins a loaf when the mill shut.");
    expect(card.backstory.endsWith("He still counts the float in coins and coins.")).toBe(true);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
    expect(repair(r.output, draw, vctx).adjustments).toEqual([]);
    // The name is the validator's (V02/V03) and the retry's: never rewritten.
    expect(card.name).toBe(m.name);
  });
});

describe("routine verbs (V01)", () => {
  it("maps a word the engine doesn't have to the closest verb, and anything else to wander", () => {
    for (const [word, verb] of [
      ["chat", "socialize"], ["gossiping", "socialize"], ["Talk", "socialize"], ["play cards", "socialize"], ["stroll", "walk"], ["amble", "walk"], ["walk the dog", "walk"],
      ["knit", "tinker"], ["sewing", "tinker"], ["mend nets", "tinker"], ["repair", "tinker"], ["do the washing", "clean"], ["sweep", "clean"],
      ["bake", "cook"], ["baking bread", "cook"], ["have tea", "eat"], ["worship", "pray"], ["chapel", "pray"], ["sleep-ins", "sleep"], ["lie in", "sleep"],
      ["doze", "nap"], ["go fishing", "fish"], ["read paper", "read"], ["write letters", "write"], ["sing", "play_music"], ["swim", "exercise"],
    ] as const) expect(routineVerbFor(word, false), word).toEqual({ verb, known: true });
    // Teaching is work at the workplace and a lesson attended anywhere else.
    expect([routineVerbFor("teach", true), routineVerbFor("teach", false), routineVerbFor("lessons", false)].map(x => x.verb)).toEqual(["work", "attend", "attend"]);
    expect([routineVerbFor("night watch", true), routineVerbFor("watch the boats", false)].map(x => x.verb)).toEqual(["work", "sit"]);
    expect(routineVerbFor("juggle", false)).toEqual({ verb: "wander", known: false });
    expect(routineVerbFor("Working", false)).toEqual({ verb: "work", known: true });
    for (const w of ["chat", "juggle", "lessons", "sleep-ins"]) expect(VERBS).toContain(routineVerbFor(w, false).verb);
  });

  it("fixes the trial's V01 (members.0.routine.weekday.4.do) and says which words it didn't know", () => {
    const { draw, vctx, out } = native("dunmore_barney");
    const m = out.members[0]!;
    m.routine.weekday[4]!.do = "chat" as never;
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([expect.stringMatching(/^V01 not the contract: members\.0\.routine\.weekday\.4\.do Invalid option: expected one of "work"\|"eat"/)]);
    m.routine.weekday[1]!.do = "teach" as never;
    m.routine.weekend[1]!.do = "lessons" as never;
    m.routine.weekend[3]!.do = "juggle" as never;
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      'V13 members[0].routine.weekday[1].do "teach" → "work"', 'V13 members[0].routine.weekday[4].do "chat" → "socialize"',
      'V13 members[0].routine.weekend[1].do "lessons" → "attend"', 'V13 members[0].routine.weekend[3].do "juggle" → "wander" (not a verb the engine has)',
    ]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
  });
});

describe("a day's shape (V13)", () => {
  const barney = () => native("dunmore_barney");
  const FLAT = "market_row.dunmore_flat";

  it("over nine blocks: drops the shortest away from home and not work (the trial's 10 entries)", () => {
    const { draw, vctx, out } = barney();
    const day = out.members[0]!.routine.weekday;
    day.splice(2, 0, at("12:00", "walk", "commons.duck_pond"));
    day.splice(5, 0, at("17:00", "shop", "market_row.bakery"));
    expect(codes(validateHousehold(out, draw, vctx))).toEqual(["V13 members[0].routine.weekday has 10 entries; 5-9"]);
    const r = repair(out, draw, vctx);
    // 12:00 and 17:00 are both half an hour: the later goes.
    expect(r.adjustments).toEqual(['V13 members[0].routine.weekday: dropped "17:00" shop at market_row.bakery (10 blocks; at most 9)']);
    expect(r.card.members[0]!.routine.weekday.map(e => e.at)).toEqual(["07:00", "08:30", "12:00", "12:30", "13:30", "17:30", "18:30", "20:00", "22:00"]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
  });

  it("drops a block past 26:00 (the trial's 27:00) and one with no readable time", () => {
    const { draw, vctx, out } = barney();
    const m = out.members[0]!;
    m.routine.weekday[7]!.at = "27:00";
    m.routine.weekend[2]!.at = "noon";
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([
      'V13 members[0].routine.weekday: "27:00" is out of order or past 26:00', 'V13 members[0].routine.weekend: "noon" is out of order or past 26:00',
    ]);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      `V13 members[0].routine.weekday: dropped "27:00" sleep at ${FLAT} (past 26:00)`,
      'V13 members[0].routine.weekend: dropped "noon" eat at market_row.cafe_liss (not a time)',
    ]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
  });

  it("sorts a block out of order (the trial's 06:00), and the day then starts at home", () => {
    const { draw, vctx, out } = barney();
    out.members[0]!.routine.weekend.push(at("06:00", "walk", "wharf.breakwater"));
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([
      'V13 members[0].routine.weekend: "06:00" is out of order or past 26:00', `V13 members[0].routine.weekend must start and end at ${FLAT}`,
    ]);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      'V13 members[0].routine.weekend sorted by time: "08:00, 10:00, 12:30, 14:30, 18:00, 19:30, 22:00, 06:00" → "06:00, 08:00, 10:00, 12:30, 14:30, 18:00, 19:30, 22:00"',
      `V13 members[0].routine.weekend: added "05:30" eat at ${FLAT} (the day starts at home)`,
    ]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
  });

  it("writes past-midnight blocks on (00:30 after 22:00 is 24:30)", () => {
    const { draw, vctx, out } = barney();
    const day = out.members[0]!.routine.weekend;
    day.splice(6, 1, at("22:00", "socialize", "market_row.gull_and_anchor"), at("00:30", "walk", "wharf.breakwater"), at("01:00", "sleep", FLAT));
    expect(codes(validateHousehold(out, draw, vctx))).toEqual(['V13 members[0].routine.weekend: "01:00" is out of order or past 26:00']);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      'V13 members[0].routine.weekend sorted by time: "08:00, 10:00, 12:30, 14:30, 18:00, 19:30, 22:00, 00:30, 01:00" → "08:00, 10:00, 12:30, 14:30, 18:00, 19:30, 22:00, 24:30, 25:00"',
    ]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
    // One wrap is V13's own rule: a day that ends "22:00, 00:30" already passes and is left alone.
    const one = barney();
    one.out.members[0]!.routine.weekend.splice(6, 1, at("22:00", "socialize", "market_row.gull_and_anchor"), at("00:30", "sleep", FLAT));
    expect(repair(one.out, one.draw, one.vctx).adjustments).toEqual([]);
  });

  it("starts and ends the day at home (the trial's wharf.home_bunkhouse), 30 minutes before and an hour after", () => {
    const { draw, vctx, out } = native("calloway");
    const HOME = "wharf.home_bunkhouse";
    const day = out.members[0]!.routine.weekend;
    day[0] = at("07:00", "walk", "wharf.harbor_steps");
    day.pop();
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([`V13 members[0].routine.weekend must start and end at ${HOME}`]);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      `V13 members[0].routine.weekend: added "06:30" eat at ${HOME} (the day starts at home)`,
      `V13 members[0].routine.weekend: added "20:30" sleep at ${HOME} (the day ends at home)`,
    ]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
    // Not before 05:00; at the first block's own time when 05:00 isn't before it; never past 26:00.
    const times = (first: string, last: string) => {
      const t = native("calloway");
      const d = t.out.members[0]!.routine.weekend;
      d[0] = at(first, "fish", "wharf.harbor_steps");
      d[d.length - 1] = at(last, "socialize", "market_row.gull_and_anchor");
      const days = repair(t.out, t.draw, t.vctx).card.members[0]!.routine.weekend;
      expect(codes(validateHousehold({ ...t.out, members: t.out.members.map((m, i) => (i ? m : { ...m, routine: { ...m.routine, weekend: days } })) }, t.draw, t.vctx))).toEqual([]);
      return [days[0]!.at, days.at(-1)!.at];
    };
    expect(times("05:15", "25:30")).toEqual(["05:00", "26:00"]);
    expect(times("04:40", "23:00")).toEqual(["04:40", "24:00"]);
    expect(clockTime(26 * 60)).toBe("26:00");
  });

  it("lets a commuter's weekday start and end at offmap.city, and leaves a pupil's day to the engine", () => {
    const q = native("quill");
    const commuter = q.out.members[1]!.routine.weekday;
    expect([commuter[0]!.where, commuter.at(-1)!.where]).toEqual(["old_quarter.home_03", "offmap.city"]);
    commuter[0]!.where = "offmap.city";
    expect(repair(q.out, q.draw, q.vctx).adjustments).toEqual([]);
    const maud = native("szabo_maud");
    // m2 is a pupil: whatever the model writes, the engine's school day replaces it.
    const pupil = maud.out.members[1]!.routine;
    pupil.weekday = [...pupil.weekday, ...pupil.weekday].reverse();
    const r = repair(maud.out, maud.draw, maud.vctx);
    expect(r.adjustments).toEqual([]);
    expect(codes(validateHousehold(r.output, maud.draw, maud.vctx))).toEqual([]);
  });
});

describe("work away from the workplace (V13)", () => {
  it("is a visit when the workplace is on an open board", () => {
    const { draw, vctx, out } = native("dunmore_barney");
    out.members[0]!.routine.weekend[1] = at("10:00", "work", "market_row.market_street");
    expect(codes(validateHousehold(out, draw, vctx))).toEqual(['V13 members[0].routine.weekend: work at "market_row.market_street"; their work is at market_row.general_store']);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual(['V13 members[0].routine.weekend[1].do "work" → "visit" (at market_row.market_street; their work is at market_row.general_store)']);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
  });

  it("is left for V13 at home, or when the workplace is off the open boards", () => {
    const home = native("dunmore_barney");
    home.out.members[0]!.routine.weekday[6] = at("20:00", "work", "market_row.dunmore_flat");
    const h = repair(home.out, home.draw, home.vctx);
    expect(h.adjustments).toEqual([]);
    expect(codes(validateHousehold(h.output, home.draw, home.vctx))).toEqual(['V13 members[0].routine.weekday: work at "market_row.dunmore_flat"; their work is at market_row.general_store']);
    // mb_b05's m2 is the mill's night watchman (millbrook.mill: Millbrook isn't an open board).
    const watch = native("mb_b05");
    watch.out.members[1]!.routine.weekday[3] = at("13:30", "work", "market_row.cafe_liss");
    const w = repair(watch.out, watch.draw, watch.vctx);
    expect(w.adjustments).toEqual([]);
    expect(codes(validateHousehold(w.output, watch.draw, watch.vctx))).toEqual(['V13 members[1].routine.weekday: work at "market_row.cafe_liss"; their work is at millbrook.mill']);
  });

  it("a Tollman's weekend work on Market Row is the Saturday round: V13 accepts it and the repair leaves it", () => {
    const { draw, vctx, out } = native("calloway");
    // m1 Dex and m2 Dom are Tollmen (A.1.4 row 23, briar_woods.tollmen_hideout); m3 works the fish market.
    out.members[0]!.routine.weekend[1] = at("10:00", "work", "market_row.market_street");
    out.members[1]!.routine.weekend[1] = at("10:00", "work", "market_row.bakery");
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([]);
    expect(repair(out, draw, vctx).adjustments).toEqual([]);
    // On a weekday, or for anyone else, it isn't: the Tollman's stays for V13 (their workplace is off the boards), the
    // fish-market hand's is a visit.
    out.members[0]!.routine.weekday[3] = at("13:30", "work", "market_row.market_street");
    out.members[2]!.routine.weekend[1] = at("10:00", "work", "market_row.market_street");
    expect(codes(validateHousehold(out, draw, vctx))).toEqual([
      'V13 members[0].routine.weekday: work at "market_row.market_street"; their work is at briar_woods.tollmen_hideout',
      'V13 members[2].routine.weekend: work at "market_row.market_street"; their work is at wharf.fish_market',
    ]);
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual(['V13 members[2].routine.weekend[1].do "work" → "visit" (at market_row.market_street; their work is at wharf.fish_market)']);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual(['V13 members[0].routine.weekday: work at "market_row.market_street"; their work is at briar_woods.tollmen_hideout']);
  });
});

describe("the census run's failures together", () => {
  /** Calloway (the trial's wharf.home_bunkhouse) written with every slip the full run failed on. */
  const callowayAsRunWrote = () => {
    const t = native("calloway");
    const [dex, , nell] = t.out.members;
    // (Dex's other samples have one contraction between them: V10 wants two, so this line keeps one.)
    dex!.voice.samples[2] = "Now where was I? The bread. A penny, it was. A penny, and that's dear.";
    dex!.routine.weekday[4]!.do = "chat" as never;
    dex!.routine.weekend[0] = at("07:00", "walk", "wharf.harbor_steps");
    dex!.routine.weekend[1] = at("10:00", "work", "market_row.market_street");
    dex!.routine.weekend.pop();
    nell!.routine.weekday.splice(2, 0, at("12:00", "walk", "commons.duck_pond"), at("12:15", "sit", "wharf.harbor_steps"));
    nell!.routine.weekday[9]!.at = "27:00";
    nell!.routine.weekend[1] = at("10:00", "work", "wharf.harbor_steps");
    nell!.routine.weekend.push(at("06:00", "walk", "wharf.breakwater"));
    return t;
  };

  it("repairs each, in order, and the household passes; a second repair changes nothing", () => {
    const { draw, vctx: plain, out } = callowayAsRunWrote();
    const vctx = withMoney(plain);
    expect(validateHousehold(out, draw, vctx)).toMatchObject({ ok: false, errors: [expect.stringMatching(/^V01 not the contract: members\.0\.routine\.weekday\.4\.do/)] });
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([
      'V16 members[0].voice.samples[2] "penny" → "coin", "penny" → "coin"',
      'V13 members[0].routine.weekday[4].do "chat" → "socialize"',
      'V13 members[0].routine.weekend: added "06:30" eat at wharf.home_bunkhouse (the day starts at home)',
      'V13 members[0].routine.weekend: added "20:30" sleep at wharf.home_bunkhouse (the day ends at home)',
      'V13 members[2].routine.weekday: dropped "27:00" sleep at wharf.home_bunkhouse (past 26:00)',
      'V13 members[2].routine.weekday: dropped "12:15" sit at wharf.harbor_steps (9 blocks and 1 to add at home; at most 9)',
      'V13 members[2].routine.weekday: added "21:00" sleep at wharf.home_bunkhouse (the day ends at home)',
      'V13 members[2].routine.weekend sorted by time: "08:00, 10:00, 12:30, 14:30, 18:00, 19:30, 22:00, 06:00" → "06:00, 08:00, 10:00, 12:30, 14:30, 18:00, 19:30, 22:00"',
      'V13 members[2].routine.weekend: added "05:30" eat at wharf.home_bunkhouse (the day starts at home)',
      'V13 members[2].routine.weekend[3].do "work" → "visit" (at wharf.harbor_steps; their work is at wharf.fish_market)',
    ]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual([]);
    const twice = repair(r.output, draw, vctx);
    expect(twice.adjustments).toEqual([]);
    expect(twice.output).toEqual(r.output);
  });

  it("leaves content to the retry: samples that need a contraction (V10)", () => {
    const { draw, vctx, out } = native("calloway");
    out.members[0]!.voice.samples = ["The tide is in.", "We will see.", "Come along now."];
    const r = repair(out, draw, vctx);
    expect(r.adjustments).toEqual([]);
    expect(codes(validateHousehold(r.output, draw, vctx))).toEqual(["V10 members[0].voice.samples: at least two need a contraction"]);
  });
});
