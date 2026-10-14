// Authoritative combat domain types for Ravage.
// Per spec: Speed-based initiative, Action Points, Ready stance, weapon triangle.

export type Faction = "player" | "enemy" | "ally";

// "lens" — Veya's focused-light instrument (B14+). Sits OUTSIDE the
// sword>spear>shield triangle (neutral to everything, like dactyl),
// range 2-3, and its beams ignore half the target's armor (see
// LENS_ARMOR_PIERCE in Damage.ts). The squad's answer to late-game
// plate; fragile and slow to carry as compensation.
export type WeaponKind = "sword" | "spear" | "shield" | "bow" | "dactyl" | "lens";

export type ClassKind =
  // Tier 1
  | "swordsman"
  | "spearton"
  | "knight"
  | "archer"
  | "shinobi"
  | "sentinel"
  | "dactyl_rider"
  | "lenscaster"
  // Tier 2 (post-promotion). swordmaster ships first because Selene already
  // joins as one in B7. The other six don't have sprite folders yet — units
  // that promote into them rely on spriteClassOverride pointing back at the
  // Tier 1 sprite until proper assets ship. See docs/RAVAGE_DESIGN.md §5.2.
  | "swordmaster"
  | "spearton_lord"
  | "khan"
  | "robinhelm"
  | "dactyl_king"
  | "shinobi_master"
  | "guardian"
  | "prismarch"
  // Special
  | "boss";

// Bespoke battle sprites — one named character each, drawn from their
// portrait (scripts/art/gen_anim_sheets.py BESPOKE). The bosses all shared
// the "boss" sheet and the Ravage's troops wore human soldiers' sheets;
// these are who they really are. A unit opts in with UnitDef.sprite.
export const BESPOKE_SPRITES = [
  "nebu", "ndari", "castor", "wren", "othren", "serrick", "archbold", "dawn",
  "herald", "ravage_commander", "ravage_trooper", "ravage_lancer", "ravage_marksman",
  // The rank and file who wore the heroes' sheets, and two story faces.
  "bandit_swordsman", "bandit_archer", "bandit_spearton", "royal_guard", "crown_archer",
  "kian", "rose"
] as const;
export type BespokeSprite = typeof BESPOKE_SPRITES[number];
/** A sprite sheet folder: a class's, or a character's own. */
export type SpriteClass = ClassKind | BespokeSprite;

// "both" = Ready AND Defensive active simultaneously. Stances STACK: each
// costs 1 AP and a unit may hold both in the same turn (the braced
// counter-stance — full turtle at the cost of the whole offense). Read
// stance state through hasReadyStance / hasDefensiveStance in Stances.ts,
// never by direct equality, so "both" is always honoured.
export type Stance = "none" | "defensive" | "ready" | "both";

// Special abilities. A unit may have at most MAX_ABILITIES (2).
//
// Tier 1 abilities (granted at unit creation):
//   BossFighter: 2× damage vs. boss-class enemies.
//   Aide:        2× defense (incoming dmg ×0.5) when adjacent to another ally.
//   Destruct:    on death, the killing blow's attacker also dies.
//   Roam:        once per turn, after AP is spent, the unit may consume 1 extra
//                AP to make a single additional Move.
//
// Tier 2 signature abilities (granted on story-gated promotion). These are
// declared in the union now so the side panel can render them and saves can
// persist them, but their combat math is NOT YET wired — they're effectively
// no-ops until the bond/counter pass. See docs/RAVAGE_DESIGN.md §5.5.
//   CritPlus:    Swordmaster — +15% crit rate.
//   Phalanx:     Spearton Lord — adjacent allies take −20% damage.
//   Charge:      Khan — first attack each turn does +25% damage.
//   Pierce:      Robinhelm — bow attacks ignore 50% of target armor.
//   Stoop:       Dactyl King — once per battle, free move + attack within 6 mv.
//   Vanish:      Shinobi Master — after attacking, take −50% damage until next turn.
//   Bulwark:     Guardian — cannot be moved by enemy effects; +2 effective armor.
//   Refract:     Prismarch — a killing beam splashes 50% damage to one enemy
//                adjacent to the target.
//
// Support abilities:
//   Mend:        Ranatoli (L10+) — heal the most-wounded adjacent ally for
//                40% of their max HP (1 AP). Awards the mender solid XP, so
//                a shield-line veteran levels by keeping people standing
//                instead of by stealing kills.
export type Ability =
  | "BossFighter" | "Aide" | "Destruct" | "Roam"
  | "CritPlus" | "Phalanx" | "Charge" | "Pierce" | "Stoop" | "Vanish" | "Bulwark"
  | "Refract" | "Mend";
export const MAX_ABILITIES = 2;

// Battle inventory. Capped at MAX_INVENTORY (5) per unit.
//
// Two kinds of items:
//   * Consumables — `uses > 0`, spent on activation:
//       - potion (heal 10), elixir (heal 25)
//   * Equipment — `uses === 0`, passive while in inventory:
//       - mask (+2 MOV), fang (+10% crit), royal_lens (+15% hit),
//         dactyl_food (+1 AP / -4 ARM, dactyl-only)
//
// Equipment STACKS — two Masks = +4 MOV. The 5-slot inventory cap is
// the only limiter. Players can choose to over-stack one stat or
// diversify; both are valid builds.
export type ItemKind =
  | "potion"
  | "elixir"
  | "mask"
  | "fang"
  | "royal_lens"
  | "dactyl_food";
export interface Item {
  id: string;       // unique per-unit instance id
  kind: ItemKind;
  name: string;
  // For consumables, remaining uses (always 1 in v1 — single-use). For
  // equipment, 0 — the item's effect is permanent while it sits in
  // inventory and there's no "use" action. useItem() rejects items
  // with uses === 0.
  uses: number;
}
export const MAX_INVENTORY = 5;
export const POTION_HEAL = 10;
export const ELIXIR_HEAL = 25;
// Per-instance bonuses granted by an equipment item in inventory. These
// stack additively when multiple of the same item type are carried.
export const MASK_MOV_BONUS = 2;
export const FANG_CRIT_BONUS = 10;        // +10% crit chance per Fang
export const ROYAL_LENS_HIT_BONUS = 15;    // +15% hit chance per Royal Lens
export const DACTYL_FOOD_AP_BONUS = 1;
export const DACTYL_FOOD_ARMOR_PENALTY = 4;

export interface UnitStats {
  hp: number;
  power: number;
  armor: number;
  speed: number;
  movement: number;
  ap: number;
}

// Per-stat % chance to gain +1 on level up. See src/combat/Progression.ts and
// the "Stat Growths" table in docs/RAVAGE_DESIGN.md. Each field is a 0–100
// integer; a value of 0 means the stat will never grow naturally.
//
// Movement growth is intentionally rare across all characters — speed already
// scales tactical reach, and movement creep breaks map design.
export interface GrowthTable {
  hp: number;
  power: number;
  armor: number;
  speed: number;
  movement: number;
}

// Levels and XP. Cap, threshold, and reward formulas live in Progression.ts.
// `level` is required on every UnitDef so the level-difference XP modifier
// works without scattered fallbacks. `growths` is optional — enemies and
// units who don't progress (bosses) leave it undefined and are treated as
// non-growing for level-up purposes.
export const LEVEL_CAP = 20;
export const XP_PER_LEVEL = 100;

export interface SecondWind {
  // Fraction of MAX hp the unit returns at (0.55 = comes back at 55%).
  hpFraction: number;
  // Incoming damage is multiplied by this for the rest of the fight.
  // 0.5 IS the "twice as hard to kill" beat, and it is deliberately a
  // damage multiplier rather than a doubled armor stat: armor is
  // SUBTRACTIVE in this game (power x mods - armor), so doubling it
  // floors every attacker under the armor value at 1 damage and turns
  // most of the squad into spectators, while the two heaviest hitters
  // barely notice. Halving damage scales every character identically —
  // the boss really is twice as tough, for everyone.
  damageTaken: number;
  // Battle-log line the moment it fires.
  announce: string;
}

export interface UnitDef {
  id: string;
  name: string;
  shortName: string; // 2 letters for tile label
  faction: Faction;
  classKind: ClassKind;
  weapon: WeaponKind;
  stats: UnitStats;
  // Procedural-art seed: visual deterministically generated from this number.
  artSeed: number;
  // Optional palette override (hex 0xRRGGBB).
  palette?: { primary: number; secondary: number; accent: number };
  // Boss / named unit gets a portrait.
  portrait?: boolean;
  // Optional override for the portrait asset key. Use this when a unit's `id`
  // is an alias of a canonical character (e.g. "amar_true" in Battle 1 is the
  // same character as "amar" but with a different statline) so the side-panel
  // avatar still routes to the right portrait file.
  portraitId?: string;
  // Optional override for the in-battle sprite class. Use this when a unit's
  // `classKind` (which drives mechanics — mountBonus, AP, etc.) doesn't
  // have a shipped sprite folder under public/assets/sprites/. Without this,
  // ensureUnitTexture in UnitArt.ts silently falls back to the procedural
  // pixel-art generator, which looks notably worse than the asset sprites.
  // E.g., Kian is class "knight" mechanically (gets the +2 mount bonus) but
  // renders as "swordmaster" until knight sprites ship.
  spriteClassOverride?: ClassKind;
  // The unit's own battle sprite, when they have one (BespokeSprite):
  // drawn whenever its sheet has loaded, ahead of the class's.
  sprite?: BespokeSprite;
  // AI hold-position rule. When set, this unit's turn ends without action
  // (skips move + attack) until the count of OTHER alive units in the same
  // faction drops to `allyCount` or below. Used for kingly bosses who only
  // join the fight once their guard has been thinned out (e.g., King Nebu
  // sits on the throne until only one Royal Guard remains, then engages).
  // Implemented in src/combat/AI.ts:planEnemyTurn — the early-return runs
  // before any attack/move scoring.
  holdPositionUntil?: { allyCount: number };
  // Optional tag set used by AI scoring (e.g., "boss" forces the AI to be more aggressive).
  tags?: ReadonlySet<string>;
  // Up to MAX_ABILITIES special abilities granted at unit creation.
  abilities?: Ability[];
  // Progression. Required field; the XP reward formula needs both attacker
  // and defender level to compute the level-diff modifier without fallbacks.
  // Player factories set their character's narratively-correct starting
  // level (e.g., post-amnesia Amar = 3, original-8 Amar = 10). Enemy
  // factories take a `level` parameter so battle authors can tune
  // difficulty per fight (cap is LEVEL_CAP = 20).
  level: number;
  // Per-stat % chance to gain +1 on level up. Optional; units without a
  // growths table simply don't roll new stats on level up (used for
  // single-encounter bosses and the like).
  growths?: GrowthTable;
  // Boss second phase. When this unit's HP would first reach 0, it does
  // NOT fall: it comes back at `hpFraction` of max HP with its armor
  // multiplied and retaliation made unconditional. Fires exactly once —
  // empty the bar a second time and the unit dies normally.
  //
  // Deliberately intercepted inside damageUnit (Unit.ts) rather than at
  // the attack layer, so EVERY damage source routes through it: melee,
  // counters, lens fire, Destruct. A victory condition built on
  // defeatUnit therefore can't fire early — the boss is still alive.
  secondWind?: SecondWind;
  // The level this def's authored STATS were tuned for. The difficulty
  // layer scales stats for levels above this reference, so a Royal Guard
  // fielded at L16 fights like a L16 soldier instead of the L6 statline
  // the factory was written against. Unset = stats are already correct
  // for def.level (no scaling).
  statReferenceLevel?: number;
}

export interface UnitState {
  hp: number;
  apRemaining: number;
  stance: Stance;
  // Cumulative XP earned at this unit's CURRENT level. Drains by XP_PER_LEVEL
  // each time the unit levels up; capped implicitly when level == LEVEL_CAP
  // (no further XP is awarded). Persisted across battles via SaveState.
  xp: number;
  hasUsedRepositionStep: boolean;
  hasActedThisRound: boolean;
  // Set true the first time beginUnitTurn runs for this unit in a round, and
  // cleared on round advance. Guards against AP being refilled when the
  // player swaps off a partially-used unit and clicks back to it.
  hasStartedTurnThisRound: boolean;
  position: TilePos;
  facingX: 1 | -1;
  alive: boolean;
  inventory: Item[];
  // Roam tracks per-turn use: reset at the start of each turn.
  roamUsedThisTurn: boolean;
  // ---- Ravage State ----
  // Cumulative damage this unit has taken since their last turn started.
  // Reset to 0 at beginUnitTurn. When this crosses RAVAGE_THRESHOLD_PCT of
  // max HP, ravagedNextTurn is set so the unit enters Ravaged on their next
  // turn. See src/combat/Unit.ts:damageUnit and docs/RAVAGE_DESIGN.md §3.10.
  damageTakenSinceLastTurn: number;
  // Set when damageTakenSinceLastTurn crosses the threshold. Promoted to
  // ravagedActive at the unit's next beginUnitTurn, then cleared. So
  // damaging a unit AFTER they cross the threshold but before their next
  // turn doesn't double-apply.
  ravagedNextTurn: boolean;
  // Second-wind bookkeeping. Flips true the first time this unit's HP
  // would hit 0 while UnitDef.secondWind is unspent — see damageUnit.
  // Persisted through the suspend snapshot (it rides UnitState), so a
  // boss that has already used its phase two doesn't get another one
  // when the player resumes a saved fight.
  secondWindUsed: boolean;
  // Unconditional retaliation: this unit counters ANY attacker inside
  // its weapon reach, with no Ready stance and no speed requirement.
  // Granted by a second wind; nothing else sets it today.
  alwaysCounters: boolean;
  // Multiplier on all incoming damage. 1 for everyone until a second
  // wind sets it (see SecondWind.damageTaken). Lives on state rather
  // than being read off the def so the damage pipeline stays a pure
  // state read, and so it rides the suspend snapshot for free.
  damageTakenMult: number;
  // True for the duration of a unit's turn when they entered it Ravaged.
  // Read by Damage.ts (attackerRavageModifier / defenderRavageModifier)
  // and Actions.ts (effectiveMovement adds +1). Cleared at endUnitTurn.
  ravagedActive: boolean;
}

// Damage taken between two consecutive turns of a unit must reach this
// fraction of their max HP to trigger Ravage state on the next turn.
// Tuned to 0.5 — half-HP swings happen often enough that the loop fires
// in most battles but not on every trade. See docs/RAVAGE_DESIGN.md §3.10.
export const RAVAGE_THRESHOLD_PCT = 0.5;
// Multipliers applied while ravagedActive is true. +50% outgoing damage,
// armor halved (so they take ~2× damage), +1 effective MOV.
export const RAVAGE_POWER_MULT = 1.5;
export const RAVAGE_ARMOR_MULT = 0.5;
export const RAVAGE_MOVE_BONUS = 1;

export type Unit = UnitDef & { state: UnitState };

export interface TilePos {
  x: number;
  y: number;
}

export type TerrainKind =
  // Core 8 — the original procedural set
  | "grass"
  | "stone"
  | "dirt"
  | "wood"
  | "water"
  | "carpet"
  | "snow"
  | "mud"
  // Main asset set — real PNGs in public/assets/tiles/
  | "marble"
  | "sand"
  | "forest"
  | "wall"
  | "door"
  | "rubble"
  // Bonus asset set — additional environment variety
  | "cobblestone"
  | "cracked_earth"
  | "ice"
  | "lava"
  | "moss_stone";

export type ObstacleKind =
  | "none"
  | "hay"
  | "fence"
  | "wagon"
  | "barricade"
  | "pillar"
  | "throne"
  | "tree"
  | "rock"
  | "torch";

export interface Tile {
  pos: TilePos;
  terrain: TerrainKind;
  obstacle: ObstacleKind;
  defendBonus: number; // Extra defender mod (e.g. fence = 0.85x damage taken)
  blocksMovement: boolean;
  blocksLineOfSight: boolean;
  hitPenalty: number; // Subtracted from attacker's hit rate when defender stands here.
}

export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  // Row-major tile data: width*height entries.
  tiles: ReadonlyArray<{
    terrain: TerrainKind;
    obstacle?: ObstacleKind;
    // PRESENTATION-ONLY height in levels for the ¾ diorama view. Combat
    // never reads it — Grid builds tiles from terrain + obstacle alone —
    // so raising a plateau can't change a single rule. Omitted → the
    // terrain's default (see scenes/battle/Diorama.ts elevationFor).
    elev?: number;
  }>;
  ambientPalette?: { sky: number; ground: number; tint: number };
  startPositions: { player: TilePos[]; enemy: TilePos[]; ally?: TilePos[] };
}

export interface AttackPreview {
  damage: number;
  hitRate: number;
  critRate: number;
  weaponMod: number;
  terrainMod: number;
  stanceMod: number;
}

export interface AttackResult {
  hit: boolean;
  crit: boolean;
  damage: number;
  attackerId: string;
  defenderId: string;
  defenderRemainingHp: number;
  defenderKilled: boolean;
  counterTriggered: boolean;
  counterResult?: AttackResult;
  // A counter rolled but not yet applied (resolveAttack's deferCounter):
  // the animated exchange applies it on the counter's own swing.
  counterRoll?: { hit: boolean; crit: boolean; damage: number };
  // Destruct ability: defender's death also killed the attacker.
  destructTriggered?: boolean;
  attackerKilled?: boolean;
}
