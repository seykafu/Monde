// Interiors (MVP W-03; GDD §16.4 "interiors of 10×8 to 20×14"): the rooms load and validate, every door leads in and
// back out to its doorstep, the routines put the right people at their posts inside, and every indoor place of the
// Spring boards is in a room or knowingly door-only.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileZone, districtOf, type ZoneDef } from '../zoneFormat';
import { boards, doorLinks, interiors, zones } from '../zones';
import { DOOR_ONLY, doorAt, doorOnly, linkInteriors, placeArrival, roomOf, standingPlace, walkingIn } from '../interiors';
import { IndoorView } from '../indoorResidents';
import { movePlayer } from '../player';
import { homeRegistry, placeRegistry } from '../places';
import { personaCards } from '../residents';
import { ZoneGraph, findPath } from '../nav';
import { ResidentSim } from '../../sim/residentSim';
import { RoutineExecutor } from '../../sim/routineExecutor';
import { placeAt } from '../../story/host';
import { ambientMusic, INDOOR_LEVEL, QUIET_LEVEL } from '../../audio/musicDirector';
import { doorLocked, indoorLight, INDOOR } from '../../scenes/zone/indoors';
import { wallMap, windowPanes } from '../../render/town/roomArt';
import { groundMap } from '../../render/town/autotile';

const roomDir = resolve(import.meta.dirname, '../../../../content/zones/interiors');
const files = readdirSync(roomDir).filter(f => f.endsWith('.zone.yaml'));

// A 9 × 7 room behind `shop` on a small street board.
const street = `format: 2
id: street
name: Street
size: [8, 7]
terrain: |
  ,,,,,,,,
  ,,,,,,,,
  ,,,,,,,,
  ,,,,,,,,
  ........
  ........
  ,,,,,,,,
buildings:
  - { id: shop, sprite: townhouse_a, at: [1, 1], door: [2, 4] }
spawn: [6, 5]
`;
const room = `format: 2
kind: interior
id: shop_interior
name: The Shop
district: street
building: shop
size: [9, 7]
terrain: |
  #########
  #########
  #FFFFFFF#
  #FFFRRFF#
  #FFFFFFF#
  #FFFFFFF#
  ####F####
door: [4, 6]
room: { wall: brick, rug: green, windows: [2, 6] }
props:
  - { sprite: store_counter, at: [4, 3] }
places:
  - { id: shop, rect: [1, 2, 7, 4], door: [4, 4] }
spots:
  - { at: [4, 2], who: [nell] }
  - { at: [2, 5] }
upstairs: [shop_flat]
`;
const swap = (text: string, a: string, b: string) => { expect(text).toContain(a); return text.replace(a, b); };

describe('the interior format (zone `kind: interior`)', () => {
  it('compiles a room: its district, building, doorway (a way out south), look, spots and the flat upstairs', () => {
    const z = compileZone(room);
    expect(z.district).toBe('street');
    expect(z.interior).toMatchObject({ district: 'street', building: 'shop', door: [4, 6], room: { wall: 'brick', rug: 'green', windows: [2, 6] },
      upstairs: ['shop_flat'], spots: [{ at: [4, 2], who: ['nell'] }, { at: [2, 5], who: [] }], quiet: false });
    expect(z.spawn).toEqual([4, 5]); // just inside the doorway
    expect(z.edges).toEqual([{ side: 'south', from: 4, to: 4, zone: 'street', arrive: [0, 0] }]);
    expect(z.walkability[0]![4]).toBe(false); // the back wall
    expect(z.walkability[6]![3]).toBe(false); // the front wall beside the doorway
    expect(z.walkability[3]![4]).toBe(false); // the counter
    expect(districtOf(z)).toBe('street');
    expect(districtOf(compileZone(street))).toBe('street');
  });

  it('refuses a room with no proper doorway, with buildings or edges, a bad look, or spots off the floor', () => {
    expect(() => compileZone(swap(room, 'door: [4, 6]', 'door: [4, 5]'))).toThrow(/front wall/);
    expect(() => compileZone(swap(room, 'door: [4, 6]', 'door: [3, 6]'))).toThrow(/doorway is on solid ground/);
    expect(() => compileZone(swap(room, 'props:', 'buildings: []\nprops:'))).toThrow(/no buildings/);
    expect(() => compileZone(swap(room, 'props:', 'edges: []\nprops:'))).toThrow(/not edges/);
    expect(() => compileZone(swap(room, 'wall: brick', 'wall: marble'))).toThrow(/room.wall/);
    expect(() => compileZone(swap(room, 'rug: green', 'rug: pink'))).toThrow(/room.rug/);
    expect(() => compileZone(swap(room, '{ at: [2, 5] }', '{ at: [4, 3] }'))).toThrow(/isn't floor/);
    expect(() => compileZone(swap(room, '{ at: [2, 5] }', '{ at: [2, 5], place: cellar }'))).toThrow(/not in the room/);
    expect(() => compileZone(swap(room, 'upstairs: [shop_flat]', 'upstairs: [shop]'))).toThrow(/upstairs/);
    expect(() => compileZone(swap(room, 'kind: interior', 'kind: cave'))).toThrow(/kind is interior/);
  });

  it('links a room to its building door, both ways, and refuses a room it cannot link', () => {
    const board = compileZone(street), shop = compileZone(room);
    const [link] = linkInteriors({ street: board }, { shop_interior: shop });
    expect(link).toEqual({ interior: 'shop_interior', district: 'street', building: 'shop', outside: [2, 4], inside: [4, 5] });
    expect(shop.edges[0]!.arrive).toEqual([2, 4]);
    expect(() => linkInteriors({}, { shop_interior: compileZone(room) })).toThrow(/no board for district/);
    expect(() => linkInteriors({ street: board }, { shop_interior: compileZone(swap(room, 'building: shop', 'building: bank')) })).toThrow(/no building bank/);
    expect(() => linkInteriors({ street: board }, { a: compileZone(room), b: compileZone(swap(room, 'id: shop_interior', 'id: shop_two')) })).toThrow(/already leads into/);
    expect(() => linkInteriors({ street: board }, { shop_interior: compileZone(swap(room, '- { id: shop, rect', '- { id: shop_floor, rect')) })).toThrow(/its building's own place/);
  });

  it('paints the back wall over the columns with floor under it, and the cut walls everywhere else', () => {
    const z = compileZone(room);
    const map = groundMap(z.width, z.height, (x, y) => z.tiles[y * z.width + x]!.kind!);
    const walls = wallMap(map);
    expect(walls.floorRow[4]).toBe(2);
    expect(walls.floorRow[0]).toBe(-1);
    expect(walls.cls[0 * z.width + 4]).toBe(1); // face
    expect(walls.cls[3 * z.width + 0]).toBe(2); // the side wall, cut
    expect(walls.cls[6 * z.width + 3]).toBe(2); // the front wall, cut
    expect(windowPanes(map, walls, z.interior!.room)).toHaveLength(8); // two windows of four panes
  });
});

describe('the shipped rooms', () => {
  const rooms = files.map(f => compileZone(readFileSync(resolve(roomDir, f), 'utf8')));

  it('are the Spring interiors (MVP W-03), each 10×8 to 20×14 (§16.4), with a lamp or a fire and a window', () => {
    expect(rooms.map(r => r.interior!.building).sort()).toEqual(['bakery', 'bertrand_house', 'boathouse', 'cafe_liss', 'general_store', 'gull_and_anchor',
      'lamplighter_cottage', 'lantern_office', 'library', 'market_hall', 'storefront_9', 'town_hall']);
    for (const r of rooms) {
      expect(r.width, r.id).toBeGreaterThanOrEqual(10);
      expect(r.width, r.id).toBeLessThanOrEqual(20);
      expect(r.height, r.id).toBeGreaterThanOrEqual(8);
      expect(r.height, r.id).toBeLessThanOrEqual(14);
      expect(r.interior!.room.windows.length, r.id).toBeGreaterThan(0);
      expect(r.town!.props.some(p => ['wall_lamp', 'oil_lamp', 'fireplace', 'stove', 'bread_oven'].includes(p.sprite)), r.id).toBe(true);
      expect(Object.keys(boards)).toContain(r.id);
    }
  });

  it('every building door leads into its room and the doorway back out to the same doorstep', () => {
    expect(doorLinks).toHaveLength(Object.keys(interiors).length);
    for (const link of doorLinks) {
      const outside = zones[link.district]!, inside = interiors[link.interior]!;
      // Outside: E on the doorstep, or walking up into the building from it.
      const step = { x: link.outside[0] + 0.5, y: link.outside[1] + 0.5 };
      expect(doorAt(doorLinks, outside, step), link.interior).toBe(link);
      let p = step;
      for (let i = 0; i < 20 && !walkingIn(doorLinks, outside, p, { x: 0, y: -1 }); i++) p = movePlayer(outside, p, { x: 0, y: -1 }, 0.05).position;
      expect(walkingIn(doorLinks, outside, p, { x: 0, y: -1 }), link.interior).toBe(link);
      expect(walkingIn(doorLinks, outside, p, { x: 1, y: 0 }), `${link.interior}: sideways isn't in`).toBeUndefined();
      // Inside: arriving just within the doorway, walking straight out lands on the same doorstep.
      expect(inside.walkability[link.inside[1]]![link.inside[0]], link.interior).toBe(true);
      let q = { x: link.inside[0] + 0.5, y: link.inside[1] + 0.5 }, edge;
      for (let i = 0; i < 40 && !edge; i++) ({ position: q, edge } = movePlayer(inside, q, { x: 0, y: 1 }, 0.05));
      expect(edge, link.interior).toMatchObject({ zone: link.district, arrive: link.outside });
    }
  });

  it('reaches every place, spot and Mark from the doorway', () => {
    for (const r of Object.values(interiors)) {
      const reach = (t: readonly [number, number]) => !!findPath(r.walkability, r.spawn, [t[0], t[1]]);
      for (const p of r.places) expect(reach(p.door), `${r.id} ${p.id}`).toBe(true);
      for (const s of r.interior!.spots) expect(reach(s.at), `${r.id} spot ${s.at.join(',')}`).toBe(true);
      for (const m of r.marks) expect(reach(m.stand), `${r.id} ${m.id}`).toBe(true);
    }
  });

  it('holds MR-4 on the oven keystone, MR-5 on No. 9’s hand press and WF-4 on the Clémence (§14.5, §14.6)', () => {
    const at = (room: string, mark: string) => interiors[room]!.town!.props.find(p => p.mark === mark);
    expect(at('bakery_interior', 'MR-4')?.at).toEqual(interiors.bakery_interior!.town!.props.find(p => p.sprite === 'bread_oven')!.at);
    expect(at('storefront_9_interior', 'MR-5')?.at).toEqual(interiors.storefront_9_interior!.town!.props.find(p => p.sprite === 'printing_press')!.at);
    expect(at('boathouse_interior', 'WF-4')?.at).toEqual(interiors.boathouse_interior!.town!.props.find(p => p.sprite === 'pilot_gig')!.at);
    for (const z of Object.values(zones)) expect(z.marks.map(m => m.id), z.id).not.toEqual(expect.arrayContaining(['MR-4']));
  });

  it('has every indoor place of the Spring boards in a room, or door-only for a stated reason (GDD-GAP)', () => {
    const executor = new RoutineExecutor({ zones, graph: new ZoneGraph(zones), registry: placeRegistry, homes: homeRegistry });
    const inRooms: string[] = [], doors: string[] = [];
    for (const zone of Object.keys(zones)) for (const local of placeRegistry[zone] ?? []) {
      const id = `${zone}.${local}`, info = executor.resolve(id);
      if (info.kind !== 'building' && info.kind !== 'interior') continue;
      const roomed = roomOf(interiors, id);
      if (roomed) inRooms.push(id); else doors.push(id);
      expect(!!roomed || !!doorOnly(id), `${id}: no room and not door-only`).toBe(true);
      expect(!(roomed && doorOnly(id)), `${id}: has a room, so it isn't door-only`).toBe(true);
    }
    // §9.5's rooms with no street door of their own are in their building's room (upstairs, or Pell's office).
    for (const id of ['old_quarter.mayor_office', 'old_quarter.margo_flat', 'old_quarter.sable_flat', 'market_row.bakery_flat', 'market_row.dunmore_flat',
      'market_row.roz_flat', 'market_row.pub_rooms', 'market_row.home_01']) expect(inRooms, id).toContain(id);
    expect(inRooms.length).toBe(20);
    // Every door-only rule names something on the boards.
    for (const rule of DOOR_ONLY) expect(doors.some(id => rule.place.test(id)), String(rule.place)).toBe(true);
  });

  it('take the player to a place: into its room at the place itself (the bed, the counter), else to its door', () => {
    expect(placeArrival(zones, interiors, 'old_quarter.lamplighter_cottage')).toEqual({ zone: 'lamplighter_cottage_interior', arrive: interiors.lamplighter_cottage_interior!.places[0]!.door });
    expect(placeArrival(zones, interiors, 'old_quarter.mayor_office')).toEqual({ zone: 'town_hall_interior', arrive: [13, 6] });
    expect(placeArrival(zones, interiors, 'market_row.bakery_flat')).toEqual({ zone: 'bakery_interior', arrive: interiors.bakery_interior!.spawn });
    expect(placeArrival(zones, interiors, 'old_quarter.fountain_square')?.zone).toBe('old_quarter');
    expect(placeArrival(zones, interiors, 'nowhere.at_all')).toBeUndefined();
  });

  it('stands the player for a flat upstairs in the room below (a Favor at a resident\'s home), else at the place itself', () => {
    expect(standingPlace(interiors, 'market_row.bakery_flat')).toBe('market_row.bakery');
    expect(standingPlace(interiors, 'old_quarter.margo_flat')).toBe('old_quarter.library');
    expect(standingPlace(interiors, 'market_row.pub_rooms')).toBe('market_row.gull_and_anchor');
    expect(standingPlace(interiors, 'old_quarter.mayor_office')).toBe('old_quarter.mayor_office');
    expect(standingPlace(interiors, 'wharf.nell_cottage')).toBe('wharf.nell_cottage');
    // Every home upstairs is stood at on its room's floor, where the place test (and so the E prompt) finds it.
    for (const c of personaCards) {
      const at = standingPlace(interiors, c.home), room = roomOf(interiors, c.home);
      if (!room) continue;
      const to = placeArrival(zones, interiors, at)!;
      expect(placeAt(room, { x: to.arrive[0] + 0.5, y: to.arrive[1] + 0.5 }), `${c.id} at ${c.home}`).toBe(at);
    }
  });

  it('is where the story finds the player: inside, the building’s place; on its doorstep outside, the street', () => {
    const bakery = interiors.bakery_interior!, row = zones.market_row!;
    const indoors = new Set(doorLinks.filter(l => l.district === 'market_row').map(l => l.building));
    expect(placeAt(bakery, { x: 6.5, y: 7.5 })).toBe('market_row.bakery');
    const door = row.places.find(p => p.id === 'bakery')!.door;
    expect(placeAt(row, { x: door[0] + 0.5, y: door[1] + 0.5 })).toBe('market_row.bakery');
    expect(placeAt(row, { x: door[0] + 0.5, y: door[1] + 0.5 }, indoors)).not.toBe('market_row.bakery');
    expect(placeAt(interiors.town_hall_interior!, { x: 13.5, y: 4.5 })).toBe('old_quarter.mayor_office');
    expect(placeAt(interiors.town_hall_interior!, { x: 3.5, y: 6.5 })).toBe('old_quarter.town_hall');
  });
});

describe('residents indoors (world/indoorResidents.ts)', () => {
  const sim = new ResidentSim(personaCards, { zones, graph: new ZoneGraph(zones), registry: placeRegistry, homes: homeRegistry });
  const view = (room: string) => new IndoorView(interiors[room]!, sim.executor, (id, day, minute) => sim.sample(id, day, minute));
  const at = (h: number, m = 0) => h * 60 + m;
  const DAY = 1; // a Tuesday

  it('stand at their posts while their routines have them at work inside (Odile, Margo, Pell, Roz)', () => {
    const cases: [string, string, number, [number, number]][] = [
      ['bakery_interior', 'odile', at(10), [4, 4]],
      ['library_interior', 'margo', at(10, 30), [3, 7]],
      ['town_hall_interior', 'pell', at(10), [13, 4]],
      ['gull_and_anchor_interior', 'rosalind', at(17, 30), [5, 3]]
    ];
    for (const [room, id, minute, post] of cases) {
      const s = view(room).stateAt(id, DAY, minute);
      expect(s, `${id} in ${room}`).not.toBeNull();
      expect(s, id).toMatchObject({ zone: room, visible: true, moving: false, position: { x: post[0] + 0.5, y: post[1] + 0.5 } });
      expect(s!.place.startsWith(`${interiors[room]!.interior!.district}.`)).toBe(true);
    }
  });

  it('walk in from the doorway when they arrive, and are nowhere in the room before or after their stay', () => {
    const v = view('town_hall_interior'), room = interiors.town_hall_interior!;
    let arrived = NaN;
    for (let m = at(7, 30); m < at(10); m += 0.25) if (v.where(sim.sample('pell', DAY, m)) === 'here') { arrived = m; break; }
    expect(Number.isFinite(arrived)).toBe(true);
    expect(v.stateAt('pell', DAY, arrived - 1)).toBeNull();
    const walking = v.stateAt('pell', DAY, arrived + 0.2)!;
    expect(walking.moving).toBe(true);
    expect(Math.hypot(walking.position!.x - room.spawn[0] - 0.5, walking.position!.y - room.spawn[1] - 0.5)).toBeLessThan(1.5);
    expect(v.stateAt('pell', DAY, arrived + 15)).toMatchObject({ moving: false, position: { x: 13.5, y: 4.5 } });
  });

  it('keep upstairs and asleep out of sight, unless the room gives them a post (Bastien by the oven)', () => {
    const bakery = view('bakery_interior');
    // Odile naps and sleeps in the flat over the shop.
    expect(bakery.where(sim.sample('odile', DAY, at(14, 30)))).toBe('upstairs');
    expect(bakery.stateAt('odile', DAY, at(14, 30))).toBeNull();
    expect(bakery.stateAt('odile', DAY, at(23))).toBeNull();
    // Bastien sleeps at the bakery at 21:00, by the oven.
    expect(bakery.stateAt('bastien', DAY, at(22))).toMatchObject({ visible: true, position: { x: 10.5, y: 4.5 } });
  });

  it('never stand two to a spot', () => {
    const v = view('gull_and_anchor_interior');
    for (const minute of [at(18, 30), at(19, 30), at(20, 30)]) {
      const states = sim.tick(DAY, minute);
      v.roster(() => states, minute, 0);
      const standing = states.map(s => v.stateAt(s.id, DAY, minute)).filter(s => s && !s.moving);
      const cells = standing.map(s => `${s!.position!.x},${s!.position!.y}`);
      expect(new Set(cells).size, cells.join(' ')).toBe(cells.length);
      expect(standing.length).toBeGreaterThan(2); // the pub of an evening
    }
  });
});

describe('locked doors', () => {
  const registry = (data: Record<string, unknown>) => ({ get: (k: string) => data[k], set: () => undefined, remove: () => undefined });
  const cottage = doorLinks.find(l => l.building === 'lamplighter_cottage')!, no9 = doorLinks.find(l => l.building === 'storefront_9')!;
  it('keeps the cottage shut until S01c’s keys, and No. 9 until MR-4 has been read (GDD-GAP: no knock yet)', () => {
    expect(doorLocked(registry({}), cottage)).toMatch(/Pell has the keys/);
    expect(doorLocked(registry({ 'monde.story.flags': { cottage_keys_given: true } }), cottage)).toBeNull();
    expect(doorLocked(registry({}), no9)).toMatch(/No. 9 is locked/);
    expect(doorLocked(registry({ 'monde.riddles': { entries: { 'MR-4': { status: 'found', foundAt: 0, hints: 0, attempts: [] } }, pinned: [], selected: null } }), no9)).toBeNull();
    for (const l of doorLinks.filter(l => l !== cottage && l !== no9)) expect(doorLocked(registry({}), l), l.building).toBeNull();
  });
});

describe('a room’s light and music', () => {
  it('is lamplit: never as dark as the street, lamps a little on by day and fully at night', () => {
    const day = indoorLight(0, { kind: 'sun', intensity: 1 }), night = indoorLight(1, { kind: 'rain', intensity: 1 });
    expect(day).toMatchObject({ dark: 0, lampLevel: INDOOR.dayLamps, shadowLevel: 0, grey: 0 });
    expect(night.dark).toBeCloseTo(INDOOR.darkness);
    expect(night).toMatchObject({ lampLevel: 1, shadowLevel: 0, grey: 1 });
  });

  it('plays home’s own track at every hour, a pub’s fiddle all evening, and the district softly elsewhere', () => {
    const cottage = interiors.lamplighter_cottage_interior!.interior!, pub = interiors.gull_and_anchor_interior!.interior!;
    const library = interiors.library_interior!.interior!, bakery = interiors.bakery_interior!.interior!;
    expect(ambientMusic({ zone: 'old_quarter', day: 3, minute: 1400, darkness: 1, room: cottage })).toEqual({ track: 'cottage', level: 1 });
    expect(ambientMusic({ zone: 'old_quarter', day: 3, minute: 380, darkness: 0, room: cottage })).toEqual({ track: 'cottage', level: 1 });
    expect(ambientMusic({ zone: 'market_row', day: 3, minute: 1300, darkness: 1, room: pub }).track).toBe('market_row');
    expect(ambientMusic({ zone: 'old_quarter', day: 3, minute: 700, darkness: 0, room: library })).toEqual({ track: 'old_quarter', level: QUIET_LEVEL });
    expect(ambientMusic({ zone: 'market_row', day: 3, minute: 700, darkness: 0, room: bakery })).toEqual({ track: 'market_row', level: INDOOR_LEVEL });
    expect(ambientMusic({ zone: 'market_row', day: 3, minute: 1300, darkness: 1, room: bakery }).track).toBe('night');
    expect(ambientMusic({ zone: 'market_row', day: 3, minute: 700, darkness: 0 })).toEqual({ track: 'market_row', level: 1 });
  });
});

/** Keep the type import used (a room is a ZoneDef). */
export type _Room = ZoneDef;
