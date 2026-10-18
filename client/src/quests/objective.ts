// The player's objective (Kasey's playtest, 2026-10-18: "help guide the player on where to go"): what the HUD's
// objective line and the Journal's Quests page say to do next. Pure: no Phaser, no DOM; quests/runtime.ts fills the
// input from the registry.
//
//   main       a story scene the player can still catch today (story/hint.ts storyHint), or a Project's opening
//              ceremony today (projects/attach.ts hint): who, where, when and why;
//   next       when nothing can be caught today, the next beat on a later day (story/hint.ts upcomingBeat);
//   meanwhile  always something to do now, picked from what's actually there, most pressing first: a Favor the
//              player took on (soonest due first), a Project under way with a step the player can take, someone with a
//              Favor to ask, a dream's next step, a Mark in the notes, and failing all of those, the neighbours of the
//              district the player is in;
//   hud        what the objective line shows: `main`, or `meanwhile` with `next` as its reason.
import type { StoryHint, UpcomingBeat } from '../story/hint';

export type ObjectiveKind = 'story' | 'ceremony' | 'upcoming' | 'favor' | 'project' | 'offer' | 'dream' | 'mark' | 'explore' | 'rest';

export interface Objective {
  /** The scene (`s01b_walk`), the Project opening (`project:fountain`), or the thread (`favor:<id>`, `dream:<id>`…). */
  id: string;
  kind: ObjectiveKind;
  /** The objective line's first row: "NEXT · before 11:30", "MEANWHILE". */
  header: string;
  /** What to do, in plain words: "Fountain Square, Old Quarter" or "Help Odile with a chore at the Bakery". */
  title: string;
  /** Where, as a name: "Fountain Square, Old Quarter" ('' when anywhere will do). */
  where: string;
  /** "before 11:30", "10:40–11:30", "Tomorrow, 10:00–12:00", "by Day 6" ('' when any time). */
  when: string;
  /** Why, one short line: "Pell is waiting." */
  reason: string;
  /** `zone.place`, when the objective has one. */
  place: string | null;
  /** The district it's in (`old_quarter`), when it has one. */
  zone: string | null;
  /** "→ Market Row": the next district to walk to, when it's on another board. */
  direction: string | null;
  /** "Market Row, then Fountain Square": the way there from here, when it's on another board. */
  route: string | null;
  /** Who it involves (resident ids): the scene's cast, the Favor's or dream's resident, a Project's lead. */
  people: string[];
  /** One line for a narrow space: "Fountain Square → Market Row · before 11:30". */
  line: string;
}

export interface ObjectivePlaces {
  /** "Fountain Square" for `fountain_square`. */
  placeName(placeId: string): string;
  zoneName(zoneId: string): string;
  /** The districts to walk through from one zone to another, ending with `to`; [] when there; null if unreachable. */
  route(from: string, to: string): readonly string[] | null;
}

export interface FavorThread {
  id: string;
  resident: string;
  name: string;
  status: 'proposed' | 'accepted';
  /** "Help with a chore (30 min)", "Bring a loaf". */
  task: string;
  place: string;
  placeName: string;
  /** The last day it can be done. */
  by: number;
  /** The dream stage it serves, in the stage's words. */
  dream: string | null;
}

export interface ProjectThread {
  id: string;
  /** "The fountain". */
  name: string;
  /** engine.ts Stage. */
  stage: string;
  /** The Ledger's one next thing to do (engine.ts nextStep). */
  next: string;
  place: string | null;
  placeName: string | null;
  /** Where the next step is done, when not at the site: the Fund's is Pell's, in the Town Hall. */
  stepPlace?: string | null;
  stepPlaceName?: string | null;
  lead: string;
}

export interface DreamThread {
  resident: string;
  name: string;
  /** The current stage's words. */
  next: string;
  /** Something the player can do about it now (its gates hold, or its Favor is on offer). */
  actionable: boolean;
  place: string | null;
  placeName: string | null;
}

export interface ObjectiveInput {
  day: number;
  minute: number;
  /** The district the player is in (a room's is its district's). */
  zone: string;
  /** A scene catchable today, or a Project ceremony today. */
  hint: StoryHint | null;
  upcoming: UpcomingBeat | null;
  /** A scene's cast (resident ids), for `people`. */
  cast(sceneId: string): readonly string[];
  /** The Favors on the book: taken on, and asked of the player. */
  favors: readonly FavorThread[];
  projects: readonly ProjectThread[];
  dreams: readonly DreamThread[];
  /** Marks found and not yet answered (their titles). */
  marks: readonly { id: string; title: string }[];
  /** The last scene of the Spring is done (S10c): nothing more in the story until the report. */
  springOver: boolean;
  places: ObjectivePlaces;
}

export interface Objectives {
  main: Objective | null;
  next: Objective | null;
  meanwhile: Objective;
  hud: Objective;
}

const trimDot = (s: string): string => s.replace(/[.\s]+$/, '');
const HOME = 'old_quarter.lamplighter_cottage';
/** "the Old Quarter", "the Wharf", "Market Row": a district's name as a sentence says it. */
export const districtPhrase = (name: string): string => /^The /.test(name) ? name.replace(/^The /, 'the ') : /Quarter$/.test(name) ? `the ${name}` : name;

function way(input: ObjectiveInput, place: string | null): Pick<Objective, 'zone' | 'direction' | 'route'> {
  if (!place) return { zone: null, direction: null, route: null };
  const zone = place.split('.')[0]!;
  if (zone === input.zone) return { zone, direction: null, route: null };
  const steps = input.places.route(input.zone, zone);
  const first = steps?.[0] ?? zone;
  return { zone, direction: `→ ${input.places.zoneName(first)}`, route: steps?.length ? steps.map(z => input.places.zoneName(z)).join(', then ') : null };
}

const lineOf = (o: Pick<Objective, 'title' | 'direction' | 'when'>): string =>
  [o.title, o.direction, o.when].filter(Boolean).join(' · ').replace(' · →', ' →');

function make(input: ObjectiveInput, o: Omit<Objective, 'zone' | 'direction' | 'route' | 'line'> & { summoned?: boolean }): Objective {
  const w = o.summoned ? { zone: o.place?.split('.')[0] ?? null, direction: null, route: null } : way(input, o.place);
  const { summoned: _summoned, ...rest } = o;
  const out = { ...rest, ...w, line: '' };
  out.line = lineOf(out);
  return out;
}

const placeWhere = (input: ObjectiveInput, placeName: string | null, place: string | null): string => {
  if (!placeName) return '';
  const zone = place?.split('.')[0];
  return zone && zone !== input.zone ? `${placeName}, ${input.places.zoneName(zone)}` : placeName;
};

/** Every objective for now. */
export function objectives(input: ObjectiveInput): Objectives {
  const h = input.hint;
  const main = h ? make(input, {
    id: h.sceneId, kind: h.sceneId.startsWith('project:') ? 'ceremony' : 'story', header: `NEXT · ${h.when}`,
    title: h.summoned ? `${h.placeName}, ${h.zoneName}` : h.where.includes(', then ') ? `${h.placeName}, ${h.zoneName}` : h.where,
    where: `${h.placeName}, ${h.zoneName}`, when: h.when, reason: h.reason, place: h.place,
    people: h.sceneId.startsWith('project:') ? [] : [...input.cast(h.sceneId)], summoned: h.summoned
  }) : null;
  const u = input.upcoming;
  const next = !h && u ? make(input, {
    id: u.sceneId, kind: 'upcoming', header: u.when.toUpperCase(), title: u.where, where: u.where, when: u.when, reason: u.reason,
    place: u.place, people: [...input.cast(u.sceneId)], summoned: u.summoned
  }) : null;
  const meanwhile = suggestion(input);
  const hud: Objective = main ?? (next
    ? { ...meanwhile, header: 'MEANWHILE', reason: `Next: ${next.when.replace(/^Tomorrow/, 'tomorrow')}, ${next.where}.` }
    : meanwhile);
  return { main, next, meanwhile, hud };
}

/** The most useful thing to do now (never nothing). */
export function suggestion(input: ObjectiveInput): Objective {
  const due = [...input.favors].filter(f => f.status === 'accepted' && f.by >= input.day).sort((a, b) => a.by - b.by || a.name.localeCompare(b.name))[0];
  if (due) return make(input, {
    id: `favor:${due.id}`, kind: 'favor', header: 'FAVOR', title: `${due.task} for ${due.name}`,
    where: placeWhere(input, due.placeName, due.place), when: due.by === input.day ? 'today' : `by Day ${due.by}`,
    reason: due.dream ? `${due.name}'s dream: ${trimDot(due.dream)}.` : `${due.name} asked you.`, place: due.place, people: [due.resident]
  });
  const project = input.projects.find(p => ['open', 'funded', 'gathering', 'building', 'puzzle', 'ready'].includes(p.stage));
  if (project) return make(input, {
    id: `project:${project.id}`, kind: 'project', header: 'TOWN PROJECT', title: project.next,
    where: placeWhere(input, project.stepPlaceName ?? project.placeName, project.stepPlace ?? project.place), when: '', reason: `${project.name.charAt(0).toUpperCase()}${project.name.slice(1)}, led by ${project.lead}.`,
    place: project.stepPlace ?? project.place, people: []
  });
  const offer = [...input.favors].filter(f => f.status === 'proposed' && f.by >= input.day).sort((a, b) => a.by - b.by)[0];
  if (offer) return make(input, {
    id: `favor:${offer.id}`, kind: 'offer', header: 'SOMEONE TO SEE', title: `Talk to ${offer.name}`,
    where: placeWhere(input, offer.placeName, offer.place), when: `by Day ${offer.by}`, reason: `${offer.name} has a Favor to ask.`,
    place: offer.place, people: [offer.resident]
  });
  const dream = input.dreams.find(d => d.actionable);
  if (dream) return make(input, {
    id: `dream:${dream.resident}`, kind: 'dream', header: 'A DREAM', title: trimDot(dream.next),
    where: placeWhere(input, dream.placeName, dream.place), when: '', reason: `For ${dream.name}: the Journal's Quests page.`, place: dream.place, people: [dream.resident]
  });
  const mark = input.marks[0];
  if (mark) return make(input, {
    id: `mark:${mark.id}`, kind: 'mark', header: 'A MARK', title: `Answer "${mark.title}"`,
    where: '', when: '', reason: 'Name the place in the Journal (J, Marks).', place: null, people: []
  });
  if (input.springOver) return make(input, {
    id: 'rest', kind: 'rest', header: 'THE SPRING IS DONE', title: 'Home to bed',
    where: placeWhere(input, input.places.placeName('lamplighter_cottage'), HOME), when: '', reason: 'The End-of-Spring report comes with the morning paper.', place: HOME, people: []
  });
  const district = input.places.zoneName(input.zone);
  return make(input, {
    id: `explore:${input.zone}`, kind: 'explore', header: 'MEANWHILE', title: `Talk to residents around ${districtPhrase(district)}`,
    where: district, when: '', reason: 'Get to know your neighbours (E beside them).', place: null, people: []
  });
}
