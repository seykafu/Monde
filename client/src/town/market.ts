// The Saturday market (GDD §13.2's standing weekly rhythm: "Saturday: market in the Covered Market Hall"; §6.1
// Prosperity: "the Saturday market"; the Fund's stall fees, town/fund.ts). Pure: no Phaser, no DOM.
//
// Until the market_hall Project reopens the hall, the market is held out on the flags south of Market Street, where its
// stalls stand bare the rest of the week (content/zones/market_row.zone.yaml). During market hours:
//   - the stalls' awnings fill (world/townSprites.ts: `market_stall` is restored by the MARKET_DAY_LOOK flag, which
//     ZoneScene's TownLook sets on Market Row while marketOpen());
//   - everyone whose plan takes them to the hall (Appendix A.1.4's market-day stallholders, Nell with her fish, the
//     residents who shop there on weekends) stands among the stalls instead of at the shut hall's door
//     (marketShifts: their hall blocks get the stalls' area, like a Project's work area, sim/volunteers.ts).
// Once the hall reopens, the market moves inside and the street keeps its own look.
import type { DayPlan } from '../sim/plans';
import { withShifts, type Shift } from '../sim/volunteers';
import { isMarketDay } from './fund';

/**
 * GDD-GAP: §13.2 gives no market hours. S04 (Saturday, from 09:00) hears the trestles going up, and the residents'
 * weekend blocks at the hall run from 08:00 to about 14:00.
 */
export const MARKET_OPENS = 8 * 60;
export const MARKET_CLOSES = 14 * 60;

/** Where residents' plans hold the market (§2.3: the Covered Market Hall). */
export const MARKET_PLACE = 'market_row.market_hall';

/** The flags between Market Row's stalls (two rows of stalls at y 17 and 20, x 9 to 26), [x, y, w, h] in tiles. */
export const STALL_AREA: readonly [number, number, number, number] = [8, 16, 20, 6];

/** The TownLook flag that fills the stalls (not a story or town flag: ZoneScene answers it from the clock). */
export const MARKET_DAY_LOOK = 'market_day';

/** The market is on: a Saturday, in market hours. */
export const marketOpen = (day: number, minute: number): boolean =>
  isMarketDay(day) && minute >= MARKET_OPENS && minute < MARKET_CLOSES;

/**
 * On a market day while the hall is shut: every block at the hall that overlaps market hours, stood among the stalls
 * for the overlap (blocks that already have a work area, a Project shift, keep it).
 */
export function marketShifts(plans: readonly DayPlan[], day: number, hallOpen: boolean): Shift[] {
  if (hallOpen || !isMarketDay(day)) return [];
  return plans.flatMap(plan => plan.blocks
    .filter(b => b.place === MARKET_PLACE && !b.area && b.endMin > MARKET_OPENS && b.startMin < MARKET_CLOSES)
    .map(b => ({
      resident: plan.resident, action: b.action, place: b.place, area: STALL_AREA,
      startMin: Math.max(b.startMin, MARKET_OPENS), endMin: Math.min(b.endMin, MARKET_CLOSES), note: 'the Saturday market'
    })));
}

/** The day's plans with the market's shifts spliced in (ResidentSim's `market` plan adjuster). */
export const marketPlans = (plans: readonly DayPlan[], day: number, hallOpen: boolean): readonly DayPlan[] =>
  withShifts(plans, marketShifts(plans, day, hallOpen));

/** The adjuster's cache key: the plans change only on market days, and when the hall reopens. */
export const marketKey = (day: number, hallOpen: boolean): string => (isMarketDay(day) && !hallOpen ? 'stalls' : '');
