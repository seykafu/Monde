// Arrivals on the board (GDD §6.4, §13.3 S05; MVP G-02): ZoneScene calls attachArrivals() in create().
//
// - The shared simulation learns the generated residents (scenes/migration.ts installMigration): newcomers appear on
//   the ferry slip at 08:00 and walk to their new homes; leavers walk down at 09:30 and are gone when the boat sails.
// - On the Wharf, the Gannet keeps the ferry's timetable on sailing days: out before dawn, round the breakwater into
//   the slip from 07:30 to 08:00, berthed while passengers come and go, out at 10:00 with anyone leaving, home again
//   from 16:00. Other days she lies at the slip (the board's own prop).
// - The board relights when a household lands or leaves (the door flags, town/occupancy.ts).
// - Dev (dev builds or ?dev): `window.__arrivals` forces a household onto today's boat, gives a Leaving Notice, and
//   reports the town's generated residents.
import Phaser from 'phaser';
import { livingArrivals } from '@monde/shared';
import { actorDepth } from '../../render/depth';
import { DIORAMA_TILE_H, DIORAMA_TILE_W } from '../../render/dioramaConfig';
import type { TownBoard } from '../../render/town/TownBoard';
import type { Clock } from '../../sim/clock';
import { isFerryDay } from '../../town/migration';
import { peopleOf, templateArrivals } from '../../town/people';
import { restoreHome } from '../../town/occupancy';
import type { TownState } from '../../town/pillars';
import type { ZoneDef } from '../../world/zoneFormat';
import { ARRIVALS_LANDED, installMigration, landBoat, migrationWorld } from '../migration';
import type { ResidentLayer } from './residents';

const TOWN_KEY = 'monde.town';

/**
 * The Gannet's sailing-day timetable (minutes). GDD-GAP: §5.3 and §13.2 give the sailing days (Tue/Fri) but no times;
 * S05 has her round the breakwater at about 07:45 and §6.4 lands passengers at 08:00 and sends leavers at 10:00.
 */
export const GANNET = { inStart: 7 * 60 + 30, inEnd: 8 * 60, outStart: 10 * 60, outEnd: 10 * 60 + 30, backStart: 16 * 60, backEnd: 16 * 60 + 30 } as const;
/** Where she sails from: past the breakwater's end, in tiles from her berth (east and out to sea). */
const OFFSHORE = { x: 16, y: 10 } as const;

/** 0 at her berth, 1 out at sea, on a sailing day at `minute` (exact). */
export function gannetOut(minute: number, sailing: boolean): number {
  if (!sailing) return 0;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const g = GANNET;
  if (minute < g.inStart) return 1;
  if (minute < g.inEnd) return 1 - ease((minute - g.inStart) / (g.inEnd - g.inStart));
  if (minute < g.outStart) return 0;
  if (minute < g.outEnd) return ease((minute - g.outStart) / (g.outEnd - g.outStart));
  if (minute < g.backStart) return 1;
  if (minute < g.backEnd) return 1 - ease((minute - g.backStart) / (g.backEnd - g.backStart));
  return 0;
}

export interface ArrivalsAttachOptions {
  zone: ZoneDef;
  clock: Clock;
  residents: ResidentLayer;
  board?: TownBoard;
  /** Rebuild the board's art and lights from the town (ZoneScene's townLook). */
  refreshBoard(): void;
  toast?(text: string): void;
}

const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const DEV = import.meta.env.DEV || query.has('dev');

export function attachArrivals(scene: Phaser.Scene, opts: ArrivalsAttachOptions): void {
  const registry = scene.registry;
  installMigration(registry, opts.residents.sim);
  opts.residents.syncActors();

  // The board relights when doors change hands.
  const doors = (town: TownState | undefined) => Object.keys(town?.flags ?? {}).filter(f => f.startsWith('home_') || /^project_vacant_house_/.test(f)).sort().join(',');
  let doorKey = doors(registry.get(TOWN_KEY) as TownState | undefined);
  const onTown = (_parent: unknown, key: string) => {
    if (key !== TOWN_KEY) return;
    const next = doors(registry.get(TOWN_KEY) as TownState | undefined);
    if (next !== doorKey) { doorKey = next; opts.refreshBoard(); }
  };
  registry.events.on('changedata', onTown).on('setdata', onTown);
  const onLanded = (households: { residents: unknown[] }[]) => {
    opts.residents.syncActors();
    if (opts.zone.id === 'wharf') {
      const n = households.reduce((s, h) => s + h.residents.length, 0);
      opts.toast?.(`The Gannet is in. ${n === 1 ? 'One passenger' : `${n} passengers`} on the slip.`);
    }
  };
  registry.events.on(ARRIVALS_LANDED, onLanded);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    registry.events.off('changedata', onTown).off('setdata', onTown).off(ARRIVALS_LANDED, onLanded);
  });

  // The Gannet's timetable on the Wharf.
  const gannet = opts.zone.id === 'wharf' ? opts.board?.billboards.find(b => b.sprite === 'gannet') : undefined;
  if (gannet) {
    const home = { x: gannet.img.x, y: gannet.img.y, bounds: { ...gannet.bounds }, extras: gannet.extras.map(e => ({ img: e, x: e.x, y: e.y })), depth: gannet.img.depth };
    let bob = 0;
    const place = (dtMs: number) => {
      const town = registry.get(TOWN_KEY) as TownState | undefined;
      const out = gannetOut(opts.clock.exactMinute, isFerryDay(opts.clock.day, town?.flags));
      bob += dtMs / 1000;
      const dx = out * OFFSHORE.x * DIORAMA_TILE_W, dy = out * OFFSHORE.y * DIORAMA_TILE_H + (out > 0 && out < 1 ? Math.sin(bob * 3) * 1.2 : 0);
      gannet.hidden = out >= 1;
      gannet.img.setPosition(home.x + dx, home.y + dy);
      if (dy) gannet.img.setDepth(Math.max(home.depth, actorDepth(gannet.baseY + dy)));
      for (const e of home.extras) e.img.setPosition(e.x + dx, e.y + dy);
      gannet.bounds.x0 = home.bounds.x0 + dx; gannet.bounds.x1 = home.bounds.x1 + dx;
      gannet.bounds.y0 = home.bounds.y0 + dy; gannet.bounds.y1 = home.bounds.y1 + dy;
    };
    place(0);
    scene.events.on(Phaser.Scenes.Events.UPDATE, (_t: number, dt: number) => place(dt));
  }

  if (DEV) installDevTools(scene, opts);
}

/** `window.__arrivals` (dev builds or ?dev). */
function installDevTools(scene: Phaser.Scene, opts: ArrivalsAttachOptions): void {
  const registry = scene.registry;
  const town = () => registry.get(TOWN_KEY) as TownState;
  const tools = {
    /** Put `count` households (optionally of one archetype) on today's boat; they land at 08:00 (at once if it's later). */
    force(count = 1, archetype?: string) {
      const t = town();
      const households = templateArrivals(t, migrationWorld(registry), opts.clock.day, count, 0.5, { ...(archetype ? { archetype } : {}), slotBase: 50 + peopleOf(t).pending.length + peopleOf(t).households.length });
      const people = peopleOf(t);
      registry.set(TOWN_KEY, { ...t, people: { ...people, pending: [...people.pending, ...households], unsynced: [...people.unsynced, ...households.map(h => h.id)] } });
      const landed = landBoat(registry, opts.clock.day, opts.clock.minute);
      console.info(`[arrivals] forced ${households.map(h => `${h.residents.map(r => r.card.name).join(' & ')} (${h.archetype}) → ${h.home}`).join('; ') || 'nobody (no free home?)'}${landed.length ? ' · landed now' : ' · landing at 08:00'}`);
      return households;
    },
    /** Restore vacant houses (the `homes` Project's effect, §6.3), so a boat has somewhere to bring people. */
    restore(...keys: string[]) {
      let t = town();
      for (const key of keys.length ? keys : ['old_quarter.vacant_house_47', 'old_quarter.vacant_house_46']) t = restoreHome(t, key);
      registry.set(TOWN_KEY, t);
      return t.homes;
    },
    /** Set every Pillar (and the last week's history) to `value`, so Appeal reads high enough for arrivals. */
    boost(value = 45) {
      const t = town();
      const pillars = { prosperity: value, safety: value, spirit: value, charm: value };
      registry.set(TOWN_KEY, { ...t, pillars, dayStart: pillars });
      return pillars;
    },
    /** Give a generated resident a Leaving Notice dated `daysAgo` days back (5 nights under 25, as if it had happened). */
    notice(id: string, daysAgo = 2) {
      const t = town();
      registry.set(TOWN_KEY, { ...t, migration: { ...t.migration, notices: { ...t.migration.notices, [id]: Math.max(1, opts.clock.day - daysAgo) } } });
    },
    /** The town's generated residents, pending households, leavers and the departed. */
    state() {
      const p = peopleOf(town());
      return {
        living: livingArrivals(p).map(r => `${r.card.id} (${r.card.name}, ${r.card.age}, ${r.archetype}, ${r.card.portrait}) @ ${r.card.home}`),
        pending: p.pending.map(h => `${h.id} → ${h.home} on Day ${h.day}`),
        leaving: p.leaving, departed: p.departed.map(d => `${d.name} (Day ${d.day})`), notices: town().migration.notices, unsynced: p.unsynced
      };
    }
  };
  Object.assign(window as unknown as Record<string, unknown>, { __arrivals: tools });
}
