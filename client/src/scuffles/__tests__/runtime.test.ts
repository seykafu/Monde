import { zones } from '../../world/zones';
import { personaCards } from '../../world/residents';
import { describe, expect, it } from 'vitest';
import { emptyEventLog, emptyFriendship, emptyScuffles, emptyTollmen, migrateSave, SavedScuffles, startingSkills } from '@monde/shared';
import { prepare, settle, scufflesOf, pressure, syncTollmen } from '../runtime';
import { createTownState, type TownState } from '../../town/pillars';
import { collect } from '../../save/collect';
import { restore } from '../../save/restore';
import { Clock } from '../../sim/clock';
import { dailyWeather } from '../../sim/weather';
import { defaultFellow, setFellow } from '../../fellow/state';
import { emptyInventory } from '../../economy/inventory';

function registry() {
  const data = new Map<string, unknown>();
  const r = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => data.set(k, v), remove: (k: string) => data.delete(k) };
  r.set('monde.town', createTownState({ day: 15 })); r.set('monde.coins', { balance: 100 }); r.set('monde.inventory', emptyInventory());
  setFellow(r, defaultFellow()); return r;
}
describe('deputies (GDD-GAP: Safety-first friends enlist on their own)', () => {
  it('never enlists a Tollman, Bru and Nettie or the census\'s Dex, Dom and Weasel (MVP M-03), however well they like the Fellow', () => {
    const r = registry();
    const friendly = Object.fromEntries(personaCards.map(c => [c.id, 80]));
    // Even a Tollman who weighs Safety above all (the template cards' values can).
    const tollmen = personaCards.filter(c => /tollm[ae]n/i.test(c.occupation));
    expect(tollmen.map(c => c.id)).toEqual(expect.arrayContaining(['bru', 'nettie', 'rook']));
    r.set('monde.friendship', { ...emptyFriendship(), regard: friendly });
    syncTollmen(r, 15, 700);
    const deputies = (r.get('monde.town') as TownState).tollmen!.deputies;
    expect(deputies.length).toBeGreaterThan(0);
    for (const t of tollmen) expect(deputies, t.id).not.toContain(t.id);
  });
});

describe('Scuffle transaction and saves', () => {
  it('queues one importance-7 event and applies rewards and pressure only once', () => {
    const r = registry(), encounter = prepare(r, 'sc_market_saturday', { day: 15, minute: 700 }, { key: 'test:market' });
    const before = (r.get('monde.town') as TownState).pillars.safety;
    settle(r, encounter, 'win', ['augusta']); settle(r, encounter, 'win', ['augusta']);
    expect((r.get('monde.town') as TownState).pillars.safety).toBe(before + 1);
    expect(pressure(r, 'market_row', { day: 15, minute: 700 })).toBe(1);
    const events = r.get('monde.events') as ReturnType<typeof emptyEventLog>;
    expect(events.outbox.filter(e => e.kind === 'town_event')).toEqual([expect.objectContaining({ kind: 'town_event', type: 'scuffle', importance: 7, place: 'market_row.market_street', participants: expect.arrayContaining(['player', 'augusta']) })]);
    expect(events.rejected).toEqual([]);
    expect((r.get('monde.friendship') as ReturnType<typeof emptyFriendship>).news_log).toHaveLength(1);
    expect(scufflesOf(r).results['test:market']?.outcome).toBe('win');
  });
  it('fights the bakery tutorial in Fournier & Fille’s room (§7.9 “Bakery interior”, W-03), and records it on Market Row', () => {
    const e = prepare(registry(), 'sc_bakery_tutorial', { day: 5, minute: 640 }, { key: 's03:room', story: true });
    expect(e.battle.arena.id).toMatch(/^bakery_interior:scuffle:/);
    expect(e.battle.arena.interior?.room.wall).toBe('plaster');
    expect(e).toMatchObject({ zone: 'market_row', place: 'market_row.bakery' });
    // A street encounter stays on the street.
    expect(prepare(registry(), 'sc_market_saturday', { day: 15, minute: 700 }, { key: 'street' }).battle.arena.id).toMatch(/^market_row:scuffle:/);
  });
  it('does not double S03’s authored Safety reward; used buns leave the Bag, dropped snacks return', () => {
    const r = registry(), bag = emptyInventory(); bag.slots[0] = { item: 'bun', count: 3 }; r.set('monde.inventory', bag);
    const e = prepare(r, 'sc_bakery_tutorial', { day: 3, minute: 600 }, { key: 's03:71', story: true });
    e.battle.spent.push('bun'); e.battle.dropped.push('bun'); settle(r, e, 'win');
    expect((r.get('monde.town') as TownState).pillars.safety).toBe(30);
    expect((r.get('monde.inventory') as typeof bag).slots[0]?.count).toBe(2);
    expect(scufflesOf(r).nettieWins).toBe(1);
  });
  it('uses registered places in every night-patrol zone and never submits enemies without resident cards', () => {
    for (const zone of Object.values(zones)) {
      const r = registry(), encounter = prepare(r, 'sc_market_saturday', { day: 20, minute: 1300 }, { key: zone.id, zone: zone.id });
      expect(zone.places.some(p => `${zone.id}.${p.id}` === encounter.place)).toBe(true);
      settle(r, encounter, 'win', ['missing']);
      const event = (r.get('monde.events') as ReturnType<typeof emptyEventLog>).outbox.find(e => e.kind === 'town_event');
      expect(event?.kind === 'town_event' && event.participants.every(id => id === 'player' || personaCards.some(c => c.id === id))).toBe(true);
    }
  });
  it('unlocks the slingshot after the tutorial and a second Nettie encounter at Saturday market', () => {
    const r = registry();
    const tutorial = prepare(r, 'sc_bakery_tutorial', { day: 3, minute: 600 }, { key: 'tutorial' }); settle(r, tutorial, 'win');
    const market = prepare(r, 'sc_market_saturday', { day: 19, minute: 600 }, { key: 'saturday' });
    expect(market.battle.units.some(u => u.id === 'nettie')).toBe(true); expect(market.battle.tools).not.toContain('slingshot'); settle(r, market, 'win');
    expect(prepare(r, 'sc_bins_raccoons', { day: 20, minute: 600 }, { key: 'bins' }).battle.tools).toContain('slingshot');
  });
  it('paying the market toll changes coins and Nell’s Regard without claiming a Scuffle happened', () => {
    const r = registry(), e = prepare(r, 'sc_market_saturday', { day: 15, minute: 600 }, { key: 'paid' });
    settle(r, e, 'paid'); expect(r.get('monde.coins')).toEqual({ balance: 80 });
    expect(pressure(r, 'market_row', { day: 15, minute: 600 })).toBe(2);
    const log = r.get('monde.events') as ReturnType<typeof emptyEventLog>;
    expect(log.outbox).toEqual([expect.objectContaining({ kind: 'scripted_regard', resident: 'nell', delta: -2 })]);
  });
  it('a loss queues durable recovery and costs two hours; fleeing never queues recovery', () => {
    const r = registry(), e = prepare(r, 'sc_bakery_tutorial', { day: 15, minute: 600 }, { key: 'lost' });
    expect(settle(r, e, 'loss').minutes).toBe(120); expect(scufflesOf(r).recovery).toBe(true);
    expect(r.get('monde.coins')).toEqual({ balance: 90 });
    const other = registry(); expect(settle(other, prepare(other, 'sc_bakery_tutorial', { day: 15, minute: 600 }, { key: 'run' }), 'flee').minutes).toBe(0);
    expect(scufflesOf(other).recovery).toBe(false);
  });
  it('round-trips pressure, expiry and encounter results without a save version bump; old files default', () => {
    const clock = new Clock({ day: 15, minute: 700 }), town = { ...createTownState({ day: 15 }), tollmen: { ...emptyTollmen(), modifiers: [{ key: 'test', zone: 'market_row', delta: -1, until: 18 }] } };
    const scuffles = SavedScuffles.parse({ results: { test: { id: 'sc_market_saturday', outcome: 'talk_down', day: 15, zone: 'market_row' } }, nettieWins: 2 });
    const saved = collect({ clock, town, scuffles, player: { zone: 'market_row', x: 18, y: 12, facing: 0 }, weather: { seed: 1, daily: dailyWeather(1, 15), override: null },
      story_flags: {}, quiet: { day: 15, residents: {}, player: [], today: {} }, client_events: emptyEventLog(), player_name: 'Fellow', playtime: 1, fellow: { profile: null, look: null }, skills: startingSkills('scrapper') }, 'manual', 'Scuffle');
    const loaded = restore(JSON.parse(JSON.stringify(saved)));
    expect(saved.schema_version).toBe(3); expect(loaded.scuffles).toEqual(scuffles); expect(loaded.town.tollmen).toEqual(town.tollmen);
    const { scuffles: _section, ...old } = saved; expect(migrateSave(old).scuffles).toEqual(emptyScuffles());
  });
});
