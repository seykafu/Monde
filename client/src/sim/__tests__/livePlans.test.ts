import { describe, expect, it } from 'vitest';
import type { PlanOutput } from '@monde/shared';
import { dayPlansFor, liveDayPlan, withLivePlans } from '../plans';
import { ResidentSim } from '../residentSim';
import { loadCards, loadWorld } from './content';

const cards = loadCards();
const block = (start: string, end: string, place: string, action: PlanOutput['blocks'][number]['action'] = 'work'): PlanOutput['blocks'][number] =>
  ({ start, end, action, place, with: [], note: '' });
const plan = (...blocks: PlanOutput['blocks']): PlanOutput => ({ blocks, whim: null, barks: [], seek_player: null, intentions: [] });

describe('the dawn package\'s model plans replace templates (G-13 client)', () => {
  const day = 4;
  const templates = dayPlansFor(cards, day);
  const odile = templates.find(p => p.resident === 'odile')!;
  const good = plan(block('06:00', '11:00', 'market_row.bakery'), block('11:00', '13:00', 'old_quarter.fountain_square', 'socialize'),
    block('13:00', '22:00', 'market_row.bakery_flat', 'cook'), block('22:00', '26:00', 'market_row.bakery_flat', 'sleep'));

  it('keeps the template\'s night and takes the plan\'s blocks', () => {
    const live = liveDayPlan(odile, good)!;
    expect(live.routine).toBe('live');
    expect(live.startPlace).toBe(odile.startPlace);
    expect(live.blocks.map(b => [b.start, b.place])).toEqual([['06:00', 'market_row.bakery'], ['11:00', 'old_quarter.fountain_square'],
      ['13:00', 'market_row.bakery_flat'], ['22:00', 'market_row.bakery_flat']]);
  });

  it('refuses a plan that can\'t run, so the template stands', () => {
    expect(liveDayPlan(odile, plan())).toBeNull();
    expect(liveDayPlan(odile, plan(block('6 am', '11:00', 'market_row.bakery')))).toBeNull();
    expect(liveDayPlan(odile, plan(block('25:00', '26:00', 'market_row.bakery'), block('24:00', '25:00', 'market_row.bakery')))).toBeNull();
    expect(liveDayPlan(odile, plan(block('06:00', '11:00', ' ')))).toBeNull();
  });

  it('swaps in only the valid ones and says which', () => {
    const { plans, applied, rejected } = withLivePlans(templates, { odile: good, june: plan(), nobody: good });
    expect(applied).toEqual(['odile']);
    expect(rejected).toEqual(['june']);
    expect(plans.find(p => p.resident === 'odile')!.routine).toBe('live');
    expect(plans.find(p => p.resident === 'june')).toBe(templates.find(p => p.resident === 'june'));
    expect(plans).toHaveLength(templates.length);
  });

  it('the simulation picks up live plans for their day, including ones that arrive mid-morning', () => {
    let live: Record<string, PlanOutput> | null = null;
    const sim = new ResidentSim(cards, loadWorld(), 0, d => (d === day ? live : null));
    expect(sim.plansFor(day).find(p => p.resident === 'odile')!.routine).not.toBe('live');
    live = { odile: good };
    expect(sim.plansFor(day).find(p => p.resident === 'odile')!.routine).toBe('live');
    expect(sim.sample('odile', day, 12 * 60)?.place).toBe('old_quarter.fountain_square');
    // Another day keeps its templates.
    expect(sim.plansFor(day + 1).find(p => p.resident === 'odile')!.routine).not.toBe('live');
  });
});
