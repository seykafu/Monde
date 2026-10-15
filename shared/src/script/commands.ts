/**
 * `{cue: args}` parsing (GDD §13.1, §13.5a). Arguments are comma-separated items; an item is either
 * `key: value` (named) or one or more space-separated positional values. Values are "double-quoted strings"
 * (may contain braces, commas and `{name}`-style tokens), integers (`+3`, `-20`, `0`) or bare words
 * (`pell`, `PZ-03`, `auto:nell`, `+signature_book`).
 */
import { PILLARS, TALLY_DISTRICTS, type Command, type CommandName, type Pillar, type TallyDistrict } from "./types";

export type ArgValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number; raw: string }
  | { type: "word"; value: string };

export interface Args { positional: ArgValue[]; named: Map<string, ArgValue> }

/** Split on `sep` outside double quotes and braces. Throws on an unterminated string. */
export function splitTopLevel(src: string, sep: (c: string) => boolean): string[] {
  const out: string[] = [];
  let cur = "", depth = 0, inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inStr) {
      cur += c;
      if (c === "\\" && i + 1 < src.length) { cur += src[++i]; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; cur += c; continue; }
    if (c === "{") depth++;
    if (c === "}") depth--;
    if (depth === 0 && sep(c)) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (inStr) throw new Error("unterminated string (missing closing \")");
  out.push(cur);
  return out;
}

const NUMBER = /^[+-]?\d+$/;
const WORD = /^[+-]?[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;

export function parseValue(tok: string): ArgValue {
  if (tok.startsWith('"')) {
    if (tok.length < 2 || !tok.endsWith('"')) throw new Error(`bad string ${tok}`);
    return { type: "string", value: tok.slice(1, -1).replace(/\\(.)/g, "$1") };
  }
  if (NUMBER.test(tok)) return { type: "number", value: Number(tok), raw: tok };
  if (WORD.test(tok)) return { type: "word", value: tok };
  throw new Error(`can't read '${tok}' (expected a word, a whole number or a "quoted string")`);
}

export function parseArgs(src: string): Args {
  const args: Args = { positional: [], named: new Map() };
  if (src.trim() === "") return args;
  for (const raw of splitTopLevel(src, (c) => c === ",")) {
    const item = raw.trim();
    if (item === "") throw new Error("empty argument (stray comma?)");
    const kv = /^([a-z_][a-z0-9_]*):(?:\s+|(?="))([\s\S]*)$/.exec(item);
    if (kv) {
      const vals = splitTopLevel(kv[2]!.trim(), (c) => /\s/.test(c)).filter((t) => t !== "");
      if (vals.length !== 1) throw new Error(`'${kv[1]}:' takes one value`);
      if (args.named.has(kv[1]!)) throw new Error(`'${kv[1]}:' given twice`);
      args.named.set(kv[1]!, parseValue(vals[0]!));
      continue;
    }
    for (const tok of splitTopLevel(item, (c) => /\s/.test(c))) if (tok !== "") args.positional.push(parseValue(tok));
  }
  return args;
}

// ---------------------------------------------------------------- typed builders

const ID = /^[a-z][a-z0-9_]*$/;
class ArgError extends Error {}
function fail(m: string): never { throw new ArgError(m); }

function describe(v: ArgValue | undefined): string {
  if (!v) return "nothing";
  return v.type === "string" ? `"${v.value}"` : v.type === "number" ? v.raw : v.value;
}

/** Reads one cue's arguments against its shape, failing on missing, extra or unknown arguments. */
class Reader {
  private used = new Set<string>();
  private pos = 0;
  constructor(private name: string, private args: Args) {}
  private next(what: string): ArgValue {
    const v = this.args.positional[this.pos++];
    if (!v) fail(`{${this.name}} needs ${what}`);
    return v!;
  }
  id(what: string): string {
    const v = this.next(what);
    if (v.type !== "word" || !ID.test(v.value)) fail(`{${this.name}}: ${what} must be a snake_case id, got ${describe(v)}`);
    return v.value as string;
  }
  word(what: string): string {
    const v = this.next(what);
    if (v.type !== "word") fail(`{${this.name}}: ${what} must be a bare word, got ${describe(v)}`);
    return v.value as string;
  }
  int(what: string): number {
    const v = this.next(what);
    if (v.type !== "number") fail(`{${this.name}}: ${what} must be a whole number like +3 or -2, got ${describe(v)}`);
    return v.value as number;
  }
  str(what: string): string {
    const v = this.next(what);
    if (v.type !== "string") fail(`{${this.name}}: ${what} must be a "quoted string", got ${describe(v)}`);
    return v.value as string;
  }
  optionalInt(): number | undefined {
    return this.pos < this.args.positional.length ? this.int("a number") : undefined;
  }
  named(key: string, type: ArgValue["type"], required: true): string | number;
  named(key: string, type: ArgValue["type"], required: false): string | number | undefined;
  named(key: string, type: ArgValue["type"], required: boolean): string | number | undefined {
    this.used.add(key);
    const v = this.args.named.get(key);
    if (!v) { if (required) fail(`{${this.name}} needs '${key}:'`); return undefined; }
    if (v.type !== type) fail(`{${this.name}}: '${key}:' must be ${type === "string" ? 'a "quoted string"' : type === "number" ? "a whole number" : "a bare word"}, got ${describe(v)}`);
    return v.value;
  }
  done(): void {
    if (this.pos < this.args.positional.length) fail(`{${this.name}}: unexpected extra argument ${describe(this.args.positional[this.pos])}`);
    for (const k of this.args.named.keys()) if (!this.used.has(k)) fail(`{${this.name}}: unknown argument '${k}:'`);
  }
}

type Builder = (r: Reader) => Command;

const BUILDERS: Record<CommandName, Builder> = {
  set: (r) => ({ cmd: "set", flag: r.id("a flag name") }),
  unset: (r) => ({ cmd: "unset", flag: r.id("a flag name") }),
  regard: (r) => ({ cmd: "regard", resident: r.id("a resident id"), delta: r.int("a change like +3") }),
  pillar: (r) => {
    const p = r.word("a pillar");
    if (!(PILLARS as readonly string[]).includes(p)) fail(`{pillar}: '${p}' is not a pillar (${PILLARS.join(", ")})`);
    return { cmd: "pillar", pillar: p as Pillar, delta: r.int("a change like +2") };
  },
  coins: (r) => ({ cmd: "coins", delta: r.int("a change like +50") }),
  item: (r) => {
    const w = r.word("an item like +lantern_pinion");
    const m = /^([+-]?)([a-z][a-z0-9_]*)$/.exec(w);
    if (!m) fail(`{item}: expected +item_id or -item_id, got ${w}`);
    return { cmd: "item", item: m![2]!, delta: m![1] === "-" ? -1 : 1 };
  },
  scuffle: (r) => ({ cmd: "scuffle", id: r.id("a scuffle id") }),
  riddle: (r) => ({ cmd: "riddle", id: r.word("a riddle id like OQ-1") }),
  puzzle: (r) => ({ cmd: "puzzle", id: r.word("a puzzle id like PZ-03") }),
  project: (r) => ({ cmd: "project", id: r.id("a project id") }),
  ai_open: (r) => {
    const resident = r.id("a resident id");
    const topic = r.named("topic", "string", true) as string;
    const turns = r.named("turns", "number", true) as number;
    if (turns < 1) fail(`{ai_open}: turns must be 1 or more`);
    return { cmd: "ai_open", resident, topic, turns };
  },
  ai_line: (r) => {
    const slot = r.id("a slot id");
    const sp = r.named("speaker", "word", true) as string;
    const m = /^(auto:)?([a-z][a-z0-9_]*)$/.exec(sp);
    if (!m) fail(`{ai_line}: speaker must be an id or auto:<default id>, got ${sp}`);
    const brief = r.named("brief", "string", true) as string;
    return { cmd: "ai_line", slot, speaker: { id: m![2]!, auto: Boolean(m![1]) }, brief };
  },
  fallback: (r) => ({ cmd: "fallback", text: r.str("the Quiet Mode line") }),
  memory: (r) => {
    const resident = r.id("a resident id");
    const text = r.str("the memory text");
    const importance = r.named("importance", "number", true) as number;
    if (importance < 1 || importance > 10) fail(`{memory}: importance must be 1–10, got ${importance}`);
    return { cmd: "memory", resident, text, importance };
  },
  wait: (r) => { const s = r.optionalInt(); return s === undefined ? { cmd: "wait" } : { cmd: "wait", seconds: s }; },
  fade: () => ({ cmd: "fade" }),
  sfx: (r) => ({ cmd: "sfx", id: r.id("a sound id") }),
  cam: (r) => ({ cmd: "cam", effect: r.id("a camera effect") }),
  goto: (r) => ({ cmd: "goto", label: r.id("a label") }),
  goto_scene: (r) => ({ cmd: "goto_scene", scene: r.id("a scene id") }),
  insert: (r) => ({ cmd: "insert", id: r.id("an insert id") }),
  backdrop: (r) => ({ cmd: "backdrop", id: r.id("a backdrop id") }),
  charcreate: () => ({ cmd: "charcreate" }),
  checkpoint: (r) => ({ cmd: "checkpoint", key: r.id("a checkpoint key") }),
  load_checkpoint: (r) => ({ cmd: "load_checkpoint", key: r.id("a checkpoint key") }),
  campaign: (r) => ({ cmd: "campaign", key: r.id("a campaign event key") }),
  debate_score: (r) => ({ cmd: "debate_score", delta: r.int("a change like +2") }),
  pick_planks: (r) => {
    const n = r.int("a count");
    if (n < 1 || n > 6) fail(`{pick_planks}: count must be 1–6 (there are six planks), got ${n}`);
    return { cmd: "pick_planks", count: n };
  },
  tally: (r) => {
    const d = r.id("a district");
    if (!(TALLY_DISTRICTS as readonly string[]).includes(d)) fail(`{tally}: '${d}' is not a district (${TALLY_DISTRICTS.join(", ")})`);
    return { cmd: "tally", district: d as TallyDistrict };
  },
};

export const COMMAND_NAMES = Object.keys(BUILDERS) as CommandName[];

/** Parse the inside of `{…}` (without the braces). Returns the typed command or an error message. */
export function parseCommand(inner: string): { command: Command } | { error: string } {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:(:)([\s\S]*))?$/.exec(inner);
  if (!m) return { error: `can't read cue {${inner}}` };
  const name = m[1]!;
  const builder = (BUILDERS as Record<string, Builder | undefined>)[name];
  if (!builder) {
    const near = closest(name, COMMAND_NAMES);
    return { error: `unknown cue {${name}}${near ? ` (did you mean {${near}}?)` : ""}` };
  }
  if (m[2] && m[3]!.trim() === "") return { error: `{${name}:} has a colon but no arguments` };
  try {
    const r = new Reader(name, parseArgs(m[3] ?? ""));
    const command = builder(r);
    r.done();
    return { command };
  } catch (e) {
    const msg = (e as Error).message;
    return { error: e instanceof ArgError ? msg : `{${name}}: ${msg}` };
  }
}

/** Levenshtein-nearest candidate within distance 2 (or a third of the length), for "did you mean". */
export function closest(word: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined, bestD = Infinity;
  for (const c of candidates) {
    const d = levenshtein(word, c);
    if (d < bestD) { best = c; bestD = d; }
  }
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : undefined;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}
