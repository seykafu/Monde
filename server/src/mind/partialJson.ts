/**
 * Incremental extraction of `lines[i].text` from a dialogue turn's JSON while it streams (GDD §9.10 flow step 4:
 * lines go to the typewriter as they arrive). Structured outputs guarantee the finished JSON, but mid-stream the
 * buffer is a prefix, so this is a tolerant character-level state machine rather than a parser: it tracks just
 * enough nesting to know when it is inside the string value at root → "lines" → [i] → "text", and decodes that
 * string's escapes as they arrive. It never throws; anything it doesn't understand is ignored.
 */

type Frame =
  | { kind: "object"; key: string | null; awaitingKey: boolean }
  | { kind: "array"; index: number };

export interface LineProgress {
  index: number;
  /** The decoded text of line `index` so far. */
  text: string;
  /** True once the line's closing quote has arrived: the text is final. */
  done: boolean;
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t",
};

export class LineTextExtractor {
  private readonly stack: Frame[] = [];
  private inString = false;
  private stringIsKey = false;
  private escape = false;
  private unicode: string | null = null;
  private keyBuffer = "";
  /** Which line the current string feeds, or null if it isn't a line text. */
  private target: number | null = null;
  private readonly texts: string[] = [];
  private readonly done: boolean[] = [];

  /** Feed the next chunk. Returns the lines whose text changed, in index order. */
  push(chunk: string): LineProgress[] {
    const changed = new Set<number>();
    for (const ch of chunk) this.step(ch, changed);
    return [...changed].sort((a, b) => a - b)
      .map((index) => ({ index, text: visible(this.texts[index] ?? ""), done: this.done[index] ?? false }));
  }

  /** Every line's text so far. */
  get lines(): readonly string[] {
    return this.texts.map(visible);
  }

  private step(ch: string, changed: Set<number>): void {
    if (this.inString) {
      this.stringChar(ch, changed);
      return;
    }
    const top = this.stack[this.stack.length - 1];
    switch (ch) {
      case "{":
        this.stack.push({ kind: "object", key: null, awaitingKey: true });
        return;
      case "[":
        this.stack.push({ kind: "array", index: 0 });
        return;
      case "}":
      case "]":
        this.stack.pop();
        return;
      case ":":
        if (top?.kind === "object") top.awaitingKey = false;
        return;
      case ",":
        if (top?.kind === "object") { top.awaitingKey = true; top.key = null; }
        else if (top?.kind === "array") top.index += 1;
        return;
      case '"':
        this.inString = true;
        this.escape = false;
        this.unicode = null;
        this.stringIsKey = top?.kind === "object" && top.awaitingKey;
        this.keyBuffer = "";
        this.target = this.stringIsKey ? null : this.lineTarget();
        if (this.target !== null) while (this.texts.length <= this.target) { this.texts.push(""); this.done.push(false); }
        return;
      default:
        return; // whitespace, numbers, true/false/null: not interesting
    }
  }

  /** root object, key "lines" → array (element i) → object, key "text" → this string. */
  private lineTarget(): number | null {
    const [root, lines, line] = this.stack;
    if (this.stack.length !== 3) return null;
    if (root?.kind !== "object" || root.key !== "lines") return null;
    if (lines?.kind !== "array") return null;
    if (line?.kind !== "object" || line.key !== "text") return null;
    return lines.index;
  }

  private stringChar(ch: string, changed: Set<number>): void {
    if (this.unicode !== null) {
      if (!/[0-9a-fA-F]/.test(ch)) { this.unicode = null; return; } // malformed escape: drop it
      this.unicode += ch;
      if (this.unicode.length === 4) {
        this.emit(String.fromCharCode(parseInt(this.unicode, 16)), changed);
        this.unicode = null;
      }
      return;
    }
    if (this.escape) {
      this.escape = false;
      if (ch === "u") { this.unicode = ""; return; }
      const decoded = SIMPLE_ESCAPES[ch];
      if (decoded !== undefined) this.emit(decoded, changed);
      return;
    }
    if (ch === "\\") { this.escape = true; return; }
    if (ch === '"') {
      this.inString = false;
      if (this.stringIsKey) {
        const top = this.stack[this.stack.length - 1];
        if (top?.kind === "object") top.key = this.keyBuffer;
      }
      if (this.target !== null) {
        this.done[this.target] = true;
        changed.add(this.target);
      }
      this.target = null;
      return;
    }
    this.emit(ch, changed);
  }

  private emit(text: string, changed: Set<number>): void {
    if (this.stringIsKey) { this.keyBuffer += text; return; }
    if (this.target === null) return;
    this.texts[this.target] += text;
    changed.add(this.target);
  }
}

/** Hide a trailing lone high surrogate (the other half of an emoji-style \u pair hasn't arrived yet). */
function visible(text: string): string {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}
