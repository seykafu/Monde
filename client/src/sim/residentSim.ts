// The town's residents as one lightweight simulation (MVP W-05; GDD §19.2). Pure: no Phaser, no DOM.
//
// Holds the day's plans (template routines until live plans arrive, M-07) and the routine executor.
// Off-screen, the scene ticks it at 1 Hz: one executor sample per resident, nothing else. The zone on
// screen samples its own residents every frame for smooth movement. Because the executor is a pure
// function of (plan, minute), both views always agree, and the zone you walk into is populated from the
// same answer the 1 Hz tick would give.

import type { PersonaCard } from '@monde/shared';
import { TypedEmitter, type TownEvents } from './events';
import { dayPlansFor, syntheticPlans, type DayPlan } from './plans';
import { RoutineExecutor, type ExecutorWorld, type ResidentState } from './routineExecutor';

export type SimCard = Pick<PersonaCard, 'id' | 'name' | 'kind' | 'routine'>;

export interface ResidentProfile {
  id: string;
  /** What the prompt and name tag show: a quoted nickname if the card has one ("June"), else the name. */
  name: string;
  kind: SimCard['kind'];
  /** Index in the roster: placeholder sprites pick a distinct colour from it. */
  index: number;
}

export interface BoardCounts {
  /** On this board: walking about, standing in the open, or inside one of its buildings. */
  here: number;
  /** Of those, inside a building. */
  inside: number;
  /** Anywhere: between places right now. */
  traveling: number;
  /** In a zone that isn't built (or off the map entirely). */
  offboard: number;
  /** On another built board. */
  elsewhere: number;
  /** Distinct place ids the executor couldn't put anywhere. */
  unresolved: number;
}

export const displayName = (name: string): string => /"([^"]+)"/.exec(name)?.[1] ?? name;

export class ResidentSim {
  readonly events = new TypedEmitter<TownEvents>();
  readonly executor: RoutineExecutor;
  readonly profiles: readonly ResidentProfile[];
  private readonly byId: ReadonlyMap<string, ResidentProfile>;
  private day = NaN;
  private plans: DayPlan[] = [];
  private planById = new Map<string, DayPlan>();
  private last: ResidentState[] = [];
  private lastKey = '';

  /** `extra` synthetic residents (jittered copies of the cards) join the canon ones (dev `?npcs=`). */
  constructor(private readonly cards: readonly SimCard[], world: ExecutorWorld, private readonly extra = 0) {
    this.executor = new RoutineExecutor(world);
    const profiles: ResidentProfile[] = cards.map((c, index) => ({ id: c.id, name: displayName(c.name), kind: c.kind, index }));
    for (let k = cards.length; k < cards.length + extra; k++) {
      const c = cards[k % cards.length]!;
      profiles.push({ id: `${c.id}_${k}`, name: `${displayName(c.name)} ${Math.floor(k / cards.length) + 1}`, kind: c.kind, index: k });
    }
    this.profiles = profiles;
    this.byId = new Map(profiles.map(p => [p.id, p]));
  }

  profile(id: string): ResidentProfile | undefined { return this.byId.get(id); }

  /** The day's plans (rebuilt when the day changes). */
  plansFor(day: number): readonly DayPlan[] {
    if (day !== this.day) {
      this.day = day;
      const base = dayPlansFor(this.cards, day);
      this.plans = this.extra > 0 ? syntheticPlans(base, base.length + this.extra, true) : base;
      this.planById = new Map(this.plans.map(p => [p.resident, p]));
      this.lastKey = '';
    }
    return this.plans;
  }

  /** Everyone's state at a minute: the 1 Hz off-screen tick (memoised per minute). */
  tick(day: number, minute: number): readonly ResidentState[] {
    const key = `${day}:${minute}`;
    if (key !== this.lastKey) {
      this.last = this.executor.statesAt(this.plansFor(day), minute);
      this.lastKey = key;
    }
    return this.last;
  }

  /** One resident at a (fractional) minute: what on-screen actors use every frame. */
  sample(id: string, day: number, minute: number): ResidentState | null {
    this.plansFor(day);
    const plan = this.planById.get(id);
    return plan ? this.executor.stateAt(plan, minute) : null;
  }

  /** Who is on `zone` at `minute` or will be within `lookahead` minutes (the on-screen roster). */
  boardRoster(zone: string, day: number, minute: number, lookahead: number): Set<string> {
    const ids = new Set<string>();
    for (const s of this.tick(day, minute)) if (s.zone === zone) ids.add(s.id);
    for (const s of this.executor.statesAt(this.plansFor(day), minute + lookahead)) if (s.zone === zone) ids.add(s.id);
    return ids;
  }

  counts(zone: string, states: readonly ResidentState[]): BoardCounts {
    const c: BoardCounts = { here: 0, inside: 0, traveling: 0, offboard: 0, elsewhere: 0, unresolved: this.executor.warnings.size };
    for (const s of states) {
      if (s.traveling) c.traveling++;
      if (s.zone === zone) { c.here++; if (!s.visible) c.inside++; } else if (s.zone === null) c.offboard++; else c.elsewhere++;
    }
    return c;
  }
}
