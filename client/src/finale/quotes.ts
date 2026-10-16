// Who the Lantern quotes with the Straw Poll, and what they say (MVP G-11). Pure.
//
// Up to three carded residents the player has met: one who backs the Fellow, one who backs someone else, one who can't
// decide, when the poll has them (else whoever is left), in a seeded order so the same game always quotes the same
// people. Online each line is the resident's own ({ai_line} with a brief naming their lean); in Quiet Mode, or when the
// model gives nothing usable, it comes from content/lines/straw_poll.yaml.
import { seededUnit, type QuoteBand, type StrawPollRecord } from '@monde/shared';
import YAML from 'yaml';
import text from '../../../content/lines/straw_poll.yaml?raw';

interface QuoteLines {
  residents: Record<string, Partial<Record<QuoteBand, string>>>;
  generic: Record<QuoteBand, string[]>;
}
const LINES = YAML.parse(text) as QuoteLines;

/** Pell abstains ("Minute it"), Sable runs the trestle; neither is quoted. */
export const NOT_QUOTED: ReadonlySet<string> = new Set(['pell', 'sable']);
export const QUOTES_MAX = 3;

export interface PollQuote { id: string; band: QuoteBand; text: string; live: boolean }

/** The residents to quote: met, carded, eligible, in a seeded order; a Fellow lean, another lean, a torn one first. */
export function pickQuoted(poll: Pick<StrawPollRecord, 'leans'>, met: (id: string) => boolean, seed: number | string, max = QUOTES_MAX): { id: string; band: QuoteBand }[] {
  const pool = poll.leans.filter(l => met(l.id) && !NOT_QUOTED.has(l.id))
    .map(l => ({ id: l.id, band: l.band, r: seededUnit('poll-quote', seed, l.id) }))
    .sort((a, b) => a.r - b.r || a.id.localeCompare(b.id));
  const picked: typeof pool = [];
  const take = (test: (band: QuoteBand) => boolean) => {
    const next = pool.find(p => test(p.band) && !picked.includes(p));
    if (next && picked.length < max) picked.push(next);
  };
  take(b => b === 'fellow' || b === 'fellow_strong');
  take(b => b === 'vane' || b === 'moss');
  take(b => b === 'torn');
  for (const p of pool) if (picked.length < max && !picked.includes(p)) picked.push(p);
  return picked.map(({ id, band }) => ({ id, band }));
}

/** The written line for a resident's lean: their own, else a generic one picked by the seed. */
export function fallbackQuote(id: string, band: QuoteBand, seed: number | string): string {
  const own = LINES.residents[id]?.[band];
  if (own) return own;
  const pool = LINES.generic[band];
  return pool[Math.floor(seededUnit('poll-quote-line', seed, id) * pool.length)]!;
}

const LEAN: Readonly<Record<QuoteBand, string>> = {
  fellow_strong: "they put it in the Fellow's jar without a second thought",
  fellow: "they put it in the Fellow's jar, after some thought",
  torn: 'they hovered between two jars and still have not decided',
  vane: "they put it in Mr. Vane's jar",
  moss: "they put it in Old Moss's jar"
};

/** The {ai_line} brief for a resident's quote (≤ one sentence; the guard rails of S10a/S10b's briefs). */
export function quoteBrief(name: string, band: QuoteBand): string {
  return `${name}, at the Lantern's straw-poll trestle at the end of Bloom Fair, says one or two short sentences about which jam jar they dropped their bean in: ${LEAN[band]}. Their own reason, plainly, in their own voice. No mention of the Option Clause or the Tollmen.`;
}

/** Every resident with lines of their own (the content linter's and the tests' view). */
export const quotedResidents = (): string[] => Object.keys(LINES.residents);
export const quoteLines = (): Readonly<QuoteLines> => LINES;
