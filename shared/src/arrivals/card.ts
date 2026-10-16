// Writing an arrival's Persona Card (GDD Appendix A.3.6–A.3.8, §9.3): the Haiku prompt and its output contract, the
// validator, the engine's assembly of PersonaCards, and the template fallback. Pure: no I/O and no model calls (the
// server makes the call, server/src/mind/arrivals.ts).
import { z } from "zod";
import { PORTRAIT_SET, PersonaCard, type Values } from "../persona";
import { PILLARS, type Pillar } from "../script/types";
import { Verb } from "../verbs";
import { ARCHETYPE_BY_ID, type Archetype } from "./archetypes";
import type { HouseholdDraw, MemberDraw } from "./draw";
import { BAND_AGES, portraitById } from "./library";
import { FAMILY_NAMES, FAMOUS_NAMES, FIRST_NAMES, RESERVED_FAMILY_NAMES, RESERVED_FIRST_NAMES, foldName } from "./names";
import { SeededRng } from "./rng";

/**
 * A household is written before it has a home (it waits in the arrival buffer, §9.2), so its routines and workplace
 * say `home.own` for home, and bindHome() swaps in the real door when the home is reserved (A.3.1 step 4).
 */
export const HOME_TOKEN = "home.own";
export const STORY_ROLES = ["none", "favor_giver", "shopkeeper", "volunteer", "mentor"] as const;
export const RELATION_TAGS = ["fond", "wary", "curious", "rival", "kin", "friend"] as const;
export const PRONOUNS = ["she/her", "he/him", "they/them"] as const;
/** The places a Spring arrival's day uses besides home and work (§9.5 ids on the MVP boards). */
export const ROUTINE_PLACES: readonly { id: string; line: string }[] = [
  { id: "old_quarter.fountain_square", line: "the square with the heron fountain" },
  { id: "old_quarter.library", line: "the free library, Margo's" },
  { id: "old_quarter.st_brigids", line: "the chapel" },
  { id: "market_row.market_street", line: "Market Row's street; the Saturday market" },
  { id: "market_row.cafe_liss", line: "Café Liss" },
  { id: "market_row.gull_and_anchor", line: "the pub, The Gull & Anchor" },
  { id: "market_row.general_store", line: "Dunmore's General Store" },
  { id: "market_row.bakery", line: "Fournier & Fille, the bakery" },
  { id: "commons.duck_pond", line: "the duck pond on the Commons" },
  { id: "commons.picnic_lawn", line: "the picnic lawn on the Commons" },
  { id: "wharf.breakwater", line: "the breakwater" },
  { id: "wharf.harbor_steps", line: "the harbour steps" },
];
/** A.3.6's outside places (V17's allowlist): where people come from. */
export const OUTSIDE_PLACES = ["Carrow", "Hessle Cross", "Port Sallow", "Tarn End", "Marrow Quay", "Ashby Lock"] as const;

// ── The output contract (A.3.6), as a structured-output schema ──────────────
// No numeric ranges or lengths in the schema (Haiku 5.5's structured outputs reject them, §9.17): the validator
// below enforces A.3.7's rules afterwards.

const RoutineEntry = z.object({
  at: z.string().describe("HH:MM, ascending; past midnight runs on as 24:30, 25:00"),
  do: Verb,
  where: z.string().describe("A place id from the lists, or home.own"),
});

export const ArrivalMember = z.object({
  slot: z.string().describe("Echo the slot"),
  name: z.string().describe("First Last: 2-3 words; letters, apostrophes, hyphens"),
  age: z.number().int().describe("Inside the portrait band and the age range"),
  pronouns: z.enum(PRONOUNS),
  occupation: z.string().describe("12 words at most"),
  workplace: z.string().nullable().describe("A place id from workplace options, home.own, or null"),
  appearance: z.string().describe("1-2 sentences, 40 words at most, agreeing with the portrait tags"),
  backstory: z.string().describe("120 words at most"),
  personality: z.object({
    traits: z.array(z.string()).describe("3 to 5 single words"),
    big5: z.object({ open: z.number().int(), conscientious: z.number().int(), extravert: z.number().int(), agreeable: z.number().int(), neurotic: z.number().int() }),
  }),
  values: z.object({ prosperity: z.number(), safety: z.number(), spirit: z.number(), charm: z.number() }),
  beliefs: z.array(z.string()).describe("2 to 4 short first-person beliefs; at least one is wrong"),
  voice: z.object({
    register: z.string().describe("40 words at most on how they talk"),
    tics: z.array(z.string()).describe("1 to 4 short phrases"),
    never_says: z.array(z.string()).describe("2 to 6 words or phrases"),
    samples: z.array(z.string()).describe("Exactly 3 lines, each 25 words at most"),
  }),
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  fears: z.array(z.string()),
  dream: z.object({
    template: z.string().describe("One of the archetype's dream ids"),
    text: z.string(),
    stages: z.array(z.string()).describe("Exactly 3, each starting with a verb"),
  }),
  routine: z.object({ weekday: z.array(RoutineEntry), weekend: z.array(RoutineEntry) }),
  chores: z.array(z.string()),
  relationships: z.array(z.object({
    id: z.string().describe("A resident id from the list, or a household slot"),
    affinity: z.number().int(), trust: z.number().int(), tag: z.enum(RELATION_TAGS), note: z.string(),
  })),
  secrets: z.array(z.object({ text: z.string(), reveal: z.object({ regard_min: z.number().int() }) })),
  story_role: z.enum(STORY_ROLES),
});
export type ArrivalMember = z.infer<typeof ArrivalMember>;

export const ArrivalHouseholdOutput = z.object({
  household: z.object({ same_surname: z.boolean(), summary: z.string().describe("25 words at most: how they are related and why they came") }),
  members: z.array(ArrivalMember),
});
export type ArrivalHouseholdOutput = z.infer<typeof ArrivalHouseholdOutput>;

// ── The prompt (A.3.6) ──────────────────────────────────────────────────────

/** A.3.6's system prompt, exact text. It and nothing else sits in the cached prefix. */
export const ARRIVAL_SYSTEM_PROMPT = `You write Persona Cards for the residents of Monde, a fictional seaside town in a gentle, storybook-modern world: bicycles, radios, rotary telephones, a diesel ferry, a hand-set newspaper. There are no smartphones, no internet, and no real-world brands, places, people or politics. The game is rated E10+.

You are given a portrait that has already been chosen, an archetype, a household, and lists of the homes, workplaces, places and residents that exist. Write one card per household member. The portrait is fixed. Fit the person to it: age band, build, hair, skin, clothes. Never the other way round.

OUTPUT RULES
1. Reply with one JSON object and nothing else. No markdown fences, no commentary.
2. Follow the OUTPUT CONTRACT in the user message exactly. Do not add, rename or drop keys.
3. Use only place ids, resident ids, Project ids and dream template ids from the lists you are given.
4. Write about the person only. Never mention the player, "the Fellow", the game, AI, prompts, Pillars or any rule.

CRAFT RULES
- Concrete over abstract. "Keeps her late husband's thermos in the boat and never fills it" beats "carries old grief".
- Backstory: at most 120 words, specific, no theme statements, no morals. Say where they lived before, what they did, one thing that went right or wrong, and why Monde.
- Every person is wrong about one thing and wants something from someone other than the player. Put both somewhere in the card (backstory, dream, relationships or secrets).
- Values weigh prosperity, safety, spirit and charm and sum to 1.0. Start from the archetype defaults and move at least one by 0.05 or more. People in one household should not match exactly.
- Voice follows the town's dialogue rules. Contractions in speech. At most one rhetorical device per speech. Never "Not X, but Y." Never explain what a moment means. Vary length hard: some replies are one word. Parentheticals are small physical actions only, never emotion labels. The three samples should sound like three different moods of one person.
- Humor is small and dry, and sometimes lands badly. Nobody is witty on schedule.
- Be kind. Cartoon mischief is fine. No profanity. No romance beyond hand-holding. No weapons, injuries, drugs or alcohol, except cider at the pub and tea or coffee at the café. No crime, cruelty or abuse in backstories or secrets.
- Secrets are small and human: a hidden talent, an old embarrassment, a promise. Never about the town's affairs.
- Do not give anyone knowledge of the Tollmen's finances, Vane Consolidated's plans, any loan or option on the Wharf, or any founder's charter. They may have opinions about what the Tollmen visibly do.
- Names suit the portrait and the household and avoid stereotype. Never use a name on the AVOID list or any famous person's name.`;

/** A.3.6's output contract text (the `{{contract}}` fill), with the engine's additions marked GDD-GAP in code. */
export const ARRIVAL_CONTRACT = `{
  "household": { "same_surname": true, "summary": "<= 25 words: how they are related and why they came" },
  "members": [
    {
      "slot": "m1",                          // echo the slot
      "name": "First Last",                  // 2-3 words; letters, apostrophes, hyphens
      "age": 0,                              // integer inside the portrait band and the age range
      "pronouns": "she/her | he/him | they/them",
      "occupation": "<= 12 words",
      "workplace": "<place id from workplace options> | home.own | null",
      "appearance": "1-2 sentences, <= 40 words, must agree with the portrait tags and name one item they wear",
      "backstory": "<= 120 words",
      "personality": {
        "traits": ["3 to 5 single words"],
        "big5": { "open": 0, "conscientious": 0, "extravert": 0, "agreeable": 0, "neurotic": 0 }  // integers 0-100, one >= 70 or <= 30
      },
      "values": { "prosperity": 0.00, "safety": 0.00, "spirit": 0.00, "charm": 0.00 },           // each 0.05-0.60, sum 1.0
      "beliefs": ["2 to 4 short first-person beliefs about the town or themselves; at least one is wrong"],
      "voice": {
        "register": "<= 40 words on how they talk",
        "tics": ["1 to 4 short phrases"],
        "never_says": ["2 to 6 words or phrases"],
        "samples": ["exactly 3 lines, each <= 25 words"]
      },
      "likes": ["3 to 5"], "dislikes": ["3 to 5"], "fears": ["1 to 3"],
      "dream": {
        "template": "<one of the archetype's dream ids>",
        "text": "<= 25 words",
        "stages": ["exactly 3, each <= 18 words, each starting with a verb"]
      },
      "routine": {
        "weekday": [ { "at": "HH:MM", "do": "work|eat|nap|shop|socialize|sleep|walk|read|garden|fish|clean|cook|visit|attend|tinker|write|pray|wander|sit", "where": "<place id or home.own>" } ],
        "weekend": [ { "at": "HH:MM", "do": "...", "where": "<place id or home.own>" } ]
      },                                     // 5-9 entries a day, the first and last at home.own; work only at the workplace
      "chores": ["2 to 4 short phrases"],
      "relationships": [
        { "id": "<resident id or household slot>", "affinity": 0, "trust": 0,
          "tag": "fond|wary|curious|rival|kin|friend", "note": "<= 15 words" }
      ],                                     // 1-3; anyone outside the household within -30..30
      "secrets": [ { "text": "<= 25 words", "reveal": { "regard_min": 60 } } ],   // 0-2; regard_min 40-80
      "story_role": "none | favor_giver | shopkeeper | volunteer | mentor"
    }
  ]
}`;

export interface PromptTown {
  day: number;
  season: string;
  weekday: string;
  pillars: Readonly<Record<Pillar, number>>;
  census: number;
  shopsOpen: number;
  pupils: number;
  projectsDone: readonly string[];
  projectsActive: readonly string[];
}

export interface PromptContext {
  town: PromptTown;
  mode: "native" | "arrival" | "returnee";
  /** The household's home once reserved; null while it waits in the buffer (it writes `home.own`). */
  home: { id: string; description: string; beds: number } | null;
  /** Residents they might know (6–10 entries: id, name, one line). */
  knownResidents: readonly { id: string; name: string; line: string }[];
  avoidFirst: readonly string[];
  avoidFull: readonly string[];
  /** A.3.8: "a fresh whim seed" on every call. */
  whim: string;
  validatorErrors?: readonly string[];
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const pillarLine = (p: Readonly<Record<Pillar, number>>): string => PILLARS.map(k => `${k} ${Math.round(p[k])}`).join(", ");
const vec = (v: Readonly<Record<Pillar, number>>): string => PILLARS.map(k => `${k} ${v[k].toFixed(2)}`).join(", ");

/** The workplaces this archetype can name (§9.5 ids), plus home.own. */
export const workplaceOptions = (a: Archetype): string[] => [...new Set([...a.workplaces.filter(w => w !== "home"), HOME_TOKEN])];

/** A.3.6's user message. */
export function arrivalUserMessage(draw: HouseholdDraw, ctx: PromptContext): string {
  const a = ARCHETYPE_BY_ID.get(draw.archetype)!;
  const rng = SeededRng.of(draw.id, ctx.whim, "pool");
  const pool = (list: readonly string[], n: number) => [...list].sort(() => rng.next() - 0.5).slice(0, n);
  const firsts = pool([...new Set(draw.members.flatMap(m => FIRST_NAMES[m.presentation]))].filter(n => !ctx.avoidFirst.includes(n)), 14);
  const lasts = pool(FAMILY_NAMES, 12);
  const t = ctx.town;
  const home = ctx.home ?? { id: HOME_TOKEN, description: "a restored house in Monde, its door chosen when they land (use home.own)", beds: draw.beds };
  const lines = [
    `DAY ${t.day} · ${t.season} · ${t.weekday}`,
    `PILLARS: ${pillarLine(t.pillars)}`,
    `TOWN: census ${t.census}; shops open ${t.shopsOpen}; school pupils ${t.pupils}; projects done: ${t.projectsDone.join(", ") || "none"}; in progress: ${t.projectsActive.join(", ") || "none"}`,
    `MODE: ${ctx.mode}`,
    "",
    `ARCHETYPE ${a.id} · ${a.label}`,
    `default values: ${vec(a.values)}`,
    "dream templates:",
    ...a.dreams.map(d => `${d.id} → ${d.text} → ${d.stages.join(" › ")}`),
    `likes to draw from: ${a.likes.join("; ")}`,
    `dislikes to draw from: ${a.dislikes.join("; ")}`,
    `voice note: ${a.voice}`,
    `typical work: ${a.occupations.join("; ")}`,
    "",
    `HOUSEHOLD (${draw.members.length} ${draw.members.length === 1 ? "person" : "people"})`,
    ...draw.members.flatMap(m => {
      const p = portraitById(m.portrait)!;
      return [
        `- slot ${m.slot} · role ${m.role} · age range ${m.age_min}-${m.age_max} · pronoun default ${m.pronoun_default}`,
        `  portrait ${p.id}: ${p.caption}`,
        `  tags: band ${p.band}, presentation ${p.presentation}, skin ${p.skin} (${p.skin_word}), hair ${p.hair_word} ${p.look.hair.style}, attire ${p.attire.join(", ")}, build ${p.build}`,
      ];
    }),
    `HOME: ${home.id}, ${home.description} (${home.beds} beds)`,
    "",
    "PLACES",
    `workplace options: ${workplaceOptions(a).join(", ")}`,
    `places for routines: ${ROUTINE_PLACES.map(p => `${p.id} (${p.line})`).join("; ")}; ${HOME_TOKEN} (their home)`,
    `people they might know: ${ctx.knownResidents.map(r => `${r.id} (${r.name}: ${r.line})`).join("; ")}`,
    `name pool (use or invent): first ${firsts.join(", ")}; family ${lasts.join(", ")}`,
    `AVOID: first names ${ctx.avoidFirst.join(", ")}; full names ${ctx.avoidFull.join(", ") || "none"}`,
    `WHIM: ${ctx.whim}`,
  ];
  if (ctx.validatorErrors?.length) lines.push("", `YOUR LAST ANSWER FAILED VALIDATION. Fix exactly these and change nothing else: ${ctx.validatorErrors.join(" | ")}`);
  lines.push("", "OUTPUT CONTRACT", ARRIVAL_CONTRACT);
  return lines.join("\n");
}

/** A.3.6: max_tokens = 900 + 750 × household size. */
export const arrivalMaxTokens = (size: number): number => 900 + 750 * size;

// ── Validation (A.3.7) ──────────────────────────────────────────────────────

export interface ValidationContext {
  /** Registered place ids (§9.5). */
  places: ReadonlySet<string>;
  /** Living residents by id (core cast, featured, generated): names for V03. */
  residents: ReadonlyMap<string, { name: string }>;
  /** Full names that may never be used (the Departed, residents who left in the last 30 days). */
  reservedFull?: readonly string[];
  /** The content filters (§9.13 step 2): the groups a text trips. The server passes its lexical filters. */
  banned?: (text: string) => readonly string[];
}

export type Validation = { ok: true; output: ArrivalHouseholdOutput; warnings: string[] } | { ok: false; errors: string[] };

const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;
const sentences = (s: string): number => s.split(/(?<=[.!?])\s+/).filter(x => x.trim()).length;
const TITLES = /^(mr|mrs|ms|miss|dr|doctor|captain|capt|sir|lady|lord|rev|father|sister|mx)\.?$/i;
const NAME_TOKEN = /^[\p{L}][\p{L}'’-]*$/u;
const VERB_STOP = new Set(["the", "a", "an", "my", "his", "her", "their", "our", "your", "i", "we", "it", "this", "that", "one", "some"]);
const BANNED_SECRETS = /\b(tollm[ae]n|vane|greyline|loan|option|charter|consolidated)\b/i;
const CRIME = /\b(stole|steal|theft|murder|kill|prison|jail|drunk|drugs?|gun|knife|blood|affair|kiss(?:ed|ing)?)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;
const NOT_X_BUT_Y = /\bnot (?:a |an |the )?[\p{L}' -]{1,30}[,;—-]+ ?but\b|\bit isn'?t [\p{L}' -]{1,30}[.,;—-]+ ?it'?s\b/iu;
const CONTRACTION = /\b\p{L}+['’](?:s|t|re|ve|ll|d|m)\b/iu;
/** V06: words that contradict a portrait's hair, by the hair word's family. */
const HAIR_FAMILIES: readonly (readonly [RegExp, RegExp])[] = [
  [/white|grey|gray|silver/, /\b(dark|black|blond|blonde|brown|red|ginger|auburn|chestnut|sandy)[- ]haired\b|\b(black|blond|blonde|auburn|ginger|chestnut|sandy|brown|red|dark) hair\b/i],
  [/black|dark/, /\b(blond|blonde|ginger|red|white|silver|grey|gray|sandy)[- ]haired\b|\b(blond|blonde|ginger|red|white|silver|grey|gray|sandy) hair\b/i],
  [/blond|sandy/, /\b(black|dark|ginger|red|white|grey|gray|silver)[- ]haired\b|\b(black|dark|ginger|red|white|grey|gray|silver) hair\b/i],
  [/ginger|red|auburn/, /\b(black|blond|blonde|white|grey|gray|silver)[- ]haired\b|\b(black|blond|blonde|white|grey|gray|silver) hair\b/i],
  [/brown|chestnut/, /\b(blond|blonde|white|silver|ginger)[- ]haired\b|\b(blond|blonde|white|silver|ginger) hair\b/i],
];
const ELDER_WORDS = /\b(young|youthful|teenage|teenager|in (?:her|his|their) (?:twenties|thirties))\b/i;
const CHILD_WORDS = /\b(elderly|old (?:man|woman)|grey-haired|retired|wrinkled)\b/i;
const PRONOUN_WORDS: Readonly<Record<(typeof PRONOUNS)[number], RegExp>> = {
  "she/her": /\b(he|him|his|himself)\b/i,
  "he/him": /\b(she|her|hers|herself)\b/i,
  "they/them": /\b(he|him|his|she|her|hers)\b/i,
};
/** Readable words for the library's attire tags (V06: the appearance mentions one). */
const ATTIRE_WORDS: Readonly<Record<string, readonly string[]>> = {
  jumper: ["jumper", "sweater", "knit"], school_jumper: ["jumper", "school"], satchel: ["satchel", "bag"], boots: ["boots", "wellies"],
  apron: ["apron"], tool_belt: ["tool belt", "belt"], smock: ["smock"], scarf: ["scarf"], coat: ["coat", "jacket"],
  tote: ["tote", "bag"], oilskin: ["oilskin", "jacket", "slicker"], glasses: ["glasses", "spectacles"], checked: ["checked", "shirt"],
  flat_cap: ["cap"], work_jacket: ["jacket"], pencil: ["pencil"], cardigan: ["cardigan"], tape_measure: ["tape measure", "tape"],
  knit_cap: ["cap", "hat", "beanie"], brooch: ["brooch"], peaked_cap: ["cap"], navy_jumper: ["jumper", "sweater"],
  raincoat: ["raincoat", "coat", "mac"], velvet_jacket: ["velvet", "jacket"],
};

/** V07: over by under 10% → cut at the last sentence break; otherwise an error. */
function fitWords(text: string, max: number, field: string, errors: string[]): string {
  const n = words(text);
  if (n <= max) return text;
  if (n <= Math.ceil(max * 1.1)) {
    const parts = text.split(/(?<=[.!?])\s+/);
    while (parts.length > 1 && words(parts.join(" ")) > max) parts.pop();
    const cut = parts.join(" ");
    if (words(cut) <= max) return cut;
  }
  errors.push(`V07 ${field} is ${n} words; at most ${max}`);
  return text;
}

/** Validate and normalise one household (A.3.7). Errors name the field and value: they're fed back on a retry. */
export function validateHousehold(raw: unknown, draw: HouseholdDraw, ctx: ValidationContext): Validation {
  const parsed = ArrivalHouseholdOutput.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: [`V01 not the contract: ${parsed.error.issues.slice(0, 4).map(i => `${i.path.join(".")} ${i.message}`).join("; ")}`] };
  const out = structuredClone(parsed.data);
  const errors: string[] = [];
  const warnings: string[] = [];
  const a = ARCHETYPE_BY_ID.get(draw.archetype)!;
  // V01: one card per member, slots echoed in order.
  if (out.members.length !== draw.members.length) errors.push(`V01 members has ${out.members.length} entries; the household is ${draw.members.length}`);
  out.members.forEach((m, i) => { if (m.slot !== draw.members[i]?.slot) errors.push(`V01 members[${i}].slot is "${m.slot}"; expected ${draw.members[i]?.slot}`); });
  out.household.summary = fitWords(out.household.summary, 25, "household.summary", errors);

  const reserved = new Set([...RESERVED_FIRST_NAMES.map(foldName)]);
  const reservedFamily = new Set(RESERVED_FAMILY_NAMES.map(foldName));
  const fullTaken = new Set([...[...ctx.residents.values()].map(r => foldName(r.name)), ...(ctx.reservedFull ?? []).map(foldName), ...FAMOUS_NAMES.map(foldName)]);
  const firstCount = new Map<string, number>();
  for (const r of ctx.residents.values()) { const f = foldName(r.name.replace(/"[^"]*"\s*/g, "").split(" ")[0] ?? ""); firstCount.set(f, (firstCount.get(f) ?? 0) + 1); }
  const familyTaken = new Set([...ctx.residents.values()].map(r => foldName(r.name.split(" ").at(-1) ?? "")));
  const slots = new Set(draw.members.map(m => m.slot));
  const places = new Set([...ctx.places, HOME_TOKEN]);
  const workplaces = new Set(workplaceOptions(a));
  const bigFive: number[][] = [];

  out.members.forEach((m, i) => {
    const d = draw.members[i];
    if (!d) return;
    const at = `members[${i}]`;
    const p = portraitById(d.portrait)!;
    // V02 name form.
    const tokens = m.name.trim().split(/\s+/);
    if (tokens.length < 2 || tokens.length > 3 || m.name.length > 28 || tokens.some(t => !NAME_TOKEN.test(t) || TITLES.test(t)))
      errors.push(`V02 ${at}.name "${m.name}" must be 2-3 words of letters, apostrophes or hyphens, at most 28 characters, no titles`);
    // V03 collisions.
    const full = foldName(m.name), first = foldName(tokens[0] ?? ""), family = foldName(tokens.at(-1) ?? "");
    if (fullTaken.has(full)) errors.push(`V03 ${at}.name "${m.name}" is already taken or reserved`);
    if (reserved.has(first)) errors.push(`V03 ${at}.name: the first name "${tokens[0]}" belongs to someone in Monde's story`);
    if ((firstCount.get(first) ?? 0) >= 2) errors.push(`V03 ${at}.name: two living residents are already called ${tokens[0]}`);
    if (reservedFamily.has(family) || familyTaken.has(family)) errors.push(`V03 ${at}.name: the surname "${tokens.at(-1)}" belongs to another household`);
    if (out.members.some((o, j) => j < i && foldName(o.name) === full)) errors.push(`V03 ${at}.name "${m.name}" repeats a household member`);
    // V04 age.
    const [bl, bh] = BAND_AGES[p.band];
    if (!Number.isInteger(m.age) || m.age < Math.max(bl, d.age_min) || m.age > Math.min(bh, d.age_max))
      errors.push(`V04 ${at}.age ${m.age} must be ${Math.max(bl, d.age_min)}-${Math.min(bh, d.age_max)}`);
    // V05 pronouns, and the appearance agreeing with them.
    if (!PRONOUNS.includes(m.pronouns)) errors.push(`V05 ${at}.pronouns "${m.pronouns}"`);
    else if (PRONOUN_WORDS[m.pronouns].test(m.appearance)) errors.push(`V05 ${at}.appearance uses pronouns other than ${m.pronouns}`);
    // V06 appearance.
    if (words(m.appearance) > 40 || sentences(m.appearance) > 2) errors.push(`V06 ${at}.appearance must be 1-2 sentences of at most 40 words`);
    const hairRule = HAIR_FAMILIES.find(([fam]) => fam.test(p.hair_word));
    if (hairRule && hairRule[1].test(m.appearance)) errors.push(`V06 ${at}.appearance contradicts the portrait's ${p.hair_word} hair`);
    if (p.band === "elder" && ELDER_WORDS.test(m.appearance)) errors.push(`V06 ${at}.appearance calls an elder young`);
    if ((p.band === "child" || p.band === "teen") && CHILD_WORDS.test(m.appearance)) errors.push(`V06 ${at}.appearance makes a child sound old`);
    const attire = p.attire.flatMap(t => ATTIRE_WORDS[t] ?? [t.replace(/_/g, " ")]);
    if (!attire.some(w => m.appearance.toLowerCase().includes(w))) errors.push(`V06 ${at}.appearance must mention something the portrait wears (${p.attire.join(", ")})`);
    // V07 lengths.
    m.backstory = fitWords(m.backstory, 120, `${at}.backstory`, errors);
    m.voice.register = fitWords(m.voice.register, 40, `${at}.voice.register`, errors);
    m.dream.text = fitWords(m.dream.text, 25, `${at}.dream.text`, errors);
    m.occupation = fitWords(m.occupation, 12, `${at}.occupation`, errors);
    m.dream.stages = m.dream.stages.map((s, k) => fitWords(s, 18, `${at}.dream.stages[${k}]`, errors));
    m.voice.samples = m.voice.samples.map((s, k) => fitWords(s, 25, `${at}.voice.samples[${k}]`, errors));
    // V08 traits and Big Five.
    if (m.personality.traits.length < 3 || m.personality.traits.length > 5 || m.personality.traits.some(t => /\s/.test(t.trim())))
      errors.push(`V08 ${at}.personality.traits must be 3-5 single words`);
    const b5 = Object.values(m.personality.big5);
    if (b5.some(v => !Number.isInteger(v) || v < 0 || v > 100)) errors.push(`V08 ${at}.personality.big5 values must be integers 0-100`);
    else if (!b5.some(v => v >= 70 || v <= 30)) errors.push(`V08 ${at}.personality.big5 needs one trait at 70+ or 30-`);
    bigFive.push(b5);
    // V09 values.
    const v = m.values;
    const sum = PILLARS.reduce((s, k) => s + v[k], 0);
    if (PILLARS.some(k => !Number.isFinite(v[k]))) errors.push(`V09 ${at}.values must be four numbers`);
    else if (Math.abs(sum - 1) > 0.05) errors.push(`V09 ${at}.values sum to ${sum.toFixed(2)}; they must sum to 1.0`);
    else {
      for (const k of PILLARS) {
        const lo = Math.max(0.05, a.values[k] - 0.2), hi = Math.min(0.6, a.values[k] + 0.2);
        v[k] = Math.min(hi, Math.max(lo, v[k] / sum));
      }
      const s2 = PILLARS.reduce((s, k) => s + v[k], 0);
      for (const k of PILLARS) v[k] = Math.round((v[k] / s2) * 100) / 100;
      const drift = 1 - PILLARS.reduce((s, k) => s + v[k], 0);
      v.prosperity = Math.round((v.prosperity + drift) * 100) / 100;
      if (!PILLARS.some(k => Math.abs(v[k] - a.values[k]) >= 0.05 - 1e-9)) {
        // A.3.7 V09: at least one Pillar moves 0.05 from the default. Nudge it rather than burn a retry.
        const [hiK, loK] = [...PILLARS].sort((x, y) => v[y] - v[x]);
        v[hiK!] = Math.round((v[hiK!] + 0.05) * 100) / 100; v[loK!] = Math.round((v[loK!] - 0.05) * 100) / 100;
        warnings.push(`V09 ${at}.values nudged off the archetype default`);
      }
    }
    // V10 voice.
    const vo = m.voice;
    if (vo.tics.length < 1 || vo.tics.length > 4) errors.push(`V10 ${at}.voice.tics must have 1-4 entries`);
    if (vo.never_says.length < 2 || vo.never_says.length > 6) errors.push(`V10 ${at}.voice.never_says must have 2-6 entries`);
    if (vo.samples.length !== 3) errors.push(`V10 ${at}.voice.samples must have exactly 3 lines`);
    for (const s of vo.samples) {
      const hit = vo.never_says.find(n => n.trim() && s.toLowerCase().includes(n.toLowerCase()));
      if (hit) errors.push(`V10 ${at}.voice.samples uses its own never_says "${hit}"`);
      if (NOT_X_BUT_Y.test(s)) errors.push(`V10 ${at}.voice.samples uses "not X, but Y": "${s}"`);
      if ((s.match(/\?/g) ?? []).length > 1) errors.push(`V10 ${at}.voice.samples has more than one question in "${s}"`);
      if (EMOJI.test(s)) errors.push(`V10 ${at}.voice.samples has an emoji`);
    }
    if (!a.formal && d.band !== "child" && vo.samples.filter(s => CONTRACTION.test(s)).length < 2) errors.push(`V10 ${at}.voice.samples: at least two need a contraction`);
    // V11 lists.
    const n = (list: readonly string[], lo: number, hi: number, field: string) => { if (list.length < lo || list.length > hi) errors.push(`V11 ${at}.${field} must have ${lo}-${hi} entries`); };
    n(m.likes, 3, 5, "likes"); n(m.dislikes, 3, 5, "dislikes"); n(m.fears, 1, 3, "fears"); n(m.chores, 2, 4, "chores");
    const archetypeLikes = a.likes.map(l => l.toLowerCase());
    const matched = m.likes.filter(l => archetypeLikes.some(x => x.includes(l.toLowerCase()) || l.toLowerCase().includes(x))).length;
    // GDD-GAP: V11 asks for two likes from the archetype list or the gift catalog; the catalog lives client-side, so the
    // server checks the archetype list and asks for one.
    if (matched < 1) errors.push(`V11 ${at}.likes: at least one must come from the archetype's list (${a.likes.join("; ")})`);
    if (m.likes.some(l => m.dislikes.some(x => x.toLowerCase() === l.toLowerCase()))) errors.push(`V11 ${at}: an item is in both likes and dislikes`);
    if (m.beliefs.length < 1 || m.beliefs.length > 4) errors.push(`V11 ${at}.beliefs must have 1-4 entries`);
    // V12 dream.
    if (!a.dreams.some(x => x.id === m.dream.template)) errors.push(`V12 ${at}.dream.template "${m.dream.template}" is not one of ${a.dreams.map(x => x.id).join(", ")}`);
    if (m.dream.stages.length !== 3) errors.push(`V12 ${at}.dream.stages must have exactly 3 entries`);
    m.dream.stages.forEach((s, k) => { if (VERB_STOP.has((s.trim().split(/\s+/)[0] ?? "").toLowerCase())) errors.push(`V12 ${at}.dream.stages[${k}] must start with a verb`); });
    const regards = m.dream.stages.flatMap(s => [...s.matchAll(/Regard\s*[≥>]=?\s*(\d+)/g)].map(x => Number(x[1])));
    if (regards.some(r => r < 10 || r > 70)) errors.push(`V12 ${at}.dream.stages: Regard thresholds must be 10-70`);
    // GDD-GAP: V12 wants them ascending, but A.2's own single_parent.d1 runs 25 then 20; a descent is noted, not failed.
    if (regards.some((r, k) => k > 0 && r < regards[k - 1]!)) warnings.push(`V12 ${at}.dream.stages: Regard thresholds descend`);
    // V13 places and routine.
    if (m.workplace !== null && !workplaces.has(m.workplace)) errors.push(`V13 ${at}.workplace "${m.workplace}" is not in the workplace options`);
    for (const day of ["weekday", "weekend"] as const) {
      const list = m.routine[day];
      if (list.length < 5 || list.length > 9) errors.push(`V13 ${at}.routine.${day} has ${list.length} entries; 5-9`);
      let prev = -1, wrapped = false;
      for (const e of list) {
        if (!places.has(e.where)) errors.push(`V13 ${at}.routine.${day}: "${e.where}" is not a place id`);
        const t = /^(\d{1,2}):(\d{2})$/.exec(e.at);
        let min = t ? Number(t[1]) * 60 + Number(t[2]) : NaN;
        if (Number.isFinite(min) && min < prev && !wrapped && min + 1440 <= 26 * 60) { min += 1440; wrapped = true; }
        if (!Number.isFinite(min) || min < prev || min > 26 * 60) errors.push(`V13 ${at}.routine.${day}: "${e.at}" is out of order or past 26:00`);
        else prev = min;
        if (e.do === "work" && e.where !== (m.workplace ?? "") && e.where !== HOME_TOKEN) errors.push(`V13 ${at}.routine.${day}: work at "${e.where}" is not their workplace`);
      }
      if (list.length && (list[0]!.where !== HOME_TOKEN || list.at(-1)!.where !== HOME_TOKEN)) errors.push(`V13 ${at}.routine.${day} must start and end at ${HOME_TOKEN}`);
    }
    // V14 relationships.
    if (m.relationships.length < 1 || m.relationships.length > 3) errors.push(`V14 ${at}.relationships must have 1-3 entries`);
    for (const r of m.relationships) {
      const inside = slots.has(r.id);
      if (!inside && !ctx.residents.has(r.id)) errors.push(`V14 ${at}.relationships: "${r.id}" is not a resident or a household slot`);
      if (r.id === m.slot) errors.push(`V14 ${at}.relationships: a member can't relate to themself`);
      const lim = inside ? 100 : 30;
      if (!Number.isInteger(r.affinity) || !Number.isInteger(r.trust) || Math.abs(r.affinity) > lim || Math.abs(r.trust) > lim)
        errors.push(`V14 ${at}.relationships "${r.id}": affinity and trust must be integers within ±${lim}`);
    }
    // V15 secrets.
    if (m.secrets.length > 2) errors.push(`V15 ${at}.secrets: at most 2`);
    for (const s of m.secrets) {
      if (s.reveal.regard_min < 40 || s.reveal.regard_min > 80) errors.push(`V15 ${at}.secrets: regard_min ${s.reveal.regard_min} must be 40-80`);
      if (BANNED_SECRETS.test(s.text) || CRIME.test(s.text)) errors.push(`V15 ${at}.secrets: "${s.text.slice(0, 40)}…" touches the town's affairs or harm`);
      s.text = fitWords(s.text, 25, `${at}.secrets.text`, errors);
    }
    // V16 banned content, across every text the card carries.
    if (ctx.banned) {
      const texts = [m.name, m.occupation, m.appearance, m.backstory, ...m.beliefs, m.voice.register, ...m.voice.tics, ...m.voice.samples,
        ...m.likes, ...m.dislikes, ...m.fears, m.dream.text, ...m.dream.stages, ...m.chores, ...m.relationships.map(r => r.note), ...m.secrets.map(s => s.text)];
      const groups = new Set(texts.flatMap(t => ctx.banned!(t)));
      if (groups.size) errors.push(`V16 ${at}: banned language (${[...groups].join(", ")})`);
    }
    if (CRIME.test(m.backstory)) errors.push(`V16 ${at}.backstory mentions crime, harm or romance`);
  });
  // V08: household members differ by 15+ on at least two Big Five traits.
  for (let i = 0; i < bigFive.length; i++) for (let j = i + 1; j < bigFive.length; j++) {
    if (bigFive[i]!.filter((v, k) => Math.abs(v - bigFive[j]![k]!) >= 15).length < 2) errors.push(`V08 members[${i}] and members[${j}] have too-similar Big Five scores`);
  }
  if (ctx.banned && ctx.banned(out.household.summary).length) errors.push("V16 household.summary: banned language");
  return errors.length ? { ok: false, errors: [...new Set(errors)].slice(0, 20) } : { ok: true, output: out, warnings };
}

// ── Assembly: the engine's keys (A.3.6 "The engine owns these keys") ─────────

/** snake_case from a name, accents folded (A.3.6: `id`, with `_2` on collision). */
export function residentIdFor(name: string, taken: ReadonlySet<string>): string {
  const base = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "r_$1") || "resident";
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  return id;
}

/** Swap `home.own` for the reserved home in a card (home, workplace and routines). */
export function bindHome(card: PersonaCard, home: string): PersonaCard {
  const swap = (p: string) => (p === HOME_TOKEN ? home : p);
  return {
    ...card, home: swap(card.home), workplace: swap(card.workplace),
    routine: { weekday: card.routine.weekday.map(b => ({ ...b, where: swap(b.where) })), weekend: card.routine.weekend.map(b => ({ ...b, where: swap(b.where) })) },
  };
}

export interface BuiltResident { card: PersonaCard; dream_template: string }

/** The household's PersonaCards (A.3.1 step 7: ids, portrait, sprite, look, home and the household's own ties). */
export function cardsFromHousehold(out: ArrivalHouseholdOutput, draw: HouseholdDraw, taken: ReadonlySet<string>, home = HOME_TOKEN): BuiltResident[] {
  const used = new Set(taken);
  const ids = out.members.map(m => { const id = residentIdFor(m.name, used); used.add(id); return id; });
  const bySlot = new Map(out.members.map((m, i) => [m.slot, ids[i]!]));
  return out.members.map((m, i) => {
    const d = draw.members[i]!;
    const p = portraitById(d.portrait)!;
    const values: Values = { prosperity: m.values.prosperity, safety: m.values.safety, spirit: m.values.spirit, charm: m.values.charm };
    const relationships = m.relationships.flatMap(r => {
      const id = bySlot.get(r.id) ?? r.id;
      return id === ids[i] ? [] : [{ id, affinity: r.affinity, trust: r.trust, tag: r.tag, note: r.note }];
    });
    // Household members always know each other (A.3.4 rule 2): add the kin tie the model left out.
    for (const [slot, id] of bySlot) if (slot !== m.slot && !relationships.some(r => r.id === id)) relationships.push({ id, affinity: 70, trust: 70, tag: "kin", note: "Came over on the same boat." });
    const card: PersonaCard = {
      id: ids[i]!, name: m.name.trim(), age: m.age, pronouns: m.pronouns, kind: "arrival", occupation: m.occupation,
      workplace: m.workplace ?? HOME_TOKEN, home: HOME_TOKEN, portrait: p.id, portrait_expressions: [...PORTRAIT_SET], sprite: ids[i]!,
      appearance: m.appearance, look: structuredClone(p.look), backstory: m.backstory,
      personality: { traits: m.personality.traits.map(t => t.trim()), big5: m.personality.big5 }, values,
      beliefs: m.beliefs.slice(0, 12),
      voice: { register: m.voice.register, tics: m.voice.tics, never_says: m.voice.never_says, samples: m.voice.samples },
      likes: m.likes, dislikes: m.dislikes, fears: m.fears,
      dream: { text: m.dream.text, stages: m.dream.stages },
      routine: { weekday: m.routine.weekday.map(e => ({ at: e.at, do: e.do, where: e.where })), weekend: m.routine.weekend.map(e => ({ at: e.at, do: e.do, where: e.where })) },
      chores: m.chores, relationships, secrets: m.secrets.map(s => ({ text: s.text, reveal: { regard_min: s.reveal.regard_min } })),
      canon_locks: [], story_role: m.story_role,
    };
    return { card: bindHome(PersonaCard.parse(card), home), dream_template: m.dream.template };
  });
}

// ── The template card (A.3.8) ───────────────────────────────────────────────

/** Six Big Five values 17 apart, one per household member (V08). */
const GRID = [8, 25, 42, 59, 76, 93] as const;
const TRAITS = ["steady", "wry", "shy", "warm", "particular", "curious", "stubborn", "patient", "brisk", "dreamy", "practical", "proud", "careful", "cheerful", "restless", "kind"];
const CHORES = ["sweep the step", "wind the clock", "water the window box", "beat the doormat", "mend a sock", "black the stove", "fold the washing", "fill the coal scuttle"];
const CHILD_SAMPLES: readonly [string, string, string] = ["Is that the sea? All of it.", "I'm not tired. I'm resting my eyes.", "Can we go to the ducks? Just for a minute."];
const TEEN_SAMPLES: readonly [string, string, string] = ["It's fine. It's a town. There's a pub. Can't go in it.", "Did you see the lighthouse? It's not even on.", "I'll unpack later. Probably."];
const NEVER_SAYS = ["no worries", "awesome", "okay so", "literally"];

/** A household's names from the banks, through V03 (A.3.8). */
function templateNames(draw: HouseholdDraw, rng: SeededRng, ctx: Pick<ValidationContext, "residents" | "reservedFull">): string[] {
  const living = [...ctx.residents.values()].map(r => r.name);
  const takenFull = new Set([...living.map(foldName), ...(ctx.reservedFull ?? []).map(foldName), ...FAMOUS_NAMES.map(foldName)]);
  const takenFamily = new Set([...living.map(n => foldName(n.split(" ").at(-1) ?? "")), ...RESERVED_FAMILY_NAMES.map(foldName)]);
  const firstUse = new Map<string, number>();
  for (const n of living) { const f = foldName(n.replace(/"[^"]*"\s*/g, "").split(" ")[0] ?? ""); firstUse.set(f, (firstUse.get(f) ?? 0) + 1); }
  const reserved = new Set(RESERVED_FIRST_NAMES.map(foldName));
  const families = FAMILY_NAMES.filter(f => !takenFamily.has(foldName(f)));
  const family = families.length ? rng.pick(families) : `${rng.pick(FAMILY_NAMES)}-${rng.pick(FAMILY_NAMES)}`;
  const chosen: string[] = [];
  for (const m of draw.members) {
    const pool = FIRST_NAMES[m.presentation].filter(f => !reserved.has(foldName(f)) && (firstUse.get(foldName(f)) ?? 0) < 2 && !chosen.some(c => c.startsWith(`${f} `)));
    // A.3.3: partners keep their own surname a third of the time; children and kin take the household's.
    const surname = m.role === "partner" && rng.chance(0.33) && families.length > 1 ? rng.pick(families.filter(f => f !== family)) : family;
    let name = `${rng.pick(pool.length ? pool : FIRST_NAMES[m.presentation])} ${surname}`;
    for (let k = 0; takenFull.has(foldName(name)) && k < 20; k++) name = `${rng.pick(pool)} ${surname}`;
    chosen.push(name);
  }
  return chosen;
}

const t = (at: string, verb: z.infer<typeof Verb>, where: string) => ({ at, do: verb, where });

/** A.3.8: "a routine from the occupation's template". */
function templateRoutine(m: MemberDraw, workplace: string | null, rng: SeededRng): ArrivalMember["routine"] {
  const h = HOME_TOKEN;
  const out = rng.pick(["old_quarter.fountain_square", "commons.duck_pond", "wharf.breakwater", "commons.picnic_lawn"]);
  const evening = rng.pick(["market_row.gull_and_anchor", "market_row.cafe_liss", h]);
  const weekend = [
    t("08:00", "eat", h), t("10:00", "shop", "market_row.market_street"), t("12:30", "eat", "market_row.cafe_liss"),
    t("14:30", "wander", out), t("18:00", "eat", h), t("19:30", evening === h ? "read" : "socialize", evening), t("22:00", "sleep", h),
  ];
  if (m.role === "child") {
    if (m.age < 3) return {
      weekday: [t("07:30", "eat", h), t("10:00", "sit", h), t("12:00", "eat", h), t("13:00", "nap", h), t("19:00", "sleep", h)],
      weekend: [t("08:00", "eat", h), t("10:30", "sit", h), t("12:30", "eat", h), t("13:30", "nap", h), t("19:00", "sleep", h)],
    };
    if (m.age < 5) return {
      weekday: [t("07:30", "eat", h), t("10:00", "walk", "commons.duck_pond"), t("12:00", "eat", h), t("13:00", "nap", h), t("19:00", "sleep", h)],
      weekend: [t("08:00", "eat", h), t("10:30", "walk", "commons.duck_pond"), t("12:30", "eat", h), t("13:30", "nap", h), t("19:00", "sleep", h)],
    };
    if (m.age <= 12) return {
      weekday: [t("07:30", "eat", h), t("08:30", "attend", "millbrook.school"), t("15:30", "wander", out), t("17:30", "eat", h), t("20:00", "sleep", h)],
      weekend: [t("08:00", "eat", h), t("10:00", "wander", "commons.duck_pond"), t("12:30", "eat", h), t("14:00", "wander", out), t("18:00", "eat", h), t("20:30", "sleep", h)],
    };
    return {
      weekday: [t("07:30", "eat", h), t("09:00", "read", "old_quarter.library"), t("13:00", "eat", h), t("15:00", "wander", "market_row.market_street"), t("18:00", "eat", h), t("21:30", "sleep", h)],
      weekend,
    };
  }
  if (!workplace) return {
    weekday: [t("07:30", "eat", h), t("09:30", "walk", out), t("12:00", "eat", h), t("14:00", "sit", "old_quarter.fountain_square"), t("16:00", "shop", "market_row.general_store"), t("18:00", "eat", h), t("19:30", "read", h), t("21:30", "sleep", h)],
    weekend,
  };
  const lunch = workplace === h ? h : "market_row.cafe_liss";
  return {
    weekday: [t("07:00", "eat", h), t("08:30", "work", workplace), t("12:30", "eat", lunch), t("13:30", "work", workplace), t("17:30", "shop", "market_row.general_store"), t("18:30", "eat", h), t("20:00", evening === h ? "read" : "socialize", evening), t("22:00", "sleep", h)],
    weekend,
  };
}

/** A caption without its age words ("of about five", "in her twenties"): the card's own age may differ a little. */
export const agelessCaption = (caption: string): string => caption
  .replace(/\s+(?:of about|about|around) (?:\w+-)?\w+(?= with|,)/g, "")
  .replace(/\s+in (?:her|his|their) (?:early |mid-|late )?\w+ies(?= with|,)/g, "")
  .replace(/\s{2,}/g, " ");

const pronounSet = (p: (typeof PRONOUNS)[number]) => p === "she/her" ? { they: "she", s: "s" } : p === "he/him" ? { they: "he", s: "s" } : { they: "they", s: "" };

/**
 * A.3.8's template household: names from the bank (through V03), ages inside the portrait band, the portrait's caption
 * as the appearance, two authored backstory sentences, the archetype's default values and dream d1, a routine from the
 * occupation's template, no secrets and no ties beyond the household. Same shape as the model's output, so the same
 * assembly turns it into cards (flagged `generated_by: template` by the caller).
 */
export function templateHousehold(draw: HouseholdDraw, ctx: Pick<ValidationContext, "residents" | "reservedFull">, seed: string | number = 0): ArrivalHouseholdOutput {
  const a = ARCHETYPE_BY_ID.get(draw.archetype)!;
  const rng = SeededRng.of(seed, draw.id, "template");
  const names = templateNames(draw, rng, ctx);
  const reason = rng.pick(a.reasons);
  // A reason that names a town says where they came from.
  const from = OUTSIDE_PLACES.find(p => reason.includes(p)) ?? rng.pick(OUTSIDE_PLACES);
  const order = () => [0, 1, 2, 3, 4, 5].sort(() => rng.next() - 0.5);
  const openOrder = order(), extraOrder = order();
  const members = draw.members.map((m, i): ArrivalMember => {
    const p = portraitById(m.portrait)!;
    const first = names[i]!.split(" ")[0]!;
    const { they, s } = pronounSet(m.pronoun_default);
    const adult = m.role !== "child";
    const workplace = adult && m.role !== "grandparent" && m.role !== "adult_child" && a.workplaces.length ? (() => {
      const w = rng.pick(a.workplaces);
      return w === "home" ? HOME_TOKEN : w;
    })() : null;
    const occupation = m.role === "child" ? (m.age < 5 ? "too small for school yet" : m.age <= 12 ? "pupil at Millbrook School" : "lessons by post at the library desk")
      : m.role === "grandparent" ? "retired" : rng.pick(a.occupations);
    const dream = a.dreams[0];
    const big5 = { open: rng.int(25, 80), conscientious: rng.int(25, 80), extravert: rng.int(25, 80), agreeable: rng.int(35, 85), neurotic: rng.int(20, 70) };
    const keys = Object.keys(big5) as (keyof typeof big5)[];
    big5[keys[(i + rng.int(0, 4)) % 5]!] = rng.chance(0.5) ? rng.int(72, 88) : rng.int(12, 28);
    // V08: every two members differ by 15+ on at least two traits: openness and extraversion come off a spaced grid.
    if (draw.members.length > 1) { big5.open = GRID[openOrder[i]!]!; big5.extravert = GRID[extraOrder[i]!]!; }
    // V08: one trait at 70+ or 30- (someone you'd remember).
    if (!Object.values(big5).some(v => v >= 70 || v <= 30)) big5.conscientious = rng.chance(0.5) ? rng.int(72, 88) : rng.int(12, 28);
    const traits = [...TRAITS].sort(() => rng.next() - 0.5).slice(0, 3);
    const samples = m.role === "child" ? (m.age >= 13 ? TEEN_SAMPLES : CHILD_SAMPLES) : a.samples;
    const relationships = draw.members.filter(o => o.slot !== m.slot).slice(0, 3)
      .map(o => ({ id: o.slot, affinity: 70, trust: 70, tag: "kin" as const, note: "Came over on the same boat." }));
    const elsewhere = draw.members.length === 1 ? [{ id: "pell", affinity: 10, trust: 10, tag: "curious" as const, note: "The mayor who met the boat." }] : [];
    return {
      slot: m.slot, name: names[i]!, age: m.age, pronouns: m.pronoun_default, occupation, workplace,
      appearance: agelessCaption(p.caption),
      backstory: m.role === "child"
        ? `${first} came over on the Gannet from ${from} with the family. ${cap(they)} like${s} the sea already and ${m.pronoun_default === "they/them" ? "haven't" : "hasn't"} said so.`
        : i > 0 ? `${first} followed ${names[0]!.split(" ")[0]} to Monde from ${from}, and says it was ${cap(they) === "They" ? "their" : m.pronoun_default === "she/her" ? "her" : "his"} idea all along. ${cap(they)} would like ${dream.text.charAt(0).toLowerCase()}${dream.text.slice(1)}, and ${m.pronoun_default === "they/them" ? "haven't" : "hasn't"} said so.`
        : `${first} came to Monde from ${from} ${reason}. What ${they} want${s} most is plain enough: ${dream.text.charAt(0).toLowerCase()}${dream.text.slice(1)}.`,
      personality: { traits, big5 },
      values: { ...a.values },
      beliefs: [`Monde is quieter than ${from}.`, "Nobody here will remember my name by Friday."],
      voice: { register: m.role === "child" ? "A child's voice: questions, then more questions." : a.voice, tics: [samples[0].split(/(?<=[.!?])/)[0]!.trim()], never_says: NEVER_SAYS.slice(0, 2), samples: [...samples] },
      likes: [...a.likes].slice(0, 3), dislikes: [...a.dislikes].slice(0, 3), fears: [m.role === "child" ? "the dark on the stairs" : "the ferry taking them back"],
      dream: { template: dream.id, text: dream.text, stages: [...dream.stages] },
      routine: templateRoutine(m, workplace, rng),
      chores: [...CHORES].sort(() => rng.next() - 0.5).slice(0, 2),
      relationships: relationships.length ? relationships : elsewhere,
      secrets: [],
      story_role: "none",
    };
  });
  return { household: { same_surname: true, summary: draw.members.length === 1 ? `Came alone from ${from}.` : `A household of ${draw.members.length} from ${from}.` }, members };
}
