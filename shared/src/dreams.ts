import { z } from "zod";
import { instantiateFavor, type Favor, type FavorWorld } from "./favorEngine";
import type { FavorRequest } from "./favor";
import type { PersonaCard } from "./persona";

// Dreams as the player works on them (GDD §9.3 `dream`, §9.9, Appendix A.2; Kasey's playtest 2026-10-18: "we need side
// quests"). Every card's dream has stages; a stage's engine condition is written in a trailing parenthetical, in the
// A.2 / §12 conventions:
//   (Regard ≥ N)                  the dreamer's Regard toward the player
//   (Regard ≥ N with X)           the player's Regard with X (A.2: "Thresholds read (Regard ≥ N with X)")
//   (Favor) (Favor: …) (Favors)   a Favor the stage spawns (§9.9: "each stage can spawn a Favor")
//   (needs flag.x [and …])        a story flag that must be set first
//   (sets flag.x) (leads to flag.x)  the flag the stage stands for (the story's, or the dream's own to set)
//   (Project x) (Project x done)  a Town Project under way, or open
//   (needs one fair Scuffle won)  Rook's quarry track (§7: "a fair fight")
//   (an arrival with the 'a' or 'b' archetype)  a newcomer of that kind living in Monde
// several of them separated by `;`. Anything else in the parenthetical is a designer's note. A stage with nothing the
// engine can check (most Day-1 cards write plain sentences) is worked as a Favor (`fallback`).
//
// One source of truth: the client's dream engine (client/src/quests/dreams.ts), the server's Favor restore and the
// `dream_stage` mirror (server/src/mind/favorFeasibility.ts, eventIngestion.ts) and the prompt's stage words
// (promptBuilder's dreamStageText strips the same parenthetical) all read stages through this file.

export type StageClause =
  /** `with`: the name as written ("Kasimir"); null is the dreamer. */
  | { kind: "regard"; min: number; with: string | null }
  /** `ask`: what the Favor clause says ("bring Kasimir"), null for a bare "(Favor)". */
  | { kind: "favor"; ask: string | null }
  | { kind: "needs"; flag: string }
  | { kind: "signal"; flag: string }
  | { kind: "project"; project: string; done: boolean }
  | { kind: "scuffles"; won: number }
  /** The archetype tags as written ('baker', 'cook'). */
  | { kind: "arrival"; tags: string[] }
  | { kind: "note"; text: string };

export interface ParsedStage {
  /** The stage as the card writes it. */
  text: string;
  /** The words without the parenthetical: what the Journal shows and the prompt reads. */
  words: string;
  clauses: StageClause[];
  /** Nothing in the stage the engine can check: it is worked as a Favor. */
  fallback: boolean;
}

const PAREN = /\s*\(([^()]*)\)\s*\.?\s*$/;
const NUMBERS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const REGARD = /^Regard\s*(?:≥|>=)\s*(\d+)(?:\s+with\s+(.+?))?\.?$/i;
const SCUFFLES = /^(one|two|three|four|five|\d+)\s+fair\s+Scuffles?\s+won$/i;
const FLAG = /^flag\.([a-z][a-z0-9_]*)/;

/** A stage's words, its parenthetical (the engine's conditions) left out. */
export const stageWords = (text: string): string => text.replace(PAREN, "").trim().replace(/\.$/, "");

/** "(hidden) …": the resident tells nobody (promptBuilder.ts dreamText). The Journal learns it at its first stage. */
export const isHiddenDream = (dreamText: string): boolean => /^\(hidden\)/i.test(dreamText.trim());
/** The dream in the resident's words, without the "(hidden)" marker. */
export const dreamWords = (dreamText: string): string => dreamText.trim().replace(/^\(hidden\)\s*/i, "");

function conditionPart(part: string): StageClause | null {
  const regard = REGARD.exec(part);
  if (regard) return { kind: "regard", min: Number(regard[1]), with: regard[2] && !/^(the )?player$/i.test(regard[2]) ? regard[2].trim() : null };
  const scuffles = SCUFFLES.exec(part);
  if (scuffles) return { kind: "scuffles", won: NUMBERS[scuffles[1]!.toLowerCase()] ?? Number(scuffles[1]) };
  const flag = FLAG.exec(part);
  if (flag) return { kind: "needs", flag: flag[1]! };
  return null;
}

function clausesOf(part: string): StageClause[] {
  const p = part.trim();
  if (!p) return [];
  if (/\bFavors?\b/.test(p)) {
    const ask = /\bFavors?\s*:\s*(.+)$/.exec(p)?.[1]?.trim() ?? null;
    return [{ kind: "favor", ask: ask || null }];
  }
  const signal = /^(?:sets|leads to)\s+flag\.([a-z][a-z0-9_]*)/i.exec(p);
  if (signal) return [{ kind: "signal", flag: signal[1]! }];
  const project = /^Project\s+([a-z][a-z0-9_]*)(\s+done)?$/i.exec(p);
  if (project) return [{ kind: "project", project: project[1]!, done: !!project[2] }];
  const arrival = /^an arrival with the (.+?) archetype/i.exec(p);
  if (arrival) {
    const tags = [...arrival[1]!.matchAll(/'([^']+)'/g)].map(m => m[1]!.toLowerCase());
    const rest = p.slice(arrival[0].length).replace(/^[\s,]+/, "");
    return [{ kind: "arrival", tags }, ...(rest ? [{ kind: "note" as const, text: rest }] : [])];
  }
  if (/^needs\s+/i.test(p)) {
    const subs = p.replace(/^needs\s+/i, "").split(/\s+and\s+/i).map(s => s.trim());
    return subs.map(s => conditionPart(s) ?? { kind: "note" as const, text: `needs ${s}` });
  }
  // "Regard ≥ 60, three fair Scuffles won": every comma part a condition, or the whole part is a note.
  const commas = p.split(/,\s*/).map(s => s.trim());
  const parsed = commas.map(s => (FLAG.test(s) ? null : conditionPart(s)));
  if (parsed.every(Boolean)) return parsed as StageClause[];
  return [{ kind: "note", text: p }];
}

/** One stage's conditions, read from its trailing parenthetical. */
export function parseDreamStage(text: string): ParsedStage {
  const inner = PAREN.exec(text)?.[1] ?? "";
  const clauses = inner.split(";").flatMap(clausesOf);
  return { text, words: stageWords(text), clauses, fallback: !clauses.some(c => c.kind !== "note") };
}

/** Every stage of a card's dream. */
export const dreamStages = (card: Pick<PersonaCard, "dream">): ParsedStage[] => card.dream.stages.map(parseDreamStage);

// ── The resident's mirror (ResidentState.dream.stage, §9.4) ─────────────────────────────────────────────────────

/** How many stages are done once `completed` of `total` are: the server's `dream.stage` is the next stage's index. */
export const clampDreamStage = (completed: number, total: number): number => Math.max(0, Math.min(total, Math.floor(completed)));

// ── The Favor a stage spawns (§9.9) ─────────────────────────────────────────────────────────────────────────────

/**
 * A stage's Favor: `dream_<resident>_<stage>_<window>`, one per stage per five-day window, as Quiet Mode's chores are
 * (client/src/friendship/favors.ts localTemplateFavors), so the server can rebuild it from its id and the day it was
 * offered (server/src/mind/favorFeasibility.ts restoreDreamFavor). `stage` is the 0-based index.
 */
export const DREAM_FAVOR_DAYS = 5;
export const dreamFavorId = (resident: string, stage: number, offeredDay: number): string =>
  `dream_${resident}_${stage}_${Math.floor((offeredDay - 1) / DREAM_FAVOR_DAYS)}`;
/** The stage a dream Favor's id names for this resident, or null when it isn't one of theirs. */
export function dreamFavorStage(resident: string, favorId: string): number | null {
  const prefix = `dream_${resident}_`;
  if (!favorId.startsWith(prefix)) return null;
  const m = /^(\d+)_(\d+)$/.exec(favorId.slice(prefix.length));
  return m ? Number(m[1]) : null;
}
/** `Favor.reward.dream`: which stage the Favor advances (§9.9 "dream-stage progress"). */
export const dreamRewardTag = (resident: string, stage: number): string => `${resident}#${stage}`;

/**
 * GDD-GAP: the MVP's Favor templates (MVP_PLAN §4.1: fetch, deliver, find, introduce, help_chore) have nothing for
 * "be there at eleven" or "walk him to the Wharf", and an `introduce` needs the two to stand together at the moment
 * the player speaks. Every stage's Favor is the always-completable `help_chore`: half an hour at the resident's place.
 * The request is spoken in the resident's own voice (DialogueScene shows it as their line), so it doesn't quote the
 * stage, which the cards write in the third person; the Journal shows the stage beside it.
 */
const ASKS = [
  "There's something I've wanted for a long while. Could you give me half an hour at mine?",
  "Would you lend me half an hour? It's for something I keep putting off.",
  "Could you help me with something? It matters to me more than I let on."
] as const;

/** The FavorRequest for a stage of `card`'s dream. */
export function dreamFavorRequest(card: Pick<PersonaCard, "id">, stage: number): FavorRequest {
  let h = stage;
  for (const ch of card.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { template: "help_chore", target: card.id, text: ASKS[h % ASKS.length]! };
}

/** The stage's Favor, instantiated by the engine (shared instantiateFavor) with its dream tag; null when infeasible. */
export function dreamFavor(card: Pick<PersonaCard, "id">, stage: number, offeredDay: number, world: FavorWorld): Favor | null {
  const f = instantiateFavor(dreamFavorRequest(card, stage), dreamFavorId(card.id, stage, offeredDay), card.id, world);
  return f ? { ...f, reward: { ...f.reward, dream: dreamRewardTag(card.id, stage) } } : null;
}

// ── The save (SaveGame.quests) ──────────────────────────────────────────────────────────────────────────────────

const day = z.number().int().positive();
export const DreamProgress = z.object({
  /** The day the player learned the dream, and how (§9.9 / client/src/quests/dreams.ts LearnedBy). */
  learned: day, how: z.enum(["regard", "story", "stage"]),
  /** Stages done so far (the next stage's index). */
  stage: z.number().int().nonnegative(),
  /** Each stage done: when, and what did it ("story": the town got there first). `printed`: in the Lantern on that day. */
  done: z.array(z.object({ stage: z.number().int().nonnegative(), day, by: z.enum(["favor", "regard", "gates", "story"]), printed: day.nullable().default(null) })),
});
export type DreamProgress = z.infer<typeof DreamProgress>;

/**
 * Kasey's playtest (2026-10-18): the Journal's Quests page and the HUD's objective line (client/src/quests). Optional
 * on read (a save from before it knows no dreams), so it needs no version bump.
 */
export const SavedQuests = z.object({
  dreams: z.record(z.string(), DreamProgress).default({}),
  /** The first-steps card after S01c has been shown in this game. */
  first_steps: z.boolean().default(false),
});
export type SavedQuests = z.infer<typeof SavedQuests>;
export const emptyQuests = (): SavedQuests => ({ dreams: {}, first_steps: false });
