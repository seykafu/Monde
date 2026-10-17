// The End-of-Spring report (MVP G-11): Days 1–25 on one page, from what the game already keeps. Pure.
//
// The numbers are the town engine's (Pillars against §2.4's Day 1, Appeal, the census and the comings and goings), the
// Projects opened, Monde's Marks solved, Scuffles won, the residents at Friend or better (hearts, §9.11.1), the Straw
// Poll, a handful of moments from the game's own record, and the Fellow's standing.
import {
  PILLARS, SPRING_RIDDLES, heartsOf, livingArrivals, percentages, regardTier, type Pillar, type SavedFriendship,
  type SavedProjects, type SavedRiddles, type SavedScuffles, type StrawPollRecord, type TownPeople
} from '@monde/shared';
import { SCUFFLES } from '../combat/scuffle/catalog';
import { PROJECTS } from '../projects/catalog';
import { defOf } from '../projects/engine';
import { projectName } from '../projects/runtime';
import { computeAppeal } from '../town/appeal';
import { DAY1_CENSUS, DAY1_PILLARS, createTownState, type TownState } from '../town/pillars';
import { voteOutcome } from './poll';

export interface ReportInput {
  /** The day the report is read (Spring is Days 1–25). */
  day: number;
  town: TownState;
  projects: SavedProjects;
  riddles: SavedRiddles;
  scuffles: SavedScuffles;
  friendship: SavedFriendship;
  /** Regard toward the player, as the game mirrors it (scenes/friendship.ts regardFor). */
  regard(id: string): number;
  /** A resident's town name ("Pell", "Roz"). */
  name(id: string): string;
  flags: ReadonlySet<string>;
  poll: StrawPollRecord | null;
  /** S05's first arrival, if there was one. */
  firstArrival?: { name: string; day: number } | null;
}

export interface PillarRow { pillar: Pillar; start: number; now: number }
export interface FriendRow { id: string; name: string; hearts: number }
export interface Moment { day: number; text: string }
export interface SpringReport {
  days: number;
  pillars: PillarRow[];
  appeal: { start: number; now: number };
  census: { start: number; now: number };
  arrivals: { households: number; people: number };
  departures: number;
  projects: string[];
  marks: { solved: number; total: number };
  scuffles: { won: number; fought: number };
  /** Residents at Friend (4♥) or better, most hearts first. */
  friends: FriendRow[];
  /** Residents the player has talked to. */
  met: number;
  poll: StrawPollRecord | null;
  moments: Moment[];
  standing: { title: string; line: string };
}

/** §2.4's Day 1, as the Ledger shows it: Appeal ≈ 23 (§6.2). */
export const DAY1_APPEAL = computeAppeal(createTownState()).appeal;
const CLOCKTOWER = 'clocktower';
/** GDD-GAP: "a handful of moments": five fit the page. */
export const MOMENTS_MAX = 5;
export const SPRING_DAYS = 25;
const FRIEND_REGARD = 40;


/** The Fellow's standing: what the Straw Poll and the friendships say, in a line. */
export function standingOf(poll: StrawPollRecord | null, friends: number, met: number): { title: string; line: string } {
  const known = met === 0 ? 'Hardly anyone has heard you speak yet.'
    : `${met === 1 ? 'One resident knows' : `${met} residents know`} your voice; ${friends === 0 ? 'none counts you a friend yet' : friends === 1 ? 'one counts you a friend' : `${friends} count you a friend`}.`;
  if (!poll) return { title: 'Still new in town', line: known };
  const v = voteOutcome(poll);
  if (v.winner === 'fellow' && v.share >= 55) return { title: "The town's choice, if you stood", line: known };
  if (v.winner === 'fellow') return { title: v.clear ? 'Ahead at the jam jars' : 'Ahead by a bean or two', line: known };
  if (v.winner === 'vane') return { title: "Mr. Vane has the town's ear, for now", line: known };
  if (v.winner === 'moss') return { title: 'Old Moss and his ferry, for now', line: known };
  return { title: 'Dead level at the jam jars', line: known };
}

const scuffleName = (id: string): string => (SCUFFLES as Readonly<Record<string, { name?: string }>>)[id]?.name ?? 'a Scuffle';

/** The game's own record of the Spring, oldest first, then the best five: firsts and the big days. */
export function momentsOf(input: ReportInput): Moment[] {
  const out: (Moment & { weight: number })[] = [];
  const firstWin = Object.values(input.scuffles.results).filter(s => s.outcome === 'win' || s.outcome === 'talk_down').sort((a, b) => a.day - b.day)[0];
  if (firstWin) out.push({ day: firstWin.day, text: `You won your first Scuffle, "${scuffleName(firstWin.id)}".`, weight: 3 });
  // The first Project and the last: the middle ones are on the list above. The clocktower has its own line (below).
  const opened = Object.entries(input.projects.projects).filter(([id, p]) => p.opened !== null && id !== CLOCKTOWER).sort((a, b) => a[1].opened! - b[1].opened!);
  opened.forEach(([id, p], i) => {
    const def = defOf(PROJECTS, id);
    if (!def || (i > 0 && i < opened.length - 1)) return;
    out.push({ day: p.opened!, text: `${capital(projectName(def, p))} opened${i === 0 ? ', the first Project of the Spring' : ''}.`, weight: i === 0 ? 4 : 2 });
  });
  if (input.firstArrival) out.push({ day: input.firstArrival.day, text: `${input.firstArrival.name} stepped off the Gannet, Monde's first newcomer in years.`, weight: 4 });
  const firstMark = Object.entries(input.riddles.entries).filter(([, r]) => r.status === 'solved').sort((a, b) => a[1].foundAt - b[1].foundAt)[0];
  if (firstMark) out.push({ day: Math.max(1, Math.floor(firstMark[1].foundAt / 1440) + 1), text: `You solved your first of Monde's Marks (${firstMark[0]}).`, weight: 2 });
  // The day the clock ran: its Project opens the moment PZ-15 is solved (S07a from Day 6, or a later fitting after S07b).
  if (input.flags.has('clock_running')) out.push({ day: input.projects.projects[CLOCKTOWER]?.opened ?? 14, text: 'The clocktower runs again, for good.', weight: 3 });
  else if (input.flags.has('clock_chimed')) out.push({ day: 14, text: 'The clocktower chimed once, on a borrowed part.', weight: 2 });
  if (input.flags.has('option_known')) out.push({ day: 18, text: 'Sable found the Option Clause in the council archive.', weight: 2 });
  // The fair: S10a's band, else the poll's (Sable's jars were out whether or not the Fellow came).
  const band = input.flags.has('fair_band_high') ? 'high' : input.flags.has('fair_band_mid') ? 'mid' : input.flags.has('fair_band_low') ? 'low' : input.poll?.band ?? null;
  if (band) out.push({ day: 25, text: `${FAIR_CROWD[band]} on the lawn for the Bloom Fair${input.flags.has('june_hope') ? ", and June didn't stop playing" : ''}.`, weight: 5 });
  const best = [...out].sort((a, b) => b.weight - a.weight || a.day - b.day).slice(0, MOMENTS_MAX);
  return best.sort((a, b) => a.day - b.day).map(({ day, text }) => ({ day, text }));
}
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** §13.3a's headcounts, as Tib counts them in S10b. */
export const FAIR_CROWD: Readonly<Record<StrawPollRecord['band'], string>> = { low: 'Thirty-one', mid: 'Seventy-three', high: 'A hundred and ninety' };

export function springReport(input: ReportInput): SpringReport {
  const t = input.town;
  const people: TownPeople | undefined = t.people;
  const arrived = livingArrivals(people).length + (people?.departed.length ?? 0);
  const households = new Set([...(people?.households ?? []).map(h => h.id), ...(people?.departed ?? []).map(d => d.household)]).size;
  const bonds = Object.keys(input.friendship.residents);
  const friends = bonds.map(id => ({ id, name: input.name(id), regard: input.regard(id) }))
    .filter(f => f.regard >= FRIEND_REGARD)
    .sort((a, b) => b.regard - a.regard || a.name.localeCompare(b.name))
    .map(f => ({ id: f.id, name: f.name, hearts: Math.floor(heartsOf(f.regard)) }));
  const results = Object.values(input.scuffles.results);
  return {
    days: Math.min(SPRING_DAYS, Math.max(1, input.day - 1)),
    pillars: PILLARS.map(p => ({ pillar: p, start: DAY1_PILLARS[p], now: t.pillars[p] })),
    appeal: { start: DAY1_APPEAL, now: computeAppeal(t).appeal },
    census: { start: DAY1_CENSUS, now: t.census },
    arrivals: { households, people: arrived },
    departures: people?.departed.length ?? 0,
    projects: Object.entries(input.projects.projects).filter(([, p]) => p.opened !== null)
      .sort((a, b) => a[1].opened! - b[1].opened!)
      .flatMap(([id, p]) => { const def = defOf(PROJECTS, id); return def ? [capital(projectName(def, p))] : []; }),
    marks: { solved: Object.values(input.riddles.entries).filter(r => r.status === 'solved').length, total: SPRING_RIDDLES.length },
    scuffles: { won: results.filter(s => s.outcome === 'win' || s.outcome === 'talk_down').length, fought: results.length },
    friends, met: bonds.length, poll: input.poll,
    moments: momentsOf(input),
    standing: standingOf(input.poll, friends.length, bonds.length)
  };
}

/** "Friend", "Confidant": the tier a row of hearts stands for (§10.2). */
export const tierName = (hearts: number): string => regardTier(hearts * 10);
/** The poll's line for the page: "The Fellow 41% · Mr. Vane 22% · Old Moss 37% (65 beans, ±12)". */
export function pollLine(poll: StrawPollRecord): string {
  const pct = percentages(poll.shares);
  return `The Fellow ${pct.fellow}% · Mr. Vane ${pct.vane}% · Old Moss ${pct.moss}%  (${poll.ballots} beans, ±${Math.round(poll.margin * 100)})`;
}
