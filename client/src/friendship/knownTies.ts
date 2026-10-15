// Ties the player has learned (GDD §9.11.3 "What the player sees"; MVP G-13 client). Pure: no Phaser, no DOM.
//
// The People page lists a resident's ties only once the player knows them: the pair was seen together on screen,
// one of them named the other in conversation, or a Dawn Report milestone printed it. A tie is the pair, not its
// label: once known, the page shows whatever the label is now.
import { PAIR_EMOTES, orderedPair, pairKey, type PairEmote, type PersonaCard, type TieData, type TieSource } from '@monde/shared';
import type { FriendshipState } from './state';

export interface KnownTie {
  other: string;
  label: TieData['label'];
  romance: TieData['romance'];
  how: TieSource;
  day: number;
}

/** Ties by pair key. */
export const tieIndex = (pairs: readonly TieData[]): Map<string, TieData> => new Map(pairs.map(t => [pairKey(t.a, t.b), t]));

/**
 * Learn every pair in `pairs` that has a tie and isn't known yet. Returns the same state object when nothing new
 * was learned, so callers can skip the write.
 */
export function learnTies(state: FriendshipState, pairs: readonly (readonly [string, string])[], day: number, how: TieSource,
  ties: ReadonlyMap<string, TieData>): FriendshipState {
  let known: FriendshipState['known_ties'] | null = null;
  for (const [a, b] of pairs) {
    if (a === b) continue;
    const key = pairKey(a, b);
    if (!ties.has(key) || state.known_ties[key] || known?.[key]) continue;
    known ??= { ...state.known_ties };
    known[key] = { day, how };
  }
  return known ? { ...state, known_ties: known } : state;
}

const WARMTH: Readonly<Record<TieData['label'], number>> = { close_friends: 0, friends: 1, acquaintances: 2, rivals: 3, enemies: 4 };

/** A resident's known ties: sweethearts first, then warmest to coldest, then by the other's id. */
export function knownTiesOf(state: FriendshipState, id: string, ties: ReadonlyMap<string, TieData>): KnownTie[] {
  const out: KnownTie[] = [];
  for (const [key, learned] of Object.entries(state.known_ties)) {
    const tie = ties.get(key);
    if (!tie || (tie.a !== id && tie.b !== id)) continue;
    out.push({ other: tie.a === id ? tie.b : tie.a, label: tie.label, romance: tie.romance, how: learned.how, day: learned.day });
  }
  return out.sort((x, y) => Number(!x.romance) - Number(!y.romance) || WARMTH[x.label] - WARMTH[y.label] || (x.other < y.other ? -1 : 1));
}

/** The emote a pair shows when they meet (§9.11.3, §16): a ♥ for sweethearts, else their label's. */
export const pairEmote = (tie: Pick<TieData, 'label' | 'romance'>): PairEmote | null =>
  tie.romance ? PAIR_EMOTES.close_friends : PAIR_EMOTES[tie.label];

// ── Hearing about a tie ─────────────────────────────────────────────────────

const TITLES: ReadonlySet<string> = new Set(['captain', 'mayor', 'doctor', 'dr', 'mr', 'mrs', 'miss', 'ms', 'old', 'father', 'mother', 'sister', 'brother']);
const words = (s: string): string[] => s.replace(/"/g, ' ').split(/\s+/).filter(Boolean);

export type NameCard = Pick<PersonaCard, 'id' | 'name'>;

/**
 * What the town calls a resident in a line: the quoted nickname ("June"), the surname when the card's id is the
 * surname (Pell, Vane), a title and surname (Captain Reyes), else the first name.
 */
export function townName(card: NameCard): string {
  const nick = /"([^"]+)"/.exec(card.name)?.[1];
  if (nick) return nick;
  const ws = words(card.name);
  const last = ws.at(-1) ?? card.name;
  if (ws.length > 1 && last.toLowerCase() === card.id) return last;
  if (ws.length > 2 && TITLES.has(ws[0]!.toLowerCase())) return `${ws[0]} ${last}`;
  return ws[0] ?? card.name;
}

export interface NameIndex { tokens: readonly { id: string; token: string; re: RegExp }[] }

/**
 * The words that name each resident in a line: every word of their name and nickname but titles, three letters or
 * more. A word two cards share (the Mercers, the Okafors) names neither.
 */
export function nameIndex(cards: readonly NameCard[]): NameIndex {
  const owners = new Map<string, Set<string>>();
  for (const c of cards) {
    for (const w of words(c.name)) {
      if (w.length < 3 || TITLES.has(w.toLowerCase())) continue;
      let set = owners.get(w);
      if (!set) { set = new Set(); owners.set(w, set); }
      set.add(c.id);
    }
  }
  const tokens = [...owners].filter(([, ids]) => ids.size === 1).map(([token, ids]) => ({
    id: [...ids][0]!, token, re: new RegExp(`(?<![\\p{L}\\p{N}])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u')
  }));
  return { tokens };
}

/**
 * Residents a line names (heuristic, §9.11.3 "heard it in a line"): a capitalised name word on its own, possessive
 * included ("Odile's rye"). The speaker naming themself doesn't count.
 */
export function namedIn(text: string, index: NameIndex, speaker?: string): string[] {
  const found = new Set<string>();
  for (const t of index.tokens) if (t.id !== speaker && !found.has(t.id) && t.re.test(text)) found.add(t.id);
  return [...found];
}

/** The pairs a resident's lines reveal: the speaker with everyone they named. */
export const heardPairs = (lines: readonly string[], speaker: string, index: NameIndex): [string, string][] =>
  [...new Set(lines.flatMap(l => namedIn(l, index, speaker)))].map(other => orderedPair(speaker, other));
