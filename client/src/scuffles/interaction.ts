import { interiors, zones } from '../world/zones';
import { placeArrival } from '../world/interiors';
import type Phaser from 'phaser';
import { weekdayOf, type Clock } from '../sim/clock';
import type { ZoneDef } from '../world/zoneFormat';
import type { TilePos } from '../combat/types';
import { isScuffleId } from '../combat/scuffle/catalog';
import { openScuffle } from './ScuffleScene';
import { pressure, scufflesOf, syncTollmen, SCUFFLES_KEY } from './runtime';
const clocks = new WeakSet<Clock>();
let devPending = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('scuffle');
/** Registered before the town dawn, so its Safety drift sees today's effective pressure. */
export function attachScuffleClock(scene: Phaser.Scene, clock: Clock): void {
  if (clocks.has(clock)) return; clocks.add(clock);
  clock.onDawn(t => syncTollmen(scene.registry, t.day, t.minute));
  clock.onMinute(t => syncTollmen(scene.registry, t.day, t.minute));
}
export function attachScuffles(scene: Phaser.Scene, clock: Clock): void {
  syncTollmen(scene.registry, clock.day, clock.minute);
  if (devPending) { const id = devPending; devPending = null; if (isScuffleId(id)) scene.time.delayedCall(0, () => { void openScuffle(scene, clock, id, { key: `dev:${id}:${clock.day}:${clock.minute}` }); }); }
}
export function scuffleInteraction(scene: Phaser.Scene, clock: Clock, zone: ZoneDef, position: TilePos): { label: string; run(): void } | null {
  // Bins, market toughs and night patrols are street encounters (indoors: the bakery's tutorial comes from its scene).
  if (clock.paused || zone.interior) return null;
  const level = pressure(scene.registry, zone.id, clock), night = clock.minute >= 1200;
  const alley = zone.places.find(p => p.id === 'back_alley');
  // GDD-GAP: absent bin props/interiors, the bins sit at the back-alley door, or OQ's cottage lane. One seeded encounter/day.
  const bin = alley?.door ?? zone.places.find(p => p.id === 'lamplighter_cottage')?.door;
  const nearBin = bin && Math.abs(position.x - bin[0]) + Math.abs(position.y - bin[1]) <= 2;
  const market = zone.id === 'market_row' && weekdayOf(clock.day) === 'Sat' && level >= 2 && zone.places.some(p => p.id === 'market_street' && Math.abs(position.x - p.door[0]) + Math.abs(position.y - p.door[1]) <= 2);
  // GDD-GAP: night Tollmen encounters use the market trio and are offered at a zone's spawn; never force a fight.
  const patrol = night && level >= 2 && Math.abs(position.x - zone.spawn[0]) + Math.abs(position.y - zone.spawn[1]) <= 2;
  const bins = ['old_quarter', 'market_row'].includes(zone.id) && nearBin && (clock.day + zone.width) % 3 === 0;
  const id = bins ? 'sc_bins_raccoons' : market || patrol ? 'sc_market_saturday' : null;
  if (!id) return null;
  const key = `world:${zone.id}:${id}:${clock.day}`;
  if (scufflesOf(scene.registry).results[key]) return null;
  return { label: bins ? 'Shoo the bin raccoons' : 'Stand up to the Tollmen', run: () => { if (!clock.paused) void openScuffle(scene, clock, id, { key, zone: zone.id, centre: { x: Math.floor(position.x), y: Math.floor(position.y) } }); } };
}

/** Resume the written scene first; then wake the Fellow once its clock hold is released. */
export function recoverScuffle(scene: Phaser.Scene, clock: Clock): boolean {
  const saved = scufflesOf(scene.registry);
  if (!saved.recovery || clock.paused) return false;
  const pending = { clinic: !!(scene.registry.get('monde.town') as { flags?: { clinic_open?: boolean } } | undefined)?.flags?.clinic_open };
  scene.registry.set(SCUFFLES_KEY, { ...saved, recovery: false });
  const places = Object.values(zones).flatMap(z => z.places.map(p => ({ z, p })));
  // GDD-GAP: the clinic interior is not on an MVP zone yet; home (inside the cottage, W-03) is the safe fallback even after clinic_open.
  const clinic = pending.clinic ? places.find(({ p }) => p.id === 'clinic') : undefined;
  const destination = clinic ? { zone: clinic.z.id, arrive: clinic.p.door } : placeArrival(zones, interiors, 'old_quarter.lamplighter_cottage');
  if (!destination) return false;
  scene.scene.restart({ zone: destination.zone, arrive: destination.arrive }); return true;
}
