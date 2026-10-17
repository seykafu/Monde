import type { PersonaCard } from "./persona";
import { isBirthday } from "./economy";
import {
  FRIEND_AFFINITY, ROMANCE_STAGES, ROMANTIC_FEELINGS, pairKey, type RomanceStage,
} from "./friendship";

/**
 * The romance ladder to Courting, and birthdays (GDD §9.11.3 "Feelings and the ladder" and "Life events", §12.3
 * latent romances; MVP G-12). The model judges how a moment lands (its reflection and encounter feeling deltas, kept
 * to who may court by friendship.ts romanceEligibility); these rules own the thresholds, the engine's own growth of a
 * feeling from time together, who starts courting on a night, and the café date that follows. The server's night
 * pass runs them (server/src/mind/romance.ts). Pure: no I/O, no randomness.
 *
 * Romance stays at the §9.13 limits: only between residents, hand-holding, walks and a café date. The Fellow is never
 * a resident, so never a candidate (D13).
 *
 * GDD-GAP: Quiet Mode (§9.14) has no night pass, so the town's ties, and the ladder with them, hold still offline (the
 * client shows the ties it last knew); the next online night picks up from the memories the client uploads.
 */

// ---------------------------------------------------------------------------------------------------------------
// The ladder (§9.11.3)
// ---------------------------------------------------------------------------------------------------------------

/**
 * §9.11.3 thresholds. Crush: affinity ≥ 60 and a `crush` feeling ≥ 40. Courting: both ≥ 70 affinity, 5+ shared
 * encounters.
 * GDD-GAP: a ladder is climbed in order, so Courting also needs both sides at Crush (§12.3: "each has recorded the other
 * as more than a neighbor"); otherwise every pair of Close friends would court. §12.3 says the dating flag sets once
 * both pass 60; the engine table (§9.11.3) says 70, and the engine uses it.
 */
export const ROMANCE_LADDER = {
  crush: { affinity: 60, feeling: 40 },
  courting: { affinity: 70, encounters: 5 },
} as const;

/** The parts of one directed relationship row (from → to) the ladder reads. */
export interface LadderEdge {
  affinity: number;
  feelingKind: string | null;
  feelingIntensity: number;
  /** Encounters the pair has had (relationships.encounters, counted on both rows). */
  encounters: number;
  tag: string;
}

/** The intensity of a romantic feeling (crush or love) on this edge, else 0. */
export const romanticIntensity = (edge: Pick<LadderEdge, "feelingKind" | "feelingIntensity">): number =>
  edge.feelingKind !== null && ROMANTIC_FEELINGS.has(edge.feelingKind) ? Math.max(0, edge.feelingIntensity) : 0;

/**
 * §9.11.3 Crush, one way round: affinity ≥ 60 and a crush feeling ≥ 40.
 * GDD-GAP: a `love` feeling is more than a crush, so it counts too.
 */
export const hasCrush = (edge: Pick<LadderEdge, "affinity" | "feelingKind" | "feelingIntensity">): boolean =>
  edge.affinity >= ROMANCE_LADDER.crush.affinity && romanticIntensity(edge) >= ROMANCE_LADDER.crush.feeling;

/** Why a pair isn't ready to court yet, the first rule that holds them back. */
export type CourtingBlock = "no_crush" | "affinity" | "encounters";

/**
 * §9.11.3 Courting for a pair, from its two directed rows (a → b, b → a): both at Crush, both ≥ 70 affinity, and 5+
 * shared encounters. Who may court whom (adults, not family, not spoken for) is romanceEligibility's, checked first.
 * GDD-GAP: "shared encounters" is the pair's count on the fewer of the two rows (they move together).
 */
export function courtingCheck(ab: LadderEdge, ba: LadderEdge): { ok: true } | { ok: false; reason: CourtingBlock } {
  if (!hasCrush(ab) || !hasCrush(ba)) return { ok: false, reason: "no_crush" };
  if (ab.affinity < ROMANCE_LADDER.courting.affinity || ba.affinity < ROMANCE_LADDER.courting.affinity) return { ok: false, reason: "affinity" };
  if (Math.min(ab.encounters, ba.encounters) < ROMANCE_LADDER.courting.encounters) return { ok: false, reason: "encounters" };
  return { ok: true };
}
export const courtingReady = (ab: LadderEdge, ba: LadderEdge): boolean => courtingCheck(ab, ba).ok;

/** A pair ready to court tonight, with its mean affinity (which decides between two suitors). */
export interface Courtship { a: string; b: string; mean: number }

/**
 * Who starts courting tonight: every ready pair, but a resident courts one person, so where two ready pairs share a
 * resident the warmer pair goes first (higher mean affinity, then the pair key), and the other waits; the next night
 * it's no longer eligible (romanceEligibility "taken").
 */
export function pickCourtships(ready: readonly Courtship[]): Courtship[] {
  const taken = new Set<string>();
  const out: Courtship[] = [];
  const order = [...ready].sort((x, y) => y.mean - x.mean || (pairKey(x.a, x.b) < pairKey(y.a, y.b) ? -1 : 1));
  for (const c of order) {
    if (c.a === c.b || taken.has(c.a) || taken.has(c.b)) continue;
    taken.add(c.a);
    taken.add(c.b);
    out.push(c);
  }
  return out;
}

/** The ladder stage a stage flag names is at least `stage` (courting < together < married). */
export const atLeast = (have: RomanceStage | null, stage: RomanceStage): boolean =>
  have !== null && ROMANCE_STAGES.indexOf(have) >= ROMANCE_STAGES.indexOf(stage);

// ---------------------------------------------------------------------------------------------------------------
// Feelings from time together (§9.11.3 "Feelings between residents grow from affinity, time together and the model's
// reflection deltas")
// ---------------------------------------------------------------------------------------------------------------

/**
 * Relationship tags that seed a romance: §12.3's latent romances are tagged `spark` on both cards ("seeded so they
 * can bloom").
 */
export const ROMANCE_SEED_TAGS: ReadonlySet<string> = new Set(["spark"]);

/** This side has something to grow: a seeded tie, or a romantic feeling the model has already recorded. */
export const romanceSeeded = (edge: Pick<LadderEdge, "tag" | "feelingKind" | "feelingIntensity">): boolean =>
  ROMANCE_SEED_TAGS.has(edge.tag.toLowerCase()) || romanticIntensity(edge) > 0;

/**
 * GDD-GAP: §9.11.3 gives no numbers for how feelings grow by rule. The engine's part: after an encounter, a side whose
 * tie is seeded (or already romantic) and who counts the other a friend (affinity ≥ 40) gains 5 crush when the
 * encounter warmed them and loses 5 when it cooled them. The model's deltas (reflection ±15, encounter ±10, §9.10)
 * are what start a feeling between residents nobody seeded, and they add to this.
 */
export const ROMANCE_GROWTH = { step: 5, minAffinity: FRIEND_AFFINITY } as const;

/**
 * The engine's feeling change for one side of tonight's encounter, or null. `change` is the affinity the encounter
 * applied to this side (its memory's valence); `eligible` is romanceEligibility for the pair, so a crush never grows
 * between residents who may not court. Grows `love` if that's what they feel, else `crush`.
 */
export function romanceGrowth(edge: LadderEdge, change: number, eligible: boolean): { kind: "crush" | "love"; delta: number } | null {
  if (!eligible || !romanceSeeded(edge) || !Number.isFinite(change) || change === 0) return null;
  const kind = edge.feelingKind === "love" ? "love" : "crush";
  if (change > 0) return edge.affinity >= ROMANCE_GROWTH.minAffinity ? { kind, delta: ROMANCE_GROWTH.step } : null;
  return romanticIntensity(edge) > 0 ? { kind, delta: -ROMANCE_GROWTH.step } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// What Courting brings (§9.11.3 "A café date (a scheduled event), walking together"; §12.3, §13 flags)
// ---------------------------------------------------------------------------------------------------------------

/** §12.3, §13.6: the seeded romances' story flags, set when the pair reaches Courting ("Agent system"). */
export const SEEDED_ROMANCES: readonly { a: string; b: string; flag: string }[] = [
  { a: "kasimir", b: "priya", flag: "kasimir_priya_dating" },
  { a: "ines", b: "teo", flag: "teo_ines_dating" },
  { a: "augusta", b: "rosalind", flag: "augusta_roz_dating" },
];

/** The story flag a pair's courting sets, or null for a pair nobody seeded. */
export function datingFlag(a: string, b: string): string | null {
  const key = pairKey(a, b);
  return SEEDED_ROMANCES.find((r) => pairKey(r.a, r.b) === key)?.flag ?? null;
}

/** The dating flags the town's ties call for: every seeded pair that is courting or further. */
export function datingFlags(pairs: readonly { a: string; b: string; romance: RomanceStage | null }[]): string[] {
  const flags = new Set<string>();
  for (const p of pairs) {
    const flag = p.romance && atLeast(p.romance, "courting") ? datingFlag(p.a, p.b) : null;
    if (flag) flags.add(flag);
  }
  return [...flags].sort();
}

/**
 * The café date Courting schedules (§9.11.3, a scheduled event; §9.13: a date at the café).
 * GDD-GAP: no day or hour is given. It's two days after the night they start courting (the next night's plans can see
 * it: tonight's are already made), at 15:00 for an hour at Café Liss, and it counts as planned time together.
 */
export const CAFE_DATE = { place: "market_row.cafe_liss", daysAfter: 2, minute: 15 * 60, minutes: 60 } as const;

/** GDD-GAP: §9.6 has no importance for these. A courtship is news a resident keeps (6); the date is an outing (3). */
export const ROMANCE_IMPORTANCE = { courting: 6, date: 3 } as const;

/** TownEvent ids (deterministic, so a repeat writes nothing new). */
export const courtingEventId = (a: string, b: string): string => `courting_${pairKey(a, b)}`;
export const dateEventId = (a: string, b: string, day: number): string => `date_${pairKey(a, b)}_${day}`;
export const courtingMemoryId = (a: string, b: string, self: string): string => `courting_${pairKey(a, b)}_${self}`;

/** The Lantern's notice, the town event's summary (engine-written, never the model's). */
export const courtingNotice = (aName: string, bName: string): string => `${aName} and ${bName} are courting.`;
export const dateSummary = (aName: string, bName: string): string => `${aName} and ${bName} meet for tea at Café Liss.`;
/** What each of them remembers (first person, §9.6). */
export const courtingMemoryText = (otherName: string): string => `${otherName} and I are courting now. We'll take tea at Café Liss.`;

// ---------------------------------------------------------------------------------------------------------------
// Birthdays (§9.11.3 "Life events": every resident has one; a party if they have 3+ friends; §9.11.2 gifts ×2)
// ---------------------------------------------------------------------------------------------------------------

export type BirthdayCard = Pick<PersonaCard, "id" | "name" | "birthday">;

/** Whose birthday it is on `day` (the 100-day calendar repeats, §3.2), in the order given. */
export const birthdaysOn = <C extends BirthdayCard>(cards: readonly C[], day: number): C[] =>
  cards.filter((c) => isBirthday(day, c.birthday));

/** GDD-GAP: §6.6 lists the Notices without a birthday line. The Lantern prints one line naming everyone. */
export function birthdayNotice(cards: readonly BirthdayCard[], day: number): string | null {
  const names = birthdaysOn(cards, day).map((c) => c.name);
  if (!names.length) return null;
  const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names.at(-1)!}`;
  return `Many happy returns today to ${list}.`;
}

/**
 * §9.11.3: a party if they have 3+ friends ("Friends": the pair's mean affinity ≥ 40, §9.11.3, §6.4).
 * GDD-GAP: no hour or place. 18:00 for two hours at their home; their friends are the guests, and it counts as planned
 * time together with each of them.
 */
export const BIRTHDAY_PARTY = { friends: 3, minute: 18 * 60, minutes: 120, importance: 4 } as const;
export const partyEventId = (id: string, day: number): string => `birthday_party_${id}_${day}`;
export const partySummary = (name: string): string => `A birthday party for ${name}.`;
export const throwsParty = (friends: number): boolean => friends >= BIRTHDAY_PARTY.friends;
