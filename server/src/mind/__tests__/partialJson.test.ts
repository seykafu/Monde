import { describe, expect, it } from "vitest";
import { LineTextExtractor } from "../partialJson.js";

const TURN = {
  lines: [
    { text: "(Wipes the counter.) Rye's two, \"white\" three.\nAnyway.", expr: "neutral" },
    { text: "Café's shut — ask Ines. 🐟", expr: "warm" },
  ],
  choices: [{ id: "a", text: "not a line", intent: "kind" }],
  effects: { regard_delta: 1, mood: { valence: 0, stress: 0 }, memory: { text: "also not a line", importance: 3 },
    favor: null, reveal_secret: null, topic: "bread" },
  wrap_up: false,
};

/** Feed `json` in chunks of `size` and collect the latest text per line after each push. */
function feed(json: string, size: number) {
  const extractor = new LineTextExtractor();
  const seen: { index: number; text: string }[][] = [];
  for (let i = 0; i < json.length; i += size) seen.push(extractor.push(json.slice(i, i + size)));
  return { extractor, seen: seen.flat() };
}

describe("LineTextExtractor", () => {
  it.each([1, 2, 3, 7, 64, 10_000])("extracts every line exactly, fed %i characters at a time", (size) => {
    const json = JSON.stringify(TURN);
    const { extractor } = feed(json, size);
    expect(extractor.lines).toEqual(TURN.lines.map((l) => l.text));
  });

  it("reports text growing monotonically, line by line, and never text from other fields", () => {
    const { seen } = feed(JSON.stringify(TURN), 1);
    const first = seen.filter((s) => s.index === 0).map((s) => s.text);
    for (let i = 1; i < first.length; i++) expect(first[i]!.startsWith(first[i - 1]!)).toBe(true);
    expect(first.at(-1)).toBe(TURN.lines[0]!.text);
    expect(seen.every((s) => s.index === 0 || s.index === 1)).toBe(true);
    expect(seen.some((s) => s.text.includes("not a line"))).toBe(false);
    // Line 0 is complete before line 1 starts.
    const lastOfFirst = seen.map((s) => s.index).lastIndexOf(0);
    expect(seen.findIndex((s) => s.index === 1)).toBeGreaterThan(lastOfFirst);
  });

  it("decodes \\u escapes split across chunks and hides half a surrogate pair", () => {
    const json = '{"lines":[{"expr":"warm","text":"Caf\\u00e9 \\ud83d\\udc1f done"}]}';
    const extractor = new LineTextExtractor();
    let last = "";
    for (const ch of json) {
      for (const line of extractor.push(ch)) {
        expect(line.text.charCodeAt(line.text.length - 1)).not.toBe(0xd83d);
        last = line.text;
      }
    }
    expect(last).toBe("Café 🐟 done");
  });

  it("tolerates pretty-printed JSON, key order and a truncated stream", () => {
    const pretty = JSON.stringify({ wrap_up: false, lines: [{ expr: "sad", text: "Hm." }, { text: "Not today, Fellow" }] }, null, 2);
    const cut = pretty.slice(0, pretty.indexOf("Fellow") + 3);
    const extractor = new LineTextExtractor();
    extractor.push(cut);
    expect(extractor.lines).toEqual(["Hm.", "Not today, Fel"]);
  });

  it("only reads root-level lines: a nested lines/text pair is ignored", () => {
    const json = JSON.stringify({ effects: { lines: [{ text: "nested" }] }, lines: [{ text: "real" }] });
    const extractor = new LineTextExtractor();
    extractor.push(json);
    expect(extractor.lines).toEqual(["real"]);
  });

  it("marks a line done when its string closes, and only then", () => {
    const extractor = new LineTextExtractor();
    expect(extractor.push('{"lines":[{"text":"Wind\'s turned')).toEqual([{ index: 0, text: "Wind's turned", done: false }]);
    expect(extractor.push('"')).toEqual([{ index: 0, text: "Wind's turned", done: true }]);
    expect(extractor.push(',"expr":"neutral"},{"text":"Mm')).toEqual([{ index: 1, text: "Mm", done: false }]);
  });

  it("never throws on garbage", () => {
    const extractor = new LineTextExtractor();
    expect(() => extractor.push('}}]]"\\u12zz{"lines":[{"text":"ok\\')).not.toThrow();
  });
});
