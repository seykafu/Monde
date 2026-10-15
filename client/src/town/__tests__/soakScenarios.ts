// Scripted 25-day runs of the town engine (MVP Days 1–25) for the soak test.
//
// Every scripted gain is a GDD number: §6.3 Project rewards, §8 community-work effects (inside the weekly cap),
// §14.3 riddle rewards, §7.8 Scuffle wins, and the {pillar: …} lines of the §13 scenes. The Tollmen baseline
// follows the §13.2 calendar (1, a scripted 2 on Day 3, 2 from Day 15). Kasimir restores one house on Day 6
// in both runs (S05: "Kasimir did it on Sunday"), so arrivals are gated by Appeal, not by housing.
import { weekdayOf } from '../../sim/clock';
import { computeAppeal } from '../appeal';
import { settleArrivals } from '../migration';
import {
  applyPillarDelta, applyPillarDeltas, createTownState, setTollmenLevelMax, setTownFlag,
  type Pillar, type Pillars, type PillarSource, type TownFlag, type TownState
} from '../pillars';
import { runDawn } from '../townEngine';

type Act = (s: TownState) => TownState;

const cw = (pillar: Pillar, amount: number, task: string): Act => s => applyPillarDelta(s, pillar, amount, 'community_work', task);
const gain = (source: PillarSource, deltas: Partial<Pillars>, note: string, flag?: TownFlag): Act =>
  s => { const t = applyPillarDeltas(s, deltas, source, note); return flag ? setTownFlag(t, flag) : t; };
const flag = (f: TownFlag): Act => s => setTownFlag(s, f);
/** One vacant home restored (Kasimir's favour on Day 6, then the `homes` Project from Day 10). */
const restoreHome: Act = s => ({ ...s, homes: { ...s.homes, vacant_restorable: s.homes.vacant_restorable - 1, restored_free: s.homes.restored_free + 1 } });

/** §13.2 Tollmen baseline for Spring. */
export const tollmenBaseline = (day: number): number => (day === 3 || day >= 15 ? 2 : 1);

/** Happens whatever the player does. */
const STORY: Record<number, Act[]> = {
  6: [restoreHome], // S05: the house Kasimir did on Sunday
  18: [flag('option_known')] // S08 The Option
};

/** Steady community work for a strong player: whatever is open that day (§8), the cap trims the rest. */
const routine = (day: number): Act[] => [
  cw('charm', 0.5, 'Sweep Market Row'),
  ...(day >= 2 ? [cw('spirit', 0.3, 'Mail Round'), cw('charm', 0.2, 'Library Returns')] : []),
  ...(day >= 3 ? [cw('charm', 0.4, 'Litter pick')] : []),
  ...(day >= 8 ? [cw('prosperity', 0.3, 'Net Mending'), cw('charm', 0.4, 'Weeding')] : []),
  ...(day >= 12 ? [cw('spirit', 0.4, 'Tutor at school')] : []),
  ...(day >= 15 ? [cw('safety', 0.8, 'Night watch')] : [])
];

/** §6.2's "strong first week": fountain, bakery, a Scuffle win, early Marks, steady community work. */
const STRONG: Record<number, Act[]> = {
  1: [gain('riddle', { charm: 1 }, 'OQ-1')],
  2: [gain('riddle', { charm: 1 }, 'OQ-2')],
  3: [gain('story', { safety: 1 }, 'S03 Tolls'), gain('scuffle', { safety: 2 }, 'sc_bakery_tutorial won')],
  4: [gain('project', { prosperity: 3 }, 'bakery_ovens')],
  5: [gain('riddle', { charm: 1 }, 'OQ-3')],
  6: [gain('project', { charm: 6, spirit: 2 }, 'fountain')],
  7: [
    gain('riddle', { charm: 1 }, 'OQ-4'), gain('riddle', { charm: 1 }, 'OQ-5'), gain('riddle', { spirit: 3 }, 'OQ chain complete'),
    gain('project', { charm: 5 }, 'clocktower (PZ-15)'), gain('story', { spirit: 4 }, 'S07 Quarter Chime (A)')
  ],
  // Weeks 2–4: the first arrival's welcome, then the Spring Projects and the homes Project.
  8: [gain('story', { spirit: 3, charm: 1 }, 'S05 First Arrival')],
  9: [gain('riddle', { charm: 1 }, 'MR-1')],
  11: [restoreHome],
  12: [gain('project', { safety: 6, charm: 2 }, 'streetlights', 'project_streetlights_done')],
  13: [gain('project', { spirit: 3, charm: 2 }, 'community_garden')],
  14: [restoreHome, gain('riddle', { charm: 1 }, 'MR-2')],
  17: [restoreHome],
  19: [gain('project', { prosperity: 6, spirit: 3 }, 'market_hall')],
  20: [restoreHome, gain('riddle', { charm: 1 }, 'WF-1')],
  23: [restoreHome],
  24: [gain('riddle', { charm: 1 }, 'WF-2')]
};

/** A passive player: no tasks, Projects or riddles. Only the beats that play regardless. */
const PASSIVE: Record<number, Act[]> = {
  14: [gain('story', { spirit: 2, charm: 1 }, 'S07 Quarter Chime (B, the borrowed chime)')]
};

/** Arriving household sizes, in turn (1–4 people, mean 1.9, §6.4). */
const HOUSEHOLD_SIZES = [2, 1, 3, 2, 1, 2, 2, 1, 3, 2];

export interface SoakDay {
  day: number;
  weekday: string;
  pillars: Pillars;
  youth: number;
  elder: number;
  momentum: number;
  appeal: number;
  freeHomes: number;
  households: number;
  outcome: string;
  census: number;
  fund: number;
}

export interface SoakResult {
  days: SoakDay[];
  firstArrivalDay: number | null;
  households: number;
  final: TownState;
}

export const SCENARIOS = { strong: STRONG, passive: PASSIVE } as const;
export type ScenarioName = keyof typeof SCENARIOS;

/** Days 1–25: dawn (from Day 2), arrivals booked in at 08:00, then the day's events. */
export const runSoak = (name: ScenarioName, lastDay = 25): SoakResult => {
  const script = SCENARIOS[name];
  let s = createTownState();
  const days: SoakDay[] = [];
  let firstArrivalDay: number | null = null, households = 0, nextSize = 0;
  for (let day = 1; day <= lastDay; day++) {
    let outcome = 'day 1';
    let arriving = 0;
    if (day > 1) {
      const { state, report } = runDawn(s, { day });
      s = state;
      arriving = report.arrivals.households;
      outcome = report.arrivals.outcome;
      if (arriving > 0) {
        const sizes = Array.from({ length: arriving }, () => HOUSEHOLD_SIZES[nextSize++ % HOUSEHOLD_SIZES.length]!);
        s = settleArrivals(s, sizes);
        firstArrivalDay ??= day;
        households += arriving;
      }
    }
    const a = computeAppeal(s);
    days.push({
      day, weekday: weekdayOf(day), pillars: { ...s.pillars }, youth: a.youth, elder: a.elder, momentum: a.momentum, appeal: a.appeal,
      freeHomes: s.homes.restored_free, households: arriving, outcome, census: s.census, fund: s.fund
    });
    s = setTollmenLevelMax(s, tollmenBaseline(day));
    const acts = [...(STORY[day] ?? []), ...(script[day] ?? []), ...(name === 'strong' ? routine(day) : [])];
    for (const act of acts) s = act(s);
  }
  return { days, firstArrivalDay, households, final: s };
};
