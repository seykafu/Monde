import { expect, it } from 'vitest';
import { blocksFromRoutine, type DayPlan, type PlanAction } from '../plans';
import { RoutineExecutor, withSeats } from '../routineExecutor';
import { loadWorld } from './content';

const ex = new RoutineExecutor(loadWorld());
const steps = 'wharf.harbor_steps';
function visit(id: number, place = steps, action: PlanAction = 'work'): DayPlan {
  return { resident: 'crew' + id, weekday: 'Thu', routine: 'weekday', startPlace: place, startAction: 'sleep',
    blocks: blocksFromRoutine([{ at: '06:00', where: place, do: action }, { at: '18:00', where: place, do: 'eat' }]) };
}
const crew = Array.from({ length: 15 }, (_, i) => visit(i));

it('fits fifteen workers at the Harbor Steps at 06:00 and 06:37', () => {
  const plans = withSeats(crew, ex);
  const zone = ex.world.zones.wharf!;
  for (const minute of [360, 397]) {
    const tiles = ex.statesAt(plans, minute).map(s => s.tile!);
    expect(new Set(tiles.map(t => t.join(','))).size).toBe(15);
    for (const [x, y] of tiles) {
      expect(Math.max(0, 21-x, x-23) + Math.max(0, 25-y, y-27)).toBeLessThanOrEqual(3);
      expect(zone.walkability[y]![x]).toBe(true);
      expect(zone.places.some(p => p.door[0] === x && p.door[1] === y)).toBe(false);
    }
  }
});
it('keeps distinct legacy anchors at Fountain Square', () => {
  const plans = [0, 1].map(i => visit(i, 'old_quarter.fountain_square'));
  const tiles = (ps: DayPlan[]) => ex.statesAt(ps, 397).map(s => s.tile);
  const before = tiles(plans);
  expect(before[0]).not.toEqual(before[1]);
  expect(tiles(withSeats(plans, ex))).toEqual(before);
});
it('lets a stroller stop on overflow ground during a crowded shift', () => {
  const [walker] = withSeats([visit(42, steps, 'walk'), ...crew], ex);
  const own = ex.resolve(steps).spots;
  const stops = Array.from({ length: 600 }, (_, m) => ex.stateAt(walker!, 365 + m)).filter(s => !s.moving);
  expect(stops.some(s => own.some(([x,y]) => x === s.tile![0] && y === s.tile![1]))).toBe(true);
  expect(stops.some(s => own.every(([x,y]) => x !== s.tile![0] || y !== s.tile![1]))).toBe(true);
});

it('shares only the farthest ring once every usable cell has a worker', () => {
  const zone = ex.world.zones.wharf!;
  // Count the shortest four-way walk back to a standing cell, up to the three-step limit.
  const own = ex.resolve(steps).spots;
  function stepsToPlace(x: number, y: number, remaining: number): number {
    if (!zone.walkability[y]?.[x]) return Infinity;
    if (own.some(([cx, cy]) => cx === x && cy === y)) return 0;
    if (!remaining) return Infinity;
    return 1 + Math.min(stepsToPlace(x - 1, y, remaining - 1), stepsToPlace(x + 1, y, remaining - 1),
      stepsToPlace(x, y - 1, remaining - 1), stepsToPlace(x, y + 1, remaining - 1));
  }
  const cells = [];
  for (let y = 22; y <= 30; y++) for (let x = 18; x <= 26; x++) {
    const distance = stepsToPlace(x, y, 3);
    if (distance > 3 || !zone.walkability[y]![x]) continue;
    if (zone.places.some(p => p.door[0] === x && p.door[1] === y)) continue;
    if (zone.town?.buildings.some(b => b.door?.[0] === x && b.door[1] === y)) continue;
    if (zone.places.some(({ id, rect: [px, py, w, h] }) =>
      id !== 'harbor_steps' && x >= px && x < px + w && y >= py && y < py + h)) continue;
    cells.push({ key: [x, y].join(','), distance });
  }
  const plans = withSeats(Array.from({ length: cells.length * 2 }, (_, i) => visit(i)), ex);
  const counts = new Map<string, number>();
  for (const state of ex.statesAt(plans, 397)) {
    const key = state.tile!.join(',');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const farthest = Math.max(...cells.map(c => c.distance));
  const outer = [];
  for (const { key, distance } of cells) {
    expect(counts.has(key)).toBe(true);
    if (distance === farthest) outer.push(counts.get(key)!);
    else expect(counts.get(key)).toBe(1);
  }
  expect(Math.max(...outer) - Math.min(...outer)).toBeLessThanOrEqual(1);
});

it('limits overflow to three steps on foot around a wall', () => {
  const wharf = ex.world.zones.wharf!;
  const walkability = wharf.walkability.map((row, y) => row.map((_, x) =>
    !(x === 24 && y >= 24 && y <= 28)));
  const zone = { ...wharf, walkability };
  const executor = new RoutineExecutor({ ...ex.world, zones: { ...ex.world.zones, wharf: zone } });
  const { overflow } = executor.resolve(steps);
  expect(overflow).toContainEqual([24, 23]); // Three steps around the north end.
  expect(overflow).not.toContainEqual([25, 25]); // Two tiles east, six steps around the wall.
});
