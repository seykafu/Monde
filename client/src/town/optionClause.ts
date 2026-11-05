// The Option Clause (GDD §6.5): Vane's option on the Wharf.
//
// - Active from Day 1, known to the player from S08 (Day 18, flag `option_known`), or earlier if it triggers.
// - Trigger: the census is under 180 for 7 consecutive dawns. Vane exercises the option. (The floor was 200 until the
//   2026-11-05 census trim took Day 1 from 210 to 190; it moved with it, keeping the ten-resident cushion.)
// - Undo: the Charter's Article III voids it (`charter_found`, S21).
// - UI: once known, the Town Ledger shows a census gauge with a 180 line and a 7-day counter whenever the
//   census is under 185.
// Consequences use the saved exercised state; the Charter reopens the sites immediately.
import type { TownFlags, TownState } from './pillars';

export const OPTION_CENSUS_LINE = 180;
export const OPTION_DAWNS = 7;
/** The gauge shows while the census is under this. */
export const OPTION_GAUGE_BELOW = 185;

export interface OptionClauseState {
  /** Consecutive dawns with the census under 180. */
  dawnsUnder: number;
  reopened?: boolean;
  exercised: boolean;
  exercisedDay: number | null;
}

/** The Charter voids the clause. */
export const optionVoid = (flags: TownFlags): boolean => !!flags.charter_found;
/** The player knows about the clause: S08 has played, or Vane has already used it. */
export const optionKnown = (flags: TownFlags, oc: OptionClauseState): boolean => !!flags.option_known || oc.exercised;

export interface OptionDawnResult {
  state: OptionClauseState;
  /** Vane exercised the option this dawn. */
  triggered: boolean;
}

/**
 * One dawn's count, on the census at dawn. Seven dawns in a row under 180 trigger the clause (once). A dawn at
 * 180 or more resets the count. Nothing is counted once the clause is exercised or void.
 */
export const optionClauseDawn = (oc: OptionClauseState, census: number, day: number, flags: TownFlags = {}): OptionDawnResult => {
  if (oc.exercised || optionVoid(flags)) return { state: { ...oc, dawnsUnder: oc.exercised ? oc.dawnsUnder : 0 }, triggered: false };
  if (census >= OPTION_CENSUS_LINE) return { state: { ...oc, dawnsUnder: 0 }, triggered: false };
  const dawnsUnder = oc.dawnsUnder + 1;
  if (dawnsUnder >= OPTION_DAWNS) return { state: { dawnsUnder, exercised: true, exercisedDay: day }, triggered: true };
  return { state: { ...oc, dawnsUnder }, triggered: false };
};

export interface OptionGauge {
  /** Show the census gauge (known, not void, census under 185; or already exercised). */
  visible: boolean;
  known: boolean;
  census: number;
  line: number;
  dawnsUnder: number;
  dawnsNeeded: number;
  exercised: boolean;
  exercisedDay: number | null;
  void: boolean;
}

export const optionGauge = (state: Pick<TownState, 'census' | 'flags' | 'optionClause'>): OptionGauge => {
  const oc = state.optionClause;
  const known = optionKnown(state.flags, oc);
  const isVoid = optionVoid(state.flags);
  return {
    visible: known && !isVoid && (oc.exercised || state.census < OPTION_GAUGE_BELOW),
    known,
    census: state.census,
    line: OPTION_CENSUS_LINE,
    dawnsUnder: oc.dawnsUnder,
    dawnsNeeded: OPTION_DAWNS,
    exercised: oc.exercised,
    exercisedDay: oc.exercisedDay,
    void: isVoid
  };
};

/** §6.5: only the fish market and boathouse close; the rest of the Wharf remains accessible. */
export const wharfClosed = (town: Pick<TownState, 'optionClause' | 'flags'>): boolean =>
  town.optionClause.exercised && !optionVoid(town.flags);
export const optionClosesPlace = (town: Pick<TownState, 'optionClause' | 'flags'>, place: string): boolean =>
  wharfClosed(town) && ['wharf.fish_market', 'wharf.boathouse'].includes(place);
