import { describe, expect, it } from 'vitest';
import { pairKey, type TieData } from '@monde/shared';
import { heardPairs, knownTiesOf, learnTies, nameIndex, namedIn, pairEmote, tieIndex, townName } from '../knownTies';
import { PAIR_EMOTE_RULES, PairEmoteThrottle, inSight, nearPairs } from '../emotes';
import { emptyFriendship } from '../state';
import { loadCards } from '../../sim/__tests__/content';

const cards = loadCards();
const names = nameIndex(cards);
const tie = (a: string, b: string, label: TieData['label'], romance: TieData['romance'] = null): TieData => ({ a: a < b ? a : b, b: a < b ? b : a, label, romance });
const ties = tieIndex([tie('june', 'odile', 'friends'), tie('hollis', 'odile', 'close_friends'), tie('odile', 'rook', 'rivals'), tie('kasimir', 'priya', 'friends', 'courting')]);

describe('names in lines (§9.11.3 "heard it in a line")', () => {
  it('calls residents what the town does', () => {
    const name = (id: string) => townName(cards.find(c => c.id === id)!);
    expect(['pell', 'june', 'augusta', 'odile', 'moss', 'vane'].map(name)).toEqual(['Pell', 'June', 'Captain Reyes', 'Odile', 'Old Moss', 'Vane']);
  });

  it('finds capitalised names, possessives included, and not the speaker', () => {
    expect(namedIn("Odile's rye is two today.", names)).toEqual(['odile']);
    expect(namedIn("Ask June. Or Hollis, if he's sober.", names, 'pell').sort()).toEqual(['hollis', 'june']);
    expect(namedIn('Moss had the boat out at slack water.', names)).toEqual(['moss']);
    expect(namedIn('I said to Odile, Odile, the oven.', names, 'odile')).toEqual([]);
    // Lower case is a word, not a name; a surname two cards share names neither.
    expect(namedIn('the june light on the moss', names)).toEqual([]);
    expect(namedIn('The Mercer step, every Sunday.', names)).toEqual([]);
    expect(namedIn('Junebug', names)).toEqual([]);
  });

  it('pairs the speaker with everyone their lines name', () => {
    expect(heardPairs(['Hollis takes the heel.', 'June eats like a sparrow.'], 'odile', names)).toEqual([['hollis', 'odile'], ['june', 'odile']]);
  });
});

describe('known ties', () => {
  it('learns only pairs that have a tie, once, keeping the first way it was learned', () => {
    const s0 = emptyFriendship();
    expect(learnTies(s0, [['pell', 'tib']], 3, 'heard', ties)).toBe(s0);
    const s1 = learnTies(s0, [['odile', 'june'], ['rook', 'odile']], 3, 'seen', ties);
    expect(s1.known_ties).toEqual({ [pairKey('june', 'odile')]: { day: 3, how: 'seen' }, [pairKey('odile', 'rook')]: { day: 3, how: 'seen' } });
    expect(learnTies(s1, [['june', 'odile']], 5, 'read', ties)).toBe(s1);
  });

  it('lists a resident\'s known ties, sweethearts then warmest first, with today\'s label', () => {
    let s = learnTies(emptyFriendship(), [['odile', 'june'], ['odile', 'rook'], ['odile', 'hollis'], ['priya', 'kasimir']], 2, 'heard', ties);
    expect(knownTiesOf(s, 'odile', ties).map(t => [t.other, t.label])).toEqual([['hollis', 'close_friends'], ['june', 'friends'], ['rook', 'rivals']]);
    expect(knownTiesOf(s, 'priya', ties)).toEqual([{ other: 'kasimir', label: 'friends', romance: 'courting', how: 'heard', day: 2 }]);
    // Known is the pair; the label is whatever it is now.
    const later = tieIndex([tie('june', 'odile', 'close_friends')]);
    expect(knownTiesOf(s, 'odile', later).map(t => t.label)).toEqual(['close_friends']);
    s = { ...s, known_ties: {} };
    expect(knownTiesOf(s, 'odile', ties)).toEqual([]);
  });

  it('gives each tie its emote (§9.11.3)', () => {
    expect(pairEmote(tie('a', 'b', 'friends'))?.glyph).toBe('♪');
    expect(pairEmote(tie('a', 'b', 'close_friends'))?.glyph).toBe('♥');
    expect(pairEmote(tie('a', 'b', 'rivals'))?.glyph).toBe('…');
    expect(pairEmote(tie('a', 'b', 'enemies'))?.id).toBe('anger');
    expect(pairEmote(tie('a', 'b', 'acquaintances'))).toBeNull();
    expect(pairEmote(tie('a', 'b', 'acquaintances', 'courting'))?.glyph).toBe('♥');
  });
});

describe('meetings in the world', () => {
  const spots = [{ id: 'odile', x: 10, y: 10 }, { id: 'june', x: 11, y: 10.5 }, { id: 'rook', x: 14, y: 10 }, { id: 'hollis', x: 10.2, y: 10.1 }];

  it('finds pairs standing together, closest first', () => {
    expect(nearPairs(spots).map(p => p.key)).toEqual(['hollis+odile', 'hollis+june', 'june+odile']);
    expect(nearPairs(spots, 0.1)).toEqual([]);
  });

  it('counts a meeting as seen only when both are in sight of the player', () => {
    const at = new Map(spots.map(s => [s.id, s]));
    expect(inSight({ a: 'june', b: 'odile' }, at, { x: 12, y: 12 })).toBe(true);
    expect(inSight({ a: 'june', b: 'odile' }, at, { x: 10 + PAIR_EMOTE_RULES.seenTiles + 2, y: 10 })).toBe(false);
  });

  it('lets a pair emote once per cooldown and the board once per gap', () => {
    const t = new PairEmoteThrottle({ pairCooldownMs: 90_000, globalGapMs: 4_000 });
    const pairs = [{ key: 'june+odile' }, { key: 'hollis+odile' }];
    expect(t.pick(pairs, 0)).toBe('june+odile');
    expect(t.pick(pairs, 1_000)).toBeNull(); // the board's gap
    expect(t.pick(pairs, 4_000)).toBe('hollis+odile'); // june+odile is cooling down
    expect(t.pick(pairs, 9_000)).toBeNull();
    expect(t.pick(pairs, 90_000)).toBe('june+odile');
  });
});
