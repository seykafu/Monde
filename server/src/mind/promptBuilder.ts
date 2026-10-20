import { containsAnswer, MAX_SESSION_EXCHANGES } from "@monde/shared";
/**
 * The prompt builder (GDD §9.10.1, §9.17; MVP task M-04).
 *
 * Every resident call is four blocks:
 *   1. the World Bible (prompts/world_bible.md): identical for every world and resident, cached;
 *   2. the Persona Card with canon locks evaluated (personaBlock), cached;
 *   3. beliefs, the top relationships and stances (beliefsBlock), cached, rewritten nightly;
 *   4. a dynamic user message (dialogue / plan / reflect / gossip templates), never cached.
 * Blocks 1-3 must be byte-stable or prompt caching silently stops working, so they are built with a fixed
 * field order, sorted collections and nothing that changes turn to turn (no regard, mood, time or topics).
 *
 * Everything here is deterministic: the same inputs and template files always give the same bytes. Templates
 * are read once from disk and cached. The model proposes; the engine disposes (§9.1): nothing built here lets
 * a model touch engine state.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import {
  ANIMAL_VERBS, DialogueTurnOutput, GossipOutput, MVP_FAVOR_TEMPLATES, PlanOutput, ReflectionOutput, VERBS,
  evaluate, gameContext, modelOutputFormat, regardTier,
  type FavorTemplate, type Memory, type PersonaCard, type ResidentState, type TalkQuest, type Verb,
} from "@monde/shared";
import { promptExpressions } from "./expressions.js";
import { addressFor, fellowLine, pronounNote, type FellowView } from "./naming.js";
import { asksWhatToDo, questLines } from "./quest.js";
import { townNowBlock } from "./townState.js";
import { borrowedFor, borrowedLine, phraseKey, type RosterVoice, type Signature } from "./voice.js";

// ---------------------------------------------------------------------------------------------------------------
// API settings (GDD §9.17 "API call settings"; AGENTS.md "Claude API rules")
// ---------------------------------------------------------------------------------------------------------------

export type MindCallKind = "dialogue" | "plan" | "reflect" | "gossip" | "precheck";

export const MIND_MODEL: Anthropic.Model = "claude-haiku-5-5";

/** Model, token cap and reasoning settings for one call kind. Merge with a built request via `apiParams`. */
export interface MindSettings {
  model: Anthropic.Model;
  max_tokens: number;
  thinking?: Anthropic.ThinkingConfigParam;
  output_config?: Anthropic.OutputConfig;
}

/**
 * GDD-GAP: §9.17 gives dialogue no max_tokens. A whole turn (up to 3 lines of 220 characters, 3 choices, effects
 * and JSON keys) measured 331 output tokens p50 and 381 p95 on staging (ai_log, 2026-10-15), and the old cap of 400
 * cut 2 of 19 turns short. 900 is over twice the longest seen; a reply that still hits it is salvaged (salvage.ts).
 * The cap costs nothing unless it's used.
 */
export const DIALOGUE_MAX_TOKENS = 900;

/**
 * Haiku 5.5 rules: no temperature / top_p / top_k (non-default sampling is a 400) and no assistant prefill.
 * Dialogue, gossip and the pre-check run with thinking disabled (valid at the default effort) for latency;
 * plans and reflections keep adaptive thinking at effort "low". Variety comes from persona, memory, topic
 * cards and the whim seed, never from sampling.
 */
export function requestSettings(kind: MindCallKind): MindSettings {
  switch (kind) {
    case "dialogue":
      return { model: MIND_MODEL, max_tokens: DIALOGUE_MAX_TOKENS, thinking: { type: "disabled" } };
    case "gossip":
      return { model: MIND_MODEL, max_tokens: 400, thinking: { type: "disabled" } };
    case "precheck":
      // GDD-GAP: §9.17 gives no max_tokens for the free-text pre-check. Its output is `{ok, category}` (≈20 tokens
      // in the §9.15 cost table); 64 leaves headroom without inviting prose.
      return { model: MIND_MODEL, max_tokens: 64, thinking: { type: "disabled" } };
    case "plan":
    case "reflect":
      // §9.17 (raised from 900 after the 2026-10-19 soak: 900 cut off 26% of plans and 19% of reflections, each paid for
      // and thrown away for the template or the rule fallback).
      return { model: MIND_MODEL, max_tokens: 1500, output_config: { effort: "low" } };
  }
}

/** What every builder returns: ready to spread into `client.messages.stream` / `.create` with `requestSettings`. */
export interface MindRequest {
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  output_config: Anthropic.OutputConfig & { format: Anthropic.JSONOutputFormat };
}

/** The full API body for a call: settings + built request, with `output_config` merged (effort + format). */
export function apiParams(kind: MindCallKind, request: MindRequest): Anthropic.MessageCreateParamsNonStreaming {
  const settings = requestSettings(kind);
  return {
    ...settings,
    system: request.system,
    messages: request.messages,
    output_config: { ...settings.output_config, ...request.output_config },
  };
}

function outputConfig(kind: MindCallKind, schema: z.ZodType): MindRequest["output_config"] {
  return { ...requestSettings(kind).output_config, format: modelOutputFormat(schema) };
}

// ---------------------------------------------------------------------------------------------------------------
// Templates and the prompt version
// ---------------------------------------------------------------------------------------------------------------

const TEMPLATE_NAMES = [
  "world_bible", "persona", "beliefs", "dialogue", "dialogue_hints", "plan", "reflect", "gossip",
] as const;
type TemplateName = (typeof TEMPLATE_NAMES)[number];
type Templates = Readonly<Record<TemplateName, string>>;

/**
 * Bump when the code-side serialization below changes in a way the template files don't show (list formats,
 * field order), so the logged prompt version still changes.
 */
const SERIALIZER_VERSION = "q01.6";

/**
 * Where the templates live. Source runs read them next to this file. The bundled server (tsup → server/dist)
 * resolves `./prompts/` next to the bundle, so the build/deploy must ship this folder there, or set
 * MONDE_PROMPTS_DIR (see the M-04 notes).
 */
export function promptsDirectory(): string {
  const override = process.env.MONDE_PROMPTS_DIR;
  return override ? resolve(override) : fileURLToPath(new URL("./prompts/", import.meta.url));
}

/** Strip a leading `<!-- … -->` authoring comment, normalize line endings, drop trailing whitespace. */
function normalizeTemplate(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/^<!--[\s\S]*?-->\n*/, "").trimEnd();
}

const templateCache = new Map<string, Templates>();
export function loadTemplates(directory = promptsDirectory()): Templates {
  let templates = templateCache.get(directory);
  if (!templates) {
    const loaded = {} as Record<TemplateName, string>;
    for (const name of TEMPLATE_NAMES) loaded[name] = normalizeTemplate(readFileSync(join(directory, `${name}.md`), "utf8"));
    templates = Object.freeze(loaded);
    templateCache.set(directory, templates);
  }
  return templates;
}

/**
 * A short hash of every template (as sent, after the authoring comment is stripped) plus the serializer
 * version. Log it with every model call so outputs can be traced to the prompt that made them.
 */
export function promptVersion(directory = promptsDirectory()): string {
  const templates = loadTemplates(directory);
  const hash = createHash("sha256").update(`serializer:${SERIALIZER_VERSION}\n`);
  for (const name of [...TEMPLATE_NAMES].sort()) hash.update(`\n--- ${name}.md ---\n`).update(templates[name]);
  return hash.digest("hex").slice(0, 12);
}

/** Block 1, exactly as sent. */
export function worldBible(): string {
  return loadTemplates().world_bible;
}

// ---------------------------------------------------------------------------------------------------------------
// Slot filling and escaping
// ---------------------------------------------------------------------------------------------------------------

/** A pre-rendered block (already filled and escaped) that may carry its own tags. */
interface Trusted { readonly trusted: string }
type SlotValue = string | Trusted;
const trusted = (text: string): Trusted => ({ trusted: text });

function isInvisible(code: number): boolean {
  return (code < 0x20 && code !== 0x0a) || code === 0x7f || (code >= 0x200b && code <= 0x200f)
    || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff;
}

/**
 * Make a slot value inert: no tag can be opened or closed (`<` `>` become `‹` `›`), and control or bidi
 * characters are dropped (tabs become spaces). Slot values are never re-scanned for `{{…}}`.
 */
export function escapeSlot(value: string): string {
  let out = "";
  for (const ch of value.replace(/\r\n?/g, "\n").replace(/\t/g, " ")) {
    if (isInvisible(ch.codePointAt(0)!)) continue;
    out += ch === "<" ? "‹" : ch === ">" ? "›" : ch;
  }
  return out;
}

/** Speech from the scene (player text, earlier turns): one line, escaped. */
export function speech(text: string): string {
  return escapeSlot(text).replace(/\s+/g, " ").trim();
}

/** Authored prose from YAML (folded scalars end in newlines): one line, trimmed. */
const prose = (text: string): string => text.replace(/\s+/g, " ").trim();

/** A value the template follows with its own full stop: one line, trailing stops dropped. */
const clause = (text: string): string => prose(text).replace(/[.\s]+$/, "");

/**
 * Fill `{{slot}}` placeholders in one pass. Plain values are escaped; Trusted values are inserted as-is.
 * A placeholder alone on its line is dropped with its line when the value is empty. Missing or unused slots
 * throw, so template and code can't drift apart silently.
 */
export function fillTemplate(template: string, values: Readonly<Record<string, SlotValue>>): string {
  const used = new Set<string>();
  const valueOf = (key: string): string => {
    const value = values[key];
    if (value === undefined) throw new Error(`prompt template slot {{${key}}} has no value`);
    used.add(key);
    return typeof value === "string" ? escapeSlot(value) : value.trusted;
  };
  const out: string[] = [];
  for (const line of template.split("\n")) {
    const alone = /^\s*\{\{(\w+)\}\}\s*$/.exec(line);
    if (alone && valueOf(alone[1]!) === "") continue;
    out.push(line.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => valueOf(key)));
  }
  const unused = Object.keys(values).filter((key) => !used.has(key));
  if (unused.length) throw new Error(`prompt values without a template slot: ${unused.join(", ")}`);
  return out.join("\n");
}

const bullets = (items: readonly string[], empty: string): string =>
  items.length ? items.map((item) => `- ${item}`).join("\n") : empty;
const quoted = (items: readonly string[]): string => items.map((item) => `"${prose(item)}"`).join(", ");
const round = (n: number): number => Math.round(n);

/**
 * A card's tics, quoted, with the ones it saves for leaving marked (`voice.exit_only`, MVP Q-01). `skip`: phrases that
 * aren't the card's to say (a generated card's tic that is a hand-written card's catchphrase, voice.ts).
 */
function ticList(voice: PersonaCard["voice"], skip: readonly Signature[] = []): string {
  const exit = new Set((voice.mode === "narrated_action" ? [] : voice.exit_only ?? []).map(phraseKey));
  const others = new Set(skip.map((s) => phraseKey(s.phrase)));
  const tics = voice.tics.filter((tic) => !others.has(phraseKey(tic)));
  return tics.length ? tics.map((tic) => `"${prose(tic)}"${exit.has(phraseKey(tic)) ? " (only as the conversation ends)" : ""}`).join(", ") : "(none)";
}

function cached(text: string): Anthropic.TextBlockParam {
  return { type: "text", text, cache_control: { type: "ephemeral" } };
}

// ---------------------------------------------------------------------------------------------------------------
// Shared view types (what the engine hands the builder)
// ---------------------------------------------------------------------------------------------------------------

/** A live, directed relationship from the resident to someone else (GDD §9.4). */
export interface RelationshipView {
  id: string;
  affinity: number;
  trust: number;
  tag: string;
  feeling?: { kind: "crush" | "love" | "resentment" | "admiration"; intensity: number } | null;
}

/** World facts that gate canon locks (§9.3): story flags (names without the `flag.` prefix) and the day. */
export interface CanonContext {
  flags: Iterable<string>;
  day: number;
  /** Optional display names by resident id, e.g. { margo: "Marguerite \"Margo\" Liang" }. Must be stable. */
  names?: Readonly<Record<string, string>>;
  /**
   * The world's roster of resident voices, for the never-borrow list of other residents' catchphrases (voice.ts).
   * Must be stable: context.ts loads it sorted, and only hand-written cards own phrases.
   */
  voices?: readonly RosterVoice[];
}

const flagSet = (flags: Iterable<string>): ReadonlySet<string> =>
  new Set([...flags].map((flag) => flag.replace(/^flag\./, "")));

const who = (id: string, names?: Readonly<Record<string, string>>): string =>
  names?.[id] ? `${id} (${prose(names[id]!)})` : id;

// ---------------------------------------------------------------------------------------------------------------
// Block 2: the Persona Card
// ---------------------------------------------------------------------------------------------------------------

/** Canon-lock facts whose `while` holds now. Only `flag.*` and `day` are visible, so the result is stable. */
export function activeCanonLocks(card: PersonaCard, ctx: Pick<CanonContext, "flags" | "day">): string[] {
  const expr = gameContext({ flags: flagSet(ctx.flags), values: { day: ctx.day } });
  return card.canon_locks.filter((lock) => evaluate(lock.while, expr)).map((lock) => prose(lock.fact));
}

const KIND_LINE: Record<PersonaCard["kind"], string> = {
  canon: "Card kind: canon.",
  resident: "Card kind: resident.",
  arrival: "Card kind: arrival.",
  animal: "Card kind: animal. You never speak.",
};

/** A dream written "(hidden) …" is one the resident keeps to themselves. */
function dreamText(card: PersonaCard): string {
  const text = prose(card.dream.text);
  const hidden = /^\(hidden\)\s*/i.exec(text);
  return hidden ? `${text.slice(hidden[0].length)} You tell nobody.` : text;
}

/** Dream stages carry engine conditions in parentheses ("(Favor: …; needs flag.x)"). The model sees the words only. */
function dreamStageText(card: PersonaCard, stage: number): string {
  const text = card.dream.stages[stage];
  return text === undefined ? "every step is done" : prose(text.replace(/\([^)]*\)/g, " "));
}

/**
 * Block 2. Fixed field order, no timestamps, no per-turn values. Secrets are deliberately absent (they are
 * offered per turn via <revealable_secrets>), and so are `story_role` (designer notes about future beats),
 * dream stages (engine conditions), routine (the plan request carries it) and the starting `beliefs` (block 3
 * holds the live ones). Relationship numbers live in block 3 so this block doesn't go stale.
 */
export function personaBlock(card: PersonaCard, ctx: CanonContext): string {
  const voice = card.voice;
  const voiceExtra = voice.mode === "narrated_action"
    ? `Action verbs: ${voice.action_verbs.join(", ")}.\nYou never speak. Each line is one short narrated action.`
    : `Samples, to show your tone only (never repeat one or lift its phrases; say new things):\n${bullets(voice.samples.map(prose), "")}`;
  const big5 = card.personality.big5;
  const values = card.values;
  const borrowed = borrowedFor(card, ctx.voices ?? []);
  return fillTemplate(loadTemplates().persona, {
    id: card.id,
    name: prose(card.name),
    age: String(card.age),
    pronouns: card.pronouns,
    kind: KIND_LINE[card.kind],
    occupation: prose(card.occupation),
    home: card.home,
    workplace: card.workplace,
    appearance: prose(card.appearance),
    backstory: prose(card.backstory),
    traits: card.personality.traits.join(", "),
    temperament: `open ${big5.open}, conscientious ${big5.conscientious}, extravert ${big5.extravert}, `
      + `agreeable ${big5.agreeable}, neurotic ${big5.neurotic}`,
    values: `prosperity ${values.prosperity.toFixed(2)}, safety ${values.safety.toFixed(2)}, `
      + `spirit ${values.spirit.toFixed(2)}, charm ${values.charm.toFixed(2)}`,
    likes: card.likes.map(prose).join("; "),
    dislikes: card.dislikes.map(prose).join("; "),
    fears: card.fears.map(prose).join("; "),
    dream: dreamText(card),
    chores: card.chores.map(prose).join("; "),
    relationships: bullets(card.relationships.map((r) => `${who(r.id, ctx.names)} (${r.tag}): ${prose(r.note)}`), "(none)"),
    register: prose(voice.register),
    // A generated card (MVP M-03) owns no catchphrase: its tics never include one of a hand-written card's.
    tics: ticList(voice, card.generated_by ? borrowed : []),
    never_says: quoted(voice.never_says),
    borrowed: borrowedLine(borrowed),
    voice_extra: voiceExtra,
    expressions: promptExpressions(card).join(", "),
    canon: bullets(activeCanonLocks(card, ctx), "(none right now)"),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Block 3: beliefs, people and stances
// ---------------------------------------------------------------------------------------------------------------

/** Relationships shown in block 3 (GDD §9.10.1: "top 8 relationships as one-liners"). */
export const TOP_RELATIONSHIPS = 8;

/**
 * GDD-GAP: §9.10.1 says "top 8" without saying how they're ranked. Salience here is |affinity| + |trust| +
 * feeling intensity (strong feelings either way matter), ties broken by id so the order is stable.
 */
export function topRelationships(relationships: readonly RelationshipView[], limit = TOP_RELATIONSHIPS): RelationshipView[] {
  const salience = (r: RelationshipView) => Math.abs(r.affinity) + Math.abs(r.trust) + Math.abs(r.feeling?.intensity ?? 0);
  return [...relationships]
    .sort((x, y) => salience(y) - salience(x) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
    .slice(0, limit);
}

function relationshipLine(r: RelationshipView, names?: Readonly<Record<string, string>>): string {
  const feeling = r.feeling && r.feeling.intensity !== 0 ? ` Feeling: ${r.feeling.kind} ${round(r.feeling.intensity)}.` : "";
  return `${who(r.id, names)} (${r.tag}): affinity ${round(r.affinity)}, trust ${round(r.trust)}.${feeling}`;
}

/**
 * Block 3: the live beliefs, the top relationships as one-liners and the stances (all rewritten by the
 * nightly reflection). Input order doesn't matter: relationships are ranked and stances sorted by issue id.
 */
export function beliefsBlock(
  state: Pick<ResidentState, "beliefs" | "stances">,
  relationships: readonly RelationshipView[],
  names?: Readonly<Record<string, string>>,
): string {
  const stances = Object.keys(state.stances).sort().map((issue) => `${issue}: ${round(state.stances[issue]!)}`);
  return fillTemplate(loadTemplates().beliefs, {
    beliefs: bullets(state.beliefs.map(prose), "(none)"),
    people: bullets(topRelationships(relationships).map((r) => relationshipLine(r, names)), "(nobody in particular)"),
    stances: bullets(stances, "(no strong views yet)"),
  });
}

/** Blocks 1-3 with their cache breakpoints, shared by dialogue, plan and reflection (and by a prewarm call). */
export function systemBlocks(
  card: PersonaCard,
  state: Pick<ResidentState, "beliefs" | "stances">,
  relationships: readonly RelationshipView[],
  ctx: CanonContext,
): Anthropic.TextBlockParam[] {
  return [cached(worldBible()), cached(personaBlock(card, ctx)), cached(beliefsBlock(state, relationships, ctx.names))];
}

// ---------------------------------------------------------------------------------------------------------------
// Secrets (GDD §9.3, §12.2 reveal conditions)
// ---------------------------------------------------------------------------------------------------------------

export interface RevealContext {
  /** The player's Regard with this resident. */
  regard: number;
  flags: Iterable<string>;
  day: number;
}

/** Stable id for a card's secret: `<resident>_s<index>` (0-based, card order). The validator checks against it. */
export const secretId = (residentId: string, index: number): string => `${residentId}_s${index}`;

/** Secrets whose reveal condition is met now. A reveal with several keys needs all of them (§12.2). */
export function revealableSecrets(card: PersonaCard, ctx: RevealContext): { id: string; text: string }[] {
  const flags = flagSet(ctx.flags);
  return card.secrets.flatMap((secret, index) => {
    const { regard_min, flag, day } = secret.reveal;
    if (regard_min === undefined && flag === undefined && day === undefined) return [];
    if (regard_min !== undefined && !(ctx.regard >= regard_min)) return [];
    if (flag !== undefined && !flags.has(flag.replace(/^flag\./, ""))) return [];
    if (day !== undefined && !(ctx.day >= day)) return [];
    return [{ id: secretId(card.id, index), text: prose(secret.text) }];
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Riddle hints (GDD §14.2, the AI hint guard)
// ---------------------------------------------------------------------------------------------------------------

/** A riddle topic for one dialogue turn. Only the inscription and the unlocked hints are ever rendered. */
export interface RiddleTopic {
  /** Riddle id, e.g. "OQ-1". */
  id: string;
  inscription: string;
  /** The authored ladder: nudge, narrowing, near-giveaway. */
  hints: readonly string[];
  /** Hint levels the player has unlocked (0-3). */
  allowed: number;
  /** Accepted answers. Never rendered: used only to withhold any hint text that would leak one. */
  accepted?: readonly string[];
}

export { containsAnswer, normalizeAnswerText } from '@monde/shared';

function hintsBlock(riddle: RiddleTopic): string {
  const allowed = Math.max(0, Math.min(riddle.hints.length, Math.floor(riddle.allowed)));
  const safe = (text: string) => !riddle.accepted || !containsAnswer(text, riddle.accepted);
  const hints = riddle.hints.slice(0, allowed).filter(safe).map((hint, i) => `${i + 1}. ${prose(hint)}`);
  const inscription = safe(riddle.inscription)
    ? riddle.inscription.trim().split(/\r?\n/).map((line) => line.trim()).join("\n")
    : "(you can't recall the words)";
  return fillTemplate(loadTemplates().dialogue_hints, {
    allowed: String(allowed),
    riddle_id: riddle.id,
    inscription,
    hints: hints.length ? hints.join("\n") : "(none yet: you have nothing to offer but the plaque itself)",
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Small formatters
// ---------------------------------------------------------------------------------------------------------------

/** Season by day (GDD §3.2: four seasons of 25 days). */
export function seasonOf(day: number): "spring" | "summer" | "autumn" | "winter" {
  if (day <= 25) return "spring";
  if (day <= 50) return "summer";
  if (day <= 75) return "autumn";
  return "winter";
}

/** Minutes since midnight → "HH:MM"; the day runs to 26:00 (§5.3). */
export function clockTime(minute: number): string {
  const m = Math.max(0, Math.floor(minute));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function memoryLine(m: Memory): string {
  return `Day ${m.day}, ${clockTime(m.minute)}, at ${m.where} (${m.kind}): ${prose(m.text)}`;
}

const DIALOGUE_MEMORIES = 8; // §9.6: the top 8 go into dialogue prompts
const REFLECTION_MEMORIES = 12; // §9.6: the top 12 into reflections

// ---------------------------------------------------------------------------------------------------------------
// Dialogue (block 4)
// ---------------------------------------------------------------------------------------------------------------

export interface PlayerView {
  name: string;
  pronouns: string;
  /** Background and anything else the engine shares, e.g. "Homecomer. Came to help." */
  background: string;
  /** A childhood detail the engine supplies for Homecomers (§12.1 generated-resident rule 11). */
  sharedPast?: string | null;
}

export interface SceneView {
  day: number;
  /** The engine owns the calendar. */
  weekday: string;
  /** Minutes since midnight. */
  minute: number;
  place: string;
  placeDescription?: string | null;
  weather: string;
}

export interface OpenFavorView {
  /** Resident id who asked. */
  owner: string;
  template: FavorTemplate;
  target: string;
  text: string;
}

export interface ConversationTurn {
  speaker: "resident" | "player";
  text: string;
}

export interface DialogueInput {
  card: PersonaCard;
  state: ResidentState;
  relationships: readonly RelationshipView[];
  /** World story flags (names, no `flag.` prefix). */
  flags: Iterable<string>;
  names?: Readonly<Record<string, string>>;
  /** The world's voice roster (CanonContext.voices), so blocks 1-3 match across dialogue, plan and reflection. */
  voices?: readonly RosterVoice[];
  scene: SceneView;
  /** The resident's current plan block, e.g. "work at market_row.bakery". */
  doing?: string | null;
  player: PlayerView;
  /** Retrieved memories, best first; the top 8 are used. */
  memories: readonly Memory[];
  /** The engine's topic cards (usually 3). */
  topics: readonly string[];
  openFavors?: readonly OpenFavorView[];
  riddle?: RiddleTopic | null;
  conversation?: readonly ConversationTurn[];
  sessionHistory?: string;
  sessionSystem?: Anthropic.TextBlockParam[];
  earlierTurns?: readonly { user: string; assistant: string }[];
  resumedAfter?: number;
  /** Free text or the chosen reply. */
  playerSaid: string;
  /**
   * What this turn has to answer (turnFocus). Defaults to "open" when the Fellow walked up (playerSaid is
   * WALK_UP) and to "reply" otherwise.
   */
  focus?: TurnFocus;
  /** A random word from the whim list (§9.17) for variety. */
  whimSeed?: string | null;
  /**
   * The player's objective and this resident's open threads, as the client reported them (quest.ts). Only block 4
   * ever carries any of it, and only for a resident it involves or when the Fellow asks what to do.
   */
  quest?: TalkQuest | null;
  /** Pronouns by resident id, for the people the quest line names (block 4 only; blocks 1-3 never read it). */
  pronouns?: Readonly<Record<string, string>>;
  /**
   * They have talked before, for how the resident addresses the Fellow (naming.ts). Defaults to: there is a history
   * with the Fellow, or this conversation was resumed.
   */
  met?: boolean;
}

/** What `<player_said>` holds when the Fellow walks up rather than speaks. */
export const WALK_UP = "(walks up to you)";

/**
 * What this turn is answering, which decides the one-line directive under `<player_said>` and whether the topic
 * cards are offered:
 *   open   the Fellow walked up: open the conversation (topic cards offered)
 *   reply  they said something or picked a reply: respond to it first (no topic cards)
 *   lull   their line gives little to answer ("Right.", "Hm."): respond, then pick up a thread (topic cards offered)
 *   bye    they're leaving: see them off
 *   gift   the engine describes a gift or a shared meal: react to it
 *   quest  they picked "What should I be doing?" (intent about_quest): help with directions from <quest> (quest.ts)
 */
export type TurnFocus = "open" | "reply" | "lull" | "bye" | "gift" | "quest";

const BYE_WORDS = /\b(?:good ?bye|bye|farewell|see you|take care|so long|get going|be going|be off|head off|heading off|must go|should go|have to go|got to go|let you get on|leave you to it)\b/i;
const LULL_LINE = /^(?:ok(?:ay)?|right|hm+|mm+(?:-hm)?|ah|oh|yes|yeah|no|sure|fine|alright|all right|i see|cool|nice|huh|fair enough|well|indeed|go on)[\s.!,]*$/i;

/** Classify the Fellow's words (null when they walked up). Pure, so the fallback can use it too. */
export function turnFocus(text: string | null | undefined, intent?: string | null): TurnFocus {
  if (text == null || text.trim() === "" || text === WALK_UP) return "open";
  if (intent === "leave" || (BYE_WORDS.test(text) && !text.includes("?"))) return "bye";
  if (intent === "about_quest") return "quest";
  if (LULL_LINE.test(text.trim())) return "lull";
  return "reply";
}

/** The line under `<player_said>`: what to do with it, first. */
export const FOCUS_DIRECTIVES: Readonly<Record<TurnFocus, string>> = {
  open: "The Fellow has just walked up to you. Open the conversation: a remark about something in front of you or one of the topics below.",
  reply: "Respond to this first: answer what the Fellow asked, react to what they told you, or follow on from the reply they picked. Add something of your own after that only if it comes naturally. Anything you bring back from earlier, keep as it was said; don't add details to it.",
  lull: "Respond to this first. It gives you little to answer, so then pick up a thread from this conversation or one of the topics below.",
  bye: "Respond to this first: the Fellow is taking their leave. See them off in a line or two and set wrap_up to true.",
  gift: "Respond to this first: react to it in your own way.",
  quest: "Respond to this first: the Fellow is asking what to do next. Help them concretely from the notes from their Journal below (where to go, when, and who is expecting them), in your own words and your own voice. Add no appointment, event or time the notes don't give.",
};

/**
 * The `<quest>` element for block 4 (quest.ts decides the lines), or "" (the template drops the line). Client text,
 * so every line is escaped; it sits with the other background, below the Fellow's words and the memories.
 */
export function questBlock(
  quest: TalkQuest | null | undefined, card: PersonaCard, focus: TurnFocus, playerSaid: string,
  where: { place?: string; names?: Readonly<Record<string, string>>; pronouns?: Readonly<Record<string, string>> } = {},
): string {
  // The Fellow's own words: a reply they typed or picked, or a lull. Never the walk-up or the engine's gift line.
  const asked = (focus === "reply" || focus === "lull") && asksWhatToDo(playerSaid);
  const here = !!where.place && where.place === quest?.objective?.place;
  const person = (id: string) => where.names?.[id] && where.pronouns?.[id] ? { name: where.names[id]!, pronouns: where.pronouns[id]! } : null;
  const lines = questLines(quest, card, { asked, intent: focus === "quest", here, person });
  return lines.length
    ? `<quest> From the Fellow's Journal (background: use it to help them; never add to it):\n${bullets(lines.map(speech), "")}\n</quest>`
    : "";
}

/**
 * Earlier conversations with the Fellow, as the resident remembers them (sessions.ts historyFor). Framed as their own
 * memory: without it the model read the summaries as hearsay ("I heard that from Bru") about things the Fellow had told
 * them in person (eval 2026-10-17). The prewarm (dialogue.ts prewarmParams) sends the same bytes, so the cache matches.
 */
export function historyBlock(history: string): string {
  const text = speech(history).trim();
  return text
    ? `<history_with_player>\nYour own memory of earlier conversations with the Fellow. What the Fellow said there, they said to you in person.\n${text}\n</history_with_player>`
    : `<history_with_player>\n</history_with_player>`;
}

export function dialogueMessages(input: DialogueInput, user: string): Anthropic.MessageParam[] {
  const history = historyBlock(input.sessionHistory ?? '');
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: history }];
  for (const turn of (input.earlierTurns ?? []).slice(0, MAX_SESSION_EXCHANGES)) {
    messages.push({ role: 'user', content: turn.user }, { role: 'assistant', content: turn.assistant });
  }
  // The moving breakpoint does not alter the text bytes of any earlier turn.
  const last = messages.at(-1)!;
  last.content = [{ type: 'text', text: last.content as string, cache_control: { type: 'ephemeral' } }];
  messages.push({ role: 'user', content: `${input.resumedAfter !== undefined ? `<resumed after_minutes="${input.resumedAfter}"/>\n` : ''}${user}` });
  return messages;
}

export function buildDialogueRequest(input: DialogueInput): MindRequest {
  const { card, state, scene, player } = input;
  const flags = [...input.flags];
  const ctx: CanonContext = { flags, day: scene.day, names: input.names, voices: input.voices };
  const secrets = revealableSecrets(card, { regard: state.regard, flags, day: scene.day });
  const playerName = speech(player.name);
  const met = input.met ?? ((input.sessionHistory ?? "").trim() !== "" || input.resumedAfter !== undefined);
  const address = addressFor({ residentId: card.id, playerName, pronouns: player.pronouns, regard: state.regard, met });
  const wanted = input.focus ?? (input.playerSaid === WALK_UP ? "open" : "reply");
  // An about_quest reply with no quest report (a scripted scene's handoff) is answered like any other reply.
  const focus: TurnFocus = wanted === "quest" && !input.quest ? "reply" : wanted;
  // Topic cards invite a change of subject, so they're offered only when there's nothing to answer (§9.10).
  const offerTopics = focus === "open" || focus === "lull";
  const topics = offerTopics
    ? trusted(`<topics_to_choose_from>\n${bullets(input.topics.map((t) => escapeSlot(prose(t))), "(whatever is in front of you)")}\n</topics_to_choose_from>`)
    : "";

  const favors = (input.openFavors ?? []).map((f) =>
    `${f.owner === card.id ? "yours" : who(f.owner, input.names)}: ${f.template} (${f.target}): ${prose(f.text)}`);
  const user = fillTemplate(loadTemplates().dialogue, {
    day: String(scene.day),
    weekday: scene.weekday,
    season: seasonOf(scene.day),
    time: clockTime(scene.minute),
    place: scene.placeDescription ? `${scene.place} (${prose(scene.placeDescription)})` : scene.place,
    weather: clause(scene.weather),
    emotion: state.mood.emotion,
    intensity: String(round(state.mood.intensity)),
    energy: String(round(state.mood.energy)),
    stress: String(round(state.mood.stress)),
    doing: input.doing ? clause(input.doing) : "nothing in particular",
    player_name: playerName,
    player_pronouns: speech(pronounNote(player.pronouns)),
    town_now: trusted(townNowBlock(flags)),
    quest: trusted(questBlock(input.quest, card, focus, input.playerSaid, { place: scene.place, names: input.names, pronouns: input.pronouns })),
    regard_tier: regardTier(state.regard),
    player_background: clause(player.background),
    address: address.line,
    shared_past: player.sharedPast ? `Shared past you may recall: ${prose(player.sharedPast)}` : "",
    memories: bullets(input.memories.slice(0, DIALOGUE_MEMORIES).map(memoryLine), "(nothing comes to mind)"),
    topics,
    already_discussed: state.recent_topics.length ? state.recent_topics.map(prose).join(", ") : "(nothing yet)",
    open_favors: bullets(favors, "(none)"),
    revealable_secrets: bullets(secrets.map((s) => `${s.id}: ${s.text}`), "(none: keep everything to yourself)"),
    hints: input.riddle ? trusted(hintsBlock(input.riddle)) : "",
    player_said: speech(input.playerSaid),
    focus: FOCUS_DIRECTIVES[focus],
    whim: input.whimSeed ? `Whim seed, if it fits: ${speech(input.whimSeed)}` : "",
    resident_name: prose(card.name),
    reply_note: focus === "open" ? "" : ", answering the Fellow first",
  });
  return {
    system: input.sessionSystem?.map(b => ({ type: 'text', text: b.text, cache_control: { type: 'ephemeral' } })) ?? systemBlocks(card, state, input.relationships, ctx),
    messages: dialogueMessages(input, user),
    output_config: outputConfig("dialogue", DialogueTurnOutput),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Plan (block 4)
// ---------------------------------------------------------------------------------------------------------------

export interface PlanInput {
  card: PersonaCard;
  state: ResidentState;
  relationships: readonly RelationshipView[];
  flags: Iterable<string>;
  names?: Readonly<Record<string, string>>;
  /** The world's voice roster (CanonContext.voices), so blocks 1-3 match across dialogue, plan and reflection. */
  voices?: readonly RosterVoice[];
  /** Today (the evening the plan is made): blocks 1-3 match today's dialogue cache. Tomorrow is day + 1. */
  day: number;
  tomorrowWeekday: string;
  forecast: string;
  /** Scheduled town events tomorrow, one line each. */
  events: readonly string[];
  intentions: readonly string[];
  openPlaces: readonly { id: string; hours?: string | null }[];
  /** Who the Fellow is (the Fellowship form), so a bark or a plan to find them gets their pronouns right. */
  fellow?: FellowView | null;
}

const isWeekend = (weekday: string): boolean => /^(sat|sun)/i.test(weekday.trim());

/** Verbs a plan may use. Animals get their subset, limited to what PlanOutput's verb enum accepts. */
function planVerbs(card: PersonaCard): readonly Verb[] {
  if (card.kind !== "animal") return VERBS;
  // GDD-GAP: Bastien's "follow" and "beg" (§9.7) aren't in the PlanOutput verb enum, so they're left out here.
  return VERBS.filter((verb) => (ANIMAL_VERBS as readonly string[]).includes(verb));
}

export function buildPlanRequest(input: PlanInput): MindRequest {
  const { card, state } = input;
  const ctx: CanonContext = { flags: [...input.flags], day: input.day, names: input.names, voices: input.voices };
  const weekend = isWeekend(input.tomorrowWeekday);
  const routine = (weekend ? card.routine.weekend : card.routine.weekday).map((block) =>
    `${block.at} ${block.do} at ${block.where}${block.with?.length ? ` with ${block.with.join(", ")}` : ""}`);
  const needs = state.needs;
  const user = fillTemplate(loadTemplates().plan, {
    resident_name: prose(card.name),
    day: String(input.day + 1),
    weekday: input.tomorrowWeekday,
    season: seasonOf(input.day + 1),
    routine_kind: weekend ? "weekend" : "weekday",
    routine: bullets(routine, "(none)"),
    needs: `rest ${round(needs.rest)}, food ${round(needs.food)}, social ${round(needs.social)}, `
      + `purpose ${round(needs.purpose)}, comfort ${round(needs.comfort)}`,
    forecast: clause(input.forecast),
    events: bullets(input.events.map(prose), "(nothing scheduled)"),
    intentions: bullets(input.intentions.map(prose), "(none)"),
    places: bullets(input.openPlaces.map((p) => (p.hours ? `${p.id} (${prose(p.hours)})` : p.id)), "(none)"),
    verbs: planVerbs(card).join(", "),
    town_now: trusted(townNowBlock(input.flags)),
    fellow: input.fellow ? fellowLine(input.fellow) : "",
  });
  return {
    system: systemBlocks(card, state, input.relationships, ctx),
    messages: [{ role: "user", content: user }],
    output_config: outputConfig("plan", PlanOutput),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reflect (block 4)
// ---------------------------------------------------------------------------------------------------------------

export interface TownFacts {
  pillars: { prosperity: number; safety: number; spirit: number; charm: number };
  census: number;
  /** Today's notable town events, one line each. */
  events: readonly string[];
}

export interface ReflectInput {
  card: PersonaCard;
  state: ResidentState;
  relationships: readonly RelationshipView[];
  flags: Iterable<string>;
  names?: Readonly<Record<string, string>>;
  /** The world's voice roster (CanonContext.voices), so blocks 1-3 match across dialogue, plan and reflection. */
  voices?: readonly RosterVoice[];
  day: number;
  /** Today's memories, best first; the top 12 are used. */
  memoriesToday: readonly Memory[];
  town: TownFacts;
  /**
   * Favor templates the reflection may propose. Defaults to the MVP set minus `last_chance`, whose framing is
   * engine-authored (§9.9) and which the engine triggers itself.
   */
  favorTemplates?: readonly FavorTemplate[];
  /** Who the Fellow is (the Fellowship form), so beliefs, the diary and letters get their pronouns right. */
  fellow?: FellowView | null;
}

export function buildReflectRequest(input: ReflectInput): MindRequest {
  const { card, state, town } = input;
  const ctx: CanonContext = { flags: [...input.flags], day: input.day, names: input.names, voices: input.voices };
  const templates = input.favorTemplates ?? MVP_FAVOR_TEMPLATES.filter((t) => t !== "last_chance");
  const p = town.pillars;
  const townText = [
    `Prosperity ${round(p.prosperity)}, safety ${round(p.safety)}, spirit ${round(p.spirit)}, charm ${round(p.charm)} (0-100). Census ${round(town.census)}.`,
    "Today in town:",
    bullets(town.events.map(prose), "(nothing of note)"),
  ].join("\n");
  const user = fillTemplate(loadTemplates().reflect, {
    day: String(input.day),
    resident_name: prose(card.name),
    memories: bullets(input.memoriesToday.slice(0, REFLECTION_MEMORIES).map(memoryLine), "(a quiet day)"),
    emotion: state.mood.emotion,
    valence: String(round(state.mood.valence)),
    energy: String(round(state.mood.energy)),
    stress: String(round(state.mood.stress)),
    regard: String(round(state.regard)),
    regard_tier: regardTier(state.regard),
    dream: dreamText(card),
    dream_stage: dreamStageText(card, state.dream.stage),
    dream_notes: state.dream.notes ? prose(state.dream.notes) : "(none)",
    town: townText,
    town_now: trusted(townNowBlock(input.flags)),
    fellow: input.fellow ? fellowLine(input.fellow) : "",
    favor_templates: templates.join(", "),
  });
  return {
    system: systemBlocks(card, state, input.relationships, ctx),
    messages: [{ role: "user", content: user }],
    output_config: outputConfig("reflect", ReflectionOutput),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Gossip (block 4)
// ---------------------------------------------------------------------------------------------------------------

export interface GossipSide {
  card: PersonaCard;
  /** How this resident sees the other one, or null if they have no relationship yet. */
  view: RelationshipView | null;
  /** What this resident knows that the other might not. */
  news: readonly { id: string; text: string }[];
}

export interface GossipInput {
  a: GossipSide;
  b: GossipSide;
  flags: Iterable<string>;
  names?: Readonly<Record<string, string>>;
  day: number;
  weekday: string;
  minute: number;
  place: string;
  /** "live" writes lines (player in earshot); "summary" returns only effects (§9.11). */
  mode: "live" | "summary";
  /** Who the Fellow is (the Fellowship form), for a line that mentions them. */
  fellow?: FellowView | null;
}

/** A compact sketch for two-resident calls: identity, voice and live canon only (no secrets, no backstory). */
export function gossipSketch(card: PersonaCard, ctx: CanonContext): string {
  const voice = card.voice;
  const style = voice.mode === "narrated_action"
    ? `Action verbs: ${voice.action_verbs.join(", ")}. Never speaks: lines are short narrated actions.`
    : `Sample: "${prose(voice.samples[0] ?? "")}"`;
  return [
    `${prose(card.name)}, ${card.age}, ${card.pronouns}. ${prose(card.occupation)}. ${KIND_LINE[card.kind]}`,
    `Voice: ${prose(voice.register)}`,
    `Tics: ${ticList(voice)}. Never says: ${quoted(voice.never_says)}.`,
    style,
    "Canon (never contradict):",
    bullets(activeCanonLocks(card, ctx), "(none right now)"),
  ].join("\n");
}

export function buildGossipRequest(input: GossipInput): MindRequest {
  const ctx: CanonContext = { flags: [...input.flags], day: input.day, names: input.names };
  const view = (r: RelationshipView | null) => (r ? relationshipLine(r, input.names) : "(they barely know each other)");
  const news = (items: GossipSide["news"]) => bullets(items.map((n) => `[${n.id}] ${prose(n.text)}`), "(nothing new)");
  const user = fillTemplate(loadTemplates().gossip, {
    mode: input.mode,
    a_id: input.a.card.id,
    b_id: input.b.card.id,
    a_name: prose(input.a.card.name),
    b_name: prose(input.b.card.name),
    place: input.place,
    time: clockTime(input.minute),
    day: String(input.day),
    weekday: input.weekday,
    a_sketch: gossipSketch(input.a.card, ctx),
    b_sketch: gossipSketch(input.b.card, ctx),
    a_to_b: view(input.a.view),
    b_to_a: view(input.b.view),
    a_news: news(input.a.news),
    b_news: news(input.b.news),
    town_now: trusted(townNowBlock(input.flags)),
    fellow: input.fellow ? fellowLine(input.fellow) : "",
  });
  return {
    // Two residents, so no single persona prefix: the World Bible is the cached block (§9.15 cost table).
    system: [cached(worldBible())],
    messages: [{ role: "user", content: user }],
    output_config: outputConfig("gossip", GossipOutput),
  };
}
