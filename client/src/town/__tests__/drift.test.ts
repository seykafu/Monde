import { describe, expect, it } from 'vitest';
import { applyDrift, driftDeltas } from '../drift';
import { applyPillarDelta, createTownState, setTollmenLevelMax, type Pillars } from '../pillars';
import { runDawn } from '../townEngine';

const P = (spirit: number, safety = 30): Pillars => ({ prosperity: 18, safety, spirit, charm: 25 });

describe('nightly drift (GDD §6.1)', () => {
  it('Spirit drifts toward 40 by 0.2 a day, from either side, never past it', () => {
    expect(driftDeltas(P(22), 1)).toEqual({ spirit: 0.2 });
    expect(driftDeltas(P(55), 1)).toEqual({ spirit: -0.2 });
    expect(driftDeltas(P(39.9), 1)).toEqual({ spirit: 0.1 });
    expect(driftDeltas(P(40.1), 1)).toEqual({ spirit: -0.1 });
    expect(driftDeltas(P(40), 1)).toEqual({});
  });

  it('Safety drifts −0.3 a day only while a Tollmen level is 2 or more', () => {
    expect(driftDeltas(P(40), 0)).toEqual({});
    expect(driftDeltas(P(40), 1)).toEqual({});
    expect(driftDeltas(P(40), 2)).toEqual({ safety: -0.3 });
    expect(driftDeltas(P(40), 3)).toEqual({ safety: -0.3 });
    expect(driftDeltas(P(40, 0), 3)).toEqual({});
  });

  it('Prosperity and Charm never drift', () => {
    const d = driftDeltas({ prosperity: 3, safety: 30, spirit: 40, charm: 97 }, 3);
    expect(d.prosperity).toBeUndefined();
    expect(d.charm).toBeUndefined();
  });

  it('is applied through the change log as source "drift"', () => {
    const s = applyDrift(setTollmenLevelMax(createTownState(), 2));
    expect(s.pillars.spirit).toBe(22.2);
    expect(s.pillars.safety).toBe(29.7);
    expect(s.log.map(c => [c.pillar, c.source, c.applied])).toEqual([['safety', 'drift', -0.3], ['spirit', 'drift', 0.2]]);
  });

  it('runs once per dawn: ten quiet days take Spirit from 22 to 24', () => {
    let s = createTownState();
    for (let d = 2; d <= 11; d++) s = runDawn(s, { day: d }).state;
    expect(s.pillars.spirit).toBe(24);
    expect(s.pillars.safety).toBe(30);
  });

  it('reads the Tollmen level of the day that just ended', () => {
    let s = setTollmenLevelMax(createTownState(), 2); // Day 1 at level 2
    s = runDawn(s, { day: 2 }).state; // that night: −0.3
    s = setTollmenLevelMax(s, 1); // Day 2 back to 1
    s = runDawn(s, { day: 3 }).state;
    expect(s.pillars.safety).toBe(29.7);
  });

  it('lands a lively town at 40 and keeps it there', () => {
    let s = applyPillarDelta(createTownState(), 'spirit', 18.5, 'story'); // 40.5
    for (let d = 2; d <= 6; d++) s = runDawn(s, { day: d }).state;
    expect(s.pillars.spirit).toBe(40);
  });
});
