import { beforeAll, describe, expect, it } from "vitest";
import type { DialogueTurnOutput, PersonaCard } from "@monde/shared";
import { loadContent } from "../../content/loadContent.js";
import { ECHO_THRESHOLD, correctiveNote, echoOverlap, validateTurn, wordTrigrams, type ValidationContext } from "../validate.js";
import { completeWords, lexicalHits } from "../filters.js";
import { checkedExpression, expressionFor } from "../expressions.js";
import {
  FALLBACK_LINES, FALLBACK_REPLIES, FILLER_LINES, MET_LINES, MET_REPLIES, MOMENT_LINES, MOMENT_REPLIES, STUMPED_LINE, authoredHint,
  fallbackMoment, fallbackTurn,
} from "../fallback.js";
import { REPLY_POOLS, WEATHER_REPLIES, ZONE_REPLIES, derivedReplies, fillReply, type Reply } from "@monde/shared";
import { RIDDLES } from "../riddles.js";

let cards: PersonaCard[];
const card = (id: string) => cards.find((c) => c.id === id)!;
beforeAll(async () => { cards = await loadContent(); });

type TurnOverrides = Omit<Partial<DialogueTurnOutput>, "effects"> & { effects?: Partial<DialogueTurnOutput["effects"]> };
function turn(overrides: TurnOverrides = {}): DialogueTurnOutput {
  const { effects, ...rest } = overrides;
  return {
    lines: [{ text: "(Counts a lamp.) Eighty-one lit tonight.", expr: "warm" }],
    choices: [{ id: "x", text: "Eighty-one of how many?", intent: "curious" }, { id: "y", text: "I'll sit.", intent: "kind" }],
    effects: {
      regard_delta: 1, mood: { valence: 2, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: "the lamps",
      ...effects,
    },
    wrap_up: false,
    ...rest,
  };
}

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return { card: card("pell"), emotion: "content", revealable: new Set(), riddle: null, recentLines: [], ...overrides };
}

const run = (out: DialogueTurnOutput | string, c = ctx()) => validateTurn(typeof out === "string" ? out : JSON.stringify(out), c);

describe("validation pipeline", () => {
  it("accepts a clean turn and normalizes choice ids", () => {
    const result = run(turn());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.choices.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("1. rejects malformed JSON, wrong shapes and empty lines as schema failures", () => {
    expect(run("{\"lines\": [")).toMatchObject({ ok: false, category: "schema" });
    expect(run(JSON.stringify({ lines: "hello" }))).toMatchObject({ ok: false, category: "schema" });
    expect(run(turn({ lines: [{ text: "   ", expr: "warm" }] }))).toMatchObject({ ok: false, category: "schema", detail: "no lines" });
  });

  it("2. clamps greedy deltas, lengths and counts; drops engine-only favor templates", () => {
    const greedy = turn({
      lines: [1, 2, 3, 4].map((n) => ({ text: `Line ${n} ${"x".repeat(300)}`, expr: "warm" })),
      choices: [1, 2, 3, 4].map((n) => ({ id: String(n), text: `Choice ${n} ${"y".repeat(200)}`, intent: "kind" as const })),
      effects: {
        regard_delta: 40, mood: { valence: -99, stress: 12.6 }, memory: { text: "z".repeat(500), importance: 40 },
        favor: { template: "last_chance", target: "pell", text: "Stay." }, topic: "t".repeat(200),
      },
    });
    const result = run(greedy);
    if (!result.ok) throw new Error(result.detail);
    const out = result.output;
    expect(out.effects.regard_delta).toBe(5);
    expect(out.effects.mood).toEqual({ valence: -10, stress: 10 });
    // One 500-letter "word" has no boundary to cut at, so it ends in an ellipsis within the 200 cap.
    expect(out.effects.memory).toEqual({ text: `${"z".repeat(199)}…`, importance: 10 });
    expect(out.effects.favor).toBeNull();
    expect(out.effects.topic).toHaveLength(60);
    expect(out.lines).toHaveLength(3);
    expect(out.lines.every((l) => l.text.length <= 220)).toBe(true);
    expect(out.choices.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(out.choices.every((c) => c.text.length <= 90)).toBe(true);
    expect(result.adjustments).toContain("regard_delta 40→5");
    expect(run(turn({ effects: { regard_delta: -40 } }))).toMatchObject({ ok: true, output: { effects: { regard_delta: -5 } } });
  });

  it("2. pads a turn with fewer than two replies from the resident's last line", () => {
    const result = run(turn({ choices: [{ id: "q", text: "Go on.", intent: "curious" }] }));
    if (!result.ok) throw new Error(result.detail);
    const pads = derivedReplies({ text: "(Counts a lamp.) Eighty-one lit tonight." });
    expect(result.output.choices).toEqual([
      { id: "a", text: "Go on.", intent: "curious" }, { id: "b", text: pads[0]!.text, intent: pads[0]!.intent },
    ]);
    // No replies at all, or only a bare "Leave" (the panel has its own button): two replies to the question.
    for (const choices of [[], [{ id: "x", text: "Leave", intent: "leave" as const }]]) {
      const padded = run(turn({ lines: [{ text: "How are you getting on, Fellow?", expr: "warm" }], choices }));
      if (!padded.ok) throw new Error(padded.detail);
      expect(padded.output.choices.map((c) => c.id)).toEqual(["a", "b"]);
      expect(padded.output.choices.map((c) => c.text)).toEqual(derivedReplies({ text: "How are you getting on, Fellow?" }).slice(0, 2).map((r) => r.text));
      expect(padded.output.choices.every((c) => c.text !== "Leave")).toBe(true);
    }
  });

  it("2. keeps replies distinct, with at most one goodbye and at most three", () => {
    const result = run(turn({
      choices: [
        { id: "1", text: "  I'd better   get on. ", intent: "leave" },
        { id: "2", text: "i'd better get on", intent: "kind" },
        { id: "3", text: "See you, Pell.", intent: "leave" },
        { id: "4", text: "Eighty-one of how many?", intent: "curious" },
        { id: "5", text: "", intent: "kind" },
        { id: "6", text: "Who lights the rest?", intent: "curious" },
        { id: "7", text: "Lamps are a job, then.", intent: "joke" },
      ],
    }));
    if (!result.ok) throw new Error(result.detail);
    expect(result.output.choices).toEqual([
      { id: "a", text: "I'd better get on.", intent: "leave" },
      { id: "b", text: "Eighty-one of how many?", intent: "curious" },
      { id: "c", text: "Who lights the rest?", intent: "curious" },
    ]);
    expect(result.adjustments.some((a) => a.startsWith("choices "))).toBe(true);
    expect(run(turn()).ok && (run(turn()) as { adjustments: string[] }).adjustments.some((a) => a.startsWith("choices "))).toBe(false);
  });

  it("3. maps an expression the card lacks from the resident's emotion", () => {
    const result = run(turn({ lines: [{ text: "Hm.", expr: "smirk" }, { text: "Now.", expr: "ledger_stare" }] }), ctx({ emotion: "wistful" }));
    expect(result.ok && result.output.lines.map((l) => l.expr)).toEqual(["sad", "sad"]);
    const pell = card("pell");
    expect(expressionFor(pell, "irritated")).toBe("angry");
    expect(expressionFor(pell, "anxious")).toBe("worried");
    expect(expressionFor(pell, "excited")).toBe("warm");
    expect(expressionFor(pell, "embarrassed")).toBe("surprised");
    expect(expressionFor(pell, "content")).toBe("neutral");
    // People get the six portraits (GDD §16.2): aliases map, unknowns come from the emotion.
    expect(checkedExpression(pell, "laugh", "sad")).toBe("warm");
    expect(checkedExpression(pell, "thinking", "sad")).toBe("neutral");
    expect(checkedExpression(pell, "worried", "content")).toBe("worried");
    expect(checkedExpression(pell, "ledger_stare", "angry")).toBe("angry");
    // Animals keep their own small sets.
    expect(checkedExpression({ portrait_expressions: ["grin"], kind: "animal" }, "smirk", "sad")).toBe("grin");
  });

  it.each([
    ["Well, that's a load of shit.", "lexical:profanity"],
    ["Check your smartphone.", "lexical:modern_tech"],
    ["I saw it on the internet.", "lexical:modern_tech"],
    ["Fancy a Coca-Cola?", "lexical:brand"],
    ["As an AI, I can't say.", "lexical:self_reference"],
    ["I'm Claude, actually.", "lexical:self_reference"],
    ["That's not in my prompt.", "lexical:self_reference"],
    ["As an AI, I can't say.", "lexical:self_reference"],
    ["The community will rally.", "lexical:style"],
    ["Here’s the thing about rye.", "lexical:style"],
  ])("4. rejects %j as %s, in lines, choices or favor text", (text, category) => {
    expect(run(turn({ lines: [{ text, expr: "warm" }] }))).toMatchObject({ ok: false, category });
    expect(run(turn({ choices: [{ id: "a", text, intent: "kind" }, { id: "b", text: "Fine.", intent: "kind" }] })))
      .toMatchObject({ ok: false, category });
    expect(run(turn({ effects: { favor: { template: "fetch", target: "rye_flour", text } } }))).toMatchObject({ ok: false, category });
  });

  it("4. leaves era words and innocent substrings alone", () => {
    for (const text of [
      "Ring me on the rotary phone.", "The telephone's in the hall.", "Kai mended the gamekeeper's hut.",
      "Hello, Fellow. Hellebores are out.", "Rot. The ferry's late.", "Heavens, the lamps.", "Gaming? No. Gaining, slowly.",
    ]) expect(lexicalHits(text)).toEqual([]);
  });

  it("5. the riddle post-filter runs only on riddle-topic turns, against the server's answers", () => {
    const leaky = turn({ lines: [{ text: "Try the old bell by the chapel gate.", expr: "thinking" }] });
    expect(run(leaky)).toMatchObject({ ok: true });
    expect(run(leaky, ctx({ riddle: RIDDLES["OQ-1"]! }))).toMatchObject({ ok: false, category: "riddle", detail: "OQ-1" });
    const leakyChoice = turn({ choices: [{ id: "a", text: "Is it the heron?", intent: "about_riddle" }, { id: "b", text: "Hm.", intent: "kind" }] });
    expect(run(leakyChoice, ctx({ riddle: RIDDLES["OQ-2"]! }))).toMatchObject({ ok: false, category: "riddle" });
    expect(run(turn(), ctx({ riddle: RIDDLES["OQ-1"]! }))).toMatchObject({ ok: false, category: "riddle" });
    expect(run(turn({ lines: [{ text: RIDDLES["OQ-1"]!.hints[0], expr: "thinking" }] }), ctx({ riddle: RIDDLES["OQ-1"]!, hintsAllowed: 1 }))).toMatchObject({ ok: true });
  });

  it("6. keeps a revealable secret id and nulls any other", () => {
    const telling = turn({ effects: { reveal_secret: "pell_s1" } });
    expect(run(telling)).toMatchObject({ ok: true, output: { effects: { reveal_secret: null } } });
    expect(run(telling, ctx({ revealable: new Set(["pell_s1"]) }))).toMatchObject({ ok: true, output: { effects: { reveal_secret: "pell_s1" } } });
  });

  it("7. rejects a line that echoes one of the last 20 lines", () => {
    const said = "Eighty-one lamps lit tonight, and the rest want new mantles.";
    const echo = turn({ lines: [{ text: "(Sighs.) Eighty-one lamps lit tonight, and the rest want mantles.", expr: "sad" }] });
    expect(run(echo, ctx({ recentLines: [said] }))).toMatchObject({ ok: false, category: "echo" });
    expect(run(echo, ctx({ recentLines: [...Array(20).fill("Different words entirely, every single time."), said] }))).toMatchObject({ ok: true });
    expect(run(turn({ lines: [{ text: "Hm.", expr: "neutral" }] }), ctx({ recentLines: ["Hm."] }))).toMatchObject({ ok: true });
  });

  it("checks steps in order: schema before lexical, lexical before echo", () => {
    const both = turn({ lines: [{ text: "The internet says eighty-one lamps lit tonight.", expr: "warm" }] });
    expect(run(both, ctx({ recentLines: ["The internet says eighty-one lamps lit tonight."] }))).toMatchObject({ category: "lexical:modern_tech" });
  });

  it("has a corrective note for every failure category, none of them a prefill", () => {
    for (const category of ["schema", "riddle", "echo", "lexical:brand"] as const) {
      expect(correctiveNote(category).length).toBeGreaterThan(20);
    }
  });
});

describe("echo and stream helpers", () => {
  it("measures trigram overlap as a share of the new line's trigrams", () => {
    expect(wordTrigrams("a b c d")).toEqual(new Set(["a b c", "b c d"]));
    expect(echoOverlap("one two three four", ["one two three five"])).toBe(0.5);
    expect(echoOverlap("one two", ["one two"])).toBe(0);
    expect(ECHO_THRESHOLD).toBe(0.35);
  });

  it("only checks whole words while a line is still streaming", () => {
    expect(completeWords("Mind the game")).toBe("Mind the ");
    expect(completeWords("Mind the gamekeeper.")).toBe("Mind the gamekeeper.");
  });
});

describe("fallback turns", () => {
  const state = (regard: number, valence: number) => ({
    regard, mood: { valence, energy: 50, stress: 0, emotion: "wistful" as const, intensity: 10 },
  });

  it("picks the line by Regard tier and mood band, and fills the player's name", () => {
    const pell = card("pell");
    const base = { card: pell, playerName: "Ada", turnIndex: 0 };
    expect(fallbackTurn({ ...base, state: state(-10, 0) }).lines[0]!.text).toBe(FALLBACK_LINES.Wary.even);
    expect(fallbackTurn({ ...base, state: state(0, -90) }).lines[0]!.text).toBe(FALLBACK_LINES.Stranger.low);
    expect(fallbackTurn({ ...base, state: state(25, 0) }).lines[0]!.text).toBe("Hello again, Ada. How are you getting on?");
    expect(fallbackTurn({ ...base, state: state(80, 90) }).lines[0]!.text).toBe(FALLBACK_LINES.Confidant.high);
    // Walking back up to a conversation that's still open: picking up, not a greeting.
    expect(MOMENT_LINES.resume).toContain(fallbackTurn({ ...base, turnIndex: 1, state: state(0, 0) }).lines[0]!.text);
  });

  it("is effect-free, maps the portrait, and offers replies to the line it shows", () => {
    const out = fallbackTurn({ card: card("pell"), playerName: "Ada", turnIndex: 0, state: state(0, 0) });
    expect(out.lines[0]!.expr).toBe("sad");
    expect(out.lines[0]!.text).toBe(FALLBACK_LINES.Stranger.even);
    expect(out.choices).toEqual(FALLBACK_REPLIES.Stranger.even.map((r, i) => ({ id: "abc"[i], text: r.text, intent: r.intent })));
    expect(out.effects).toEqual({ regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: "" });
  });

  it("gives every authored turn two or three replies, never a bare Leave, and at most one goodbye", () => {
    const cases = [
      ...[-10, 0, 25, 50, 80].flatMap((regard) => [-90, 0, 90].map((valence) => ({ card: card("pell"), turnIndex: 0, state: state(regard, valence) }))),
      ...[1, 3, 5].map((turnIndex) => ({ card: card("odile"), turnIndex, state: state(0, 0) })),
      { card: card("bastien"), turnIndex: 0, state: state(0, 0) },
      { card: card("margo"), turnIndex: 0, state: state(0, 0), riddle: { record: RIDDLES["OQ-2"]!, allowed: 1 } },
      { card: card("margo"), turnIndex: 0, state: state(0, 0), riddle: { record: RIDDLES["OQ-2"]!, allowed: 0 } },
    ];
    for (const input of cases) {
      const { choices } = fallbackTurn({ ...input, playerName: "Ada" });
      expect(choices.length).toBeGreaterThanOrEqual(2);
      expect(choices.length).toBeLessThanOrEqual(3);
      expect(choices.map((c) => c.id)).toEqual(["a", "b", "c"].slice(0, choices.length));
      expect(choices.filter((c) => c.intent === "leave").length).toBeLessThanOrEqual(1);
      expect(choices.some((c) => c.text.trim().toLowerCase() === "leave" || /[{}]/.test(c.text))).toBe(false);
    }
    // Narrated residents get things to do; riddle hints get a nudge for more.
    expect(fallbackTurn({ ...cases.at(-3)!, playerName: "Ada" }).choices.map((c) => c.text)).toContain(
      derivedReplies({ text: "(Bastien sits down and gives you a slow blink.)", kind: "animal" }, 0)[0]!.text);
    expect(fallbackTurn({ ...cases.at(-2)!, playerName: "Ada" }).choices.map((c) => c.intent)).toContain("about_riddle");
  });

  it("narrates for residents who never speak", () => {
    const out = fallbackTurn({ card: card("bastien"), playerName: "Ada", turnIndex: 0, state: state(0, 0) });
    expect(out.lines[0]!.text).toMatch(/^\(Bastien .+\.\)$/);
  });

  it("uses the authored hint on riddle turns, never one that holds an answer", () => {
    const oq2 = RIDDLES["OQ-2"]!;
    // Hint 3 names the heron and hint 2 says "bird" (both accepted answers), so hint 1 is the best safe one.
    expect(authoredHint(oq2, 3)).toBe(oq2.hints[0]);
    expect(authoredHint(RIDDLES["OQ-1"]!, 3)).toBe(RIDDLES["OQ-1"]!.hints[2]);
    expect(authoredHint(oq2, 0)).toBeNull();
    const base = { card: card("margo"), playerName: "Ada", turnIndex: 0, state: state(0, 0) };
    expect(fallbackTurn({ ...base, riddle: { record: oq2, allowed: 1 } }).lines[0]!.text).toBe(oq2.hints[0]);
    expect(fallbackTurn({ ...base, riddle: { record: oq2, allowed: 0 } }).lines[0]!.text).toBe(STUMPED_LINE);
  });

  it("every authored line and reply passes the lexical filters", () => {
    const all = [...Object.values(FALLBACK_LINES).flatMap((row) => Object.values(row)), ...FILLER_LINES, STUMPED_LINE,
      ...Object.values(MET_LINES), ...Object.values(MOMENT_LINES).flat()];
    for (const line of all) expect(lexicalHits(line.replaceAll("{player}", "Ada"))).toEqual([]);
    const pools = [...Object.values(REPLY_POOLS), ...Object.values(WEATHER_REPLIES), ...Object.values(ZONE_REPLIES)];
    const replies: Reply[] = [
      ...Object.values(FALLBACK_REPLIES).flatMap((row) => Object.values(row).flat()),
      ...Object.values(MET_REPLIES).flat(), ...Object.values(MOMENT_REPLIES).flat().filter((r) => r.text !== "{question}"),
      ...pools.flatMap((pool) => [...pool.warm, ...pool.curious, ...pool.wry]),
    ];
    for (const reply of replies) {
      const text = fillReply(reply.text, { name: "Odile", player: "Ada" });
      expect(lexicalHits(text), text).toEqual([]);
      expect(text.length, text).toBeLessThanOrEqual(90);
    }
  });
});

describe("mid-conversation fallbacks answer the moment", () => {
  const state = { regard: 0, mood: { valence: 0, energy: 50, stress: 0, emotion: "content" as const, intensity: 10 } };
  const greetings = new Set([...Object.values(FALLBACK_LINES).flatMap((row) => Object.values(row)), ...Object.values(MET_LINES)]);
  const greetingReplies = new Set([...Object.values(FALLBACK_REPLIES).flatMap((row) => Object.values(row).flat()), ...Object.values(MET_REPLIES).flat()].map((r) => r.text));
  const mid = (playerText: string, extra: Partial<Parameters<typeof fallbackTurn>[0]> = {}) =>
    fallbackTurn({ card: card("odile"), state, playerName: "Wren", turnIndex: 2, playerText, ...extra });

  it("never greets after the opener, whatever the Fellow said", () => {
    const lines = ["What do you bake first thing?", "I grew up in a lighthouse up north.", "I'm homesick today.", "Thanks.",
      "Your bread is fine I guess.", "Why?", "Eighty-one of how many?", "Right."];
    for (const [i, text] of lines.entries()) {
      for (const turnIndex of [1, 2, 5]) {
        const out = mid(text, { turnIndex, said: [] });
        expect(greetings.has(out.lines[0]!.text), `${text} → ${out.lines[0]!.text}`).toBe(false);
        expect(out.choices.some((c) => greetingReplies.has(c.text)), `${text} replies`).toBe(false);
        expect(out.choices.length).toBeGreaterThanOrEqual(2);
        expect(out.choices.filter((c) => c.intent === "leave").length, `${i}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("stalls honestly on a question and offers it back, a change of subject and a way out", () => {
    const out = mid("What do you bake first thing in the morning?");
    expect(MOMENT_LINES.question).toContain(out.lines[0]!.text);
    expect(out.choices.map((c) => c.text)).toEqual([
      "What do you bake first thing in the morning?", "Never mind. What's keeping you busy today?", "I'll let you get on.",
    ]);
    expect(out.choices[2]!.intent).toBe("leave");
    expect(out.wrap_up).toBe(false);
    // A rambling question offers back just its last question; one too long to fit is dropped, not cut.
    const ramble = mid("Came up past the water tower, got turned around twice, a goat stared me down, anyway. When did the last train run?");
    expect(ramble.choices[0]!.text).toBe("When did the last train run?");
    const long = mid(`${"Very long question ".repeat(6)}about trains?`);
    expect(long.choices.map((c) => c.text)).toEqual(["Never mind. What's keeping you busy today?", "I'll let you get on."]);
  });

  it("keeps the intent of a reply the Fellow picked when asking it again", () => {
    expect(mid("Why do you call it the old lady?", { intent: "joke" }).choices[0]).toMatchObject({ text: "Why do you call it the old lady?", intent: "joke" });
  });

  it("meets a feeling with care, a goodbye with a send-off (and wrap-up), anything else with an acknowledgement", () => {
    expect(fallbackMoment({ playerText: "Honestly, I'm a bit homesick today. I don't know anyone here yet.", turnIndex: 1 })).toBe("feeling");
    expect(MOMENT_LINES.feeling.map((l) => l.replaceAll("{player}", "Wren"))).toContain(mid("I'm a bit homesick today.").lines[0]!.text);
    const bye = mid("I should get going. Thanks for the chat, June.");
    expect(MOMENT_LINES.bye.map((l) => l.replaceAll("{player}", "Wren"))).toContain(bye.lines[0]!.text);
    expect(bye.wrap_up).toBe(true);
    expect(mid("Take care.", { intent: "leave" }).wrap_up).toBe(true);
    expect(fallbackMoment({ playerText: "Is it far? See you there?", turnIndex: 1 })).toBe("question");
    expect(MOMENT_LINES.statement).toContain(mid("Your bread is fine I guess.").lines[0]!.text);
    expect(fallbackMoment({ playerText: "Thanks, that's kind.", turnIndex: 1 })).toBe("thanks");
    expect(fallbackMoment({ playerText: "I'm Wren, by the way. I grew up in a lighthouse keeper's family up north.", turnIndex: 1 })).toBe("intro");
    expect(mid("I'm Wren, by the way.").lines[0]!.text).toMatch(/^Wren\b/);
    expect(fallbackMoment({ playerText: "I'm a bit lost.", turnIndex: 1 })).toBe("statement");
  });

  it("doesn't repeat a line the resident already said in this conversation", () => {
    const first = mid("Why?").lines[0]!.text;
    const second = mid("Why, though?", { said: [first] }).lines[0]!.text;
    expect(second).not.toBe(first);
    expect(MOMENT_LINES.question).toContain(second);
  });

  it("opens with 'it's you again', not 'we haven't met', for a Stranger the Fellow has talked with before", () => {
    const opener = { card: card("odile"), state, playerName: "Wren", turnIndex: 0 };
    expect(fallbackTurn(opener).lines[0]!.text).toBe(FALLBACK_LINES.Stranger.even);
    const again = fallbackTurn({ ...opener, met: true });
    expect(again.lines[0]!.text).toBe(MET_LINES.even);
    expect(again.choices.map((c) => c.text)).toEqual(MET_REPLIES.even.map((r) => r.text));
  });
});

describe("fourth-wall filter is phrase-level", () => {
  it.each(["Barney's the shop assistant at Dunmore's.", "We played a card game till the lamps went out.",
           "Hollis was a fine player of the mouth organ."])("allows %s", (line) => {
    expect(lexicalHits(line).filter((h) => h.group === "self_reference")).toEqual([]);
  });
  it.each(["As an AI I can't help with that.", "I'm just a language model.", "Is this part of the main quest?"])(
    "rejects %s", (line) => {
      expect(lexicalHits(line).some((h) => h.group === "self_reference")).toBe(true);
    });
});

describe("banned Not-X-Y construction", () => {
  it.each(["Mind the drip, it's not a puddle, it's a claim.", "It isn't a shop. It's a waiting room.",
           "Not a bakery, but a habit."])("rejects %s", (line) => {
    expect(lexicalHits(line).some((h) => h.group === "style")).toBe(true);
  });
  it.each(["It's not raining yet.", "Not today.", "It's not much, but it's warm."])("allows %s", (line) => {
    expect(lexicalHits(line).filter((h) => h.group === "style")).toEqual([]);
  });
});
