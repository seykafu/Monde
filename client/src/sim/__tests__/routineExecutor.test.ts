import { describe, expect, it } from 'vitest';
import type { RoutineBlock } from '@monde/shared';
import { DAY_START, PASS_OUT, type Weekday } from '../clock';
import { blocksFromRoutine, dayPlan, syntheticPlans, type DayPlan } from '../plans';
import { LANE_LEG_MINUTES, OFFBOARD_LEG_MINUTES, RoutineExecutor, TILES_PER_GAME_MINUTE, type ResidentState } from '../routineExecutor';
import { loadCards, loadDay1Cards, loadHomes, loadWorld, sampleOf } from './content';

const world = loadWorld();
const cards = loadCards();
/** The 20 canon residents (19 people and Bastien); other cards (featured residents) join the soak too. */
const canon = cards.filter(c => c.kind === 'canon' || c.kind === 'animal');
const WEEK: readonly Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A hand-made plan: [at, verb, place] blocks after a night at `startPlace`. */
function plan(resident: string, startPlace: string, blocks: [string, RoutineBlock['do'], string][], outdoors = false): DayPlan {
  return {
    resident, weekday: 'Tue', routine: 'weekday', startPlace, startAction: 'sleep', outdoors,
    blocks: blocksFromRoutine(blocks.map(([at, d, where]) => ({ at, do: d, where })))
  };
}
const door = (zone: string, place: string) => {
  const [x, y] = world.zones[zone]!.places.find(p => p.id === place)!.door;
  return { x: x + 0.5, y: y + 0.5 };
};
const near = (a: { x: number; y: number } | null, b: { x: number; y: number }, tol: number) =>
  a !== null && Math.hypot(a.x - b.x, a.y - b.y) <= tol;
/** The fractional minutes where a predicate on the state first flips, scanning in quarter minutes. */
function flips(ex: RoutineExecutor, p: DayPlan, from: number, to: number, pred: (s: ResidentState) => boolean): number[] {
  const out: number[] = [];
  let prev = pred(ex.stateAt(p, from));
  for (let m = from + 0.25; m <= to; m += 0.25) {
    const now = pred(ex.stateAt(p, m));
    if (now !== prev) out.push(m);
    prev = now;
  }
  return out;
}

describe('routine executor', () => {
  it('is deterministic: the same minute gives the same states, whatever was sampled before', () => {
    const plans = cards.map(c => dayPlan(c, 'Wed'));
    const a = new RoutineExecutor(world), b = new RoutineExecutor(world);
    const first = a.statesAt(plans, 600.5);
    a.statesAt(plans, 1400); a.statesAt(plans, 420); a.statesAt([...plans].reverse(), 900);
    expect(a.statesAt(plans, 600.5)).toEqual(first);
    expect(b.statesAt(plans, 600.5)).toEqual(first);
    // Fresh plan objects (no cached timeline) agree too.
    expect(b.statesAt(cards.map(c => dayPlan(c, 'Wed')), 600.5)).toEqual(first);
  });

  it('leaves early enough to arrive across the zone as the block starts', () => {
    const ex = new RoutineExecutor(world);
    const p = plan('walker', 'old_quarter.lamplighter_cottage', [
      ['07:00', 'eat', 'old_quarter.lamplighter_cottage'],
      ['10:00', 'visit', 'old_quarter.founders_house'],
      ['21:00', 'sleep', 'old_quarter.lamplighter_cottage']
    ]);
    const tile = (place: string) => world.zones.old_quarter!.places.find(q => q.id === place)!.door;
    const route = world.graph.route({ zone: 'old_quarter', tile: tile('lamplighter_cottage') }, { zone: 'old_quarter', tile: tile('founders_house') })!;
    const walk = route.length / TILES_PER_GAME_MINUTE;
    // Out of the cottage door at 10:00 − walk…
    const [leave, arrive] = flips(ex, p, 420, 700, s => s.traveling !== null);
    expect(leave).toBeCloseTo(600 - walk, 0);
    expect(arrive).toBeCloseTo(600, 0);
    // …visible in the street on the way, getting closer…
    const mid = ex.stateAt(p, 600 - walk / 2);
    expect(mid).toMatchObject({ zone: 'old_quarter', visible: true, moving: true, activity: 'visit', place: 'old_quarter.founders_house' });
    expect(mid.traveling!.progress).toBeCloseTo(0.5, 2);
    // …and at the Founder's House door at 10:00, gone inside.
    const at = ex.stateAt(p, 600);
    expect(near(at.position, door('old_quarter', 'founders_house'), 0.05)).toBe(true);
    expect(at).toMatchObject({ traveling: null, visible: false, activity: 'visit', block: 1 });
  });

  it('arrives on time across zones, through the shared edge', () => {
    const ex = new RoutineExecutor(world);
    const p = plan('lunch', 'old_quarter.constabulary', [['09:00', 'work', 'old_quarter.constabulary'], ['12:30', 'eat', 'market_row.cafe_liss']]);
    const at = ex.stateAt(p, 750);
    expect(at.zone).toBe('market_row');
    expect(near(at.position, door('market_row', 'cafe_liss'), 0.05)).toBe(true);
    const zones = new Set<string | null>();
    for (let m = 700; m < 750; m += 0.5) zones.add(ex.stateAt(p, m).zone);
    expect([...zones]).toEqual(['old_quarter', 'market_row']);
  });

  it('puts residents of interiors and flats inside their building, unseen', () => {
    const ex = new RoutineExecutor(world);
    expect(ex.resolve('market_row.bakery_flat')).toMatchObject({ kind: 'interior', zone: 'market_row', local: 'bakery' });
    expect(ex.resolve('old_quarter.margo_flat')).toMatchObject({ kind: 'interior', local: 'library' });
    expect(ex.resolve('market_row.pub_rooms')).toMatchObject({ kind: 'interior', local: 'gull_and_anchor' });
    const odile = dayPlan(cards.find(c => c.id === 'odile')!, 'Tue');
    const lunch = ex.stateAt(odile, 13 * 60 + 30); // eating in the flat over the bakery
    expect(lunch).toMatchObject({ zone: 'market_row', place: 'market_row.bakery_flat', activity: 'eat', visible: false, traveling: null });
    expect(near(lunch.position, door('market_row', 'bakery'), 0.01)).toBe(true);
    // Bakery → flat upstairs is the same door: no walk at all.
    expect(flips(ex, odile, 12 * 60, 14 * 60, s => s.moving)).toEqual([]);
    // Open ground keeps them in sight; a cat stays out on the doorstep.
    expect(ex.stateAt(odile, 19 * 60).visible).toBe(false); // in the pub
    const margo = dayPlan(cards.find(c => c.id === 'margo')!, 'Tue');
    expect(ex.stateAt(margo, 13 * 60)).toMatchObject({ place: 'old_quarter.fountain_square', visible: true });
    const bastien = dayPlan(cards.find(c => c.id === 'bastien')!, 'Tue');
    expect(ex.stateAt(bastien, 10 * 60)).toMatchObject({ place: 'old_quarter.library', activity: 'sleep', visible: true });
  });

  it('walks residents bound for unbuilt zones off the board edge and back', () => {
    const ex = new RoutineExecutor(world);
    expect(ex.resolve('millbrook.school')).toMatchObject({ kind: 'offboard', zone: null, offZone: 'millbrook', road: { zone: 'old_quarter', tile: [0, 12] } });
    const tib = plan('tib', 'old_quarter.okafor_house', [
      ['07:30', 'eat', 'old_quarter.okafor_house'],
      ['08:30', 'attend', 'millbrook.school'],
      ['15:45', 'visit', 'old_quarter.library'],
      ['20:45', 'sleep', 'old_quarter.okafor_house']
    ]);
    const [gone, back] = flips(ex, tib, 420, 1000, s => s.zone === null);
    // Off the west edge, then OFFBOARD_LEG_MINUTES later he's at school.
    const lastSeen = ex.stateAt(tib, gone! - 0.25);
    expect(lastSeen).toMatchObject({ zone: 'old_quarter', visible: true });
    expect(lastSeen.position!.x).toBeLessThan(1);
    expect(gone! + OFFBOARD_LEG_MINUTES).toBeCloseTo(510, 0);
    expect(ex.stateAt(tib, 600)).toMatchObject({ zone: null, position: null, visible: false, place: 'millbrook.school', traveling: null });
    // Back on the same road, at the edge, the leg's length before the library visit.
    const firstSeen = ex.stateAt(tib, back!);
    expect(firstSeen.position!.x).toBeLessThan(1);
    expect(firstSeen.position!.y).toBeCloseTo(12.5, 0); // the High Street's west end
    expect(ex.stateAt(tib, 945)).toMatchObject({ zone: 'old_quarter', traveling: null, visible: false, place: 'old_quarter.library' });
    // From an unbuilt zone to a built one across town: in from the west road, through Market Row, and down
    // the real edge into the Wharf (its provisional road is gone now the board exists).
    const cross = plan('cross', 'millbrook.mill', [['08:00', 'work', 'millbrook.mill'], ['12:00', 'eat', 'wharf.fish_market']]);
    const seen: (string | null)[] = [];
    for (let m = 600; m < 720; m += 0.5) { const z = ex.stateAt(cross, m).zone; if (seen.at(-1) !== z) seen.push(z); }
    expect(seen).toEqual([null, 'old_quarter', 'market_row', 'wharf']);
  });

  it('warns about unknown places instead of crashing', () => {
    const ex = new RoutineExecutor(world);
    const p = plan('lost', 'old_quarter.pell_house', [['08:00', 'visit', 'old_quarter.secret_garden'], ['12:00', 'visit', 'atlantis.palace'], ['15:00', 'sleep', 'old_quarter.pell_house']]);
    expect(ex.stateAt(p, 9 * 60)).toMatchObject({ zone: null, visible: false, place: 'old_quarter.secret_garden' });
    expect(ex.stateAt(p, 13 * 60)).toMatchObject({ zone: null, place: 'atlantis.palace' });
    expect(ex.stateAt(p, 16 * 60)).toMatchObject({ zone: 'old_quarter', place: 'old_quarter.pell_house' });
    expect([...ex.warnings].sort()).toEqual(['atlantis.palace', 'old_quarter.secret_garden']);
    expect(ex.timeline(p).failures).toEqual([]);
  });
});

/** Every minute of the day for these plans: positions legal, no failed walks, nobody stuck. */
function soak(ex: RoutineExecutor, plans: readonly DayPlan[]): { stuck: string[]; offTile: string[]; failures: string[] } {
  const stuck: string[] = [], offTile: string[] = [];
  const failures = plans.flatMap(p => ex.timeline(p).failures.map(f => `${p.resident}: ${f}`));
  const progress = new Map<string, { leg: string; value: number; since: number }>();
  for (let minute = DAY_START; minute <= PASS_OUT; minute++) {
    for (const s of ex.statesAt(plans, minute)) {
      if (s.position) {
        const zone = world.zones[s.zone!]!;
        if (!zone.walkability[Math.floor(s.position.y)]?.[Math.floor(s.position.x)]) offTile.push(`${s.id} ${s.zone} ${s.position.x.toFixed(2)},${s.position.y.toFixed(2)} @${minute}`);
      }
      if (s.visible && (!s.zone || !s.position)) offTile.push(`${s.id} visible nowhere @${minute}`);
      // Stuck: traveling with no progress for more than 30 in-game minutes (setting off on the next walk is progress).
      const last = progress.get(s.id);
      if (!s.traveling) { progress.delete(s.id); continue; }
      const leg = `${s.traveling.from}>${s.traveling.to}`;
      if (!last || last.leg !== leg || s.traveling.progress > last.value + 1e-9) progress.set(s.id, { leg, value: s.traveling.progress, since: minute });
      else if (minute - last.since > 30) stuck.push(`${s.id} @${minute}`);
    }
  }
  return { stuck, offTile, failures };
}

describe('full-day soak', () => {
  it('runs all 20 canon residents (and every other card) through every day of the week, 06:00 to 26:00', () => {
    expect(canon).toHaveLength(20);
    const ex = new RoutineExecutor(world);
    const places = new Set<string>();
    for (const day of WEEK) {
      const plans = cards.map(c => dayPlan(c, day));
      plans.forEach(p => { places.add(p.startPlace); p.blocks.forEach(b => places.add(b.place)); });
      const result = soak(ex, plans);
      expect(result.offTile, day).toEqual([]);
      expect(result.failures, day).toEqual([]);
      expect(result.stuck, day).toEqual([]);
    }
    // Report (not a failure): which places have no board yet, by zone, and anything unresolvable.
    const byZone: Record<string, string[]> = {};
    for (const id of [...places].sort()) {
      const info = ex.resolve(id);
      if (info.kind === 'offboard') (byZone[info.offZone!] ??= []).push(id.slice(id.indexOf('.') + 1));
    }
    console.info(`[soak] off-board places (zones not built yet):\n${Object.entries(byZone).map(([z, ids]) => `  ${z}: ${ids.join(', ')}`).join('\n')}`);
    console.info(`[soak] unresolved place ids: ${ex.warnings.size ? [...ex.warnings].join(', ') : 'none'}`);
    // Every place on a built board resolves to a door or a patch of open ground.
    for (const id of places) if (world.zones[id.slice(0, id.indexOf('.'))]) expect(['open', 'building', 'interior'], id).toContain(ex.resolve(id).kind);
  });

  it('runs 30 synthetic residents (jittered from the 20 cards) through a whole day without anyone stuck', () => {
    for (const day of ['Thu', 'Sat'] as const) {
      const ex = new RoutineExecutor(world);
      const crowd = syntheticPlans(canon.map(c => dayPlan(c, day)), 30);
      const t0 = performance.now();
      crowd.forEach(p => ex.timeline(p));
      const layout = performance.now() - t0;
      const result = soak(ex, crowd);
      expect(result.stuck, day).toEqual([]);
      expect(result.offTile, day).toEqual([]);
      expect(result.failures, day).toEqual([]);
      // Somebody is out walking on the built boards during the day.
      const walking = ex.statesAt(crowd, 12 * 60 + 25).filter(s => s.zone && s.visible).length;
      expect(walking, day).toBeGreaterThan(0);
      console.info(`[soak] ${day}: 30 residents laid out in ${layout.toFixed(0)} ms; ${walking} in sight at 12:25`);
    }
  });

  it('runs a sample of the Day-1 census\'s cards (MVP M-03) through every day of the week, homes on lanes and off-board too', async () => {
    // An even sample of the 188 (written, or their template cards until then) keeps the soak's runtime sane.
    const census = sampleOf(await loadDay1Cards(), 36);
    expect(census).toHaveLength(36);
    const ex = new RoutineExecutor(world);
    for (const day of WEEK) {
      const plans = census.map(c => dayPlan(c, day));
      const result = soak(ex, plans);
      expect(result.offTile, day).toEqual([]);
      expect(result.failures, day).toEqual([]);
      expect(result.stuck, day).toEqual([]);
    }
    expect([...ex.warnings]).toEqual([]);
  }, 60_000);
});

describe('homes (content/places/homes.yaml)', () => {
  const homes = loadHomes();
  const reachable = (zone: string, tile: readonly [number, number]) =>
    world.graph.route({ zone, tile: world.zones[zone]!.spawn }, { zone, tile: [tile[0], tile[1]] }) !== null;

  it('resolves every home: its building\'s door on the board, a lane off its edge, or off-board', () => {
    const ex = new RoutineExecutor(world);
    expect(homes.size).toBe(184);
    for (const [id, home] of homes) {
      const zone = id.slice(0, id.indexOf('.')), info = ex.resolve(id), board = world.zones[zone];
      if (home.host === 'offboard') {
        expect(board, id).toBeUndefined();
        expect(info, id).toMatchObject({ kind: 'offboard', offZone: zone });
      } else if ('lane' in home.host) {
        const [x, y] = home.host.lane;
        expect(info, id).toMatchObject({ kind: 'lane', zone: null, road: { zone, tile: [x, y] } });
        expect(x === 0 || y === 0 || x === board!.width - 1 || y === board!.height - 1, `${id}: a lane leaves by a border cell`).toBe(true);
        expect(board!.walkability[y]![x], id).toBe(true);
        expect(reachable(zone, [x, y]), id).toBe(true);
      } else {
        expect(['building', 'interior'], id).toContain(info.kind);
        expect(info.zone, id).toBe(zone);
        expect(board!.walkability[info.door![1]]![info.door![0]], id).toBe(true);
        expect(reachable(zone, info.door!), id).toBe(true);
      }
    }
    expect([...ex.warnings]).toEqual([]);
    // Flats share their building's door; a flat over a shop is the shop's interior.
    expect(ex.resolve('old_quarter.home_09').door).toEqual(ex.resolve('old_quarter.home_01').door);
    expect(ex.resolve('market_row.home_13')).toMatchObject({ kind: 'interior', local: 'storefront_6' });
    expect(ex.resolve('market_row.bakery_flat')).toMatchObject({ kind: 'interior', local: 'bakery' });
  });

  it('walks a lane resident off their board\'s edge at the lane, a few minutes from the door', () => {
    const ex = new RoutineExecutor(world);
    const p = plan('shore', 'wharf.home_05', [['07:00', 'eat', 'wharf.home_05'], ['09:00', 'work', 'wharf.fish_market'], ['18:00', 'sleep', 'wharf.home_05']]);
    const [seen] = flips(ex, p, 420, 600, s => s.zone !== null);
    const first = ex.stateAt(p, seen!);
    expect(first).toMatchObject({ zone: 'wharf', visible: true, moving: true });
    expect(first.position!.x).toBeGreaterThan(55); // stepping on at the east edge, by Shore Lane's cell [55, 2]
    expect(first.position!.y).toBeCloseTo(2.5, 0);
    // Off the board between the door and the edge for LANE_LEG_MINUTES, not the long off-board leg.
    const gone = flips(ex, p, 17 * 60, 18 * 60 + 30, s => s.zone === null)[0]!;
    expect(ex.stateAt(p, gone + LANE_LEG_MINUTES + 1)).toMatchObject({ zone: null, place: 'wharf.home_05', traveling: null });
    expect(LANE_LEG_MINUTES).toBeLessThan(OFFBOARD_LEG_MINUTES);
  });

  it('soaks a resident from every home (lanes and flats included) through a whole day without anyone stuck', () => {
    const ex = new RoutineExecutor(world);
    const plans = [...homes.keys()].map(id => plan(`at_${id}`, id, [
      ['07:30', 'eat', id], ['09:00', 'work', 'market_row.general_store'], ['12:30', 'eat', 'wharf.fish_market'],
      ['14:00', 'visit', 'millbrook.school'], ['16:00', 'walk', 'commons.picnic_lawn'], ['18:00', 'eat', id], ['21:30', 'sleep', id]
    ]));
    const result = soak(ex, plans);
    expect(result.offTile).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.stuck).toEqual([]);
    expect([...ex.warnings]).toEqual([]);
  });
});
