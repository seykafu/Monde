// The player's Fellowship application (GDD §11.1) and what each Background starts with (§11.1, §11.2).
//
// One schema for both sides: the client checks the form against it before sending, and the server
// (server/src/mind/player.ts) validates PATCH /v1/worlds/:w/player with it plus its own word filter, so
// the server stays the authority. Only the fields residents can know about live in the profile; the
// look (build, hair…) is client-only (look.ts). Pure: no Phaser, no DOM.
import { z } from "zod";

export const BACKGROUNDS = ["homecomer", "tinkerer", "scrapper", "organizer"] as const;
export type Background = (typeof BACKGROUNDS)[number];

/**
 * "Why Monde?" (§11.1): a fresh start · to help · running from something · curious. The ids are the ones
 * story scripts test (`player.why`, §13.3: fresh_start, to_help, running, curious).
 */
export const WHY_MONDE = ["fresh_start", "to_help", "running", "curious"] as const;
export type WhyMonde = (typeof WHY_MONDE)[number];
/** Profiles written before the ids matched §13.3 said "running_from_something". */
const LEGACY_WHY: Record<string, WhyMonde> = { running_from_something: "running" };

/** "Something you love" (§11.1): pick from 12. Stored as the words themselves, so prompts read naturally. */
export const LOVES = [
  "rain", "old books", "the sea", "bread", "music", "puzzles",
  "flowers", "the stars", "cats", "boats", "tea", "old clocks",
] as const;
export type Love = (typeof LOVES)[number];

export const PRESET_PRONOUNS = ["she/her", "he/him", "they/them"] as const;
/** Custom pronouns are subject/object/possessive (§11.1), each 1–8 lowercase letters, e.g. "xe/xem/xyr". */
export const CUSTOM_PRONOUN_WORD = /^[a-z]{1,8}$/;
const CUSTOM_PRONOUNS = /^[a-z]{1,8}\/[a-z]{1,8}\/[a-z]{1,8}$/;

/** §11.1: free text, at most 16 characters. */
export const NAME_MAX = 16;

/** The shared name rule: 1–16 characters after trimming, at least one letter, no markup or control characters. */
export const PlayerName = z.string().trim().min(1, "name is empty").max(NAME_MAX, `name is at most ${NAME_MAX} characters`)
  .refine((name) => !/[<>{}\p{Cc}]/u.test(name), "name has characters that aren't allowed")
  .refine((name) => /\p{L}/u.test(name), "name needs a letter");

export const Pronouns = z.string().trim().toLowerCase().refine(
  (p) => (PRESET_PRONOUNS as readonly string[]).includes(p) || CUSTOM_PRONOUNS.test(p),
  "pronouns are she/her, he/him, they/them or subject/object/possessive",
);

export const PlayerProfile = z.object({
  name: PlayerName,
  pronouns: Pronouns,
  background: z.enum(BACKGROUNDS),
  why: z.preprocess((v) => (typeof v === "string" ? LEGACY_WHY[v] ?? v : v), z.enum(WHY_MONDE)),
  loves: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(LOVES)),
}).strict();
export type PlayerProfile = z.infer<typeof PlayerProfile>;

/** Before the form is filled in (and for `?skiptitle=1`): residents call the player "Fellow" (server player.ts). */
export const DEFAULT_PLAYER_PROFILE: PlayerProfile = {
  name: "Fellow", pronouns: "they/them", background: "tinkerer", why: "curious", loves: "tea",
};

// ── The form's name box, in plain words ─────────────────────────────────────

/** Characters the form lets you type: letters (any script), digits, spaces, apostrophes, hyphens and full stops. */
export const NAME_TYPABLE = /^[\p{L}\p{M}\p{Nd} '’.-]$/u;

export type NameCheck = { ok: true; name: string } | { ok: false; problem: string };
/** The client's check, worded for the form. The server adds its word filter on top. */
export function checkName(raw: string): NameCheck {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, problem: "Pell needs something to call you." };
  if ([...name].length > NAME_MAX) return { ok: false, problem: `That won't fit in the box: ${NAME_MAX} letters at most.` };
  if (![...name].every((ch) => NAME_TYPABLE.test(ch))) return { ok: false, problem: "Letters, spaces, hyphens and apostrophes only, please." };
  if (!/\p{L}/u.test(name)) return { ok: false, problem: "A name wants at least one letter in it." };
  const parsed = PlayerName.safeParse(name);
  return parsed.success ? { ok: true, name: parsed.data } : { ok: false, problem: "Pell can't read that. Try another name." };
}

/** The three words of a pronoun set (they/them/their for presets; custom sets give all three). */
export interface PronounSet { subject: string; object: string; possessive: string }
const PRESET_SETS: Record<(typeof PRESET_PRONOUNS)[number], PronounSet> = {
  "she/her": { subject: "she", object: "her", possessive: "her" },
  "he/him": { subject: "he", object: "him", possessive: "his" },
  "they/them": { subject: "they", object: "them", possessive: "their" },
};
export function pronounSet(pronouns: string): PronounSet {
  const p = pronouns.trim().toLowerCase();
  if (p in PRESET_SETS) return PRESET_SETS[p as keyof typeof PRESET_SETS];
  const [subject, object, possessive] = p.split("/");
  return subject && object && possessive ? { subject, object, possessive } : PRESET_SETS["they/them"];
}

/** A custom set's three words checked for the form; null when they make a valid set. */
export function checkCustomPronouns(words: readonly string[]): string | null {
  if (words.length !== 3 || words.some((w) => !CUSTOM_PRONOUN_WORD.test(w.trim().toLowerCase()))) {
    return "Three short words, letters only.";
  }
  return null;
}

// ── Skills (§11.2) and Background starts (§11.1) ────────────────────────────

export const SKILLS = ["handiwork", "wits", "heart", "grit"] as const;
export type SkillId = (typeof SKILLS)[number];
/** §11.2: levels 1–10, raised by doing things. */
export const SkillState = z.object({ level: z.number().int().min(1).max(10), xp: z.number().int().nonnegative() }).strict();
export const Skills = z.object({ handiwork: SkillState, wits: SkillState, heart: SkillState, grit: SkillState }).strict();
export type Skills = z.infer<typeof Skills>;

/** Typed perk data for the systems that will read it (none of them exists yet; see each field). */
export interface BackgroundPerks {
  /** Homecomer: the Elders voting bloc leans this much toward the player. GDD-GAP: no election system yet (§10). */
  electionLean?: { bloc: "elders"; amount: number };
  /** Tinkerer: the player's own VH count this many times toward Projects. GDD-GAP: no Project/VH system yet (§8). */
  vhMultiplier?: number;
  /** Tinkerer: the first puzzle hint is free right away. GDD-GAP: no puzzle hint economy yet (§15). */
  freeFirstHint?: boolean;
  /** Scrapper: Talk Down success chance + this fraction. GDD-GAP: no Scuffle system yet (§7). */
  talkDownBonus?: number;
  /** Scrapper: Tollmen open a Scuffle warier. GDD-GAP: §11.1 doesn't say what "warier" does in numbers. */
  tollmenWarier?: boolean;
  /** Organizer: community work's Pillar effects × (1 + this). GDD-GAP: town engine community work doesn't read it yet (§8). */
  communityWorkBonus?: number;
  /** Organizer: volunteers say yes at this much less Regard. GDD-GAP: no volunteer system yet (§8). */
  volunteerRegardDiscount?: number;
}

export interface BackgroundStart {
  /** Starting Regard by resident id (applied by the server, which owns Regard). */
  regard: Readonly<Record<string, number>>;
  /** Starting skill levels; the rest start at 1. */
  skills: Readonly<Partial<Record<SkillId, number>>>;
  perks: BackgroundPerks;
}

/** §11.1's Background table. */
export const BACKGROUND_STARTS: Readonly<Record<Background, BackgroundStart>> = {
  homecomer: {
    regard: { pell: 20, bertrand: 20, odile: 20, hollis: 20, rosalind: 20, delphine: 20 },
    skills: {},
    perks: { electionLean: { bloc: "elders", amount: 0.05 } },
  },
  tinkerer: { regard: {}, skills: { handiwork: 2 }, perks: { vhMultiplier: 1.5, freeFirstHint: true } },
  // "Grit 2, +5 Grit": the +5 is read as Grit L2's own perk (§11.2 "L2 +5 Grit"), not a second bonus.
  scrapper: { regard: {}, skills: { grit: 2 }, perks: { talkDownBonus: 0.1, tollmenWarier: true } },
  organizer: { regard: {}, skills: { heart: 2 }, perks: { communityWorkBonus: 0.25, volunteerRegardDiscount: 10 } },
};

/** Every skill at level 1 (what a save from before the form, or a profile-less game, starts with). */
export function baseSkills(): Skills {
  return { handiwork: { level: 1, xp: 0 }, wits: { level: 1, xp: 0 }, heart: { level: 1, xp: 0 }, grit: { level: 1, xp: 0 } };
}

/** The skills a Background starts with (§11.1 over §11.2's level 1). */
export function startingSkills(background: Background): Skills {
  const skills = baseSkills();
  for (const [id, level] of Object.entries(BACKGROUND_STARTS[background].skills) as [SkillId, number][]) skills[id] = { level, xp: 0 };
  return skills;
}

/**
 * Starting Regard to apply when a profile is saved: only when the Background becomes Homecomer (so re-sending
 * the same profile, or renaming, never re-applies it), and only as a floor (Regard already above it stays).
 */
export function regardStartsFor(before: Pick<PlayerProfile, "background"> | null | undefined, after: Pick<PlayerProfile, "background">): Readonly<Record<string, number>> {
  if (before?.background === after.background) return {};
  return BACKGROUND_STARTS[after.background].regard;
}
