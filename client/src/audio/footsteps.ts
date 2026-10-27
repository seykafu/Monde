// Footsteps: which sound a foot makes on the ground it lands on, and how each step varies (pure; unit-tested).
//
// The walk animator (render/character/anim.ts) reports a footfall on each contact pose; scenes/zone/footsteps.ts
// looks up the tile under the feet and plays the step through Sfx.ts. Every step gets a little pitch and level
// drift, and the two feet sit a touch apart in pitch, so a walk never sounds like one sample machine-gunned.
// Residents' steps are quieter and fade with distance from the player. Pure: no Phaser, no DOM.

import type { TerrainKind } from '../combat/types';
import type { TownTerrain } from '../world/townTerrain';

/** The step sounds (Sfx.ts `footstep_<surface>`). */
export type StepSurface = 'cobble' | 'boards' | 'grass' | 'soft' | 'gravel';

/** Town ground (zone format v2) to step sound. Water and walls can't be stood on: no sound. */
export const TOWN_STEP: Readonly<Record<TownTerrain, StepSurface | null>> = {
  cobble: 'cobble', brick: 'cobble', plaza: 'cobble', steps: 'cobble', weedy: 'cobble', flags: 'cobble', tile: 'cobble',
  boards: 'boards', floor: 'boards',
  grass: 'grass', meadow: 'grass',
  sand: 'soft', wet_sand: 'soft', road: 'soft', soil: 'soft', rug: 'soft',
  shingle: 'gravel', gravel: 'gravel',
  sea: null, river: null, pond: null, shallows: null, wall: null
};

/** The greybox's combat terrains (zone format v1), for boards without a town ground. */
const LEGACY_STEP: Partial<Record<TerrainKind, StepSurface>> = {
  wood: 'boards', carpet: 'soft', grass: 'grass', forest: 'grass', dirt: 'soft', mud: 'soft', sand: 'soft',
  snow: 'soft', cracked_earth: 'soft', rubble: 'gravel'
};

/** The step sound for a tile (its town kind if it has one), or null where nobody stands. */
export function stepSurface(tile: { kind?: TownTerrain; terrain: TerrainKind } | undefined): StepSurface | null {
  if (!tile) return null;
  if (tile.kind) return TOWN_STEP[tile.kind];
  if (tile.terrain === 'water' || tile.terrain === 'lava' || tile.terrain === 'wall') return null;
  return LEGACY_STEP[tile.terrain] ?? 'cobble';
}

/** Feel (art tuning, not game rules). */
export const STEP_TUNING = {
  /** Each step's pitch drifts by up to ± this share; the left foot sits `footSpread` lower than the right. */
  pitchJitter: 0.06,
  footSpread: 0.04,
  /** Each step's level is this share of full, at random. */
  levelMin: 0.78,
  levelMax: 1,
  /** Residents: at most this loud (beside the player), fading to nothing by `residentRange` tiles away. */
  residentLevel: 0.4,
  residentNear: 1.5,
  residentRange: 7,
  /** At most one resident's step this often (ms), so a crowd stays a patter. */
  residentGapMs: 70
} as const;

export interface StepVoice { pitch: number; level: number }

/** How one step sounds: `foot` from the animator, `rng` in [0, 1), `level` the walker's loudness before variation. */
export function stepVoice(foot: 0 | 1, rng: () => number, level = 1): StepVoice {
  const T = STEP_TUNING;
  const pitch = (foot === 0 ? 1 - T.footSpread / 2 : 1 + T.footSpread / 2) * (1 + (rng() * 2 - 1) * T.pitchJitter);
  return { pitch, level: level * (T.levelMin + rng() * (T.levelMax - T.levelMin)) };
}

/** A resident's steps, `distance` tiles from the player: full resident level up close, eased out to silence at range. */
export function residentStepLevel(distance: number): number {
  const T = STEP_TUNING;
  if (!(distance < T.residentRange)) return 0;
  const t = Math.max(0, (distance - T.residentNear) / (T.residentRange - T.residentNear));
  return T.residentLevel * (1 - t) * (1 - t);
}
