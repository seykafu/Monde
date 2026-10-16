// Who lives where (GDD §6.4, §9.5, Appendix A.1.2–A.1.3): the town engine's homes, door by door.
//
// The engine counts homes (TownState.homes: occupied, vacant_restorable, restored_free); the board needs to
// know which doors those are, so a house nobody lives in never smokes or lights its windows. Every home on a
// board is one of:
//
//   resident    a named resident's home: their persona card's `home` (§9.5), or a flat inside a building
//               (`margo_flat` above the library). Lived in while one of them has a bed there.
//   player      the Lamplighter's Cottage, the Fellow's from S01c (`cottage_keys_given`, §11.5).
//   household   a census household nobody has met yet: one of A.1.2's 123, off-screen in the sim. Occupied
//               homes not named in §9.5 take `home_NN` ids (A.1.3); a named flat with no card (`dunmore_flat`,
//               the Calloways' `home_bunkhouse`) is one too. Lived in from Day 1.
//   vacant      housing stock (`vacant_house_NN`, the 61 of §2.4) or a plain vacant home: faded and dark until
//               restored (`project_<id>_done`, the `homes` Project) and moved into.
//
// Moving in and out is per door, kept in the town engine's flags (TownState.flags, saved as SavedTown.flags):
//   home_occupied:<zone>.<home>   a household lives here now (an arrival into a restored vacant home)
//   home_vacated:<zone>.<home>    the household has left (a departure from a lived-in home)
// G-02 books arrivals with settleArrivalsAt() (settleArrivals + the doors) and departures with vacateHomes();
// the board reads the flags through its TownLook and swaps the house's art and lights in place.
//
// Pure: no Phaser, no DOM.
import { settleArrivals, settleDepartures } from './migration';
import type { TownState } from './pillars';

export type HomeKind = 'resident' | 'player' | 'household' | 'vacant';

/** `zone.home`, the id residents' cards and the place registry use (`old_quarter.pell_house`). */
export type HomeKey = string;
export const homeKey = (zone: string, home: string): HomeKey => `${zone}.${home}`;

/** A plain vacant home: not one of the numbered 61, so nobody moves in until a zone names it. */
export const PLAIN_VACANT = 'vacant';
const VACANT_STOCK = /^vacant_house_\d+$/;
/** Census households not named in §9.5 (A.1.3, A.6). */
export const HOUSEHOLD_ID = /^home_\d{2}$/;

export const occupiedFlag = (key: HomeKey): string => `home_occupied:${key}`;
export const vacatedFlag = (key: HomeKey): string => `home_vacated:${key}`;

/** What decides who is home: the story's flags and the town engine's (ZoneScene's TownLook). */
export interface OccupancyLook {
  flag(name: string): boolean;
}

export interface HomeDirectory {
  /** `zone.home` → the residents with a bed there (cards' `home`). */
  readonly residents: ReadonlyMap<HomeKey, readonly string[]>;
  /** Homes a resident takes later, from a flag on (§9.5). */
  readonly later: readonly { home: HomeKey; resident: string; flag: string }[];
  /** The Fellow's home and the flag that makes it theirs. */
  readonly player: { home: HomeKey; flag: string };
}

/** Cards whose agents have no bed in the census (A.1: Bastien is a cat; Vane is off-map until Day 48). */
const NOT_HOMED = new Set(['bastien']);
/** §9.5: "On Day 48 he buys `harbormaster_house`"; `vane_resident` is set that dawn (§13.6). */
export const LATER_HOMES: HomeDirectory['later'] = [{ home: 'wharf.harbormaster_house', resident: 'vane', flag: 'vane_resident' }];
/** §11.5 / S01c: Pell hands over the keys (`cottage_keys_given`). */
export const PLAYER_HOME: HomeDirectory['player'] = { home: 'old_quarter.lamplighter_cottage', flag: 'cottage_keys_given' };

/** The directory from the persona cards (§9.3 `home`). */
export function directoryFromCards(cards: readonly { id: string; home: string }[]): HomeDirectory {
  const residents = new Map<HomeKey, string[]>();
  for (const card of cards) {
    if (NOT_HOMED.has(card.id) || card.home.startsWith('offmap.')) continue;
    residents.set(card.home, [...(residents.get(card.home) ?? []), card.id]);
  }
  return { residents, later: LATER_HOMES, player: PLAYER_HOME };
}

export function homeKind(key: HomeKey, dir: HomeDirectory): HomeKind {
  const home = key.slice(key.indexOf('.') + 1);
  if (home === PLAIN_VACANT || VACANT_STOCK.test(home)) return 'vacant';
  if (key === dir.player.home) return 'player';
  if (dir.residents.has(key) || dir.later.some(l => l.home === key)) return 'resident';
  return 'household';
}

/** The residents with a bed in a home now (later homes once their flag is on). */
export function residentsOf(key: HomeKey, dir: HomeDirectory, look: OccupancyLook): string[] {
  return [...(dir.residents.get(key) ?? []), ...dir.later.filter(l => l.home === key && look.flag(l.flag)).map(l => l.resident)];
}

/** Does anyone live here tonight? */
export function isOccupied(key: HomeKey, dir: HomeDirectory, look: OccupancyLook): boolean {
  const home = key.slice(key.indexOf('.') + 1);
  // A plain vacant home has no address to move into.
  if (home === PLAIN_VACANT) return false;
  if (look.flag(vacatedFlag(key))) return false;
  if (look.flag(occupiedFlag(key))) return true;
  switch (homeKind(key, dir)) {
    case 'vacant': return false;
    case 'player': return look.flag(dir.player.flag);
    case 'resident': return residentsOf(key, dir, look).length > 0;
    case 'household': return true;
  }
}

/** A building's homes: the ones its zone entry names, else the building itself if its place is a home. */
export function buildingHomes(zone: string, b: { id?: string; homes?: readonly string[] }, dir: HomeDirectory): HomeKey[] {
  if (b.homes?.length) return b.homes.map(h => homeKey(zone, h));
  if (!b.id) return [];
  const key = homeKey(zone, b.id);
  return VACANT_STOCK.test(b.id) || key === dir.player.home || homeKind(key, dir) === 'resident' ? [key] : [];
}

/** Empty shop units (A.1.4: `storefront_1` … `storefront_9`): dark until reopened (`project_<id>_done`). */
const EMPTY_SHOP = /^storefront_\d+$/;

export interface LitBuilding {
  id?: string;
  /** Its homes (buildingHomes). Empty for a workplace, a shed, a chapel. */
  homes: readonly HomeKey[];
  /** The art shown now. */
  faded: boolean;
  /** Nobody works inside after dark (townSprites `unlit`). */
  unlit: boolean;
}

/**
 * Lit windows, a light at the door and chimney smoke after dark (§16.4: occupied homes only). A building with
 * homes is lived in while any of them is; a workplace keeps a light on while it is open for business (not a
 * faded one, an empty shop or one with nobody inside after dark).
 */
export function isLit(b: LitBuilding, dir: HomeDirectory, look: OccupancyLook): boolean {
  if (b.homes.length) return b.homes.some(h => isOccupied(h, dir, look));
  if (b.faded || b.unlit) return false;
  return !(b.id && EMPTY_SHOP.test(b.id) && !look.flag(`project_${b.id}_done`));
}

/** True when the art should show the restored house (someone moved in: a vacant home is restored first, §6.4). */
export const movedIn = (homes: readonly HomeKey[], look: OccupancyLook): boolean => homes.some(h => look.flag(occupiedFlag(h)));

// ── Moving in and out (G-02) ────────────────────────────────────────────────

const setFlags = (state: TownState, on: readonly string[], off: readonly string[]): TownState => {
  const flags: Record<string, boolean> = { ...state.flags };
  for (const f of off) delete flags[f];
  for (const f of on) flags[f] = true;
  return { ...state, flags: flags as TownState['flags'] };
};

/** Households move into these homes (the doors only; the counts are settleArrivals'). */
export const occupyHomes = (state: TownState, homes: readonly HomeKey[]): TownState =>
  setFlags(state, homes.map(occupiedFlag), homes.map(vacatedFlag));

/** These homes empty (the doors only; the counts are settleDepartures'). */
export const vacateHomes = (state: TownState, homes: readonly HomeKey[]): TownState =>
  setFlags(state, homes.map(vacatedFlag), homes.map(occupiedFlag));

/**
 * The 08:00 arrivals with their doors: settleArrivals (census, occupied, restored_free) plus the homes they
 * take, so the board lights them. Households beyond the free homes are not housed (as settleArrivals).
 */
export function settleArrivalsAt(state: TownState, households: readonly { home: HomeKey; size: number }[]): TownState {
  const housed = households.slice(0, Math.max(0, state.homes.restored_free));
  return occupyHomes(settleArrivals(state, housed.map(h => h.size)), housed.map(h => h.home));
}

/** Departures with the homes they leave empty: settleDepartures plus the doors going dark. */
export const settleDeparturesFrom = (state: TownState, residentIds: readonly string[], homes: readonly HomeKey[]): TownState =>
  vacateHomes(settleDepartures(state, residentIds, homes.length), homes);

/**
 * The `homes` Project (§6.3, §6.4) restored a vacant house: one fewer to restore, one more free home for arrivals, and
 * its `project_<house>_done` flag (the board swaps its art; freeHomes() offers its door). Once per house.
 */
export function restoreHome(state: TownState, key: HomeKey): TownState {
  const flag = `project_${key.slice(key.indexOf('.') + 1)}_done`;
  if ((state.flags as Record<string, boolean>)[flag]) return state;
  const restored = setFlags(state, [flag], []);
  return {
    ...restored,
    homes: { ...state.homes, vacant_restorable: Math.max(0, state.homes.vacant_restorable - 1), restored_free: state.homes.restored_free + 1 }
  };
}

/**
 * Free restored homes, the doors an arrival can take: vacant stock that has been restored and nobody lives in,
 * and lived-in homes that have emptied. In the order given (a board's, or the town's).
 */
export function freeHomes(homes: readonly HomeKey[], dir: HomeDirectory, look: OccupancyLook): HomeKey[] {
  return homes.filter(h => {
    if (isOccupied(h, dir, look) || h.endsWith(`.${PLAIN_VACANT}`)) return false;
    if (homeKind(h, dir) !== 'vacant') return look.flag(vacatedFlag(h));
    return look.flag(`project_${h.slice(h.indexOf('.') + 1)}_done`);
  });
}

// ── A board's numbers ───────────────────────────────────────────────────────

export interface BoardHomes {
  resident: number;
  player: number;
  household: number;
  vacant: number;
  /** Lived in now. */
  lit: number;
}

export function countHomes(homes: readonly HomeKey[], dir: HomeDirectory, look: OccupancyLook): BoardHomes {
  const out: BoardHomes = { resident: 0, player: 0, household: 0, vacant: 0, lit: 0 };
  for (const h of homes) {
    out[homeKind(h, dir)]++;
    if (isOccupied(h, dir, look)) out.lit++;
  }
  return out;
}
