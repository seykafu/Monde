// Arrivals and departures (GDD §6.4): the Stay score, the Leaving Notice rule and the dawn arrival roll.
//
// Pure decisions only. Who arrives (archetypes, personas, portraits) is generated on the server (G-02,
// Appendix A.3), so the arrival roll here says how many households and how youth-leaning the mix is, and
// settleArrivals() books them in once they walk off the ferry at 08:00 with their real household sizes.
import type { Values } from '@monde/shared';
import { weekdayOf, type Weekday } from '../sim/clock';
import { PILLARS, type Pillars, type TownFlags, type TownState } from './pillars';

// ── Stay and the Leaving Notice ──────────────────────────────────────────────

/** What the Stay score reads about one resident. */
export interface StayInputs {
  /** The resident's Pillar weights from their Persona Card (§9.3), summing to 1. */
  values: Values;
  /** Residents in town they have affinity ≥ 40 with. */
  friendsInTown: number;
  hasJobOrPurpose: boolean;
  yearsInMonde: number;
}
export interface ResidentStay extends StayInputs {
  id: string;
}

/** Stay under this for LEAVING_NIGHTS nights in a row brings a Leaving Notice (§6.4). */
export const LEAVING_STAY = 25;
export const LEAVING_NIGHTS = 5;

/**
 * §6.4, recomputed nightly:
 *   Stay = 60 · Σ(values_p · Pillar_p / 100)      // the town, as this person weighs it
 *        + 20 · min(1, friends_in_town / 4)         // friends = affinity >= 40
 *        + 10 · (has_job_or_purpose)
 *        + 10 · min(1, years_in_monde / 10)         // roots
 */
export const stayScore = (r: StayInputs, pillars: Pillars): number => {
  const town = PILLARS.reduce((sum, p) => sum + r.values[p] * pillars[p] / 100, 0);
  const stay = 60 * town
    + 20 * Math.min(1, Math.max(0, r.friendsInTown) / 4)
    + (r.hasJobOrPurpose ? 10 : 0)
    + 10 * Math.min(1, Math.max(0, r.yearsInMonde) / 10);
  return Math.min(100, Math.max(0, stay));
};

export interface MigrationState {
  /** Consecutive nights each resident has spent with Stay under 25. */
  lowStayNights: Record<string, number>;
  /** Residents who have a Leaving Notice, and the day it was given. Cleared by the Last Chance Favor (G-02). */
  notices: Record<string, number>;
}

export interface NightlyStayResult {
  migration: MigrationState;
  /** Tonight's Stay score per resident. */
  stay: Record<string, number>;
  /** Residents given a Leaving Notice tonight. */
  notices: string[];
}

/**
 * The nightly Stay pass. A resident whose Stay is under 25 for 5 nights in a row gets a Leaving Notice (once;
 * it stands until G-02's Last Chance resolves it). Any night at 25 or more resets the count. Residents missing
 * from `residents` lose their count (the rule needs five nights in a row).
 */
export const nightlyStay = (m: MigrationState, residents: readonly ResidentStay[], pillars: Pillars, day: number): NightlyStayResult => {
  const lowStayNights: Record<string, number> = {};
  const notices = { ...m.notices };
  const stay: Record<string, number> = {};
  const given: string[] = [];
  for (const r of residents) {
    const s = stayScore(r, pillars);
    stay[r.id] = s;
    if (r.id in notices) continue;
    if (s >= LEAVING_STAY) continue;
    const nights = (m.lowStayNights[r.id] ?? 0) + 1;
    if (nights >= LEAVING_NIGHTS) { notices[r.id] = day; given.push(r.id); } else lowStayNights[r.id] = nights;
  }
  return { migration: { lowStayNights, notices }, stay, notices: given };
};

// ── Arrivals ─────────────────────────────────────────────────────────────────

/** §6.4: arrivals begin at Appeal 35, and one more household per 6 points above it. */
export const ARRIVAL_APPEAL = 35;
export const APPEAL_PER_HOUSEHOLD = 6;
export const STATION_MULTIPLIER = 1.5;
export const MAX_HOUSEHOLDS_PER_DAY = 6;
/** §5.3 / §13.2: the Gannet sails Tue and Fri until the Ferry Project. */
export const FERRY_WEEKDAYS: readonly Weekday[] = ['Tue', 'Fri'];

/** A sailing day: Tue or Fri, or any day once the Ferry Project is done (the script's `ferry_day`). */
export const isFerryDay = (day: number, flags: TownFlags = {}): boolean =>
  !!flags.project_ferry_done || FERRY_WEEKDAYS.includes(weekdayOf(day));

/** §6.4: eligible_day = ferry day (Tue/Fri) OR ferry Project done OR station open. */
export const isArrivalDay = (day: number, flags: TownFlags = {}): boolean => isFerryDay(day, flags) || !!flags.station_open;

/**
 * Households the Appeal asks for, before the free-home and daily caps:
 *   households = Appeal >= 35 ? floor((Appeal - 35) / 6) + 1 : 0
 *   households *= 1.5 if station open (round up)
 */
export const householdsForAppeal = (appeal: number, stationOpen = false): number => {
  // Appeal is a weighted sum: round off float dust so 41 reads as 41, not 40.999999.
  const a = Math.round(appeal * 1e6) / 1e6;
  const base = a >= ARRIVAL_APPEAL ? Math.floor((a - ARRIVAL_APPEAL) / APPEAL_PER_HOUSEHOLD) + 1 : 0;
  return stationOpen ? Math.ceil(base * STATION_MULTIPLIER) : base;
};

export type ArrivalOutcome =
  | 'arrivals'
  | 'no_sailing' // not an eligible day
  | 'appeal_below_35'
  | 'no_free_homes'
  | 'capped_by_free_homes'
  | 'capped_at_6';

export interface ArrivalDecision {
  day: number;
  /** An eligible day (a sailing, or the station open). */
  eligible: boolean;
  appeal: number;
  /** What Appeal asks for (station multiplier included), before the free-home and daily caps. */
  wanted: number;
  /** Households arriving today: min(wanted, free homes, 6) on an eligible day, else 0. */
  households: number;
  /** The chance each arriving household is youth-leaning (§6.2). */
  youthShare: number;
  outcome: ArrivalOutcome;
}

export interface ArrivalInputs {
  day: number;
  appeal: number;
  youthShare: number;
  flags?: TownFlags;
  /** Restored homes nobody lives in (the hard cap, §6.4). */
  freeHomes: number;
}

/** The dawn arrival roll (§6.4). */
export const decideArrivals = (i: ArrivalInputs): ArrivalDecision => {
  const flags = i.flags ?? {};
  const eligible = isArrivalDay(i.day, flags);
  const wanted = householdsForAppeal(i.appeal, !!flags.station_open);
  const free = Math.max(0, Math.floor(i.freeHomes));
  const households = eligible ? Math.min(wanted, free, MAX_HOUSEHOLDS_PER_DAY) : 0;
  const outcome: ArrivalOutcome =
    !eligible ? 'no_sailing'
    : wanted === 0 ? 'appeal_below_35'
    : free === 0 ? 'no_free_homes'
    : households < wanted && households === free ? 'capped_by_free_homes'
    : households < wanted ? 'capped_at_6'
    : 'arrivals';
  return { day: i.day, eligible, appeal: i.appeal, wanted, households, youthShare: i.youthShare, outcome };
};

/**
 * Book arriving households in (at 08:00, once G-02 has generated them): each takes a free restored home, and
 * the census grows by its size. Households beyond the free homes are not housed (the roll never asks for them).
 */
export const settleArrivals = (state: TownState, householdSizes: readonly number[]): TownState => {
  const housed = householdSizes.slice(0, Math.max(0, state.homes.restored_free));
  const people = housed.reduce((sum, n) => sum + Math.max(1, Math.floor(n)), 0);
  return {
    ...state,
    census: state.census + people,
    homes: { ...state.homes, occupied: state.homes.occupied + housed.length, restored_free: state.homes.restored_free - housed.length }
  };
};

/** Residents who leave on the ferry (G-02): the census drops, and any homes they empty become free again. */
export const settleDepartures = (state: TownState, residentIds: readonly string[], homesVacated = 0): TownState => {
  const notices = { ...state.migration.notices };
  const lowStayNights = { ...state.migration.lowStayNights };
  for (const id of residentIds) { delete notices[id]; delete lowStayNights[id]; }
  const vacated = Math.max(0, Math.min(homesVacated, state.homes.occupied));
  return {
    ...state,
    census: Math.max(0, state.census - residentIds.length),
    homes: { ...state.homes, occupied: state.homes.occupied - vacated, restored_free: state.homes.restored_free + vacated },
    migration: { lowStayNights, notices }
  };
};
