// Dreams as side quests (quests/dreams.ts): the stage conditions over every card, learning, advancing and rewards.
import { describe, expect, it, vi } from 'vitest';
import { dreamRewardTag, dreamStages, type DreamProgress, type Favor, type PersonaCard } from '@monde/shared';
vi.mock('phaser', () => import('../../qa/__tests__/phaserStub'));
const { personaCards } = await import('../../world/residents');
const { flagOwner, rulesFor, hasPlayableDream } = await import('../runtime');
import {
  DREAM_FAVORS_MAX, FINAL_REGARD, LEARN_REGARD, STAGE_REGARD, checkDreams, dreamRules, dueDreamFavors, learnHow, stageMet, type DreamWorld, type RuleContext
} from '../dreams';

const card = (id: string): PersonaCard => personaCards.find(c => c.id === id)!;
const ctx: RuleContext = { resolve: n => personaCards.find(c => c.name.split(' ')[0]!.toLowerCase() === n.toLowerCase() || c.id === n.toLowerCase())?.id ?? null, owner: flagOwner };
const rules = (id: string) => dreamRules(card(id), ctx);

function world(over: Partial<DreamWorld> & { regardOf?: Record<string, number>; metIds?: string[]; flagSet?: string[] } = {}): DreamWorld {
  const { regardOf = {}, metIds = [], flagSet = [], ...rest } = over;
  return {
    day: 5, regard: id => regardOf[id] ?? 0, met: id => metIds.includes(id), flags: new Set(flagSet), project: () => 'none', fairWins: 0,
    arrivals: new Set(), favors: [], ...rest
  };
}
const done = (resident: string, stage: number, regard = 10): Favor => ({
  id: `dream_${resident}_${stage}_0`, resident_id: resident, template: 'help_chore', target: resident, text: '', created_day: 1, expires_day: 9,
  status: 'completed', task: { kind: 'chore', place: 'x.y', item: null, recipient: resident, minutes: 30, stayFactor: null },
  reward: { regard, coins: 10, items: [], dream: dreamRewardTag(resident, stage) }, found: false
});

describe('every card’s dream stages', () => {
  it('parses all of them, and works the ones with nothing to check as Favors', () => {
    const all = personaCards.flatMap(c => dreamStages(c).map(s => ({ id: c.id, ...s })));
    const fallback = all.filter(s => s.fallback);
    const readable = all.filter(s => !s.fallback);
    // The report (MVP §4 hand-off): 212 cards, 660 stages.
    console.log(`dream stages: ${all.length} on ${personaCards.length} cards · ${readable.length} with conditions the engine reads · ${fallback.length} worked as Favors (no machine-readable condition)`);
    expect(personaCards).toHaveLength(212);
    expect(all.length).toBe(660);
    expect(readable.length + fallback.length).toBe(all.length);
    // Every stage gets a rule, and a fallback stage is always a Favor.
    for (const c of personaCards) {
      const r = dreamRules(c, ctx);
      expect(r.stages).toHaveLength(c.dream.stages.length);
      for (const s of r.stages) {
        if (s.fallback) expect(s.deed).toBe('favor');
        expect(s.words.length).toBeGreaterThan(0);
        expect(s.words).not.toMatch(/[()]/);
      }
    }
    // A stage that has a parenthetical but nothing readable in it (a designer's note) is a fallback, and is listed here.
    const notesOnly = all.filter(s => s.fallback && /\(/.test(s.text)).map(s => `${s.id}: ${s.text}`);
    console.log(`notes only:\n${notesOnly.join('\n')}`);
    expect(notesOnly).toEqual([]);
  });

  it('names who a Regard threshold is with, and which flags are the story’s and which the dream’s', () => {
    expect(rules('amara_borowski').stages[1]!.gates).toEqual([{ kind: 'regard', min: 30, who: 'kasimir' }]);
    const bertrand = rules('bertrand');
    expect(bertrand.stages.map(s => [s.deed, s.signal])).toEqual([['favor', null], ['signal', 'pinion_found'], ['favor', null], ['signal', 'clock_running']]);
    const barney = rules('barney');
    expect(barney.hidden).toBe(true);
    expect(barney.stages.map(s => s.deed)).toEqual(['gates', 'favor', 'favor']);
    expect(barney.stages[2]).toMatchObject({ signal: null, sets: ['barney_confessed'] });
    expect(rules('bastien').stages[2]?.sets).toEqual(['bastien_in_pub']);
    // S06's coin is the story's: the dream waits for it, and no Favor stands in for the choice.
    expect(rules('vane').stages[0]).toMatchObject({ deed: 'signal', signal: 'vanes_coin', sets: [] });
    expect(rules('ines').stages[1]).toMatchObject({ deed: 'signal', signal: 'ines_found_no_site' });
    expect(rules('odile').stages[1]).toMatchObject({ deed: 'signal', signal: 'bakery_ovens_fixed' });
    expect(rules('odile').stages[2]).toMatchObject({ deed: 'gates', gates: [{ kind: 'arrival', archetypes: ['cook_baker'] }] });
    expect(rules('rook').stages[3]!.gates).toEqual([{ kind: 'regard', min: 60, who: 'rook' }, { kind: 'scuffles', won: 3 }]);
    expect(flagOwner('clock_running')).toBe('story');
    expect(flagOwner('option_public')).toBe('story');
    expect(flagOwner('barney_confessed')).toBe('dream');
    // The Marks set charter_half with the third fragment (scenes/riddles.ts): Margo's stage waits for it.
    expect(flagOwner('charter_half')).toBe('story');
    expect(rules('margo').stages[2]).toMatchObject({ deed: 'signal', signal: 'charter_half', sets: [] });
    expect(flagOwner('not_a_flag_anywhere')).toBe('unknown');
  });

  it('leaves the cat and the under-fives out', () => {
    expect(hasPlayableDream(card('bastien'))).toBe(false);
    expect(rulesFor('bastien')).toBeUndefined();
    expect(rulesFor('odile')?.stages).toHaveLength(5);
  });
});

describe('learning a dream', () => {
  it('at the first stage’s own Regard threshold, else at Neighbor, and only once met', () => {
    expect(learnHow(rules('odile'), world({ regardOf: { odile: 29 }, metIds: ['odile'] }))).toBeNull();
    expect(learnHow(rules('odile'), world({ regardOf: { odile: 30 }, metIds: ['odile'] }))).toBe('regard');
    expect(learnHow(rules('felix'), world({ regardOf: { felix: LEARN_REGARD }, metIds: ['felix'] }))).toBe('regard');
    expect(learnHow(rules('felix'), world({ regardOf: { felix: LEARN_REGARD } }))).toBeNull();
  });

  it('when the story has done one of its stages, met or not', () => {
    expect(learnHow(rules('bertrand'), world({ flagSet: ['pinion_found'] }))).toBe('story');
  });

  it('a hidden dream only when its first stage is done', () => {
    const r = rules('barney');
    expect(learnHow(r, world({ regardOf: { barney: 90 }, metIds: ['barney'] }))).toBeNull();
    const check = checkDreams({}, [r], world({ regardOf: { barney: 40 }, metIds: ['barney'] }));
    expect(check.learned).toEqual([{ resident: 'barney', how: 'stage' }]);
    expect(check.dreams.barney).toMatchObject({ stage: 1, how: 'stage', done: [{ stage: 0, by: 'regard' }] });
    expect(checkDreams({}, [r], world({ regardOf: { barney: 39 }, metIds: ['barney'] })).dreams).toEqual({});
  });
});

describe('advancing a dream', () => {
  const known = (resident: string, stage = 0, day = 1): DreamProgress => ({ learned: day, how: 'regard', stage, done: [] });

  it('moves a Regard stage when it’s reached, paid STAGE_REGARD', () => {
    const check = checkDreams({ odile: known('odile') }, [rules('odile')], world({ regardOf: { odile: 31 }, metIds: ['odile'] }));
    expect(check.done).toEqual([{ resident: 'odile', stage: 0, words: 'Admit she needs help', by: 'regard', regard: STAGE_REGARD, sets: [], final: false, skipped: false }]);
    expect(check.dreams.odile!.stage).toBe(1);
  });

  it('moves a Favor stage on its own completed Favor only, which pays it', () => {
    const r = rules('barney'), p = { barney: { ...known('barney'), stage: 1 } };
    expect(checkDreams(p, [r], world({ favors: [done('barney', 2)] })).done).toEqual([]);
    const check = checkDreams(p, [r], world({ favors: [done('barney', 1)] }));
    expect(check.done).toMatchObject([{ stage: 1, by: 'favor', regard: 0 }]);
    expect(check.dreams.barney!.stage).toBe(2);
  });

  it('finishes the dream at FINAL_REGARD in all, and sets the dream’s own flag', () => {
    const r = rules('barney');
    const check = checkDreams({ barney: { ...known('barney'), stage: 2 } }, [r], world({ favors: [done('barney', 2, 10)] }));
    expect(check.done).toMatchObject([{ stage: 2, by: 'favor', regard: FINAL_REGARD - 10, sets: ['barney_confessed'], final: true }]);
    expect(check.dreams.barney!.stage).toBe(3);
  });

  it('carries the dream to a later stage the story has reached, the skipped stages unpaid', () => {
    const check = checkDreams({ bertrand: known('bertrand') }, [rules('bertrand')], world({ flagSet: ['pinion_found', 'clock_running'] }));
    expect(check.done.map(d => [d.stage, d.by, d.regard, d.skipped])).toEqual([[0, 'story', 0, true], [1, 'story', 0, true], [2, 'story', 0, true], [3, 'story', FINAL_REGARD, false]]);
    expect(check.dreams.bertrand).toMatchObject({ stage: 4 });
  });

  it('waits on gates: a flag, a Project, Rook’s fair Scuffles, a newcomer', () => {
    const odile = rules('odile');
    const at2 = { odile: { ...known('odile'), stage: 2 } };
    expect(stageMet(odile, 2, world())).toBeNull();
    expect(stageMet(odile, 2, world({ arrivals: new Set(['cook_baker']) }))).toBe('gates');
    const rook = rules('rook');
    expect(stageMet(rook, 0, world({ regardOf: { rook: 25 } }))).toBeNull();
    expect(stageMet(rook, 0, world({ regardOf: { rook: 25 }, fairWins: 1 }))).toBe('gates');
    expect(checkDreams(at2, [odile], world({ arrivals: new Set(['cook_baker']) })).dreams.odile!.stage).toBe(3);
    const june = rules('june');
    expect(stageMet(june, 0, world({ project: () => 'begun' }))).toBeNull();
    expect(stageMet(june, 0, world({ project: () => 'open' }))).toBe('gates');
  });

  it('returns the same object when nothing moved', () => {
    const p = { odile: known('odile') };
    expect(checkDreams(p, [rules('odile')], world({ regardOf: { odile: 5 } })).dreams).toBe(p);
  });
});

describe('the Favors the dreams ask', () => {
  const at = (stage: number, doneDay?: number): DreamProgress => ({ learned: 1, how: 'regard', stage, done: doneDay ? [{ stage: stage - 1, day: doneDay, by: 'regard', printed: null }] : [] });
  const open = (id: string, resident: string, dream: string | null = null): DreamWorld['favors'][number] =>
    ({ id, resident_id: resident, status: 'proposed', expires_day: 9, reward: { regard: 10, coins: 0, items: [], dream } });

  it('offers a known dream’s Favor stage once its gates hold, one per resident, and not on the day a stage was done', () => {
    const r = [rules('barney'), rules('delphine')];
    expect(dueDreamFavors({ barney: at(1) }, r, world(), () => false)).toEqual([{ resident: 'barney', stage: 1 }]);
    expect(dueDreamFavors({ barney: at(1, 5) }, r, world(), () => false)).toEqual([]);
    expect(dueDreamFavors({ barney: at(1, 4) }, r, world(), () => false)).toEqual([{ resident: 'barney', stage: 1 }]);
    expect(dueDreamFavors({ barney: at(1) }, r, world({ favors: [open('quiet_chore_barney_0', 'barney')] }), () => false)).toEqual([]);
    expect(dueDreamFavors({ barney: at(1) }, r, world({ favors: [open('x', 'barney', dreamRewardTag('barney', 1))] }), () => false)).toEqual([]);
    expect(dueDreamFavors({ barney: at(1) }, r, world(), () => true)).toEqual([]);
    expect(dueDreamFavors({ barney: at(1) }, r, world({ leaving: new Set(['barney']) }), () => false)).toEqual([]);
    // Delphine's third stage is a Favor once she trusts the player at 50.
    expect(dueDreamFavors({ delphine: at(2) }, r, world({ regardOf: { delphine: 49 } }), () => false)).toEqual([]);
    expect(dueDreamFavors({ delphine: at(2) }, r, world({ regardOf: { delphine: 50 } }), () => false)).toEqual([{ resident: 'delphine', stage: 2 }]);
  });

  it(`keeps to ${DREAM_FAVORS_MAX} dream Favors and the town’s six`, () => {
    const ids = ['barney', 'felix', 'hollis', 'margo', 'nell', 'priya'];
    const r = ids.map(rules);
    const dreams = Object.fromEntries(ids.map(id => [id, at(id === 'barney' ? 1 : 0)]));
    expect(dueDreamFavors(dreams, r, world({ regardOf: { margo: 20 } }), () => false)).toHaveLength(DREAM_FAVORS_MAX);
    const full = ['a', 'b', 'c', 'd', 'e', 'f'].map(x => open(`f_${x}`, x));
    expect(dueDreamFavors(dreams, r, world({ favors: full }), () => false)).toEqual([]);
  });
});
