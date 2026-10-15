/**
 * Content linter (GDD §20.4): persona cards, place registry, declared flags, and the Quiet Mode line library
 * (Appendix B) with its authored replies.
 * Run: npm run lint:content   (CI runs it too). Exit 1 on any error.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { PersonaCard, STANDARD_EXPRESSIONS, evaluate, fillReply, type PersonaCard as Card } from "@monde/shared";
import { parseLineLibrary, type LineLibrary } from "../client/src/mind/quietMode.ts";
import { lexicalHits } from "../server/src/mind/filters.ts";

const root = path.resolve(import.meta.dirname, "..");
const errors: string[] = [];
const warnings: string[] = [];
const err = (m: string) => errors.push(m);
const warn = (m: string) => warnings.push(m);

// ---- places
const placesDoc = YAML.parse(fs.readFileSync(path.join(root, "content/places/places.yaml"), "utf8")) as Record<string, string[]>;
const places = new Set<string>();
for (const [zone, ids] of Object.entries(placesDoc)) for (const id of ids) {
  const full = `${zone}.${id}`;
  if (places.has(full)) err(`places: duplicate ${full}`);
  places.add(full);
}
const placeOk = (p: string) => places.has(p) || /^[a-z_]+\.home_\d{2,3}$/.test(p);

// ---- flags
const flagsDoc = YAML.parse(fs.readFileSync(path.join(root, "content/flags.yaml"), "utf8")) as { flags: string[] };
const declared = new Set(flagsDoc.flags);
const FLAG_PATTERNS = [/^met_[a-z0-9_]+$/, /^project_[a-z0-9_]+_done$/, /^romance_\d_bloomed$/, /^s\d{2}[a-z]?_done$/, /^ending_e\d(_seen)?$/];
const flagOk = (f: string) => declared.has(f) || FLAG_PATTERNS.some((r) => r.test(f));

/** Collect the flag names an expression reads, and check that it parses. */
function flagsIn(expr: string, where: string): string[] {
  const seen: string[] = [];
  try {
    evaluate(expr, { resolve: (p) => { if (p[0] === "flag" && p[1]) seen.push(p[1]); return undefined; } });
    // Evaluation short-circuits, so also scan textually for flag.<name>.
    for (const m of expr.matchAll(/flag\.([a-z0-9_]+)/g)) seen.push(m[1]!);
  } catch (e) {
    err(`${where}: expression does not parse: ${expr} (${(e as Error).message})`);
  }
  return [...new Set(seen)];
}

// ---- residents
const dir = path.join(root, "content/residents");
const cards = new Map<string, Card>();
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
  const where = `residents/${file}`;
  const parsed = PersonaCard.safeParse(YAML.parse(fs.readFileSync(path.join(dir, file), "utf8")));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) err(`${where}: ${issue.path.join(".")}: ${issue.message}`);
    continue;
  }
  const c = parsed.data;
  if (`${c.id}.yaml` !== file) err(`${where}: id '${c.id}' does not match file name`);
  cards.set(c.id, c);

  for (const [label, p] of [["workplace", c.workplace], ["home", c.home]] as const)
    if (!placeOk(p)) err(`${where}: ${label} '${p}' is not in the place registry`);
  for (const [day, blocks] of Object.entries(c.routine))
    for (const b of blocks) if (!placeOk(b.where)) err(`${where}: routine.${day} ${b.at} place '${b.where}' unknown`);

  if (c.kind !== "animal")
    for (const e of STANDARD_EXPRESSIONS)
      if (!c.portrait_expressions.includes(e)) err(`${where}: portrait_expressions missing standard '${e}'`);

  for (const lock of c.canon_locks)
    for (const f of flagsIn(lock.while, `${where} canon_lock`)) if (!flagOk(f)) err(`${where}: canon_lock uses undeclared flag '${f}'`);
  for (const s of c.secrets)
    if (s.reveal.flag) for (const f of s.reveal.flag.split(/\s*&&\s*/)) if (!flagOk(f.replace(/^flag\./, ""))) err(`${where}: secret reveal uses undeclared flag '${f}'`);
}

// ---- reciprocal relationships between carded residents (GDD §12.2 rule)
for (const c of cards.values())
  for (const r of c.relationships) {
    const other = cards.get(r.id);
    if (other && !other.relationships.some((x) => x.id === c.id)) err(`relationship ${c.id} → ${r.id} is not reciprocated`);
  }

// ---- Quiet Mode lines (Appendix B) and their replies: the client's own parser (it throws on a bad entry), then
// the server's lexical filters over every line and reply (nothing modern, no brands, no banned style).
let library: LineLibrary | null = null;
try {
  library = parseLineLibrary(YAML.parse(fs.readFileSync(path.join(root, "content/lines/lines.yaml"), "utf8")));
} catch (e) {
  err((e as Error).message);
}
let replyCount = 0;
for (const line of library?.lines ?? []) {
  const fill = (text: string) => fillReply(text, { name: "Odile", player: "Wren" }).replace(/\{[a-z_]+(?::[a-z0-9_]+)?\}/g, "Odile");
  for (const hit of lexicalHits(fill(line.text))) warn(`lines.yaml ${line.id}: ${hit.group} "${hit.term}"`);
  for (const reply of line.replies ?? []) {
    replyCount++;
    for (const hit of lexicalHits(fill(reply.text))) err(`lines.yaml ${line.id} reply "${reply.text}": ${hit.group} "${hit.term}"`);
  }
  if (line.kind === "bye" && line.replies) warn(`lines.yaml ${line.id}: a goodbye ends the conversation; its replies are never shown`);
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
console.log(`content: ${cards.size} cards, ${places.size} places, ${declared.size} declared flags, `
  + `${library?.lines.length ?? 0} lines with ${replyCount} replies · ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
