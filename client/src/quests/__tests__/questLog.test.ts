// The Journal's Quests page as data (quests/questLog.ts), and the Lantern's dream notices (quests/paper.ts).
import { describe, expect, it, vi } from 'vitest';
import { dreamRewardTag, type DreamProgress, type Favor } from '@monde/shared';
import { dreamRules, type DreamWorld } from '../dreams';
import { objectives } from '../objective';
import { BEATS_SHOWN, beatTitle, dreamNextStep, questLog, type DreamNames } from '../questLog';
vi.mock('phaser', () => import('../../qa/__tests__/phaserStub'));
const { personaCards } = await import('../../world/residents');
const { dreamNotices, DREAM_NOTICES_MAX } = await import('../paper');

const ctx = { resolve: (n: string) => personaCards.find(c => c.name.split(' ')[0]!.toLowerCase() === n.toLowerCase())?.id ?? null, owner: (f: string) => (f === 'barney_confessed' ? 'dream' as const : 'story' as const) };
const rulesOf = (id: string) => dreamRules(personaCards.find(c => c.id === id)!, ctx);
const names: DreamNames = { name: id => id.charAt(0).toUpperCase() + id.slice(1), placeName: p => p.split('.')[1]!, placeOf: () => 'market_row.general_store', projectName: id => id };
const world = (over: Partial<DreamWorld> = {}): DreamWorld => ({ day: 6, regard: () => 0, met: () => true, flags: new Set(), project: () => 'none', fairWins: 0, arrivals: new Set(), favors: [], ...over });
const book = (stage: number, status: Favor['status']): Pick<Favor, 'status' | 'expires_day' | 'reward' | 'task'>[] => [{
  status, expires_day: 9, reward: { regard: 10, coins: 10, items: [], dream: dreamRewardTag('barney', stage) },
  task: { kind: 'chore', place: 'market_row.general_store', item: null, recipient: 'barney', minutes: 30, stayFactor: null }
}];
const progress = (stage: number, learned = 3): DreamProgress => ({ learned, how: 'stage', stage, done: Array.from({ length: stage }, (_, s) => ({ stage: s, day: learned, by: 'regard' as const, printed: null })) });

describe('a dream’s next step', () => {
  const barney = rulesOf('barney');
  it('says what it waits for, or what to do', () => {
    expect(dreamNextStep(barney, progress(0), world({ regard: () => 31 }), names, [])).toEqual({
      words: 'Get him to talk about the books', how: 'Waits until Barney trusts you more (Regard 40; now 31).', actionable: false, place: null
    });
    expect(dreamNextStep(barney, progress(1), world(), names, [])).toMatchObject({ how: 'Barney will ask for your help with it soon.', actionable: false });
    expect(dreamNextStep(barney, progress(1), world(), names, book(1, 'proposed'))).toMatchObject({ how: 'Barney has a Favor to ask: talk to them (general_store).', actionable: true });
    expect(dreamNextStep(barney, progress(1), world(), names, book(1, 'accepted'))).toMatchObject({
      how: "You said you'd help: half an hour at general_store (E there), by Day 9.", actionable: true, place: 'market_row.general_store'
    });
    expect(dreamNextStep(barney, progress(3), world(), names, [])).toBeNull();
  });

  it('names a story stage, and a stage waiting on the story or a newcomer', () => {
    expect(dreamNextStep(rulesOf('bertrand'), progress(1), world(), names, [])!.how).toBe('This one comes with the story: watch for it.');
    expect(dreamNextStep(rulesOf('kasimir'), progress(3), world(), names, [])!.how).toBe('Waits for something later in the story.');
    expect(dreamNextStep(rulesOf('odile'), progress(2), world(), names, [])!.how).toBe('Waits until a baker or a cook comes to live in Monde.');
  });
});

describe('the Quests page', () => {
  const o = objectives({
    day: 6, minute: 600, zone: 'old_quarter', hint: null, upcoming: null, cast: () => [], favors: [], projects: [], dreams: [], marks: [], springOver: false,
    places: { placeName: id => id, zoneName: id => id, route: () => [] }
  });
  it('lists the last beats, the Favors taken on (soonest first) and asked, and the dreams (unfinished first)', () => {
    const favors = [
      { id: 'b', resident: 'nell', name: 'Nell', status: 'accepted' as const, task: 't', place: 'wharf.x', placeName: 'x', by: 9, dream: null },
      { id: 'a', resident: 'odile', name: 'Odile', status: 'accepted' as const, task: 't', place: 'wharf.x', placeName: 'x', by: 7, dream: null },
      { id: 'c', resident: 'hollis', name: 'Hollis', status: 'proposed' as const, task: 't', place: 'wharf.x', placeName: 'x', by: 8, dream: null }
    ];
    const rules = new Map(['barney', 'bertrand', 'odile'].map(id => [id, rulesOf(id)]));
    const log = questLog({
      objectives: o, beats: ['The Ferry', 'The Walk', 'The Cottage', "Monde's Marks"].map((t, i) => ({ id: `b${i}`, title: t })),
      projects: [], favors, dreams: { bertrand: progress(4, 1), barney: progress(1, 5), odile: progress(1, 2) }, rules: id => rules.get(id), world: world(), names, favorBook: []
    });
    expect(log.beats.map(b => b.title)).toEqual(['The Walk', 'The Cottage', "Monde's Marks"]);
    expect(log.beats).toHaveLength(BEATS_SHOWN);
    expect(log.favors.map(f => f.id)).toEqual(['a', 'b']);
    expect(log.offers.map(f => f.id)).toEqual(['c']);
    expect(log.dreams.map(d => [d.resident, d.stage, d.total, d.complete])).toEqual([['odile', 1, 5, false], ['barney', 1, 3, false], ['bertrand', 4, 4, true]]);
    expect(log.dreams[1]).toMatchObject({ name: 'Barney', dream: 'To close the till one Saturday with the sundries line empty, having told Nell first.', done: [{ words: 'Get him to talk about the books', day: 5 }] });
    expect(log.dreams[2]!.next).toBeNull();
  });

  it('titles a beat without its code or variant', () => {
    expect(beatTitle('S01b · The Walk')).toBe('The Walk');
    expect(beatTitle('S07 · Quarter Chime (variant A: the pinion is fitted)')).toBe('Quarter Chime');
  });
});

describe("the Lantern's dream notices", () => {
  it('prints each stage once, the morning after (or the dawn of) the day it was done, never a hidden dream', () => {
    const dreams: Record<string, DreamProgress> = {
      odile: { learned: 2, how: 'regard', stage: 1, done: [{ stage: 0, day: 4, by: 'regard', printed: null }] },
      barney: { learned: 2, how: 'stage', stage: 1, done: [{ stage: 0, day: 4, by: 'regard', printed: null }] },
      felix: { learned: 2, how: 'regard', stage: 1, done: [{ stage: 0, day: 6, by: 'favor', printed: null }] }
    };
    const hidden = (id: string) => id === 'barney';
    const first = dreamNotices(dreams, 5, id => id, hidden);
    expect(first.notices).toEqual(["odile is a step nearer a long-held wish, with the Fellow's help."]);
    expect(first.dreams.barney!.done[0]!.printed).toBe(5);
    expect(first.dreams.felix!.done[0]!.printed).toBeNull();
    expect(dreamNotices(first.dreams, 5, id => id, hidden).notices).toEqual([]);
    const done = { tib: { learned: 2, how: 'regard' as const, stage: 4, done: [{ stage: 3, day: 5, by: 'story' as const, printed: null }] } };
    expect(dreamNotices(done, 5, () => 'Tib', () => false).notices).toEqual(["Tib's long-held wish has come true, with the Fellow's help."]);
    const many = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(id => [id, dreams.odile!]));
    expect(dreamNotices(many, 5, id => id, () => false).notices).toHaveLength(DREAM_NOTICES_MAX);
  });
});
