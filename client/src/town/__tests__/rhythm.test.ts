// The weekly rhythm: Saturday's market on Market Row's flags (town/market.ts) and the Lantern's lines (town/rhythm.ts).
import { describe, expect, it } from 'vitest';
import type { Press } from '@monde/shared';
import type { DayPlan, DayPlanBlock } from '../../sim/plans';
import { MARKET_DAY_LOOK, MARKET_PLACE, STALL_AREA, marketKey, marketOpen, marketPlans, marketShifts } from '../market';
import { rhythmNotices, rhythmPaper, roundStory } from '../rhythm';
import { resolveState } from '../../world/townSprites';

const block = (place: string, start: number, end: number, action: DayPlanBlock['action'] = 'shop'): DayPlanBlock => ({
  start: '', end: '', action, place, with: [], note: '', startMin: start, endMin: end
});
const plan = (resident: string, blocks: DayPlanBlock[]): DayPlan =>
  ({ resident, weekday: 'Sat', routine: 'weekend', startPlace: 'market_row.home_01', startAction: 'sleep', blocks });

describe('the Saturday market', () => {
  it('runs on Saturdays in market hours (Day 5 is the first Saturday)', () => {
    expect(marketOpen(5, 9 * 60)).toBe(true);
    expect(marketOpen(5, 7 * 60)).toBe(false);
    expect(marketOpen(5, 14 * 60)).toBe(false);
    expect(marketOpen(6, 9 * 60)).toBe(false);
    expect(marketOpen(12, 13 * 60 + 59)).toBe(true);
  });

  it('stands everyone bound for the shut hall among the stalls for the market hours, and nobody else', () => {
    const plans = [
      plan('nell', [block(MARKET_PLACE, 7 * 60, 15 * 60, 'work')]),
      plan('teo', [block('commons.glasshouse', 6 * 60, 18 * 60, 'work')]),
      plan('volunteer', [{ ...block(MARKET_PLACE, 9 * 60, 11 * 60, 'volunteer'), area: [1, 1, 2, 2] }])
    ];
    expect(marketShifts(plans, 5, false)).toEqual([
      { resident: 'nell', action: 'work', place: MARKET_PLACE, area: STALL_AREA, startMin: 8 * 60, endMin: 14 * 60, note: 'the Saturday market' }
    ]);
    const nell = marketPlans(plans, 5, false)[0]!.blocks;
    expect(nell.map(b => [b.startMin, b.endMin, !!b.area])).toEqual([[7 * 60, 8 * 60, false], [8 * 60, 14 * 60, true], [14 * 60, 15 * 60, false]]);
    // Not on a Sunday, and not once the hall has reopened.
    expect(marketShifts(plans, 6, false)).toEqual([]);
    expect(marketShifts(plans, 5, true)).toEqual([]);
    expect([marketKey(5, false), marketKey(5, true), marketKey(6, false)]).toEqual(['stalls', '', '']);
  });

  it('fills the stalls on the market-day look, as their Project does', () => {
    const look = (flags: string[]) => ({ flag: (f: string) => flags.includes(f) });
    expect(resolveState({ sprite: 'market_stall', state: 'auto' }, look([]))).toBe('faded');
    expect(resolveState({ sprite: 'market_stall', state: 'auto' }, look([MARKET_DAY_LOOK]))).toBe('restored');
  });
});

describe('the weekly rhythm in the Lantern', () => {
  const none = { completed: new Set<string>(), flags: new Set<string>(['s03_done']) };
  const edition = (source: Press['source'] = 'template', first = 'fund'): Press => ({
    headline: 'Fund Holds', dek: 'Pell says fine', stories: [{ event_id: first, title: 'Fund', text: 'The Town Fund stands.' }, { event_id: null, title: 'Weather', text: 'Fair.' }],
    day: 6, source, event_ids: [], letters: [], movements: [], notices: []
  });

  it('prints the quiz on Wednesdays from Day 9, and its result the morning after the Fellow played', () => {
    expect(rhythmNotices(2, none)).toEqual([]);
    expect(rhythmNotices(9, none)).toEqual(['Quiz night at the Gull & Anchor, 20:00. Teams welcome.']);
    expect(rhythmNotices(10, none)).toEqual([]);
    expect(rhythmNotices(10, { completed: new Set(['wk_pub_quiz@9']), flags: new Set(['quiz_won']) }))
      .toEqual(['Wednesday’s quiz at the Gull & Anchor went to the Fellow’s table.']);
  });

  it('prints Sunday service, and the Tollmen’s round whether or not the Fellow saw it', () => {
    expect(rhythmNotices(6, none)).toEqual(['Service at St. Brigid’s, 10:00.', 'The Tollmen made their Saturday round of Market Row.']);
    expect(rhythmNotices(6, { completed: new Set(), flags: new Set(['s03_done', 'tollmen_broken']) })).toEqual(['Service at St. Brigid’s, 10:00.']);
    expect(roundStory(6, none)).toBeNull();
  });

  it('leads a template Sunday with what the Fellow did at the bakery, unless a Project opened', () => {
    const stood = { completed: new Set(['wk_saturday_round@5']), flags: new Set(['s03_done', 'round_stood']) };
    const paper = rhythmPaper(edition(), 6, stood);
    expect(paper.headline).toBe('Fellow Stands in the Bakery Door');
    expect(paper.stories.map(s => s.event_id)).toEqual(['wk_saturday_round@5', 'fund', null]);
    expect(paper.notices).toEqual(['Service at St. Brigid’s, 10:00.']);
    const opened = rhythmPaper(edition('template', 'project:fountain:open'), 6, stood);
    expect(opened.headline).toBe('Fund Holds');
    expect(opened.stories.map(s => s.event_id)).toEqual(['project:fountain:open', 'wk_saturday_round@5', null]);
    const model = rhythmPaper(edition('model'), 6, { ...stood, flags: new Set(['s03_done', 'round_paid']) });
    expect(model.headline).toBe('Fund Holds');
    expect(model.stories[1]?.text).toContain('paid the bakery');
  });
});
