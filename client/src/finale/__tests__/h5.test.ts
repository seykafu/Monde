// MVP G-11's acceptance: "Soak runs give a spread of poll results (H5)". MVP_PLAN §3 H5: "Straw Poll results spread
// across players (not all landslides)", bar "std dev of player share ≥ 8 pts". Five play styles × eight worlds.
import { describe, expect, it } from 'vitest';
import { percentages, type Candidate } from '@monde/shared';
import { PLAY_STYLES, playerRegard, soakPoll, type PlayStyle, type SoakPoll } from './springSoak';

const SEEDS = Array.from({ length: 8 }, (_, i) => 2026 + i);
const runs: SoakPoll[] = PLAY_STYLES.flatMap(style => SEEDS.map(seed => soakPoll(style, seed)));
const jar = (r: SoakPoll): number => percentages(r.poll.shares).fellow;
const townShare = (r: SoakPoll): number => r.poll.town.shares.fellow * 100;
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: readonly number[]): number => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
const of = (style: PlayStyle) => runs.filter(r => r.style === style);

describe('H5: the Spring Straw Poll spreads across play styles', () => {
  it('prints the soak (the numbers in the G-11 report)', () => {
    const rows = PLAY_STYLES.map(style => {
      const rs = of(style), friends = [...playerRegard(style).values()].filter(v => v >= 40).length;
      const leaders = rs.map(r => r.poll.leader);
      return `${style.padEnd(8)} spirit ${mean(rs.map(r => r.spirit)).toFixed(1).padStart(5)}  band ${rs[0]!.poll.band.padEnd(4)}  friends ${String(friends).padStart(2)}`
        + `  jar Fellow ${mean(rs.map(jar)).toFixed(1).padStart(5)}% (sd ${sd(rs.map(jar)).toFixed(1)})`
        + `  town Fellow ${mean(rs.map(townShare)).toFixed(1).padStart(5)}% Vane ${mean(rs.map(r => r.poll.town.shares.vane * 100)).toFixed(1).padStart(5)}% Moss ${mean(rs.map(r => r.poll.town.shares.moss * 100)).toFixed(1).padStart(5)}%`
        + `  jar leaders ${['fellow', 'vane', 'moss', 'tie'].map(c => `${c} ${leaders.filter(l => l === c).length}`).join(' ')}`;
    });
    console.info(`G-11 Straw Poll soak (${SEEDS.length} worlds per style)\n${rows.join('\n')}\n`
      + `all runs: jar Fellow sd ${sd(runs.map(jar)).toFixed(1)} pts · town Fellow sd ${sd(runs.map(townShare)).toFixed(1)} pts`);
    expect(runs).toHaveLength(PLAY_STYLES.length * SEEDS.length);
  });

  it('meets the bar: the std dev of the Fellow\'s share across players is at least 8 points', () => {
    expect(sd(runs.map(jar))).toBeGreaterThanOrEqual(8);
    // The whole-town count (no sampling noise) spreads too: the spread comes from how people played.
    expect(sd(runs.map(townShare))).toBeGreaterThanOrEqual(8);
  });

  it('is not all landslides: the styles land in different places, and someone loses', () => {
    const byStyle = Object.fromEntries(PLAY_STYLES.map(s => [s, mean(of(s).map(townShare))])) as Record<PlayStyle, number>;
    expect(byStyle.passive).toBeLessThan(35);
    expect(Math.min(...Object.values(byStyle))).toBeLessThan(40);
    expect(Math.max(...Object.values(byStyle))).toBeGreaterThan(50);
    // Playing well beats not playing; talking and building both count, and a lapse costs.
    expect(byStyle.strong).toBeGreaterThan(byStyle.lapsed);
    expect(byStyle.lapsed).toBeGreaterThan(byStyle.passive);
    expect(byStyle.social).toBeGreaterThan(byStyle.passive + 15);
    expect(byStyle.builder).toBeGreaterThan(byStyle.passive + 15);
    expect(runs.filter(r => r.poll.leader !== 'fellow').length).toBeGreaterThan(0);
    expect(runs.filter(r => r.poll.leader === 'fellow').length).toBeGreaterThan(0);
  });

  const meanShare = (style: PlayStyle, candidate: Candidate) => mean(of(style).map(r => r.poll.town.shares[candidate]));

  it('gives Vane at least 45% of the passive town vote, with Moss second', () => {
    const vane = meanShare('passive', 'vane'), moss = meanShare('passive', 'moss');
    expect(vane).toBeGreaterThanOrEqual(0.45);
    expect(vane).toBeGreaterThan(moss);
    expect(moss).toBeGreaterThan(meanShare('passive', 'fellow'));
  });

  it.each(['lapsed', 'social'] as const)('gives Vane the largest %s town share', style => {
    expect(meanShare(style, 'vane')).toBeGreaterThan(Math.max(meanShare(style, 'fellow'), meanShare(style, 'moss')));
  });

  it.each(['builder', 'strong'] as const)('gives the Fellow every %s jar and keeps Vane below 20%% of the town vote', style => {
    expect(of(style).every(r => r.poll.leader === 'fellow')).toBe(true);
    expect(meanShare(style, 'vane')).toBeLessThan(0.20);
  });

  it.each(PLAY_STYLES)('keeps Moss between 15%% and 45%% of the %s town vote', style => {
    const moss = meanShare(style, 'moss');
    expect(moss).toBeGreaterThanOrEqual(0.15);
    expect(moss).toBeLessThanOrEqual(0.45);
  });

  it('is deterministic: the same world and play give the same poll', () => {
    expect(soakPoll('social', 2026)).toEqual(of('social')[0]);
  });
});
