// Quest-aware conversations (Kasey's playtest, 2026-10-18): key characters help the player find the main story.
//
// With every live turn the dialogue panel reports the player's objective (the HUD's Next hint: the story's, else a
// Project opening today) and this resident's open threads with the Fellow (shared TalkQuest). The server decides what
// the resident hears (server/src/mind/quest.ts), always in block 4. Nothing here goes past what the HUD, the Journal or
// the Ledger already shows: the hint's where, when and reason; a Favor's own words; a Project's next step; and, for a
// Mark, only that there is one (no title, no inscription: hints stay behind the hint guard).
//
// The panel also offers one authored reply, "What should I be doing?" or "About the clocktower…" (intent about_quest),
// with a key character the objective involves, or with any key character when nothing is waiting today; at most once a
// conversation. Quiet Mode answers it from the Journal's words (questQuietLine).
//
// Pure: no Phaser, no registry. mind/questSources.ts gathers the inputs from the running game.
import {
  QUEST_TEXT_MAX, QUEST_THREADS_MAX, isKeyCharacter, questInvolvement,
  type Favor, type PersonaCard, type QuestObjective, type QuestThread, type TalkQuest
} from '@monde/shared';
import { formatClock } from '../sim/clock';
import type { StoryHint } from '../story/hint';
import type { TalkChoice } from './types';

/** The quest reply's id (the server takes ids of up to 8 characters). */
export const QUEST_REPLY_ID = 'quest';

/** Who can help with a Mark in conversation (the panel's "About <Mark>…" reply, DialogueScene). */
export const MARK_HELPERS: ReadonlySet<string> = new Set(['margo', 'bertrand', 'tib']);

/**
 * The quest reply for an objective that involves the resident, by scene: the words the Next hint already uses.
 * A Project opening is "About the fountain…"; anything else is "What's next?".
 */
export const QUEST_REPLIES: Readonly<Record<string, string>> = {
  s01a_ferry: 'About the ferry…',
  s01b_walk: 'About the walk up…',
  s01c_cottage: 'About the cottage…',
  s02_marks: 'About the Marks log…',
  s03_tolls: 'About the bakery…',
  s04_water_again: 'About the fountain…',
  s05_first_arrival: 'About the ferry…',
  s05b_empty_boat: 'About the ferry…',
  s06_good_coat: 'About the man in the good coat…',
  s07a_chime_runs: 'About the clocktower…',
  s07b_chime_loan: 'About the clocktower…',
  s08_option: 'About the town records…',
  s09_pell_confession: 'About the Option…',
  s10a_bloom_open: 'About the Bloom Fair…',
  s10b_bloom_close: 'About the Bloom Fair…'
};
const NO_OBJECTIVE_REPLY = 'What should I be doing?';
const OTHER_REPLY = "What's next?";

/** Cut to `max` characters at a word, with an ellipsis. */
export function cut(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[\s,;:]+$/, '')}…`;
}

/** "this morning", "this afternoon", "this evening", "tonight" for a window's start (minutes since midnight). */
export function dayPart(minute: number): string {
  if (minute < 12 * 60) return 'this morning';
  if (minute < 17 * 60) return 'this afternoon';
  if (minute < 21 * 60) return 'this evening';
  return 'tonight';
}

/** "this afternoon (16:00–17:45)", or "now (until 11:30)" once the window is open. */
export function questWhen(hint: Pick<StoryHint, 'open' | 'start' | 'end'>): string {
  return hint.open ? `now (until ${formatClock(hint.end)})` : `${dayPart(hint.start)} (${formatClock(hint.start)}–${formatClock(hint.end)})`;
}

/** The place as the resident would name it: "Clocktower" here, "Fountain Square, Old Quarter" from another district. */
export function questWhere(hint: Pick<StoryHint, 'where' | 'placeName' | 'zoneName'>): string {
  return hint.where === hint.placeName ? hint.placeName : `${hint.placeName}, ${hint.zoneName}`;
}

const RESIDENT_ID = /^[a-z][a-z0-9_]*$/;

/** The objective for the server, from the Next hint and who it involves (the scene's cast, the Project's leads). */
export function questObjective(hint: StoryHint | null | undefined, people: readonly string[]): QuestObjective | null {
  if (!hint) return null;
  return {
    id: hint.sceneId.slice(0, 48),
    place: hint.place,
    where: cut(questWhere(hint), 80),
    when: cut(questWhen(hint), 60),
    reason: cut(hint.reason, 120),
    people: [...new Set(people)].filter(id => RESIDENT_ID.test(id)).slice(0, 10)
  };
}

/** The Ledger's next step without its key prompts: "(E, 10 Stamina an hour)", "(H near them)". */
export function stripKeyHints(text: string): string {
  return text.replace(/\s*\([^()]*\b(?:E|H|L|Tab)\b[^()]*\)/g, '').replace(/\s+([.,;:])/g, '$1').replace(/\s+/g, ' ').trim();
}

export interface ThreadSources {
  day: number;
  /** The Journal's Favors. */
  favors: readonly Pick<Favor, 'resident_id' | 'status' | 'text' | 'expires_day'>[];
  /** Projects begun and not yet open, with their leads and the Ledger's next step. */
  projects: readonly { name: string; leads: readonly string[]; next: string }[];
  /** The Fellow has a found, unsolved Mark selected in the Marks log (the "About <Mark>…" reply's condition). */
  openMark: boolean;
}

/** This resident's open threads with the Fellow: a Favor they asked, a Project they lead, a Mark they can help with. */
export function questThreads(residentId: string, s: ThreadSources): QuestThread[] {
  const out: QuestThread[] = [];
  const favor = s.favors.find(f => f.resident_id === residentId && f.status === 'accepted' && f.expires_day >= s.day && f.text.trim());
  if (favor) out.push({ kind: 'favor', text: cut(favor.text, QUEST_TEXT_MAX), until: Math.max(1, Math.floor(favor.expires_day)) });
  const project = s.projects.find(p => p.leads.includes(residentId) && stripKeyHints(p.next));
  if (project) out.push({ kind: 'project', name: cut(project.name, 60), next: cut(stripKeyHints(project.next), QUEST_TEXT_MAX) });
  if (s.openMark && MARK_HELPERS.has(residentId)) out.push({ kind: 'mark' });
  return out.slice(0, QUEST_THREADS_MAX);
}

/** The talk context's quest for this resident, or null for the cat (who never speaks). */
export function questContext(card: Pick<PersonaCard, 'kind'>, objective: QuestObjective | null, threads: readonly QuestThread[]): TalkQuest | null {
  if (card.kind === 'animal') return null;
  return { objective, threads: threads.slice(0, QUEST_THREADS_MAX) };
}

type QuestCard = Pick<PersonaCard, 'id' | 'kind' | 'generated_by' | 'curated' | 'home' | 'workplace'>;

/**
 * The one authored quest reply, or null: a key character only, once a conversation (`used`); for an objective that
 * involves them ("About the clocktower…"), or when nothing is waiting on the Fellow today ("What should I be
 * doing?"). With an objective elsewhere the HUD already says where to go, so there's no reply.
 */
export function questReply(card: QuestCard, quest: TalkQuest | null | undefined, used: boolean): TalkChoice | null {
  if (used || !quest || !isKeyCharacter(card)) return null;
  const objective = quest.objective;
  if (!objective) return { id: QUEST_REPLY_ID, text: NO_OBJECTIVE_REPLY, intent: 'about_quest' };
  if (!questInvolvement(objective, card)) return null;
  // A Project opening's reason is "The fountain opens." (projects/attach.ts; questSources.ts writes it the same way).
  const opening = objective.id.startsWith('project:') ? /^(.+?) opens?\.?$/i.exec(objective.reason)?.[1] : undefined;
  const text = QUEST_REPLIES[objective.id] ?? (opening ? `About ${opening.charAt(0).toLowerCase()}${opening.slice(1)}…` : OTHER_REPLY);
  return { id: QUEST_REPLY_ID, text: cut(text, 90), intent: 'about_quest' };
}

/** Quiet Mode's written answer to the quest reply: the Journal's words, in a plain voice. */
export function questQuietLine(quest: TalkQuest | null | undefined): string {
  const objective = quest?.objective;
  // Not the hint's reason: it names people in the third person ("Bertrand is at the clocktower.").
  if (objective) return cut(`If I were you, I'd be at ${objective.where}, ${objective.when}.`, 220);
  const project = quest?.threads.find(t => t.kind === 'project');
  if (project?.kind === 'project') return cut(`My Project could use you: ${project.name}. ${project.next}`, 220);
  return 'Nothing pressing that I know of. Have a wander and say hello to people.';
}
