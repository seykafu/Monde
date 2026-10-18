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
  it('after the cottage, says where the story picks up, and that the Quests page keeps track', () => {
    const flags = new FlagStore({ dev: true });
    for (const f of ['s01a_done', 's01b_done', 's01c_done', 'cottage_keys_given']) flags.set(f);
    const ctx = buildStoryContext({ day: 1, minute: 13 * 60, zone: 'old_quarter', place: 'old_quarter.lamplighter_cottage', town: createTownState({ day: 1 }) }, emptyLedger());
    const upcoming = upcomingBeat(SPRING_SCENES, ctx, flags, places);
    const o = objectives({ day: 1, minute: 780, zone: 'old_quarter', hint: null, upcoming, cast: () => [], favors: [], projects: [], dreams: [], marks: [], springOver: false, places });
    expect(firstStepsLines(o)).toEqual([
      'The cottage is yours, and so is the rest of the day.',
      'Next: tomorrow, 10:00–12:00, Monde Free Library, Old Quarter. Margo is opening the Marks log.',
      'Your Journal’s Quests page (J) keeps track of where to go. Until then, say hello to the neighbours (E).'
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
