// Nightly Pillar drift (GDD §6.1).
//
// "Safety drifts −0.3 per day while the Tollmen level is ≥ 2 anywhere. Spirit drifts toward 40 by 0.2 per
// day (neglected towns sag, and lively towns settle). Prosperity and Charm don't drift."
//
// Drift runs once per night, first thing at dawn (townEngine.runDawn), and reads the Tollmen level that held
// during the day that just ended (the state's level before the new day's update).
import { applyPillarDelta, roundPillar, type Pillars, type TownState } from './pillars';

export const SAFETY_DRIFT_PER_DAY = -0.3;
/** Safety drifts while the Tollmen level is at least this anywhere. */
export const SAFETY_DRIFT_TOLLMEN_LEVEL = 2;
export const SPIRIT_DRIFT_TARGET = 40;
export const SPIRIT_DRIFT_PER_DAY = 0.2;

/** The night's drift for these Pillars and Tollmen level (only the Pillars that move). */
export const driftDeltas = (pillars: Pillars, tollmenLevelMax: number): Partial<Pillars> => {
  const out: Partial<Pillars> = {};
  if (tollmenLevelMax >= SAFETY_DRIFT_TOLLMEN_LEVEL && pillars.safety > 0) out.safety = SAFETY_DRIFT_PER_DAY;
  const gap = SPIRIT_DRIFT_TARGET - pillars.spirit;
  // Toward 40, never past it.
  if (gap !== 0) out.spirit = roundPillar(Math.sign(gap) * Math.min(SPIRIT_DRIFT_PER_DAY, Math.abs(gap)));
  return out;
};

/** Apply one night's drift (logged as source `drift`). */
export const applyDrift = (state: TownState): TownState => {
  const deltas = driftDeltas(state.pillars, state.tollmenLevelMax);
  let next = state;
  if (deltas.safety) next = applyPillarDelta(next, 'safety', deltas.safety, 'drift', `Tollmen level ${state.tollmenLevelMax}`);
  if (deltas.spirit) next = applyPillarDelta(next, 'spirit', deltas.spirit, 'drift', `toward ${SPIRIT_DRIFT_TARGET}`);
  return next;
};
