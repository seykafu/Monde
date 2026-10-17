// Arrivals and departures in the running game (GDD §6.4, §6.6, §13.3 S05; MVP G-02): the Phaser-free glue between
// the town engine's state in the registry and the pure pass in town/people.ts.
//
// - attachMigration() runs the pass at every dawn of the clock, right after the town's own dawn (TownLedgerScene
//   attachTown), and books the morning's households in when the Gannet lands at 08:00. Online, the dawn package's
//   households (written by Haiku on the server) replace the local templates before they land (adoptDawnArrivals).
// - The roster (world/roster.ts) mirrors the town's generated residents whenever the town changes, so every scene
//   finds a newcomer; the shared ResidentSim learns them, who is about town when (presence) and their first and last
//   days (installMigration).
// - The night POST carries the arrival roll, Quiet Mode households to adopt, last ferry's leavers and tonight's
//   Leaving Notices (nightArrivals); the Dawn Report prints the comings and goings (paperMovements).
// - S05's scripted `arrival` resolves to the first real arrival; its held memories and Regard go once the server
//   knows who that is.
import type Phaser from 'phaser';
import type { ArrivalHousehold } from '@monde/shared';
import { livingArrivals } from '@monde/shared';
import type { DawnPackage, NightRequest } from '../mind/dawn';
import { resolveHeld } from '../mind/events';
import type { Clock } from '../sim/clock';
import { landingDayPlan, leavingDayPlan } from '../sim/arrivalPlans';
import type { ResidentSim } from '../sim/residentSim';
import { DAY1_PUPILS, adoptServerArrivals, arrivalFacts, bookArrivals, markSynced, migrationDawn, movementLines, peopleOf, presentAt, sailingToday, type MigrationWorld } from '../town/people';
import type { TownState } from '../town/pillars';
import type { DawnReport } from '../town/townEngine';
import { homeDirectory } from '../world/homes';
import { personaCards } from '../world/residents';
import { arrivalId, findCard, generatedCards, onRosterChange, syncRoster } from '../world/roster';
import { homeBeds, homeName, townHomeKeys } from '../world/townHomes';
import { zones } from '../world/zones';
import { EVENTS_KEY, getEventLog } from './events';
import { regardFor, tieMap } from './friendship';

type Registry = Phaser.Data.DataManager;
const TOWN_KEY = 'monde.town';
const DAWN_REPORT_KEY = 'monde.dawnReport';
const FLAGS_KEY = 'monde.story.flags';
/** This dawn's leavers and notices, for the night POST (scenes/friendship.ts nightRequest). */
export const MIGRATION_NIGHT_KEY = 'monde.migration.night';
/** Fired on the registry's events when a household lands (the zone relights the board). */
export const ARRIVALS_LANDED = 'monde.arrivals.landed';

interface MigrationNight { day: number; departed: string[]; notices: { resident: string; day: number; deadline: number; friends: string[] }[] }

const getTown = (registry: Pick<Registry, 'get'>): TownState | undefined => registry.get(TOWN_KEY) as TownState | undefined;
let homesMemo: string[] | null = null;
const allHomes = (): string[] => (homesMemo ??= townHomeKeys(zones, homeDirectory));
const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();

/** The story's flags that are on (the save's record). */
function storyFlags(registry: Pick<Registry, 'get'>): Set<string> {
  const raw = (registry.get(FLAGS_KEY) ?? {}) as Record<string, unknown>;
  return new Set(Object.entries(raw).filter(([k, v]) => v === true && !k.startsWith('$')).map(([k]) => k));
}

/** Friends in town (§6.4: affinity ≥ 40): the G-13 ties labelled Friends or Close friends, and their own household. */
export function friendsInTown(registry: Registry, id: string): number {
  const friends = new Set<string>();
  for (const t of tieMap(registry).values()) {
    if ((t.a === id || t.b === id) && (t.label === 'friends' || t.label === 'close_friends')) friends.add(t.a === id ? t.b : t.a);
  }
  const town = getTown(registry);
  const living = new Set([...personaCards.map(c => c.id), ...livingArrivals(town?.people).map(r => r.card.id)]);
  for (const r of findCard(id)?.relationships ?? []) if (r.affinity >= 40 && living.has(r.id)) friends.add(r.id);
  friends.delete(id);
  return friends.size;
}

/** The world the pure pass reads. */
export function migrationWorld(registry: Registry): MigrationWorld {
  const seed = (registry.get('monde.save.weather') as { seed?: number } | undefined)?.seed ?? (Number(query.get('seed')) || 1);
  return {
    seed, homes: allHomes(), dir: homeDirectory, beds: homeBeds, homeName,
    storyFlags: storyFlags(registry),
    cast: new Map(personaCards.map(c => [c.id, { name: c.name, portrait: c.portrait }])),
    friends: id => friendsInTown(registry, id),
    regard: id => regardFor(registry, id)
  };
}

/** Mirror the town into the roster, and let S05's held events go once its arrival is someone the server knows. */
function syncFromTown(registry: Registry, day: number): void {
  const town = getTown(registry);
  syncRoster(town?.people, day);
  const alias = arrivalId();
  if (!alias || !town) return;
  const people = peopleOf(town);
  const household = [...people.households, ...people.pending].find(h => h.residents.some(r => r.card.id === alias));
  // Offline the server can't take them anyway; online, only once it has the household (adopted or its own).
  if (!household || people.unsynced.includes(household.id) || people.pending.includes(household)) return;
  const log = getEventLog(registry), next = resolveHeld(log, 'arrival', alias);
  if (next !== log) registry.set(EVENTS_KEY, next);
}

const attachedClocks = new WeakSet<Clock>();
const watchedRegistries = new WeakSet<Registry>();

/** Run the arrivals pass on every dawn of this clock and land the boat at 08:00 (once per clock). */
export function attachMigration(registry: Registry, clock: Clock): void {
  if (!watchedRegistries.has(registry)) {
    watchedRegistries.add(registry);
    const onTown = (_parent: unknown, key: string) => { if (key === TOWN_KEY) syncFromTown(registry, (registry.get('monde.clock') as Clock | undefined)?.day ?? 1); };
    registry.events.on('setdata', onTown).on('changedata', onTown);
  }
  syncFromTown(registry, clock.day);
  if (attachedClocks.has(clock)) return;
  attachedClocks.add(clock);
  clock.onDawn(t => {
    const town = getTown(registry);
    if (!town) return;
    const report = registry.get(DAWN_REPORT_KEY) as DawnReport | undefined;
    const world = migrationWorld(registry);
    const result = migrationDawn(town, t.day, world, { decision: report?.day === t.day ? report.arrivals : null });
    registry.set(MIGRATION_NIGHT_KEY, {
      day: t.day, departed: result.departed.map(d => d.id),
      notices: result.notices.map(n => ({ ...n, friends: friendIds(registry, n.resident) }))
    } satisfies MigrationNight);
    registry.set(TOWN_KEY, result.state);
    if (import.meta.env.DEV && (result.arriving.length || result.leaving.length || result.notices.length || result.departed.length)) {
      console.info(`[arrivals] Day ${t.day}: ${result.arriving.map(h => `${h.residents.map(r => r.card.name).join(' & ')} (${h.archetype}) → ${h.home}`).join('; ') || 'nobody on the boat'} · leaving ${result.leaving.join(', ') || 'nobody'} · notices ${result.notices.map(n => n.resident).join(', ') || 'none'} · left ${result.departed.map(d => d.name).join(', ') || 'nobody'}`);
    }
  });
  clock.onMinute(t => landBoat(registry, t.day, t.minute));
  landBoat(registry, clock.day, clock.minute);
}

/** The 08:00 boat: book in anyone whose household has landed (a load after 08:00 lands them at once). */
export function landBoat(registry: Registry, day: number, minute: number): ArrivalHousehold[] {
  const town = getTown(registry);
  if (!town?.people?.pending.length) return [];
  const { state, booked } = bookArrivals(town, day, minute);
  if (!booked.length) return [];
  registry.set(TOWN_KEY, state);
  registry.events.emit(ARRIVALS_LANDED, booked);
  return booked;
}

/** Friends to tell about a Leaving Notice. */
function friendIds(registry: Registry, id: string): string[] {
  const out = new Set<string>();
  for (const t of tieMap(registry).values()) if ((t.a === id || t.b === id) && (t.label === 'friends' || t.label === 'close_friends')) out.add(t.a === id ? t.b : t.a);
  for (const r of findCard(id)?.relationships ?? []) if (r.affinity >= 40) out.add(r.id);
  out.delete(id);
  return [...out].slice(0, 12);
}

/** The night POST's G-02 part, for the night before `dawnDay` (scenes/friendship.ts nightRequest). */
export function nightArrivals(registry: Registry, dawnDay: number): Pick<NightRequest, 'arrivals' | 'adopt' | 'departed' | 'notices'> {
  const town = getTown(registry);
  if (!town) return {};
  const people = peopleOf(town);
  const report = registry.get(DAWN_REPORT_KEY) as DawnReport | undefined;
  const world = migrationWorld(registry);
  // The server picks from every free home this morning, the ones today's local templates reserved included.
  const facts = arrivalFacts(town, { ...people, pending: people.pending.filter(h => h.day !== dawnDay) }, world, dawnDay);
  const round = (v: number) => Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  const night = registry.get(MIGRATION_NIGHT_KEY) as MigrationNight | undefined;
  const flags = [...facts.flags].filter(f => /^project_|_open$|^school_/.test(f)).slice(0, 1000);
  return {
    arrivals: {
      day: dawnDay, households: report?.day === dawnDay ? report.arrivals.households : 0,
      youth_share: report?.day === dawnDay ? report.arrivals.youthShare : 0.5,
      free_homes: facts.freeHomes.map(h => ({ home: h.home, beds: h.beds, name: homeName(h.home) })),
      pillars: { prosperity: round(town.pillars.prosperity), safety: round(town.pillars.safety), spirit: round(town.pillars.spirit), charm: round(town.pillars.charm) },
      census: Math.round(town.census), flags, pupils: facts.pupils ?? DAY1_PUPILS, unrestored_homes: town.homes.vacant_restorable
    },
    ...(() => {
      const adopt = [...people.households, ...people.pending].filter(h => people.unsynced.includes(h.id) && h.day < dawnDay);
      return adopt.length ? { adopt } : {};
    })(),
    ...(night?.day === dawnDay && night.departed.length ? { departed: night.departed } : {}),
    ...(night?.day === dawnDay && night.notices.length ? { notices: night.notices } : {})
  };
}

/** The dawn package's households in place of the local templates, and which of ours the server already has. */
export function adoptDawnArrivals(registry: Registry, pkg: Pick<DawnPackage, 'day' | 'arrivals' | 'generated'>): void {
  let town = getTown(registry);
  if (!town) return;
  if (pkg.arrivals?.length) town = adoptServerArrivals(town, pkg.day, pkg.arrivals);
  if (pkg.generated) town = markSynced(town, new Set(pkg.generated));
  if (town !== getTown(registry)) registry.set(TOWN_KEY, town);
}

/** The Dawn Report's comings and goings for `day`. */
export function paperMovements(registry: Pick<Registry, 'get'>, day: number): { lines: string[]; residents: string[] } {
  const town = getTown(registry);
  return town ? movementLines(town, day, homeName) : { lines: [], residents: [] };
}

const installed = new WeakSet<ResidentSim>();

/**
 * Teach the shared simulation about the generated residents: who they are (the roster), when they're about (on the
 * boat until 08:00, gone when it sails), and their landing and leaving days (plan adjuster slot `migration`).
 */
export function installMigration(registry: Registry, sim: ResidentSim): void {
  if (installed.has(sim)) return;
  installed.add(sim);
  const sync = () => {
    // A New Game or a load builds a new simulation: this one stops listening.
    if (registry.get('monde.residents') !== sim) { off(); return; }
    sim.setGenerated(generatedCards());
  };
  const off = onRosterChange(sync);
  sim.setGenerated(generatedCards());
  sim.setPresence((id, day, minute) => {
    const town = getTown(registry);
    return !town?.people || presentAt(town, id, day, minute);
  });
  sim.setAdjuster({
    key: day => {
      const town = getTown(registry);
      if (!town?.people) return '';
      const landing = [...town.people.households, ...town.people.pending].filter(h => h.day === day).map(h => h.id).join(',');
      return `${landing}|${[...sailingToday(town, day)].join(',')}`;
    },
    apply: (plans, day) => {
      const town = getTown(registry);
      if (!town?.people) return plans;
      const homes = new Map<string, string>();
      for (const h of [...town.people.households, ...town.people.pending]) if (h.day === day) for (const r of h.residents) homes.set(r.card.id, h.home);
      const sailing = sailingToday(town, day);
      return plans.map(p => (homes.has(p.resident) ? landingDayPlan(p, homes.get(p.resident)!) : sailing.has(p.resident) ? leavingDayPlan(p) : p));
    }
  }, 'migration');
}
