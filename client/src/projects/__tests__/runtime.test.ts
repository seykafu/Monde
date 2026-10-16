// The Projects runtime's registry glue (MVP G-03): what it reads and must never write behind the game's back.
import { describe, expect, it } from 'vitest';
import { emptyEventLog, emptyFriendship } from '@monde/shared';
import { getFellow, setFellow, unsignedFellow } from '../../fellow/state';
import { createTownState } from '../../town/pillars';
import { flagsOf, projectCue, projectsOf, syncProjects, workAt } from '../runtime';

function registry() {
  const data = new Map<string, unknown>();
  const r = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => { data.set(k, v); return r; }, remove: (k: string) => data.delete(k) };
  r.set('monde.town', createTownState({ day: 5 }));
  r.set('monde.friendship', emptyFriendship());
  r.set('monde.events', emptyEventLog());
  r.set('monde.economy', { stamina: 100, maxStamina: 100, day: 5, gifts: {}, work: {} });
  return r;
}

describe('the Projects runtime', () => {
  it("never signs the Fellowship form itself: a New Game's Fellow stays unsigned until S01a", () => {
    const r = registry();
    syncProjects(r, { day: 5, minute: 600 });
    expect(getFellow(r)).toBeNull();
    expect(projectCue(r, { day: 5, minute: 600 }, 'fountain', 's04_water_again')).toBe(true);
    expect(getFellow(r)).toBeNull();
    // An unsigned Fellow is no Tinkerer: one VH a shift, and no XP to give without a Fellow.
    expect(workAt(r, { day: 5, minute: 600 }, 'fountain')).toMatchObject({ ok: true, vh: 1 });
    expect(getFellow(r)).toBeNull();
    setFellow(r, unsignedFellow());
    workAt(r, { day: 5, minute: 700 }, 'fountain');
    expect(getFellow(r)?.skills.handiwork.xp).toBe(10);
    expect(getFellow(r)?.profile).toBeNull();
  });

  it("reads the story's flags and the town engine's together", () => {
    const r = registry();
    r.set('monde.story.flags', { pz06_solved: true, $story: '{}' });
    r.set('monde.town', { ...createTownState({ day: 8 }), flags: { project_streetlights_done: true } });
    expect([...flagsOf(r)].sort()).toEqual(['project_streetlights_done', 'pz06_solved']);
    syncProjects(r, { day: 8, minute: 600 });
    expect(Object.keys(projectsOf(r).projects).sort()).toEqual(['bakery_ovens', 'community_garden', 'streetlights']);
  });
});
