// MVP Q-01: residents sound like themselves. Voice ownership (voice.ts), naming (naming.ts), riddle lead-ins
// (riddleLeads.ts) and the soft voice checks (validate.ts steps 8-9, dialogue.ts).
import { beforeAll, describe, expect, it } from "vitest";
import {
  DialogueTurnOutput, LIMITS, ResidentState, SPRING_RIDDLES, containsAnswer, modelOutputFormat, type PersonaCard,
} from "@monde/shared";
import { loadContent } from "../../content/loadContent.js";
import { generateTurn } from "../dialogue.js";
import { authoredHint, fallbackTurn, fillAddress } from "../fallback.js";
import { lexicalHits } from "../filters.js";
import { addressFor } from "../naming.js";
import { buildDialogueRequest, personaBlock, type DialogueInput } from "../promptBuilder.js";
import { loadRiddleLeads, riddleLeadIn } from "../riddleLeads.js";
import { RIDDLES } from "../riddles.js";
import { SAMPLE_RUN_WORDS, correctiveNote, sampleEcho, sharedRun, validateTurn, type ValidationContext } from "../validate.js";
import {
  COMMON_TICS, borrowedFor, borrowedHits, borrowedLine, ownSignatures, phraseKey, signatures, type RosterVoice,
} from "../voice.js";
import { FakeMind } from "./fakeMind.js";

let cards: PersonaCard[];
let roster: RosterVoice[];
const card = (id: string): PersonaCard => cards.find((c) => c.id === id)!;
beforeAll(async () => {
  cards = await loadContent();
  roster = cards.map((c) => ({ id: c.id, kind: c.kind, tics: c.voice.tics })).sort((a, b) => (a.id < b.id ? -1 : 1));
});
const speaking = () => cards.filter((c) => c.voice.mode !== "narrated_action");

describe("voice ownership: signature phrases", () => {
  it("gives each hand-written resident their distinctive tics, and nobody the everyday ones", () => {
    const owned = signatures(roster).map((s) => `${s.owner}:${s.phrase}`);
    for (const expected of ["odile:Mind the step.", "odile:Eat something.", "june:Anyway.", "pell:Now.", "pell:Heavens.",
      "hollis:By my watch.", "margo:Technically,", "sable:On the record?", "rook:Rot."]) {
      expect(owned).toContain(expected);
    }
    for (const phrase of ["hm", "sorry", "sure", "look"]) expect(owned.some((o) => phraseKey(o.split(":")[1]!) === phrase)).toBe(false);
    // A tic two hand-written cards share belongs to both ("Right." after the 2026-10-16 eval).
    expect(owned).toEqual(expect.arrayContaining(["augusta:Right.", "priya:Right."]));
    // Each owner lists a phrase once, and none is on the everyday list.
    const keys = signatures(roster).map((s) => `${s.owner}:${phraseKey(s.phrase)}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(signatures(roster).some((s) => COMMON_TICS.has(phraseKey(s.phrase)))).toBe(false);
  });

  it("lets hand-written cards share a phrase, but never lets an arrival or an animal own one or take it", () => {
    const extra: RosterVoice[] = [
      { id: "zed", kind: "arrival", tics: ["Mind the step.", "Tide's turning."] },
      { id: "ash", kind: "resident", tics: ["By my watch."] },
    ];
    const owned = signatures([...roster, ...extra]);
    expect(owned.some((s) => s.owner === "zed" || s.owner === "bastien")).toBe(false);
    // An arrival with Odile's phrase leaves it Odile's, so nobody's cached block changes when the ferry comes in.
    expect(owned.filter((s) => s.phrase === "Mind the step.").map((s) => s.owner)).toEqual(["odile"]);
    expect(owned.filter((s) => s.phrase === "By my watch.").map((s) => s.owner)).toEqual(["ash", "hollis"]);
    expect(signatures([...roster, extra[0]!])).toEqual(signatures(roster));
  });

  it("lists everyone else's phrases for a resident, never their own, and nothing for an animal", () => {
    const june = borrowedFor(card("june"), roster);
    expect(june.map((s) => s.phrase)).toContain("Mind the step.");
    expect(june.some((s) => s.owner === "june")).toBe(false);
    expect(borrowedFor(card("odile"), roster).map((s) => s.phrase)).toContain("Anyway.");
    expect(borrowedFor(card("odile"), roster).some((s) => s.phrase === "Mind the step.")).toBe(false);
    expect(borrowedFor(card("bastien"), roster)).toEqual([]);
    expect(ownSignatures(card("odile"), roster).map((s) => s.phrase)).toEqual(["Eat something.", "Mind the step."]);
    // An arrival whose own tic happens to be a canon phrase may still say it.
    const arrival = { ...card("june"), id: "arrival_x", voice: { ...card("june").voice, tics: ["Mind the step."] } } as PersonaCard;
    expect(borrowedFor(arrival, roster).some((s) => s.phrase === "Mind the step.")).toBe(false);
  });

  it("gives the Day-1 census's cards (generated_by) no phrase of their own, and lets them borrow none (MVP M-03)", () => {
    // A template card for the bakery's neighbour whose tic is Odile's, and one whose tic is nobody's.
    const template = (id: string, tics: string[]): PersonaCard =>
      ({ ...card("june"), id, kind: "resident", generated_by: "template", household: "h1", voice: { ...card("june").voice, tics } }) as PersonaCard;
    const neighbour = template("neighbour", ["Mind the step."]), plain = template("plain", ["We're settled."]);
    const census: RosterVoice[] = [
      { id: "neighbour", kind: "resident", tics: ["Mind the step."], generated: true },
      { id: "plain", kind: "resident", tics: ["We're settled."], generated: true },
    ];
    const full = [...roster, ...census].sort((a, b) => (a.id < b.id ? -1 : 1));
    // The census owns nothing, so the hand-written cast's phrases (and their cached blocks) are what they were.
    expect(signatures(full)).toEqual(signatures(roster));
    expect(ownSignatures(neighbour, full)).toEqual([]);
    expect(borrowedFor(card("odile"), full)).toEqual(borrowedFor(card("odile"), roster));
    expect(personaBlock(card("odile"), { flags: [], day: 3, voices: full })).toBe(personaBlock(card("odile"), { flags: [], day: 3, voices: roster }));
    // Odile's phrase is still Odile's, on a census card that lists it: borrowed, and gone from its own tics.
    expect(borrowedFor(neighbour, full).filter((s) => s.phrase === "Mind the step.").map((s) => s.owner)).toEqual(["odile"]);
    expect(borrowedHits("Off you go. Mind the step.", borrowedFor(neighbour, full)).map((s) => s.owner)).toEqual(["odile"]);
    const block = personaBlock(neighbour, { flags: [], day: 3, voices: full });
    expect(block).toMatch(/Your tics, yours alone \(each at most once per conversation\): \(none\)/);
    expect(block).toContain('Odile "Eat something.", "Mind the step."');
    // A census card's own everyday tic is just how they talk: listed, owned by nobody.
    expect(personaBlock(plain, { flags: [], day: 3, voices: full })).toContain('Your tics, yours alone (each at most once per conversation): "We\'re settled."');
    expect(borrowedHits("We're settled.", borrowedFor(card("june"), full))).toEqual([]);
  });

  it("matches a phrase the way it's used: whole words, one-word tics only as a sentence, questions as questions", () => {
    const june = borrowedFor(card("june"), roster);
    const hits = (text: string) => borrowedHits(text, june).map((s) => `${s.owner}:${s.phrase}`);
    expect(hits("(Wipes the counter.) Off you go. Mind the step, the cobbles are wet.")).toEqual(["odile:Mind the step."]);
    expect(hits("Mind the steps by the weir.")).toEqual([]);
    expect(hits("Now. Where's the sugar.")).toEqual(["pell:Now."]);
    expect(hits("Right now, nothing.")).toEqual([]);
    expect(hits("Now, then, the bar.")).toEqual([]);
    expect(hits("Heavens, that's loud.")).toEqual(["pell:Heavens."]);
    expect(hits("Technically that's a waltz.")).toEqual(["margo:Technically,"]);
    expect(hits("It's on the record, mind.")).toEqual([]);
    expect(hits("On the record?")).toEqual(["sable:On the record?"]);
    expect(hits("It's late. The ferry's late.")).toEqual([]);
    expect(hits("Late. Again.")).toEqual(["hollis:Late."]);
    expect(hits("I’m only saying.")).toEqual(["moss:I'm only saying."]);
    const odile = borrowedFor(card("odile"), roster);
    expect(borrowedHits("It was going in the bin anyway.", odile)).toEqual([]);
    expect(borrowedHits("Off you go. Anyway.", odile).map((s) => s.owner)).toEqual(["june"]);
  });

  it("writes the never-borrow line grouped by owner, stable whatever the roster order", () => {
    const line = borrowedLine(borrowedFor(card("june"), roster));
    expect(line).toMatch(/^Other residents' catchphrases, never yours to borrow: Ada /);
    expect(line).toContain('Odile "Eat something.", "Mind the step."');
    expect(line).toContain('Pell "Now.", "Heavens.", "Let me see to the lamps first."');
    expect(line).not.toContain("June");
    expect(borrowedLine(borrowedFor(card("june"), [...roster].reverse()))).toBe(line);
    expect(borrowedLine([])).toBe("");
  });
});

describe("the persona block (block 2) owns the voice", () => {
  const block = (c: PersonaCard, voices: readonly RosterVoice[] = roster) => personaBlock(c, { flags: [], day: 3, voices });

  it("calls the tics yours alone, lists the others' catchphrases and frames samples as tone", () => {
    const june = block(card("june"));
    expect(june).toContain('Your tics, yours alone (each at most once per conversation): "Anyway." (only as the conversation ends), "Sure.", "One, two,"');
    expect(june).toContain('Odile "Eat something.", "Mind the step."');
    expect(june).toContain("Samples, to show your tone only (never repeat one or lift its phrases; say new things):");
    expect(block(card("odile"))).not.toContain('Odile "');
    // Bastien never speaks: no list.
    expect(block(card("bastien"))).not.toContain("catchphrases");
  });

  it("is byte-stable and keeps every card within a sane size", () => {
    // §9.10.1: ~1,000-1,500 tokens with the never-borrow list (about 250 of them); chars / 4.
    for (const c of cards) {
      expect(block(c, [...roster].reverse()), c.id).toBe(block(c));
      expect(block(c).length / 4, `${c.id} persona block tokens`).toBeLessThanOrEqual(1600);
    }
  });
});

describe("naming: what each resident calls the Fellow (GDD §12.1)", () => {
  const address = (residentId: string, regard = 0, met = false, pronouns = "she/her") =>
    addressFor({ residentId, playerName: "Wren", pronouns, regard, met });

  it("follows the voice bible's registers", () => {
    expect(address("pell", 10)).toMatchObject({ term: "Fellow" });
    expect(address("pell", 10).line).toBe('Call her "Fellow" ("dear" now and then), not "Wren": first names are for friends, in private.');
    expect(address("pell", 45)).toMatchObject({ term: "Wren", line: 'Call her "Wren" when it\'s just the two of you, "Fellow" in front of others.' });
    expect(address("hollis", 90)).toMatchObject({ term: "Fellow", line: 'Call her "Fellow", never "Wren".' });
    expect(address("rook").line).toBe('Call her "Fellow", like a dare, never "Wren".');
    expect(address("ines").line).toBe('Call her "Fellow": you use titles, not names.');
    expect(address("odile")).toMatchObject({ term: "petite", line: 'Call her "petite", or just "you"; never "Wren".' });
    expect(address("odile", 0, false, "he/him")).toMatchObject({ term: "petit", line: 'Call him "petit", or just "you"; never "Wren".' });
    expect(address("odile", 0, false, "they/them").term).toBe("petit");
    expect(address("june")).toMatchObject({ term: "friend", line: 'Call her "friend".' });
    expect(address("june", 0, true).line).toBe('Call her "friend", and "Wren" now and then.');
    expect(address("bertrand").term).toBe("my dear");
    expect(address("rosalind").term).toBe("pet");
    expect(address("vane", 0, false).term).toBe("Fellow");
    expect(address("vane", 0, true).term).toBe("Wren");
  });

  it("gives everyone else 'Fellow' until introduced or met, then the name", () => {
    expect(address("margo", -5)).toMatchObject({ term: "Fellow", line: 'Call her "Fellow", coolly; not "Wren".' });
    expect(address("margo", 5)).toMatchObject({ term: "Fellow", line: 'Call her "Fellow"; "Wren" only once the Fellow has told you the name.' });
    expect(address("margo", 5, true)).toMatchObject({ term: "Wren", line: 'Call her "Wren" or "Fellow".' });
    expect(address("margo", 25)).toMatchObject({ term: "Wren" });
  });

  it("has a plain line before the Fellow has a name", () => {
    const unnamed = (residentId: string) => addressFor({ residentId, playerName: "Fellow", pronouns: "they/them", regard: 50, met: true });
    expect(unnamed("hollis").line).toBe('Call them "Fellow".');
    expect(unnamed("pell").line).toBe('Call them "Fellow" ("dear" now and then).');
    expect(unnamed("margo").line).toBe('Call them "Fellow".');
    expect(unnamed("odile").line).toBe('Call them "petit", or just "you".');
  });

  it("puts the line in the dynamic block, never in blocks 1-3", () => {
    const pell = card("pell");
    const input = (regard: number, extra: Partial<DialogueInput> = {}): DialogueInput => ({
      card: pell, state: ResidentState.parse({
        id: "pell", world_id: "w", tier: "core", mood: { valence: 0, energy: 50, stress: 0, emotion: "content", intensity: 0 },
        needs: { rest: 70, food: 70, social: 70, purpose: 70, comfort: 70 }, regard, stances: {}, beliefs: pell.beliefs,
        recent_topics: [], dream: { stage: 0, notes: "" }, stay: 50, leaving_notice_since: null, location: null, flags: [],
      }),
      relationships: pell.relationships, flags: [], voices: roster,
      scene: { day: 2, weekday: "Wed", minute: 600, place: "old_quarter.mayor_office", weather: "clear" },
      player: { name: "Wren", pronouns: "she/her", background: "Tinkerer" }, memories: [], topics: [], playerSaid: "Why?",
      ...extra,
    });
    const stranger = buildDialogueRequest(input(5));
    const friend = buildDialogueRequest(input(45));
    const user = (req: ReturnType<typeof buildDialogueRequest>) => req.messages.at(-1)!.content as string;
    expect(user(stranger)).toMatch(/<player> Name: Wren \(she\/her; never "he", "him", "a man" or "lad"\)\. Your regard: Stranger\. Background: Tinkerer\. Call her "Fellow" \("dear" now and then\), not "Wren"/);
    expect(user(friend)).toContain('Call her "Wren" when it\'s just the two of you');
    expect(JSON.stringify(friend.system)).toBe(JSON.stringify(stranger.system));
    expect(JSON.stringify(stranger.system)).not.toContain('Call her');
    // Met comes from the session: a history with the Fellow, or a resumed conversation.
    const margo = (extra: Partial<DialogueInput>) => user(buildDialogueRequest({ ...input(5, extra), card: card("margo") }));
    expect(margo({})).toContain('Call her "Fellow"; "Wren" only once');
    expect(margo({ sessionHistory: "Day 1: the Fellow asked about plaques." })).toContain('Call her "Wren" or "Fellow".');
    expect(margo({ resumedAfter: 3 })).toContain('Call her "Wren" or "Fellow".');
  });

  it("is what authored fallbacks call the Fellow too, capitalized at the start of a sentence", () => {
    const state = (regard: number) => ({ regard, mood: { valence: 0, energy: 50, stress: 0, emotion: "content" as const, intensity: 10 } });
    const open = (id: string, regard: number) => fallbackTurn({ card: card(id), state: state(regard), playerName: "Wren", playerPronouns: "she/her", turnIndex: 0 }).lines[0]!.text;
    expect(open("hollis", 25)).toBe("Hello again, Fellow. How are you getting on?");
    expect(open("margo", 25)).toBe("Hello again, Wren. How are you getting on?");
    expect(open("odile", 25)).toBe("Hello again, petite. How are you getting on?");
    expect(fillAddress("{player}. Good. Walk with me a minute?", "my dear")).toBe("My dear. Good. Walk with me a minute?");
    // The intro moment echoes the name the Fellow just gave.
    const intro = fallbackTurn({ card: card("hollis"), state: state(0), playerName: "Wren", playerPronouns: "she/her", turnIndex: 1, playerText: "I'm Wren, by the way." });
    expect(intro.lines[0]!.text).toMatch(/^Wren\b/);
  });
});

describe("riddle lead-ins (GDD §14.2)", () => {
  const library = () => loadRiddleLeads();
  const allLeads = () => Object.entries(library().leads).flatMap(([id, pools]) => [...pools.give, ...pools.again, ...(pools.trail ?? [])].map((lead) => ({ id, lead })));
  const longestHint = () => Math.max(...SPRING_RIDDLES.flatMap((r) => r.hints.map((h) => h?.length ?? 0)));

  it("exist for every resident who speaks, plus a default", () => {
    for (const c of speaking()) expect(Object.hasOwn(library().leads, c.id), c.id).toBe(true);
    expect(library().leads.default!.give.length).toBeGreaterThan(0);
    expect(Object.hasOwn(library().leads, "bastien")).toBe(false);
  });

  it("never contain riddle content: no accepted answer of any riddle", () => {
    for (const { id, lead } of allLeads()) {
      for (const riddle of SPRING_RIDDLES) {
        expect(containsAnswer(lead, riddle.accepted), `${id} lead-in "${lead}" holds an answer to ${riddle.id}`).toBe(false);
        for (const hint of riddle.hints) if (hint) expect(lead.includes(hint)).toBe(false);
      }
    }
  });

  it("follow house style, borrow no one's catchphrase and fit one line with the longest hint", () => {
    for (const { id, lead } of allLeads()) {
      expect(lexicalHits(lead), lead).toEqual([]);
      expect(lead).not.toMatch(/[!…]|\.\.\./);
      expect(lead.endsWith(":"), lead).toBe(true);
      const c = cards.find((x) => x.id === id);
      if (c) expect(borrowedHits(lead, borrowedFor(c, roster)), `${id}: ${lead}`).toEqual([]);
      expect(lead.length + 1 + longestHint(), lead).toBeLessThanOrEqual(LIMITS.dialogue.lineChars);
    }
  });

  it("are picked deterministically, 'again' once the hint was given, never one already said", () => {
    const args = { residentId: "margo", riddleId: "OQ-1", turnIndex: 1, again: false };
    const first = riddleLeadIn(args);
    expect(riddleLeadIn(args)).toBe(first);
    expect(library().leads.margo!.give).toContain(first);
    expect(library().leads.margo!.again).toContain(riddleLeadIn({ ...args, again: true }));
    const other = riddleLeadIn({ ...args, said: [`${first} Something.`] });
    expect(other).not.toBe(first);
    expect(library().leads.default!.give).toContain(riddleLeadIn({ ...args, residentId: "arrival_x" }));
  });

  it("lead the authored hint on a riddle turn, and say so when the Fellow asks again", () => {
    const record = RIDDLES["OQ-1"]!;
    const state = { regard: 0, mood: { valence: 0, energy: 50, stress: 0, emotion: "content" as const, intensity: 10 } };
    const base = { card: card("margo"), state, playerName: "Wren", riddle: { record, allowed: 1 } };
    const hint = authoredHint(record, 1)!;
    const first = fallbackTurn({ ...base, turnIndex: 1, playerText: "Who put the plaque on my door?" }).lines[0]!.text;
    expect(first).toBe(`${riddleLeadIn({ residentId: "margo", riddleId: "OQ-1", turnIndex: 1, again: false })} ${hint}`);
    expect(first.endsWith(` ${hint}`)).toBe(true);
    // Asked again: the "again" lead-in, and the hint in its authored retelling, never the same sentence twice.
    const retold = library().retold["OQ-1"]![0]!;
    const second = fallbackTurn({ ...base, turnIndex: 2, playerText: "Can you just tell me the answer?", said: [first] }).lines[0]!.text;
    expect(second.endsWith(` ${retold}`)).toBe(true);
    expect(library().leads.margo!.again.some((lead) => second.startsWith(lead))).toBe(true);
    expect(containsAnswer(first, record.accepted) || containsAnswer(second, record.accepted)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Soft voice checks
// ---------------------------------------------------------------------------------------------------------------

function turn(lines: string[]): DialogueTurnOutput {
  return {
    lines: lines.map((text) => ({ text, expr: "warm" })),
    choices: [{ id: "a", text: "Go on.", intent: "curious" }, { id: "b", text: "I'll sit.", intent: "kind" }],
    effects: { regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: "the cafe" },
    wrap_up: false,
  };
}
const vctx = (id: string, extra: Partial<ValidationContext> = {}): ValidationContext => {
  const c = card(id);
  return {
    card: c, emotion: "content", revealable: new Set(), riddle: null, recentLines: [],
    borrowed: borrowedFor(c, roster), own: ownSignatures(c, roster),
    samples: c.voice.mode === "narrated_action" ? [] : c.voice.samples, ...extra,
  };
};
const check = (lines: string[], ctx: ValidationContext) => validateTurn(JSON.stringify(turn(lines)), ctx);

describe("validator: soft voice checks", () => {
  it("8. flags another resident's catchphrase, softly, and keeps the turn for later", () => {
    const result = check(["(Wipes the counter.) Off you go, then. Mind the step, the cobbles are wet."], vctx("june"));
    expect(result).toMatchObject({ ok: false, category: "borrowed", detail: '"Mind the step." (odile)' });
    if (!result.ok) expect(result.soft?.output.lines[0]!.text).toContain("Mind the step");
    expect(check(["Mind the step. Oven's on."], vctx("odile"))).toMatchObject({ ok: true });
  });

  it("8. flags the resident's own catchphrase the second time in a conversation", () => {
    const odile = (said: string[]) => vctx("odile", { conversationLines: said });
    expect(check(["Mind the step on your way out."], odile([]))).toMatchObject({ ok: true });
    expect(check(["Mind the step on your way out."], odile(["(Doesn't look up.) Mind the step. Rye's two."])))
      .toMatchObject({ ok: false, category: "tic_repeat", detail: '"Mind the step."' });
    expect(check(["Mind the step.", "Mind the step, I said."], odile([]))).toMatchObject({ ok: false, category: "tic_repeat" });
  });

  it("9. flags a card sample quoted back, by overlap or a six-word run, but lets prices recur", () => {
    const quote = "Rye, two coins. White's for people who haven't been here before. Eat something, petite, you look like a coat on a hook.";
    expect(check([quote], vctx("odile"))).toMatchObject({ ok: false, category: "sample_echo" });
    expect(check(["Oven's been hot since four. Sit or don't."], vctx("odile"))).toMatchObject({ ok: false, category: "sample_echo" });
    expect(check(["(Slides a loaf over.) Rye's two coins today, and the heel's going spare."], vctx("odile"))).toMatchObject({ ok: true });
    expect(sharedRun("you look like a coat on a hook", "Eat something, petit, you look like a coat on a hook.")).toBe(8);
    expect(sharedRun("one two", "one two")).toBe(0);
    expect(SAMPLE_RUN_WORDS).toBe(6);
    expect(sampleEcho("Nothing like it at all, honestly.", vctx("odile").samples ?? [])).toBeNull();
  });

  it("runs after the hard checks, which still win", () => {
    expect(check(["Mind the step, and the internet's down."], vctx("june"))).toMatchObject({ category: "lexical:modern_tech" });
  });

  it("turns asterisk stage business into parentheses", () => {
    const result = check(["*Looks up over half-moon glasses.* Oh, it's the Fellow."], vctx("pell"));
    expect(result).toMatchObject({ ok: true, output: { lines: [{ text: "(Looks up over half-moon glasses.) Oh, it's the Fellow." }] } });
    if (result.ok) expect(result.adjustments).toContain("asterisk stage business→parentheses");
  });

  it("has corrective notes that name the slip", () => {
    expect(correctiveNote("borrowed", '"Mind the step." (odile)')).toMatch(/^"Mind the step\." is another resident's catchphrase/);
    expect(correctiveNote("tic_repeat", '"Mind the step."')).toContain('already said "Mind the step."');
    expect(correctiveNote("sample_echo")).toMatch(/samples/);
  });
});

describe("generateTurn: soft failures regenerate once and never fall back", () => {
  const request = { system: [], messages: [{ role: "user" as const, content: "<player_said> Bye. </player_said>" }], output_config: { format: modelOutputFormat(DialogueTurnOutput) } };
  const run = (mind: FakeMind, streamed: string[] = []) => generateTurn({
    mind, request, validation: vctx("june"), onLineDelta: (d) => streamed.push(d.text_so_far),
  });
  const borrowing = turn(["(Wipes the counter.) Off you go. Mind the step, the cobbles are wet."]);
  const clean = turn(["(Hums a bar.) Off you go, friend. Mind how the cobbles shine. Anyway."]);

  it("takes the regeneration when it's clean, with a note naming the phrase, and never streams the borrowed one", async () => {
    const mind = new FakeMind([{ output: borrowing, chunk: 4 }, { output: clean }]);
    const streamed: string[] = [];
    const result = await run(mind, streamed);
    expect(result.failure).toBeNull();
    expect(result.output!.lines[0]!.text).toBe(clean.lines[0]!.text);
    expect(result.calls.map((c) => c.validation)).toEqual(["borrowed", "ok"]);
    const second = mind.streams[1]!.messages.at(-1)!.content as { type: string; text: string }[];
    expect(second.at(-1)!.text).toBe(correctiveNote("borrowed", '"Mind the step." (odile)'));
    expect(streamed.some((t) => /mind the step/i.test(t))).toBe(false);
  });

  it("accepts a second slip instead of an authored line", async () => {
    const mind = new FakeMind([{ output: borrowing }, { output: borrowing }]);
    const result = await run(mind);
    expect(result.failure).toBeNull();
    expect(result.output!.lines[0]!.text).toBe(borrowing.lines[0]!.text);
    expect(result.calls.map((c) => c.validation)).toEqual(["borrowed", "kept:borrowed"]);
    expect(result.adjustments.at(-1)).toMatch(/^kept despite borrowed/);
  });

  it("keeps the first reply when the regeneration fails outright", async () => {
    const mind = new FakeMind([{ output: borrowing }, { output: '{"lines": [' }]);
    const result = await run(mind);
    expect(result.failure).toBeNull();
    expect(result.output!.lines[0]!.text).toBe(borrowing.lines[0]!.text);
    expect(result.calls.map((c) => c.validation)).toEqual(["borrowed", "schema"]);
  });

  it("still falls back on two hard failures", async () => {
    const result = await run(new FakeMind([{ output: "nope" }, { output: "nope" }]));
    expect(result.output).toBeNull();
    expect(result.failure?.code).toBe("invalid_output");
  });
});
