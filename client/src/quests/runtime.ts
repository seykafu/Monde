// The Journal's Quests in the running game (Kasey's playtest, 2026-10-18): the dreams checked against the registry,
// the objective, and the Quest Log's data. The pure rules are quests/dreams.ts, objective.ts and questLog.ts; this file
// reads the game's state for them and writes back what a dream stage does:
//   - attachQuestsClock (once per clock, beside the Projects' dawn): the dreams are checked at dawn, before the dawn
//     sync (so the morning's Favors and the Lantern have them), and within a game minute of anything that could move
//     one (a conversation's Regard, a Favor done, a flag, a Project, a Scuffle, a newcomer);
//   - a stage done: Regard as a scripted cue (`dream` / `<resident>:<stage>`, shown at once, applied once by the
//     server), the dream's own flags, a `dream_stage` event (ResidentState.dream.stage, §9.4), a toast, and a line in
//     the next morning's Lantern (quests/paper.ts);
//   - a stage that is a Favor: the resident offers it (shared dreamFavor), in Quiet Mode too.
// Works offline: every check is the client's; the events wait in the log until the server can take them.
import type Phaser from 'phaser';
import {
  FLAG_PATTERNS, SPRING_RIDDLES, dreamFavor, dreamFavorId, livingArrivals, registryFromContent,
  type CompiledScene, type DreamProgress, type Favor, type PersonaCard, type SavedScuffles
} from '@monde/shared';
import flagsYaml from '../../../content/flags.yaml?raw';
import { favorBook, localFavorWorld } from '../friendship/favors';
import { scriptedRegard } from '../mind/events';
import { PROJECTS } from '../projects/catalog';
import * as E from '../projects/engine';
import { flagsOf, materialCount, projectName, projectsOf, residentName, siteFor, sitePlaceName, worldOf } from '../projects/runtime';
import { storySession } from '../puzzles/runtime';
import { appendEvent } from '../scenes/events';
import { getFriendship, regardMap, townNames, updateFriendship } from '../scenes/friendship';
import { marks } from '../scenes/riddles';
import type { Clock } from '../sim/clock';
import { storyHint, upcomingBeat, zoneRoute, type StoryHint } from '../story/hint';
import { ALL_SCENES } from '../story/session';
import { TOWN_FLAGS, type TownState } from '../town/pillars';
import { isFerryDay } from '../town/migration';
import { placeName } from '../world/player';
import { allCards, findCard } from '../world/roster';
import { zones } from '../world/zones';
import { checkDreams, dreamRules, dueDreamFavors, type DreamCheck, type DreamRules, type DreamWorld, type RuleContext } from './dreams';
import { objectives, type DreamThread, type FavorThread, type Objective, type Objectives, type ProjectThread } from './objective';
import { beatTitle, dreamNextStep, questLog, type DreamNames, type QuestLog } from './questLog';
import { OBJECTIVE_KEY, getQuests, updateQuests } from './state';

type Registry = Phaser.Data.DataManager;
interface Now { day: number; minute: number }

// ── Rules ───────────────────────────────────────────────────────────────────

const DECLARED = registryFromContent({ flagsYaml, residentYamls: [] }).flags;
/**
 * The flags something other than a dream sets: every scene (its `set`s and header), the town engine, the Projects'
 * completions, the Marks' rewards, the puzzles (puzzles/runtime.ts completePuzzle: PZ-02 fixes the ovens, PZ-15 runs
 * the clock) and the dawn's courtships. A dream waits for these; it sets only flags nothing else does.
 */
let storyFlags: Set<string> | null = null;
const PUZZLE_FLAGS = ['bakery_ovens_fixed', 'clock_running', 'pinion_fitted', 'project_footbridge_done'];
/** Set by the Marks when the third Charter fragment is recovered (scenes/riddles.ts). */
const MARK_FLAGS = ['charter_half'];
function storyWritten(): Set<string> {
  if (storyFlags) return storyFlags;
  storyFlags = new Set<string>([...TOWN_FLAGS, ...PUZZLE_FLAGS, ...MARK_FLAGS]);
  for (const s of ALL_SCENES) for (const f of [...(s.refs?.flagsWritten ?? []), ...(s.header?.sets ?? [])]) storyFlags.add(f);
  for (const p of PROJECTS) for (const f of p.complete.flags) storyFlags.add(f);
  for (const r of SPRING_RIDDLES) for (const f of r.rewards.flags) storyFlags.add(f);
  return storyFlags;
}
export function flagOwner(flag: string): ReturnType<RuleContext['owner']> {
  if (storyWritten().has(flag) || /^project_[a-z0-9_]+_(done|started)$/.test(flag) || /^pz\d+_solved$/.test(flag) || /_dating$/.test(flag)) return 'story';
  return DECLARED.has(flag) || FLAG_PATTERNS.some(p => p.test(flag)) ? 'dream' : 'unknown';
}

/** "Kasimir" → kasimir: by id, first name or town name; the hand-written cast win a shared first name. */
let nameIndex: Map<string, string> | null = null;
let indexedCards = 0;
function resolveName(name: string): string | null {
  const cards = allCards();
  if (!nameIndex || indexedCards !== cards.length) {
    nameIndex = new Map();
    indexedCards = cards.length;
    const names = townNames();
    for (const c of [...cards].reverse()) {
      for (const key of [c.id, c.name.split(' ')[0]!, names[c.id] ?? '']) if (key) nameIndex.set(key.toLowerCase(), c.id);
    }
  }
  return nameIndex.get(name.trim().toLowerCase().replace(/^(the|a|an)\s+/, '')) ?? null;
}

const RULE_CONTEXT: RuleContext = { resolve: resolveName, owner: flagOwner };
const ruleCache = new Map<string, DreamRules>();
/**
 * GDD-GAP: the cat never speaks (§9.10 Bastien) and a child under five asks nobody for a Favor (qa/springBot.ts
 * auditSpring), so neither has a dream the player can learn or work on.
 */
export const hasPlayableDream = (card: Pick<PersonaCard, 'kind' | 'employment'>): boolean => card.kind !== 'animal' && card.employment !== 'under_five';
export function rulesFor(id: string): DreamRules | undefined {
  const cached = ruleCache.get(id);
  if (cached) return cached;
  const card = findCard(id);
  if (!card || !hasPlayableDream(card)) return undefined;
  const rules = dreamRules(card, RULE_CONTEXT);
  ruleCache.set(id, rules);
  return rules;
}
/** Every resident's dream rules (the roster now: the cast, the census, the newcomers). */
export const allRules = (): DreamRules[] => allCards().flatMap(c => { const r = rulesFor(c.id); return r ? [r] : []; });

// ── The world ───────────────────────────────────────────────────────────────

const townOf = (r: Registry): TownState | undefined => r.get('monde.town') as TownState | undefined;

/** What the dreams read of the game now. */
export function dreamWorld(r: Registry, day: number): DreamWorld {
  const friendship = getFriendship(r);
  const regard = regardMap(r, allCards().map(c => c.id));
  const results = (r.get('monde.scuffles') as SavedScuffles | undefined)?.results ?? {};
  const projects = projectsOf(r).projects;
  const town = townOf(r);
  return {
    day, regard: id => regard[id] ?? 0, met: id => !!friendship.residents[id], flags: flagsOf(r),
    project: id => { const p = projects[id]; return !p ? 'none' : p.opened !== null ? 'open' : 'begun'; },
    fairWins: Object.values(results).filter(s => /^sc_quarry_rook/.test(s.id) && s.outcome === 'win').length,
    arrivals: new Set(livingArrivals(town?.people).map(a => a.archetype)),
    favors: friendship.favor_book,
    leaving: new Set(Object.keys(town?.migration.notices ?? {}))
  };
}

// ── Checking ────────────────────────────────────────────────────────────────

/** A dream learned or moved on, for the zone's toast (quests/hud.ts shows them one at a time, when nothing covers the zone). */
const toasts: string[] = [];
/** GDD-GAP: how many wait at most (a dawn can move several dreams at once); the oldest go first. */
export const QUEST_TOASTS_KEPT = 6;
const toast = (text: string): void => { toasts.push(text); toasts.splice(0, Math.max(0, toasts.length - QUEST_TOASTS_KEPT)); };
/** The next toast to show, if any. */
export const nextQuestToast = (): string | undefined => toasts.shift();

const nameOf = (id: string): string => townNames()[id] ?? residentName(id);

/** Set one of a dream's own flags, as the puzzles set theirs (and keep the saved record in step). */
function setDreamFlag(r: Registry, flag: string): void {
  const session = storySession(r);
  if (session) {
    try { session.flags.set(flag); } catch { return; }
    r.set('monde.story.flags', session.snapshot());
  } else r.set('monde.story.flags', { ...((r.get('monde.story.flags') ?? {}) as object), [flag]: true });
}

/**
 * Learn and advance every dream now; apply what a stage does; offer the Favors the current stages ask for. Returns
 * the check (what was learned, every stage done).
 */
export function runDreams(r: Registry, now: Now): DreamCheck {
  const q = getQuests(r);
  const world = dreamWorld(r, now.day);
  const check = checkDreams(q.dreams, allRules(), world);
  if (check.dreams !== q.dreams) updateQuests(r, s => ({ ...s, dreams: check.dreams }));
  const minute = Math.floor(now.minute);
  for (const l of check.learned) {
    const rules = rulesFor(l.resident);
    if (rules && !check.done.some(d => d.resident === l.resident)) toast(`New in your Journal: ${nameOf(l.resident)}'s dream. “${rules.text}”`);
  }
  const reached = new Map<string, number>();
  for (const d of check.done) {
    if (d.regard) appendEvent(r, scriptedRegard({ id: `dream:${d.resident}:${d.stage}:regard`, day: now.day, minute },
      { scene_id: 'dream', cue_key: `${d.resident}:${d.stage}` }, { resident: d.resident, delta: d.regard }));
    for (const f of d.sets) setDreamFlag(r, f);
    reached.set(d.resident, d.stage + 1);
  }
  for (const [resident, stage] of reached) {
    appendEvent(r, { kind: 'dream_stage', id: `dream:${resident}:${stage}`, day: now.day, minute, resident, stage });
    const last = check.done.filter(d => d.resident === resident).at(-1)!;
    const rules = rulesFor(resident);
    toast(last.final ? `${nameOf(resident)}'s dream came true: “${rules?.text ?? ''}”` : `Journal: ${nameOf(resident)}'s dream, a step nearer. ✓ ${last.words}`);
  }
  spawnDreamFavors(r, now.day);
  return check;
}

/**
 * The Favors the dreams' current stages ask for (dueDreamFavors), on the book as `proposed`: the resident asks the next
 * time the player talks to them. Runs with every check, so at dawn it comes before the dawn sync's Quiet Mode chores
 * (scenes/friendship.ts). A resident with a Leaving Notice is kept free for the Last Chance (§6.4): never asked, and a
 * dream Favor only proposed to them is withdrawn (the server hasn't heard of it until it's accepted).
 */
export function spawnDreamFavors(r: Registry, day: number): Favor[] {
  const q = getQuests(r);
  const world = dreamWorld(r, day);
  if (favorBook(r).some(f => f.status === 'proposed' && f.reward.dream && world.leaving?.has(f.resident_id)))
    updateFriendship(r, s => ({ ...s, favor_book: s.favor_book.filter(f => !(f.status === 'proposed' && f.reward.dream && world.leaving?.has(f.resident_id))) }));
  const book = favorBook(r);
  const due = dueDreamFavors(q.dreams, allRules(), world, (resident, stage) => book.some(f => f.id === dreamFavorId(resident, stage, day)));
  const made: Favor[] = [];
  const favorWorld = localFavorWorld(r, day);
  for (const { resident, stage } of due) {
    const card = findCard(resident);
    const f = card && dreamFavor(card, stage, day, favorWorld);
    if (f) made.push(f);
  }
  if (made.length) updateFriendship(r, s => ({ ...s, favor_book: [...s.favor_book, ...made.filter(f => !s.favor_book.some(o => o.id === f.id))] }));
  return made;
}

const attached = new WeakSet<Clock>();
/** Keys whose change can move a dream (scenes/friendship.ts, the story's flags, the Projects, the town, Scuffles, the log). */
const WATCHED = new Set(['monde.friendship', 'monde.story.flags', 'monde.projects', 'monde.town', 'monde.scuffles', 'monde.events']);

/** Check the dreams at every dawn and within a minute of a change (once per clock; it outlives zone changes). */
export function attachQuestsClock(r: Registry, clock: Clock): void {
  if (attached.has(clock)) return;
  attached.add(clock);
  toasts.length = 0; // a new or loaded game: the last game's news is stale
  const mine = () => r.get('monde.clock') === clock;
  let dirty = true;
  const onChange = (_parent: unknown, key: string) => { if (WATCHED.has(key)) dirty = true; };
  r.events.on('changedata', onChange).on('setdata', onChange);
  const run = () => {
    if (!mine()) { r.events.off('changedata', onChange).off('setdata', onChange); return; }
    dirty = false;
    runDreams(r, { day: clock.day, minute: clock.minute });
    dirty = false;
  };
  clock.onDawn(run);
  clock.onMinute(() => { if (dirty) run(); });
}

// ── The objective and the Quest Log ─────────────────────────────────────────

const HINT_PLACES = { placeName, zoneName: (id: string) => zones[id]?.name ?? id, route: (from: string, to: string) => zoneRoute(zones, from, to) };
const fullPlaceName = (place: string): string => sitePlaceName(place);

function favorThreads(r: Registry, day: number): FavorThread[] {
  return favorBook(r).filter(f => (f.status === 'accepted' || f.status === 'proposed') && f.expires_day >= day).map(f => {
    const task = f.task.kind === 'chore' ? `Help with a chore (${f.task.minutes} min)` : f.task.kind === 'find' ? `Find ${f.task.item ?? 'something lost'}`
      : f.task.kind === 'delivery' ? `Take a parcel to ${nameOf(f.task.recipient)}` : f.task.kind === 'introduce' ? `Introduce ${nameOf(f.task.recipient)}`
      : `Bring ${f.task.item ?? 'it'}`;
    const stage = f.reward.dream ? Number(f.reward.dream.split('#')[1]) : NaN;
    const dream = Number.isInteger(stage) ? rulesFor(f.resident_id)?.stages[stage]?.words ?? null : null;
    return { id: f.id, resident: f.resident_id, name: nameOf(f.resident_id), status: f.status as 'accepted' | 'proposed', task, place: f.task.place,
      placeName: fullPlaceName(f.task.place), by: f.expires_day, dream };
  });
}

const PELL_SIGNS_AT = 'old_quarter.town_hall';
function projectThreads(r: Registry, now: Now): ProjectThread[] {
  const world = worldOf(r, now), town = townOf(r);
  const bag = (r.get('monde.inventory') as { slots?: ({ item: string; count: number } | null)[] } | undefined)?.slots ?? [];
  const carried = (item: string) => bag.reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);
  return E.begun(PROJECTS, projectsOf(r)).filter(b => b.progress.opened === null).map(({ id, def, progress }) => {
    const site = siteFor(def, progress), stage = E.stageOf(def, progress, world);
    // An open Project's step is the Fund's: Pell signs in the Town Hall, wherever the site is (projects/attach.ts).
    const step = stage === 'open' ? PELL_SIGNS_AT : site?.place ?? null;
    return { id, name: projectName(def, progress), stage,
      next: E.nextStep(def, progress, world, { fund: town?.fund ?? 0, carried, count: materialCount, placeName: sitePlaceName, residentName }),
      place: site?.place ?? null, placeName: site ? sitePlaceName(site.place) : null,
      stepPlace: step, stepPlaceName: step ? sitePlaceName(step) : null, lead: residentName(def.leads[0]!) };
  });
}

const DREAM_NAMES: DreamNames = {
  name: nameOf, placeName: fullPlaceName,
  placeOf: id => { const c = findCard(id); return c ? (c.workplace && zones[c.workplace.split('.')[0]!] ? c.workplace : c.home) : null; },
  projectName: id => PROJECTS.find(p => p.id === id)?.name ?? id.replaceAll('_', ' ')
};

function dreamThreads(r: Registry, world: DreamWorld): DreamThread[] {
  const book = favorBook(r);
  return Object.entries(getQuests(r).dreams).flatMap(([resident, p]) => {
    const rules = rulesFor(resident);
    const step = rules && dreamNextStep(rules, p, world, DREAM_NAMES, book);
    return step ? [{ resident, name: nameOf(resident), next: step.words, actionable: step.actionable, place: step.place, placeName: step.place ? fullPlaceName(step.place) : null }] : [];
  });
}

export interface ObjectiveOptions {
  /** A Project opening today (projects/attach.ts hint), when the zone has it. */
  ceremony?: StoryHint | null;
}

/** Every objective now (quests/objective.ts), from the story session, the town and the player's threads. */
export function objectivesNow(r: Registry, opts: ObjectiveOptions = {}): Objectives {
  const session = storySession(r);
  const clock = r.get('monde.clock') as Clock | undefined;
  const now = { day: clock?.day ?? 1, minute: clock?.minute ?? 360 };
  const context = session?.world ? session.context() : null;
  const done = new Set(session?.director.serialize().completed ?? []);
  const hint = session && context ? storyHint(session.scenes, context, session.flags, HINT_PLACES, done, session.active) ?? opts.ceremony ?? null : opts.ceremony ?? null;
  const town = townOf(r);
  const upcoming = session && context && !hint ? upcomingBeat(session.scenes, context, session.flags, HINT_PLACES, done, session.active, { ferryDay: d => isFerryDay(d, town?.flags) }) : null;
  const world = dreamWorld(r, now.day);
  const entries = marks(r).entries;
  return objectives({
    day: now.day, minute: now.minute, zone: context?.zone ?? 'old_quarter', hint, upcoming,
    cast: id => session?.header(id)?.cast ?? [],
    favors: favorThreads(r, now.day), projects: projectThreads(r, now), dreams: dreamThreads(r, world),
    marks: SPRING_RIDDLES.filter(m => entries[m.id]?.status === 'found').map(m => ({ id: m.id, title: m.title })),
    springOver: done.has('s10c_straw_poll') || (session?.flags.has('s10c_done') ?? false),
    places: HINT_PLACES
  });
}

/**
 * For the dialogue's quest-aware topics (mind/questTalk.ts): the objectives the HUD last showed (main: a scene or an
 * opening today; next: the next beat on a later day; meanwhile: a suggestion for now; hud: what the line shows),
 * computed fresh when the HUD hasn't run (a test, or before the zone's first frame).
 */
export const currentObjectives = (r: Registry): Objectives => (r.get(OBJECTIVE_KEY) as Objectives | undefined) ?? objectivesNow(r);
/** The player's current objective, as the HUD's objective line names it (never nothing). */
export const currentObjective = (r: Registry): Objective => currentObjectives(r).hud;

/** What a known dream stands at, for a resident's own conversation: null when the player doesn't know it. */
export function dreamFor(r: Registry, resident: string): { dream: string; stage: number; total: number; next: string | null; done: string[] } | null {
  const p: DreamProgress | undefined = getQuests(r).dreams[resident];
  const rules = rulesFor(resident);
  if (!p || !rules) return null;
  return { dream: rules.text, stage: p.stage, total: rules.stages.length, next: rules.stages[p.stage]?.words ?? null,
    done: p.done.map(d => rules.stages[d.stage]?.words ?? '').filter(Boolean) };
}

/** The scenes done, oldest first, with their titles (the director's completion order). */
function beatLines(scenes: readonly CompiledScene[], completed: readonly string[]): { id: string; title: string }[] {
  const byId = new Map(scenes.map(s => [s.id, s]));
  return completed.flatMap(id => { const s = byId.get(id); return s?.header && !s.header.calledFrom ? [{ id, title: beatTitle(s.title ?? id) }] : []; });
}

/** The Journal's Quests page now (a Project opening today kept from the HUD's last objectives: the Journal has no zone). */
export function questLogNow(r: Registry): QuestLog {
  const session = storySession(r);
  const clock = r.get('monde.clock') as Clock | undefined;
  const day = clock?.day ?? 1, minute = clock?.minute ?? 360;
  const world = dreamWorld(r, day);
  const fresh = objectivesNow(r), shown = r.get(OBJECTIVE_KEY) as Objectives | undefined;
  return questLog({
    objectives: !fresh.main && shown?.main?.kind === 'ceremony' ? shown : fresh,
    beats: session ? beatLines(session.scenes, session.director.serialize().completed) : [],
    projects: projectThreads(r, { day, minute }), favors: favorThreads(r, day), dreams: getQuests(r).dreams, rules: rulesFor, world, names: DREAM_NAMES,
    favorBook: favorBook(r)
  });
}
