import { Inventory, Wallet, emptyScuffles, emptyTollmen, gainXp, type SavedScuffles, type SavedFriendship } from '@monde/shared';
import { Scuffle, SUPPLIES, type Supply, type AllyOffer, type Outcome, type Tool } from '../combat/scuffle/engine';
import { SCUFFLES, type ScuffleId } from '../combat/scuffle/catalog';
import { cutArena } from '../combat/scuffle/arena';
import { consequences, quitProgress, recordOutcome, tollmenLevel } from '../combat/scuffle/tollmen';
import { getFellow, setFellow, type RegistryLike } from '../fellow/state';
import { removeItem } from '../economy/inventory';
import { flagsOf, projectsOf } from '../projects/runtime';
import { PROJECTS } from '../projects/catalog';
import { nightTollmenReduction } from '../projects/engine';
import { applyPillarDelta, type TownState } from '../town/pillars';
import { scriptedRegard, townEvent } from '../mind/events';
import { appendEvent } from '../scenes/events';
import { personaCards } from '../world/residents';
import { interiors, zones } from '../world/zones';
import { roomOf } from '../world/interiors';
import { districtOf, type ZoneDef } from '../world/zoneFormat';
import type { Clock } from '../sim/clock';
import type { TilePos } from '../combat/types';

export const SCUFFLES_KEY = 'monde.scuffles';
export const scufflesOf = (r: RegistryLike): SavedScuffles => (r.get(SCUFFLES_KEY) as SavedScuffles | undefined) ?? emptyScuffles();
const townOf = (r: RegistryLike) => r.get('monde.town') as TownState | undefined;
const queue = (r: RegistryLike, event: unknown) => appendEvent(r as Parameters<typeof appendEvent>[0], event);
export function syncTollmen(r: RegistryLike, day: number, minute: number): void {
  const town = townOf(r); if (!town) return;
  let tollmen = town.tollmen ?? emptyTollmen();
  const flags = flagsOf(r);
  const regard = (r.get('monde.friendship') as SavedFriendship | undefined)?.regard ?? {};
  const quitZones: Record<string, string> = { bru: 'market_row', nettie: 'market_row', dex: 'market_row', dom: 'market_row', weasel: 'market_row' };
  for (const [id, zone] of Object.entries(quitZones)) if (!tollmen.quit[id] && quitProgress(id, flags, regard[id] ?? 0) >= 1) tollmen = { ...tollmen, quit: { ...tollmen.quit, [id]: zone } };
  if (flags.has('charter_public')) tollmen = { ...tollmen, charter: true };
  if (flags.has('ledger_published') && tollmen.ledgerDay === null) tollmen = { ...tollmen, ledgerDay: day };

  // GDD-GAP: eligible adult Safety-first volunteers enlist automatically; once enlisted, their +2 Safety is not farmable.
  let nextTown = town;
  for (const card of personaCards) {
    if (tollmen.deputies.length >= 4) break;
    if (card.id === 'augusta' || card.age < 18 || (regard[card.id] ?? 0) < 40 || tollmen.deputies.includes(card.id) || card.values.safety <= Math.max(card.values.prosperity, card.values.spirit, card.values.charm)) continue;
    tollmen = { ...tollmen, deputies: [...tollmen.deputies, card.id] };
    nextTown = applyPillarDelta(nextTown, 'safety', 2, 'tollmen', `${card.id} enlisted as a deputy`);
  }
  const levels = Object.keys(zones).map(zone => tollmenLevel(tollmen, zone, day, minute >= 1200 || minute < 360, nightTollmenReduction(PROJECTS, projectsOf(r))));
  const max = Math.max(...levels);
  if (town.tollmen !== tollmen || town.tollmenLevelMax !== max) r.set('monde.town', { ...nextTown, tollmen, tollmenLevelMax: max });
}
export function pressure(r: RegistryLike, zone: string, clock: Pick<Clock, 'day' | 'minute'>): number {
  return tollmenLevel(townOf(r)?.tollmen ?? emptyTollmen(), zone, clock.day, clock.minute >= 1200 || clock.minute < 360, nightTollmenReduction(PROJECTS, projectsOf(r)));
}
export interface Encounter { battle: Scuffle; key: string; zone: string; place: string; story: boolean; day: number; minute: number }
export function prepare(r: RegistryLike, id: ScuffleId, clock: Pick<Clock, 'day' | 'minute'>, opts: {
  key: string; story?: boolean; zone?: string; centre?: TilePos; offers?: AllyOffer[]; regard?: (id: string) => number
}): Encounter {
  const def = SCUFFLES[id];
  // A Scuffle set in a place with a room (sc_bakery_tutorial: "Bakery interior", §7.9) is fought in the room (W-03).
  const room = opts.zone ? undefined : roomOf(interiors, `${def.zone}.${def.place}`);
  const zone = room ?? zones[opts.zone ?? def.zone]!;
  const anchor = opts.centre ?? { x: zone.spawn[0], y: zone.spawn[1] };
  const place = zone.places.find(p => p.id === def.place) ?? [...zone.places].sort((a, b) => Math.abs(a.door[0] - anchor.x) + Math.abs(a.door[1] - anchor.y) - Math.abs(b.door[0] - anchor.x) - Math.abs(b.door[1] - anchor.y))[0];
  const centre = opts.centre ?? { x: place?.door[0] ?? zone.spawn[0], y: place?.door[1] ?? zone.spawn[1] };
  // In a room, the middle of its floor (its walls and furniture are the arena's); outdoors, the place's doorstep.
  const arena = cutArena(zone, room ? roomCentre(room) : centre), fellow = getFellow(r), bag = Inventory.parse(r.get('monde.inventory') ?? {});
  const supplies = bag.slots.flatMap(s => s && SUPPLIES.includes(s.item as Supply) ? Array.from({ length: Math.min(5, s.count) }, () => s.item as Supply) : []).slice(0, 5);
  // GDD-GAP: Saturday crews alternate the twins with Bru/Nettie, so Nettie's second win is reachable in Spring.
  const enemies = id === 'sc_market_saturday' && clock.day % 2 === 1 ? ['bru', 'nettie', 'weasel'] : def.enemies;
  const flags = flagsOf(r), quit = Object.fromEntries(enemies.map(id => [id, quitProgress(id, flags, opts.regard?.(id) ?? 0)]));
  // GDD-GAP: a broom, pan and umbrella can be borrowed at each encounter; owned Bag tools join this rack.
  const tools: Tool[] = ['broom', 'pan', 'umbrella'];
  if (scufflesOf(r).nettieWins >= 2) tools.push('slingshot');
  const quitGang = Object.keys(townOf(r)?.tollmen?.quit ?? {});
  const battle = new Scuffle(id, arena, { enemies, grit: fellow?.skills.grit.level ?? 1, heart: fellow?.skills.heart.level ?? 1,
    scrapper: fellow?.profile?.background === 'scrapper', supplies, tools, allies: opts.offers,
    coins: Wallet.parse(r.get('monde.coins') ?? {}).balance, quit });
  for (const u of battle.units) if (quitGang.includes(u.id)) { u.departed = true; u.state.alive = false; }
  battle.initiative.reseed(battle.units);
  if (!battle.living().some(u => u.faction === 'enemy')) battle.outcome = 'talk_down';
  return { battle, key: opts.key, zone: districtOf(zone),
    place: `${districtOf(zone)}.${place?.id ?? 'fountain_square'}`, story: opts.story ?? false, day: clock.day, minute: clock.minute };
}
/** The middle of a room's floor (between its back wall and its door), where its Scuffle board is cut. */
const roomCentre = (room: ZoneDef): TilePos => {
  const band = room.walkability.findIndex(row => row.some(Boolean));
  return { x: Math.floor(room.width / 2), y: Math.floor((Math.max(0, band) + room.height - 1) / 2) };
};
/** One transaction per encounter key; story replay returns the stored result before launching. */
export function settle(r: RegistryLike, encounter: Encounter, outcome: Outcome, witnesses: readonly string[] = []): { minutes: number; clinic: boolean } {
  const saved = scufflesOf(r); if (saved.results[encounter.key]) return { minutes: 0, clinic: false };
  const { battle, zone, day, minute, key } = encounter, won = outcome === 'win' || outcome === 'talk_down';
  const result = consequences(outcome, battle.coins);
  r.set(SCUFFLES_KEY, { ...saved, recovery: outcome === 'loss' || saved.recovery, results: { ...saved.results, [key]: { id: battle.id, outcome, day, zone } }, nettieWins: saved.nettieWins + (won && battle.units.some(u => u.id === 'nettie') ? 1 : 0) });
  let town = townOf(r);
  if (town) {
    // S03's win branch already applies Safety +1. Keep its authored effect, rather than doubling it.
    if (!(encounter.story && battle.id === 'sc_bakery_tutorial' && won)) town = applyPillarDelta(town, 'safety', result.safety, 'scuffle', battle.id);
    town = { ...town, tollmen: recordOutcome(town.tollmen ?? emptyTollmen(), zone, day, outcome, key) };
    r.set('monde.town', town); syncTollmen(r, day, minute);
  }
  r.set('monde.coins', { balance: result.coins });
  let bag = Inventory.parse(r.get('monde.inventory') ?? {});
  // Dropped/stolen snacks are recovered afterwards (§7.8: nothing lost permanently); only used items leave the Bag.
  for (const item of battle.spent) { const index = bag.slots.findIndex(s => s?.item === item); if (index >= 0) bag = removeItem(bag, index) ?? bag; }
  r.set('monde.inventory', bag);
  const fellow = getFellow(r);
  if (fellow && won) setFellow(r, { ...fellow, skills: gainXp(gainXp(fellow.skills, 'grit', result.gritXp), 'wits', result.witsXp) });
  if (outcome === 'paid') {
    // §7.9: a shop's Saturday toll is 20 coins (§13.2). GDD-GAP: Nell's unspecified Regard loss is −2.
    queue(r, scriptedRegard({ id: `scuffle:${key}:toll`, day, minute }, { scene_id: battle.id, cue_key: key }, { resident: 'nell', delta: -2 }));
    return { minutes: 0, clinic: false };
  }
  // The event service rejects unknown participant ids. Dex/Dom/Weasel and nuisances have no persona yet;
  // nearby residents are still found by server witnessing, including generated arrivals.
  const known = new Set(personaCards.map(c => c.id));
  const participants = [...new Set(['player', ...battle.units.map(u => u.id).filter(id => known.has(id)), ...witnesses.filter(id => known.has(id))])];
  queue(r, townEvent({ id: `scuffle:${key}`, day, minute }, { type: 'scuffle', place: encounter.place, participants,
    summary: `${SCUFFLES[battle.id].name}: ${outcome === 'talk_down' ? 'the Fellow talked everyone round' : outcome === 'win' ? 'the Fellow stood their ground' : outcome === 'flee' ? 'the Fellow stepped away' : 'the Fellow was winded'}. Nobody hurt.` }));
  if (won) for (const id of [...new Set(witnesses)]) {
    const card = personaCards.find(c => c.id === id);
    if (!card || card.values.safety < Math.max(...Object.values(card.values))) continue;
    // GDD-GAP: a Safety-valuing witness receives +1 Regard, beyond the scene's authored deltas.
    queue(r, scriptedRegard({ id: `scuffle:${key}:regard:${id}`, day, minute }, { scene_id: battle.id, cue_key: key }, { resident: id, delta: 1 }));
  }
  return { minutes: result.minutes, clinic: !!town?.flags.clinic_open };
}
