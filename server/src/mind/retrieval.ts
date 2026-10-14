/**
 * Memory retrieval and topic cards for a dialogue turn (GDD §9.6, §9.10 "Novelty and anti-repetition").
 * Pure functions: context.ts loads the rows, these rank them.
 */
import { memoryScore, zoneOf, type Memory } from "@monde/shared";

/** §9.6: the top 8 go into dialogue prompts. */
export const DIALOGUE_MEMORY_COUNT = 8;
/** §9.6: memories below importance 3 that are older than 20 days are archived and never retrieved. */
const ARCHIVE_IMPORTANCE = 3;
const ARCHIVE_AGE_DAYS = 20;

const STOPWORDS = new Set((
  "about above after again against also among another anyone anything around away back because been before being "
  + "below between both came come could does doing down during each even ever every from further gets give going "
  + "gone good have having here into just know like look made make many more most much must near never next none "
  + "nothing once only other over own quite really right said same says should since some something still such "
  + "take than that their them then there these they thing think this those though through till today told too "
  + "took under until upon very want wants was well went were what when where which while will with without "
  + "would yeah year years your yours fellow player"
).split(" "));

/** Content words (≥ 4 letters, not stopwords), lowercased: the "quoted nouns" of §9.6 without a tagger. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.toLowerCase().replace(/[’']s\b/g, "").split(/[^\p{L}\p{N}]+/u)) {
    if (word.length >= 4 && !STOPWORDS.has(word)) out.add(word);
  }
  return out;
}

/** What the current turn is about. */
export interface RetrievalContext {
  today: number;
  /** "player", plus resident ids the player's words mention. */
  who: ReadonlySet<string>;
  place: string;
  /** Words and tags from the player's input, the resident's activity and the riddle, lowercased. */
  terms: ReadonlySet<string>;
}

/** A memory plus the tags of its source event, if any. */
export interface MemoryCandidate {
  memory: Memory;
  tags: readonly string[];
}

/**
 * GDD-GAP: §9.6 defines relevance only as "overlap of {who, where, issue tags, quoted nouns} with the current
 * context, 0..1". Here it is the mean of four parts, each 0..1:
 *   who    1 if the memory involves anyone in the context (the player is always in it)
 *   where  1 for the same place, 0.5 for the same zone
 *   tags   1 if any source-event tag is a context term
 *   nouns  shared content words, 2 or more scores 1
 */
export function relevance(candidate: MemoryCandidate, ctx: RetrievalContext): number {
  const { memory } = candidate;
  const who = memory.who.some((id) => ctx.who.has(id)) ? 1 : 0;
  const where = memory.where === ctx.place ? 1 : zoneOf(memory.where) === zoneOf(ctx.place) ? 0.5 : 0;
  const tags = candidate.tags.some((tag) => ctx.terms.has(tag.toLowerCase())) ? 1 : 0;
  let shared = 0;
  for (const word of contentWords(memory.text)) if (ctx.terms.has(word)) shared++;
  const nouns = Math.min(1, shared / 2);
  return (who + where + tags + nouns) / 4;
}

export const isArchived = (memory: Pick<Memory, "importance" | "day">, today: number): boolean =>
  memory.importance < ARCHIVE_IMPORTANCE && today - memory.day > ARCHIVE_AGE_DAYS;

/** The §9.6 score for every live memory, best first (ties: newer first, then id), top `limit`. */
export function retrieveMemories(candidates: readonly MemoryCandidate[], ctx: RetrievalContext, limit = DIALOGUE_MEMORY_COUNT): Memory[] {
  return candidates
    .filter((c) => !isArchived(c.memory, ctx.today))
    .map((c) => ({ memory: c.memory, score: memoryScore(c.memory, relevance(c, ctx), ctx.today) }))
    .sort((a, b) => b.score - a.score || b.memory.day - a.memory.day || b.memory.minute - a.memory.minute
      || (a.memory.id < b.memory.id ? -1 : a.memory.id > b.memory.id ? 1 : 0))
    .slice(0, limit)
    .map((s) => s.memory);
}

// ---------------------------------------------------------------------------------------------------------------
// Topic cards
// ---------------------------------------------------------------------------------------------------------------

/** §9.10: the engine gives each conversation 3 candidate topics. */
export const TOPIC_COUNT = 3;
/** The brief: topic cards come from recent memories of importance 4 or more. */
const TOPIC_MEMORY_IMPORTANCE = 4;
/** GDD-GAP: "recent" isn't defined for topic cards; the last 3 in-game days keeps them current. */
const TOPIC_MEMORY_DAYS = 3;

export type TopicSource = "memory" | "favor" | "event" | "dream" | "scene";

export interface TopicInput {
  today: number;
  place: string;
  memories: readonly Memory[];
  /** The resident's own open favors (proposed or open). */
  favors: readonly { text: string }[];
  /** The card's dream text. A dream written "(hidden) …" is skipped: the resident tells nobody. */
  dream: string;
  /** Today's town events. */
  events: readonly { summary: string; where: string; importance: number }[];
  weather: string;
  activity?: string | null;
  /** The resident's last 10 topics with the player (already discussed). */
  recentTopics: readonly string[];
}

interface Candidate { source: TopicSource; text: string; score: number }

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * GDD-GAP: §9.10 lists the sources (recent memories, unresolved feelings, open Favors, the day's events, the
 * dream) but not how they're scored. Heuristic, documented so it can be tuned:
 *   memory  importance (≥ 4) + 2 if from today, + 1 if yesterday              text: the memory
 *   favor   7 (the resident is waiting on it)                                 text: "your favor: …"
 *   event   importance, + 2 at this place, + 1 in this zone                   text: the event summary
 *   dream   3                                                                  text: "your dream: …"
 *   scene   1 (fillers: the weather, what they're doing)
 * A candidate that repeats an already-discussed topic loses 5. The best candidate of each source is taken
 * first (in score order) so the three cards differ in kind, then the rest fill by score.
 */
export function topicCards(input: TopicInput): string[] {
  const candidates: Candidate[] = [];
  for (const m of input.memories) {
    const age = input.today - m.day;
    if (m.importance >= TOPIC_MEMORY_IMPORTANCE && age >= 0 && age < TOPIC_MEMORY_DAYS) {
      candidates.push({ source: "memory", text: oneLine(m.text), score: m.importance + (age === 0 ? 2 : age === 1 ? 1 : 0) });
    }
  }
  for (const f of input.favors) candidates.push({ source: "favor", text: `your favor: ${oneLine(f.text)}`, score: 7 });
  for (const e of input.events) {
    const near = e.where === input.place ? 2 : zoneOf(e.where) === zoneOf(input.place) ? 1 : 0;
    candidates.push({ source: "event", text: oneLine(e.summary), score: e.importance + near });
  }
  const dream = oneLine(input.dream);
  if (dream && !/^\(hidden\)/i.test(dream)) candidates.push({ source: "dream", text: `your dream: ${dream}`, score: 3 });
  candidates.push({ source: "scene", text: `the weather: ${oneLine(input.weather)}`, score: 1 });
  if (input.activity) candidates.push({ source: "scene", text: `what you're doing: ${oneLine(input.activity)}`, score: 1 });

  const discussed = input.recentTopics.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 3);
  for (const c of candidates) {
    const lower = c.text.toLowerCase();
    if (discussed.some((topic) => lower.includes(topic))) c.score -= 5;
  }
  const ranked = candidates
    .map((c, order) => ({ ...c, order }))
    .sort((a, b) => b.score - a.score || a.order - b.order);
  const picked: typeof ranked = [];
  const seenSources = new Set<TopicSource>();
  for (const c of ranked) {
    if (picked.length < TOPIC_COUNT && !seenSources.has(c.source)) { picked.push(c); seenSources.add(c.source); }
  }
  for (const c of ranked) {
    if (picked.length < TOPIC_COUNT && !picked.includes(c)) picked.push(c);
  }
  const texts: string[] = [];
  for (const c of picked) if (!texts.includes(c.text)) texts.push(c.text);
  return texts;
}
