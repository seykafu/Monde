import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_WORK_WEEKLY_CAP, applyPillarDelta, applyPillarDeltas, calendarWeek, communityWorkRoom, createTownState,
  setTollmenLevelMax, todayChange, type TownState
} from '../pillars';
import { runDawn } from '../townEngine';

const sweep = (s: TownState, times: number, amount = 0.5): TownState => {
  for (let i = 0; i < times; i++) s = applyPillarDelta(s, 'charm', amount, 'community_work', 'Sweep Market Row');
  return s;
};
const dawnTo = (s: TownState, day: number): TownState => {
  while (s.day < day) s = runDawn(s, { day: s.day + 1 }).state;
  return s;
};

describe('applyPillarDelta (GDD §6.1)', () => {
  it('moves a Pillar and logs the change', () => {
    const s = applyPillarDelta(createTownState(), 'charm', 6, 'project', 'fountain');
    expect(s.pillars.charm).toBe(31);
    expect(s.log).toEqual([{ day: 1, pillar: 'charm', source: 'project', requested: 6, applied: 6, capped: false, note: 'fountain' }]);
  });

  it('does not mutate the state it is given', () => {
    const before = createTownState();
    const after = applyPillarDelta(before, 'safety', 3, 'scuffle');
    expect(before.pillars.safety).toBe(30);
    expect(before.log).toHaveLength(0);
    expect(after.pillars.safety).toBe(33);
  });

  it('clamps to 0–100 and logs what actually moved', () => {
    let s = applyPillarDelta(createTownState(), 'prosperity', 95, 'project');
    expect(s.pillars.prosperity).toBe(100);
    expect(s.log.at(-1)).toMatchObject({ requested: 95, applied: 82 });
    s = applyPillarDelta(s, 'safety', -40, 'tollmen');
    expect(s.pillars.safety).toBe(0);
    expect(s.log.at(-1)).toMatchObject({ requested: -40, applied: -30 });
  });

  it('keeps tenths exact (no float dust)', () => {
    let s = createTownState();
    for (let i = 0; i < 10; i++) s = applyPillarDelta(s, 'spirit', 0.1, 'resident_sim');
    expect(s.pillars.spirit).toBe(23);
  });

  it('rejects a non-number', () => {
    expect(() => applyPillarDelta(createTownState(), 'charm', Number.NaN, 'dev')).toThrow(RangeError);
  });

  it('applies several Pillars from one source', () => {
    const s = applyPillarDeltas(createTownState(), { charm: 6, spirit: 2 }, 'project', 'fountain');
    expect([s.pillars.charm, s.pillars.spirit]).toEqual([31, 24]);
    expect(s.log.map(c => c.pillar)).toEqual(['spirit', 'charm']);
  });

  it('tracks today’s change against the day’s start', () => {
    const s = applyPillarDelta(applyPillarDelta(createTownState(), 'charm', 0.5, 'community_work'), 'safety', -1, 'tollmen');
    expect(todayChange(s)).toEqual({ prosperity: 0, safety: -1, spirit: 0, charm: 0.5 });
  });

  it('clamps the Tollmen level to 0–3', () => {
    expect(setTollmenLevelMax(createTownState(), 5).tollmenLevelMax).toBe(3);
    expect(setTollmenLevelMax(createTownState(), -1).tollmenLevelMax).toBe(0);
  });
});

describe('the community-work cap (+3 per Pillar per week, §6.1)', () => {
  it('uses calendar weeks, Mon–Sun: Days 1–6, then 7–13 …', () => {
    expect([1, 6, 7, 13, 14, 20, 21].map(calendarWeek)).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });

  it('caps community work at +3 per Pillar in a week', () => {
    let s = sweep(createTownState(), 5); // +2.5
    expect(s.pillars.charm).toBe(27.5);
    expect(communityWorkRoom(s, 'charm')).toBe(0.5);
    s = applyPillarDelta(s, 'charm', 0.8, 'community_work');
    expect(s.pillars.charm).toBe(28);
    expect(s.log.at(-1)).toMatchObject({ requested: 0.8, applied: 0.5, capped: true });
    s = sweep(s, 3);
    expect(s.pillars.charm).toBe(28);
    expect(s.log.at(-1)).toMatchObject({ applied: 0, capped: true });
  });

  it('caps each Pillar separately', () => {
    let s = sweep(createTownState(), 10);
    s = applyPillarDelta(s, 'spirit', 0.3, 'community_work', 'Mail Round');
    expect([s.pillars.charm, s.pillars.spirit]).toEqual([28, 22.3]);
  });

  it('leaves every other source uncapped', () => {
    let s = sweep(createTownState(), 10);
    s = applyPillarDelta(s, 'charm', 6, 'project', 'fountain');
    s = applyPillarDelta(s, 'charm', 1, 'riddle', 'OQ-1');
    s = applyPillarDelta(s, 'charm', 1, 'story');
    s = applyPillarDelta(s, 'charm', 2, 'resident_sim');
    expect(s.pillars.charm).toBe(25 + 3 + 6 + 1 + 1 + 2);
  });

  it('never caps a community-work loss, and a loss gives no room back', () => {
    let s = sweep(createTownState(), 6);
    s = applyPillarDelta(s, 'charm', -1, 'community_work');
    expect(s.pillars.charm).toBe(27);
    expect(communityWorkRoom(s, 'charm')).toBe(0);
  });

  it('resets across a week boundary (Sunday Day 6 → Monday Day 7)', () => {
    let s = dawnTo(createTownState(), 6); // Sunday: still the first week
    s = sweep(s, 8);
    expect(s.pillars.charm).toBe(25 + COMMUNITY_WORK_WEEKLY_CAP);
    expect(communityWorkRoom(s, 'charm')).toBe(0);
    s = dawnTo(s, 7); // Monday
    expect(communityWorkRoom(s, 'charm')).toBe(3);
    s = sweep(s, 8);
    expect(s.pillars.charm).toBe(25 + 2 * COMMUNITY_WORK_WEEKLY_CAP);
    s = dawnTo(s, 13); // Sunday of week 2: still capped
    s = sweep(s, 1);
    expect(s.pillars.charm).toBe(31);
    s = dawnTo(s, 14);
    s = sweep(s, 1);
    expect(s.pillars.charm).toBe(31.5);
  });

  it('spends the week’s cap across days, not per day', () => {
    let s = sweep(createTownState(), 4); // Day 1: +2
    s = dawnTo(s, 3);
    s = sweep(s, 4); // Day 3: only +1 left
    expect(s.pillars.charm).toBe(28);
  });

  it('rolls the week even if the day moved without a dawn', () => {
    let s = sweep(createTownState(), 6);
    s = { ...s, day: 7 };
    s = sweep(s, 1);
    expect(s.pillars.charm).toBe(28.5);
    expect(s.communityWork).toEqual({ week: 1, gained: { prosperity: 0, safety: 0, spirit: 0, charm: 0.5 } });
  });
});
