import type { TollmenState } from '@monde/shared';
import type { Outcome } from './engine';
/** §13.2's calendar baseline, including the Bloom Fair truce. */
export const baseline = (day: number): number => day === 25 || day < 15 ? 1 : day < 35 ? 2 : 3;
export function tollmenLevel(state: TollmenState, zone: string, day: number, night = false, streetlights = 0): number {
  const temporary = state.modifiers.filter(m => m.zone === zone && day < m.until).reduce((n, m) => n + m.delta, 0);
  const quits = Object.values(state.quit).filter(z => z === zone).length;
  return Math.max(0, Math.min(3, Math.round(baseline(day) + temporary - quits - Math.min(4, state.deputies.length) * .5
    - (state.charter ? 1 : 0) - (state.ledgerDay !== null && day >= state.ledgerDay + 3 ? 1 : 0)
    - (night && ['old_quarter', 'market_row'].includes(zone) ? streetlights : 0))));
}
export function recordOutcome(state: TollmenState, zone: string, day: number, outcome: Outcome, key: string): TollmenState {
  if (outcome === 'paid') return state;
  if (state.modifiers.some(m => m.key === key)) return state;
  const won = outcome === 'win' || outcome === 'talk_down';
  return { ...state, modifiers: [...state.modifiers.filter(m => m.until > day), { zone, delta: won ? -1 : 1, until: day + (won ? 3 : 2), key }] };
}
export function consequences(outcome: Outcome, coins: number): { coins: number; safety: number; minutes: number; gritXp: number; witsXp: number } {
  // GDD-GAP: wins grant +1 Safety, 20 Grit / 10 Wits XP. Coin loss rounds down. Talked-down encounters count as wins.
  if (outcome === 'win' || outcome === 'talk_down') return { coins, safety: 1, minutes: 0, gritXp: 20, witsXp: 10 };
  if (outcome === 'paid') return { coins: Math.max(0, coins - 20), safety: 0, minutes: 0, gritXp: 0, witsXp: 0 };
  if (outcome === 'flee') return { coins, safety: 0, minutes: 0, gritXp: 0, witsXp: 0 };
  return { coins: coins - Math.min(50, Math.floor(coins * .1)), safety: -1, minutes: 120, gritXp: 0, witsXp: 0 };
}
/** Later Projects/regatta systems supply explicit evidence; rebuilding a workplace alone is not proof of a job. */
export function quitProgress(id: string, flags: ReadonlySet<string>, regard: number, evidence: { canneryJob?: boolean; playedConcert?: boolean; wonRegatta?: boolean; debtPaid?: boolean } = {}): number {
  if (id === 'bru') return (evidence.canneryJob ? .5 : 0) + (regard >= 30 ? .5 : 0);
  if (id === 'nettie') return (flags.has('school_saved') ? .5 : 0) + (regard >= 40 ? .5 : 0);
  if (id === 'dex' || id === 'dom') return evidence.playedConcert || evidence.wonRegatta ? 1 : 0;
  if (id === 'weasel') return evidence.debtPaid || flags.has('ledger_published') ? 1 : 0;
  return 0;
}
