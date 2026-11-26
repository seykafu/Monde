// Where to find a resident now, from the executor's cached timeline. Pure: no Phaser or DOM.
// At a reachable stop, give its departure time. On the way, point to the destination.
// Indoors somewhere the player can't go, find the next reachable stop. If today's plan
// has none left, return null so the caller can name the usual place for tomorrow.
import { formatClock, PASS_OUT } from '../sim/clock';
import type { Timeline } from '../sim/routineExecutor';

type Stop = Pick<Timeline['segments'][number], 't0' | 't1' | 'place' | 'block' | 'journey'>;

export type Whereabouts = {
  place: string;
  until: number;
  walking?: boolean;
} & ({ inside?: undefined } | { inside: string; from: number });

export function whereabouts(stops: readonly Stop[], minute: number, reachable: (place: string, block: number) => boolean): Whereabouts | null {
  let lo = 0, hi = stops.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (stops[mid]!.t1 <= minute) lo = mid + 1;
    else hi = mid;
  }
  const current = stops[lo];
  if (!current || minute >= PASS_OUT) return null;
  // Several segments can be the same visit (road crossings, then strolling on the square).
  const accessible = reachable(current.place, current.block);
  let end = lo + 1;
  while (end < stops.length) {
    const next = stops[end]!;
    if (next.place !== current.place) break;
    if (next.block !== stops[end - 1]!.block && (next.journey || accessible !== reachable(next.place, next.block))) break;
    end++;
  }
  const until = Math.min(PASS_OUT, Math.ceil(stops[end - 1]!.t1));
  if (accessible) return current.journey
    ? { place: current.place, until, walking: true }
    : { place: current.place, until };
  for (let i = end; i < stops.length; i++) {
    const next = stops[i]!;
    if (next.t0 >= PASS_OUT) break;
    if (!next.journey && reachable(next.place, next.block))
      return { place: next.place, inside: current.place, until, from: Math.ceil(next.t0), walking: !!current.journey };
  }
  return null;
}

export interface PersonLocation { place: string; where: string }

export function describeWhereabouts(at: Whereabouts | null, fallback: string, name: (id: string) => string): PersonLocation {
  const place = at?.place ?? fallback;
  if (!at) return { place, where: `${name(place)}, tomorrow` };
  if (at.inside) {
    const current = name(at.inside);
    const where = at.walking
      ? `Heading indoors at ${current}, then at ${name(place)} from ${formatClock(at.from)}`
      : `Indoors at ${current} until ${formatClock(at.until)}, then at ${name(place)}`;
    return { place, where };
  }
  const until = formatClock(at.until);
  return { place, where: at.walking ? `Heading to ${name(place)}, there until ${until}` : `${name(place)}, until ${until}` };
}
