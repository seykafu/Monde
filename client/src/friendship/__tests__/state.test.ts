import { describe, expect, it } from 'vitest';
import { pairKey, type PlanOutput, type TieData, type TieMilestoneData, type TurnRegard } from '@monde/shared';
import { applyDawn, applyRegardSnapshot, cardTies, emptyFriendship, meet, metResidents, recordTurn, regardOf, seedRegard } from '../state';
import { dawnLines, printedMilestones, romanceNews } from '../milestones';
import type { DawnPackage } from '../../mind/dawn';
import { loadCards } from '../../sim/__tests__/content';

const regard = (before: number, after: number): TurnRegard => ({
  before, after, delta: after - before, hearts_before: 0, hearts_after: 0, first_chat: false, capped: false
});
const tie = (a: string, b: string, label: TieData['label'], romance: TieData['romance'] = null): TieData => ({ a, b, label, romance });
const milestone = (a: string, b: string, kind: TieMilestoneData['kind'], day = 4): TieMilestoneData =>
  ({ day, a, b, kind, from: 'acquaintances', to: kind === 'became_friends' ? 'friends' : kind === 'became_rivals' ? 'rivals' : 'close_friends' });
const plan: PlanOutput = {
  blocks: [{ start: '06:00', end: '09:00', action: 'work', place: 'market_row.bakery', with: [], note: '' }],
  whim: null, barks: [], seek_player: null, intentions: []
};
const pkg = (over: Partial<DawnPackage> = {}): DawnPackage => ({
  day: 5, weekday: 'Sat', plans: [{ resident_id: 'odile', tier: 'core', source: 'model', plan }, { resident_id: 'moss', tier: 'ambient', source: 'template', plan: {} }],
  letters: [], favors: [], ties: { pairs: [], milestones: [] }, pending: 0, complete: true, ...over
});
const NAMES = { odile: 'Odile', june: 'June', moss: 'Old Moss', hollis: 'Hollis', rook: 'Rook', priya: 'Priya', kasimir: 'Kasimir' };

describe('mirrored Regard (§9.11.1)', () => {
  it('seeds from the Background start, else 0', () => {
    expect(seedRegard('homecomer', 'odile')).toBe(20);
    expect(seedRegard('homecomer', 'tib')).toBe(0);
    expect(seedRegard('tinkerer', 'odile')).toBe(0);
    expect(seedRegard(null, 'odile')).toBe(0);
  });

  it('meets a resident once and mirrors what the server applied', () => {
    let s = meet(emptyFriendship(), 'odile', 2, 20);
    expect(s.residents.odile).toEqual({ regard: 20, source: 'seed', met_day: 2, last_talk_day: 2, likes: [] });
    s = recordTurn(s, 'odile', 3, regard(20, 23), 20);
    expect(s.residents.odile).toMatchObject({ regard: 23, source: 'server', met_day: 2, last_talk_day: 3 });
    expect(regardOf(s, 'odile')).toBe(23);
    expect(regardOf(s, 'june', 7)).toBe(7);
  });

  it("takes the server's whole-town snapshot (M-06): met or not, over the bond and the seed", () => {
    let s = recordTurn(meet(emptyFriendship(), 'odile', 2, 20), 'odile', 3, regard(20, 23), 20);
    expect(s.regard).toEqual({ odile: 23 });
    s = applyRegardSnapshot(s, { odile: 26, pell: 3, tib: 140 });
    expect(regardOf(s, 'odile', 20)).toBe(26);
    expect(s.residents.odile).toMatchObject({ regard: 26, source: 'server' });
    expect(regardOf(s, 'pell', 20)).toBe(3); // not met, still mirrored
    expect(regardOf(s, 'tib')).toBe(100); // clamped
    expect(s.residents.pell).toBeUndefined();
    expect(applyRegardSnapshot(s, { odile: 26 })).toBe(s); // nothing new
    expect(applyRegardSnapshot(s, null)).toBe(s);
    // Meeting someone the snapshot already knows starts the bond there.
    expect(meet(s, 'pell', 4, 20).residents.pell).toMatchObject({ regard: 3, source: 'server' });
    // And the dawn package's Regard replaces it too.
    expect(applyDawn(s, pkg({ regard: { odile: 30 } }), { names: NAMES, plans: {} }).state.regard.odile).toBe(30);
  });

  it('never invents a gain for a Quiet Mode turn', () => {
    const s = recordTurn(meet(emptyFriendship(), 'june', 1), 'june', 4, undefined);
    expect(s.residents.june).toMatchObject({ regard: 0, source: 'seed', last_talk_day: 4 });
    expect(recordTurn(s, 'june', 4, null).residents.june!.regard).toBe(0);
  });

  it('lists residents in the order they were met', () => {
    const s = meet(meet(meet(emptyFriendship(), 'pell', 3), 'odile', 1), 'june', 3);
    expect(metResidents(s)).toEqual(['odile', 'june', 'pell']);
  });
});

describe('ties before any dawn: Day 1 from the cards (§12.3)', () => {
  it('labels every pair the cards relate, as the server would', () => {
    const t = new Map(cardTies(loadCards()).map(x => [pairKey(x.a, x.b), x]));
    expect(t.size).toBeGreaterThan(20);
    expect([...t.values()].every(x => x.a < x.b && x.label !== ('strangers' as string) && x.romance === null)).toBe(true);
    // Odile → Hollis 55 (and Hollis's own view of her): Friends at least; Odile → Rook −40 sours that pair.
    expect(['friends', 'close_friends']).toContain(t.get(pairKey('hollis', 'odile'))?.label);
    expect(['rivals', 'acquaintances', 'enemies']).toContain(t.get(pairKey('odile', 'rook'))?.label);
  });
});

describe('the dawn package folded in', () => {
  it('keeps ties, tiers, the applied plans, letters once and open Favors', () => {
    const letter = { id: 'l1', from: 'odile', to: 'player', day: 4, text: 'The oven door again.' };
    const favor = (id: string, expires: number) => ({ id, resident_id: 'odile', template: 'fetch', target: 'x', text: 'Bring flour.', created_day: 4, expires_day: expires });
    const start = { ...emptyFriendship(), letters: [letter], favors: [favor('f-old', 4)] };
    const { state } = applyDawn(start, pkg({ letters: [letter], favors: [favor('f1', 7)], ties: { pairs: [tie('june', 'odile', 'friends')], milestones: [] } }),
      { names: NAMES, plans: { odile: plan } });
    expect(state.ties).toEqual({ day: 5, pairs: [tie('june', 'odile', 'friends')] });
    expect(state.tiers).toEqual({ odile: 'core', moss: 'ambient' });
    expect(state.plans).toEqual({ day: 5, plans: { odile: plan } });
    expect(state.letters.map(l => l.id)).toEqual(['l1']);
    expect(state.favors.map(f => f.id)).toEqual(['f1']);
    expect(state.report).toEqual({ day: 5, lines: [] });
  });

  it('prints milestones (Core friends, any falling out) and the player learns those ties by reading them', () => {
    const tiers = { odile: 'core', june: 'core', moss: 'ambient', hollis: 'core', rook: 'core' };
    const ms = [milestone('june', 'odile', 'became_friends'), milestone('moss', 'odile', 'became_friends'), milestone('odile', 'rook', 'became_rivals'), milestone('hollis', 'odile', 'made_up')];
    // Moss is Ambient: his new friendship with Odile isn't front-page news.
    expect(printedMilestones(ms, tiers).map(m => `${m.a}+${m.b}`)).toEqual(['june+odile', 'odile+rook', 'hollis+odile']);
    expect(printedMilestones(ms, {}).length).toBe(4);
    const out = applyDawn(emptyFriendship(), pkg({
      plans: Object.entries(tiers).map(([resident_id, tier]) => ({ resident_id, tier, source: 'template' as const, plan: {} })),
      ties: { pairs: [tie('june', 'odile', 'friends'), tie('moss', 'odile', 'friends'), tie('odile', 'rook', 'rivals'), tie('hollis', 'odile', 'acquaintances')], milestones: ms }
    }), { names: NAMES, plans: {} });
    expect(out.lines).toEqual(['June and Odile have become friends.', 'Odile and Rook have fallen out.', 'Hollis and Odile have made up.']);
    expect(Object.keys(out.state.known_ties).sort()).toEqual(['hollis+odile', 'june+odile', 'odile+rook']);
    expect(out.state.known_ties['june+odile']).toEqual({ day: 5, how: 'read' });
    expect(out.state.milestones).toHaveLength(4);
  });

  it('reports a romance moving up the ladder between two dawns, first', () => {
    const before = [tie('kasimir', 'priya', 'close_friends'), tie('june', 'odile', 'friends', 'courting')];
    const after = [tie('kasimir', 'priya', 'close_friends', 'courting'), tie('june', 'odile', 'friends', 'courting')];
    expect(romanceNews(before, after)).toEqual([{ a: 'kasimir', b: 'priya', stage: 'courting' }]);
    expect(romanceNews(after, after)).toEqual([]);
    expect(dawnLines([milestone('june', 'odile', 'became_close_friends')], romanceNews(before, after), NAMES))
      .toEqual(['Kasimir and Priya are courting.', 'June and Odile are close friends now.']);
    const out = applyDawn({ ...emptyFriendship(), ties: { day: 4, pairs: before } }, pkg({ ties: { pairs: after, milestones: [] } }), { names: NAMES, plans: {} });
    expect(out.lines).toEqual(['Kasimir and Priya are courting.']);
    expect(out.state.known_ties['kasimir+priya']?.how).toBe('read');
  });

  it('keeps two weeks of milestones', () => {
    const old = { ...emptyFriendship(), milestones: [milestone('june', 'odile', 'became_friends', 1), milestone('hollis', 'odile', 'became_friends', 10)] };
    const out = applyDawn(old, pkg({ day: 16, ties: { pairs: [], milestones: [milestone('odile', 'rook', 'became_rivals', 15)] } }), { names: NAMES, plans: {} });
    expect(out.state.milestones.map(m => m.day)).toEqual([10, 15]);
  });
});
