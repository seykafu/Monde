// The Tasks menu (quests/tasks.ts): one row per thing to do, built from the Journal's Quest Log, and the toasts for a
// task given or done.
import { describe, expect, it } from 'vitest';
import { objectives, type FavorThread, type ObjectiveInput, type ProjectThread } from '../objective';
import type { DreamView, QuestLog } from '../questLog';
import { TASK_NEWS_MAX, taskIdFor, taskNews, tasksFrom, type Task, type TaskNames } from '../tasks';
import type { StoryHint, UpcomingBeat } from '../../story/hint';

const ZONES: Record<string, string> = { old_quarter: 'Old Quarter', market_row: 'Market Row', wharf: 'The Wharf', commons: 'The Commons' };
const PLACES: Record<string, string> = { 'old_quarter.fountain_square': 'Fountain Square', 'market_row.bakery': 'Fournier & Fille', 'old_quarter.town_hall': 'Town Hall',
  'old_quarter.library': 'Monde Free Library', 'old_quarter.lamplighter_cottage': 'the Lamplighter’s Cottage', 'commons.duck_pond': 'Duck Pond', 'wharf.boathouse': 'Boathouse' };
const names: TaskNames = { zoneName: id => ZONES[id] ?? id, placeName: p => PLACES[p] ?? p };
const objectiveInput = (over: Partial<ObjectiveInput> = {}): ObjectiveInput => ({
  day: 4, minute: 600, zone: 'old_quarter', hint: null, upcoming: null, cast: () => ['pell'], favors: [], projects: [], dreams: [], marks: [], springOver: false,
  places: { placeName: id => id, zoneName: id => ZONES[id] ?? id, route: () => [] }, ...over
});
const hint: StoryHint = {
  sceneId: 's01b_walk', place: 'old_quarter.fountain_square', placeName: 'Fountain Square', zoneName: 'Old Quarter', via: null, start: 640, end: 690, open: true,
  summoned: false, reason: 'Pell is waiting.', where: 'Fountain Square', when: 'before 11:30', text: ''
};
const upcoming: UpcomingBeat = {
  sceneId: 's02_marks', place: 'old_quarter.library', placeName: 'Monde Free Library', zoneName: 'Old Quarter', day: 5, start: 600, end: 720, summoned: false,
  reason: 'Margo is opening the Marks log.', dayText: 'Tomorrow', when: 'Tomorrow, 10:00–12:00', where: 'Monde Free Library, Old Quarter', text: ''
};
const favor = (over: Partial<FavorThread> = {}): FavorThread => ({
  id: 'f1', resident: 'odile', name: 'Odile', status: 'accepted', task: 'Help with a chore (30 min)', place: 'market_row.bakery', placeName: 'Fournier & Fille', by: 6, dream: null, ...over
});
const project: ProjectThread = { id: 'fountain', name: 'the fountain', stage: 'open', next: 'Pledge to the Fund with Pell.', place: 'old_quarter.fountain_square',
  placeName: 'Fountain Square', stepPlace: 'old_quarter.town_hall', stepPlaceName: 'Town Hall', lead: 'Bertrand' };
const dream = (over: Partial<DreamView> = {}): DreamView => ({
  resident: 'teo', name: 'Teo', dream: 'To row the bay.', total: 3, stage: 1, complete: false, done: [{ words: 'Mend the oars', day: 3 }],
  next: { words: 'Take the boat out on a calm morning.', how: 'Waits until Teo trusts you more (Regard 30; now 12).', actionable: false, place: null }, ...over
});
const log = (over: Partial<QuestLog> = {}, input: Partial<ObjectiveInput> = {}): QuestLog => ({
  objectives: objectives(objectiveInput(input)), beats: [], projects: [], favors: [], offers: [], dreams: [], ...over
});
const ids = (tasks: Task[]) => tasks.map(t => t.id);

describe('the list', () => {
  it('starts with the main story: what to do, where (place and district), when', () => {
    const [main] = tasksFrom({ log: log({}, { hint }), marks: [], names });
    expect(main).toEqual({
      id: 'main:s01b_walk', kind: 'main', title: 'Main story', next: 'Pell is waiting. Get there before 11:30.', detail: '',
      place: 'old_quarter.fountain_square', placeName: 'Fountain Square', district: 'old_quarter', districtName: 'Old Quarter',
      where: 'Fountain Square · Old Quarter', when: 'before 11:30', actionable: true, people: ['pell']
    });
    expect(tasksFrom({ log: log({}, { hint: { ...hint, open: false, when: '10:40–11:30' } }), marks: [], names })[0]!.next).toBe('Pell is waiting. Be there 10:40–11:30.');
  });

  it('names the next beat between beats, a Project opening as an opening, and the bed once the Spring is done', () => {
    expect(tasksFrom({ log: log({}, { upcoming }), marks: [], names })[0]).toMatchObject({
      id: 'main:s02_marks', title: 'Main story', next: 'Margo is opening the Marks log.', detail: '', when: 'Tomorrow, 10:00–12:00',
      where: 'Monde Free Library · Old Quarter', actionable: false
    });
    expect(tasksFrom({ log: log({}, { hint: { ...hint, sceneId: 'project:fountain', reason: 'The fountain opens today.' } }), marks: [], names })[0])
      .toMatchObject({ id: 'main:project:fountain', title: 'An opening today' });
    expect(tasksFrom({ log: log({}, { springOver: true }), marks: [], names })[0])
      .toMatchObject({ id: 'main:rest', next: 'The Spring is done: home to bed.', where: 'the Lamplighter’s Cottage · Old Quarter' });
    expect(tasksFrom({ log: log(), marks: [], names })).toEqual([]);
  });

  it('lists every side quest after it, in order: Favors, asks, Projects, dreams, Marks; then the ones waiting on something', () => {
    const tasks = tasksFrom({
      log: log({
        favors: [favor({ dream: 'Stand beside him at the back door' })], offers: [favor({ id: 'f2', status: 'proposed', resident: 'barney', name: 'Barney', place: 'wharf.boathouse', by: 7 })],
        projects: [project],
        dreams: [dream(), dream({ resident: 'ada', name: 'Ada', next: { words: 'Find the old sign', how: 'Ada has a Favor to ask: talk to them (Duck Pond).', actionable: true, place: 'commons.duck_pond' } }),
          dream({ resident: 'done', name: 'Done', complete: true, next: null })]
      }, { hint }),
      marks: [{ id: 'OQ-1', title: 'The Heron' }], names
    });
    expect(ids(tasks)).toEqual(['main:s01b_walk', 'favor:f1', 'offer:f2', 'project:fountain', 'dream:ada', 'mark:OQ-1', 'dream:teo']);
    expect(tasks[1]).toMatchObject({ title: 'Favor for Odile', next: 'Help with a chore (30 min).', detail: 'For their dream: Stand beside him at the back door.',
      where: 'Fournier & Fille · Market Row', when: 'by Day 6', people: ['odile'] });
    expect(tasks[2]).toMatchObject({ title: 'Barney has a Favor to ask', next: 'Talk to Barney (E beside them).', where: 'Boathouse · The Wharf' });
    // A Project's step where it's taken: the Fund's at the Town Hall, not the site.
    expect(tasks[3]).toMatchObject({ title: 'Town Project: The fountain', next: 'Pledge to the Fund with Pell.', place: 'old_quarter.town_hall', where: 'Town Hall · Old Quarter' });
    expect(tasks[4]).toMatchObject({ title: 'Ada’s dream · 1 of 3', next: 'Ada has a Favor to ask: talk to them (Duck Pond).', detail: 'Next: Find the old sign.', actionable: true, district: 'commons' });
    expect(tasks[5]).toMatchObject({ title: 'Mark: “The Heron”', where: 'Your Journal, Marks (J)', place: null });
    expect(tasks[6]).toMatchObject({ id: 'dream:teo', where: 'No place yet', place: null, actionable: false });
    // A beat on a later day still leads the list.
    expect(ids(tasksFrom({ log: log({ favors: [favor()] }, { upcoming }), marks: [], names }))).toEqual(['main:s02_marks', 'favor:f1']);
  });
});

describe('news', () => {
  const before = tasksFrom({ log: log({ favors: [favor()], offers: [favor({ id: 'f2', status: 'proposed', name: 'Barney' })], projects: [project] }, { hint }), marks: [], names });
  const done = () => 'done' as const, gone = () => 'gone' as const;

  it('says nothing about the first list (a load or a new game)', () => {
    expect(taskNews(null, before, done)).toEqual([]);
    expect(taskNews(before, before, done)).toEqual([]);
  });

  it('announces a task given and a task done', () => {
    const after = [...before.filter(t => t.id !== 'favor:f1'), ...tasksFrom({ log: log({ favors: [favor({ id: 'f9', name: 'Ines', place: 'commons.duck_pond' })] }), marks: [], names })];
    expect(taskNews(before, after, t => t.id === 'favor:f1' ? 'done' : 'gone')).toEqual(['Task done ✓ Favor for Odile', 'New task · Favor for Ines (Duck Pond · The Commons)']);
  });

  it('keeps quiet about an ask taken on (it comes back as a Favor) and a Favor let go', () => {
    const after = before.filter(t => t.id !== 'offer:f2' && t.id !== 'favor:f1');
    expect(taskNews(before, after, gone)).toEqual([]);
  });

  it('names the main story’s next step, and leaves dreams and a beat done to their own news', () => {
    const next = tasksFrom({ log: log({ favors: [favor()], offers: [favor({ id: 'f2', status: 'proposed', name: 'Barney' })], projects: [project], dreams: [dream()] }, { upcoming }), marks: [], names });
    expect(taskNews(before, next, done)).toEqual(['Main story: Margo is opening the Marks log. (Monde Free Library · Old Quarter)']);
  });

  it('makes one toast for a crowd of new tasks', () => {
    const many = [...before, ...[1, 2, 3].map(i => tasksFrom({ log: log({ favors: [favor({ id: `n${i}` })] }), marks: [], names })[0]!)];
    expect(3).toBeGreaterThan(TASK_NEWS_MAX);
    expect(taskNews(before, many, done)).toEqual(['3 new tasks. T opens your Tasks.']);
  });
});

describe('the task on the HUD', () => {
  it('is the one the objective line shows, whatever it is', () => {
    const all = (l: QuestLog) => tasksFrom({ log: l, marks: [{ id: 'OQ-1', title: 'The Heron' }], names });
    const cases: QuestLog[] = [
      log({}, { hint }), log({}, { upcoming }), log({}, { springOver: true }),
      log({}, { favors: [favor()] }), log({}, { favors: [favor({ status: 'proposed' })] }), log({}, { projects: [project] }),
      log({}, { dreams: [{ resident: 'teo', name: 'Teo', next: 'Row out', actionable: true, place: null, placeName: null }] }),
      log({}, { marks: [{ id: 'OQ-1', title: 'The Heron' }] })
    ];
    // Between beats with nothing else on, the line suggests meeting the neighbours: no task of its own.
    const expected = ['main:s01b_walk', 'explore:old_quarter', 'main:rest', 'favor:f1', 'offer:f1', 'project:fountain', 'dream:teo', 'mark:OQ-1'];
    cases.forEach((l, i) => expect(taskIdFor(l.objectives.hud), expected[i]).toBe(expected[i]));
    // Between beats the line shows something to do meanwhile; the main story's task is the next beat.
    const between = log({ favors: [favor()] }, { upcoming, favors: [favor()] });
    expect(taskIdFor(between.objectives.hud)).toBe('favor:f1');
    expect(all(between).map(t => t.id)).toContain('favor:f1');
  });
});
