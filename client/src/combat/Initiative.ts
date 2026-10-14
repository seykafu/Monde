import type { Faction, Unit } from "./types";
import { isAlive } from "./Unit";
export interface InitiativeSnapshot {
  round: number;
  cursor: number;
  orderIds: string[];
}

// Phase-based initiative: all player+ally units act first (in speed order),
// then all enemy units act (in speed order). Ties break by deployment order.
export const sortInitiative = (units: Unit[]): Unit[] => {
  const factionOrder: Record<Faction, number> = { player: 0, ally: 1, enemy: 2 };
  return [...units]
    .filter(isAlive)
    .map((u, idx) => ({ u, idx }))
    .sort((a, b) => {
      const fa = factionOrder[a.u.faction];
      const fb = factionOrder[b.u.faction];
      if (fa !== fb) return fa - fb;                                          // phase first
      if (b.u.stats.speed !== a.u.stats.speed) return b.u.stats.speed - a.u.stats.speed; // speed within phase
      return a.idx - b.idx;
    })
    .map((p) => p.u);
};

export class Initiative {
  private order: Unit[] = [];
  private cursor = 0;
  round = 1;

  reseed(allUnits: Unit[]): void {
    this.order = sortInitiative(allUnits);
    this.cursor = 0;
  }

  current(): Unit | null {
    while (this.cursor < this.order.length) {
      const u = this.order[this.cursor]!;
      if (isAlive(u)) return u;
      this.cursor++;
    }
    return null;
  }

  // The unit at the cursor WITHOUT the dead-skip. current() advances the
  // cursor past corpses as a convenience — which is exactly wrong for the
  // end-of-turn path, where "who just acted" must never slide forward onto
  // an innocent bystander because the actor died mid-turn.
  atCursor(): Unit | null {
    return this.order[this.cursor] ?? null;
  }

  // End-of-turn advance that tolerates the actor having died during its
  // own turn (counter kill, Destruct trade). If the cursor unit is dead,
  // skipping the corpse IS the advance — consuming another slot on top of
  // that would eat the next unit's turn: they'd be marked acted with 0 AP
  // and never get to move, standing wherever the enemy wants them.
  advancePastCurrent(allUnits: Unit[]): Unit | null {
    const at = this.order[this.cursor];
    if (at && !isAlive(at)) {
      const next = this.current(); // walks the cursor past corpses only
      if (next) return next;
      // The corpse-skip exhausted the queue — wrap into the next round.
      return this.advance(allUnits);
    }
    return this.advance(allUnits);
  }

  // Advance to the next living unit. Triggers a new round if the queue is exhausted.
  advance(allUnits: Unit[]): Unit | null {
    this.cursor++;
    while (this.cursor < this.order.length) {
      const u = this.order[this.cursor]!;
      if (isAlive(u)) return u;
      this.cursor++;
    }
    this.round++;
    this.reseed(allUnits);
    for (const u of allUnits) {
      if (!isAlive(u)) continue;
      u.state.hasActedThisRound = false;
      u.state.hasStartedTurnThisRound = false;
    }
    return this.current();
  }

  // Move the given unit to the cursor position so it becomes current().
  // Only valid if u is in the queue at or after the cursor (i.e., hasn't been processed).
  // Returns true on success, false if u isn't a valid swap target.
  setCurrent(u: Unit): boolean {
    for (let i = this.cursor; i < this.order.length; i++) {
      if (this.order[i]!.id === u.id) {
        if (i !== this.cursor) {
          const tmp = this.order[this.cursor]!;
          this.order[this.cursor] = u;
          this.order[i] = tmp;
        }
        return true;
      }
    }
    return false;
  }

  // ---- Suspend support ----
  // Capture the queue as plain data (unit ids, cursor, round) for the
  // mid-battle suspend snapshot.
  serialize(): InitiativeSnapshot {
    return {
      round: this.round,
      cursor: this.cursor,
      orderIds: this.order.map((u) => u.id)
    };
  }

  // Rebuild the queue from a snapshot against the restored unit list.
  // Ids that no longer resolve are dropped (defensive against content
  // renames between save and load); the cursor clamps to the rebuilt
  // length so current() stays valid.
  restore(allUnits: Unit[], snap: InitiativeSnapshot): void {
    const byId = new Map(allUnits.map((u) => [u.id, u]));
    this.order = snap.orderIds
      .map((id) => byId.get(id))
      .filter((u): u is Unit => !!u);
    this.cursor = Math.min(Math.max(0, snap.cursor), this.order.length);
    this.round = snap.round;
  }

  // Get the upcoming N turns for the initiative bar UI. Reseeds virtually if needed.
  upcoming(allUnits: Unit[], count: number): Unit[] {
    const out: Unit[] = [];
    let cursor = this.cursor;
    let workOrder = this.order;
    while (out.length < count) {
      if (cursor >= workOrder.length) {
        // start of next round (virtual)
        workOrder = sortInitiative(allUnits);
        cursor = 0;
      }
      const u = workOrder[cursor];
      if (u && isAlive(u)) out.push(u);
      cursor++;
      if (out.length > 64) break; // safety
    }
    return out;
  }
}
