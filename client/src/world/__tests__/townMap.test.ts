// The map of Monde (world/townMap.ts): the districts laid out as they connect, the places on them, where travel puts
// the player, and when it can't.
import { describe, expect, it } from 'vitest';
import { doorLinks, interiors, zones } from '../zones';
import { placeName } from '../player';
import { TOWN_TERRAINS } from '../townTerrain';
import {
  MAP_GAP, MAP_GROUND, MAP_ROOFS, destination, mapTileColor, edgeOpening, layoutTown, mapPlaces, nearestInDirection, placeOnMap, playerOnMap, travelBlocked,
  type MapZone, type TravelState, type TravelWorld
} from '../townMap';

const layout = layoutTown(zones);
const board = (id: string) => layout.boards.find(b => b.id === id)!;
const world = (locked: TravelWorld['locked'] = () => null): TravelWorld => ({ zones, interiors, links: doorLinks, locked });

describe('the layout', () => {
  it('places every district board once, none overlapping', () => {
    expect(layout.boards.map(b => b.id).sort()).toEqual(Object.keys(zones).sort());
    for (const a of layout.boards) for (const b of layout.boards) {
      if (a === b) continue;
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
    }
    for (const b of layout.boards) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(layout.width);
      expect(b.y + b.h).toBeLessThanOrEqual(layout.height);
    }
  });

  it('lays the town out as it connects: the Old Quarter west of Market Row, the Commons north, the Wharf south', () => {
    const mr = board('market_row');
    expect(board('old_quarter').x + board('old_quarter').w).toBeLessThan(mr.x);
    expect(board('commons').y + board('commons').h).toBeLessThan(mr.y);
    expect(board('wharf').y).toBeGreaterThan(mr.y + mr.h);
  });

  it('lines every edge opening up with the one it leads to, the road between them MAP_GAP long', () => {
    expect(layout.links).toHaveLength(3);
    for (const l of layout.links) {
      const dx = Math.abs(l.a[0] - l.b[0]), dy = Math.abs(l.a[1] - l.b[1]);
      expect([dx, dy].sort()).toEqual([0, MAP_GAP]);
    }
    // The Old Quarter's east opening (rows 11–13) meets Market Row's west opening (rows 11–13): the boards share a top.
    expect(board('old_quarter').y).toBe(board('market_row').y);
    const oq = zones.old_quarter!, east = oq.edges.find(e => e.zone === 'market_row')!;
    expect(edgeOpening(oq, east)).toEqual([oq.width, 12.5]);
  });

  it('puts a district nothing joins underneath the rest, so a new board always shows', () => {
    const lone: MapZone = { id: 'millbrook', name: 'Millbrook', width: 20, height: 10, edges: [], places: [], spawn: [1, 1] };
    const more = layoutTown({ ...zones, millbrook: lone });
    const mb = more.boards.find(b => b.id === 'millbrook')!;
    const rest = more.boards.filter(b => b.id !== 'millbrook');
    expect(mb.y).toBeGreaterThanOrEqual(Math.max(...rest.map(b => b.y + b.h)));
    expect(more.height).toBe(mb.y + mb.h);
  });

  it('joins a one-way edge to the middle of the far side', () => {
    const a: MapZone = { id: 'a', name: 'A', width: 10, height: 6, edges: [{ side: 'east', from: 2, to: 2, zone: 'b', arrive: [1, 2] }], places: [], spawn: [2, 2] };
    const b: MapZone = { id: 'b', name: 'B', width: 8, height: 10, edges: [], places: [], spawn: [1, 1] };
    const l = layoutTown({ a, b });
    const pa = l.boards.find(q => q.id === 'a')!, pb = l.boards.find(q => q.id === 'b')!;
    expect(pb.x).toBe(pa.x + 10 + MAP_GAP);
    expect(pa.y + 2.5).toBe(pb.y + 5.5);
    expect(l.links).toEqual([{ from: 'a', to: 'b', a: [pa.x + 10, pa.y + 2.5], b: [pb.x, pb.y + 5.5] }]);
  });
});

describe('places on the map', () => {
  const places = mapPlaces(layout, zones, doorLinks, p => placeName(p.slice(p.indexOf('.') + 1)));

  it('puts every place at its door on its board, rooms and the minor ones marked', () => {
    const bakery = places.find(p => p.id === 'market_row.bakery')!;
    const door = zones.market_row!.places.find(p => p.id === 'bakery')!.door;
    expect(bakery).toMatchObject({ zone: 'market_row', name: 'Fournier & Fille', room: true, minor: false, x: board('market_row').x + door[0] + 0.5, y: board('market_row').y + door[1] + 0.5 });
    expect(places.find(p => p.id === 'old_quarter.fountain_square')).toMatchObject({ room: false, minor: false });
    expect(places.find(p => p.id === 'wharf.vacant_house_48')).toMatchObject({ minor: true });
    expect(places.find(p => p.id === 'market_row.storefront_3')).toMatchObject({ minor: true });
    expect(places.find(p => p.id === 'market_row.storefront_9')).toMatchObject({ minor: false, room: true });
    expect(places).toHaveLength(Object.values(zones).reduce((n, z) => n + z.places.length, 0));
  });

  it('finds any place: a flat upstairs or a room’s own place is its building’s door', () => {
    const bakery = places.find(p => p.id === 'market_row.bakery')!;
    expect(placeOnMap(layout, zones, interiors, 'market_row.bakery_flat')).toEqual([bakery.x, bakery.y]);
    const hall = places.find(p => p.id === 'old_quarter.town_hall')!;
    expect(placeOnMap(layout, zones, interiors, 'old_quarter.mayor_office')).toEqual([hall.x, hall.y]);
    expect(placeOnMap(layout, zones, interiors, 'old_quarter.nowhere')).toBeNull();
    expect(placeOnMap(layout, zones, interiors, 'nowhere')).toBeNull();
  });

  it('shows the player where they stand, or at their room’s front door', () => {
    const oq = board('old_quarter');
    expect(playerOnMap(layout, doorLinks, 'old_quarter', { x: 10.5, y: 4.5 })).toEqual([oq.x + 10.5, oq.y + 4.5]);
    const link = doorLinks.find(l => l.interior === 'cafe_liss_interior')!;
    const mr = board('market_row');
    expect(playerOnMap(layout, doorLinks, 'cafe_liss_interior', { x: 3, y: 3 })).toEqual([mr.x + link.outside[0] + 0.5, mr.y + link.outside[1] + 0.5]);
    expect(playerOnMap(layout, doorLinks, 'nowhere', { x: 0, y: 0 })).toBeNull();
  });
});

describe('where travel puts the player', () => {
  it('takes a district to its spawn', () => {
    expect(destination('wharf', world())).toEqual({ zone: 'wharf', arrive: zones.wharf!.spawn, note: null });
  });

  it('takes a place with a room inside, to the place’s own spot', () => {
    const room = Object.values(interiors).find(r => r.interior?.building === 'bakery')!;
    const spot = room.places.find(p => p.id === 'bakery')!.door;
    expect(destination('market_row.bakery', world())).toEqual({ zone: room.id, arrive: spot, note: null });
    // A flat upstairs: the shop floor under it, where its chores are done (standingPlace).
    expect(destination('market_row.bakery_flat', world())).toEqual({ zone: room.id, arrive: spot, note: null });
    // A room's second place: its own spot.
    const hall = Object.values(interiors).find(r => r.interior?.building === 'town_hall')!;
    expect(destination('old_quarter.mayor_office', world())).toEqual({ zone: hall.id, arrive: hall.places.find(p => p.id === 'mayor_office')!.door, note: null });
  });

  it('leaves the player on the doorstep of a locked room, saying why', () => {
    const link = doorLinks.find(l => l.building === 'storefront_9')!;
    const d = destination('market_row.storefront_9', world(l => l.building === 'storefront_9' ? 'No. 9 is locked.' : null));
    expect(d).toEqual({ zone: 'market_row', arrive: link.outside, note: 'No. 9 is locked.' });
  });

  it('takes a place outdoors to its door, and nowhere for a place no board has', () => {
    const door = zones.old_quarter!.places.find(p => p.id === 'fountain_square')!.door;
    expect(destination('old_quarter.fountain_square', world())).toEqual({ zone: 'old_quarter', arrive: door, note: null });
    expect(destination('old_quarter.clocktower', world())?.zone).toBe('old_quarter');
    expect(destination('old_quarter.nowhere', world())).toBeNull();
    expect(destination('millbrook', world())).toBeNull();
  });

  it('arrives on ground the player can stand on, for every named place and district', () => {
    const all = [...Object.keys(zones), ...Object.values(zones).flatMap(z => z.places.map(p => `${z.id}.${p.id}`))];
    for (const target of all) {
      const d = destination(target, world())!;
      const b = zones[d.zone] ?? interiors[d.zone]!;
      expect(b.walkability[d.arrive[1]]?.[d.arrive[0]], `${target} → ${d.zone} ${d.arrive}`).toBe(true);
    }
  });
});

describe('when travel waits', () => {
  const free: TravelState = { pauses: [], scenes: [], storyActive: false, moving: false };

  it('goes when nothing holds the clock but the map or the Tasks menu', () => {
    expect(travelBlocked(free)).toBeNull();
    expect(travelBlocked({ ...free, pauses: ['map'] })).toBeNull();
    expect(travelBlocked({ ...free, pauses: ['tasks', 'map'] })).toBeNull();
  });

  it('waits for scenes, conversations, Scuffles, puzzles, work and anything else that stops time (§5.3)', () => {
    expect(travelBlocked({ ...free, storyActive: true })).toBe('Not while a scene is playing.');
    expect(travelBlocked({ ...free, scenes: ['Story'] })).toBe('Not while a scene is playing.');
    expect(travelBlocked({ ...free, pauses: ['story', 'map'] })).toBe('Not while a scene is playing.');
    expect(travelBlocked({ ...free, scenes: ['Dialogue'], pauses: ['dialogue'] })).toBe('Not in the middle of a conversation.');
    expect(travelBlocked({ ...free, pauses: ['scuffle'] })).toBe('Not during a Scuffle.');
    expect(travelBlocked({ ...free, pauses: ['puzzle'] })).toBe('Finish the puzzle first.');
    expect(travelBlocked({ ...free, scenes: ['WorkPuzzle'] })).toBe('Finish the puzzle first.');
    expect(travelBlocked({ ...free, pauses: ['project-work'] })).toBe('Not in the middle of work.');
    expect(travelBlocked({ ...free, pauses: ['map', 'pass-out'] })).toBe('Not while time is stopped.');
    expect(travelBlocked({ ...free, pauses: ['paper'] })).toBe('Not while time is stopped.');
    expect(travelBlocked({ ...free, moving: true })).toBe('You’re already on your way.');
  });
});

describe('moving the selection with the arrows', () => {
  const pts = [{ id: 'a', x: 0, y: 0 }, { id: 'e', x: 10, y: 1 }, { id: 'far', x: 30, y: 0 }, { id: 'n', x: 1, y: -8 }, { id: 'diag', x: 6, y: 9 }];

  it('picks the nearest point that way, nearer the axis first', () => {
    expect(nearestInDirection(pts, pts[0]!, 'right')?.id).toBe('e');
    expect(nearestInDirection(pts, pts[0]!, 'up')?.id).toBe('n');
    expect(nearestInDirection(pts, pts[0]!, 'down')?.id).toBe('diag');
    expect(nearestInDirection(pts, pts[1]!, 'right')?.id).toBe('far');
  });

  it('stays put at the edge of the map', () => {
    expect(nearestInDirection(pts, pts[0]!, 'left')).toBeNull();
    expect(nearestInDirection(pts, pts[2]!, 'right')).toBeNull();
  });
});

describe('the map’s colours', () => {
  it('has an ink for every ground and paints a building in a roof tone, the same one every time', () => {
    for (const k of TOWN_TERRAINS) expect(MAP_GROUND[k], k).toBeTypeOf('number');
    expect(mapTileColor({ kind: 'sea' })).toBe(MAP_GROUND.sea);
    const roof = mapTileColor({ kind: 'grass', building: 'bakery' });
    expect(MAP_ROOFS).toContain(roof);
    expect(mapTileColor({ kind: 'cobble', building: 'bakery' })).toBe(roof);
    for (const z of Object.values(zones)) for (const t of z.tiles) expect(mapTileColor(t)).toBeTypeOf('number');
  });
});
