// Appeal: how attractive Monde is to people deciding whether to move here (GDD §6.2).
//
//   YouthAppeal = 0.35·Prosperity + 0.30·Charm + 0.25·Spirit + 0.10·Safety
//                 + 10 (station open) + 5 (ferry daily) + min(10, 0.5 · open_jobs)
//   ElderAppeal = 0.35·Safety + 0.25·Spirit + 0.20·Charm + 0.20·Prosperity
//                 + 10 (clinic open) + 5 (ferry daily) + 3 (streetlights done)
//   Momentum    = min(10, 0.6 · mean 7-day gain across the four Pillars)    // word of mouth
//   Appeal      = (YouthAppeal + ElderAppeal) / 2 + Momentum
//
// Day 1: Youth 22.3, Elder 24.6, Momentum 0, Appeal 23.45.
import { mapPillars, meanPillars, roundPillar, HISTORY_DAYS, type PillarSnapshot, type Pillars, type TownFlags, type TownState } from './pillars';

export const MOMENTUM_FACTOR = 0.6;
export const MOMENTUM_MAX = 10;
/** §6.3, the `school` row: 20 pupils by Day 51 gives YouthAppeal +5. */
export const SCHOOL_SAVED_YOUTH_BONUS = 5;

export interface AppealBreakdown {
  youth: number;
  elder: number;
  /** Each Pillar's change since the dawn seven days ago (or Day 1, in the first week). */
  gains7: Pillars;
  /** The mean of gains7 across the four Pillars. */
  meanGain7: number;
  momentum: number;
  /** (youth + elder) / 2 + momentum */
  appeal: number;
  /** The chance an arriving household is youth-leaning: youth / (youth + elder) (§6.2, arrival mix). */
  youthShare: number;
}

export const youthAppeal = (p: Pillars, flags: TownFlags = {}, openJobs = 0): number =>
  0.35 * p.prosperity + 0.30 * p.charm + 0.25 * p.spirit + 0.10 * p.safety
  + (flags.station_open ? 10 : 0)
  + (flags.project_ferry_done ? 5 : 0)
  + Math.min(10, 0.5 * Math.max(0, openJobs))
  // Not in the §6.2 formula but in §6.3's Project table ("20 pupils by D51 → … YouthAppeal +5").
  + (flags.school_saved ? SCHOOL_SAVED_YOUTH_BONUS : 0);

export const elderAppeal = (p: Pillars, flags: TownFlags = {}): number =>
  0.35 * p.safety + 0.25 * p.spirit + 0.20 * p.charm + 0.20 * p.prosperity
  + (flags.clinic_open ? 10 : 0)
  + (flags.project_ferry_done ? 5 : 0)
  + (flags.project_streetlights_done ? 3 : 0);

/**
 * The snapshot Momentum measures from on `day`: the latest dawn at least seven days back, or, in the first
 * week (or after a gap), the oldest one kept.
 */
export const momentumBase = (history: readonly PillarSnapshot[], day: number): PillarSnapshot | undefined => {
  let base: PillarSnapshot | undefined;
  for (const s of history) if (s.day <= day - HISTORY_DAYS && (!base || s.day > base.day)) base = s;
  if (base) return base;
  for (const s of history) if (!base || s.day < base.day) base = s;
  return base;
};

/** Each Pillar's change over the last seven days. */
export const sevenDayGains = (state: Pick<TownState, 'day' | 'pillars' | 'history'>): Pillars => {
  const base = momentumBase(state.history, state.day);
  return mapPillars(p => roundPillar(base ? state.pillars[p] - base.pillars[p] : 0));
};

/**
 * Momentum from the four 7-day gains.
 *
 * GDD-GAP: §6.2 leaves two things open, and we read them like this.
 *  - "7-day gain" is each Pillar's net change over the 7-day window (today against the dawn seven days ago),
 *    as written, not a daily average: the min(10, ·) cap could never bind on a daily average (it would take
 *    +16.7 per Pillar per day). The mean is taken over the signed changes, so a Pillar that fell offsets one
 *    that rose: word of mouth is about the town as a whole.
 *  - Momentum is never negative. The glossary calls it "the word-of-mouth bonus to Appeal from recent Pillar
 *    gains", so a falling town gets no Momentum rather than a penalty: max(0, ·).
 * Note that §6.2's worked example ("raises the Pillars about 10–12 points on average. With Momentum that's
 * about 35–37") doesn't close under either reading of the window: +10–12 gives about 39–43 read as written,
 * or 34–36.5 read as a daily mean. Either way the first arrival lands on the first ferry day on or after D7
 * (D8) for a strong first week; see the soak test.
 */
export const momentumFrom = (gains7: Pillars): number =>
  Math.min(MOMENTUM_MAX, Math.max(0, MOMENTUM_FACTOR * meanPillars(gains7)));

/** Appeal and its parts for the town as it stands (callable at dawn or any time in the day). */
export const computeAppeal = (state: Pick<TownState, 'day' | 'pillars' | 'history' | 'flags' | 'openJobs'>): AppealBreakdown => {
  const youth = youthAppeal(state.pillars, state.flags, state.openJobs);
  const elder = elderAppeal(state.pillars, state.flags);
  const gains7 = sevenDayGains(state);
  const momentum = momentumFrom(gains7);
  const total = youth + elder;
  return {
    youth, elder, gains7,
    meanGain7: meanPillars(gains7),
    momentum,
    appeal: total / 2 + momentum,
    youthShare: total > 0 ? youth / total : 0.5
  };
};
