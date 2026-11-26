import { describe, expect, it } from 'vitest';
import { appealNow, appealAtDawn, appealSincePaper, appealToastText } from '../appealFeedback';
import { applyPillarDelta, createTownState } from '../pillars';
import { runDawn } from '../townEngine';

describe('Appeal feedback', () => {
  it('shows the change from sweeping Market Row', () => {
    const swept = applyPillarDelta(createTownState(), 'charm', 0.5, 'community_work');
    expect(appealNow(swept) - appealAtDawn(swept)).toBeCloseTo(0.3);
    expect(appealToastText(appealAtDawn(swept), appealNow(swept))).toMatch(/^Appeal 23.5 → 23.8/);
  });

  it('counts the bakery opening and overnight drift since the previous dawn', () => {
    const start = createTownState();
    expect(appealSincePaper(start)).toBeNull();
    const bakery = applyPillarDelta(start, 'prosperity', 3, 'project');
    const morning = runDawn(bakery, { day: 2 }).state;
    expect(appealSincePaper(morning)).toBeCloseTo(appealNow(morning) - appealNow(start));
    expect(appealSincePaper(morning)).toBeGreaterThan(appealNow(morning) - appealAtDawn(morning));
  });

  it('uses the previous edition when its Momentum baseline has rolled out of history', () => {
    let town = applyPillarDelta(createTownState(), 'prosperity', 3, 'project');
    for (let day = 2; day <= 8; day++) town = runDawn(town, { day }).state;
    const printed = appealNow(town);
    const next = runDawn(town, { day: 9 }).state;
    expect(appealSincePaper(next, printed)).toBeCloseTo(appealNow(next) - printed);
    expect(appealSincePaper(next, printed)).toBeLessThan(0);
  });

  it.each([
    [27.1, 29, 'Appeal 27.1 → 29.0 · at 35, new people start stepping off the ferry'],
    [34.8, 35, 'Appeal 34.8 → 35.0 · new people arrive on ferry days'],
    [35.4, 36, 'Appeal 35.4 → 36.0 · new people arrive on ferry days'],
    [31.2, 30.7, 'Appeal 31.2 → 30.7 · at 35, new people start stepping off the ferry']
  ] as const)('describes %s to %s', (before, after, text) => {
    expect(appealToastText(before, after)).toBe(text);
  });
});
