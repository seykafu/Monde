// Footsteps on a board: the step sound for the ground under a footfall (audio/footsteps.ts picks it, Sfx.ts makes it).
// ZoneScene plays the player's on each footfall of their walk; the ResidentLayer plays nearby residents' quieter.
// Muted, or with the effects volume at zero, nothing is synthesized.

import { getAudioSettings } from '../../audio/audioSettings';
import { stepSurface, stepVoice } from '../../audio/footsteps';
import { playSfx } from '../../audio/Sfx';
import type { ZoneDef } from '../../world/zoneFormat';

/** One footfall of `foot` at `at` (tiles), at `level` (1: the player's own). */
export function stepAt(zone: ZoneDef, at: { x: number; y: number }, foot: 0 | 1, level = 1): void {
  if (level < 0.01) return;
  const audio = getAudioSettings();
  if (audio.mute || audio.master * audio.sfx <= 0) return;
  const x = Math.floor(at.x), y = Math.floor(at.y);
  const tile = x >= 0 && y >= 0 && x < zone.width && y < zone.height ? zone.tiles[y * zone.width + x] : undefined;
  const surface = stepSurface(tile);
  if (!surface) return;
  playSfx(`footstep_${surface}`, stepVoice(foot, Math.random, level));
}
