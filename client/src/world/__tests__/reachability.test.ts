// Every shipped board is playable: each place's door can be walked to (A*, nav.ts) from the spawn, from every
// cell of every edge, and from wherever another board drops you off; residents can stand anywhere open inside
// an open place; and the boards join up, so any door in town can be reached from any spawn.
import { describe, expect, it } from 'vitest';
import { distanceField, findPath, ZoneGraph } from '../nav';
import type { Edge, Point, ZoneDef } from '../zoneFormat';
import { loadZones } from '../../sim/__tests__/content';

const zones = loadZones();
const graph = new ZoneGraph(zones);

const edgeCells = (z: ZoneDef, e: Edge): Point[] => Array.from({ length: e.to - e.from + 1 }, (_, i): Point => {
  const n = e.from + i;
  return e.side === 'north' ? [n, 0] : e.side === 'south' ? [n, z.height - 1] : e.side === 'west' ? [0, n] : [z.width - 1, n];
});

/** Where a walker can enter this board: its spawn, every cell of its edges, and the arrivals other boards send here. */
function entrances(z: ZoneDef): [string, Point][] {
  const out: [string, Point][] = [['spawn', z.spawn]];
  for (const e of z.edges) for (const c of edgeCells(z, e)) out.push([`${e.side} edge to ${e.zone}`, c]);
  for (const other of Object.values(zones)) for (const e of other.edges) if (e.zone === z.id) out.push([`arrival from ${other.id}`, e.arrive]);
  return out;
}

const isBuilding = (z: ZoneDef, id: string) => z.tiles.some(t => t.building === id);

describe('board reachability', () => {
  it('ships the MVP districts, joined to Market Row', () => {
    expect(Object.keys(zones).sort()).toEqual(['commons', 'market_row', 'old_quarter', 'wharf']);
    expect(zones.market_row!.edges.map(e => [e.side, e.zone])).toEqual([['west', 'old_quarter'], ['north', 'commons'], ['south', 'wharf']]);
  });

  for (const z of Object.values(zones)) {
    describe(z.id, () => {
      it('reaches every door from the spawn, from each edge cell and from each arrival', () => {
        for (const [from, cell] of entrances(z)) for (const p of z.places) {
          expect(findPath(z.walkability, cell, p.door), `${p.id} from ${from} [${cell.join(',')}]`).not.toBeNull();
        }
      });

      it('lets residents stand anywhere open inside an open place, and only behind a door for a building', () => {
        for (const p of z.places) {
          if (isBuilding(z, p.id)) continue;
          const [x0, y0, w, h] = p.rect;
          const field = distanceField(z.walkability, p.door);
          const open: Point[] = [];
          for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (z.walkability[y]![x]) open.push([x, y]);
          expect(open.length, `${p.id} has somewhere to stand`).toBeGreaterThan(0);
          for (const [x, y] of open) expect(field[y * z.width + x], `${p.id} cell ${x},${y}`).toBeLessThan(Infinity);
        }
      });
    });
  }

  it('routes from every board\'s spawn to every door in town', () => {
    for (const from of Object.values(zones)) for (const to of Object.values(zones)) for (const p of to.places) {
      const route = graph.route({ zone: from.id, tile: from.spawn }, { zone: to.id, tile: p.door });
      expect(route, `${from.id} spawn → ${to.id}.${p.id}`).not.toBeNull();
    }
  });
});
