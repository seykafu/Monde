import type { Ability, Item, TilePos, Unit, UnitDef, UnitState } from "./types";
import { ELIXIR_HEAL, MAX_INVENTORY, POTION_HEAL, RAVAGE_THRESHOLD_PCT } from "./types";
import { equipmentBonuses } from "./items";

// Inventory is now a player-controlled, persistent squad pool that the
// player distributes at BattlePrepScene before the fight. createUnit no
// longer auto-grants potions — BattleScene's unit-hydration path passes
// in the player-assigned inventory (or empty for enemies). This keeps
// item flow honest: items consumed in battle are gone for good, items
// found are added to the squad pool, and pre-battle distribution
// becomes a real strategic moment.
const startingInventory = (_def: UnitDef): Item[] => [];

export const createUnit = (def: UnitDef, position: TilePos): Unit => {
  const state: UnitState = {
    hp: def.stats.hp,
    apRemaining: def.stats.ap,
    stance: "none",
    xp: 0,
    hasUsedRepositionStep: false,
    hasActedThisRound: false,
    hasStartedTurnThisRound: false,
    position: { ...position },
    facingX: def.faction === "enemy" ? -1 : 1,
    alive: true,
    inventory: startingInventory(def),
    roamUsedThisTurn: false,
    damageTakenSinceLastTurn: 0,
    ravagedNextTurn: false,
    ravagedActive: false,
    secondWindUsed: false,
    alwaysCounters: false,
    damageTakenMult: 1
  };
  return { ...def, state };
};

export const beginUnitTurn = (u: Unit): void => {
  // Idempotent within a round: re-entering this unit (e.g., the player
  // clicks away and back during the player phase) must not refill AP.
  if (u.state.hasStartedTurnThisRound) return;
  u.state.hasStartedTurnThisRound = true;
  // Equipment AP bonus — Dactyl Food (dactyl-class only) grants +1 AP
  // per item carried. Folded into the per-turn refill so the bonus
  // always applies cleanly without the AI / action buttons needing a
  // separate hook. Non-dactyl carriers see no AP change (gated in
  // equipmentBonuses).
  u.state.apRemaining = u.stats.ap + equipmentBonuses(u).apBonus;
  u.state.hasUsedRepositionStep = false;
  u.state.roamUsedThisTurn = false;
  // Stances expire at the start of this unit's next turn — including the
  // combined "both" stance.
  if (u.state.stance !== "none") {
    u.state.stance = "none";
  }
  // Ravage: promote the "next turn" flag into the active flag for this turn.
  // Reset the damage counter so the next round of incoming damage measures
  // from a clean baseline.
  u.state.ravagedActive = u.state.ravagedNextTurn;
  u.state.ravagedNextTurn = false;
  u.state.damageTakenSinceLastTurn = 0;
};

export const endUnitTurn = (u: Unit): void => {
  u.state.apRemaining = 0;
  u.state.hasActedThisRound = true;
  // Ravage state is a one-turn buff — the bonus and penalty both end
  // here. New damage taken between now and this unit's next turn will
  // accumulate fresh and may re-trigger ravagedNextTurn.
  u.state.ravagedActive = false;
};

// Effective maximum AP for this turn — the base stat plus any equipment
// AP bonus (Dactyl Food: +1 per item, dactyl-class only). This is the
// value beginUnitTurn refills apRemaining to, so UI that shows
// "AP cur/max" must use this for the denominator — otherwise a dactyl
// carrying Dactyl Food reads as "4/3" instead of "4/4".
export const effectiveMaxAp = (u: Unit): number =>
  u.stats.ap + equipmentBonuses(u).apBonus;

export const isAlive = (u: Unit): boolean => u.state.alive && u.state.hp > 0;

// Bring a unit back from a killing blow, once. Called only from
// damageUnit, which is the single chokepoint every damage source in the
// game funnels through — so the phase change can't be skipped by an
// ability or a counter that takes an unusual route to the HP bar.
const applySecondWind = (u: Unit): void => {
  const sw = u.secondWind;
  if (!sw) return;
  u.state.secondWindUsed = true;
  u.state.alwaysCounters = true;
  u.state.alive = true;
  u.state.hp = Math.max(1, Math.round(u.stats.hp * sw.hpFraction));
  u.state.damageTakenMult = sw.damageTaken;
  // Whatever just came online absorbs the shock — measure Ravage from a
  // clean baseline instead of letting the blow that "killed" them carry
  // over and ravage the boss on its first turn back.
  u.state.damageTakenSinceLastTurn = 0;
  u.state.ravagedNextTurn = false;
};

// Returns true when this damage triggered a second wind, so the caller
// can stage the moment (log line, VFX, dialogue, reinforcements).
export const damageUnit = (u: Unit, amount: number): boolean => {
  u.state.hp -= amount;
  if (u.state.hp <= 0) {
    if (u.secondWind && !u.state.secondWindUsed) {
      applySecondWind(u);
      return true;
    }
    u.state.hp = 0;
    u.state.alive = false;
  }
  // Track damage taken since this unit's last turn started. If the running
  // total crosses the Ravage threshold AND the unit is still alive, queue
  // them to enter Ravage state on their next turn. Dead units obviously
  // don't ravage. The flag is sticky — once set, it stays set even if
  // more damage piles on; beginUnitTurn promotes it on the next turn.
  u.state.damageTakenSinceLastTurn += amount;
  if (u.state.alive && u.state.damageTakenSinceLastTurn >= u.stats.hp * RAVAGE_THRESHOLD_PCT) {
    u.state.ravagedNextTurn = true;
  }
  return false;
};

export const healUnit = (u: Unit, amount: number): number => {
  const before = u.state.hp;
  u.state.hp = Math.min(u.stats.hp, u.state.hp + amount);
  return u.state.hp - before;
};

export const hasAbility = (u: Unit, a: Ability): boolean =>
  !!u.abilities && u.abilities.includes(a);

// Returns the amount actually healed (0 if the unit was at full HP).
// Equipment items (uses === 0) are rejected — they're passive and have
// no on-demand activation; the side panel / action buttons should
// filter them out before offering a "Use" option, but we double-check
// here so misroute calls don't silently destroy a Royal Lens.
export const useItem = (u: Unit, itemId: string): { ok: boolean; healed: number; itemName: string } => {
  const idx = u.state.inventory.findIndex((it) => it.id === itemId);
  if (idx < 0) return { ok: false, healed: 0, itemName: "" };
  const item = u.state.inventory[idx]!;
  if (item.uses <= 0) return { ok: false, healed: 0, itemName: item.name };
  let healed = 0;
  if (item.kind === "potion") {
    healed = healUnit(u, POTION_HEAL);
  } else if (item.kind === "elixir") {
    healed = healUnit(u, ELIXIR_HEAL);
  }
  // Consume the item (single use).
  u.state.inventory.splice(idx, 1);
  return { ok: true, healed, itemName: item.name };
};

export const canCarryMore = (u: Unit): boolean => u.state.inventory.length < MAX_INVENTORY;
