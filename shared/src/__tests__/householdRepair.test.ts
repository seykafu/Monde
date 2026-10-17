// The engine's repair of a household reply before validation (A.3.7; "the model proposes, the engine disposes"): one
// test per repair, in the shapes the 2026-10-17 staging trial failed on (every reply parsed; every household failed all
// six attempts on these), the adjustments it reports, idempotency, and a passing reply coming back untouched.
import { describe, expect, it } from "vitest";
import {
  ROUTINE_PLACES, SeededRng, censusOrder, countWords, drawHousehold, nativeDrawFor, nativeTemplateHousehold, nativeValidationContext, nudgeBig5,
  pronounsOf, relationTagOf, repairHousehold, storyRoleOf, templateHousehold, trimToWords, validateHousehold, verbOf,
  type ArrivalHouseholdOutput, type HouseholdDraw, type SkeletonHousehold, type ValidationContext,
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
});
