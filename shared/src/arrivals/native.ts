// The Day-1 census's card prompt (MVP M-03 step 2; GDD Appendix A.1.5: "one Haiku call per household, using the same
// prompt as arrivals (A.3.6) with MODE: native"), its template fallback (A.3.8) and the static card checks the content
// linter runs over the written cards (A.3.7's subset that needs no household context). Pure: no I/O, no model calls.
// The server's census endpoint (server/src/mind/census.ts) builds the request; tools/gen-residents.ts drives the run.
import { z } from "zod";
import { COMMUTER_ROW, HOUSEHOLD_SHAPES, JOB_ROW_BY_NUMBER, TOLLMEN_ROW } from "../census/day1Tables";
import { ResidentId } from "../ids";
import type { PersonaCard } from "../persona";
import type { Archetype } from "./archetypes";
import {
  ARRIVAL_SYSTEM_PROMPT, CHORES, GRID, HOME_TOKEN, NATIVE_TIE_LIMIT, NEVER_SAYS, OUTSIDE_PLACES, RELATION_TAGS, ROUTINE_PLACES, TIE_RANGE, TRAITS, agelessCaption,
  archetypeLines, arrivalContract, arrivalMaxTokens, assignedWorkplace, hasEngineRoutine, isCommuter, memberArchetype, memberTags,
  pronounForms, tagLine, templateRoutine, townLines, type ArrivalHouseholdOutput, type ArrivalMember, type PromptTown, type RequiredLink,
  type ValidationContext,
} from "./card";
import type { HouseholdDraw, MemberDraw } from "./draw";
import { FIRST_NAMES, FAMOUS_NAMES, RESERVED_FIRST_NAMES, foldName } from "./names";
import { SeededRng } from "./rng";

/** Logged with every census call (ai_log.prompt_version) and stored on every household's generation record. */
export const NATIVE_PROMPT_VERSION = "census-v1";

/** A.1 and §2.4's Day 1: the first day of spring, a Tuesday (the ferry day the Fellow lands). */
export const DAY1_TOWN: PromptTown = {
  day: 1, season: "Spring", weekday: "Tuesday", pillars: { prosperity: 18, safety: 30, spirit: 22, charm: 25 },
  census: 210, shopsOpen: 6, pupils: 9, projectsDone: [], projectsActive: [],
};

/**
 * The second cached system block for natives (byte-stable: never edit it without bumping NATIVE_PROMPT_VERSION).
 * GDD-GAP: A.3.6 caches the system prompt alone. Natives have lived here for years, so every Day-1 card gets the same
 * public facts about the town (§2.1, §2.4, A.1, §12.4): what closed and when, the stopped clock, the ferry, the shops,
 * the Saturday round. No secrets: nothing about the loan, the option, Greyline or the Charter, and nobody's private story.
 */
export const MONDE_DAY1_BLOCK = `MONDE ON DAY 1
Everyone written in MODE: native has lived in Monde for years or was born here, and knows the town as it is today, the first day of spring, a Tuesday.

- 210 people live here, down from 4,800 at the 1971 peak. Sixty-one houses stand empty, most in Millbrook's brick terraces.
- Lissworth Mill closed 14 years ago and took 600 jobs; its frames are still inside. The Liss Cannery on the Wharf closed 11 years ago. Monde Station lost its stop 9 years ago and is derelict; the rails on Station Hill are in the grass.
- The clocktower in the Old Quarter stopped at 4:17 and has never gone again.
- The ferry Gannet, skippered by Old Moss Ferrante, crosses to Carrow, the mainland city, on Tuesdays and Fridays. A dozen residents work in Carrow or Hessle Cross from Tuesday to Friday and come home for the weekend.
- Six shops are open: the bakery Fournier & Fille (Odile Fournier), Dunmore's General Store, the Gull & Anchor (Roz Hale), Café Liss, the fish market (Nell Dunmore) and Kasimir Wolanski's carpentry workshop. Nine storefronts on Market Row are shuttered.
- Millbrook School has nine pupils in one room with Felix Amari, and closes at the end of the year unless the roll reaches twenty. Teenagers do lessons by post at the library desk.
- The clinic is shut and the nearest doctor is forty minutes away by ferry. Priya Ramaswamy, a nurse, makes house calls for nothing.
- Every Saturday a crew who call themselves the Tollmen go round the six open shops and collect a fee. People pay, look away and talk about it quietly; why the Tollmen do it, and for whom, nobody in town knows.
- Edwina Pell has been mayor for 26 years. The Lantern, a one-page paper set by hand, is on doorsteps by six.
- The Commons is overgrown: the bandstand has collapsed, the Glasshouse has broken panes, the garden plots are bindweed. The lighthouse on the breakwater has been dark for years.
- Money is coins, even in memories: never pennies, pence, shillings or pounds. People read, sew, fish, garden, listen to the wireless, write letters and talk on the doorstep.`;

/** The census request's two cached system blocks, in order: A.3.6's exact system prompt, then MONDE ON DAY 1. */
export const NATIVE_SYSTEM_BLOCKS: readonly string[] = [ARRIVAL_SYSTEM_PROMPT, MONDE_DAY1_BLOCK];

/** A.3.6: max_tokens = 900 + 750 × household size. */
export const nativeMaxTokens = (size: number): number => arrivalMaxTokens(size);

// ── Places (A.3.6 "places for routines", by zone) ───────────────────────────

/**
 * Each zone's places a resident's day can use, with a line each (§2.3, §9.5). ROUTINE_PLACES has the open boards' main
 * spots; these add every zone's own, Millbrook's and Station Hill's included. Homes, vacant houses, offices people
 * don't drop into (the mayor's office, the Field Office), locked buildings and Briar Woods are left out.
 */
export const ZONE_PLACE_LINES: Readonly<Record<string, readonly { id: string; line: string }[]>> = {
  old_quarter: [
    { id: "old_quarter.fountain_square", line: "the square with the dry heron fountain" },
    { id: "old_quarter.town_hall", line: "Town Hall" },
    { id: "old_quarter.clocktower", line: "the clocktower, stopped at 4:17" },
    { id: "old_quarter.library", line: "the free library, Margo's" },
    { id: "old_quarter.lantern_office", line: "the Lantern's print room" },
    { id: "old_quarter.st_brigids", line: "St Brigid's chapel" },
    { id: "old_quarter.constabulary", line: "the constabulary, Captain Reyes's" },
    { id: "old_quarter.lamplighter_lane", line: "Lamplighter Lane" },
  ],
  market_row: [
    { id: "market_row.market_street", line: "Market Row's street; the Saturday market" },
    { id: "market_row.market_hall", line: "the covered Market Hall" },
    { id: "market_row.bakery", line: "Fournier & Fille, the bakery" },
    { id: "market_row.general_store", line: "Dunmore's General Store" },
    { id: "market_row.gull_and_anchor", line: "the pub, The Gull & Anchor" },
    { id: "market_row.cafe_liss", line: "Café Liss" },
    { id: "market_row.back_alley", line: "the alley behind the shops" },
  ],
  wharf: [
    { id: "wharf.harbor_steps", line: "the harbour steps, where the boats tie up" },
    { id: "wharf.fish_market", line: "the fish market, Nell's" },
    { id: "wharf.boathouse", line: "the boathouse and its repair shed" },
    { id: "wharf.ferry_slip", line: "the ferry slip" },
    { id: "wharf.ticket_booth", line: "the ferry ticket booth" },
    { id: "wharf.breakwater", line: "the breakwater, with the dark lighthouse at the end" },
    { id: "wharf.cannery", line: "Liss Cannery, shuttered" },
    { id: "wharf.crane_yard", line: "the rusting crane yard" },
  ],
  commons: [
    { id: "commons.duck_pond", line: "the duck pond" },
    { id: "commons.footbridge", line: "the footbridge over the pond's stream" },
    { id: "commons.picnic_lawn", line: "the picnic lawn" },
    { id: "commons.sundial_lawn", line: "the sundial lawn" },
    { id: "commons.old_elm", line: "the Old Elm" },
    { id: "commons.bandstand", line: "the collapsed bandstand" },
    { id: "commons.community_garden", line: "the overgrown garden plots" },
    { id: "commons.glasshouse", line: "the Glasshouse, Teo's, with broken panes" },
  ],
  millbrook: [
    { id: "millbrook.terrace_row", line: "Terrace Row, the brick terraces" },
    { id: "millbrook.laundry_green", line: "the laundry green" },
    { id: "millbrook.weir", line: "the weir and the path along the Liss" },
    { id: "millbrook.school", line: "Millbrook School, one room" },
    { id: "millbrook.mill_yard", line: "the mill yard" },
    { id: "millbrook.mill", line: "Lissworth Mill, closed" },
    { id: "millbrook.clinic", line: "the shut clinic" },
    { id: "millbrook.kasimir_workshop", line: "Kasimir's carpentry workshop" },
  ],
  station_hill: [
    { id: "station_hill.lookout_bench", line: "the lookout bench over the bay" },
    { id: "station_hill.station", line: "Monde Station, derelict" },
    { id: "station_hill.platform", line: "the old platform" },
    { id: "station_hill.signal_box", line: "the signal box" },
    { id: "station_hill.water_tower", line: "the water tower" },
    { id: "station_hill.turntable", line: "the rusted turntable" },
  ],
};

/** The places a household's routines may use: its own zone's, the open boards' (ROUTINE_PLACES), their workplaces. */
export function routinePlacesFor(draw: HouseholdDraw): { id: string; line: string }[] {
  const n = draw.native!;
  const out = new Map<string, string>();
  for (const p of ZONE_PLACE_LINES[n.zone] ?? []) out.set(p.id, p.line);
  for (const p of ROUTINE_PLACES) if (!out.has(p.id)) out.set(p.id, p.line);
  for (const m of draw.members) {
    const wp = assignedWorkplace(m, n.home.id);
    if (wp && wp !== n.home.id && !out.has(wp)) out.set(wp, wp === "offmap.city" ? "the mainland: Carrow or Hessle Cross, a commuter's weekdays" : `where ${m.slot} works`);
  }
  return [...out].map(([id, line]) => ({ id, line }));
}

// ── The prompt (A.3.6 with MODE: native) ────────────────────────────────────

/** What the roster adds to a native prompt (the draw holds the household's own facts). */
export interface NativePromptContext {
  /** 6–10 people they might know: neighbours already written, colleagues, the cast in their zone, every required tie. */
  knownResidents: readonly { id: string; name: string; line: string }[];
  /** The ties the cards must make (native V14). */
  requiredLinks: readonly RequiredLink[];
  avoidFirst: readonly string[];
  avoidFull: readonly string[];
  /** A.3.8: a fresh whim on every call (whims.ts). */
  whim: string;
  validatorErrors?: readonly string[];
}

const Short = (n: number) => z.string().max(n);
/** The census endpoint's `context`: bounded lists of short strings, nothing that could carry a prompt of its own. */
export const NativePromptContextSchema = z.object({
  knownResidents: z.array(z.object({ id: ResidentId, name: Short(60), line: Short(160) }).strict()).max(16),
  requiredLinks: z.array(z.object({
    slot: z.string().regex(/^m\d$/), id: ResidentId, name: Short(60), tag: z.enum(RELATION_TAGS).nullable(), hint: Short(240),
  }).strict()).max(16),
  avoidFirst: z.array(Short(30)).max(300),
  avoidFull: z.array(Short(60)).max(300),
  whim: Short(80),
  validatorErrors: z.array(Short(400)).max(20).optional(),
}).strict();

/** Strip the design-doc references a pin's note carries ("(§12.4)", "(A.1.2's …)", "(tib.yaml)"). */
export const stripRefs = (text: string): string => text
  .replace(/\s*\([^()]*(?:§|\bA\.\d|\bD\d\b|\.yaml)[^()]*\)/g, "")
  .replace(/§\s?[\d.]+[a-z]?/g, "")
  .replace(/\s{2,}/g, " ")
  .trim();

const EMPLOYMENT_LINES: Readonly<Record<string, string>> = {
  retired: "retired",
  out_of_work: "out of work and looking (most who are have been since the mill or the cannery closed)",
  carer: "a full-time carer at home, unpaid",
  unable: "retired early, unable to work (mill lung or an old injury)",
  pupil: "a pupil at Millbrook School (millbrook.school), in Felix Amari's class",
  lessons: "a teenager: lessons by post at the library desk and Felix's Thursday-evening class",
  under_five: "under five, at home",
  employed: "employed",
};

/** A member's work as the prompt gives it: A.1.4's row and place, or their status. */
export function workLine(m: MemberDraw, home: string): string {
  const n = m.native!;
  if (n.job) {
    if (n.job.row === COMMUTER_ROW) return `${n.job.title}: a weekly commuter, away Tuesday to Friday (weekdays at offmap.city), home Saturday to Monday`;
    const row = JOB_ROW_BY_NUMBER.get(n.job.row);
    // Row 23's own description names who pays the Tollmen: never in a prompt.
    const what = row && n.job.row !== TOLLMEN_ROW ? ` (${row.workplace})` : "";
    return `${n.job.title}${what}, ${n.job.workplace === HOME_TOKEN ? `working from home (${home})` : `at ${n.job.workplace}`}`;
  }
  const line = EMPLOYMENT_LINES[n.employment] ?? n.employment;
  return n.saturday_job ? `${line}; a Saturday job at ${n.saturday_job}` : line;
}

const yearsLine = (m: MemberDraw): string => {
  const y = Math.min(m.native!.years_in_monde, m.age);
  return y >= m.age ? "born here" : `${y} ${y === 1 ? "year" : "years"} (came at ${m.age - y})`;
};

/** A.3.6's user message for a Day-1 household (MODE: native). */
export function nativeUserMessage(draw: HouseholdDraw, ctx: NativePromptContext): string {
  const n = draw.native!;
  const home = n.home.id;
  const archetypes = new Map<string, { a: Archetype; slots: string[] }>();
  for (const m of draw.members) {
    const a = memberArchetype(m, draw);
    const entry = archetypes.get(a.id) ?? { a, slots: [] };
    entry.slots.push(m.slot);
    archetypes.set(a.id, entry);
  }
  const mixed = archetypes.size > 1;
  const size = draw.members.length;
  const lines = [
    ...townLines(DAY1_TOWN, "native"),
    "",
    ...[...archetypes.values()].flatMap(({ a, slots }, k) => [...(k ? [""] : []), ...archetypeLines(a, mixed ? slots : undefined)]),
    "",
    `HOUSEHOLD (${size} ${size === 1 ? "person" : "people"}; ${HOUSEHOLD_SHAPES[n.type].label.toLowerCase()})`,
    ...draw.members.flatMap(m => {
      const t = memberTags(m);
      const nf = m.native!;
      const a = memberArchetype(m, draw);
      const portrait = m.look ? "portrait (painted from these tags)" : `portrait ${m.portrait}`;
      const name = nf.pinned
        ? `name: ${nf.pinned.name} (canon: write it exactly)`
        : `name: a first name from ${nf.first_names.join(", ")}; surname ${nf.surname} (use one, or invent if none fits)`;
      return [
        `- slot ${m.slot} · role ${m.role} · age ${m.age} · pronoun default ${m.pronoun_default}${mixed ? ` · archetype ${a.id}` : ""}`,
        // The census fixes the age; the bust's caption keeps its looks and drops its age words.
        `  ${portrait}: ${agelessCaption(t.caption)}`,
        `  tags: ${tagLine(t)}`,
        `  work: ${workLine(m, home)}`,
        `  in Monde: ${yearsLine(m)}`,
        `  ${name}`,
        ...(hasEngineRoutine(m) ? [`  routine: the engine writes this child's day; give five entries a day at ${home} and spend the words on the prose`] : []),
      ];
    }),
    ...(n.housemates.length ? [`ALSO AT HOME (their cards exist; do not write them): ${n.housemates.map(h => `${h.id} (${h.name}, ${h.age}, ${h.role}: ${h.line})`).join("; ")}`] : []),
    `HOME: ${home}, ${n.home.line} (${n.home.beds} ${n.home.beds === 1 ? "bed" : "beds"})`,
    "",
    "PLACES",
    `workplace options: ${draw.members.map(m => `${m.slot} ${assignedWorkplace(m, home) ?? "null (no job)"}`).join("; ")}`,
    `places for routines: ${routinePlacesFor(draw).map(p => `${p.id} (${p.line})`).join("; ")}; ${home} (their home)`,
    `people they might know: ${ctx.knownResidents.map(r => `${r.id} (${r.name}: ${r.line})`).join("; ") || "none"}`,
  ];
  if (ctx.requiredLinks.length)
    lines.push(`REQUIRED TIES (put each in that member's relationships, with this id): ${ctx.requiredLinks.map(l => `${l.slot} → ${l.id} (${l.name})${l.tag ? `, tag ${l.tag}` : ""}: ${stripRefs(l.hint)}`).join(" | ")}`);
  const seeds = draw.members.flatMap(m => {
    const nf = m.native!;
    const kin = ctx.requiredLinks.filter(l => l.slot === m.slot && l.tag === "kin").map(l => `${l.id} (${l.name})`);
    if (!nf.seed && !kin.length) return [];
    return [`${m.slot}${nf.pinned ? ` ${nf.pinned.name}` : ""}: ${[nf.seed ? stripRefs(nf.seed) : "", kin.length ? `Kin: ${kin.join(", ")}.` : ""].filter(Boolean).join(" ")}`];
  });
  if (seeds.length) lines.push(`SEED (true of them; build the card around it, and keep the Tollmen out of secrets): ${seeds.join(" | ")}`);
  lines.push(`AVOID: first names ${ctx.avoidFirst.join(", ")}; full names ${ctx.avoidFull.join(", ") || "none"}`, `WHIM: ${ctx.whim}`);
  if (ctx.validatorErrors?.length) lines.push("", `YOUR LAST ANSWER FAILED VALIDATION. Fix exactly these and change nothing else: ${ctx.validatorErrors.join(" | ")}`);
  lines.push("", "OUTPUT CONTRACT", arrivalContract(home));
  return lines.join("\n");
}

// ── The template card (A.3.8, native) ───────────────────────────────────────

const NATIVE_CHILD_SAMPLES: readonly [string, string, string] = ["Can we go to the ducks? Just for a minute.", "I'm not tired. I'm resting my eyes.", "Mr. Amari says my letters lean. They're fine."];
const NATIVE_TEEN_SAMPLES: readonly [string, string, string] = ["It's fine. It's a town. There's a pub. Can't go in it.", "Did you see the lighthouse? It's not even on.", "I'll do the lessons later. Probably."];
const OCCUPATION: Readonly<Record<string, string>> = {
  retired: "retired", out_of_work: "out of work, looking", carer: "full-time carer at home", unable: "retired early",
  pupil: "pupil at Millbrook School", lessons: "lessons by post at the library desk", under_five: "too small for school yet",
};
const WORK_CLAUSE: Readonly<Record<string, string>> = {
  retired: "is retired now", out_of_work: "has been out of work and looking since the last job went", carer: "looks after the household full-time",
  unable: "had to stop working early", pupil: "goes to Millbrook School", lessons: "does lessons by post at the library desk", under_five: "is too small for school yet",
};

/** V06 wants the appearance to name something the bust wears: a procedural caption can leave out its skirt. */
function withAttire(caption: string, attire: readonly string[]): string {
  const words = attire.map(a => a.replace(/_/g, " "));
  if (words.some(w => caption.toLowerCase().includes(w))) return caption;
  return `${caption.replace(/\.$/, "")}, and a ${words[0]}.`;
}

/** A first name from the skeleton's options that V03 still allows (none taken twice, no full-name clash). */
function templateName(m: MemberDraw, ctx: Pick<ValidationContext, "residents" | "reservedFull">, chosen: readonly string[]): string {
  const nf = m.native!;
  if (nf.pinned) return nf.pinned.name;
  const living = [...ctx.residents.values()].map(r => r.name);
  const takenFull = new Set([...living, ...chosen, ...(ctx.reservedFull ?? []), ...FAMOUS_NAMES].map(foldName));
  const firstUse = new Map<string, number>();
  for (const n of [...living, ...chosen]) { const f = foldName(n.replace(/"[^"]*"\s*/g, "").split(" ")[0] ?? ""); firstUse.set(f, (firstUse.get(f) ?? 0) + 1); }
  const reserved = new Set(RESERVED_FIRST_NAMES.map(foldName));
  const pool = [...nf.first_names, ...FIRST_NAMES[m.presentation]];
  const first = pool.find(f => !reserved.has(foldName(f)) && (firstUse.get(foldName(f)) ?? 0) < 2 && !takenFull.has(foldName(`${f} ${nf.surname}`))) ?? nf.first_names[0] ?? "Sam";
  return `${first} ${nf.surname}`;
}

/** A routine from the occupation's template (A.3.8), on the census's terms: the real home, commuters away, Saturday jobs. */
function nativeTemplateRoutine(m: MemberDraw, home: string, rng: SeededRng): ArrivalMember["routine"] {
  const wp = assignedWorkplace(m, home);
  if (isCommuter(m)) {
    const r = templateRoutine(m, null, rng, home);
    const city = "offmap.city";
    return {
      weekday: [{ at: "06:30", do: "eat", where: home }, { at: "07:30", do: "work", where: city }, { at: "12:30", do: "eat", where: city }, { at: "13:30", do: "work", where: city }, { at: "19:00", do: "eat", where: city }, { at: "22:00", do: "sleep", where: city }],
      weekend: r.weekend,
    };
  }
  const job = m.native?.job ? wp : null;
  const r = templateRoutine(m, job, rng, home);
  const saturday = m.native?.saturday_job;
  if (saturday && !m.native?.job) r.weekend = r.weekend.map(e => (e.at === "10:00" ? { at: "09:00", do: "work" as const, where: saturday } : e));
  return r;
}

/**
 * A.3.8's template household for a Day-1 household: the census's names (the first option V03 allows, or the canon
 * name), ages and work; the portrait's caption as the appearance; two authored sentences; the archetype's values and
 * dream d1; a template routine; the required ties and the household's own; no secrets. Same shape as the model's
 * output, so the same validation (profile "native", no V19) and assembly apply; the caller flags it generated_by: template.
 */
export function nativeTemplateHousehold(draw: HouseholdDraw, ctx: Pick<ValidationContext, "residents" | "reservedFull" | "requiredLinks">, seed: string | number = 0): ArrivalHouseholdOutput {
  const n = draw.native!;
  const home = n.home.id;
  const rng = SeededRng.of(seed, draw.id, "native-template");
  const order = () => [0, 1, 2, 3, 4, 5].sort(() => rng.next() - 0.5);
  const openOrder = order(), extraOrder = order();
  const names: string[] = [];
  for (const m of draw.members) names.push(templateName(m, ctx, names));
  const members = draw.members.map((m, i): ArrivalMember => {
    const nf = m.native!;
    const a = memberArchetype(m, draw);
    const t = memberTags(m);
    const first = names[i]!.replace(/^(Rev\.|Captain|Dr\.)\s+/, "").replace(/"[^"]*"\s*/g, "").split(" ")[0]!;
    const { they, s } = pronounForms(m.pronoun_default);
    const minor = nf.minor !== null;
    const dream = a.dreams[0];
    const years = Math.min(nf.years_in_monde, m.age);
    const from = rng.pick(OUTSIDE_PLACES);
    const work = nf.job ? `works as ${nf.job.title.replace(/^works in /, "a commuter to ")}` : WORK_CLAUSE[nf.employment] ?? "keeps busy";
    const where = years >= m.age ? `${first} was born in Monde and ${work}.` : `${first} came to Monde from ${from} ${years} ${years === 1 ? "year" : "years"} ago and ${work}.`;
    const want = minor ? `${cap(they)} like${s} the ducks on the Commons best.` : `What ${they} want${s} most is plain enough: ${dream.text.charAt(0).toLowerCase()}${dream.text.slice(1)}.`;
    const big5 = { open: rng.int(25, 80), conscientious: rng.int(25, 80), extravert: rng.int(25, 80), agreeable: rng.int(35, 85), neurotic: rng.int(20, 70) };
    const keys = Object.keys(big5) as (keyof typeof big5)[];
    big5[keys[(i + rng.int(0, 4)) % 5]!] = rng.chance(0.5) ? rng.int(72, 88) : rng.int(12, 28);
    if (draw.members.length > 1) { big5.open = GRID[openOrder[i]!]!; big5.extravert = GRID[extraOrder[i]!]!; }
    if (!Object.values(big5).some(v => v >= 70 || v <= 30)) big5.conscientious = rng.chance(0.5) ? rng.int(72, 88) : rng.int(12, 28);
    const samples = minor ? (nf.minor === "teen" ? NATIVE_TEEN_SAMPLES : NATIVE_CHILD_SAMPLES) : a.samples;
    const required = (ctx.requiredLinks ?? []).filter(l => l.slot === m.slot)
      .map(l => ({ id: l.id, affinity: l.tag === "kin" ? 50 : 30, trust: l.tag === "kin" ? 50 : 30, tag: l.tag ?? ("fond" as const), note: "Known for years." }));
    const household = draw.members.filter(o => o.slot !== m.slot).slice(0, 3)
      .map(o => ({ id: o.slot, affinity: 70, trust: 70, tag: "kin" as const, note: "Same house." }));
    const relationships = [...required, ...household];
    if (!relationships.length) relationships.push({ id: "pell", affinity: 10, trust: 15, tag: "curious", note: "The mayor, as long as anyone remembers." });
    return {
      slot: m.slot, name: names[i]!, age: m.age, pronouns: m.pronoun_default,
      occupation: nf.job ? nf.job.title : OCCUPATION[nf.employment] ?? "at home",
      workplace: assignedWorkplace(m, home),
      appearance: withAttire(agelessCaption(t.caption), t.attire),
      backstory: `${where} ${want}`,
      personality: { traits: [...TRAITS].sort(() => rng.next() - 0.5).slice(0, 3), big5 },
      values: { ...a.values },
      beliefs: ["Monde was busier when I was younger, and it will be again.", "Nobody on this street notices the empty houses any more."],
      voice: { register: minor ? "A young voice: questions, then more questions." : a.voice, tics: [samples[0].split(/(?<=[.!?])/)[0]!.trim()], never_says: NEVER_SAYS.slice(0, 2), samples: [...samples] },
      likes: [...a.likes].slice(0, 3), dislikes: [...a.dislikes].slice(0, 3), fears: [minor ? "the dark on the stairs" : "the last ferry leaving with nobody coming back"],
      dream: { template: dream.id, text: dream.text, stages: [...dream.stages] },
      routine: nativeTemplateRoutine(m, home, rng),
      chores: [...CHORES].sort(() => rng.next() - 0.5).slice(0, 2),
      relationships,
      secrets: [],
      story_role: "none",
    };
  });
  const summary = draw.members.length === 1 ? `Lives alone at ${n.home.line}.` : `A household of ${draw.members.length} at ${n.home.line}.`;
  return { household: { same_surname: new Set(draw.members.map(m => m.native!.surname)).size === 1, summary }, members };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// ── Static card checks (the content linter's A.3.7 subset) ──────────────────

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;
const sentenceCount = (s: string): number => s.split(/(?<=[.!?])\s+/).filter(x => x.trim()).length;
const NAME_PART = /^[\p{L}][\p{L}'’-]*$/u;
const SECRET_TOPICS = /\b(tollm[ae]n|vane|greyline|loan|option|charter|consolidated)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const minutesOf = (at: string): number => { const t = /^(\d{1,2}):(\d{2})$/.exec(at); return t ? Number(t[1]) * 60 + Number(t[2]) : NaN; };

/**
 * A.3.7's checks that read only the card (no household, roster or model output): V02 (unless canon-named), V06, V07,
 * V08, V09, V10, V11, V12, V13's counts and times, V14's numbers (within ±60 outside the household and the `required`
 * ties, as the native validator has it), V15. The linter adds the roster checks (ids, places, homes, the skeleton) and
 * V16's filters.
 */
export function cardProblems(card: PersonaCard, opts: { canonName?: boolean; household?: ReadonlySet<string>; required?: ReadonlySet<string> } = {}): string[] {
  const out: string[] = [];
  const tokens = card.name.trim().split(/\s+/);
  if (!opts.canonName && (tokens.length < 2 || tokens.length > 3 || card.name.length > 28 || tokens.some(t => !NAME_PART.test(t)))) out.push(`V02 name "${card.name}"`);
  if (wordCount(card.appearance) > 40 || sentenceCount(card.appearance) > 2) out.push("V06 appearance: 1-2 sentences, at most 40 words");
  const lengths: [string, string, number][] = [
    ["occupation", card.occupation, 12], ["dream.text", card.dream.text, 25], ...card.dream.stages.map((s, i): [string, string, number] => [`dream.stages[${i}]`, s, 18]),
  ];
  if (card.voice.mode !== "narrated_action") {
    lengths.push(["voice.register", card.voice.register, 40], ...card.voice.samples.map((s, i): [string, string, number] => [`voice.samples[${i}]`, s, 25]));
  }
  for (const [field, text, max] of lengths) if (wordCount(text) > max) out.push(`V07 ${field} is ${wordCount(text)} words; at most ${max}`);
  const traits = card.personality.traits;
  if (traits.length < 3 || traits.length > 5 || traits.some(t => /\s/.test(t.trim()))) out.push("V08 traits: 3-5 single words");
  if (!Object.values(card.personality.big5).some(v => v >= 70 || v <= 30)) out.push("V08 big5: one trait at 70+ or 30-");
  const values = Object.entries(card.values);
  if (values.some(([, v]) => v < 0.05 - 1e-9 || v > 0.6 + 1e-9)) out.push("V09 values: each 0.05-0.60");
  if (card.voice.mode !== "narrated_action") {
    const v = card.voice;
    if (v.tics.length < 1 || v.tics.length > 4) out.push("V10 tics: 1-4");
    if (v.never_says.length < 2 || v.never_says.length > 6) out.push("V10 never_says: 2-6");
    for (const s of v.samples) {
      const hit = v.never_says.find(x => x.trim() && s.toLowerCase().includes(x.toLowerCase()));
      if (hit) out.push(`V10 a sample says its own never_says "${hit}"`);
      if (EMOJI.test(s)) out.push("V10 a sample has an emoji");
    }
  }
  const count = (list: readonly string[], lo: number, hi: number, field: string) => { if (list.length < lo || list.length > hi) out.push(`V11 ${field}: ${lo}-${hi}`); };
  count(card.likes, 3, 5, "likes"); count(card.dislikes, 3, 5, "dislikes"); count(card.fears, 1, 3, "fears"); count(card.chores, 2, 4, "chores");
  if (card.dream.stages.length !== 3) out.push("V12 dream.stages: exactly 3");
  for (const day of ["weekday", "weekend"] as const) {
    const list = card.routine[day];
    if (list.length < 5 || list.length > 9) out.push(`V13 routine.${day}: 5-9 entries`);
    let prev = -1, wrapped = false;
    for (const e of list) {
      let min = minutesOf(e.at);
      if (Number.isFinite(min) && min < prev && !wrapped && min + 1440 <= 26 * 60) { min += 1440; wrapped = true; }
      if (!Number.isFinite(min) || min < prev || min > 26 * 60) { out.push(`V13 routine.${day}: "${e.at}" out of order`); break; }
      prev = min;
    }
  }
  if (card.relationships.length < 1) out.push("V14 relationships: at least one");
  for (const r of card.relationships) {
    const lim = opts.household?.has(r.id) || opts.required?.has(r.id) ? TIE_RANGE : NATIVE_TIE_LIMIT;
    if (Math.abs(r.affinity) > lim || Math.abs(r.trust) > lim) out.push(`V14 relationships "${r.id}": within ±${lim}`);
  }
  if (card.secrets.length > 2) out.push("V15 secrets: at most 2");
  for (const s of card.secrets) {
    const min = s.reveal.regard_min;
    if (min === undefined || min < 40 || min > 80) out.push("V15 secrets: regard_min 40-80");
    if (SECRET_TOPICS.test(s.text)) out.push(`V15 a secret touches the town's affairs: "${s.text.slice(0, 40)}…"`);
  }
  // V18: only the named canon people may carry canon_locks (Kasey rules on pins.yaml's drafts at curation).
  if (!opts.canonName && card.canon_locks.length) out.push("V18 a generated card carries no canon_locks");
  return out;
}
