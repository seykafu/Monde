// Persona cards (GDD §9.3): the hand-written cast (content/residents/*.yaml) and, once the census is written, the Day-1
// residents (content/residents/day1/, MVP M-03). tools/compile-residents.ts checks every card against the shared
// PersonaCard schema and compiles them into residents.gen.json (npm run residents; the dev, build and test scripts run
// it first), which loads as its own chunk (vite.config.ts). Order: the hand-written cards in file order, then the Day-1
// cards by id, so roster colours and indices of the core cast never move. With no Day-1 cards it is the same 24.
import { PersonaCard } from '@monde/shared';
import rosterJson from './residents.gen.json?raw';

interface RosterFile { version: number; hand: number; cards: PersonaCard[] }

const started = typeof performance !== 'undefined' ? performance.now() : 0;
const file = JSON.parse(rosterJson) as RosterFile;
if (file.version !== 1) throw new Error(`residents.gen.json version ${file.version}; expected 1 (run npm run residents)`);
// The compiler validated every card; in development (and the tests) check again, so a schema change that left the
// compiled file behind fails here rather than mid-day.
if (import.meta.env.DEV) {
  for (const card of file.cards) {
    const result = PersonaCard.safeParse(card);
    if (!result.success) throw new Error(`residents.gen.json ${card.id}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')} (run npm run residents)`);
  }
}

export const personaCards: readonly PersonaCard[] = file.cards;
/** The hand-written cards (no `generated_by`): the first `hand` of the roster, in file order. */
export const handWrittenCards: readonly PersonaCard[] = file.cards.slice(0, file.hand);
/** The Day-1 census's cards (MVP M-03), by id; empty until the census is written. */
export const day1Cards: readonly PersonaCard[] = file.cards.slice(file.hand);
/** How long reading the roster took at boot (perf harness, docs/PERF.md). */
export const rosterParseMs = typeof performance !== 'undefined' ? performance.now() - started : 0;
