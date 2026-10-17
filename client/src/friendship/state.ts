import { expireFavor } from "@monde/shared";
// What the client knows of friendship (GDD §9.11; MVP G-13 client). Pure: no Phaser, no DOM.
//
// Regard lives on the server (§9.4); the client mirrors it per resident so the hearts can show, also in Quiet Mode:
// each turn's applied Regard, and the whole town's Regard from every events reply and dawn package (M-06), which
// replaces the mirror. Before the server has said anything the mirror starts from the Background's starting Regard
// (§11.1: a Homecomer's six old neighbours) or 0. Quiet Mode turns earn nothing: the server judges replies and owns
// the caps, so the client never invents a gain offline. Scripted Regard ({regard} cues) still waiting in the event
// log is added on top where the mirror is read (scenes/friendship.ts regardFor), until the server acknowledges it.
//
// The dawn package brings the town's ties and last night's milestones, the letters and Favors, and the model plans;
// applyDawn folds them in. Every function returns a new state (the registry keeps one and replaces it).
import {
  BACKGROUND_STARTS, emptyFriendship, orderedPair, pairKey, pairLabel, type Background, type DawnFavorData,
  type DawnLetterData, type PersonaCard, type PlanOutput, type SavedBond, type SavedFriendship, type TieData,
  type TieMilestoneData, type TurnRegard
} from '@monde/shared';
import type { DawnPackage } from '../mind/dawn';
import { learnTies, tieIndex } from './knownTies';
import { crushNews, printedMilestones, romanceNews, dawnLines, type CrushNews, type RomanceNews } from './milestones';

export type FriendshipState = SavedFriendship;
export { emptyFriendship };

/**
 * GDD-GAP: §6.6 doesn't say how long milestones stay on record. The client keeps two weeks of them (the Dawn
 * Report reads the latest night's; the People page reads the labels, not this list).
 */
export const MILESTONE_DAYS = 14;
/** GDD-GAP: letters wait for the Letters tab (§18); the client keeps the 60 most recent. */
export const LETTERS_KEPT = 60;

// ── Regard ──────────────────────────────────────────────────────────────────

/** The Regard the client assumes before the server reports any (§11.1 Background starts). */
export function seedRegard(background: Background | null | undefined, residentId: string): number {
  return background ? BACKGROUND_STARTS[background]?.regard[residentId] ?? 0 : 0;
}

/** The mirrored Regard toward the player: the server's last word, else the bond's, else the seed. */
export const regardOf = (state: FriendshipState, id: string, seed = 0): number => state.regard?.[id] ?? state.residents[id]?.regard ?? seed;

const clampRegard = (v: number): number => Math.max(-100, Math.min(100, v));

/**
 * The server's Regard for the whole town (the events reply, the dawn package, the night's ingestion): it replaces the
 * mirror for every resident it names, met or not. Returns the same state when nothing changed.
 */
export function applyRegardSnapshot(state: FriendshipState, snapshot: Readonly<Record<string, number>> | null | undefined): FriendshipState {
  if (!snapshot) return state;
  const entries = Object.entries(snapshot).filter(([, v]) => Number.isFinite(v)).map(([id, v]) => [id, clampRegard(v)] as const);
  const before = state.regard ?? {};
  if (entries.every(([id, v]) => before[id] === v && (!state.residents[id] || (state.residents[id]!.regard === v && state.residents[id]!.source === 'server')))) return state;
  const residents = { ...state.residents };
  for (const [id, v] of entries) if (residents[id]) residents[id] = { ...residents[id]!, regard: v, source: 'server' };
  return { ...state, residents, regard: { ...before, ...Object.fromEntries(entries) } };
}

/** The player spoke with a resident on `day`: they're met from now on. */
export function meet(state: FriendshipState, id: string, day: number, seed = 0): FriendshipState {
  const bond = state.residents[id];
  const next: SavedBond = bond
    ? { ...bond, last_talk_day: Math.max(bond.last_talk_day, day) }
    : state.regard?.[id] !== undefined
      ? { regard: state.regard[id]!, source: 'server', met_day: day, last_talk_day: day, likes: [] }
      : { regard: seed, source: 'seed', met_day: day, last_talk_day: day, likes: [] };
  return { ...state, residents: { ...state.residents, [id]: next } };
}

/**
 * One turn on `day`: a server turn's applied Regard replaces the mirror; a Quiet Mode turn (no Regard) changes
 * nothing but the talk day.
 */
export function recordTurn(state: FriendshipState, id: string, day: number, regard: TurnRegard | null | undefined, seed = 0): FriendshipState {
  const met = meet(state, id, day, seed);
  if (!regard || !Number.isFinite(regard.after)) return met;
  const bond = met.residents[id]!;
  const value = clampRegard(regard.after);
  return { ...met, residents: { ...met.residents, [id]: { ...bond, regard: value, source: 'server' } }, regard: { ...met.regard, [id]: value } };
}

/** Residents the player has met, in the order they were met (then by id). */
export const metResidents = (state: FriendshipState): string[] =>
  Object.entries(state.residents).sort(([a, x], [b, y]) => x.met_day - y.met_day || (a < b ? -1 : 1)).map(([id]) => id);

// ── Ties ────────────────────────────────────────────────────────────────────

export type TieCard = Pick<PersonaCard, 'id' | 'relationships'>;

/**
 * The Day-1 ties from the cards' relationships (§12.3), labelled by the same rule as the server's (§9.11.3). The
 * server seeds its relationships from these cards, so before the first online dawn (and in Quiet Mode, which never
 * has one) this is the town as it stood on Day 1.
 */
export function cardTies(cards: readonly TieCard[]): TieData[] {
  const ids = new Set(cards.map(c => c.id));
  const affinity = new Map<string, number>();
  const pairs = new Map<string, [string, string]>();
  for (const c of cards) for (const r of c.relationships) {
    if (r.id === c.id || !ids.has(r.id)) continue;
    affinity.set(`${c.id}>${r.id}`, r.affinity);
    pairs.set(pairKey(c.id, r.id), orderedPair(c.id, r.id));
  }
  const out: TieData[] = [];
  for (const [, [a, b]] of [...pairs].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const label = pairLabel(affinity.get(`${a}>${b}`), affinity.get(`${b}>${a}`));
    if (label !== 'strangers') out.push({ a, b, label, romance: null });
  }
  return out;
}

/** The ties as the client knows them now: the last dawn's, else Day 1's from the cards. */
export const currentTies = (state: FriendshipState, cards: readonly TieCard[]): TieData[] => state.ties?.pairs ?? cardTies(cards);

// ── The dawn ────────────────────────────────────────────────────────────────

export interface DawnApplied {
  state: FriendshipState;
  /** The friendship lines for this morning's summary (Dawn Report, §6.6). */
  lines: string[];
  printed: TieMilestoneData[];
  romance: RomanceNews[];
  /** Crushes noticed since the last dawn (G-12). */
  crushes: CrushNews[];
}

const byId = <T extends { id: string }>(xs: readonly T[]): T[] => [...new Map(xs.map(x => [x.id, x])).values()];

/**
 * Fold a dawn package in: the ties and their milestones, the tiers, the model plans that were applied, the letters
 * (each once) and the open Favors. The milestones the Dawn Report prints (and any romance news) become known ties:
 * the player read them this morning.
 */
export function applyDawn(state: FriendshipState, pkg: DawnPackage, opts: { names: Readonly<Record<string, string>>; plans: Readonly<Record<string, PlanOutput>> }): DawnApplied {
  const day = pkg.day;
  const tiers = Object.fromEntries(pkg.plans.map(p => [p.resident_id, p.tier]));
  const printed = printedMilestones(pkg.ties.milestones, tiers);
  const romance = state.ties ? romanceNews(state.ties.pairs, pkg.ties.pairs) : [];
  const crushes = state.ties ? crushNews(state.ties.pairs, pkg.ties.pairs, tiers) : [];
  const lines = dawnLines(printed, romance, opts.names, crushes);
  const milestones = [...state.milestones.filter(m => !pkg.ties.milestones.some(n => n.day === m.day && pairKey(n.a, n.b) === pairKey(m.a, m.b))), ...pkg.ties.milestones]
    .filter(m => m.day > day - MILESTONE_DAYS);
  const letters: DawnLetterData[] = byId([...state.letters, ...pkg.letters]).slice(-LETTERS_KEPT);
  const favors: DawnFavorData[] = byId([...state.favors, ...pkg.favors]).filter(f => f.expires_day >= day);
  let next: FriendshipState = applyRegardSnapshot({
    ...state, favor_book: byId([...state.favor_book, ...pkg.favors.flatMap(f => f.contract && !state.favor_book.some(old => old.id === f.id) ? [f.contract] : [])]).map(f => expireFavor(f, day)),
    papers: pkg.press ? [...state.papers.filter(p => p.day !== day), pkg.press] : state.papers, ties: { day, pairs: pkg.ties.pairs }, milestones, tiers, plans: { day, plans: { ...opts.plans } }, letters, favors,
    report: { day, lines }
  }, pkg.regard);
  const index = tieIndex(pkg.ties.pairs);
  next = learnTies(next, [...printed.map(m => [m.a, m.b] as const), ...romance.map(r => [r.a, r.b] as const), ...crushes.map(c => [c.a, c.b] as const)], day, 'read', index);
  return { state: next, lines, printed, romance, crushes };
}

/** §6.5 targets Nell and current fishers' Regard toward Pell, never their Regard toward the Fellow. */
export function applyOptionRegard(state: FriendshipState, cards: readonly Pick<PersonaCard, 'id' | 'occupation'>[]): FriendshipState {
  if (state.option_regard_applied) return state;
  const regard = { ...state.resident_regard };
  for (const c of cards) {
    if (c.id !== 'nell' && !/\b(fisher|fisherman|fisherwoman)\b/i.test(c.occupation.replace(/former[^;]*/gi, ''))) continue;
    // GDD-GAP: §6.5 names the Wary tier, not a score; use its nearest boundary (-1), preserving worse Regard.
    regard[c.id] = { ...regard[c.id], pell: Math.min(-1, regard[c.id]?.pell ?? 0) };
  }
  return { ...state, resident_regard: regard, option_regard_applied: true };
}
