import { SPRING_RIDDLES, normalizeRiddleAnswer } from '@monde/shared';
/**
 * Content linter (GDD §20.4): persona cards (with their `look`), place registry, declared flags, the Quiet Mode line library
 * (Appendix B) with its authored replies, and the scripted {ai_open} exchanges (content/lines/scripted.yaml).
 * Run: npm run lint:content   (CI runs it too). Exit 1 on any error.
 */
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  ItemCatalog, COMMUNITY_TASKS, PersonaCard, STANDARD_EXPRESSIONS, cardLookProblems, compileScenes, evaluate, fillReply, registryFromContent,
  type PersonaCard as Card
} from "@monde/shared";
import { firstName, parseLineLibrary, type LineLibrary } from "../client/src/mind/quietMode.ts";
import {
  SPRING_SCENE_ID, aiOpenCues, exchangePaths, fillScripted, parseScriptedLibrary, scriptedKey, type ScriptedLibrary
} from "../client/src/mind/scripted.ts";
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

// ---- items and work destinations
const itemResult = ItemCatalog.safeParse(YAML.parse(fs.readFileSync(path.join(root, 'content/items.yaml'), 'utf8')));
if (!itemResult.success) for (const issue of itemResult.error.issues) err(`items: ${issue.path.join('.')}: ${issue.message}`);
for (const task of COMMUNITY_TASKS) if (!places.has(task.place)) err(`work ${task.id}: unknown place ${task.place}`);

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

// ---- authored Spring riddles (Tib's explicit null ladders are documented GDD gaps)
const riddleIds = new Set(SPRING_RIDDLES.map(r => r.id));
if (riddleIds.size !== SPRING_RIDDLES.length) err('riddles: duplicate ids');
for (const r of SPRING_RIDDLES) {
  if (!r.accepted.length || r.accepted.some(a => !normalizeRiddleAnswer(a))) err(`${r.id}: empty normalized answer`);
  if (r.hints.length !== 3 || r.hints.some(h => !h) && !r.gaps.some(g => g.includes('no hint ladder'))) err(`${r.id}: incomplete hint ladder`);
  if (r.previous && !riddleIds.has(r.previous)) err(`${r.id}: unknown preceding Mark`);
  for (const f of [...r.prerequisites, ...r.rewards.flags]) if (!declared.has(f) && f !== 'project_lighthouse_done') err(`${r.id}: unknown flag ${f}`);
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

  // The look the sprite and the dialogue bust draw: its shape (palette ranges included) is the schema's; here, the
  // cross-checks (an animal wears a cat look, a person a human one; worn glasses ⇔ the glasses accessory).
  if (!c.look) warn(`${where}: no look; the sprite and the bust fall back to a look varied by the id hash`);
  for (const problem of cardLookProblems(c)) err(`${where}: ${problem}`);

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

// ---- Scripted {ai_open} exchanges (content/lines/scripted.yaml): the client's own parser (it checks the schema and
// the graph, and throws naming the exchange and node), the server's lexical filters over every line, reply and
// farewell, each resident's `never_says`, and the scene files: every Spring (S01–S10) {ai_open} cue needs an
// exchange with its turn count, and an exchange must name a cue that exists.
let scripted: ScriptedLibrary | null = null;
try {
  scripted = parseScriptedLibrary(YAML.parse(fs.readFileSync(path.join(root, "content/lines/scripted.yaml"), "utf8")));
} catch (e) {
  err((e as Error).message);
}
const scenesDir = path.join(root, "content/scenes");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const sceneFiles = fs.readdirSync(scenesDir).filter((f) => f.endsWith(".scene.md")).sort();
const compiled = compileScenes(
  sceneFiles.map((f) => ({ file: `content/scenes/${f}`, source: read(`content/scenes/${f}`) })),
  registryFromContent({
    flagsYaml: read("content/flags.yaml"),
    residentYamls: fs.readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort().map((f) => read(`content/residents/${f}`)),
    placesYaml: read("content/places/places.yaml")
  })
);
const cues = aiOpenCues(compiled.scenes);
let scriptedTurns = 0, scriptedPaths = 0, laterCues = 0;
if (scripted) {
  const seenCue = new Set<string>();
  for (const cue of cues) {
    const key = scriptedKey(cue.scene, cue.resident);
    const spring = SPRING_SCENE_ID.test(cue.scene);
    if (seenCue.has(key)) { err(`scripted.yaml: ${cue.scene} has two {ai_open} cues to ${cue.resident}; exchanges are keyed by scene and resident`); continue; }
    seenCue.add(key);
    const ex = scripted.find(cue.scene, cue.resident);
    if (!ex) {
      if (spring) err(`scripted.yaml: no exchange for the {ai_open: ${cue.resident}} cue in ${cue.scene} (Quiet Mode would fall back to small talk)`);
      else laterCues++;
    } else if (ex.turns !== cue.turns) err(`scripted.yaml ${key}: turns is ${ex.turns} but the cue says turns: ${cue.turns}`);
  }
  for (const ex of scripted.exchanges) {
    if (!seenCue.has(ex.key)) err(`scripted.yaml ${ex.key}: no {ai_open: ${ex.resident}} cue in ${ex.scene} (stale, or a typo in the scene or resident id)`);
    const card = cards.get(ex.resident);
    if (!card && ex.resident !== "arrival") err(`scripted.yaml ${ex.key}: ${ex.resident} has no persona card`);
    scriptedPaths += exchangePaths(ex).length;
    const vars = { name: card ? firstName(card.name) : "Robin", player: "Wren" };
    // `speaks`: the resident's own words (lines, reacts, farewell), which also must keep to their `never_says`.
    const check = (where: string, text: string, speaks: boolean) => {
      const filled = fillScripted(text, vars);
      for (const hit of lexicalHits(filled)) err(`scripted.yaml ${ex.key} ${where} "${text}": ${hit.group} "${hit.term}"`);
      if (speaks)
        for (const banned of card?.voice.never_says ?? [])
          if (filled.toLowerCase().includes(banned.toLowerCase())) err(`scripted.yaml ${ex.key} ${where}: ${ex.resident} never says "${banned}"`);
    };
    ex.farewell.forEach((l, i) => check(`farewell line ${i + 1}`, l.text, true));
    for (const node of Object.values(ex.nodes)) {
      scriptedTurns++;
      node.lines.forEach((l, i) => check(`node ${node.id} line ${i + 1}`, l.text, true));
      node.replies.forEach((r, i) => {
        check(`node ${node.id} reply ${i + 1}`, r.text, false);
        if (r.react) check(`node ${node.id} reply ${i + 1} react`, r.react.text, true);
      });
      const tones = new Set(node.replies.map((r) => r.intent));
      if (node.replies.length >= 2 && tones.size < 2) warn(`scripted.yaml ${ex.key} node ${node.id}: every reply has the same tone (${[...tones][0]})`);
    }
  }
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
const looks = [...cards.values()].filter((c) => c.look).length;
console.log(`content: ${cards.size} cards (${looks} with a look), ${places.size} places, ${declared.size} declared flags, `
  + `${library?.lines.length ?? 0} lines with ${replyCount} replies, `
  + `${scripted?.exchanges.length ?? 0} scripted exchanges (${scriptedTurns} nodes, ${scriptedPaths} paths; ${laterCues} later {ai_open} cues still to write) `
  + `· ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
