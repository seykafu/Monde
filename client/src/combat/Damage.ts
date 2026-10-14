import type { AttackPreview, Tile, Unit, WeaponKind } from "./types";
import { RAVAGE_ARMOR_MULT, RAVAGE_POWER_MULT } from "./types";
import { hasAbility } from "./Unit";
import { hasDefensiveStance, hasReadyStance } from "./Stances";
import { equipmentBonuses } from "./items";
import { clamp } from "../util/math";

// Weapon triangle: 1.15× favored, 0.85× unfavored, 1.0× neutral.
//
// Core triangle: sword > spear > shield > sword. Standard FE-style
// rock-paper-scissors that drives the squad-composition meta.
//
// Bow > dactyl: archers down-spear the flying mounts before they
// can close. Mirrors real-world "anti-air" advantage. Dactyls
// remain neutral to swords/spears/shields, so the only counter is
// a bow on the field — gives archer slots a clear identity beyond
// "ranged DPS that ignores the triangle."
const FAVORED: Partial<Record<WeaponKind, WeaponKind>> = {
  sword: "spear",
  spear: "shield",
  shield: "sword",
  bow: "dactyl"
};

export const weaponModifier = (attacker: WeaponKind, defender: WeaponKind): number => {
  if (attacker === defender) return 1.0;
  if (FAVORED[attacker] === defender) return 1.15;
  if (FAVORED[defender] === attacker) return 0.85;
  return 1.0;
};

// True if `attacker` weapon-triangle-favors `defender` (the attacker has the better matchup).
export const hasWeaponAdvantage = (attacker: WeaponKind, defender: WeaponKind): boolean =>
  FAVORED[attacker] === defender;

// Class-based matchup bonus that sits ON TOP of the weapon triangle.
//
// Shinobi (assassin) class strikes archers harder — the assassin's
// strength is closing distance + striking before the bow can fire.
//
// Sword weapon strikes shinobi class harder — assassins are fragile
// in straight melee against a properly-trained swordsman. The bonus
// goes to the SWORD attacker so it reads as "swords punish assassins"
// rather than "assassins take more damage from everything."
//
// Both branches return 1.15 (matching the weapon triangle's favored
// multiplier). Returned multiplicatively, so a shinobi attacking an
// archer with a sword gets BOTH the class bonus (1.15) AND the weapon
// matchup if any — stacks cleanly. Note shinobi units currently wield
// swords (e.g. Rose), so attacker.weapon === "sword" naturally; the
// class bonus is what makes their hit against archers different from
// a regular swordsman's.
export const attackerClassBonus = (attacker: Unit, defender: Unit): number => {
  if (attacker.classKind === "shinobi" && defender.weapon === "bow") return 1.15;
  if (attacker.weapon === "sword" && defender.classKind === "shinobi") return 1.15;
  return 1.0;
};

// Stance modifiers as documented in spec. Read through the Stances
// predicates so the combined "both" stance gets both effects.
export const attackerStanceModifier = (attacker: Unit, isCounter: boolean): number => {
  if (isCounter && hasReadyStance(attacker)) return 1.25;
  return 1.0;
};

export const defenderStanceModifier = (defender: Unit): number => {
  if (hasDefensiveStance(defender)) return 0.5;
  return 1.0;
};

// Whether `defender` has at least one adjacent ally (same faction, within 4-neighbour distance).
const hasAdjacentAlly = (defender: Unit, allUnits: Unit[]): boolean => {
  for (const u of allUnits) {
    if (u === defender) continue;
    if (!u.state.alive) continue;
    if (u.faction !== defender.faction) continue;
    const dx = Math.abs(u.state.position.x - defender.state.position.x);
    const dy = Math.abs(u.state.position.y - defender.state.position.y);
    if (dx + dy === 1) return true;
  }
  return false;
};

// Defender ability modifier: Aide halves incoming damage when adjacent to an ally.
export const defenderAbilityModifier = (defender: Unit, allUnits: Unit[]): number => {
  if (hasAbility(defender, "Aide") && hasAdjacentAlly(defender, allUnits)) return 0.5;
  return 1.0;
};

// Attacker ability modifier: BossFighter doubles damage vs. boss-class enemies.
export const attackerAbilityModifier = (attacker: Unit, defender: Unit): number => {
  if (hasAbility(attacker, "BossFighter") && defender.classKind === "boss") return 2.0;
  return 1.0;
};

// Ravage State multiplies the attacker's effective power for this swing
// when they entered the turn Ravaged (took ≥ RAVAGE_THRESHOLD_PCT of max
// HP since their last turn). The "wounded animal hits harder" loop.
export const attackerRavageModifier = (attacker: Unit): number =>
  attacker.state.ravagedActive ? RAVAGE_POWER_MULT : 1.0;

// Ravage State halves a defender's effective armor while they're in their
// Ravaged turn — they're committed forward and not blocking well. Combined
// with the attacker bonus, a Ravaged-vs-Ravaged trade is genuinely lethal.
// Dactyl Food (an equipment item) imposes an additional flat -4 armor on
// a dactyl-class carrier — bookkeeping centralized here so any path that
// reads armor (preview, AI threat scoring) sees the same number.
export const effectiveArmor = (defender: Unit): number => {
  const equipPenalty = equipmentBonuses(defender).armorPenalty;
  let armor = defender.stats.armor - equipPenalty;
  if (defender.state.ravagedActive) {
    armor = Math.floor(armor * RAVAGE_ARMOR_MULT);
  }
  return Math.max(0, armor);
};

const baseHitForWeapon = (w: WeaponKind): number => {
  switch (w) {
    case "sword":
      return 85;
    case "spear":
      return 80;
    case "shield":
      return 80;
    case "bow":
      return 75;
    case "dactyl":
      return 80;
    case "lens":
      // Precision instrument — the highest base hit in the game. The
      // lens's power budget lives in its armor pierce, not raw damage,
      // so the reliability is what makes the class feel surgical.
      return 90;
  }
};

// Lens beams ignore this fraction of the target's armor — focused light
// doesn't care how thick the plate is, only where the seams are. This is
// the weapon's core identity (the anti-armor answer from B14 onward) and
// is intentionally inherent to the WEAPON, not an ability, so it applies
// in the sim, previews, counters, and any future enemy lens unit alike.
const LENS_ARMOR_PIERCE = 0.5;

export const previewAttack = (
  attacker: Unit,
  defender: Unit,
  defenderTile: Tile,
  isCounter = false,
  allUnits: Unit[] = []
): AttackPreview => {
  const weaponMod = weaponModifier(attacker.weapon, defender.weapon);
  const terrainMod = defenderTile.defendBonus;
  const stanceMod = attackerStanceModifier(attacker, isCounter) * defenderStanceModifier(defender);
  const abilityMod = attackerAbilityModifier(attacker, defender) * defenderAbilityModifier(defender, allUnits);
  const ravageAtkMod = attackerRavageModifier(attacker);
  const classMod = attackerClassBonus(attacker, defender);
  let armor = effectiveArmor(defender);
  if (attacker.weapon === "lens") armor = Math.round(armor * (1 - LENS_ARMOR_PIERCE));
  const baseDamage =
    attacker.stats.power * weaponMod * terrainMod * stanceMod * abilityMod * ravageAtkMod * classMod -
    armor;
  // Boss phase two (UnitDef.secondWind) halves what lands. Applied
  // AFTER the armor subtraction so it scales the damage that actually
  // gets through — the whole point of expressing "2x defense" this way.
  // Inside previewAttack, so the player's damage preview, the AI's
  // threat scoring, and the real swing can never disagree.
  const damage = Math.max(1, Math.round(baseDamage * defender.state.damageTakenMult));

  // Equipment bonuses — Royal Lens (+15% hit per copy) and Fang (+10%
  // crit per copy) stack additively. Read the attacker's inventory once.
  const eq = equipmentBonuses(attacker);

  let hit = baseHitForWeapon(attacker.weapon) + (attacker.stats.speed - defender.stats.speed) * 2;
  hit -= defenderTile.hitPenalty;
  hit += eq.hitPct;
  const hitRate = clamp(Math.round(hit), 50, 99);

  let crit = 10 + (attacker.stats.speed - defender.stats.speed) * 0.5;
  if (isCounter && hasReadyStance(attacker)) crit += 5;
  crit += eq.critPct;
  const critRate = clamp(Math.round(crit), 0, 60);

  return { damage, hitRate, critRate, weaponMod, terrainMod, stanceMod };
};
