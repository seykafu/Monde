// The objective (quests/objective.ts): what the HUD line and the Quests page say to do, in and between beats.
import { describe, expect, it } from 'vitest';
import { districtPhrase, objectives, suggestion, type FavorThread, type ObjectiveInput } from '../objective';
import type { StoryHint, UpcomingBeat } from '../../story/hint';

const ZONES: Record<string, string> = { old_quarter: 'Old Quarter', market_row: 'Market Row', wharf: 'The Wharf', commons: 'The Commons' };
const EDGES: Record<string, string[]> = { wharf: ['market_row'], market_row: ['wharf', 'old_quarter', 'commons'], old_quarter: ['market_row'], commons: ['market_row'] };
function route(from: string, to: string): string[] | null {
  if (from === to) return [];
  if (EDGES[from]?.includes(to)) return [to];
  return from !== 'market_row' && to !== 'market_row' ? ['market_row', to] : null;
}
const input = (over: Partial<ObjectiveInput> = {}): ObjectiveInput => ({
  day: 4, minute: 600, zone: 'old_quarter', hint: null, upcoming: null, cast: id => (id === 's01b_walk' ? ['pell', 'bertrand'] : []),
  favors: [], projects: [], dreams: [], marks: [], springOver: false,
  places: { placeName: id => id === 'lamplighter_cottage' ? 'the Lamplighter’s Cottage' : id, zoneName: id => ZONES[id] ?? id, route }, ...over
});
const hint = (over: Partial<StoryHint> = {}): StoryHint => ({
  sceneId: 's01b_walk', place: 'old_quarter.fountain_square', placeName: 'Fountain Square', zoneName: 'Old Quarter', via: 'Market Row',
  start: 640, end: 690, open: false, summoned: false, reason: 'Pell is waiting.', where: 'Market Row, then Fountain Square', when: '10:40–11:30',
  text: '', ...over
});
const upcoming = (over: Partial<UpcomingBeat> = {}): UpcomingBeat => ({
  sceneId: 's02_marks', place: 'old_quarter.library', placeName: 'Monde Free Library', zoneName: 'Old Quarter', day: 2, start: 600, end: 720, summoned: false,
  reason: 'Margo is opening the Marks log.', dayText: 'Tomorrow', when: 'Tomorrow, 10:00–12:00', where: 'Monde Free Library, Old Quarter', text: '', ...over
});
const favor = (over: Partial<FavorThread> = {}): FavorThread => ({
  id: 'f1', resident: 'odile', name: 'Odile', status: 'accepted', task: 'Help with a chore (30 min)', place: 'market_row.bakery', placeName: 'Fournier & Fille', by: 6, dream: null, ...over
});

describe('the main objective', () => {
  it('names a scene catchable today: where, when, who, why, and the way from another board', () => {
    const o = objectives(input({ zone: 'wharf', hint: hint() }));
    expect(o.main).toMatchObject({
      id: 's01b_walk', kind: 'story', header: 'NEXT · 10:40–11:30', title: 'Fountain Square, Old Quarter', where: 'Fountain Square, Old Quarter',
      when: '10:40–11:30', reason: 'Pell is waiting.', place: 'old_quarter.fountain_square', zone: 'old_quarter',
      direction: '→ Market Row', route: 'Market Row, then Old Quarter', people: ['pell', 'bertrand']
    });
    expect(o.main!.line).toBe('Fountain Square, Old Quarter → Market Row · 10:40–11:30');
    expect(o.hud).toBe(o.main);
    expect(o.next).toBeNull();
  });

  it('points next door with the district alone, and not at all once there or for a summons', () => {
    expect(objectives(input({ zone: 'market_row', hint: hint({ via: null, where: 'Fountain Square, Old Quarter' }) })).main).toMatchObject({ direction: '→ Old Quarter', route: 'Old Quarter' });
    expect(objectives(input({ zone: 'old_quarter', hint: hint({ via: null, where: 'Fountain Square' }) })).main).toMatchObject({ title: 'Fountain Square', direction: null, route: null });
    expect(objectives(input({ zone: 'wharf', hint: hint({ sceneId: 's10a_bloom_open', summoned: true, place: 'commons.sundial_lawn' }) })).main).toMatchObject({ direction: null });
  });

  it('calls a Project opening a ceremony', () => {
    expect(objectives(input({ hint: hint({ sceneId: 'project:fountain' }) })).main).toMatchObject({ kind: 'ceremony', people: [] });
  });
});

describe('between beats', () => {
  it('names the next beat and puts something to do meanwhile on the line, with the beat as its reason', () => {
    const o = objectives(input({ zone: 'old_quarter', upcoming: upcoming() }));
    expect(o.main).toBeNull();
    expect(o.next).toMatchObject({ kind: 'upcoming', header: 'TOMORROW, 10:00–12:00', title: 'Monde Free Library, Old Quarter', direction: null });
    expect(o.meanwhile).toMatchObject({ kind: 'explore', title: 'Talk to residents around the Old Quarter' });
    expect(o.hud).toMatchObject({ kind: 'explore', header: 'MEANWHILE', reason: 'Next: tomorrow, 10:00–12:00, Monde Free Library, Old Quarter.' });
  });

  it('picks the most pressing thing there is: a Favor taken on (soonest first), a Project step, an ask, a dream, a Mark', () => {
    const all = input({
      favors: [favor({ id: 'late', by: 9, name: 'Nell' }), favor({ id: 'soon', by: 5 }), favor({ id: 'ask', status: 'proposed', name: 'Hollis', resident: 'hollis' })],
      projects: [{ id: 'fountain', name: 'the fountain', stage: 'gathering', next: 'Find 4 pipe fittings.', place: 'old_quarter.fountain_square', placeName: 'Fountain Square', lead: 'Kasimir' }],
      dreams: [{ resident: 'barney', name: 'Barney', next: 'Stand beside him at the back door', actionable: true, place: 'market_row.general_store', placeName: 'Dunmore’s' }],
      marks: [{ id: 'MR-1', title: 'The Long Counter' }]
    });
    expect(suggestion(all)).toMatchObject({ id: 'favor:soon', kind: 'favor', title: 'Help with a chore (30 min) for Odile', when: 'by Day 5', where: 'Fournier & Fille, Market Row', direction: '→ Market Row' });
    expect(suggestion({ ...all, favors: all.favors.filter(f => f.status === 'proposed') })).toMatchObject({ kind: 'project', title: 'Find 4 pipe fittings.', reason: 'The fountain, led by Kasimir.' });
    expect(suggestion({ ...all, favors: all.favors.filter(f => f.status === 'proposed'), projects: [] })).toMatchObject({ kind: 'offer', title: 'Talk to Hollis' });
    expect(suggestion({ ...all, favors: [], projects: [] })).toMatchObject({ kind: 'dream', title: 'Stand beside him at the back door', people: ['barney'] });
    expect(suggestion({ ...all, favors: [], projects: [], dreams: [] })).toMatchObject({ kind: 'mark', title: 'Answer "The Long Counter"' });
    // The Fund's step is Pell's: the line points at the Town Hall, not the bakery.
    const ovens = { id: 'bakery_ovens', name: 'the bakery ovens', stage: 'open', next: 'Ask Pell to sign for 150 coins.', place: 'market_row.bakery', placeName: 'Fournier & Fille', stepPlace: 'old_quarter.town_hall', stepPlaceName: 'Town Hall', lead: 'Odile' };
    expect(suggestion(input({ projects: [ovens] }))).toMatchObject({ kind: 'project', place: 'old_quarter.town_hall', direction: null });
    // A Project only waiting on its opening day isn't something to do now.
    expect(suggestion(input({ projects: [{ ...all.projects[0]!, stage: 'locked' }] })).kind).toBe('explore');
    // An expired Favor isn't either.
    expect(suggestion(input({ day: 7, favors: [favor({ by: 6 })] })).kind).toBe('explore');
  });

  it('says a dream Favor is for the dream', () => {
    expect(suggestion(input({ favors: [favor({ dream: 'Stand beside him at the back door on a Saturday' })] })).reason).toBe("Odile's dream: Stand beside him at the back door on a Saturday.");
  });

  it('sends the player home when the Spring is done', () => {
    const o = objectives(input({ springOver: true, zone: 'commons' }));
    expect(o).toMatchObject({ main: null, next: null });
    expect(o.hud).toMatchObject({ kind: 'rest', title: 'Home to bed', place: 'old_quarter.lamplighter_cottage', direction: '→ Market Row' });
  });
});

it('says a district the way a sentence does', () => {
  expect(['Old Quarter', 'The Wharf', 'Market Row', 'The Commons'].map(districtPhrase)).toEqual(['the Old Quarter', 'the Wharf', 'Market Row', 'the Commons']);
});
