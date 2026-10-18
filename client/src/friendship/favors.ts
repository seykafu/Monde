import { instantiateFavor, type LeavingFavorNotice } from "@monde/shared";
import { allCards, findCard } from "../world/roster";
import { livingArrivals } from "@monde/shared";
import { departureDay, resolveNotice, stayFactors, stayInputsOf } from "../town/people";
import { friendsInTown } from "../scenes/migration";
import { items } from "../economy/content";
import { getTown } from "../scenes/TownLedgerScene";
import { acceptFavor, canCompleteFavor, type Favor, type FavorProof, type FavorWorld } from '@monde/shared';
import type Phaser from 'phaser';
import type { Clock } from '../sim/clock';
import { getFriendship, updateFriendship } from '../scenes/friendship';
import { bagOf, coinsOf, BAG_KEY, COINS_KEY } from '../economy/runtime';
import { addItem, removeItem } from '../economy/inventory';
import { itemById } from '../economy/content';
import { appendEvent } from '../scenes/events';
import type { ResidentSim } from '../sim/residentSim';
import { standingPlace, placeArrival } from '../world/interiors';
import { interiors, zones, boards } from '../world/zones';
type Registry = Phaser.Data.DataManager;
export const reachableFavorPlace = (place: string): boolean => !!placeArrival(zones, interiors, standingPlace(interiors, place));
const favorPlaces = new Set(Object.values(boards).flatMap(z => z.places.map(p => `${z.interior?.district ?? z.id}.${p.id}`)).concat(allCards().map(c => c.home)));
const favorResident = (c: ReturnType<typeof allCards>[number], reachable: boolean) => ({ home: c.home, workplace: c.workplace, places: [...c.routine.weekday, ...c.routine.weekend].map(b => b.where), reachable });
export const favorBook = (r: Registry) => getFriendship(r).favor_book;
export function chooseFavor(r: Registry, id: string, day: number, accept: boolean, minute = 360): boolean {
  const all = favorBook(r), f = all.find(x => x.id === id); if (!f) return false;
  if (accept && f.template !== 'last_chance' && !instantiateFavor({ template:f.template,target:f.target,text:f.text },f.id,f.resident_id,{
    day:f.created_day,items:new Set(items.map(i => i.id)),places:favorPlaces, reachablePlace:reachableFavorPlace,
    residents:new Map(allCards().map(c => [c.id,favorResident(c,getFriendship(r).tiers[c.id] !== 'ambient' || c.id === f.resident_id)])),
    met:(a,b) => (getFriendship(r).ties?.pairs ?? []).some(t => t.a === a && t.b === b || t.a === b && t.b === a) || (findCard(a)?.relationships.some(t => t.id === b) ?? false),
  })) return false;
  const next = accept ? acceptFavor(f,day,all) : f.status === 'proposed' ? { ...f, status: 'declined' as const } : null;
  if (!next) return false;
  let parcelBag: ReturnType<typeof bagOf> | null = null;
  if (accept && f.task.kind === 'delivery' && f.task.item) {
    const item = itemById(f.task.item); if (!item) return false;
    const bag = addItem(bagOf(r),item); if (!bag) return false; parcelBag = bag;
  }
  if (!appendEvent(r,{ kind: 'favor_choice',id: `favor_choice_${id}`,favor: id,resident:f.resident_id,day,minute,accept,...(f.id.startsWith('quiet_chore_') || f.id.startsWith('dream_') ? { offered_day: f.created_day } : {}),notice:f.notice })) return false;
  if (parcelBag) r.set(BAG_KEY,parcelBag);
  updateFriendship(r,s => ({ ...s, favor_book: s.favor_book.map(x => x.id === id ? next : x) })); return true;
}
export function finishFavor(r: Registry, clock: Clock, f: Favor, proof: FavorProof, slot?: number): boolean {
  if (!canCompleteFavor(f,clock.day,proof) || favorBook(r).find(x => x.id === f.id)?.status !== 'accepted') return false;
  let bag = bagOf(r);
  if (f.task.item) { if (slot === undefined || bag.slots[slot]?.item !== f.task.item) return false; const next = removeItem(bag,slot); if (!next) return false; bag = next; }
  for (const reward of f.reward.items) { const item = itemById(reward.item); if (!item) return false; const next = addItem(bag,item,reward.count); if (!next) return false; bag = next; }
  if (!appendEvent(r,{ kind: 'favor_done', id: `favor_done_${f.id}`, favor: f.id, resident: f.resident_id, day: clock.day, minute: clock.minute, proof })) return false;
  if (f.template === 'last_chance') {
    // §6.4: done in time, they stay (the +10 Regard is the Favor's reward).
    const town = getTown(r);
    if (town) r.set('monde.town', resolveNotice(town, f.resident_id, clock.day));
  }
  r.set(BAG_KEY,bag); r.set(COINS_KEY,{ balance: coinsOf(r) + f.reward.coins });
  updateFriendship(r,s => ({ ...s, favor_book: s.favor_book.map(x => x.id === f.id ? { ...x,status: 'completed' } : x) })); return true;
}
export function favorProof(r: Registry, clock: Clock, f: Favor, resident: string, place: string, player?: { x: number; y: number }): FavorProof {
  const sim = r.get('monde.residents') as ResidentSim | undefined;
  const here = sim?.sample(resident,clock.day,clock.minute);
  const nearby = sim?.profiles.filter(p => { const other = sim.sample(p.id,clock.day,clock.minute); return here?.position && other?.position && here.zone === other.zone && Math.hypot((player ?? here.position).x-other.position.x,(player ?? here.position).y-other.position.y) <= 3; }).map(p => p.id) ?? [];
  return { kind: f.task.kind, place, resident, item: f.task.item, nearby, minutes: 0, found: f.found };
}
export function favorInteraction(r: Registry, clock: Clock, place: string): { label: string; run(): void } | null {
  // A home upstairs (a flat over the shop) is done from the room below (world/interiors.ts standingPlace).
  const f = favorBook(r).find(x => x.status === 'accepted' && x.expires_day >= clock.day && standingPlace(interiors, x.task.place) === place && (x.task.kind === 'chore' || x.task.kind === 'find' && !x.found));
  if (!f) return null;
  return { label: f.task.kind === 'find' ? 'Look for the lost item' : `Help with the chore (${f.task.minutes} min)`, run: () => {
    if (clock.paused) return;
    if (f.task.kind === 'find') {
      const item = itemById(f.task.item!); if (!item) return; const bag = addItem(bagOf(r),item); if (!bag) return;
      r.set(BAG_KEY,bag); updateFriendship(r,s => ({ ...s, favor_book: s.favor_book.map(x => x.id === f.id ? { ...x, found: true } : x) }));
    } else if (clock.minute + f.task.minutes <= 1560) {
      if (finishFavor(r,clock,f,{ ...favorProof(r,clock,f,f.resident_id,f.task.place), minutes: f.task.minutes })) clock.advanceMinutes(f.task.minutes);
    }
  } };
}

export function leavingFavors(r: Registry, day: number): LeavingFavorNotice[] {
  const town = getTown(r); if (!town) return [];
  return Object.entries(town.migration.notices).flatMap(([resident,given]) => {
    const card = findCard(resident); if (!card) return [];
    // §6.4: two days before the ferry they'd leave on (the first sailing at least two days after the notice).
    const deadline = departureDay(given, town.flags);
    if (day !== deadline - 2) return [];
    // G-02: a generated resident's own Stay factors (friends from the ties, roots from their tenure); an authored
    // card's from its card (GDD-GAP: no years-in-Monde field, so the cast keep the full 10 for roots).
    const arrival = livingArrivals(town.people).find(a => a.card.id === resident);
    const factors = arrival ? stayFactors(stayInputsOf(arrival, day, { friends: id => friendsInTown(r, id) }), town.pillars) : {
      town: 60 * Object.entries(card.values).reduce((n,[k,v]) => n + v * town.pillars[k as keyof typeof town.pillars] / 100,0),
      friends: 20*Math.min(1,card.relationships.filter(t => t.affinity >= 40).length/4), purpose: card.occupation ? 10 : 0, roots: 10 };
    return [{ resident,deadline,factors }];
  });
}
export function localLastChances(r: Registry, day: number): void {
  for (const notice of leavingFavors(r,day)) {
    const all = favorBook(r);
    const id = `last_chance_${notice.resident}_${notice.deadline}`;
    if (all.some(f => f.id === id || f.resident_id === notice.resident && ['accepted','proposed'].includes(f.status)) || all.filter(f => ['accepted','proposed'].includes(f.status)).length >= 6) continue;
    const f = instantiateFavor({ template: 'last_chance',target: notice.resident,text: 'Before the ferry goes, could you help me put one thing right?' },id,notice.resident,{
      day,items: new Set(items.map(i => i.id)), places: favorPlaces, reachablePlace: reachableFavorPlace,residents: new Map(allCards().map(c => [c.id,favorResident(c,c.kind === 'canon' || getFriendship(r).tiers[c.id] === 'acquainted' || c.id === notice.resident)])),
      met: (a,b) => (getFriendship(r).ties?.pairs ?? []).some(t => t.a === a && t.b === b || t.a === b && t.b === a) || (findCard(a)?.relationships.some(t => t.id === b) ?? false), leaving: new Map([[notice.resident,notice]]),
    });
    if (f) updateFriendship(r,s => ({ ...s,favor_book: [...s.favor_book,f] }));
  }
}

/** The world Quiet Mode's own Favors are made in (localTemplateFavors, the dreams' stage Favors): met residents are reachable. */
export function localFavorWorld(r: Registry, day: number): FavorWorld {
  const state = getFriendship(r);
  return { day, items: new Set(items.map(i => i.id)), places: favorPlaces, reachablePlace: reachableFavorPlace, met: () => true,
    residents: new Map(allCards().map(c => [c.id, favorResident(c, c.kind !== 'animal' && !!state.residents[c.id])])) };
}

/** M-11: deterministic template requests, also used when the dawn service is unavailable. */
export function localTemplateFavors(r: Registry, day: number): void {
  const state = getFriendship(r);
  const residents = new Map(allCards().map(c => [c.id, favorResident(c, c.kind !== 'animal' && !!state.residents[c.id])]));
  // GDD-GAP: Quiet Mode has no authored request cadence. Offer each met resident one chore per five-day expiry window.
  for (const owner of Object.keys(state.residents).sort()) {
    const all = favorBook(r), id = `quiet_chore_${owner}_${Math.floor((day - 1) / 5)}`;
    const open = all.filter(f => ['proposed', 'accepted'].includes(f.status) && f.expires_day >= day);
    if (open.length >= 6) break;
    if (all.some(f => f.id === id) || open.some(f => f.resident_id === owner)) continue;
    const f = instantiateFavor({ template: 'help_chore', target: owner, text: 'Could you lend a hand with a chore? Half an hour would help.' }, id, owner, {
      day, items: new Set(items.map(i => i.id)), places: favorPlaces, residents, reachablePlace: reachableFavorPlace, met: () => true,
    });
    if (f) updateFriendship(r, s => ({ ...s, favor_book: [...s.favor_book, f] }));
  }
}
