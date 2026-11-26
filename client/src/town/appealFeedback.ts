import { computeAppeal } from './appeal';
import { ARRIVAL_APPEAL } from './migration';
import { DAY1_OPEN_JOBS, HISTORY_DAYS, type TownState } from './pillars';

export const appealNow = (state: TownState): number => computeAppeal(state).appeal;
export const appealAtDawn = (state: TownState): number => appealNow({ ...state, pillars: state.dayStart });

/** The printed score also remembers yesterday's jobs, flags and any now-expired Momentum baseline. */
export function appealSincePaper(state: TownState, printedPrevious?: number, current = appealNow(state)): number | null {
  if (printedPrevious !== undefined) return current - printedPrevious;
  const previous = state.history.find(s => s.day === state.day - 1);
  if (!previous) return null;
  const history = state.history.filter(s => s.day <= previous.day);
  if (previous.day > HISTORY_DAYS && !history.some(s => s.day <= previous.day - HISTORY_DAYS)) return null;
  const initial = previous.day === 1 ? { flags: {}, openJobs: DAY1_OPEN_JOBS } : {};
  return current - appealNow({ ...state, ...previous, ...initial, history });
}

export const appealValue = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);

export function appealToastText(before: number, after: number): string {
  const ferry = after < ARRIVAL_APPEAL
    ? `at ${ARRIVAL_APPEAL}, new people start stepping off the ferry`
    : 'new people arrive on ferry days';
  return `Appeal ${appealValue(before)} → ${appealValue(after)} · ${ferry}`;
}
