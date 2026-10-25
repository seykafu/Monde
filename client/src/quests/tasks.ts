// The Tasks menu as data (Kasey, 2026-10-24: "a Tasks menu showing what to do whenever new side quests or main tasks
// arrive"). Pure: no Phaser, no DOM. quests/runtime.ts tasksNow fills it from the Journal's Quest Log (questLog.ts), so
// the menu and the Quests page always agree; scenes/TasksScene.ts draws it.
//
// The Quests page is the notebook: the story so far, every dream's stages, who asked what. Tasks is the checklist
// beside it: one row per thing to do now, each with what to do next and where (place and district), in this order:
//   main     the main story's next beat (today's, else the next day's), or a Project's opening today;
//   favor    the Favors the player took on, soonest due first;
//   offer    someone with a Favor to ask;
//   project  each Town Project under way, at the step's place (the Fund's is Pell's, in the Town Hall);
//   dream    each dream the player knows that isn't done;
//   mark     each Mark found and not yet answered;
// and after them, in the same order, the side quests waiting on something (a dream's trust, a day, the story).
// taskNews says what changed between two lists, for the zone's toast: a new task, or one done.
import type { Objective } from './objective';
import type { QuestLog } from './questLog';

export type TaskKind = 'main' | 'favor' | 'offer' | 'project' | 'dream' | 'mark';

export interface Task {
  /** Stable while the task is the same thing: `main:<scene>`, `favor:<id>`, `offer:<id>`, `project:<id>`, `dream:<resident>`, `mark:<id>`. */
  id: string;
  kind: TaskKind;
  /** "Main story", "Favor for Odile", "Town Project: The fountain". */
  title: string;
  /** What to do next, one line. */
  next: string;
  /** A quieter second line, when there's more to say (a dream's stage, why the Favor matters). */
  detail: string;
  /** `zone.place`, or null when it isn't anywhere in particular. */
  place: string | null;
  placeName: string | null;
  /** The district (`market_row`), and its name. */
  district: string | null;
  districtName: string | null;
  /** "Fournier & Fille · Market Row", or where else to go ("Your Journal, Marks"). */
  where: string;
  /** "before 11:30", "Tomorrow, 10:00–12:00", "by Day 6" ('' when any time). */
  when: string;
  /** Something the player can do about it now (not waiting on a day, a gate or the story). */
  actionable: boolean;
  /** Who it involves (resident ids). */
  people: string[];
}

export interface TaskNames {
  zoneName(id: string): string;
  /** "Fournier & Fille" for `market_row.bakery`. */
  placeName(place: string): string;
}

export interface TaskInput {
  log: QuestLog;
  /** Marks found and not yet answered. */
  marks: readonly { id: string; title: string }[];
  names: TaskNames;
}

const trimDot = (s: string): string => s.replace(/[.\s]+$/, '');
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function located(names: TaskNames, place: string | null): Pick<Task, 'place' | 'placeName' | 'district' | 'districtName' | 'where'> {
  if (!place) return { place: null, placeName: null, district: null, districtName: null, where: 'Anywhere' };
  const district = place.split('.')[0]!, placeName = names.placeName(place), districtName = names.zoneName(district);
  return { place, placeName, district, districtName, where: `${placeName} · ${districtName}` };
}

/** "Get there before 11:30." / "Be there 10:40–11:30." */
const whenLine = (when: string): string => !when ? '' : /^before /.test(when) ? `Get there ${when}.` : `Be there ${when}.`;

/** Every task now, in the menu's order. */
export function tasksFrom({ log, marks, names }: TaskInput): Task[] {
  const out: Task[] = [];
  const { main, next, meanwhile } = log.objectives;
  if (main) {
    const ceremony = main.kind === 'ceremony';
    out.push({ id: `main:${main.id}`, kind: 'main', title: ceremony ? 'An opening today' : 'Main story',
      next: [trimDot(main.reason) + '.', whenLine(main.when)].filter(Boolean).join(' '), detail: '',
      ...located(names, main.place), when: main.when, actionable: true, people: [...main.people] });
  } else if (next) {
    out.push({ id: `main:${next.id}`, kind: 'main', title: 'Main story', next: `${trimDot(next.reason)}.`, detail: '',
      ...located(names, next.place), when: next.when, actionable: false, people: [...next.people] });
  } else if (meanwhile.kind === 'rest') {
    out.push({ id: 'main:rest', kind: 'main', title: 'Main story', next: 'The Spring is done: home to bed.', detail: trimDot(meanwhile.reason) + '.',
      ...located(names, meanwhile.place), when: '', actionable: true, people: [] });
  }
  for (const f of log.favors) out.push({
    id: `favor:${f.id}`, kind: 'favor', title: `Favor for ${f.name}`, next: `${trimDot(f.task)}.`,
    detail: f.dream ? `For their dream: ${trimDot(f.dream)}.` : `${f.name} asked you.`,
    ...located(names, f.place), when: `by Day ${f.by}`, actionable: true, people: [f.resident]
  });
  for (const f of log.offers) out.push({
    id: `offer:${f.id}`, kind: 'offer', title: `${f.name} has a Favor to ask`, next: `Talk to ${f.name} (E beside them).`, detail: '',
    ...located(names, f.place), when: `by Day ${f.by}`, actionable: true, people: [f.resident]
  });
  for (const p of log.projects) out.push({
    id: `project:${p.id}`, kind: 'project', title: `Town Project: ${capital(p.name)}`, next: p.next, detail: `Led by ${p.lead}.`,
    ...located(names, p.stepPlace ?? p.place), when: '', actionable: true, people: []
  });
  const dreams = log.dreams.filter(d => !d.complete && d.next).sort((a, b) => Number(b.next!.actionable) - Number(a.next!.actionable));
  for (const d of dreams) {
    const at = located(names, d.next!.place);
    out.push({
      id: `dream:${d.resident}`, kind: 'dream', title: `${d.name}’s dream · ${d.stage} of ${d.total}`, next: d.next!.how, detail: `Next: ${trimDot(d.next!.words)}.`,
      ...at, where: at.place ? at.where : 'No place yet', when: '', actionable: d.next!.actionable, people: [d.resident]
    });
  }
  for (const m of marks) out.push({
    id: `mark:${m.id}`, kind: 'mark', title: `Mark: “${m.title}”`, next: 'Name the place it describes.', detail: '',
    place: null, placeName: null, district: null, districtName: null, where: 'Your Journal, Marks (J)', when: '', actionable: true, people: []
  });
  // The main story stays first; the side quests waiting on something (a day, trust, the story) go after the rest.
  const story = out.filter(t => t.kind === 'main'), side = out.filter(t => t.kind !== 'main');
  return [...story, ...side.filter(t => t.actionable), ...side.filter(t => !t.actionable)];
}

/** The task the HUD's objective line is showing (quests/objective.ts ids: a scene, `favor:<id>`, `project:<id>`…). */
export function taskIdFor(o: Pick<Objective, 'id' | 'kind'>): string {
  if (o.kind === 'story' || o.kind === 'ceremony' || o.kind === 'upcoming') return `main:${o.id}`;
  if (o.kind === 'rest') return 'main:rest';
  if (o.kind === 'offer') return o.id.replace(/^favor:/, 'offer:');
  return o.id;
}

/** What became of a task that's gone from the list. */
export type TaskOutcome = 'done' | 'gone';

/** GDD-GAP: no number for it. More new tasks than this at once make one toast that says how many. */
export const TASK_NEWS_MAX = 2;

/**
 * The toasts for a change in the list. Nothing for the first list seen (a load, a new game). Dreams are left to the
 * dreams' own toasts (quests/runtime.ts) and a beat done to its scene; an offer taken on comes back as its Favor.
 */
export function taskNews(before: readonly Task[] | null, after: readonly Task[], outcome: (t: Task) => TaskOutcome): string[] {
  if (!before) return [];
  const had = new Set(before.map(t => t.id)), has = new Set(after.map(t => t.id));
  const added = after.filter(t => !had.has(t.id) && t.kind !== 'dream');
  const done = before.filter(t => !has.has(t.id) && t.kind !== 'dream' && t.kind !== 'main' && outcome(t) === 'done');
  const news = done.map(t => `Task done ✓ ${t.title}`);
  if (added.length > TASK_NEWS_MAX) return [...news, `${added.length} new tasks. T opens your Tasks.`];
  for (const t of added) news.push(t.kind === 'main' ? `Main story: ${t.next}${t.placeName ? ` (${t.where})` : ''}` : `New task · ${t.title}${t.placeName ? ` (${t.where})` : ''}`);
  return news;
}
