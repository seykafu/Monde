// The Journal's Quests page as data (Kasey's playtest, 2026-10-18: "a quest log … for the main character to use as
// guidance"). Pure: no Phaser, no DOM. quests/runtime.ts fills the input; scenes/QuestPages.ts draws it.
//
//   Main story   the objective (who, where, when, how to get there, why), or between beats the next beat and a
//                suggestion for now; the last few beats done, ticked.
//   Projects     each Town Project under way: its site and the Ledger's next step.
//   Favors       the Favors the player took on: the task, where, by when; and who has one to ask.
//   Dreams       each dream the player knows: the resident, the dream in their words, the stages done (ticked), and
//                the next one: what it is and what it waits for.
import type { DreamProgress, Favor } from '@monde/shared';
import { currentStageFavor, gateHolds, type DreamRules, type DreamWorld, type Gate } from './dreams';
import type { FavorThread, Objectives, ProjectThread } from './objective';

export interface BeatLine { id: string; title: string }

export interface DreamStep {
  /** The stage's words: "Stand beside him at the back door on a Saturday". */
  words: string;
  /** What it waits for, or what to do: "Barney has a Favor to ask: talk to him." */
  how: string;
  /** Something the player can do about it now. */
  actionable: boolean;
  /** Where to go for it (the Favor's place, else the resident's), if anywhere. */
  place: string | null;
}

export interface DreamView {
  resident: string;
  name: string;
  /** The dream in the resident's words. */
  dream: string;
  total: number;
  /** Stages done. */
  stage: number;
  complete: boolean;
  /** Stages done, ticked: their words and the day. */
  done: { words: string; day: number }[];
  next: DreamStep | null;
}

export interface QuestLog {
  objectives: Objectives;
  /** The last few beats done, oldest first. */
  beats: BeatLine[];
  projects: ProjectThread[];
  /** Taken on (accepted), soonest due first. */
  favors: FavorThread[];
  /** Asked of the player and not yet answered. */
  offers: FavorThread[];
  /** Known dreams: unfinished first (by the day learned), finished last. */
  dreams: DreamView[];
}

/** How many done beats the page lists. */
export const BEATS_SHOWN = 3;

/** "S01b · The Walk" → "The Walk"; "S07 · Quarter Chime (variant A: …)" → "Quarter Chime". */
export const beatTitle = (title: string): string => title.replace(/^S\d+[a-z]?\s*·\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim();

export interface DreamNames {
  /** "Odile", "Captain Reyes". */
  name(id: string): string;
  /** "the Bakery" for `market_row.bakery`. */
  placeName(place: string): string;
  /** Where a resident is usually found (their workplace, else home). */
  placeOf(id: string): string | null;
  projectName(id: string): string;
}

const ARRIVAL_WORDS: Readonly<Record<string, string>> = { cook_baker: 'a baker or a cook' };

/** One gate the player hasn't met, in words ("Waits " + this). */
export function gateText(g: Gate, w: DreamWorld, names: DreamNames, dreamer: string): string {
  switch (g.kind) {
    case 'regard': return g.who === dreamer
      ? `until ${names.name(g.who)} trusts you more (Regard ${g.min}; now ${Math.round(w.regard(g.who))})`
      : `until ${names.name(g.who)} trusts you more (Regard ${g.min} with them; now ${Math.round(w.regard(g.who))})`;
    case 'flag': return 'for something later in the story';
    case 'project': return `until the ${names.projectName(g.project)} Project is ${g.done ? 'open' : 'under way'}`;
    case 'scuffles': return g.won === 1 ? 'until you win a fair Scuffle against Rook at the quarry' : `until you win ${g.won} fair Scuffles against Rook at the quarry`;
    case 'arrival': return g.archetypes.length ? `until ${g.archetypes.map(a => ARRIVAL_WORDS[a] ?? `a newcomer (${a.replaceAll('_', ' ')})`).join(' or ')} comes to live in Monde` : 'until the right newcomer comes to live in Monde';
  }
}

/** A known dream's next stage: what it is and what it waits for. */
export function dreamNextStep(rules: DreamRules, p: DreamProgress, w: DreamWorld, names: DreamNames,
  favors: readonly Pick<Favor, 'status' | 'expires_day' | 'reward' | 'task'>[]): DreamStep | null {
  const rule = rules.stages[p.stage];
  if (!rule) return null;
  const who = names.name(rules.resident), home = names.placeOf(rules.resident);
  const unmet = rule.gates.filter(g => !gateHolds(g, w)).map(g => gateText(g, w, names, rules.resident));
  if (rule.deed === 'signal' && !unmet.length) return { words: rule.words, how: 'This one comes with the story: watch for it.', actionable: false, place: null };
  if (unmet.length) return { words: rule.words, how: `Waits ${unmet.join(', and ')}.`, actionable: false, place: null };
  if (rule.deed !== 'favor') return { words: rule.words, how: 'Nearly there.', actionable: false, place: home };
  const f = currentStageFavor(rules, p.stage, favors, w.day);
  if (f?.status === 'accepted') {
    const where = names.placeName(f.task.place);
    return { words: rule.words, how: `You said you'd help: half an hour at ${where} (E there), by Day ${f.expires_day}.`, actionable: true, place: f.task.place };
  }
  if (f) return { words: rule.words, how: `${who} has a Favor to ask: talk to them${home ? ` (${names.placeName(home)})` : ''}.`, actionable: true, place: home };
  return { words: rule.words, how: `${who} will ask for your help with it soon.`, actionable: false, place: home };
}

export interface QuestLogInput {
  objectives: Objectives;
  /** Scenes done, in calendar order, with their titles. */
  beats: readonly BeatLine[];
  projects: readonly ProjectThread[];
  favors: readonly FavorThread[];
  dreams: Readonly<Record<string, DreamProgress>>;
  rules(resident: string): DreamRules | undefined;
  world: DreamWorld;
  names: DreamNames;
  favorBook: readonly Pick<Favor, 'status' | 'expires_day' | 'reward' | 'task'>[];
}

/** The Quests page. */
export function questLog(input: QuestLogInput): QuestLog {
  const dreams: DreamView[] = Object.entries(input.dreams).flatMap(([resident, p]) => {
    const rules = input.rules(resident);
    if (!rules) return [];
    const total = rules.stages.length, complete = p.stage >= total;
    return [{
      resident, name: input.names.name(resident), dream: rules.text, total, stage: Math.min(p.stage, total), complete,
      done: p.done.map(d => ({ words: rules.stages[d.stage]?.words ?? '', day: d.day })),
      next: complete ? null : dreamNextStep(rules, p, input.world, input.names, input.favorBook),
      learned: p.learned
    }];
  }).sort((a, b) => Number(a.complete) - Number(b.complete) || a.learned - b.learned || a.name.localeCompare(b.name))
    .map(({ learned: _learned, ...view }) => view);
  return {
    objectives: input.objectives,
    beats: input.beats.slice(-BEATS_SHOWN),
    projects: [...input.projects],
    favors: input.favors.filter(f => f.status === 'accepted').sort((a, b) => a.by - b.by),
    offers: input.favors.filter(f => f.status === 'proposed'),
    dreams
  };
}
