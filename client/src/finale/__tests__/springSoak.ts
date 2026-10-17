// The Straw Poll soak (MVP G-11, hypothesis H5: "Straw Poll results spread across players (not all landslides)"). Each
// play style runs Days 1–25 of the town (the G-02 mock soak, town/__tests__/migrationSoak.ts: Pillars, Projects, homes,
// arrivals and departures) with the player's side laid over it: who they talked to and how well (§9.11.2's earning
// rules, shared applyTalkTurn and neglectDelta), and the deeds the town saw. Then the Straw Poll is taken on the evening
// of Day 25, exactly as S10c takes it (finale/poll.ts springPoll).
//
// Assumptions (not GDD numbers), as the G-02 soak documents its own:
//   - a conversation is two turns; how well a style's replies land is one judgment per turn (+1 builder, +3 strong,
//     +4 social), under the +6 a day cap with the first-chat bonus;
//   - the social player gives one gift a day that the resident likes (+4, §11.4);
//   - the builder works beside Kasimir, Tib and Teo on the Projects most days (+1 each, §8 "Volunteer on a Project");
//   - scripted scene Regard (S01–S10) is left out: every style plays the same scenes;
//   - the town is the full Day-1 roster (MVP M-03): the hand-written cast and the census's 188 (their written cards, or
//     every household's template card until the census is written, sim/__tests__/content.ts loadFullRoster).
import { applyTalkTurn, EMPTY_TALK_LEDGER, giftRegard, neglectDelta, type SpringDeeds, type StrawPollRecord, type TalkLedger } from '@monde/shared';
import { loadFullRoster } from '../../sim/__tests__/content';
import { runMigrationSoak, type MigrationScenario } from '../../town/__tests__/migrationSoak';
import { springPoll, workSeen } from '../poll';

/** The Day-1 town's cards. */
export const ROSTER = await loadFullRoster();

export const PLAY_STYLES = ['strong', 'passive', 'lapsed', 'social', 'builder'] as const satisfies readonly MigrationScenario[];
export type PlayStyle = (typeof PLAY_STYLES)[number];

/** The carded grown-ups a player can find about the open districts, in the order a talker meets them. */
const ROUND = ['odile', 'rosalind', 'margo', 'june', 'kasimir', 'teo', 'nell', 'bertrand', 'augusta', 'priya', 'felix', 'sable', 'pell', 'ada', 'hollis', 'delphine', 'ines'];

interface Talker { perDay: number; reply: number; gifts: boolean; lastDay: number; coworkers: readonly string[] }
export const TALKERS: Readonly<Record<PlayStyle, Talker>> = {
  strong: { perDay: 3, reply: 3, gifts: false, lastDay: 25, coworkers: [] },
  passive: { perDay: 0, reply: 0, gifts: false, lastDay: 0, coworkers: [] },
  lapsed: { perDay: 3, reply: 3, gifts: false, lastDay: 9, coworkers: [] },
  social: { perDay: 6, reply: 4, gifts: true, lastDay: 25, coworkers: [] },
  builder: { perDay: 1, reply: 1, gifts: false, lastDay: 25, coworkers: ['kasimir', 'tib', 'teo'] }
};

/** Where each style's Scuffles and Projects happened (the migration soak's scripts, by the content's sites). */
const home = (n: number): { zone: string }[] => Array.from({ length: n }, (_, i) => ({ zone: i === 4 || i === 5 ? 'wharf' : 'old_quarter' }));
export const DEEDS: Readonly<Record<PlayStyle, SpringDeeds>> = {
  strong: { scuffles: [{ zone: 'market_row', won: true }], projects: [
    { zone: 'market_row' }, { zone: 'old_quarter' }, { zone: 'old_quarter' }, { zone: 'old_quarter' }, { zone: 'commons' }, { zone: 'market_row' }, ...home(5)] },
  passive: { scuffles: [], projects: [] },
  lapsed: { scuffles: [{ zone: 'market_row', won: true }, { zone: 'market_row', won: false }], projects: [
    { zone: 'market_row' }, { zone: 'old_quarter' }, { zone: 'old_quarter' }, ...home(2)] },
  social: { scuffles: [], projects: [{ zone: 'old_quarter' }] },
  builder: { scuffles: [], projects: [
    { zone: 'market_row' }, { zone: 'old_quarter' }, { zone: 'old_quarter' }, { zone: 'commons' }, { zone: 'market_row' }, ...home(7)] }
};

/** The player's Regard with each resident after Days 1–25 of a style (only those they talked to or worked beside). */
export function playerRegard(style: PlayStyle): Map<string, number> {
  const t = TALKERS[style];
  const regard = new Map<string, number>(), ledgers = new Map<string, TalkLedger>();
  for (let day = 1; day <= 25; day++) {
    if (day <= t.lastDay && t.perDay > 0) {
      for (let k = 0; k < t.perDay; k++) {
        const id = ROUND[(day * t.perDay + k) % ROUND.length]!;
        let r = regard.get(id) ?? 0, ledger = ledgers.get(id) ?? EMPTY_TALK_LEDGER;
        for (let turn = 0; turn < 2; turn++) ({ regard: r, ledger } = applyTalkTurn(r, ledger, day, t.reply));
        if (t.gifts && k === 0) r = Math.min(100, r + giftRegard('like'));
        regard.set(id, r); ledgers.set(id, ledger);
      }
    }
    if (day >= 5 && day <= 23) for (const id of t.coworkers) regard.set(id, (regard.get(id) ?? 0) + 1);
    // The night: neglect at Friend and above (§9.11.2).
    for (const [id, r] of regard) regard.set(id, r + neglectDelta(r, ledgers.get(id)?.lastTalkDay ?? null, day));
  }
  return regard;
}

export interface SoakPoll { style: PlayStyle; seed: number; poll: StrawPollRecord; spirit: number }

export function soakPoll(style: PlayStyle, seed: number): SoakPoll {
  const town = runMigrationSoak(style, 25, { seed }).final;
  const regard = playerRegard(style);
  const flags = new Set(['option_known']);
  const poll = springPoll({
    worldSeed: seed, town, cards: ROSTER, regard: id => regard.get(id) ?? 0, met: id => regard.has(id),
    deeds: { ...DEEDS[style], work: workSeen(town) }, flags
  });
  return { style, seed, poll, spirit: town.pillars.spirit };
}
