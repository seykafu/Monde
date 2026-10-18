import { describe, expect, it } from 'vitest';
import { SPRING_RIDDLES, TalkQuest, containsAnswer, emptyFriendship, emptyRiddles, isKeyCharacter, type Favor, type PersonaCard } from '@monde/shared';
import { createTownState } from '../../town/pillars';
import { personaCards } from '../../world/residents';
import { HINT_KEY, type StoryHint } from '../../story/hint';
import { projectsOf, syncProjects } from '../../projects/runtime';
import {
  MARK_HELPERS, QUEST_REPLY_ID, cut, dayPart, questContext, questObjective, questQuietLine, questReply, questThreads, questWhen, questWhere,
  stripKeyHints
} from '../questTalk';
import { projectOpening, projectSteps, talkQuest } from '../questSources';

const card = (id: string): PersonaCard => {
  const found = personaCards.find(c => c.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found;
};

// The S07a window (Day 14, the clocktower, 16:00–17:45), as story/hint.ts storyHint writes it before it opens.
const S07A_HINT: StoryHint = {
  sceneId: 's07a_chime_runs', place: 'old_quarter.clocktower', placeName: 'Clocktower', zoneName: 'Old Quarter', via: null,
  start: 960, end: 1065, open: false, summoned: false, reason: 'Bertrand is at the clocktower.', where: 'Clocktower',
  when: '16:00–17:45', text: 'Clocktower, 16:00–17:45 — Bertrand is at the clocktower'
};
// S01b on Day 1 just after the ferry: the window is open and the square is in the next district.
const S01B_HINT: StoryHint = {
  sceneId: 's01b_walk', place: 'old_quarter.fountain_square', placeName: 'Fountain Square', zoneName: 'Old Quarter', via: null,
  start: 640, end: 690, open: true, summoned: false, reason: 'Pell is waiting.', where: 'Fountain Square, Old Quarter',
  when: 'before 11:30', text: 'Fountain Square, Old Quarter, before 11:30 — Pell is waiting'
};
const S07A_CAST = ['bertrand', 'pell', 'margo', 'tib', 'hollis'];

function registry() {
  const data = new Map<string, unknown>();
  const r = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => { data.set(k, v); return r; }, remove: (k: string) => data.delete(k) };
  r.set('monde.town', createTownState({ day: 14 }));
  r.set('monde.friendship', emptyFriendship());
  r.set('monde.economy', { stamina: 100, maxStamina: 100, day: 14, gifts: {}, work: {} });
  return r;
}

const favor = (over: Partial<Favor> = {}): Pick<Favor, 'resident_id' | 'status' | 'text' | 'expires_day'> =>
  ({ resident_id: 'june', status: 'accepted', text: 'Could you bring me a rye loaf from Odile’s?', expires_day: 16, ...over });

describe('the objective a turn reports', () => {
  it('uses the Next hint’s words, with a day part for the window', () => {
    expect(questObjective(S07A_HINT, S07A_CAST)).toEqual({
      id: 's07a_chime_runs', place: 'old_quarter.clocktower', where: 'Clocktower', when: 'this afternoon (16:00–17:45)',
      reason: 'Bertrand is at the clocktower.', people: S07A_CAST
    });
    expect(questObjective(S01B_HINT, ['pell', 'bertrand'])).toMatchObject({ where: 'Fountain Square, Old Quarter', when: 'now (until 11:30)' });
    expect(questObjective(null, S07A_CAST)).toBeNull();
    // A via route still names the place itself, with its district.
    expect(questWhere({ where: 'Market Row, then Fountain Square', placeName: 'Fountain Square', zoneName: 'Old Quarter' })).toBe('Fountain Square, Old Quarter');
  });

  it('names the part of the day by the window’s start', () => {
    expect([dayPart(9 * 60), dayPart(12 * 60), dayPart(16 * 60), dayPart(17 * 60 + 30), dayPart(22 * 60)])
      .toEqual(['this morning', 'this afternoon', 'this afternoon', 'this evening', 'tonight']);
    expect(questWhen({ open: false, start: 1140, end: 1380 })).toBe('this evening (19:00–23:00)');
  });

  it('fits the schema the server reads', () => {
    expect(TalkQuest.safeParse(questContext(card('bertrand'), questObjective(S07A_HINT, S07A_CAST), [])).success).toBe(true);
    const long = questObjective({ ...S07A_HINT, reason: 'word '.repeat(80) }, [...S07A_CAST, 'BAD id', ...'abcdefghijkl'.split('')]);
    expect(long!.reason.length).toBeLessThanOrEqual(120);
    expect(long!.people).not.toContain('BAD id');
    expect(TalkQuest.safeParse({ objective: long, threads: [] }).success).toBe(true);
  });
});

describe('a resident’s threads', () => {
  it('lists an accepted Favor they asked, a Project they lead and a Mark they can help with', () => {
    const projects = [{ name: 'the fountain', leads: ['kasimir', 'bertrand'], next: 'Work at Fountain Square (E, 10 Stamina an hour), or ask neighbours to lend a hand (H).' }];
    expect(questThreads('june', { day: 14, favors: [favor()], projects, openMark: true })).toEqual([{ kind: 'favor', text: 'Could you bring me a rye loaf from Odile’s?', until: 16 }]);
    expect(questThreads('bertrand', { day: 14, favors: [favor()], projects, openMark: true })).toEqual([
      { kind: 'project', name: 'the fountain', next: 'Work at Fountain Square, or ask neighbours to lend a hand.' },
      { kind: 'mark' }
    ]);
    for (const helper of MARK_HELPERS) expect(questThreads(helper, { day: 14, favors: [], projects: [], openMark: true })).toContainEqual({ kind: 'mark' });
    expect(questThreads('odile', { day: 14, favors: [], projects, openMark: true })).toEqual([]);
  });

  it('leaves out proposed, finished and lapsed Favors, and anyone else’s', () => {
    for (const f of [favor({ status: 'proposed' }), favor({ status: 'completed' }), favor({ expires_day: 13 }), favor({ resident_id: 'odile' })]) {
      expect(questThreads('june', { day: 14, favors: [f], projects: [], openMark: false })).toEqual([]);
    }
  });

  it('drops the Ledger’s key prompts and keeps its times', () => {
    expect(stripKeyHints('Ask Pell to sign for 200 coins (H near her, or her office in the Town Hall).')).toBe('Ask Pell to sign for 200 coins.');
    expect(stripKeyHints('The pinion is found. Bertrand will fit it at Clocktower one afternoon (16:00–17:45, from Day 6).'))
      .toBe('The pinion is found. Bertrand will fit it at Clocktower one afternoon (16:00–17:45, from Day 6).');
    expect(cut('a '.repeat(200), 20).length).toBeLessThanOrEqual(20);
  });
});

describe('the quest reply', () => {
  const objective = questObjective(S07A_HINT, S07A_CAST);
  const quest = { objective, threads: [] };

  it('is offered to a key character the objective involves, in the hint’s words', () => {
    expect(questReply(card('bertrand'), quest, false)).toEqual({ id: QUEST_REPLY_ID, text: 'About the clocktower…', intent: 'about_quest' });
    expect(questReply(card('pell'), questContext(card('pell'), questObjective(S01B_HINT, ['pell', 'bertrand']), []), false)?.text).toBe('About the walk up…');
    // At their workplace: the S03 call at the bakery is Odile's business even though she's not who the hint names.
    const tolls = { objective: { ...objective!, id: 's03_tolls', place: 'market_row.bakery', people: [] }, threads: [] };
    expect(questReply(card('odile'), tolls, false)?.text).toBe('About the bakery…');
  });

  it('is offered to any key character when nothing is waiting today', () => {
    const empty = { objective: null, threads: [] };
    expect(questReply(card('odile'), empty, false)?.text).toBe('What should I be doing?');
    const curated = personaCards.find(c => c.generated_by && c.curated)!;
    expect(questReply(curated, empty, false)?.text).toBe('What should I be doing?');
  });

  it('is not offered with an objective elsewhere, once used, to the cat, to an unfinished census card, or without a report', () => {
    expect(questReply(card('odile'), quest, false)).toBeNull();
    expect(questReply(card('bertrand'), quest, true)).toBeNull();
    expect(questReply(card('bastien'), { objective: null, threads: [] }, false)).toBeNull();
    const plain = personaCards.find(c => c.generated_by && !c.curated && c.kind !== 'animal')!;
    expect(isKeyCharacter(plain)).toBe(false);
    expect(questReply(plain, { objective: null, threads: [] }, false)).toBeNull();
    expect(questReply(plain, { objective: { ...objective!, people: [plain.id] }, threads: [] }, false)).toBeNull();
    expect(questReply(card('bertrand'), null, false)).toBeNull();
  });

  it('counts every hand-written speaking card as a key character', () => {
    for (const c of personaCards.filter(c => !c.generated_by)) expect(isKeyCharacter(c), c.id).toBe(c.kind !== 'animal');
  });

  it('names a Project opening, and falls back to “What’s next?”', () => {
    const opening = { objective: { ...objective!, id: 'project:bakery_ovens', reason: 'The bakery ovens open.', people: ['odile'] }, threads: [] };
    expect(questReply(card('odile'), opening, false)?.text).toBe('About the bakery ovens…');
    const other = { objective: { ...objective!, id: 's99_unknown' }, threads: [] };
    expect(questReply(card('bertrand'), other, false)?.text).toBe("What's next?");
  });

  it('never carries a Mark’s title or answer', () => {
    const threads = questThreads('margo', { day: 14, favors: [], projects: [], openMark: true });
    expect(threads).toEqual([{ kind: 'mark' }]);
    const text = JSON.stringify(threads);
    for (const r of SPRING_RIDDLES) {
      expect(text).not.toContain(r.title);
      expect(containsAnswer(text, r.accepted), r.id).toBe(false);
    }
  });

  it('is answered offline from the Journal’s words', () => {
    expect(questQuietLine(quest)).toBe("If I were you, I'd be at Clocktower, this afternoon (16:00–17:45).");
    expect(questQuietLine({ objective: null, threads: [{ kind: 'project', name: 'the fountain', next: 'Find 2 pipe fittings.' }] })).toBe('My Project could use you: the fountain. Find 2 pipe fittings.');
    expect(questQuietLine({ objective: null, threads: [] })).toMatch(/^Nothing pressing/);
    expect(questQuietLine(null)).toMatch(/^Nothing pressing/);
  });
});

describe('the running game’s report', () => {
  it('reads the story’s Next hint and its scene’s cast', () => {
    const r = registry();
    r.set(HINT_KEY, S07A_HINT);
    const quest = talkQuest({ registry: r, card: card('bertrand'), day: 14, minute: 900, district: 'old_quarter', favors: [], marks: emptyRiddles() });
    expect(quest?.objective).toMatchObject({ id: 's07a_chime_runs', reason: 'Bertrand is at the clocktower.' });
    expect(quest?.objective?.people).toEqual(expect.arrayContaining(S07A_CAST));
    expect(talkQuest({ registry: r, card: card('bastien'), day: 14, minute: 900, district: 'old_quarter', favors: [], marks: emptyRiddles() })).toBeNull();
  });

  it('falls back to a Project opening today, with its leads, as the HUD does', () => {
    const r = registry();
    syncProjects(r, { day: 12, minute: 600 });
    const state = projectsOf(r), p = state.projects.bakery_ovens!;
    r.set('monde.projects', { ...state, projects: { ...state.projects, bakery_ovens: { ...p, ceremony: { day: 12, minute: 900 } } } });
    const opening = projectOpening(r, { day: 12, minute: 800 }, 'market_row');
    expect(opening?.hint).toMatchObject({ sceneId: 'project:bakery_ovens', reason: 'The bakery ovens open.', open: false });
    expect(opening?.leads).toEqual(['odile']);
    r.set(HINT_KEY, null);
    const quest = talkQuest({ registry: r, card: card('odile'), day: 12, minute: 800, district: 'market_row', favors: [], marks: emptyRiddles() });
    expect(quest?.objective).toMatchObject({ id: 'project:bakery_ovens', people: ['odile'], when: 'this afternoon (15:00–17:00)' });
    expect(questReply(card('odile'), quest, false)?.text).toBe('About the bakery ovens…');
    // Odile leads the ovens: her thread carries the Ledger's next step.
    expect(quest?.threads).toContainEqual(expect.objectContaining({ kind: 'project', name: 'the bakery ovens' }));
    expect(projectSteps(r, { day: 12, minute: 800 }).find(s => s.name === 'the bakery ovens')?.leads).toEqual(['odile']);
  });

  it('reports a selected, found Mark only as “there is one”', () => {
    const r = registry();
    const marks = { ...emptyRiddles(), selected: 'OQ-1', entries: { 'OQ-1': { status: 'found' as const, foundAt: 1, hints: 0, attempts: [] } } };
    const quest = talkQuest({ registry: r, card: card('margo'), day: 14, minute: 900, district: 'old_quarter', favors: [], marks });
    expect(quest?.threads).toEqual([{ kind: 'mark' }]);
  });
});
