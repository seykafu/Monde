// The first-steps card's words (quests/hud.ts) and the objective as the dialogue reads it (quests/runtime.ts).
import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
vi.mock('phaser', () => import('../../qa/__tests__/phaserStub'));
const { firstStepsLines } = await import('../hud');
const { objectives } = await import('../objective');
const { currentObjective, currentObjectives } = await import('../runtime');
const { OBJECTIVE_KEY } = await import('../state');
const { FlagStore } = await import('../../story/flags');
const { SPRING_SCENES } = await import('../../story/session');
const { upcomingBeat, zoneRoute } = await import('../../story/hint');
const { buildStoryContext, emptyLedger } = await import('../../story/host');
const { createTownState } = await import('../../town/pillars');
const { placeName } = await import('../../world/player');
const { zones } = await import('../../world/zones');

const places = { placeName, zoneName: (id: string) => zones[id]?.name ?? id, route: (a: string, b: string) => zoneRoute(zones, a, b) };

function registry() {
  const data = new Map<string, unknown>();
  const r = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => { data.set(k, v); return r; }, has: (k: string) => data.has(k), remove: (k: string) => data.delete(k) };
  return r as unknown as Phaser.Data.DataManager;
}

describe('the first-steps card', () => {
  it('after the cottage, says where the story picks up, and that the Tasks and the map keep track', () => {
    const flags = new FlagStore({ dev: true });
    for (const f of ['s01a_done', 's01b_done', 's01c_done', 'cottage_keys_given']) flags.set(f);
    const ctx = buildStoryContext({ day: 1, minute: 13 * 60, zone: 'old_quarter', place: 'old_quarter.lamplighter_cottage', town: createTownState({ day: 1 }) }, emptyLedger());
    const upcoming = upcomingBeat(SPRING_SCENES, ctx, flags, places);
    const o = objectives({ day: 1, minute: 780, zone: 'old_quarter', hint: null, upcoming, cast: () => [], favors: [], projects: [], dreams: [], marks: [], springOver: false, places });
    expect(firstStepsLines(o)).toEqual([
      'The cottage is yours, and so is the rest of the day.',
      'Next: tomorrow, 10:00–12:00, Monde Free Library, Old Quarter. Margo is opening the Marks log.',
      "Every fix raises the town's Appeal (under the clock): at 35, new people start stepping off the ferry. Your Tasks (T) and the map (M) show where to go."
    ]);
    expect(o.hud).toMatchObject({ header: 'MEANWHILE', title: 'Talk to residents around the Old Quarter', reason: 'Next: tomorrow, 10:00–12:00, Monde Free Library, Old Quarter.' });
  });
});

describe('the objective for the dialogue', () => {
  it('is what the HUD last showed, or worked out fresh, and never nothing', () => {
    const r = registry();
    expect(currentObjective(r)).toMatchObject({ kind: 'explore', title: 'Talk to residents around the Old Quarter' });
    const shown = { ...currentObjectives(r), hud: { ...currentObjective(r), title: 'Shown on the HUD' } };
    r.set(OBJECTIVE_KEY, shown);
    expect(currentObjective(r).title).toBe('Shown on the HUD');
  });
});

it('follows Bertrand’s weekday visits in the objective, Tasks and dream instructions', async () => {
  const { ResidentSim } = await import('../../sim/residentSim');
  const { ZoneGraph } = await import('../../world/nav');
  const { findCard } = await import('../../world/roster');
  const { getFriendship } = await import('../../scenes/friendship');
  const { tasksNow, questLogNow, hudThreadsNow } = await import('../runtime');
  const { dreamRewardTag } = await import('@monde/shared');
  const r = registry();
  const clock = { day: 1, minute: 660 };
  r.set('monde.clock', clock);
  r.set('monde.residents', new ResidentSim([findCard('bertrand')!], { zones, graph: new ZoneGraph(zones) }));
  r.set('monde.friendship', { ...getFriendship(r), favor_book: [{
    id: 'key', resident_id: 'bertrand', status: 'proposed', expires_day: 4, task: { kind: 'find', place: 'old_quarter.library', item: 'key' },
    reward: { dream: dreamRewardTag('bertrand', 0) }
  }] });
  r.set('monde.quests', { dreams: { bertrand: { stage: 0, done: [] } } });
  const snapshot = hudThreadsNow(r, {});
  const tower = snapshot.objectives.hud;
  expect(tower).toMatchObject({ kind: 'offer', place: 'old_quarter.bertrand_house', when: 'by Day 4', where: expect.stringMatching(/^Indoors at Clocktower until \d+:\d\d, then at Achterberg Horlogerie$/) });
  const log = questLogNow(r);
  expect(log.dreams[0]?.next).toMatchObject({ place: tower.place, how: expect.stringContaining(tower.where) });
  for (const kind of ['offer', 'dream']) expect(snapshot.tasks.find(row => row.kind === kind)).toMatchObject({ where: tower.where, place: tower.place, when: kind === 'offer' ? 'by Day 4' : '' });
  const step = log.dreams[0]!.next!;
  const dream = objectives({ day: 1, minute: clock.minute, zone: 'old_quarter', hint: null, upcoming: null, cast: () => [],
    favors: [], projects: [], marks: [], springOver: false, places,
    dreams: [{ resident: 'bertrand', name: 'Bertrand', next: step.words, actionable: true, place: step.place, placeName: null, person: step.person }] }).hud;
  expect(dream).toMatchObject({ kind: 'dream', title: 'Talk to Bertrand', when: '', where: tower.where, place: tower.place });

  clock.minute = 18 * 60;
  const square = currentObjective(r);
  expect(square).toMatchObject({ title: 'Talk to Bertrand', where: expect.stringMatching(/^Fountain Square, until /), place: 'old_quarter.fountain_square', when: 'by Day 4' });
  expect(tasksNow(r).find(t => t.kind === 'offer')).toMatchObject({ place: square.place, where: square.where, when: square.when });
  expect(square.line).toBe(`Talk to Bertrand · ${square.where} · by Day 4`);
  const { parseClock } = await import('../../sim/clock');
  const departure = parseClock(square.where.replace('Fountain Square, until ', ''))!;
  clock.minute = departure - 1;
  expect(currentObjective(r).place).toBe(square.place);
  clock.minute = departure;
  expect(currentObjective(r)).toMatchObject({ place: 'old_quarter.bertrand_house', where: expect.stringMatching(/^Heading to Achterberg Horlogerie, there until /) });
});

it.each([false, true])('keeps the original offer location without a resident plan (sim present: %s)', async hasSim => {
  const { getFriendship } = await import('../../scenes/friendship');
  const { hudThreadsNow } = await import('../runtime');
  const r = registry();
  if (hasSim) r.set('monde.residents', { planFor: () => null });
  r.set('monde.friendship', { ...getFriendship(r), favor_book: [{
    id: 'key', resident_id: 'bertrand', status: 'proposed', expires_day: 6,
    task: { kind: 'find', place: 'old_quarter.library', item: 'key' }, reward: {}
  }] });
  const { objectives, tasks } = hudThreadsNow(r, {});
  expect(objectives.hud).toMatchObject({ where: 'Monde Free Library', place: 'old_quarter.library', when: 'by Day 6' });
  expect(tasks.find(t => t.kind === 'offer')).toMatchObject({ where: 'Monde Free Library · Old Quarter', when: 'by Day 6' });
});
