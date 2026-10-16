import { describe, expect, it, vi } from 'vitest';
import { emptyRiddles, normalizeRiddleAnswer, SavedRiddles, SPRING_RIDDLES } from '@monde/shared';
import { available, readMark, answerMark, matchesAnswer, requestHint, tickHints, gameMinute } from '../engine';
const context = { day: 10, minute: 600, flags: new Set<string>(), openDistricts: new Set(['old_quarter', 'market_row', 'wharf', 'commons']) };
describe('Marks', () => {
  it('preserves all authored accepted answers through normalization', () => {
    expect(SPRING_RIDDLES).toHaveLength(25);
    for (const r of SPRING_RIDDLES) for (const a of r.accepted) expect(matchesAnswer(a, r.accepted), `${r.id}: ${a}`).toBe(true);
    expect(normalizeRiddleAnswer('The Clémence!')).toBe('clemence');
    expect(normalizeRiddleAnswer('one thousand eight hundred and fifty')).toBe('1850');
    expect(normalizeRiddleAnswer('Seventy-eight')).toBe('78');
  });
  it('accepts reviewed typos but rejects different words, numbers, short typos and substrings', () => {
    expect(matchesAnswer('libary', ['library'])).toBe(true);
    for (const [wrong, right] of [['stale', 'scale'], ['scare', 'scale'], ['scalp', 'scale'], ['hero', 'heron'], ['shadowy', 'shadow'], ['kettleful', 'kettle'], ['belle', 'bell'], ['1849', '1850'], ['nine hundred', '9'], ['eight one', '9'], ['eight and one', '9'], ['78 steps please', 'step 78'], ['shadows', 'shadow']]) expect(matchesAnswer(wrong!, [right!])).toBe(false);
  });
  it('gates day, district, previous Mark and lighthouse project', () => {
    const s = emptyRiddles();
    expect(readMark(s, 'MR-1', { ...context, day: 2 })).toBe(false);
    expect(readMark(s, 'OQ-1', { ...context, openDistricts: new Set() })).toBe(false);
    expect(readMark(s, 'OQ-2', context)).toBe(false);
    s.entries['WF-3'] = { status: 'solved', hints: 0, foundAt: 0, attempts: [] };
    expect(available(s, 'WF-4', context)).toBe(false);
    expect(available(s, 'WF-4', { ...context, flags: new Set(['project_lighthouse_done']) })).toBe(true);
  });
  it('unlocks hints after 60 game minutes, charges once, enforces resident and Friend', () => {
    const s = emptyRiddles(); readMark(s, 'OQ-1', context);
    tickHints(s, gameMinute(context) + 59); expect(s.entries['OQ-1']!.hints).toBe(0);
    tickHints(s, gameMinute(context) + 60); expect(s.entries['OQ-1']!.hints).toBe(1);
    expect(requestHint(s, 'OQ-1', { kind: 'resident', id: 'pell', regard: 100 })).toBe(false);
    const spend = vi.fn(() => true);
    expect(requestHint(s, 'OQ-1', { kind: 'home', spendStamina: spend })).toBe(true);
    expect(spend).toHaveBeenCalledWith(10);
    expect(requestHint(s, 'OQ-1', { kind: 'home', spendStamina: spend })).toBe(false);
    expect(spend).toHaveBeenCalledTimes(1);
    expect(requestHint(s, 'OQ-1', { kind: 'resident', id: 'margo', regard: 39 })).toBe(false);
    expect(requestHint(s, 'OQ-1', { kind: 'resident', id: 'margo', regard: 40 })).toBe(true);
    expect(requestHint(s, 'OQ-1', { kind: 'resident', id: 'margo', regard: 40 })).toBe(false);
  });
  it('keeps attempts, rewards once and round-trips without replaying rewards', () => {
    const s = emptyRiddles(), apply = vi.fn(); readMark(s, 'OQ-1', context);
    expect(answerMark(s, 'OQ-1', 'school', 'named', context, { apply })).toBe('wrong');
    expect(apply).not.toHaveBeenCalled();
    expect(answerMark(s, 'OQ-1', 'the bell', 'named', context, { apply })).toBe('solved');
    expect(apply.mock.calls[0]![1]).toMatchObject({ xp: 20, charm: 1 });
    const restored = SavedRiddles.parse(JSON.parse(JSON.stringify(s)));
    expect(restored).toEqual(s);
    expect(answerMark(restored, 'OQ-1', 'bell', 'named', context, { apply })).toBe('already');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(readMark(restored, 'OQ-2', context)).toBe(true);
    answerMark(restored, 'OQ-2', '', 'found', context, { apply });
    expect(apply.mock.calls[1]![1]).toMatchObject({ xp: 40 });
  });
  it('only fifth Marks award a fragment; Commons remains incomplete; Tib rewards are separate', () => {
    const s = emptyRiddles(), apply = vi.fn();
    for (let n=1;n<=5;n++) { readMark(s, `OQ-${n}`, context); answerMark(s, `OQ-${n}`, '', 'found', context, { apply }); }
    expect(apply.mock.calls[4]![1]).toMatchObject({ spirit: 3, flags: ['pinion_found'], items: ['lantern_pinion'] });
    expect(SPRING_RIDDLES.find(r => r.id === 'CM-4')!.fragment).toBeNull();
    readMark(s, 'T-01', context); answerMark(s, 'T-01', 'comb', 'named', context, { apply });
    expect(apply.mock.calls[5]![1]).toMatchObject({ xp: 10, coins: 5, regard: 3, charm: 0 });
  });
});

import { canFindAnswer } from '../worldRules';
it('enforces authored world conditions without treating a typed name as a physical visit', () => {
  const facts = { flags: new Set<string>(), items: new Set<string>(), regard: {}, minute: 900 };
  for (const id of ['OQ-5', 'MR-2', 'MR-3', 'MR-5', 'WF-1', 'WF-3', 'WF-4', 'WF-5', 'CM-2', 'CM-4']) expect(canFindAnswer(id, facts), id).toBe(false);
  expect(canFindAnswer('CM-2', { ...facts, weather: 'sun', items: new Set(['trowel']) })).toBe(true);
  expect(canFindAnswer('MR-5', { ...facts, wind: 'W', items: new Set(['kasimir_ladder']) })).toBe(true);
  expect(canFindAnswer('WF-5', { ...facts, minute: 1320, weather: 'fog', flags: new Set(['project_lighthouse_done']) })).toBe(false);
  expect(canFindAnswer('WF-1', { ...facts, lowTide: true })).toBe(true);
});
