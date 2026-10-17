// The friendship lines of the morning's summary (GDD §9.11.3 "What the player sees", §6.6; MVP G-13 client, read by
// the Dawn Report, M-10). Pure: no Phaser, no DOM.
//
// "The Dawn Report prints milestones: new Friends or Close friends among Core residents, a falling out, a crush
// noticed, Courting, Together." The server records label milestones; Courting, Together and a wedding show as a
// change in a pair's romance stage between two dawns, and a crush as a new id in a tie's `crush` (G-12), which the
// client compares itself.
import { ROMANCE_STAGES, pairKey, type RomanceStage, type TieData, type TieMilestoneData } from '@monde/shared';

export interface RomanceNews { a: string; b: string; stage: RomanceStage }
/** A crush noticed (§9.11.3 ladder, Crush): `who` are the pair's residents newly at Crush toward the other. */
export interface CrushNews { a: string; b: string; who: string[] }

/**
 * The milestones the Dawn Report prints. New Friends and Close friends only between Core residents (a pair whose
 * tiers aren't known counts); falling out (Rivals, Enemies) and making up always.
 * GDD-GAP: §9.11.3 doesn't say whether making up is printed; it's the reverse of a falling out, and §9.11.3's life
 * events list "a reconciliation", so it is. A crush isn't a tie label: crushNews reports it.
 */
export function printedMilestones(milestones: readonly TieMilestoneData[], tiers: Readonly<Record<string, string>>): TieMilestoneData[] {
  const core = (id: string) => tiers[id] === undefined || tiers[id] === 'core';
  return milestones.filter(m => (m.kind === 'became_friends' || m.kind === 'became_close_friends') ? core(m.a) && core(m.b) : true);
}

/** Pairs whose romance moved up a stage between two dawns' ties (§9.11.3 ladder: Courting, Together, married). */
export function romanceNews(before: readonly TieData[], after: readonly TieData[]): RomanceNews[] {
  const was = new Map(before.map(t => [pairKey(t.a, t.b), t.romance]));
  const rank = (s: RomanceStage | null | undefined) => (s ? ROMANCE_STAGES.indexOf(s) : -1);
  return after.filter(t => t.romance && rank(t.romance) > rank(was.get(pairKey(t.a, t.b)))).map(t => ({ a: t.a, b: t.b, stage: t.romance! }));
}

/**
 * Crushes noticed between two dawns: a resident newly at Crush toward the other in a pair that isn't courting yet,
 * between Core residents (a resident whose tier isn't known counts), as for new friendships.
 * GDD-GAP: §9.11.3 doesn't say whose crushes are news; the same Core rule as Friends keeps the town's 200 quiet.
 */
export function crushNews(before: readonly TieData[], after: readonly TieData[], tiers: Readonly<Record<string, string>> = {}): CrushNews[] {
  const was = new Map(before.map(t => [pairKey(t.a, t.b), new Set(t.crush ?? [])]));
  const core = (id: string) => tiers[id] === undefined || tiers[id] === 'core';
  return after.flatMap(t => {
    if (t.romance || !core(t.a) || !core(t.b)) return [];
    const seen = was.get(pairKey(t.a, t.b)) ?? new Set<string>();
    const who = (t.crush ?? []).filter(id => (id === t.a || id === t.b) && !seen.has(id)).sort();
    return who.length ? [{ a: t.a, b: t.b, who }] : [];
  });
}

const MILESTONE_TEXT: Readonly<Record<TieMilestoneData['kind'], (a: string, b: string) => string>> = {
  became_friends: (a, b) => `${a} and ${b} have become friends.`,
  became_close_friends: (a, b) => `${a} and ${b} are close friends now.`,
  became_rivals: (a, b) => `${a} and ${b} have fallen out.`,
  became_enemies: (a, b) => `${a} and ${b} aren't speaking.`,
  made_up: (a, b) => `${a} and ${b} have made up.`
};
const ROMANCE_TEXT: Readonly<Record<RomanceStage, (a: string, b: string) => string>> = {
  courting: (a, b) => `${a} and ${b} are courting.`,
  together: (a, b) => `${a} and ${b} are walking out together.`,
  married: (a, b) => `${a} and ${b} are married.`
};

const nameOf = (names: Readonly<Record<string, string>>, id: string): string => names[id] ?? id;

export const milestoneLine = (m: Pick<TieMilestoneData, 'a' | 'b' | 'kind'>, names: Readonly<Record<string, string>>): string =>
  MILESTONE_TEXT[m.kind](nameOf(names, m.a), nameOf(names, m.b));

export const romanceLine = (r: RomanceNews, names: Readonly<Record<string, string>>): string =>
  ROMANCE_TEXT[r.stage](nameOf(names, r.a), nameOf(names, r.b));

/** "Teo seems sweet on Ines." / "Augusta and Roz seem sweet on each other." */
export function crushLine(c: CrushNews, names: Readonly<Record<string, string>>): string {
  if (c.who.length > 1) return `${nameOf(names, c.a)} and ${nameOf(names, c.b)} seem sweet on each other.`;
  const who = c.who[0]!;
  return `${nameOf(names, who)} seems sweet on ${nameOf(names, who === c.a ? c.b : c.a)}.`;
}

/**
 * This morning's friendship lines: romance first (it's the bigger news), then crushes noticed, then the milestones
 * as the server sent them; a pair whose romance moved up isn't also reported as new Friends or Close friends.
 */
export function dawnLines(printed: readonly TieMilestoneData[], romance: readonly RomanceNews[], names: Readonly<Record<string, string>>, crushes: readonly CrushNews[] = []): string[] {
  const courting = new Set(romance.map(r => pairKey(r.a, r.b)));
  const warmed = (m: TieMilestoneData) => (m.kind === 'became_friends' || m.kind === 'became_close_friends') && courting.has(pairKey(m.a, m.b));
  return [...romance.map(r => romanceLine(r, names)), ...crushes.map(c => crushLine(c, names)), ...printed.filter(m => !warmed(m)).map(m => milestoneLine(m, names))];
}
