// The Option Clause (GDD §6.5): Vane's option on the Wharf.
//
// - Active from Day 1, known to the player from S08 (Day 18, flag `option_known`), or earlier if it triggers.
// - Trigger: the census is under 200 for 7 consecutive dawns. Vane exercises the option.
// - Undo: the Charter's Article III voids it (`charter_found`, S21).
// - UI: once known, the Town Ledger shows a census gauge with a 200 line and a 7-day counter whenever the
//   census is under 205.
// The consequences (the Wharf closes, Prosperity −8, Spirit −4, Regard drops) belong to G-04; this module
// counts, triggers and describes the gauge.
import type { TownFlags, TownState } from './pillars';

export const OPTION_CENSUS_LINE = 200;
export const OPTION_DAWNS = 7;
/** The gauge shows while the census is under this. */
export const OPTION_GAUGE_BELOW = 205;

export interface OptionClauseState {
  /** Consecutive dawns with the census under 200. */
  dawnsUnder: number;
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
 * One dawn's count, on the census at dawn. Seven dawns in a row under 200 trigger the clause (once). A dawn at
 * 200 or more resets the count. Nothing is counted once the clause is exercised or void.
 */
export const optionClauseDawn = (oc: OptionClauseState, census: number, day: number, flags: TownFlags = {}): OptionDawnResult => {
  if (oc.exercised || optionVoid(flags)) return { state: { ...oc, dawnsUnder: oc.exercised ? oc.dawnsUnder : 0 }, triggered: false };
  if (census >= OPTION_CENSUS_LINE) return { state: { ...oc, dawnsUnder: 0 }, triggered: false };
  const dawnsUnder = oc.dawnsUnder + 1;
  if (dawnsUnder >= OPTION_DAWNS) return { state: { dawnsUnder, exercised: true, exercisedDay: day }, triggered: true };
  return { state: { ...oc, dawnsUnder }, triggered: false };
};

export interface OptionGauge {
  /** Show the census gauge (known, not void, census under 205; or already exercised). */
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
