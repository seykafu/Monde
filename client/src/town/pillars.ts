// The town's state and its four Pillars (GDD §6.1, Day-1 numbers from §2.4 and Appendix A.1).
//
// Pure: no Phaser, no DOM. The engine owns these numbers and changes them deterministically (§6); AI
// residents never write them. Every change goes through applyPillarDelta(), which applies the weekly
// community-work cap (§6.1), clamps to 0–100 and writes the change log. Functions return new states and
// never mutate their input, so a scene can keep the previous state for "before / after" displays.
import { PILLARS, type Pillar } from '@monde/shared';
import { WEEKDAYS, weekdayOf } from '../sim/clock';
import type { MigrationState } from './migration';
import type { OptionClauseState } from './optionClause';

export { PILLARS, type Pillar };

export type Pillars = Record<Pillar, number>;

/** Where a Pillar change came from. Only `community_work` is capped (§6.1); the rest are uncapped. */
export type PillarSource =
  | 'community_work' // repeatable tasks (§8)
  | 'project' // Project completions (§6.3)
  | 'riddle' // Marks and chains (§14.3)
  | 'story' // scripted beats ({pillar: …} in §13 scenes)
  | 'resident_sim' // friendships, weddings, departures of well-liked residents (§6.1)
  | 'scuffle' // wins and losses (§7.8)
  | 'tollmen' // shakedowns and incidents (§6.1)
  | 'event' // anything else the engine raises (festivals, the Option Clause, closures)
  | 'drift' // the nightly drift (§6.1)
  | 'dev';

export interface PillarChange {
  day: number;
  pillar: Pillar;
  source: PillarSource;
  /** What the caller asked for. */
  requested: number;
  /** What actually moved, after the community-work cap and the 0–100 clamp. */
  applied: number;
  /** True when the weekly community-work cap cut the change down. */
  capped: boolean;
  note?: string;
}

/** The Pillars as a day began (taken at dawn, after the night's drift). */
export interface PillarSnapshot {
  day: number;
  pillars: Pillars;
}

export interface Homes {
  /** Homes with a household in them (rates are 1 coin per occupied household per day, §6.3). */
  occupied: number;
  /** Vacant homes that need the `homes` Project (150 coins each) before anyone can live in them (§6.4). */
  vacant_restorable: number;
  /** Restored homes nobody lives in yet: the hard cap on arrivals (§6.4). */
  restored_free: number;
}

/** The story and Project flags the town engine reads (canonical names from the §13.6 registry). */
export const TOWN_FLAGS = [
  'station_open', // YouthAppeal +10, arrivals every day ×1.5 (§6.2, §6.4)
  'project_ferry_done', // the ferry runs daily: Youth and Elder +5, arrivals every day, ferry fuel upkeep
  'clinic_open', // ElderAppeal +10, clinic upkeep
  'project_streetlights_done', // ElderAppeal +3, streetlight upkeep
  'school_saved', // YouthAppeal +5 (§6.3, the `school` row)
  'option_known', // S08 (Day 18): the Option Clause gauge can show (§6.5)
  'charter_found' // S21: Article III voids the Option Clause (§6.5, §14.3)
] as const;
export type TownFlag = (typeof TOWN_FLAGS)[number];
export type TownFlags = Partial<Record<TownFlag, boolean>>;

export interface TownState {
  /** G-08: per-zone pressure; old saves start from the calendar baseline. */
  tollmen?: import('@monde/shared').TollmenState;
  /** G-02: generated residents, the households on today's ferry, and who has left (shared/src/arrivals/people.ts). */
  people?: import('@monde/shared').TownPeople;
  /** The game day these numbers belong to (runDawn moves it forward). */
  day: number;
  /** Prosperity, Safety, Spirit and Charm, each 0–100 (fractional: community work moves them by tenths). */
  pillars: Pillars;
  /** The Pillars when today began, before the dawn's drift. Today's change is `pillars − dayStart`. */
  dayStart: Pillars;
  /** Residents with a bed in Monde (Appendix A.1 ruling: 210 on Day 1; Vane joins on Day 48). */
  census: number;
  /** The Town Fund, in coins. */
  fund: number;
  homes: Homes;
  flags: TownFlags;
  /** `open_jobs` in YouthAppeal (§6.2). */
  openJobs: number;
  /** The highest Tollmen level in any zone (§7.7). Safety drifts down while it is ≥ 2. */
  tollmenLevelMax: number;
  /** Dawn snapshots for today and the seven days before it: Momentum's 7-day window (§6.2). */
  history: PillarSnapshot[];
  /** Community-work gains so far this calendar week, per Pillar (the +3 cap, §6.1). */
  communityWork: { week: number; gained: Pillars };
  /** Every Pillar change of the last seven days, oldest first. */
  log: PillarChange[];
  migration: MigrationState;
  optionClause: OptionClauseState;
}

// ── Day-1 numbers ────────────────────────────────────────────────────────────

/** §2.4 / §6.1: Prosperity 18 · Safety 30 · Spirit 22 · Charm 25. */
export const DAY1_PILLARS: Readonly<Pillars> = Object.freeze({ prosperity: 18, safety: 30, spirit: 22, charm: 25 });
/** §2.4 and the Appendix A.1 ruling: the census reads 210 (211 once the player signs the Fellowship form). */
export const DAY1_CENSUS = 210;
/** §2.4: 1,800 coins. */
export const DAY1_FUND = 1800;
/**
 * Appendix A.1.2: 123 households in 123 occupied homes, plus §2.4's 61 vacant homes (184 in all). None of the
 * 61 is restored on Day 1 (§6.4: they "need restoring before anyone can live in them").
 * GDD-GAP: §6.3 puts Day-1 rates at "about 110" coins a day; with A.1.2's 123 households it is 123.
 */
export const DAY1_HOMES: Readonly<Homes> = Object.freeze({ occupied: 123, vacant_restorable: 61, restored_free: 0 });
/** §13.2: the Tollmen baseline on Day 1 is 1 (loitering). */
export const DAY1_TOLLMEN_LEVEL_MAX = 1;
/** No open jobs on Day 1: §6.2's Day-1 YouthAppeal of 22.3 has no jobs term. */
export const DAY1_OPEN_JOBS = 0;

export const PILLAR_MIN = 0;
export const PILLAR_MAX = 100;
/** §6.1: repeatable tasks add at most +3 per Pillar per week. */
export const COMMUNITY_WORK_WEEKLY_CAP = 3;
/** Momentum compares today with the dawn seven days ago (§6.2). */
export const HISTORY_DAYS = 7;
/** How many days of the change log are kept. */
export const LOG_DAYS = 7;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pillar values are kept to 4 decimal places, so tenths added up stay tenths (no 2.9999999). */
export const roundPillar = (v: number): number => Math.round(v * 1e4) / 1e4;
const clampPillar = (v: number): number => Math.min(PILLAR_MAX, Math.max(PILLAR_MIN, v));

export const zeroPillars = (): Pillars => ({ prosperity: 0, safety: 0, spirit: 0, charm: 0 });
export const mapPillars = (f: (p: Pillar) => number): Pillars =>
  ({ prosperity: f('prosperity'), safety: f('safety'), spirit: f('spirit'), charm: f('charm') });
export const meanPillars = (p: Pillars): number => PILLARS.reduce((sum, k) => sum + p[k], 0) / PILLARS.length;

const DAY1_WEEKDAY_INDEX = WEEKDAYS.indexOf(weekdayOf(1));
/**
 * The calendar week a day falls in (0 = the week of Day 1).
 * GDD-GAP: §6.1 doesn't say when the community-work week starts. We use the calendar week, Mon–Sun, as the
 * clock does (Day 1 is a Tuesday), so the first week is Days 1–6 and the cap resets every Monday (D7, D14 …).
 */
export const calendarWeek = (day: number): number => Math.floor((day - 1 + DAY1_WEEKDAY_INDEX) / 7);

/** Today's change per Pillar (dawn drift included): `pillars − dayStart`. */
export const todayChange = (state: Pick<TownState, 'pillars' | 'dayStart'>): Pillars =>
  mapPillars(p => roundPillar(state.pillars[p] - state.dayStart[p]));

/** How much more community work can add to `pillar` this week. */
export const communityWorkRoom = (state: Pick<TownState, 'day' | 'communityWork'>, pillar: Pillar): number => {
  const used = state.communityWork.week === calendarWeek(state.day) ? state.communityWork.gained[pillar] : 0;
  return roundPillar(Math.max(0, COMMUNITY_WORK_WEEKLY_CAP - used));
};

export interface CreateTownOptions {
  /** The day the state starts on (a dev start on a later day still gets the Day-1 numbers). Default 1. */
  day?: number;
}

/** A town with the Day-1 numbers (§2.4). */
export const createTownState = (options: CreateTownOptions = {}): TownState => {
  const day = Math.max(1, Math.floor(options.day ?? 1));
  return {
    day,
    pillars: { ...DAY1_PILLARS },
    dayStart: { ...DAY1_PILLARS },
    census: DAY1_CENSUS,
    fund: DAY1_FUND,
    homes: { ...DAY1_HOMES },
    flags: {},
    openJobs: DAY1_OPEN_JOBS,
    tollmenLevelMax: DAY1_TOLLMEN_LEVEL_MAX,
    history: [{ day, pillars: { ...DAY1_PILLARS } }],
    communityWork: { week: calendarWeek(day), gained: zeroPillars() },
    log: [],
    migration: { lowStayNights: {}, notices: {} },
    optionClause: { dawnsUnder: 0, exercised: false, exercisedDay: null }
  };
};

// ── Changing a Pillar ────────────────────────────────────────────────────────

/**
 * Change one Pillar. `community_work` gains are capped at +3 per Pillar per calendar week (§6.1); every other
 * source is uncapped. The result is clamped to 0–100. The change, as asked and as applied, goes in the log.
 * A community-work loss is never capped and doesn't give back room under the cap.
 */
export const applyPillarDelta = (state: TownState, pillar: Pillar, delta: number, source: PillarSource, note?: string): TownState => {
  if (!Number.isFinite(delta)) throw new RangeError(`applyPillarDelta: ${pillar} delta ${delta} is not a number`);
  const week = calendarWeek(state.day);
  const gained = state.communityWork.week === week ? { ...state.communityWork.gained } : zeroPillars();
  let wanted = delta;
  let capped = false;
  if (source === 'community_work' && delta > 0) {
    const room = Math.max(0, COMMUNITY_WORK_WEEKLY_CAP - gained[pillar]);
    if (delta > room) { wanted = room; capped = true; }
  }
  const before = state.pillars[pillar];
  const after = roundPillar(clampPillar(before + wanted));
  const applied = roundPillar(after - before);
  if (source === 'community_work' && applied > 0) gained[pillar] = roundPillar(gained[pillar] + applied);
  const entry: PillarChange = { day: state.day, pillar, source, requested: delta, applied, capped };
  if (note !== undefined) entry.note = note;
  return {
    ...state,
    pillars: { ...state.pillars, [pillar]: after },
    communityWork: { week, gained },
    log: [...state.log, entry]
  };
};

/** Several Pillars from one source at once (a Project's "Charm +6, Spirit +2"). */
export const applyPillarDeltas = (state: TownState, deltas: Partial<Pillars>, source: PillarSource, note?: string): TownState =>
  PILLARS.reduce((s, p) => (deltas[p] ? applyPillarDelta(s, p, deltas[p]!, source, note) : s), state);

/** Set or clear one of the flags the engine reads. */
export const setTownFlag = (state: TownState, flag: TownFlag, on = true): TownState => {
  let next = { ...state, flags: { ...state.flags, [flag]: on } };
  if (flag === 'charter_found' && on && state.optionClause.exercised && !state.optionClause.reopened) {
    next = applyPillarDelta(next, 'spirit', 6, 'event', 'Option Clause: Wharf reopens');
    next = { ...next, optionClause: { ...next.optionClause, reopened: true } };
  }
  return next;
};

/** The highest Tollmen level in any zone (set by the Tollmen system, G-08). */
export const setTollmenLevelMax = (state: TownState, level: number): TownState =>
  ({ ...state, tollmenLevelMax: Math.max(0, Math.min(3, Math.round(level))) });
