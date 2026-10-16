// Gathering spots in zone format v2 (`social:`, GDD §16.4.1): parsed, validated, and on every shipped board where the
// template days send residents to talk (shared/src/gathering.ts).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATHERING_PLACES } from '@monde/shared';
import { compileZone } from '../zoneFormat';

// 12 × 8: a lane along row 4 with a bench on it, a shop north of the lane.
const base = `format: 2
id: test
name: Test
size: [12, 8]
terrain: |
  ,,,,,,,,,,,,
  ,,,,,,,,,,,,
  ,,,,,,,,,,,,
  ,,,,,,,,,,,,
  ............
  ,,,,,,,,,,,,
  ,,,,,,,,,,,,
  ,,,,,,,,,,,,
buildings:
  - { id: shop, sprite: townhouse_a, at: [1, 1], door: [2, 4] }
props:
  - { sprite: bench, at: [7, 3] }
places:
  - { id: lane, rect: [0, 4, 12, 1], door: [5, 4] }
social:
  - { id: bench, place: lane, at: [7, 3] }
spawn: [0, 4]
`;
const swap = (before: string, after: string) => base.replace(before, after);

describe('social spots', () => {
  it('compiles a spot: its open place, and the free cells round it to stand on (not the bench, not a door)', () => {
    const z = compileZone(base);
    expect(z.social).toEqual([{ id: 'test.bench', place: 'test.lane', at: [7, 3], stand: [[6, 2], [7, 2], [8, 2], [6, 3], [8, 3], [6, 4], [7, 4], [8, 4]] }]);
    const wide = compileZone(swap('at: [7, 3] }\nspawn', 'at: [7, 3], radius: 2 }\nspawn'));
    expect(wide.social[0]!.stand.length).toBeGreaterThan(8);
    expect(wide.social[0]!.stand.some(([x, y]) => x === 5 && y === 4)).toBe(false); // the lane's door
  });

  it('rejects a spot on a building, an unknown place, one far from its place, a bad radius, a duplicate or no room', () => {
    expect(() => compileZone(swap('place: lane', 'place: shop'))).toThrow(/shop is a building/);
    expect(() => compileZone(swap('place: lane', 'place: square'))).toThrow(/unknown place square/);
    expect(() => compileZone(swap('places:\n  - { id: lane, rect: [0, 4, 12, 1], door: [5, 4] }', 'places:\n  - { id: lane, rect: [0, 4, 12, 1], door: [5, 4] }\n  - { id: corner, rect: [11, 7, 1, 1], door: [11, 7] }')
      .replace('place: lane, at: [7, 3]', 'place: corner, at: [1, 0]'))).toThrow(/more than 4 tiles from corner/);
    expect(() => compileZone(swap('at: [7, 3] }\nspawn', 'at: [7, 3], radius: 5 }\nspawn'))).toThrow(/radius is 1 to 3/);
    expect(() => compileZone(swap('  - { id: bench, place: lane, at: [7, 3] }', '  - { id: bench, place: lane, at: [7, 3] }\n  - { id: bench, place: lane, at: [9, 4] }'))).toThrow(/named twice/);
    expect(() => compileZone(swap('id: bench, place', 'id: Bench, place'))).toThrow(/lower_snake_case/);
    // Inside the shop's walls: nowhere to stand.
    expect(() => compileZone(swap('place: lane, at: [7, 3]', 'place: lane, at: [1, 2], radius: 1'))).toThrow(/at least two cells/);
  });

  it('is empty on a board without any', () => {
    expect(compileZone(swap(`social:\n  - { id: bench, place: lane, at: [7, 3] }\n`, '')).social).toEqual([]);
  });
});

describe('the shipped boards', () => {
  const dir = resolve(import.meta.dirname, '../../../../content/zones');
  const zones = readdirSync(dir).filter(f => f.endsWith('.zone.yaml')).map(f => compileZone(readFileSync(resolve(dir, f), 'utf8')));

  it('have a gathering spot at every gathering place the template days use, and none anywhere else', () => {
    const withSpots = new Set(zones.flatMap(z => z.social.map(s => s.place)));
    for (const [zone, places] of Object.entries(GATHERING_PLACES)) {
      expect(zones.some(z => z.id === zone), zone).toBe(true);
      for (const p of places) expect(withSpots.has(p), p).toBe(true);
    }
    expect([...withSpots].sort()).toEqual(Object.values(GATHERING_PLACES).flat().sort());
  });

  it('mark the market pump and terrace, the pub front, the fountain benches, the quay, the slip and the Commons', () => {
    const ids = zones.flatMap(z => z.social.map(s => s.id));
    for (const id of ['market_row.pump', 'market_row.cafe_terrace', 'market_row.pub_front', 'old_quarter.fountain_benches_west',
      'wharf.quay', 'wharf.slip_bollards', 'commons.picnic_tables', 'commons.sundial_benches', 'commons.garden_well']) expect(ids).toContain(id);
    // Room for a group at each: a pair at the least.
    for (const z of zones) for (const s of z.social) expect(s.stand.length, s.id).toBeGreaterThanOrEqual(3);
  });
});
