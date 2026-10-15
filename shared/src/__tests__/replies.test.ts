import { describe, expect, it } from "vitest";
import {
  MAX_REPLIES, MIN_REPLIES, REPLY_POOLS, WEATHER_REPLIES, ZONE_REPLIES, callName, derivedReplies, fillReply,
  isBareLeave, normalizeChoices, replyCategory, replyId, type ChoiceLike,
} from "../index";

describe("reply categories", () => {
  it.each([
    [{ text: "Morning. Early start, or a late finish?", kind: "greet" as const }, "either_or"],
    [{ text: "Hello again, Ada. How are you getting on?", kind: "greet" as const }, "how_are_you"],
    [{ text: "Morning, Ada. How's your day shaping up?" }, "how_are_you"],
    [{ text: "Nearly afternoon. Have you eaten yet, Ada?" }, "food"],
    [{ text: "What brings you out this way, Ada?", kind: "talk" as const }, "wh_question"],
    [{ text: "(Slams the tray down.) Who left the oven door open?" }, "wh_question"],
    [{ text: "Fresh one, isn't it?", kind: "greet" as const }, "question"],
    [{ text: "Morning. Did you sleep?" }, "question"],
    [{ text: "Oh. It's you. I haven't the energy for this.", kind: "greet" as const, mood: "glum" as const }, "greet_low"],
    [{ text: "There you are! Lovely start to the day.", kind: "greet" as const, mood: "bright" as const }, "greet_high"],
    [{ text: "Hello. Nice to see a face I know.", kind: "greet" as const, mood: "even" as const }, "greet"],
    [{ text: "Tollmen on the corner again.", kind: "ctx" as const, event: "tollmen_near" }, "news_bad"],
    [{ text: "They finished it. Just like that.", kind: "ctx" as const, event: "project_done" }, "news_good"],
    [{ text: "Rain again. The gutters are getting their money's worth.", kind: "ctx" as const, weather: "rain" }, "weather"],
    [{ text: "Another day of fog. Monde takes what it's given.", kind: "ctx" as const }, "weather"],
    [{ text: "The Old Elm's been here longer than the town's complaints.", kind: "ctx" as const, zone: "commons" }, "place"],
    [{ text: "Some days you just wait for them to end.", kind: "talk" as const, mood: "glum" as const }, "low"],
    [{ text: "I've decided to be optimistic. It's cheaper than worrying.", kind: "talk" as const, mood: "bright" as const }, "high"],
    [{ text: "Hm." }, "filler"],
    [{ text: "Mm-hm.", kind: "talk" as const }, "filler"],
    [{ text: "Thanks for stopping. It helps." }, "thanks"],
    [{ text: "Couldn't tell you. I'm stumped.", kind: "stumped" as const }, "stumped"],
    [{ text: "(Bastien yawns.)", kind: "animal" as const }, "animal"],
    [{ text: "(Counts a lamp.) Eighty-one lit tonight." }, "statement"],
  ])("%j is %s", (cue, category) => {
    expect(replyCategory(cue)).toBe(category);
  });
});

describe("derived replies", () => {
  it("gives three replies in tone order, the same ones every time, with at most one goodbye", () => {
    const cue = { text: "Morning. Early start, or a late finish?", kind: "greet" as const };
    const replies = derivedReplies(cue, 4);
    expect(replies).toHaveLength(3);
    expect(replies.map((r) => r.intent)).toEqual(["kind", "curious", "joke"]);
    expect(derivedReplies(cue, 4)).toEqual(replies);
    for (const pool of [...Object.values(REPLY_POOLS), ...Object.values(WEATHER_REPLIES), ...Object.values(ZONE_REPLIES)]) {
      for (const reply of [...pool.warm, ...pool.curious, ...pool.wry]) {
        expect(reply.text.length).toBeLessThanOrEqual(90);
        expect(isBareLeave(reply)).toBe(false);
      }
      expect([...pool.warm, ...pool.curious, ...pool.wry].filter((r) => r.intent === "leave").length).toBeLessThanOrEqual(1);
    }
  });

  it("answers the weather and the place with their own replies most of the time", () => {
    const fog = Array.from({ length: 12 }, (_, seed) => derivedReplies({ text: "Fog's in.", kind: "ctx", weather: "fog" }, seed));
    expect(fog.filter((r) => r[1]!.text === WEATHER_REPLIES.fog!.curious[0]!.text).length).toBeGreaterThanOrEqual(6);
    const wharf = Array.from({ length: 12 }, (_, seed) => derivedReplies({ text: "Salt and rope.", kind: "ctx", zone: "wharf" }, seed));
    expect(wharf.filter((r) => r[0]!.text === ZONE_REPLIES.wharf!.warm[0]!.text).length).toBeGreaterThanOrEqual(6);
  });

  it("fills the resident's name, or drops it gracefully", () => {
    expect(fillReply("Hello, {name}. Good to see you.", { name: "Odile" })).toBe("Hello, Odile. Good to see you.");
    expect(fillReply("Hello, {name}. Good to see you.", {})).toBe("Hello. Good to see you.");
    expect(fillReply("{name}. Nice to run into you.", {})).toBe("Nice to run into you.");
    expect(fillReply("Good to see you, {player}.", { player: "Wren" })).toBe("Good to see you, Wren.");
  });

  it("calls residents what the town calls them", () => {
    expect(callName('Juniper "June" Castellanos')).toBe("June");
    expect(callName("Captain Augusta Reyes")).toBe("Captain Reyes");
    expect(callName("Odile Fournier")).toBe("Odile");
    expect(callName("Bastien")).toBe("Bastien");
  });
});

describe("normalizeChoices", () => {
  const cue = { text: "How are you getting on, Wren?" };

  it("keeps two or three clean replies as given", () => {
    const given: ChoiceLike[] = [{ id: "a", text: "Fine, thanks.", intent: "kind" }, { id: "b", text: "Why?", intent: "curious" }];
    expect(normalizeChoices(given, { cue })).toEqual(given);
  });

  it("tidies, drops blanks, repeats, bare Leave and a second goodbye, and trims to three", () => {
    const out = normalizeChoices([
      { id: "a", text: "  Must   dash. ", intent: "leave" },
      { id: "b", text: "Leave", intent: "leave" },
      { id: "c", text: "must dash!", intent: "kind" },
      { id: "d", text: "Bye now.", intent: "leave" },
      { id: "e", text: " ", intent: "kind" },
      { id: "f", text: "Fine, thanks.", intent: "kind" },
      { id: "g", text: "Why do you ask?", intent: "curious" },
      { id: "h", text: "One more.", intent: "joke" },
    ], { cue });
    expect(out).toEqual([
      { id: "a", text: "Must dash.", intent: "leave" },
      { id: "f", text: "Fine, thanks.", intent: "kind" },
      { id: "g", text: "Why do you ask?", intent: "curious" },
    ]);
    expect(out.length).toBeLessThanOrEqual(MAX_REPLIES);
  });

  it("pads short turns with replies to the last line, never a second goodbye", () => {
    const derived = derivedReplies(cue);
    expect(normalizeChoices([], { cue })).toEqual(derived.slice(0, MIN_REPLIES).map((r, i) => ({ id: replyId(r, i + 1), text: fillReply(r.text, {}), intent: r.intent })));
    const one = normalizeChoices([{ id: "x", text: "Leave", intent: "leave" }, { id: "y", text: "See you.", intent: "leave" }], { cue, name: "Odile" });
    expect(one).toHaveLength(2);
    expect(one[0]).toEqual({ id: "y", text: "See you.", intent: "leave" });
    expect(one[1]!.intent).not.toBe("leave");
    // Pads are filled and never repeat a given reply.
    const dup = normalizeChoices([{ text: derived[0]!.text, intent: "kind" }], { cue });
    expect(new Set(dup.map((c) => c.text)).size).toBe(dup.length);
    expect(dup.length).toBe(2);
    expect(normalizeChoices([], { cue: { text: "Hello, there.", kind: "greet" }, name: null }).every((c) => !c.text.includes("{"))).toBe(true);
  });

  it("gives pads ids that say whether they ask for the news", () => {
    expect(replyId({ next: "ctx" }, 2)).toBe("news2");
    expect(replyId({}, 1)).toBe("talk1");
    expect(isBareLeave({ text: " leave. " })).toBe(true);
    expect(isBareLeave({ text: "I'd better leave." })).toBe(false);
  });
});
