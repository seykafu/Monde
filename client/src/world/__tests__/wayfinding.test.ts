// The objective marker's target (world/wayfinding.ts): the place itself, its door, the person, or the way out toward
// it, on whichever board the player stands.
import { describe, expect, it } from 'vitest';
import { doorLinks, interiors, zones } from '../zones';
import { placeName } from '../player';
import { edgeArrow, edgeStand, guideTarget, type GuideAim, type GuideWorld } from '../wayfinding';

const NAMES: Record<string, string> = { old_quarter: 'Old Quarter', market_row: 'Market Row', wharf: 'The Wharf', commons: 'The Commons' };
const w: GuideWorld = {
  zones, interiors, links: doorLinks, zoneName: id => NAMES[id] ?? id,
  placeName: p => placeName(p.slice(p.indexOf('.') + 1)), personName: id => id === 'odile' ? 'Odile' : id
};
const aim = (place: string | null, over: Partial<GuideAim> = {}): GuideAim => ({ place, people: [], preferPerson: false, ...over });
const nobody = () => null;
const door = (zone: string, id: string) => zones[zone]!.places.find(p => p.id === id)!.door;
const roomFor = (building: string) => Object.values(interiors).find(r => r.interior?.building === building)!;

describe('on the board that has the place', () => {
  it('points at the place’s door outdoors', () => {
    const [x, y] = door('old_quarter', 'fountain_square');
    expect(guideTarget(w, 'old_quarter', aim('old_quarter.fountain_square'), nobody)).toEqual({ kind: 'place', x: x + 0.5, y: y + 0.5, label: 'Fountain Square' });
  });

  it('points at the building’s door when the place is in the room behind it', () => {
    const link = doorLinks.find(l => l.building === 'bakery')!;
    expect(guideTarget(w, 'market_row', aim('market_row.bakery'), nobody))
      .toEqual({ kind: 'door', x: link.outside[0] + 0.5, y: link.outside[1] + 0.5, label: 'Go in: Fournier & Fille' });
  });

  it('points at the spot inside once in the room, the shop floor for a flat upstairs', () => {
    const room = roomFor('bakery'), [x, y] = room.places.find(p => p.id === 'bakery')!.door;
    expect(guideTarget(w, room.id, aim('market_row.bakery'), nobody)).toEqual({ kind: 'place', x: x + 0.5, y: y + 0.5, label: 'Fournier & Fille' });
    expect(guideTarget(w, room.id, aim('market_row.bakery_flat'), nobody)).toMatchObject({ kind: 'place', x: x + 0.5, y: y + 0.5 });
  });
});

describe('elsewhere', () => {
  it('points at the edge toward the next district on the way, as the objective line’s arrow', () => {
    // From the Wharf to the Old Quarter: north, to Market Row (the opening is columns 29–31).
    expect(guideTarget(w, 'wharf', aim('old_quarter.fountain_square'), nobody)).toEqual({ kind: 'exit', x: 30.5, y: 0.5, label: '→ Market Row' });
    // From the Old Quarter to the Commons: east, to Market Row (rows 11–13).
    expect(guideTarget(w, 'old_quarter', aim('commons.old_elm'), nobody)).toEqual({ kind: 'exit', x: zones.old_quarter!.width - 0.5, y: 12.5, label: '→ Market Row' });
    // From Market Row, straight to the district.
    expect(guideTarget(w, 'market_row', aim('wharf.ferry_slip'), nobody)).toMatchObject({ kind: 'exit', label: '→ The Wharf' });
  });

  it('points at a room’s way out, naming the place when it’s on the same street', () => {
    const room = roomFor('bakery'), exit = room.edges[0]!;
    const out = guideTarget(w, room.id, aim('market_row.cafe_liss'), nobody)!;
    expect(out).toEqual({ kind: 'exit', ...edgeStand(room, exit), label: 'Out, then Café Liss' });
    expect(exit.zone).toBe('market_row');
    expect(guideTarget(w, room.id, aim('old_quarter.library'), nobody)).toMatchObject({ kind: 'exit', label: 'Out → Old Quarter' });
  });

  it('points from one room to another through the street', () => {
    const library = roomFor('library');
    expect(guideTarget(w, library.id, aim('market_row.bakery_flat'), nobody)).toMatchObject({ kind: 'exit', label: 'Out → Market Row' });
  });
});

describe('people and nothing', () => {
  it('points at someone to see when they’re here, else at their place', () => {
    const odile = aim('market_row.bakery', { people: ['odile'], preferPerson: true });
    expect(guideTarget(w, 'market_row', odile, id => id === 'odile' ? { x: 12.2, y: 20.7 } : null)).toEqual({ kind: 'person', x: 12.2, y: 20.7, label: 'Odile' });
    expect(guideTarget(w, 'market_row', odile, nobody)).toMatchObject({ kind: 'door' });
    // A place to be, not someone to see: the place, even with them about.
    expect(guideTarget(w, 'market_row', { ...odile, preferPerson: false }, () => ({ x: 1, y: 1 }))).toMatchObject({ kind: 'door' });
  });

  it('has nothing to point at for an objective that’s anywhere, or a place no board knows', () => {
    expect(guideTarget(w, 'old_quarter', aim(null), nobody)).toBeNull();
    expect(guideTarget(w, 'old_quarter', aim('old_quarter.nowhere'), nobody)).toBeNull();
    expect(guideTarget(w, 'nowhere', aim('old_quarter.library'), nobody)).toBeNull();
  });
});

describe('the arrow at the screen’s edge', () => {
  const f = { w: 1280, h: 720, x: 40, top: 70, bottom: 60 };

  it('stays away while the marker is on screen', () => {
    expect(edgeArrow(f, 640, 360)).toBeNull();
    expect(edgeArrow(f, 40, 70)).toBeNull();
  });

  it('sits where the way from the middle crosses the margin, pointing on', () => {
    expect(edgeArrow(f, 3000, 360)).toEqual({ x: 1240, y: 360, angle: 0 });
    expect(edgeArrow(f, 640, -500)).toEqual({ x: 640, y: 70, angle: -Math.PI / 2 });
    const corner = edgeArrow(f, -2000, 2000)!;
    expect(corner.y).toBeCloseTo(660);
    expect(corner.x).toBeGreaterThan(40);
    expect(corner.angle).toBeCloseTo(Math.atan2(1640, -2640));
  });

  it('keeps out of the HUD’s corner, sliding below it or beside it', () => {
    const hud = { ...f, avoid: [{ x0: 1000, y0: 0, x1: 1280, y1: 260 }] };
    // Up and to the right, the line meets the margin inside the box: just below it instead.
    expect(edgeArrow(hud, 3000, -400)).toMatchObject({ x: 1240, y: 260 });
    // Steeply up and right, meeting the top margin just inside the box: beside it.
    const up = edgeArrow(hud, 3240, -1640)!;
    expect(up.x).toBe(1000);
    expect(up.y).toBe(70);
    // Elsewhere the box changes nothing.
    expect(edgeArrow(hud, 640, -500)).toEqual(edgeArrow(f, 640, -500));
    // A box in the bottom corner (the menu buttons): just above it, or beside it.
    const both = { ...f, avoid: [...hud.avoid, { x0: 1150, y0: 500, x1: 1280, y1: 720 }] };
    expect(edgeArrow(both, 3000, 1000)).toMatchObject({ x: 1240, y: 500 });
    expect(edgeArrow(both, 2510, 1360)).toMatchObject({ x: 1150, y: 660 });
  });
});
