import { instantiateFavor, type LeavingFavorNotice } from "@monde/shared";
import { personaCards } from "../world/residents";
import { items } from "../economy/content";
import { getTown } from "../scenes/TownLedgerScene";
import { isFerryDay } from "../town/migration";
import { acceptFavor, canCompleteFavor, type Favor, type FavorProof } from '@monde/shared';
import type Phaser from 'phaser';
import type { Clock } from '../sim/clock';
import { getFriendship, updateFriendship } from '../scenes/friendship';
import { bagOf, coinsOf, BAG_KEY, COINS_KEY } from '../economy/runtime';
import { addItem, removeItem } from '../economy/inventory';
import { itemById } from '../economy/content';
import { appendEvent } from '../scenes/events';
import type { ResidentSim } from '../sim/residentSim';
type Registry = Phaser.Data.DataManager;
export const favorBook = (r: Registry) => getFriendship(r).favor_book;
export function chooseFavor(r: Registry, id: string, day: number, accept: boolean, minute = 360): boolean {
  const all = favorBook(r), f = all.find(x => x.id === id); if (!f) return false;
  if (accept && f.template !== 'last_chance' && !instantiateFavor({ template:f.template,target:f.target,text:f.text },f.id,f.resident_id,{
    day:f.created_day,items:new Set(items.map(i => i.id)),places:new Set(personaCards.map(c => c.home)),
    residents:new Map(personaCards.map(c => [c.id,{ home:c.home,reachable:getFriendship(r).tiers[c.id] !== 'ambient' || c.id === f.resident_id }])),
    met:(a,b) => (getFriendship(r).ties?.pairs ?? []).some(t => t.a === a && t.b === b || t.a === b && t.b === a) || (personaCards.find(c => c.id === a)?.relationships.some(t => t.id === b) ?? false),
  })) return false;
  const next = accept ? acceptFavor(f,day,all) : f.status === 'proposed' ? { ...f, status: 'declined' as const } : null;
  if (!next) return false;
  let parcelBag: ReturnType<typeof bagOf> | null = null;
  if (accept && f.task.kind === 'delivery' && f.task.item) {
    const item = itemById(f.task.item); if (!item) return false;
    const bag = addItem(bagOf(r),item); if (!bag) return false; parcelBag = bag;
  }
  if (!appendEvent(r,{ kind: 'favor_choice',id: `favor_choice_${id}`,favor: id,resident:f.resident_id,day,minute,accept,notice:f.notice })) return false;
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
    const town = getTown(r);
    if (town) { const notices = { ...town.migration.notices }, lowStayNights = { ...town.migration.lowStayNights }; delete notices[f.resident_id]; delete lowStayNights[f.resident_id]; r.set('monde.town',{ ...town,migration: { notices,lowStayNights } }); }
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
  const f = favorBook(r).find(x => x.status === 'accepted' && x.expires_day >= clock.day && x.task.place === place && (x.task.kind === 'chore' || x.task.kind === 'find' && !x.found));
  if (!f) return null;
  return { label: f.task.kind === 'find' ? 'Look for the lost item' : `Help with the chore (${f.task.minutes} min)`, run: () => {
    if (clock.paused) return;
    if (f.task.kind === 'find') {
      const item = itemById(f.task.item!); if (!item) return; const bag = addItem(bagOf(r),item); if (!bag) return;
      r.set(BAG_KEY,bag); updateFriendship(r,s => ({ ...s, favor_book: s.favor_book.map(x => x.id === f.id ? { ...x, found: true } : x) }));
    } else if (clock.minute + f.task.minutes <= 1560) {
      if (finishFavor(r,clock,f,{ ...favorProof(r,clock,f,f.resident_id,place), minutes: f.task.minutes })) clock.advanceMinutes(f.task.minutes);
    }
  } };
}

export function leavingFavors(r: Registry, day: number): LeavingFavorNotice[] {
  const town = getTown(r); if (!town) return [];
  return Object.entries(town.migration.notices).flatMap(([resident,given]) => {
    const card = personaCards.find(c => c.id === resident); if (!card) return [];
    let deadline = given + 2; while (!isFerryDay(deadline,town.flags)) deadline++;
    if (day !== deadline - 2) return [];
    const friends = card.relationships.filter(t => t.affinity >= 40).length;
    // GDD-GAP: cards have no years-in-Monde field. Existing residents' roots use the full 10; generated arrivals need tenure data.
    return [{ resident,deadline,factors: { town: 60 * Object.entries(card.values).reduce((n,[k,v]) => n + v * town.pillars[k as keyof typeof town.pillars] / 100,0), friends: 20*Math.min(1,friends/4), purpose: card.occupation ? 10 : 0, roots: 10 } }];
  });
}
export function localLastChances(r: Registry, day: number): void {
  for (const notice of leavingFavors(r,day)) {
    const all = favorBook(r);
    const id = `last_chance_${notice.resident}_${notice.deadline}`;
    if (all.some(f => f.id === id || f.resident_id === notice.resident && ['accepted','proposed'].includes(f.status)) || all.filter(f => ['accepted','proposed'].includes(f.status)).length >= 6) continue;
    const f = instantiateFavor({ template: 'last_chance',target: notice.resident,text: 'Before the ferry goes, could you help me put one thing right?' },id,notice.resident,{
      day,items: new Set(items.map(i => i.id)), places: new Set(personaCards.map(c => c.home)),residents: new Map(personaCards.map(c => [c.id,{ home: c.home,reachable: c.kind === 'canon' || getFriendship(r).tiers[c.id] === 'acquainted' || c.id === notice.resident }])),
      met: (a,b) => personaCards.find(c => c.id === a)?.relationships.some(t => t.id === b) ?? false, leaving: new Map([[notice.resident,notice]]),
    });
    if (f) updateFriendship(r,s => ({ ...s,favor_book: [...s.favor_book,f] }));
  }
}
