// Zone format v2 (world/zoneFormat.ts): the town's buildings, props and scatter, and the validator that keeps
// every board playable.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileZone, zoneMarks } from '../zoneFormat';
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

describe('homes, Marks and lettering', () => {
  it('says who lives in each house: a census household, a plain vacant home or flats inside a place', () => {
    const z = compileZone(swap('buildings:\n', 'buildings:\n  - { sprite: townhouse_b, at: [5, 0], home: home_01 }\n  - { sprite: townhouse_c, at: [7, 0], home: vacant }\n')
      .replace('door: [2, 4] }', 'door: [2, 4], home: [flat_a, flat_b] }'));
    expect(z.town!.buildings.map(b => b.homes)).toEqual([[ 'home_01'], ['vacant'], ['flat_a', 'flat_b']]);
    expect(() => compileZone(swap('buildings:\n', 'buildings:\n  - { sprite: townhouse_b, at: [4, 1] }\n'))).toThrow(/Scenery house needs a home/);
    expect(() => compileZone(swap('buildings:\n', 'buildings:\n  - { sprite: townhouse_b, at: [4, 1], home: home_01 }\n  - { sprite: townhouse_c, at: [6, 1], home: home_01 }\n'))).toThrow(/Two buildings hold home home_01/);
    expect(() => compileZone(swap('buildings:\n', 'buildings:\n  - { sprite: townhouse_b, at: [4, 1], home: [vacant, home_02] }\n'))).toThrow(/vacant home has nobody else/);
    // A shed is not a house: scenery without a home is fine.
    expect(compileZone(swap('buildings:\n', 'buildings:\n  - { sprite: garden_shed, at: [5, 0] }\n')).town!.buildings[0]!.homes).toEqual([]);
  });

  it('carves datestones, letters signs and numbers doors only where the art has a place for them', () => {
    const z = compileZone(base.replace('sprite: townhouse_a, at: [1, 1]', 'sprite: pell_house, at: [1, 1]').replace('door: [2, 4] }', 'door: [1, 4], datestone: 1862 }'));
    expect(z.town!.buildings[0]).toMatchObject({ datestone: 1862 });
    expect(() => compileZone(swap('door: [2, 4] }', 'door: [2, 4], datestone: 1862 }'))).toThrow(/no lintel/);
    expect(() => compileZone(base.replace('sprite: townhouse_a, at: [1, 1]', 'sprite: pell_house, at: [1, 1]').replace('door: [2, 4] }', 'door: [1, 4], datestone: 62 }'))).toThrow(/datestone is a year/);
    const shop = compileZone(base.replace('sprite: townhouse_a, at: [1, 1]', 'sprite: storefront_b, at: [1, 1]').replace('door: [2, 4] }', 'door: [3, 4], number: 9, sign: "A. MONDE · MAPS & PRINTS" }'));
    expect(shop.town!.buildings[0]).toMatchObject({ number: 9, sign: 'A. MONDE · MAPS & PRINTS' });
    expect(() => compileZone(swap('door: [2, 4] }', 'door: [2, 4], number: 9 }'))).toThrow(/door number/);
    const sign = compileZone(swap('  - { sprite: lamp_post, at: [4, 3] }', '  - { sprite: welcome_sign, at: [4, 2], text: "WELCOME TO MONDE|FOUNDED 1838" }'));
    expect(sign.town!.props.find(p => p.sprite === 'welcome_sign')!.text).toBe('WELCOME TO MONDE|FOUNDED 1838');
    expect(() => compileZone(swap('  - { sprite: lamp_post, at: [4, 3] }', '  - { sprite: welcome_sign, at: [4, 2], text: "Welcome" }'))).toThrow(/pixel font lacks/);
    expect(() => compileZone(swap('  - { sprite: lamp_post, at: [4, 3] }', '  - { sprite: bench, at: [4, 3], text: HI }'))).toThrow(/no panel to letter/);
  });

  it('lists the Marks with ground to stand on beside each, and refuses one hidden or out of reach', () => {
    const z = compileZone(swap('props:\n', 'props:\n  - { sprite: mark_plaque, at: [2, 4], offset: [0, -16], lift: 40, mark: OQ-1 }\n  - { sprite: lamp_post, at: [7, 3] }\n  - { sprite: mark_plaque, at: [7, 3], lift: 30, mark: OQ-2 }\n'));
    expect(zoneMarks(z)).toEqual([
      { id: 'OQ-1', zone: 'test', at: [2, 4], stand: [2, 4] },
      { id: 'OQ-2', zone: 'test', at: [7, 3], stand: [7, 4] }
    ]);
    expect(z.walkability[4]![2]).toBe(true); // a plaque on a door doesn't block it
    expect(() => compileZone(swap('props:\n', 'props:\n  - { sprite: mark_plaque, at: [2, 4], mark: OQ-1 }\n  - { sprite: mark_plaque, at: [5, 4], mark: OQ-1 }\n'))).toThrow(/Mark placed twice: OQ-1/);
    expect(() => compileZone(swap('props:\n', 'props:\n  - { sprite: mark_plaque, at: [5, 4], mark: XX-9 }\n'))).toThrow(/riddle id/);
    // Behind the house: its art covers the plaque.
    expect(() => compileZone(swap('props:\n', 'props:\n  - { sprite: mark_plaque, at: [2, 0], offset: [0, 18], mark: OQ-1 }\n'))).toThrow(/hidden behind shop/);
    // In front of it, a handcart.
    expect(() => compileZone(swap('props:\n', 'props:\n  - { sprite: mark_plaque, at: [5, 4], mark: OQ-1 }\n  - { sprite: handcart, at: [5, 5] }\n'))).toThrow(/hidden behind handcart/);
    // On the river between two hedges: nothing to stand on beside it.
    expect(() => compileZone(swap('props:\n', 'props:\n  - { sprite: hedge, at: [9, 1] }\n  - { sprite: hedge, at: [11, 1] }\n  - { sprite: duck, at: [10, 1], mark: OQ-1 }\n'))).toThrow(/no ground to stand on/);
    expect(compileZone(base).marks).toEqual([]);
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
  it('puts every Spring Mark on the board its chain belongs to (§14.4–14.8), or in a room of it (W-03), once', () => {
    const spring = ['OQ', 'MR', 'WF', 'CM'].flatMap(c => [1, 2, 3, 4, 5].map(n => `${c}-${n}`)).filter(id => id !== 'CM-5');
    const home = { OQ: 'old_quarter', MR: 'market_row', WF: 'wharf', CM: 'commons' } as Record<string, string>;
    const roomDir = resolve(dir, 'interiors');
    const rooms = readdirSync(roomDir).filter(f => f.endsWith('.zone.yaml')).map(f => compileZone(readFileSync(resolve(roomDir, f), 'utf8')));
    const district = Object.fromEntries([...shipped, ...rooms].map(z => [z.id, z.district ?? z.id]));
    const placed = [...shipped, ...rooms].flatMap(z => z.marks);
    expect(placed.map(m => m.id).sort()).toEqual([...spring].sort());
    for (const m of placed) expect(district[m.zone], m.id).toBe(home[m.id.slice(0, 2)]);
    // The three inside a building (§14.5, §14.6) are in its room now, not at its door.
    const roomOfMark = Object.fromEntries(placed.map(m => [m.id, m.zone]));
    expect([roomOfMark['MR-4'], roomOfMark['MR-5'], roomOfMark['WF-4']]).toEqual(['bakery_interior', 'storefront_9_interior', 'boathouse_interior']);
    for (const m of placed) expect(Math.hypot(m.stand[0] - m.at[0], m.stand[1] - m.at[1]), m.id).toBeLessThanOrEqual(1);
  });
  it('shows what the Spring riddles name: datestones, the watch, the herring, the welcome sign, No. 9, the Gannet', () => {
    const byId = Object.fromEntries(shipped.map(z => [z.id, z]));
    // OQ-3: "art must match", and no datestone reads 1846.
    const dates = Object.fromEntries(byId.old_quarter!.town!.buildings.filter(b => b.datestone).map(b => [b.id, b.datestone]));
    expect(dates).toEqual({ founders_house: 1838, st_brigids: 1839, town_hall: 1841, clocktower: 1842, library: 1850, pell_house: 1862, okafor_house: 1871, constabulary: 1888, lantern_office: 1903 });
    const props = (z: string) => byId[z]!.town!.props.map(p => p.sprite);
    expect(props('old_quarter')).toEqual(expect.arrayContaining(['watch_sign', 'old_bell', 'fountain']));
    expect(props('market_row')).toEqual(expect.arrayContaining(['herring_vane', 'public_scale']));
    expect(props('wharf')).toEqual(expect.arrayContaining(['welcome_sign', 'gannet', 'brass_stone', 'net_rack', 'bollard']));
    expect(props('commons')).toEqual(expect.arrayContaining(['lantern_pane', 'foundation_stone', 'sundial', 'gate_pillar', 'old_elm', 'footbridge']));
    expect(byId.wharf!.town!.props.find(p => p.sprite === 'welcome_sign')!.text).toMatch(/1838/);
    expect(byId.wharf!.town!.props.find(p => p.sprite === 'gannet')!.text).toBe('GANNET');
    const no9 = byId.market_row!.town!.buildings.find(b => b.id === 'storefront_9')!;
    expect(no9).toMatchObject({ number: 9, sign: 'A. MONDE · MAPS & PRINTS' });
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
