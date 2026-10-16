// Indoors (MVP W-03): how a room is lit for the clock, and which doors are locked. Pure except for reading the registry.
import type { WeatherNow } from '../../sim/weather';
import type { DoorLink } from '../../world/interiors';
import type { SavedRiddles } from '@monde/shared';
import { flagsOf } from '../../projects/runtime';
import type { RegistryLike } from '../../fellow/state';

/** What ZoneScene's light does differently in a room (render/town/InteriorRoom.ts does the windows). */
export interface IndoorLight {
  /** How dark the room is (0..1): lamplit, so never as dark as the street. */
  dark: number;
  /** Lamps, lanterns and fires: a little all day, fully once it's dusk outside. */
  lampLevel: number;
  /** The shadows the lamps throw: none indoors (a lantern on the back wall would throw the furniture across the floor). */
  shadowLevel: number;
  /** How bright a lamp's glow is at full, against the street's 1: softer on a room's pale walls. */
  glow: number;
  /** The night layer's tint indoors: warm, not the street's moonlit blue. */
  nightTint: number;
  /** The room's warm grade (multiply). */
  grade: number;
  /** How grey the sky in the windows is (0..1). */
  grey: number;
}

/**
 * Art tuning, not game rules: a room at full dark is 0.72 as dark as the street (its lamps are lit), its lamps glow at
 * 0.35 by day and come up fully as the street darkens, and it has a warm cast (lamplight and wood) all day.
 */
export const INDOOR = { darkness: 0.72, dayLamps: 0.22, glow: 0.62, nightTint: 0x5d4c66, grade: 0xfff0dc } as const;

export function indoorLight(outdoorDark: number, now: WeatherNow): IndoorLight {
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const grey = now.kind === 'sun' || now.kind === 'wind' ? 0 : now.kind === 'cloud' ? 0.6 * now.intensity : now.intensity;
  const night = clamp((outdoorDark - 0.05) / 0.3);
  return {
    dark: outdoorDark * INDOOR.darkness,
    lampLevel: Math.max(INDOOR.dayLamps, night),
    shadowLevel: 0,
    glow: INDOOR.glow,
    nightTint: INDOOR.nightTint,
    grade: INDOOR.grade,
    grey
  };
}

/** A registry, as far as the doors need one. */
type Reg = RegistryLike;

/**
 * Why a door won't open, or null. A locked door is a doorstep like any other: the place's business happens at it (and
 * its scene, S01c at the cottage's door), and walking into it says why it won't open.
 *
 * - The Lamplighter's Cottage until Pell hands over the keys in S01c (`cottage_keys_given`, §11.5).
 * - No. 9 Market Row. GDD-GAP: §14.5 MR-4 has it opened by knocking twice (Tib appears: "I know a window") or by Pell's
 *   key; until those beats exist, the empty shop opens once the MR-4 Mark has been read (its riddle names the door).
 */
export function doorLocked(registry: Reg, link: Pick<DoorLink, 'district' | 'building'>): string | null {
  if (link.district === 'old_quarter' && link.building === 'lamplighter_cottage' && !flagsOf(registry).has('cottage_keys_given')) {
    return "Locked. Pell has the keys: she said she'd meet you here.";
  }
  if (link.district === 'market_row' && link.building === 'storefront_9') {
    const riddles = registry.get('monde.riddles') as SavedRiddles | undefined;
    if (!riddles?.entries['MR-4']) return 'No. 9 is locked. Through the dusty glass: shapes under sheets, and a smell of old ink.';
  }
  return null;
}
