// The Spring Straw Poll in the running game (MVP G-11): the Day-25 world read out of the registry, run through the §10.3
// voter model (shared/src/election), and what the script reads back (`vote.*` in S10c).
//
// No Phaser: the registry is anything with get/set/remove. Regard comes in from the caller (scenes/friendship.ts
// regardFor in the game: the server's mirror plus scripted Regard still queued), as projects/runtime.ts takes it.
import {
  emptyFriendship, fairBand, livingArrivals, percentages, springElectorate, strawPoll, type ElectorCard, type ElectorTie, type FairBand,
  type PersonaCard, type SavedFriendship, type SpringDeeds, type StrawPollRecord
} from '@monde/shared';
import type { RegistryLike } from '../fellow/state';
import { PROJECTS } from '../projects/catalog';
import { defOf } from '../projects/engine';
import { flagsOf, projectsOf, siteFor } from '../projects/runtime';
import { scufflesOf } from '../scuffles/runtime';
import { DAY1_PILLARS, type TownState } from '../town/pillars';
import { personaCards } from '../world/residents';
import { POLL_DAY } from './state';

/** Everything the poll reads, as plain data (the soak builds one of these without a registry). */
export interface SpringWorld {
  worldSeed: number;
  town: TownState;
  /** The authored cards (the generated arrivals come from `town.people`). */
  cards: readonly PersonaCard[];
  regard(id: string): number;
  met(id: string): boolean;
  ties?: readonly ElectorTie[];
  deeds: SpringDeeds;
  flags: ReadonlySet<string>;
}

const elector = (c: PersonaCard): ElectorCard => ({
  id: c.id, name: c.name, age: c.age, kind: c.kind, occupation: c.occupation, home: c.home, values: c.values, relationships: c.relationships
});
const zoneOf = (place: string): string => place.split('.')[0] ?? place;

/** S10a set the fair's band from Spirit at noon (fair_band_*); before it plays, Spirit now decides. */
export function bandOf(flags: ReadonlySet<string>, spirit: number): FairBand {
  if (flags.has('fair_band_high')) return 'high';
  if (flags.has('fair_band_mid')) return 'mid';
  if (flags.has('fair_band_low')) return 'low';
  return fairBand(spirit);
}

// GDD-GAP: §10.3 records approximate five-style soak results, but gives no per-script share cap or Vane minimum. Keep the authored scoring; audit the actual bot distributions and H5 spread.
/** The §10.3 count and the fair's jars for this world. */
export function springPoll(w: SpringWorld): StrawPollRecord {
  const people = springElectorate({
    worldSeed: w.worldSeed, day: POLL_DAY, cards: w.cards.map(elector), regard: w.regard, met: w.met,
    arrivals: livingArrivals(w.town.people).map(r => ({ card: elector(r.card), arrivedDay: r.arrived_day, household: r.household })),
    ...(w.ties ? { ties: w.ties } : {}), deeds: w.deeds, flags: w.flags
  });
  return strawPoll(people, { worldSeed: w.worldSeed, pillars: w.town.pillars, day1: DAY1_PILLARS }, bandOf(w.flags, w.town.pillars.spirit), POLL_DAY);
}

/** Community-work tasks in the town's week-long change log (§6.1's log keeps seven days; §8: every task is seen). */
export const workSeen = (town: Pick<TownState, 'log'>): number => town.log.filter(c => c.source === 'community_work').length;

/** The player's deeds the town has seen: Scuffles fought (§7.8), Projects opened (§6.3) by zone, the week's work (§8). */
export function deedsOf(r: RegistryLike): SpringDeeds {
  const projects = Object.entries(projectsOf(r).projects).flatMap(([id, p]) => {
    if (p.opened === null) return [];
    const def = defOf(PROJECTS, id);
    const place = p.target ?? (def ? siteFor(def, p)?.place : undefined);
    return place ? [{ zone: zoneOf(place) }] : [];
  });
  const scuffles = Object.values(scufflesOf(r).results).flatMap(s =>
    s.outcome === 'win' || s.outcome === 'talk_down' ? [{ zone: s.zone, won: true }] : s.outcome === 'loss' ? [{ zone: s.zone, won: false }] : []);
  const town = r.get('monde.town') as TownState | undefined;
  return { scuffles, projects, work: town ? workSeen(town) : 0 };
}

/** The world from the game's registry. A resident counts as met once the player has talked to them or shared a scene. */
export function springWorldOf(r: RegistryLike, regard: (id: string) => number, worldSeed: number): SpringWorld | null {
  const town = r.get('monde.town') as TownState | undefined;
  if (!town) return null;
  const friendship = (r.get('monde.friendship') as SavedFriendship | undefined) ?? emptyFriendship();
  return {
    worldSeed, town, cards: personaCards, regard,
    met: id => !!friendship.residents[id] || regard(id) !== 0,
    ...(friendship.ties ? { ties: friendship.ties.pairs } : {}),
    deeds: deedsOf(r), flags: flagsOf(r)
  };
}

/** What S10c reads after `{campaign: spring_straw_poll}`: `vote.winner`, `vote.share`, `vote.margin` (§13.5a's names). */
export type VoteOutcome = {
  winner: StrawPollRecord['leader'];
  /** The Fellow's share of the beans, whole percent. */
  share: number;
  vane: number;
  moss: number;
  /** The ± margin of error, whole points. */
  margin: number;
  ballots: number;
  /** The Fellow leads by more than the margin: a lead the paper can call a lead. */
  clear: boolean;
};
export function voteOutcome(p: StrawPollRecord): VoteOutcome {
  const pct = percentages(p.shares), margin = Math.round(p.margin * 100);
  const runnerUp = Math.max(pct.vane, pct.moss);
  return { winner: p.leader, share: pct.fellow, vane: pct.vane, moss: pct.moss, margin, ballots: p.ballots, clear: p.leader === 'fellow' && pct.fellow - runnerUp > margin };
}
