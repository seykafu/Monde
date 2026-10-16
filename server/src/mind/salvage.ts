/**
 * Salvaging a dialogue turn whose JSON was cut short (GDD §9.10, §9.13): a `max_tokens` stop, or a stream that
 * stalled or dropped after it had started. Throwing the whole turn away would replace lines the player may already
 * be reading with an authored filler, so the complete parts are kept instead:
 *
 *   lines    every line whose text closed, plus the unfinished one cut back to its last whole sentence (≥ 3 words)
 *   choices  the ones that closed; the validator pads the rest from the last line (shared/src/replies.ts)
 *   effects  only if the whole effects object closed and parses; otherwise none at all (a half-read proposal is
 *            never applied)
 *   wrap_up  if it arrived, else false
 *
 * The result then goes through the normal validation pipeline (validate.ts), so lexical, riddle and echo rules still
 * hold. Pure: no I/O.
 */
import { DialogueTurnOutput, INTENTS, type Intent } from "@monde/shared";
import { LineTextExtractor } from "./partialJson.js";

/** A cut-back line must keep at least this many words to be worth showing. */
const MIN_SENTENCE_WORDS = 3;

/**
 * Parse the longest prefix of truncated JSON that can be closed into a valid document: cut after the last complete
 * value and append the brackets still open. Returns null when nothing parses.
 */
export function closePartialJson(raw: string): unknown {
  const stack: ("{" | "[")[] = [];
  /** [cut position, closers] pairs, in text order. */
  const candidates: [number, string][] = [];
  let inString = false;
  let escape = false;
  /** Is the string being read an object key? */
  let keyString = false;
  /** In an object: true while the next string would be a key. */
  const awaitingKey: boolean[] = [];
  const closers = () => stack.slice().reverse().map((c) => (c === "{" ? "}" : "]")).join("");
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') {
        inString = false;
        if (!keyString) candidates.push([i + 1, closers()]);
      }
      continue;
    }
    switch (ch) {
      case '"':
        inString = true;
        keyString = stack.at(-1) === "{" && awaitingKey.at(-1) === true;
        break;
      case "{":
        stack.push("{");
        awaitingKey.push(true);
        break;
      case "[":
        stack.push("[");
        awaitingKey.push(false);
        break;
      case "}":
      case "]":
        stack.pop();
        awaitingKey.pop();
        candidates.push([i + 1, closers()]);
        break;
      case ":":
        if (stack.at(-1) === "{") awaitingKey[awaitingKey.length - 1] = false;
        break;
      case ",":
        // Everything before a comma is a complete value (numbers and literals end here).
        candidates.push([i, closers()]);
        if (stack.at(-1) === "{") awaitingKey[awaitingKey.length - 1] = true;
        break;
      default:
        break;
    }
  }
  for (let c = candidates.length - 1; c >= 0; c--) {
    const [cut, close] = candidates[c]!;
    try {
      return JSON.parse(raw.slice(0, cut) + close) as unknown;
    } catch {
      // try an earlier cut
    }
  }
  return null;
}

/** The text up to and including its last whole sentence, or null if that leaves too little. */
export function lastWholeSentence(text: string): string | null {
  const match = /^[\s\S]*[.?!](?:["')\]]+)?(?=\s|$)/.exec(text.trim());
  if (!match) return null;
  const kept = match[0].trim();
  // A lone "(Wipes the counter.)" isn't a reply: count the spoken words only.
  const spoken = kept.replace(/\([^)]*\)/g, " ").trim();
  return spoken && spoken.split(/\s+/).length >= MIN_SENTENCE_WORDS ? kept : null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isIntent = (v: unknown): v is Intent => typeof v === "string" && (INTENTS as readonly string[]).includes(v);

const NO_EFFECTS: DialogueTurnOutput["effects"] = {
  regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: "",
};

export interface Salvaged {
  /** A complete turn in the contract's shape (choices may be short: the validator pads them). */
  turn: DialogueTurnOutput;
  /** What was kept, for the log. */
  kept: { lines: number; cutLine: boolean; choices: number; effects: boolean; wrapUp: boolean };
}

/** Rebuild a turn from truncated output, or null when no line survived. */
export function salvageTurn(raw: string): Salvaged | null {
  const partial = closePartialJson(raw);
  const root = isObject(partial) ? partial : {};
  const lines: DialogueTurnOutput["lines"] = (Array.isArray(root.lines) ? root.lines : []).flatMap((l: unknown) =>
    isObject(l) && typeof l.text === "string" && l.text.trim() !== ""
      ? [{ text: l.text, expr: typeof l.expr === "string" ? l.expr : "" }] : []);
  // The line still being written when the output stopped: keep its whole sentences.
  let cutLine = false;
  const extractor = new LineTextExtractor();
  const progress = extractor.push(raw);
  const open = progress.find((p) => p.index === lines.length && !p.done);
  if (open && lines.length < 3) {
    const kept = lastWholeSentence(open.text);
    if (kept) { lines.push({ text: kept, expr: "" }); cutLine = true; }
  }
  if (lines.length === 0) return null;

  const choices: DialogueTurnOutput["choices"] = (Array.isArray(root.choices) ? root.choices : []).flatMap((c: unknown) =>
    isObject(c) && typeof c.text === "string" && c.text.trim() !== "" && isIntent(c.intent)
      ? [{ id: typeof c.id === "string" ? c.id : "", text: c.text, intent: c.intent }] : []);
  const effects = DialogueTurnOutput.shape.effects.safeParse(root.effects);
  const wrapUp = typeof root.wrap_up === "boolean" ? root.wrap_up : false;
  return {
    turn: { lines, choices, effects: effects.success ? effects.data : NO_EFFECTS, wrap_up: wrapUp },
    kept: { lines: lines.length, cutLine, choices: choices.length, effects: effects.success, wrapUp: typeof root.wrap_up === "boolean" },
  };
}
