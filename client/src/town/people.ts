// Arrivals and departures at dawn (GDD §6.4, §6.1, Appendix A.3; MVP G-02). Pure: no Phaser, no DOM.
//
// The town engine's dawn (townEngine.runDawn) decides how many households the ferry brings. This pass, run right
// after it, decides who: and who goes. In order:
//   1. last ferry's leavers: anyone whose Leaving Notice still stood when the Gannet sailed has gone (census, their
//      home if the household is now empty, the Spirit hit for the well-liked); a resolved notice keeps them;
//   2. the Sunday house: S05's "Kasimir did it on Sunday for nothing" restores No. 47 Lamplighter Lane on Day 6;
//   3. the nightly Stay pass over the generated residents (Leaving Notices after 5 nights under 25);
//   4. today's leavers: notices whose ferry is today walk to the slip at 09:30 (at most 2 a ferry day);
//   5. today's arrivals: one household per slot of the roll, drawn and written from templates (A.3.8), each with a
//      free restored home (A.3.4 rule 1). They wait on the ferry (`pending`) until 08:00, when bookArrivals() books
//      them in and the board lights their door (settleArrivalsAt). Online, the dawn package's households, written by
//      Haiku on the server, replace these before they land (adoptServerArrivals).
// Core and featured residents (the authored cards) never get a Stay pass in Spring: GDD-GAP, §6.4 applies Stay to
// "every resident", but the Spring story has no departures for its cast (June's ticket is for after the Regatta).
import {
  ARCHETYPE_BY_ID, PURPOSEFUL, cardsFromHousehold, drawHousehold, emptyPeople, householdLine, livingArrivals,
  templateHousehold, type ArrivalFacts, type ArrivalHousehold, type ArrivalResident, type DepartedResident, type RecentHousehold,
  type TownPeople
} from '@monde/shared';
import { isFerryDay, nightlyStay, type ArrivalDecision, type ResidentStay } from './migration';
import { freeHomes, homeKind, restoreHome, settleArrivalsAt, settleDeparturesFrom, type HomeDirectory, type HomeKey, type OccupancyLook } from './occupancy';
import { applyPillarDelta, type TownState } from './pillars';

/** §6.4: they walk off the ferry at 08:00 … */
export const ARRIVAL_MINUTE = 8 * 60;
/** … and leavers walk to the slip with a suitcase at 09:30; the Gannet sails at 10:00. */
export const LEAVE_WALK_MINUTE = 9 * 60 + 30;
export const SAILING_MINUTE = 10 * 60;
/** §6.4: at most 2 departures per ferry day. */
export const MAX_DEPARTURES_PER_FERRY = 2;
/** S05: the first house Kasimir makes dry, on Sunday (Day 6). */
export const SUNDAY_HOUSE = 'old_quarter.vacant_house_47';
export const SUNDAY_HOUSE_DAY = 6;
/** §3.2: a year in Monde is 100 days (four seasons of 25). Roots grow at 10 points a year. */
export const DAYS_PER_YEAR = 100;
/** §6.7: nine pupils on Day 1. */
export const DAY1_PUPILS = 9;
/**
 * GDD-GAP: §6.1 lowers Spirit for "departures of well-liked residents" and Prosperity for "departures of working-age
 * residents" without numbers. Spirit −1 for someone with 2+ friends in town or Regard 40+ with the Fellow; Prosperity
 * −0.5 for a working-age leaver with a job.
 */
export const DEPARTURE_SPIRIT = -1;
export const DEPARTURE_PROSPERITY = -0.5;

export const peopleOf = (state: Pick<TownState, 'people'>): TownPeople => state.people ?? emptyPeople();

/** The ferry a noticed resident would leave on: the first sailing at least two days after the notice (§6.4). */
export function departureDay(noticeDay: number, flags: TownState['flags']): number {
  let d = noticeDay + 2;
  while (!isFerryDay(d, flags)) d++;
  return d;
}

/** Everyone whose Stay is computed: the generated adults (children follow their household). */
export const stayResidents = (people: TownPeople): ArrivalResident[] => livingArrivals(people).filter(r => r.card.age >= 18);

export interface StayWorld {
  /** Friends in town (affinity ≥ 40, the G-13 ties' Friends and Close friends). */
  friends(id: string): number;
}

/** §6.4's inputs for one generated resident. */
export function stayInputsOf(r: ArrivalResident, day: number, world: StayWorld): ResidentStay {
  const archetype = ARCHETYPE_BY_ID.get(r.archetype as never);
  const works = !!r.card.workplace && r.card.workplace !== r.card.home && !/^millbrook\.school$/.test(r.card.workplace);
  const fromHome = r.card.workplace === r.card.home && !!archetype && archetype.workplaces.includes('home');
  // A.2: a drifter "changes jobs" and only settles when their first dream (be good at one thing) is done.
  // GDD-GAP: dream progress isn't tracked yet, so a drifter has no job or purpose for Stay in Spring.
  const drifting = archetype?.id === 'drifter';
  return {
    id: r.card.id, values: r.card.values, friendsInTown: world.friends(r.card.id),
    hasJobOrPurpose: !drifting && (works || fromHome || (!!archetype && PURPOSEFUL.has(archetype.id))),
    yearsInMonde: Math.max(0, day - r.arrived_day) / DAYS_PER_YEAR
  };
}

/** Stay's four factors for a Last Chance Favor (shared/favorEngine LeavingFavorNotice.factors). */
export function stayFactors(i: ResidentStay, pillars: TownState['pillars']): { town: number; friends: number; purpose: number; roots: number } {
  const town = 60 * (['prosperity', 'safety', 'spirit', 'charm'] as const).reduce((s, p) => s + i.values[p] * pillars[p] / 100, 0);
  return {
    town: Math.max(0, Math.min(60, town)), friends: 20 * Math.min(1, i.friendsInTown / 4),
    purpose: i.hasJobOrPurpose ? 10 : 0, roots: 10 * Math.min(1, i.yearsInMonde / 10)
  };
}

export interface MigrationWorld extends StayWorld {
  /** The world's seed (A.3.1: hash(world_seed, day, slot)). */
  seed: number | string;
  /** Every home door on the boards (world/townHomes.ts). */
  homes: readonly HomeKey[];
  dir: HomeDirectory;
  beds(home: HomeKey): number;
  homeName(home: HomeKey): string;
  /** Story flags that are on (plus the town's own): Projects started and done for the archetype gates. */
  storyFlags: ReadonlySet<string>;
  /** Authored cards (V03's names): id → name. */
  cast: ReadonlyMap<string, { name: string }>;
  /** Regard toward the Fellow (the well-liked test). */
  regard(id: string): number;
}

export interface MigrationDawn {
  state: TownState;
  /** Leaving Notices given tonight: the night's memories ("they tell friends"). */
  notices: { resident: string; day: number; deadline: number }[];
  /** Left on the last ferry (sent with the night so the server lets them go). */
  departed: DepartedResident[];
  /** Walking to the slip this morning. */
  leaving: string[];
  /** On this morning's ferry (template cards until the server's arrive). */
  arriving: ArrivalHousehold[];
}

const lookOf = (state: TownState, story: ReadonlySet<string>): OccupancyLook =>
  ({ flag: f => story.has(f) || (state.flags as Record<string, boolean>)[f] === true });

/** What the arrival gates read (A.2 Requires). */
export function arrivalFacts(state: TownState, people: TownPeople, world: Pick<MigrationWorld, 'homes' | 'dir' | 'beds' | 'storyFlags'>, day: number, reserved: ReadonlySet<string> = new Set()): ArrivalFacts {
  const look = lookOf(state, world.storyFlags);
  // S05: the Sunday house is the first one offered ("End of Lamplighter Lane, two doors from the Fellow's").
  const free = freeHomes(world.homes, world.dir, look).filter(h => !reserved.has(h) && !people.pending.some(p => p.home === h))
    .sort((a, b) => Number(b === SUNDAY_HOUSE) - Number(a === SUNDAY_HOUSE));
  const pupils = DAY1_PUPILS + livingArrivals(people).filter(r => r.card.age >= 5 && r.card.age <= 12).length;
  const flags = new Set([...world.storyFlags, ...Object.entries(state.flags).filter(([, v]) => v).map(([k]) => k)]);
  return {
    day, pillars: state.pillars, flags, freeHomes: free.map(home => ({ home, beds: world.beds(home) })),
    unrestoredHomes: state.homes.vacant_restorable, pupils,
    // GDD-GAP: storefronts aren't restored by any Spring Project, so none stands free for a shop founder.
    storefrontsFree: 0
  };
}

const recentOf = (people: TownPeople): RecentHousehold[] =>
  [...people.households, ...people.pending].sort((a, b) => a.day - b.day).map(h => ({ archetype: h.archetype, day: h.day, ages: h.residents.map(r => r.card.age) }));

const countBy = <T>(items: readonly T[], key: (t: T) => string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const t of items) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
  return m;
};

/** Names in use (V03): the cast and every living or pending generated resident. */
function namesInUse(people: TownPeople, cast: ReadonlyMap<string, { name: string }>): Map<string, { name: string }> {
  const out = new Map(cast);
  for (const h of [...people.households, ...people.pending]) for (const r of h.residents) out.set(r.card.id, { name: r.card.name });
  return out;
}

/**
 * Draw and write `count` households for `day` from templates (A.3.8), each with a free home that fits. Fewer come if
 * the homes run out. Shared by the dawn and the dev tools.
 */
export function templateArrivals(state: TownState, world: MigrationWorld, day: number, count: number, youthShare: number, opts: { archetype?: string; slotBase?: number } = {}): ArrivalHousehold[] {
  const people = peopleOf(state);
  const out: ArrivalHousehold[] = [];
  const taken = new Set<string>();
  for (let slot = 0; slot < count; slot++) {
    const working: TownPeople = { ...people, pending: [...people.pending, ...out] };
    const facts = arrivalFacts(state, working, world, day, taken);
    if (!facts.freeHomes.length) break;
    const draw = drawHousehold({
      seed: world.seed, day, slot: (opts.slotBase ?? 0) + slot, facts, youthShare, recent: recentOf(working),
      alive: countBy(livingArrivals(working), r => r.archetype),
      portraitUses: countBy([...livingArrivals(working), ...working.pending.flatMap(h => h.residents)], r => r.card.portrait),
      today: working.pending.filter(h => h.day === day).map(h => h.archetype),
      ...(opts.archetype ? { archetype: opts.archetype as never } : {})
    });
    if (!draw) break;
    // The smallest free home that fits the household (A.3.4 rule 1).
    const home = [...facts.freeHomes].filter(h => h.beds >= draw.beds).sort((a, b) => a.beds - b.beds)[0] ?? facts.freeHomes[0]!;
    taken.add(home.home);
    const names = namesInUse(working, world.cast);
    const departedNames = people.departed.filter(d => d.day > day - 30).map(d => d.name);
    const output = templateHousehold(draw, { residents: names, reservedFull: departedNames }, world.seed);
    const built = cardsFromHousehold(output, draw, new Set(names.keys()), home.home);
    out.push({
      id: draw.id, archetype: draw.archetype, day, home: home.home, summary: output.household.summary, generated_by: 'template',
      residents: built.map(b => ({ card: b.card, household: draw.id, archetype: draw.archetype, arrived_day: day, dream_template: b.dream_template }))
    });
  }
  return out;
}

/** The pending households whose boat is in (08:00 on their day, or any earlier day): booked into the town. */
export function bookArrivals(state: TownState, day: number, minute: number): { state: TownState; booked: ArrivalHousehold[] } {
  const people = peopleOf(state);
  const due = people.pending.filter(h => h.day < day || (h.day === day && minute >= ARRIVAL_MINUTE));
  if (!due.length) return { state, booked: [] };
  const settled = settleArrivalsAt(state, due.map(h => ({ home: h.home, size: h.residents.length })));
  return {
    state: { ...settled, people: { ...people, pending: people.pending.filter(h => !due.includes(h)), households: [...people.households, ...due] } },
    booked: due
  };
}

/** Departures for leavers whose ferry has sailed (their notice still standing). */
function settleLeavers(state: TownState, day: number, world: MigrationWorld): { state: TownState; departed: DepartedResident[] } {
  let s = state;
  let people = peopleOf(s);
  const departed: DepartedResident[] = [];
  const due = people.leaving.filter(l => l.day < day);
  for (const l of due) {
    const household = people.households.find(h => h.residents.some(r => r.card.id === l.id));
    const resident = household?.residents.find(r => r.card.id === l.id);
    if (!household || !resident || !(l.id in s.migration.notices)) {
      if (resident) people = { ...people, stayed: [...people.stayed, { id: l.id, day: l.day }] };
      continue;
    }
    // Children leave with the last adult of their household.
    const adultsLeft = household.residents.filter(r => r.card.age >= 18 && r.card.id !== l.id);
    const going = adultsLeft.length ? [resident] : household.residents;
    const emptied = going.length === household.residents.length;
    s = settleDeparturesFrom(s, going.map(r => r.card.id), emptied ? [household.home] : []);
    const friends = world.friends(l.id);
    if (friends >= 2 || world.regard(l.id) >= 40) s = applyPillarDelta(s, 'spirit', DEPARTURE_SPIRIT, 'resident_sim', `${resident.card.name} left on the ferry`);
    if (resident.card.age >= 18 && resident.card.age < 65 && resident.card.workplace !== resident.card.home) s = applyPillarDelta(s, 'prosperity', DEPARTURE_PROSPERITY, 'resident_sim', `${resident.card.name} left on the ferry`);
    for (const r of going) {
      const stayed = Math.max(1, l.day - r.arrived_day);
      departed.push({
        id: r.card.id, name: r.card.name, household: household.id, home: household.home, day: l.day, portrait: r.card.portrait,
        line: `${r.card.name} left on the Gannet on Day ${l.day}, after ${stayed} day${stayed === 1 ? '' : 's'} at ${world.homeName(household.home)}.`
      });
    }
    const rest = household.residents.filter(r => !going.includes(r));
    people = {
      ...people,
      households: rest.length ? people.households.map(h => (h === household ? { ...h, residents: rest } : h)) : people.households.filter(h => h !== household),
      departed: [...people.departed, ...departed.filter(d => going.some(r => r.card.id === d.id))],
      unsynced: people.unsynced.filter(id => id !== household.id || rest.length > 0)
    };
  }
  people = { ...people, leaving: people.leaving.filter(l => l.day >= day) };
  return { state: { ...s, people }, departed };
}

export interface DawnArrivals {
  /** Today's roll from the town engine's report (null: the report is for another day). */
  decision: ArrivalDecision | null;
}

/** The whole pass (see the head of this file). */
export function migrationDawn(prev: TownState, day: number, world: MigrationWorld, roll: DawnArrivals): MigrationDawn {
  let state: TownState = { ...prev, people: peopleOf(prev) };
  // Yesterday's boat, if nobody saw it in (a dev jump, a load before 08:00).
  state = bookArrivals(state, day, 0).state;
  // 1. The last ferry's leavers.
  const left = settleLeavers(state, day, world);
  state = left.state;
  // 2. The Sunday house.
  if (day >= SUNDAY_HOUSE_DAY && world.homes.includes(SUNDAY_HOUSE) && homeKind(SUNDAY_HOUSE, world.dir) === 'vacant') state = restoreHome(state, SUNDAY_HOUSE);
  // 3. The nightly Stay pass (generated adults only).
  let people = peopleOf(state);
  const inputs = stayResidents(people).map(r => stayInputsOf(r, day, world));
  // nightlyStay keeps every standing notice and drops the night counts of anyone not passed (the cast never is).
  const night = nightlyStay(state.migration, inputs, state.pillars, day);
  state = { ...state, migration: night.migration };
  const notices = night.notices.map(id => ({ resident: id, day, deadline: departureDay(day, state.flags) }));
  // 4. Today's leavers.
  const leaving: string[] = [];
  if (isFerryDay(day, state.flags)) {
    const due = Object.entries(state.migration.notices)
      .filter(([id, given]) => inputs.some(i => i.id === id) && departureDay(given, state.flags) <= day && !people.leaving.some(l => l.id === id))
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_DEPARTURES_PER_FERRY);
    for (const [id] of due) leaving.push(id);
    people = { ...people, leaving: [...people.leaving, ...leaving.map(id => ({ id, day }))] };
    state = { ...state, people };
  }
  // 5. Today's arrivals.
  let arriving: ArrivalHousehold[] = [];
  const decision = roll.decision?.day === day ? roll.decision : null;
  if (decision && decision.households > 0) {
    arriving = templateArrivals(state, world, day, decision.households, decision.youthShare);
    people = peopleOf(state);
    state = { ...state, people: { ...people, pending: [...people.pending, ...arriving], unsynced: [...people.unsynced, ...arriving.map(h => h.id)] } };
  }
  return { state, notices, departed: left.departed, leaving, arriving };
}

/**
 * The dawn package's households for `day` (written by Haiku on the server) in place of the local templates, if they
 * haven't landed yet. Each takes the home the server gave it; the templates' reservations are released.
 */
export function adoptServerArrivals(state: TownState, day: number, server: readonly ArrivalHousehold[]): TownState {
  const people = peopleOf(state);
  const fresh = server.filter(h => h.day === day && !people.households.some(x => x.id === h.id));
  if (!fresh.length) return state;
  const localToday = people.pending.filter(h => h.day === day);
  const pending = [...people.pending.filter(h => h.day !== day), ...fresh];
  return {
    ...state,
    people: {
      ...people, pending,
      unsynced: people.unsynced.filter(id => !localToday.some(h => h.id === id) && !fresh.some(h => h.id === id))
    }
  };
}

/** The server knows these generated residents: households of theirs are no longer waiting to be adopted. */
export function markSynced(state: TownState, known: ReadonlySet<string>): TownState {
  const people = peopleOf(state);
  const unsynced = people.unsynced.filter(id => {
    const h = [...people.households, ...people.pending].find(x => x.id === id);
    return !!h && !h.residents.every(r => known.has(r.card.id));
  });
  return unsynced.length === people.unsynced.length ? state : { ...state, people: { ...people, unsynced } };
}

/** A Last Chance Favor completed (§6.4): the notice is gone, the walk to the slip is off. */
export function resolveNotice(state: TownState, id: string, day: number): TownState {
  const notices = { ...state.migration.notices }, lowStayNights = { ...state.migration.lowStayNights };
  delete notices[id]; delete lowStayNights[id];
  const people = peopleOf(state);
  return {
    ...state, migration: { notices, lowStayNights },
    people: { ...people, leaving: people.leaving.filter(l => l.id !== id), stayed: [...people.stayed, { id, day }] }
  };
}

/** Everyone on this morning's boat out: the leavers whose notice still stands, and the children who go with them. */
export function sailingToday(state: Pick<TownState, 'people' | 'migration'>, day: number): Set<string> {
  const people = peopleOf(state);
  const out = new Set<string>();
  for (const l of people.leaving) {
    if (l.day !== day || !(l.id in state.migration.notices)) continue;
    out.add(l.id);
    const household = people.households.find(h => h.residents.some(r => r.card.id === l.id));
    if (household && !household.residents.some(r => r.card.age >= 18 && r.card.id !== l.id)) for (const r of household.residents) out.add(r.card.id);
  }
  return out;
}

/**
 * Is a generated resident about town at this minute? Not before their boat (08:00 on the day they land, or at all
 * while still pending), and not after the Gannet sails with them (10:00 on their ferry day, notice standing).
 */
export function presentAt(state: Pick<TownState, 'people' | 'migration'>, id: string, day: number, minute: number): boolean {
  const people = peopleOf(state);
  if (people.pending.some(h => h.residents.some(r => r.card.id === id))) return false;
  const household = people.households.find(h => h.residents.some(r => r.card.id === id));
  if (!household) return true;
  if (household.day === day && minute < ARRIVAL_MINUTE) return false;
  return !(minute >= SAILING_MINUTE && sailingToday(state, day).has(id));
}

/** The Dawn Report's comings and goings for `day` (§6.6): who lands this morning and who leaves on the boat. */
export function movementLines(state: Pick<TownState, 'people' | 'migration'>, day: number, homeName: (key: string) => string): { lines: string[]; residents: string[] } {
  const people = peopleOf(state);
  const landing = [...people.pending, ...people.households].filter(h => h.day === day);
  const lines = landing.map(h => householdLine(h, homeName(h.home)));
  const residents = landing.map(h => h.residents[0]!.card.id);
  for (const l of people.leaving.filter(x => x.day === day && x.id in state.migration.notices)) {
    const r = livingArrivals(people).find(x => x.card.id === l.id);
    if (!r) continue;
    lines.push(`${r.card.name} leaves on this morning's Gannet. The Lantern wishes ${r.card.pronouns === 'she/her' ? 'her' : r.card.pronouns === 'he/him' ? 'him' : 'them'} fair weather and a dry crossing.`);
    residents.push(r.card.id);
  }
  return { lines, residents };
}
