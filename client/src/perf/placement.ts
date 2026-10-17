import { fits, cumulative, pointAlong, type Vec } from '../world/nav';
import { RESIDENT_SPEED } from '../sim/routineExecutor';

/** Short out-and-back paths in visible, walkable cells. No randomness or saved-world mutations. */
export function crowdRoutes(walk: readonly (readonly boolean[])[], count: number, visible: (p: Vec) => boolean): Vec[][] {
  if (!Number.isInteger(count) || count < 0 || count > 500) throw new RangeError('Crowd must be an integer from 0 to 500');
  const routes: Vec[][] = [];
  for (let y = 0; y < walk.length; y++) for (let x = 0; x < (walk[y]?.length ?? 0); x++) {
    const a = { x: x + 0.25, y: y + 0.5 }, b = { x: x + 0.75, y: y + 0.5 };
    if (fits(walk, a.x, a.y, 0.2) && fits(walk, b.x, b.y, 0.2) && visible(a) && visible(b)) routes.push([a, b, a]);
  }
  if (count && !routes.length) throw new Error('No visible walkable crowd positions; move the camera to open ground');
  // Spread across the available ground before reusing cells in a small room.
  return Array.from({ length: count }, (_, i) => routes[Math.floor(i * routes.length / count) % routes.length]!);
}

export function sampleCrowdRoute(route: readonly Vec[], elapsedMs: number, index: number) {
  const lengths = cumulative(route), total = lengths[lengths.length - 1]!;
  return pointAlong(route, lengths, ((elapsedMs / 1000 * RESIDENT_SPEED + index * 0.173) % total + total) % total);
}
