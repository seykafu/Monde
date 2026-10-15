// Zone format v2 (world/zoneFormat.ts): the town's buildings, props and scatter, and the validator that keeps
// every board playable.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileZone } from '../zoneFormat';
import { TOWN_MANIFEST } from '../townSprites';

// 12 × 8: a lane along row 4, a pond in the corner, a river running south down column 10.
const base = `format: 2
id: test
name: Test
size: [12, 8]
terrain: |
  ,,,,,,,,,,v,
  ,,,,,,,,,,v,
  ,,,,,,,,,,v,
  ,,,,,,,,,,v,
  ..........=.
  ,,,,,,oo,,v,
  ,,,,,,oo,,v,
  ,,,,,,,,,,v,
buildings:
  - { id: shop, sprite: townhouse_a, at: [1, 1], door: [2, 4] }
props:
  - { sprite: lamp_post, at: [4, 3] }
  - { sprite: hedge, line: [[0, 7], [3, 7]] }
places:
  - { id: lane, rect: [0, 4, 12, 1], door: [5, 4] }
edges:
  - { side: east, from: 4, to: 4, zone: other, arrive: [0, 0] }
spawn: [0, 4]
`;
const zone = compileZone(base);
const swap = (before: string, after: string) => base.replace(before, after);

describe('zone format v2', () => {
  it('compiles a town board: ground kinds, flows, buildings as places, solid footprints and props', () => {
    expect(zone.format).toBe(2);
    expect(zone.tiles[4 * 12]!.kind).toBe('cobble');
    expect(zone.tiles[10]!.flow).toBe('south');
    expect(zone.places.map(p => p.id).sort()).toEqual(['lane', 'shop']);
    expect(zone.places.find(p => p.id === 'shop')).toEqual({ id: 'shop', rect: [1, 1, 2, 3], door: [2, 4] });
    // The footprint is solid and names its place (the routine executor's "building" test).
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 2; x++) {
      expect(zone.walkability[y]![x]).toBe(false);
      expect(zone.tiles[y * 12 + x]!.building).toBe('shop');
    }
    expect(zone.walkability[3]![4]).toBe(false); // the lamp post
    expect(zone.walkability[7]![0]).toBe(false); // the hedge line…
    expect(zone.walkability[7]![3]).toBe(false);
    expect(zone.walkability[7]![4]).toBe(true); // …ends where it says
    expect(zone.walkability[5]![6]).toBe(false); // water
    expect(zone.walkability[4]![10]).toBe(true); // the bridge over the river
    expect(zone.town!.props.filter(p => p.from === 'line')).toHaveLength(4);
    expect(zone.town!.buildings[0]).toMatchObject({ id: 'shop', sprite: 'townhouse_a', foot: [2, 3], state: 'auto' });
  });

  it('takes offsets, lifts, flips, states and scenery buildings', () => {
    const z = compileZone(swap('  - { sprite: lamp_post, at: [4, 3] }', `  - { sprite: bench, at: [4, 3], offset: [6, -2], lift: 3, flip: true }
  - { sprite: cat_sleeping, at: [4, 3], lift: 12 }`).replace('buildings:\n', 'buildings:\n  - { sprite: garden_shed, at: [5, 0], state: restored }\n'));
    expect(z.town!.props[0]).toMatchObject({ sprite: 'bench', dx: 6, dy: -2, lift: 3, flip: true, solid: true });
    expect(z.town!.props[1]).toMatchObject({ sprite: 'cat_sleeping', solid: false });
    expect(z.town!.buildings.find(b => b.sprite === 'garden_shed')).toMatchObject({ state: 'restored' });
    expect(z.town!.buildings.find(b => b.sprite === 'garden_shed')!.id).toBeUndefined();
    expect(z.places.map(p => p.id)).not.toContain('garden_shed');
    expect(z.walkability[1]![5]).toBe(false);
  });

  it('rejects unknown sprite ids, and sprites of the wrong kind', () => {
    expect(() => compileZone(swap('sprite: townhouse_a', 'sprite: townhouse_z'))).toThrow(/Unknown sprite: townhouse_z/);
    expect(() => compileZone(swap('sprite: lamp_post', 'sprite: lamp_pole'))).toThrow(/Unknown sprite: lamp_pole/);
    expect(() => compileZone(swap('sprite: townhouse_a', 'sprite: oak'))).toThrow(/Not a building sprite/);
    expect(() => compileZone(swap('sprite: lamp_post', 'sprite: bakery'))).toThrow(/Not a prop sprite/);
    expect(() => compileZone(base + 'scatter:\n  - { sprites: [tall_grass, tufty], on: [grass], density: 0.5, seed: 1 }\n')).toThrow(/Unknown sprite: tufty/);
  });

  it('rejects overlapping footprints', () => {
    expect(() => compileZone(swap('buildings:\n', 'buildings:\n  - { sprite: garden_shed, at: [2, 2] }\n'))).toThrow(/Overlapping footprints/);
    expect(() => compileZone(swap('at: [4, 3] }', 'at: [2, 3] }'))).toThrow(/inside a building/);
    expect(() => compileZone(swap('props:\n', 'props:\n  - { sprite: bench, at: [4, 3] }\n'))).toThrow(/Overlapping footprints/);
    expect(() => compileZone(swap('at: [1, 1]', 'at: [5, 4]').replace('door: [2, 4]', 'door: [5, 7]'))).toThrow(/Building on water/);
  });

  it('rejects doors that are not walkable or not on the front edge', () => {
    expect(() => compileZone(swap('door: [2, 4]', 'door: [3, 4]'))).toThrow(/front edge/);
    expect(() => compileZone(swap('door: [2, 4]', 'door: [2, 3]'))).toThrow(/front edge/);
    expect(() => compileZone(swap('props:\n', 'props:\n  - { sprite: barrel, at: [2, 4] }\n'))).toThrow(/Door on solid tile: shop/);
    expect(() => compileZone(swap('door: [5, 4] }', 'door: [6, 5] }').replace('rect: [0, 4, 12, 1]', 'rect: [0, 4, 12, 2]'))).toThrow(/Door on solid tile: lane/);
    expect(() => compileZone(swap('  - { id: shop, sprite: townhouse_a, at: [1, 1], door: [2, 4] }', '  - { id: shop, sprite: townhouse_a, at: [1, 1] }'))).toThrow(/needs a door/);
  });

  it('rejects places and edges the spawn cannot reach', () => {
    // A hedge right across the lane cuts the doors off from the spawn.
    expect(() => compileZone(swap('props:\n', 'props:\n  - { sprite: hedge, line: [[1, 0], [1, 7]] }\n').replace(
      'at: [1, 1], door: [2, 4]', 'at: [6, 1], door: [6, 4]').replace('  - { sprite: hedge, line: [[0, 7], [3, 7]] }\n', ''))).toThrow(/unreachable from the spawn: lane/);
    // A door boxed in by hedges, with the rest of the board open.
    expect(() => compileZone(swap('props:\n', 'props:\n  - { sprite: hedge, line: [[1, 5], [3, 5]] }\n  - { sprite: hedge, at: [1, 4] }\n  - { sprite: hedge, at: [3, 4] }\n'))).toThrow(/unreachable from the spawn: shop/);
    expect(() => compileZone(swap('props:\n', 'props:\n  - { sprite: hedge, line: [[9, 0], [9, 7]] }\n'))).toThrow(/Edge unreachable/);
  });

  it('keeps floating things on the water and the rest on land', () => {
    expect(() => compileZone(swap('sprite: lamp_post, at: [4, 3]', 'sprite: lamp_post, at: [6, 5]'))).toThrow(/Prop on water/);
    expect(() => compileZone(swap('sprite: lamp_post, at: [4, 3]', 'sprite: buoy, at: [4, 3]'))).toThrow(/Floating prop on land/);
    expect(compileZone(swap('sprite: lamp_post, at: [4, 3]', 'sprite: lilypads, at: [6, 5]')).walkability[3]![4]).toBe(true);
  });

  it('checks states, legends and grids', () => {
    expect(() => compileZone(swap('sprite: townhouse_a, at: [1, 1]', 'sprite: pell_house, at: [1, 1], state: faded'))).toThrow(/no faded art/);
    expect(() => compileZone(swap('door: [2, 4] }', 'door: [2, 4], state: ruined }'))).toThrow(/state must be/);
    expect(() => compileZone(swap('  ,,,,,,,,,,v,\n', '  ,,,,,,,,,,v?\n'))).toThrow(/Unknown terrain character: \?/);
    expect(() => compileZone(base + 'legend:\n  X: { terrain: river }\n')).toThrow(/needs a flow/);
    expect(() => compileZone(base + 'legend:\n  X: { terrain: lava }\n')).toThrow(/Unknown terrain: lava/);
    const walled = compileZone(base.replace('  ,,,,,,,,,,v,\n', '  ,,,,,,,,,,vX\n') + 'legend:\n  X: { terrain: plaza, solid: true }\n');
    expect(walled.walkability[0]![11]).toBe(false);
    expect(() => compileZone(swap('  ..........=.', '  ..........='))).toThrow(/rows/);
  });

  it('lays scatter on free ground only, the same way every time', () => {
    const rule = 'scatter:\n  - { sprites: [tall_grass, rock], on: [grass], density: 1, seed: 7, keepout: { doors: 1 } }\n';
    const a = compileZone(base + rule), b = compileZone(base + rule);
    const items = a.town!.props.filter(p => p.from === 'scatter');
    expect(items.length).toBeGreaterThan(20);
    expect(items).toEqual(b.town!.props.filter(p => p.from === 'scatter'));
    for (const item of items) {
      const [x, y] = item.at;
      expect(a.tiles[y * 12 + x]!.kind).toBe('grass');
      expect(a.tiles[y * 12 + x]!.building).toBeUndefined();
      expect(Math.max(Math.abs(x - 2), Math.abs(y - 4)) > 1 && Math.max(Math.abs(x - 5), Math.abs(y - 4)) > 1).toBe(true);
      expect(item.solid).toBe(false);
    }
    // Scatter is set dressing: the board walks the same with it.
    expect(a.walkability).toEqual(zone.walkability);
  });
});

describe('the shipped town', () => {
  const dir = resolve(import.meta.dirname, '../../../..', 'content/zones');
  const shipped = readdirSync(dir).filter(f => f.endsWith('.zone.yaml')).map(f => compileZone(readFileSync(resolve(dir, f), 'utf8')));
  it('is drawn from the sprite manifest (zone format v2)', () => {
    for (const z of shipped) {
      expect(z.format, z.id).toBe(2);
      for (const b of z.town!.buildings) expect(TOWN_MANIFEST[b.sprite]?.kind, b.sprite).toBe('building');
      for (const p of z.town!.props) expect(TOWN_MANIFEST[p.sprite]?.kind, p.sprite).toBe('prop');
      expect(z.town!.props.length, `${z.id} is dressed`).toBeGreaterThan(40);
    }
  });
  it('has a lamp to see by in every district', () => {
    for (const z of shipped) expect(z.town!.props.filter(p => p.sprite === 'lamp_post').length, z.id).toBeGreaterThanOrEqual(4);
  });
  // §16.4.1 "The Spring districts": the boards share one layout of the town, so a road leaves one board where
  // it enters the next, and the Liss keeps its columns and runs on downstream across every edge it crosses.
  it('lines the boards up: joined edges meet, and the river runs on across them', () => {
    const byId = Object.fromEntries(shipped.map(z => [z.id, z]));
    const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' } as const;
    const border = (z: (typeof shipped)[number], side: keyof typeof opposite) => {
      const n = side === 'north' || side === 'south' ? z.width : z.height;
      return Array.from({ length: n }, (_, i) => {
        const [x, y] = side === 'north' ? [i, 0] : side === 'south' ? [i, z.height - 1] : side === 'west' ? [0, i] : [z.width - 1, i];
        return z.tiles[y * z.width + x]!;
      });
    };
    let riverCrossings = 0;
    for (const z of shipped) for (const e of z.edges) {
      const t = byId[e.zone]!, back = t.edges.find(r => r.zone === z.id && r.side === opposite[e.side])!;
      expect([back.from, back.to], `${z.id} ${e.side} → ${t.id}`).toEqual([e.from, e.to]);
      const here = border(z, e.side), there = border(t, opposite[e.side]);
      const rivers = (row: typeof here) => row.flatMap((tile, i) => (tile.kind === 'river' ? [`${i}:${tile.flow}`] : []));
      expect(rivers(there), `the river across ${z.id} ${e.side} → ${t.id}`).toEqual(rivers(here));
      const leaving = here.filter(tile => tile.kind === 'river');
      if (e.side === 'south' || e.side === 'north') riverCrossings += leaving.length;
      for (const tile of leaving) expect(tile.flow, `${z.id} ${e.side}`).toBe('south'); // the Liss runs down to the bay
    }
    expect(riverCrossings, 'the Liss crosses Commons → Market Row → Wharf, both ways round').toBeGreaterThanOrEqual(12);
  });
});
