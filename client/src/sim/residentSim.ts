// The town's residents as one lightweight simulation (MVP W-05; GDD §19.2). Pure: no Phaser, no DOM.
//
// Holds the day's plans (template routines until live plans arrive, M-07) and the routine executor.
// Off-screen, the scene ticks it at 1 Hz: one executor sample per resident, nothing else. The zone on
// screen samples its own residents every frame for smooth movement. Because the executor is a pure
// function of (plan, minute), both views always agree, and the zone you walk into is populated from the
// same answer the 1 Hz tick would give.

import type { PersonaCard, PlanOutput } from '@monde/shared';
import { TypedEmitter, type TownEvents } from './events';
import { dayPlansFor, syntheticPlans, withLivePlans, type DayPlan } from './plans';
import { RoutineExecutor, withSeats, type ExecutorWorld, type ResidentState } from './routineExecutor';

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

/** The day's live plans from the mind by resident (the dawn package's model plans), or null for templates only. */
export type LivePlans = (day: number) => Readonly<Record<string, PlanOutput>> | null;

/**
 * Changes to the day's plans from a game system, after templates and live plans (G-03: a Project's volunteers at its
 * site, sim/volunteers.ts). `key(day)` must be cheap (it's read every frame) and change only when `apply` would.
 */
export interface PlanAdjuster {
  key(day: number): string;
  apply(plans: readonly DayPlan[], day: number): readonly DayPlan[];
}

/**
 * Whether a resident is about town at a minute (G-02: an arrival is on the ferry until 08:00, a leaver gone once it
 * sails). Absent residents have no state: not drawn, not counted.
 */
export type Presence = (id: string, day: number, minute: number) => boolean;

export class ResidentSim {
  readonly events = new TypedEmitter<TownEvents>();
  readonly executor: RoutineExecutor;
  private profileList: ResidentProfile[];
  private byId: Map<string, ResidentProfile>;
  private cards: readonly SimCard[];
  /** G-02: the generated residents after the authored cards (arrivals join, leavers go). */
  private generated: readonly SimCard[] = [];
  private generatedKey = '';
  private presence: Presence | null = null;
  private day = NaN;
  private plans: DayPlan[] = [];
  private planById = new Map<string, DayPlan>();
  private last: ResidentState[] = [];
  private lastKey = '';
  private liveRef: Readonly<Record<string, PlanOutput>> | null = null;
  /** Plan adjusters by slot, applied in the order installed (G-03 volunteers, G-02 arrivals and leavers). */
  private adjusters = new Map<string, PlanAdjuster>();
  private adjustKey = '';

  /** `extra` synthetic residents (jittered copies of the cards) join the canon ones (dev `?npcs=`). */
  constructor(private readonly authored: readonly SimCard[], world: ExecutorWorld, private readonly extra = 0, private readonly livePlans?: LivePlans) {
    this.executor = new RoutineExecutor(world);
    this.cards = authored;
    this.profileList = this.buildProfiles();
    this.byId = new Map(this.profileList.map(p => [p.id, p]));
  }

  /** Everyone simulated: the authored cards, the dev copies, then the generated residents. */
  get profiles(): readonly ResidentProfile[] { return this.profileList; }

  private buildProfiles(): ResidentProfile[] {
    const cards = this.authored;
    const profiles: ResidentProfile[] = cards.map((c, index) => ({ id: c.id, name: displayName(c.name), kind: c.kind, index }));
    for (let k = cards.length; k < cards.length + this.extra; k++) {
      const c = cards[k % cards.length]!;
      profiles.push({ id: `${c.id}_${k}`, name: `${displayName(c.name)} ${Math.floor(k / cards.length) + 1}`, kind: c.kind, index: k });
    }
    const base = cards.length + this.extra;
    this.generated.forEach((c, i) => profiles.push({ id: c.id, name: displayName(c.name), kind: c.kind, index: base + i }));
    return profiles;
  }

  profile(id: string): ResidentProfile | undefined { return this.byId.get(id); }

  /**
   * G-02: the generated residents now (arrivals on today's boat included, leavers gone). A resident keeps their
   * roster index while they stay, so their colour never shifts. Plans are rebuilt on the next read.
   */
  setGenerated(cards: readonly SimCard[]): void {
    const key = cards.map(c => c.id).join(',');
    if (key === this.generatedKey) return;
    // Keep everyone who stays where they were; newcomers go at the end.
    const stay = this.generated.filter(c => cards.some(n => n.id === c.id)).map(c => cards.find(n => n.id === c.id)!);
    const fresh = cards.filter(c => !stay.some(s => s.id === c.id));
    this.generated = [...stay, ...fresh];
    this.generatedKey = key;
    this.cards = [...this.authored, ...this.generated];
    this.profileList = this.buildProfiles();
    this.byId = new Map(this.profileList.map(p => [p.id, p]));
    this.day = NaN;
  }

  /** G-02: who is about town when (null: everyone always). */
  setPresence(presence: Presence | null): void {
    this.presence = presence;
    this.lastKey = '';
  }

  private present(id: string, day: number, minute: number): boolean {
    return !this.presence || this.presence(id, day, minute);
  }

  /** Install (or clear) a plan adjuster in its slot; the day's plans are rebuilt on the next read. */
  setAdjuster(adjuster: PlanAdjuster | null, slot = 'default'): void {
    if ((this.adjusters.get(slot) ?? null) === adjuster) return;
    if (adjuster) this.adjusters.set(slot, adjuster); else this.adjusters.delete(slot);
    this.day = NaN;
  }

  /** The day's plans (rebuilt when the day changes, or when the day's live plans arrive). */
  plansFor(day: number): readonly DayPlan[] {
    const live = this.livePlans?.(day) ?? null;
    let adjustKey = '';
    for (const [slot, a] of this.adjusters) adjustKey += `${slot}:${a.key(day)}|`;
    if (day !== this.day || live !== this.liveRef || adjustKey !== this.adjustKey) {
      this.day = day;
      this.liveRef = live;
      this.adjustKey = adjustKey;
      const templates = dayPlansFor(this.cards, day);
      const planned = live ? withLivePlans(templates, live).plans : templates;
      let base: readonly DayPlan[] = planned;
      for (const a of this.adjusters.values()) base = [...a.apply(base, day)];
      if (this.extra > 0) {
        // Dev crowd copies come from the authored cards only, matching their profiles.
        const authoredIds = new Set(this.authored.map(c => c.id));
        const authored = base.filter(p => authoredIds.has(p.resident));
        this.plans = [...syntheticPlans(authored, authored.length + this.extra, true), ...base.filter(p => !authoredIds.has(p.resident))];
      } else this.plans = [...base];
      // Gatherings: everyone at a social spot on a cell of their own (routineExecutor.ts).
      this.plans = withSeats(this.plans);
      this.planById = new Map(this.plans.map(p => [p.resident, p]));
      this.lastKey = '';
    }
    return this.plans;
  }

  /** Everyone's state at a minute: the 1 Hz off-screen tick (memoised per minute). */
  tick(day: number, minute: number): readonly ResidentState[] {
    const key = `${day}:${minute}`;
    if (key !== this.lastKey) {
      const states = this.executor.statesAt(this.plansFor(day), minute);
      this.last = this.presence ? states.filter(s => this.present(s.id, day, minute)) : states;
      this.lastKey = key;
    }
    return this.last;
  }

  /** One resident at a (fractional) minute: what on-screen actors use every frame. */
  sample(id: string, day: number, minute: number): ResidentState | null {
    this.plansFor(day);
    const plan = this.planById.get(id);
    if (!plan || !this.present(id, day, minute)) return null;
    return this.executor.stateAt(plan, minute);
  }

  /** Who is on `zone` at `minute` or will be within `lookahead` minutes (the on-screen roster). */
  boardRoster(zone: string, day: number, minute: number, lookahead: number): Set<string> {
    const ids = new Set<string>();
    for (const s of this.tick(day, minute)) if (s.zone === zone) ids.add(s.id);
    for (const s of this.executor.statesAt(this.plansFor(day), minute + lookahead)) if (s.zone === zone && this.present(s.id, day, minute + lookahead)) ids.add(s.id);
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
