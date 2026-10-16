import { describe, expect, it } from "vitest";
import type { DialogueTurnOutput } from "@monde/shared";
import { closePartialJson, lastWholeSentence, salvageTurn } from "../salvage.js";

const turn: DialogueTurnOutput = {
  lines: [
    { text: "(Wipes flour off the scale.) The starter? She's older than the oven, and twice as fussy.", expr: "warm" },
    { text: "I feed her at four. Rye flour, warm water, a pinch of patience.", expr: "neutral" },
  ],
  choices: [
    { id: "a", text: "Why do you call her the old lady?", intent: "curious" },
    { id: "b", text: "Four in the morning? You're braver than me.", intent: "joke" },
    { id: "c", text: "I'll let you get on.", intent: "leave" },
  ],
  effects: {
    regard_delta: 1, mood: { valence: 1, stress: 0 }, memory: { text: "The Fellow asked about the starter.", importance: 3 },
    favor: null, reveal_secret: null, topic: "the starter",
  },
  wrap_up: false,
};
const raw = JSON.stringify(turn);
const cutAt = (marker: string, extra = 0) => raw.slice(0, raw.indexOf(marker) + extra);

describe("closePartialJson", () => {
  it("parses a whole document unchanged and closes a cut one after its last complete value", () => {
    expect(closePartialJson(raw)).toEqual(turn);
    expect(closePartialJson('{"a": [1, 2, {"b": "x"}, {"c": "un')).toEqual({ a: [1, 2, { b: "x" }] });
    expect(closePartialJson('{"a": 1, "b": 2')).toEqual({ a: 1 });
    expect(closePartialJson('{"a": "x\\" still')).toBeNull(); // the escaped quote doesn't close the string
    expect(closePartialJson("")).toBeNull();
  });
});

describe("lastWholeSentence", () => {
  it("keeps whole sentences of three spoken words or more", () => {
    expect(lastWholeSentence("I feed her at four. Rye flour, warm wa")).toBe("I feed her at four.");
    expect(lastWholeSentence("Is it far? Not really, if you")).toBe("Is it far?");
    expect(lastWholeSentence("(Wipes the counter.) The starter's older than")).toBeNull();
    expect(lastWholeSentence("Hm. Well")).toBeNull();
    expect(lastWholeSentence("It's 4.17 by the tower and")).toBeNull();
  });
});

describe("salvageTurn", () => {
  it("keeps lines and choices when the cut falls in the effects, and drops the half-read effects", () => {
    const salvaged = salvageTurn(cutAt('"memory"', 12))!;
    expect(salvaged.turn.lines).toEqual(turn.lines);
    expect(salvaged.turn.choices).toEqual(turn.choices);
    expect(salvaged.turn.effects).toEqual({ regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: "" });
    expect(salvaged.kept).toMatchObject({ lines: 2, choices: 3, effects: false, wrapUp: false });
  });

  it("keeps whole effects when only wrap_up was lost", () => {
    const salvaged = salvageTurn(cutAt('"wrap_up"', 3))!;
    expect(salvaged.turn.effects).toEqual(turn.effects);
    expect(salvaged.turn.wrap_up).toBe(false);
    expect(salvaged.kept.effects).toBe(true);
  });

  it("keeps the choices that closed when the cut falls among them", () => {
    const salvaged = salvageTurn(cutAt("Four in the morning", 10))!;
    expect(salvaged.turn.lines).toEqual(turn.lines);
    expect(salvaged.turn.choices).toEqual([turn.choices[0]]);
  });

  it("cuts an unfinished line back to its last whole sentence", () => {
    const salvaged = salvageTurn(cutAt("Rye flour", 5))!;
    expect(salvaged.turn.lines.map((l) => l.text)).toEqual([turn.lines[0]!.text, "I feed her at four."]);
    expect(salvaged.kept.cutLine).toBe(true);
    expect(salvaged.turn.choices).toEqual([]);
  });

  it("gives up when no whole line survived", () => {
    expect(salvageTurn('{"lines": [{"text": "On and on')).toBeNull();
    expect(salvageTurn('{"lines": [')).toBeNull();
    expect(salvageTurn("")).toBeNull();
  });
});
