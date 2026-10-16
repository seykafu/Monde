// Everyone with a Persona Card in this game (GDD §9.3): the authored cards (world/residents.ts) and the generated
// residents who have arrived since (G-02, Appendix A.3), in one roster the scenes look people up in.
//
// The town engine's state is the source of truth for the generated ones (TownState.people, saved with the town);
// scenes/migration.ts mirrors it here whenever the town changes, so lookups that can't reach the registry (module
// constants, the dialogue's card lookup, name tables) still find a newcomer. Pure: no Phaser.
import { firstArrival, livingArrivals, type PersonaCard, type TownPeople } from '@monde/shared';
import { personaCards } from './residents';

export interface RosterEntry {
  card: PersonaCard;
  /** Roster position: the colour a resident's sprite, name tag and portrait frame wear. Stable while they live here. */
  index: number;
}

let generated: readonly PersonaCard[] = [];
/** Generated ids in the order they first appeared: their index never shifts when someone leaves. */
const order: string[] = [];
let byId = new Map<string, RosterEntry>(personaCards.map((card, index) => [card.id, { card, index }]));
let arrivalAlias: string | null = null;
const listeners = new Set<() => void>();

const rebuild = (): void => {
  byId = new Map<string, RosterEntry>(personaCards.map((card, index) => [card.id, { card, index }]));
  for (const card of generated) byId.set(card.id, { card, index: personaCards.length + order.indexOf(card.id) });
};

/**
 * The generated residents now: those living in town and those on today's boat (their sprites exist before they step
 * off, hidden until 08:00). Notifies listeners when the set or a card changed.
 */
export function setGeneratedCards(cards: readonly PersonaCard[]): void {
  if (cards.length === generated.length && cards.every((c, i) => c === generated[i])) return;
  for (const c of cards) if (!order.includes(c.id)) order.push(c.id);
  generated = [...cards];
  rebuild();
  for (const fn of listeners) fn();
}

/** Mirror the town's generated residents (and S05's `arrival` alias) into the roster. */
export function syncRoster(people: TownPeople | undefined, day?: number): void {
  const cards = [...livingArrivals(people), ...(people?.pending ?? []).flatMap(h => h.residents)].map(r => r.card);
  arrivalAlias = firstArrival(people, day)?.card.id ?? null;
  setGeneratedCards(cards);
}

/** Every card: the authored ones, then the generated residents. */
export const allCards = (): readonly PersonaCard[] => [...personaCards, ...generated];
export const generatedCards = (): readonly PersonaCard[] => generated;
export const rosterEntry = (id: string): RosterEntry | undefined => byId.get(resolveAlias(id));
export const findCard = (id: string): PersonaCard | undefined => rosterEntry(id)?.card;

/** S05's scripted `arrival` is the first real arrival once there is one (§13.3); anything else is itself. */
export const resolveAlias = (id: string): string => (id === 'arrival' && arrivalAlias ? arrivalAlias : id);
export const arrivalId = (): string | null => arrivalAlias;

/** Called whenever the roster changes; returns the unsubscribe. */
export function onRosterChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests: back to the authored cards only. */
export function resetRoster(): void {
  generated = []; order.length = 0; arrivalAlias = null; rebuild();
}
