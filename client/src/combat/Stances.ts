import type { Unit, WeaponKind } from "./types";
import { Grid } from "./Grid";

// Speed differential at which a defender automatically counters even WITHOUT
// being in Ready stance. Tuned high (typical unit speeds run 5–9) so this is
// a rare edge-case payoff for genuinely fast specialists rather than an
// always-on retaliation that derails the AP economy. Lower this to make
// Speed counters bite at narrower differentials.
export const SPEED_COUNTER_THRESHOLD = 10;

// Manhattan reach at which each weapon retaliates. Bows are the long-range
// outlier and intentionally do NOT counter at melee distance — an archer in
// Ready punishes shooters and casters but stays vulnerable to anyone who
// closes the gap. Spear's 1–2 reach matches its attack range.
const reachFor = (w: WeaponKind): { min: number; max: number } => {
  if (w === "bow") return { min: 2, max: 4 };
  if (w === "lens") return { min: 2, max: 3 };
  if (w === "spear") return { min: 1, max: 2 };
  return { min: 1, max: 1 }; // sword / shield / dactyl
};

const inCounterRange = (defender: Unit, attacker: Unit): boolean => {
  const dx = Math.abs(defender.state.position.x - attacker.state.position.x);
  const dy = Math.abs(defender.state.position.y - attacker.state.position.y);
  const dist = dx + dy;
  const r = reachFor(defender.weapon);
  return dist >= r.min && dist <= r.max;
};

// Ready-stance counter: defender entered Ready stance during their turn
// (the stance flag persists until the start of their next turn, so the
// activation order within the turn doesn't matter). Stances STACK: taking
// Defend after Ready (or vice versa) yields the combined "both" state —
// each still costs its own AP. Historically Defend overwrote Ready, which
// silently wasted the first stance's AP; that trap is gone.

// Stance predicates — the ONLY sanctioned way to ask about stance state.
// Direct equality checks miss the combined "both" stance.
export const hasReadyStance = (u: Unit): boolean =>
  u.state.stance === "ready" || u.state.stance === "both";
export const hasDefensiveStance = (u: Unit): boolean =>
  u.state.stance === "defensive" || u.state.stance === "both";

// Consume the Ready half of a unit's stance (a Ready counter fired). From
// "both" this demotes to "defensive" — spending the counter must never
// silently strip a Defend the unit paid separate AP for.
export const spendReady = (u: Unit): void => {
  u.state.stance = u.state.stance === "both" ? "defensive" : "none";
};

export const canTriggerReadyCounter = (
  defender: Unit,
  attacker: Unit,
  _grid: Grid
): boolean => {
  if (!hasReadyStance(defender)) return false;
  return inCounterRange(defender, attacker);
};

// Speed-based passive counter: when the defender is at least
// SPEED_COUNTER_THRESHOLD points faster than the attacker, they retaliate
// reflexively — no Ready stance required, no AP cost, no per-turn cap.
// Reach still applies (a slow archer being punched in the face still can't
// shoot at point-blank). Damage uses base values, no Ready-bonus stack.
export const canTriggerSpeedCounter = (defender: Unit, attacker: Unit): boolean => {
  if (defender.stats.speed - attacker.stats.speed < SPEED_COUNTER_THRESHOLD) return false;
  return inCounterRange(defender, attacker);
};

// Unconditional retaliation, granted by a boss second wind (see
// UnitDef.secondWind). No stance to spend and no speed gate — the only
// remaining question is weapon reach, so closing to melee on a boss in
// phase two always costs you a hit back. Deliberately checked LAST in
// performAttack: a Ready counter still takes priority, because Ready
// carries the +25% damage kicker and the unit paid AP for it.
export const canTriggerRelentlessCounter = (defender: Unit, attacker: Unit): boolean => {
  if (!defender.state.alwaysCounters) return false;
  return inCounterRange(defender, attacker);
};

// Tiles from which `defender` can counter. Used to render the threat-zone
// overlay so the player can see where Ready enemies will retaliate.
export const counterZoneTiles = (defender: Unit): { x: number; y: number }[] => {
  const out: { x: number; y: number }[] = [];
  const r = reachFor(defender.weapon);
  for (let dy = -r.max; dy <= r.max; dy++) {
    for (let dx = -r.max; dx <= r.max; dx++) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < r.min || d > r.max) continue;
      out.push({ x: defender.state.position.x + dx, y: defender.state.position.y + dy });
    }
  }
  return out;
};
