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
  ItemCatalog, COMMUNITY_TASKS, HOMED, HOMES_BY_ZONE, PORTRAIT_SET, PersonaCard, STANDARD_EXPRESSIONS, bandOf, cardLookProblems, cardProblems,
  compileScenes, evaluate, fillReply, isVacantHome, parseHomes, parsePins, portraitById, registryFromContent, type Day1Skeleton, type HomeRegistry,
  type PersonaCard as Card
} from "@monde/shared";
import { firstName, parseLineLibrary, type LineLibrary } from "../client/src/mind/quietMode.ts";
import {
  SPRING_SCENE_ID, aiOpenCues, exchangePaths, fillScripted, parseScriptedLibrary, scriptedKey, type ScriptedLibrary
} from "../client/src/mind/scripted.ts";
import { lexicalHits } from "../server/src/mind/filters.ts";
import { fillLine, parseProjects, type ProjectsContent } from "../client/src/projects/schema.ts";
import { puzzles as PUZZLES } from "../client/src/puzzles/catalog.ts";

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

// ---- the Day-1 census's generated cards (content/residents/day1/, MVP M-03; tools/gen-residents.ts). The game loads
// them after the hand-written cards when they are there (tools/compile-residents.ts, server/src/content/loadContent.ts).
// Here: each card on its own (the schema, places, look, A.3.7's static checks, the lexical filters), then against the
// skeleton (content/census/day1.yaml).
const day1Dir = path.join(dir, "day1");
const day1 = new Map<string, Card>();
const censusPins = parsePins(YAML.parse(fs.readFileSync(path.join(root, "content/census/pins.yaml"), "utf8")));
const skeleton = YAML.parse(fs.readFileSync(path.join(root, "content/census/day1.yaml"), "utf8")) as Day1Skeleton;
const householdOf = new Map(skeleton.households.flatMap(h => h.members.filter(m => m.id).map(m => [m.id!, h] as const)));
for (const file of fs.existsSync(day1Dir) ? fs.readdirSync(day1Dir).filter((f) => f.endsWith(".yaml")).sort() : []) {
  const where = `residents/day1/${file}`;
  const parsed = PersonaCard.safeParse(YAML.parse(fs.readFileSync(path.join(day1Dir, file), "utf8")));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) err(`${where}: ${issue.path.join(".")}: ${issue.message}`);
    continue;
  }
  const c = parsed.data;
  if (`${c.id}.yaml` !== file) err(`${where}: id '${c.id}' does not match file name`);
  if (cards.has(c.id)) err(`${where}: id '${c.id}' is a hand-written card's too`);
  day1.set(c.id, c);
  if (c.kind !== "resident") err(`${where}: kind is ${c.kind}; a Day-1 card is a resident`);
  if (!c.generated_by || !c.household || !c.archetype || !c.employment || c.years_in_monde === undefined) err(`${where}: missing the census fields (generated_by, household, archetype, employment, years_in_monde)`);
  for (const [label, p] of [["workplace", c.workplace], ["home", c.home]] as const)
    if (!placeOk(p)) err(`${where}: ${label} '${p}' is not in the place registry`);
  for (const [day, blocks] of Object.entries(c.routine))
    for (const b of blocks) if (!placeOk(b.where)) err(`${where}: routine.${day} ${b.at} place '${b.where}' unknown`);
  for (const problem of cardLookProblems(c)) err(`${where}: ${problem}`);
  if (!c.look) err(`${where}: no look`);
  for (const e of PORTRAIT_SET) if (!c.portrait_expressions.includes(e)) err(`${where}: portrait_expressions missing '${e}'`);
  const mates = new Set(householdOf.get(c.id)?.members.map(m => m.id).filter((x): x is string => !!x) ?? []);
  for (const problem of cardProblems(c, { canonName: c.id in censusPins.people, household: mates })) err(`${where}: ${problem}`);
  if (c.voice.mode !== "narrated_action") {
    const texts = [c.name, c.occupation, c.appearance, c.backstory, ...c.beliefs, c.voice.register, ...c.voice.tics, ...c.voice.samples, ...c.likes, ...c.dislikes,
      ...c.fears, c.dream.text, ...c.chores, ...c.relationships.map(r => r.note), ...c.secrets.map(x => x.text)];
    for (const hit of new Set(texts.flatMap(t => lexicalHits(t).map(h => `${h.group} "${h.term}"`)))) err(`${where}: V16 ${hit}`);
  }
}
// Against the skeleton: every written member's card, at the household's home, in the member's band, archetype and
// portrait (the library id, or their own id for a procedural look, wearing it).
const libraryWorn = new Map<string, string>();
/** Key order aside (the schema's parse reorders), the same JSON. */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
let toWrite = 0, writtenMembers = 0;
for (const h of skeleton.households) for (const m of h.members) {
  if (m.kind !== "named" && m.kind !== "anonymous") continue;
  toWrite++;
  const c = m.id ? day1.get(m.id) : undefined;
  const at = `census ${h.id}/${m.slot}`;
  if (!c) { if (h.status === "drafted" || h.status === "curated") err(`${at}: ${h.status}, but content/residents/day1/ has no card ${m.id ?? "(no id)"}`); continue; }
  writtenMembers++;
  if (h.status !== "drafted" && h.status !== "curated") warn(`${at}: ${c.id} has a card, but the household is still ${h.status}`);
  if (c.household !== h.id) err(`${at}: ${c.id}'s card says household ${c.household}`);
  if (c.home !== h.home) err(`${at}: ${c.id}'s card says home ${c.home}; the census says ${h.home}`);
  if (bandOf(c.age) !== m.band) err(`${at}: ${c.id} is ${c.age} (${bandOf(c.age)}); the census says ${m.band}`);
  if (c.archetype !== m.archetype) err(`${at}: ${c.id}'s card says archetype ${c.archetype}; the census says ${m.archetype}`);
  if (m.kind === "named" && c.name !== m.name) err(`${at}: ${c.id} is canon as ${m.name}, the card says ${c.name}`);
  const p = m.portrait;
  if (p.source === "library") {
    if (c.portrait !== p.id) err(`${at}: ${c.id} wears portrait ${c.portrait}; the census gave ${p.id}`);
    else if (canonical(c.look) !== canonical(portraitById(p.id)?.look)) err(`${at}: ${c.id}'s look isn't its library bust's (${p.id})`);
    const other = libraryWorn.get(p.id);
    if (other) err(`${at}: ${c.id} and ${other} both wear ${p.id}`);
    libraryWorn.set(p.id, c.id);
  } else if (p.source === "procedural") {
    if (c.portrait !== c.id) err(`${at}: ${c.id} has a procedural look, so its portrait is its own id, not ${c.portrait}`);
    if (canonical(c.look) !== canonical(p.look)) err(`${at}: ${c.id}'s look isn't the census's procedural look`);
  }
}
for (const c of day1.values()) if (!householdOf.has(c.id)) err(`residents/day1/${c.id}.yaml: no census member has id ${c.id} (household ${c.household})`);
for (const c of cards.values()) if (libraryWorn.has(c.portrait)) err(`portrait ${c.portrait}: worn by ${c.id} and ${libraryWorn.get(c.portrait)}`);
// A.1: once every card is written, the town is 210 homed residents (the hand-written with a home here, and the 188).
if (toWrite && writtenMembers === toWrite) {
  const homed = [...cards.values(), ...day1.values()].filter(c => c.kind !== "animal" && !c.home.startsWith("offmap."));
  if (homed.length !== HOMED) err(`census: ${homed.length} homed residents with cards; A.1 says ${HOMED}`);
}
// Ties a Day-1 card makes must name someone: a card, or a named person still to write (a warning until they are).
for (const c of day1.values()) for (const r of c.relationships) {
  if (cards.has(r.id) || day1.has(r.id)) continue;
  if (r.id in censusPins.people) warn(`residents/day1/${c.id}.yaml: tie to ${r.id}, whose card isn't written yet`);
  else err(`residents/day1/${c.id}.yaml: tie to ${r.id}, who has no card`);
}

// ---- reciprocal relationships (GDD §12.2 rule): among the hand-written cards, and from a hand-written card to a
// generated one (the census's mirrors). A generated card's ties to others needn't be returned.
for (const c of cards.values())
  for (const r of c.relationships) {
    const other = cards.get(r.id) ?? day1.get(r.id);
    if (other && !other.relationships.some((x) => x.id === c.id)) err(`relationship ${c.id} → ${r.id} is not reciprocated`);
  }

// ---- homes (content/places/homes.yaml, A.1.3): every home registered and every registered home listed, A.1.3's
// counts by zone, hosts the boards have (a building that holds it, a lane cell, or off-board where there's no board), and
// every card's home among them.
let homes: HomeRegistry = new Map();
try {
  homes = parseHomes(YAML.parse(fs.readFileSync(path.join(root, "content/places/homes.yaml"), "utf8")));
} catch (e) {
  err(`homes.yaml: ${(e as Error).message}`);
}
const HOME_ID = /\.(home_[a-z0-9_]+|vacant_house_\d+)$/;
for (const id of homes.keys()) if (!places.has(id)) err(`homes.yaml: ${id} is not in places.yaml`);
for (const id of places) if (HOME_ID.test(id) && !homes.has(id)) err(`places.yaml: ${id} looks like a home but homes.yaml has no entry for it`);
for (const [zone, want] of Object.entries(HOMES_BY_ZONE)) {
  const ids = [...homes.keys()].filter(id => id.startsWith(`${zone}.`));
  const vacant = ids.filter(isVacantHome).length;
  if (ids.length !== want.total || vacant !== want.vacant) err(`homes.yaml: ${zone} has ${ids.length} homes (${vacant} vacant); A.1.3 says ${want.total} (${want.vacant} vacant)`);
}
const boards = new Map<string, { buildings: { id?: string; home?: string | string[] }[] }>();
for (const f of fs.readdirSync(path.join(root, "content/zones")).filter((f) => f.endsWith(".zone.yaml"))) {
  const z = YAML.parse(fs.readFileSync(path.join(root, "content/zones", f), "utf8")) as { id: string; buildings?: { id?: string; home?: string | string[] }[] };
  boards.set(z.id, { buildings: z.buildings ?? [] });
}
for (const [zone, board] of boards) for (const b of board.buildings) {
  const held = [...(b.home === undefined ? [] : Array.isArray(b.home) ? b.home : [b.home]), ...(b.id && /^vacant_house_\d+$/.test(b.id) ? [b.id] : [])];
  for (const h of held) if (h !== "vacant" && !homes.has(`${zone}.${h}`)) err(`zones/${zone}: building ${b.id ?? b.home} holds home ${h}, which homes.yaml doesn't list`);
}
for (const [id, home] of homes) {
  const zone = id.slice(0, id.indexOf(".")), board = boards.get(zone);
  if (home.host === "offboard") { if (board) err(`homes.yaml: ${id} is offboard, but ${zone} has a board`); continue; }
  if (!board) { err(`homes.yaml: ${id} names a host on ${zone}, which has no board`); continue; }
  if ("building" in home.host) {
    const name = home.host.building;
    const b = board.buildings.find(x => x.id === name || (Array.isArray(x.home) ? x.home.includes(name) : x.home === name));
    if (!b) err(`homes.yaml: ${id} is in building ${name}, which zones/${zone} doesn't have`);
  }
}
for (const c of [...cards.values(), ...day1.values()]) {
  if (c.kind === "animal" || c.home.startsWith("offmap.")) continue;
  if (!homes.has(c.home)) err(`residents/${day1.has(c.id) ? "day1/" : ""}${c.id}.yaml: home ${c.home} isn't in homes.yaml`);
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

// ---- Projects (content/projects.yaml, GDD §6.3, MVP G-03): the client's own parser (it throws naming the Project and
// field), then every id it names against the rest of content/: items, places, residents, puzzles, flags and scenes;
// the authored lines through the server's lexical filters and each speaker's `never_says`; memories within §9.6's
// 200 characters. Every {project: id} cue in a scene names a Project (or is a later Act's, listed as a warning).
let projectsContent: ProjectsContent | null = null;
try {
  projectsContent = parseProjects(YAML.parse(read("content/projects.yaml")));
} catch (e) {
  err((e as Error).message);
}
const itemIds = new Set((itemResult.success ? itemResult.data : []).map(i => i.id));
const sceneIds = new Set(compiled.scenes.map(sc => sc.id));
const sceneText = new Map(compiled.scenes.map(sc => [sc.id, JSON.stringify(sc)]));
let projectLines = 0;
if (projectsContent) {
  const known = new Set(projectsContent.projects.map(p => p.id));
  const resident = (id: string, where: string) => { if (!cards.has(id)) err(`projects.yaml ${where}: no persona card for '${id}'`); };
  const words = (where: string, text: string, speaker?: string) => {
    projectLines++;
    const filled = fillLine(text, { place: "Fountain Square", project: "the fountain", house: "No. 39", lead: "Kasimir", coins: 20, cost: 150, fund: 120, short: 30 });
    if (/\{[a-z_]+\}/.test(filled)) err(`projects.yaml ${where}: unknown placeholder in "${text}"`);
    for (const hit of lexicalHits(filled)) err(`projects.yaml ${where} "${text}": ${hit.group} "${hit.term}"`);
    for (const banned of (speaker ? cards.get(speaker)?.voice.never_says : undefined) ?? [])
      if (filled.toLowerCase().includes(banned.toLowerCase())) err(`projects.yaml ${where}: ${speaker} never says "${banned}"`);
  };
  for (const item of Object.keys(projectsContent.shopStock)) if (!itemIds.has(item)) err(`projects.yaml shop_stock: unknown item '${item}'`);
  for (const [key, lines] of Object.entries({ yes: projectsContent.asks.yes, no: projectsContent.asks.no, donate_yes: projectsContent.asks.donateYes, donate_no: projectsContent.asks.donateNo }))
    for (const [who, text] of Object.entries(lines)) { if (who !== "default") resident(who, `asks.${key}`); words(`asks.${key}.${who}`, text, who === "default" ? undefined : who); }
  for (const [key, text] of Object.entries(projectsContent.pell)) words(`pell.${key}`, text, "pell");
  words("asks.busy", projectsContent.asks.busy); words("asks.donated", projectsContent.asks.donated);
  for (const p of projectsContent.projects) {
    const at = (field: string) => `${p.id} ${field}`;
    for (const m of p.materials) if (!itemIds.has(m.item)) err(`projects.yaml ${at("materials")}: unknown item '${m.item}'`);
    for (const place of [p.site.place, p.site.work.place]) if (place !== "house" && !places.has(place)) err(`projects.yaml ${at("site")}: '${place}' is not in the place registry`);
    if (p.site.place !== "house" && p.site.place.split(".")[0] !== p.zone) err(`projects.yaml ${at("zone")}: the site is in ${p.site.place.split(".")[0]}, not ${p.zone}`);
    for (const id of p.leads) resident(id, at("leads"));
    for (const d of p.donors) { resident(d.resident, at("donors")); words(at(`donors ${d.resident}`), d.line, d.resident); }
    for (const st of p.standing) { resident(st.resident, at("standing")); if (!sceneIds.has(st.scene)) err(`projects.yaml ${at("standing")}: no scene '${st.scene}'`); }
    if (p.puzzle && !PUZZLES[p.puzzle]) err(`projects.yaml ${at("puzzle")}: ${p.puzzle} isn't one of the built puzzles (client/src/puzzles)`);
    if (p.bonusPuzzle && !PUZZLES[p.bonusPuzzle]) warn(`projects.yaml ${at("bonus_puzzle")}: ${p.bonusPuzzle} isn't built (outside the MVP's puzzles)`);
    for (const f of [...(p.opens.flag ? [p.opens.flag] : []), ...p.complete.flags]) if (!flagOk(f)) err(`projects.yaml ${at("flags")}: undeclared flag '${f}'`);
    if (p.opens.cue) {
      if (!sceneIds.has(p.opens.cue)) err(`projects.yaml ${at("opens.cue")}: no scene '${p.opens.cue}'`);
      else if (!sceneText.get(p.opens.cue)!.includes(`"cmd":"project","id":"${p.id}"`)) err(`projects.yaml ${at("opens.cue")}: ${p.opens.cue} has no {project: ${p.id}} cue`);
    }
    if (p.ceremony.scene && !sceneIds.has(p.ceremony.scene)) err(`projects.yaml ${at("ceremony.scene")}: no scene '${p.ceremony.scene}'`);
    if (!p.ceremony.scene && !p.complete.flags.length && !p.complete.homes) err(`projects.yaml ${at("complete")}: an opening needs a flag (the board's art) or a home`);
    words(at("ceremony.summary"), p.ceremony.summary);
    if (fillLine(p.ceremony.summary, { house: "No. 39" }).length > 200) err(`projects.yaml ${at("ceremony.summary")}: over 200 characters (a town event's summary)`);
    p.ceremony.lines.forEach((l, i) => { if (l.speaker !== "narrator") resident(l.speaker, at(`ceremony.lines[${i}]`)); if (l.expr && !STANDARD_EXPRESSIONS.includes(l.expr as never)) err(`projects.yaml ${at(`ceremony.lines[${i}]`)}: unknown expression '${l.expr}'`); words(at(`ceremony.lines[${i}]`), l.text, l.speaker === "narrator" ? undefined : l.speaker); });
    for (const m of p.ceremony.memories) {
      resident(m.resident, at("ceremony.memories"));
      if (fillLine(m.text, { house: "No. 39" }).length > 200) err(`projects.yaml ${at(`memory ${m.resident}`)}: over §9.6's 200 characters`);
      if (m.importance > 10) err(`projects.yaml ${at(`memory ${m.resident}`)}: importance is 1-10`);
      words(at(`memory ${m.resident}`), m.text);
    }
    if (p.signoff.line) words(at("signoff.line"), p.signoff.line, "pell");
  }
  for (const [id, text] of sceneText) for (const m of text.matchAll(/"cmd":"project","id":"([a-z0-9_]+)"/g)) {
    if (known.has(m[1]!)) continue;
    if (SPRING_SCENE_ID.test(id)) err(`${id}: {project: ${m[1]}} names no Project in content/projects.yaml`);
    else warn(`${id}: {project: ${m[1]}} is a later Act's Project, not in content/projects.yaml yet`);
  }
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
const looks = [...cards.values()].filter((c) => c.look).length;
console.log(`content: ${cards.size} cards (${looks} with a look), ${day1.size} of the census's ${toWrite} Day-1 cards written, ${places.size} places, ${homes.size} homes, ${declared.size} declared flags, `
  + `${library?.lines.length ?? 0} lines with ${replyCount} replies, `
  + `${scripted?.exchanges.length ?? 0} scripted exchanges (${scriptedTurns} nodes, ${scriptedPaths} paths; ${laterCues} later {ai_open} cues still to write), `
  + `${projectsContent?.projects.length ?? 0} Projects (${projectLines} lines) `
  + `· ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
