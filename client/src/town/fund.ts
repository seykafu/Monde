// The Town Fund's daily books (GDD §6.3).
//
// "Income: rates of 1 coin per occupied household per day, stall fees on market days, festival takings,
// donations and grants. Costs: Projects, and upkeep (streetlights 10/day, ferry fuel 20/day, clinic 15/day
// once open)."
//
// The books for a day close at the next dawn (townEngine.runDawn), so the Dawn Report's Fund figure includes
// yesterday's rates, stall fees and upkeep. Festival takings, donations, grants and Project costs are one-off
// entries that their own systems post with postToFund().
import { weekdayOf, type Weekday } from '../sim/clock';
import type { TownFlag, TownFlags, TownState } from './pillars';

export const RATES_PER_HOUSEHOLD = 1;
/** §5.3: the market runs on Saturdays. */
export const MARKET_WEEKDAY: Weekday = 'Sat';
/**
 * GDD-GAP: §6.3 lists "stall fees on market days" with no amount. 20 coins per market day: Appendix A.1's four
 * Day-1 market-day stallholders at 5 coins a stall. Flat until the market hall (G-03) gives stalls a count.
 */
export const MARKET_DAY_STALL_FEES = 20;

export interface UpkeepItem {
  id: string;
  coins: number;
}
export interface UpkeepRule extends UpkeepItem {
  /** Charged on days this flag is set. */
  flag: TownFlag;
}
/** §6.3 upkeep, charged daily once the thing it pays for exists. */
export const UPKEEP_RULES: readonly UpkeepRule[] = [
  { id: 'streetlights', coins: 10, flag: 'project_streetlights_done' },
  { id: 'ferry_fuel', coins: 20, flag: 'project_ferry_done' },
  { id: 'clinic', coins: 15, flag: 'clinic_open' }
];

export const isMarketDay = (day: number): boolean => weekdayOf(day) === MARKET_WEEKDAY;

export interface FundDay {
  /** The day these books are for. */
  day: number;
  rates: number;
  stallFees: number;
  upkeep: UpkeepItem[];
  income: number;
  costs: number;
  net: number;
}

/**
 * One day's books: rates on the occupied households, stall fees if it was a market day, and the upkeep rules
 * whose flag is set, plus any `extraUpkeep` another system passes in (the hook for upkeep this table lacks).
 */
export const fundDay = (day: number, occupiedHouseholds: number, flags: TownFlags = {}, extraUpkeep: readonly UpkeepItem[] = []): FundDay => {
  const rates = RATES_PER_HOUSEHOLD * Math.max(0, occupiedHouseholds);
  const stallFees = isMarketDay(day) ? MARKET_DAY_STALL_FEES : 0;
  const upkeep = [...UPKEEP_RULES.filter(r => flags[r.flag]).map(({ id, coins }) => ({ id, coins })), ...extraUpkeep];
  const income = rates + stallFees;
  const costs = upkeep.reduce((sum, u) => sum + u.coins, 0);
  return { day, rates, stallFees, upkeep, income, costs, net: income - costs };
};

/** Rates per day at the current occupancy (for the Ledger's "income" line). */
export const dailyRates = (state: Pick<TownState, 'homes'>): number => RATES_PER_HOUSEHOLD * state.homes.occupied;

/** Add (or, with a negative amount, take) coins: donations, grants, takings, Project costs. */
export const postToFund = (state: TownState, coins: number): TownState => ({ ...state, fund: state.fund + Math.round(coins) });
