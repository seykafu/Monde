// The signed Fellowship application in the running game: profile, look and skills, kept in the Phaser
// registry so saves include them (save/runtime.ts) and ZoneScene draws the chosen look. Pure: the registry
// is anything with get/set/remove, so this runs under vitest.

import {
  DEFAULT_PLAYER_PROFILE, baseSkills, pronounSet, startingSkills, BACKGROUND_STARTS,
  type PlayerProfile, type Skills
} from '@monde/shared';
import { DEFAULT_PLAYER_LOOK, type CharacterLook } from '../render/character/look';

export interface RegistryLike {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  remove(key: string): unknown;
}

/** The whole fellow: profile, look and skills. */
export const FELLOW_KEY = 'monde.fellow';
/** The player's CharacterLook (render/characterSprite.ts playerLook reads it). */
export const PLAYER_LOOK_KEY = 'monde.playerLook';
/** The name saves show in their summary (save/runtime.ts). */
export const SAVE_NAME_KEY = 'monde.save.name';

export interface Fellow {
  /** Null before the form is signed: a New Game until S01a's {charcreate} (§11.1), a save made before it, a v1 save. */
  profile: PlayerProfile | null;
  /** Null: the default look. */
  look: CharacterLook | null;
  skills: Skills;
}

/** A just-signed application: the Background's starting skills (§11.1 over §11.2). */
export function signedFellow(profile: PlayerProfile, look: CharacterLook): Fellow {
  return { profile: { ...profile }, look: { ...look }, skills: startingSkills(profile.background) };
}

/** `?skiptitle=1` and any other way into the town without the form: "Fellow", the default look. */
export function defaultFellow(): Fellow {
  return signedFellow(DEFAULT_PLAYER_PROFILE, DEFAULT_PLAYER_LOOK);
}

/**
 * A New Game before Pell hands the form over (§11.1: on the ferry slip in S01a): no profile yet (residents and the
 * story say "Fellow", they/them), the default look, every skill at level 1 until a Background is chosen.
 */
export function unsignedFellow(): Fellow {
  return { profile: null, look: null, skills: baseSkills() };
}

/** The application has been signed (a profile exists). */
export const isSigned = (fellow: Fellow | null | undefined): boolean => !!fellow?.profile;

export function getFellow(registry: RegistryLike): Fellow | null {
  return (registry.get(FELLOW_KEY) as Fellow | undefined) ?? null;
}

export function setFellow(registry: RegistryLike, fellow: Fellow): void {
  registry.set(FELLOW_KEY, fellow);
  if (fellow.look) registry.set(PLAYER_LOOK_KEY, fellow.look);
  else registry.remove(PLAYER_LOOK_KEY);
  if (fellow.profile) registry.set(SAVE_NAME_KEY, fellow.profile.name);
}

export function clearFellow(registry: RegistryLike): void {
  for (const key of [FELLOW_KEY, PLAYER_LOOK_KEY]) registry.remove(key);
}

/**
 * The fellow, setting one first if there's none in the registry: the signed default for `?skiptitle=1` and the demo
 * (`signDefault`, the default), else an unsigned one (a New Game, which signs at S01a's {charcreate}).
 */
export function ensureFellow(registry: RegistryLike, opts: { signDefault?: boolean } = {}): Fellow {
  const have = getFellow(registry);
  if (have) return have;
  const fellow = opts.signDefault === false ? unsignedFellow() : defaultFellow();
  setFellow(registry, fellow);
  return fellow;
}

/** What story scripts read as `player.*` (StoryContext.values.player): §13.3's `player.why`, the Background, the name. */
export function storyPlayer(fellow: Fellow | null): Record<string, string> {
  const profile = fellow?.profile;
  if (!profile) return {};
  const words = pronounSet(profile.pronouns);
  return {
    name: profile.name, pronouns: profile.pronouns, they: words.subject, them: words.object, their: words.possessive,
    background: profile.background, why: profile.why, loves: profile.loves
  };
}

/** The Background's typed perks, for the systems that will read them (none yet: see shared player.ts). */
export const perksOf = (fellow: Fellow | null) => (fellow?.profile ? BACKGROUND_STARTS[fellow.profile.background].perks : {});
