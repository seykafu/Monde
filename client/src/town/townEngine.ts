import { SavedTown } from '@monde/shared';
// The town engine's dawn pass (GDD §6, §6.6).
//
// At 06:00 each day, in this order:
//   1. drift            the night's Pillar drift (§6.1)
//   2. appeal           Youth, Elder, Momentum, Appeal (§6.2), on the drifted Pillars
//   3. departures       the nightly Stay pass and Leaving Notices (§6.4)
//      arrivals         the arrival roll: households and the youth share (§6.4)
//   4. option clause    one dawn of the 7-dawn census counter (§6.5)
//   5. fund             yesterday's books: rates, stall fees, upkeep (§6.3)
// and the Pillars as the day begins go into the 7-day history Momentum reads.
//
// runDawn returns a new state and a DawnReport-shaped summary (the Dawn Report's Town Ledger strip and its
// comings-and-goings inputs, §6.6). It decides; it doesn't generate people: arrivals are booked in with
// settleArrivals() when G-02 has made them, and departures with settleDepartures().
import { DAY_START, formatDate, gameTime, type Weekday } from '../sim/clock';
import { computeAppeal, type AppealBreakdown } from './appeal';
import { applyDrift } from './drift';
import { fundDay, type FundDay, type UpkeepItem } from './fund';
import { decideArrivals, nightlyStay, type ArrivalDecision, type ResidentStay } from './migration';
import { optionClauseDawn, optionGauge, type OptionGauge } from './optionClause';
import {
  applyPillarDeltas, HISTORY_DAYS, LOG_DAYS, PILLARS, calendarWeek, mapPillars, roundPillar, zeroPillars,
  type Pillar, type TownState
} from './pillars';

export interface DawnContext {
  /** The day that is dawning. Must be after state.day. */
  day: number;
  /** Residents for the nightly Stay pass. Without it the pass is skipped and every count stands. */
  residents?: readonly ResidentStay[];
  /** Upkeep the §6.3 table doesn't cover yet, charged against yesterday. */
  extraUpkeep?: readonly UpkeepItem[];
}

export interface PillarLine {
  /** At the previous dawn (yesterday morning). */
  from: number;
  /** Now, after the night's drift. */
  to: number;
  delta: number;
  /** The night's drift, part of `delta`. */
  drift: number;
}

export interface DawnReport {
  day: number;
  weekday: Weekday;
  /** "Wed · Spring 2" */
  date: string;
  /** Each Pillar since the last dawn: yesterday's changes plus the night's drift (the Ledger strip's arrows). */
  pillarChanges: Record<Pillar, PillarLine>;
  appeal: AppealBreakdown;
  arrivals: ArrivalDecision;
  departures: {
    /** Residents given a Leaving Notice tonight. */
    notices: string[];
    /** Everyone holding a notice. */
    pending: string[];
    /** Tonight's Stay scores (empty when no residents were passed). */
    stay: Record<string, number>;
  };
  /** The census at dawn (today's arrivals walk off the ferry at 08:00). */
  census: number;
  fund: { before: number; after: number; books: FundDay };
  optionClause: { dawnsUnder: number; triggered: boolean; exercised: boolean; gauge: OptionGauge };
}

export interface DawnResult {
  state: TownState;
  report: DawnReport;
}

export const runDawn = (prev: TownState, ctx: DawnContext): DawnResult => {
  const day = Math.floor(ctx.day);
  if (!(day > prev.day)) throw new RangeError(`runDawn: Day ${day} has already dawned (the town is on Day ${prev.day})`);
  const yesterday = day - 1;
  const lastDawn = prev.history.length ? prev.history[prev.history.length - 1]!.pillars : prev.dayStart;

  // The new day: today's change starts from here, the community-work week may roll, old log entries go.
  const week = calendarWeek(day);
  let state: TownState = {
    ...prev,
    day,
    dayStart: { ...prev.pillars },
    communityWork: prev.communityWork.week === week ? prev.communityWork : { week, gained: zeroPillars() },
    log: prev.log.filter(c => c.day > day - LOG_DAYS)
  };

  // 1. Drift, on yesterday's Tollmen level.
  state = applyDrift(state);
  const drift = mapPillars(p => roundPillar(state.pillars[p] - prev.pillars[p]));

  // 2. Appeal.
  const appeal = computeAppeal(state);

  // 3. Departures (the nightly Stay pass), then arrivals.
  let stay: Record<string, number> = {};
  let notices: string[] = [];
  if (ctx.residents) {
    const night = nightlyStay(state.migration, ctx.residents, state.pillars, day);
    state = { ...state, migration: night.migration };
    stay = night.stay;
    notices = night.notices;
  }
  const arrivals = decideArrivals({
    day, appeal: appeal.appeal, youthShare: appeal.youthShare, flags: state.flags, freeHomes: state.homes.restored_free
  });

  // 4. The Option Clause, on the census at dawn.
  const option = optionClauseDawn(state.optionClause, state.census, day, state.flags);
  state = { ...state, optionClause: option.state };
  if (option.triggered) {
    state = applyPillarDeltas(state, { prosperity: -8, spirit: -4 }, 'event', 'Option Clause: Port Vane survey site');
    state = { ...state, flags: { ...state.flags, option_known: true } };
  }

  // 5. Yesterday's books.
  const books = fundDay(yesterday, state.homes.occupied, state.flags, ctx.extraUpkeep);
  const fundBefore = state.fund;
  state = { ...state, fund: state.fund + books.net };

  // Today's dawn joins the history (today and the seven days before it are kept).
  state = {
    ...state,
    history: [...state.history.filter(s => s.day >= day - HISTORY_DAYS && s.day < day), { day, pillars: { ...state.pillars } }]
  };

  const pillarChanges = Object.fromEntries(PILLARS.map(p => [p, {
    from: lastDawn[p], to: state.pillars[p], delta: roundPillar(state.pillars[p] - lastDawn[p]), drift: drift[p]
  }])) as Record<Pillar, PillarLine>;
  const t = gameTime(day, DAY_START);
  return {
    state,
    report: {
      day,
      weekday: t.weekday,
      date: formatDate(t),
      pillarChanges,
      appeal,
      arrivals,
      departures: { notices, pending: Object.keys(state.migration.notices), stay },
      census: state.census,
      fund: { before: fundBefore, after: state.fund, books },
      optionClause: {
        dawnsUnder: state.optionClause.dawnsUnder,
        triggered: option.triggered,
        exercised: state.optionClause.exercised,
        gauge: optionGauge(state)
      }
    }
  };
};

/** Run every dawn from the day after `state.day` through `day` (a dev time jump skips no nights). */
export const runDawnsThrough = (state: TownState, day: number, ctx: Omit<DawnContext, 'day'> = {}): { state: TownState; reports: DawnReport[] } => {
  const reports: DawnReport[] = [];
  let s = state;
  while (s.day < day) {
    const r = runDawn(s, { ...ctx, day: s.day + 1 });
    s = r.state;
    reports.push(r.report);
  }
  return { state: s, reports };
};


/** Detached, validated engine state for save files; never serializes scene objects. */
export const serialize = (state: TownState): TownState => SavedTown.parse(state);
export const restore = (raw: unknown): TownState => SavedTown.parse(raw);
