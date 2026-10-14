import type { Item, ItemKind, Unit } from "./types";
import {
  DACTYL_FOOD_AP_BONUS,
  DACTYL_FOOD_ARMOR_PENALTY,
  FANG_CRIT_BONUS,
  MASK_MOV_BONUS,
  ROYAL_LENS_HIT_BONUS
} from "./types";

// Item catalog. Single source of truth for display name + kind metadata.
// BattlePrepScene's inventory UI, the trading post, and the in-battle
// inspect panels all read from here so a new item only needs to be
// added in one place (plus the effect wiring in `equipmentBonuses`).
export interface ItemMeta {
  kind: ItemKind;
  name: string;
  description: string;
  // True for items that activate on demand (potion, elixir). False for
  // passive equipment (mask, fang, royal_lens, dactyl_food).
  consumable: boolean;
  // True for items that are passive while in inventory (so they read as
  // equipment in the UI) BUT are spent at battle end regardless of
  // whether the carrier survives. EVERY non-consumable item is now a
  // single-fight tool: if you assign a Mask / Fang / Royal Lens / Dactyl
  // Food to a character for a battle, it's gone when that battle ends
  // (win OR lose). Only the on-demand consumables (Potion, Elixir) carry
  // over — and only if you didn't spend them in the fight.
  // reconcilePostBattleInventory filters these out before persisting
  // survivor bags and before pushing fallen drops back to the pool.
  // Items left in the squad pool (never assigned to a deployed unit) are
  // unaffected — they're only spent once you actually bring them.
  consumedOnBattleEnd?: boolean;
  // Glyph for the inventory grid — picked to read at 16-32px without
  // needing per-item PNGs in v1. Replace with real icon assets later.
  glyph: string;
}

export const ITEM_CATALOG: Record<ItemKind, ItemMeta> = {
  potion: {
    kind: "potion",
    name: "Potion",
    description: "Heals 10 HP. Use during turn for 1 AP. Carries over to the next battle if unused.",
    consumable: true,
    glyph: "🧪"
  },
  elixir: {
    kind: "elixir",
    name: "Elixir",
    description: "Heals 25 HP. Use during turn for 1 AP. Carries over to the next battle if unused.",
    consumable: true,
    glyph: "⚗️"
  },
  mask: {
    kind: "mask",
    name: "Mask",
    description: "+2 movement during battle. Stacks. Single-use — consumed at battle's end.",
    consumable: false,
    consumedOnBattleEnd: true,
    glyph: "🎭"
  },
  fang: {
    kind: "fang",
    name: "Fang",
    description: "+10% crit chance while carried. Stacks. Single-use — consumed at battle's end.",
    consumable: false,
    consumedOnBattleEnd: true,
    glyph: "🦷"
  },
  royal_lens: {
    kind: "royal_lens",
    name: "Royal Lens",
    description: "+15% hit chance while carried. Stacks. Single-use — consumed at battle's end.",
    consumable: false,
    consumedOnBattleEnd: true,
    glyph: "🔍"
  },
  dactyl_food: {
    kind: "dactyl_food",
    name: "Dactyl Food",
    description: "Dactyl riders only: +1 AP, -4 armor while carried. Single-use — consumed at battle's end.",
    consumable: false,
    consumedOnBattleEnd: true,
    glyph: "🍖"
  }
};

// Monotonic counter for per-Item ids — every item instance needs a
// unique id so inventory transfer / use can target a specific one even
// when a character holds multiple of the same kind.
let nextItemId = 1;
const mkItem = (kind: ItemKind, uses: number): Item => ({
  id: `item_${nextItemId++}`,
  kind,
  name: ITEM_CATALOG[kind].name,
  uses
});

export const createPotion = (): Item => mkItem("potion", 1);
export const createElixir = (): Item => mkItem("elixir", 1);
export const createMask = (): Item => mkItem("mask", 0);
export const createFang = (): Item => mkItem("fang", 0);
export const createRoyalLens = (): Item => mkItem("royal_lens", 0);
export const createDactylFood = (): Item => mkItem("dactyl_food", 0);

export const createItem = (kind: ItemKind): Item => {
  switch (kind) {
    case "potion": return createPotion();
    case "elixir": return createElixir();
    case "mask": return createMask();
    case "fang": return createFang();
    case "royal_lens": return createRoyalLens();
    case "dactyl_food": return createDactylFood();
  }
};

// Sum the passive bonuses granted by every equipment item in this
// unit's inventory. Called from previewAttack (crit + hit), from
// effectiveMovement (mov), and from beginUnitTurn / unit creation
// (ap + armor). Equipment STACKS — five Fangs = +50% crit.
//
// Dactyl Food is faction/class-gated: only dactyl_rider and dactyl_king
// units get the AP bonus; for any other class the item is dead weight
// and the armor penalty also doesn't apply (so a non-dactyl character
// who picks one up by mistake isn't mechanically punished).
export interface EquipmentBonuses {
  movement: number;
  critPct: number;
  hitPct: number;
  apBonus: number;
  armorPenalty: number;
}

export const NO_BONUSES: EquipmentBonuses = {
  movement: 0,
  critPct: 0,
  hitPct: 0,
  apBonus: 0,
  armorPenalty: 0
};

const isDactylClass = (u: Unit): boolean =>
  u.classKind === "dactyl_rider" || u.classKind === "dactyl_king";

export const equipmentBonuses = (u: Unit): EquipmentBonuses => {
  const bonuses: EquipmentBonuses = { ...NO_BONUSES };
  for (const it of u.state.inventory) {
    switch (it.kind) {
      case "mask":
        bonuses.movement += MASK_MOV_BONUS;
        break;
      case "fang":
        bonuses.critPct += FANG_CRIT_BONUS;
        break;
      case "royal_lens":
        bonuses.hitPct += ROYAL_LENS_HIT_BONUS;
        break;
      case "dactyl_food":
        // Dactyl-class only; otherwise the item is inert.
        if (isDactylClass(u)) {
          bonuses.apBonus += DACTYL_FOOD_AP_BONUS;
          bonuses.armorPenalty += DACTYL_FOOD_ARMOR_PENALTY;
        }
        break;
      // Consumables (potion, elixir) contribute no passive bonus.
      case "potion":
      case "elixir":
        break;
    }
  }
  return bonuses;
};
