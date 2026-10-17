import { telemetry } from '../telemetry/emit';
// Taking the Straw Poll (MVP G-11), once per game: at the trestle in S10c, or, if the player missed the end of the fair,
// at the next dawn so the Lantern still prints it (the Straw Poll is never cut, MVP_PLAN §10). Pure: no Phaser.
import { type Press, type SavedFinale, type StrawPollRecord } from '@monde/shared';
import type { RegistryLike } from '../fellow/state';
import { springPoll, springWorldOf, voteOutcome } from './poll';
import { fallbackQuote, pickQuoted, type PollQuote } from './quotes';
import { REPORT_DAY, finaleOf, updateFinale } from './state';

/** The poll for this game: the saved one, else counted now and saved (with written quotes until live ones replace them). */
export function ensureStrawPoll(r: RegistryLike, regard: (id: string) => number, worldSeed: number, met?: (id: string) => boolean): SavedFinale | null {
  const saved = finaleOf(r);
  if (saved.poll) return saved;
  const world = springWorldOf(r, regard, worldSeed);
  if (!world) return null;
  const poll = springPoll(world);
  telemetry({ type: 'straw_poll_result', day: 25, ...voteOutcome(poll) });
  const quotes: PollQuote[] = pickQuoted(poll, met ?? world.met, worldSeed).map(q => ({ ...q, text: fallbackQuote(q.id, q.band, worldSeed), live: false }));
  return updateFinale(r, s => ({ ...s, poll, quotes }));
}

/** A live line replaces a quote's written one (S10c's card asks each quoted resident in their own words). */
export const setQuote = (r: RegistryLike, id: string, text: string): SavedFinale =>
  updateFinale(r, s => ({ ...s, quotes: s.quotes.map(q => (q.id === id ? { ...q, text, live: true } : q)) }));

const FAIR_STORY: Readonly<Record<StrawPollRecord['band'], string>> = {
  low: "Thirty-one on the Commons by Tib's count. Roz put out sixty cups, and the buns went further.",
  mid: "Seventy-three on the Commons by Tib's count, and a dog. The cider ran out before the music did.",
  high: "A hundred and ninety on the Commons by Tib's count, and Bastien. Roz ran out of cups, which she says has never happened."
};
const LEADER_NAME: Readonly<Record<StrawPollRecord['leader'], string>> = { fellow: 'the Fellow', vane: 'Mr. Vane', moss: 'Old Moss', tie: 'nobody' };

/**
 * The morning after the fair (Day 26) the Lantern leads with the poll (§6.6 prints polls): the jars on the front page
 * with three residents in their own words. A model edition keeps its headline; a template edition takes the poll's.
 */
export function withStrawPoll(edition: Press, finale: SavedFinale, day: number, name: (id: string) => string): Press {
  const poll = finale.poll;
  if (!poll || day !== REPORT_DAY) return edition;
  const v = voteOutcome(poll);
  const percent = { fellow: v.share, vane: v.vane, moss: v.moss };
  const lead = v.winner === 'tie' ? 'DEAD LEVEL AT THE JAM JARS' : `${LEADER_NAME[v.winner].toUpperCase()} ${percent[v.winner]}%`;
  const quotes = finale.quotes.map(q => ({ from: name(q.id), text: q.text }));
  // A quiet desk (a template edition with nothing reported) gets the fair itself, by Tib's count (§13.3a).
  const stories = edition.source === 'template' && edition.stories[0]?.event_id === null
    ? [{ event_id: null, title: 'Bloom Fair', text: FAIR_STORY[poll.band] }, ...edition.stories.slice(1)] : edition.stories;
  return {
    ...edition, stories,
    ...(edition.source === 'template' ? {
      headline: `IF MONDE VOTED TOMORROW: ${lead}`,
      dek: `The Lantern's Bloom Fair straw poll: ${poll.ballots} beans in three of Odile's jam jars, margin of error ±${v.margin} points. Nobody is standing. Yet.`
    } : {}),
    poll: { ballots: poll.ballots, margin: v.margin, percent, leader: v.winner, quotes }
  };
}
