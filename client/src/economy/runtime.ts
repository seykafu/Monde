import type Phaser from 'phaser';
import { Inventory, Wallet, Economy, canGift, matchGift, giftRegard, isBirthday, gainXp, type PersonaCard, type Item, type TurnRegard, heartsOf } from '@monde/shared';
import { getFellow, setFellow } from '../fellow/state';
import type { Clock } from '../sim/clock';
import { uuid } from '../mind/api';
import { appendEvent } from '../scenes/events';
import { regardFor, updateFriendship, meetResident } from '../scenes/friendship';
import { removeItem } from './inventory';
import { eat } from './rules';
export const BAG_KEY = 'monde.inventory', COINS_KEY = 'monde.coins', ECONOMY_KEY = 'monde.economy';
type Registry = Phaser.Data.DataManager;
export const bagOf = (r: Registry) => Inventory.parse(r.get(BAG_KEY) ?? {});
export const coinsOf = (r: Registry) => Wallet.parse(r.get(COINS_KEY) ?? {}).balance;
export const economyOf = (r: Registry) => Economy.parse(r.get(ECONOMY_KEY) ?? {});
export function consume(r: Registry, slot: number, item: Item): boolean {
  const bag = bagOf(r); if (bag.slots[slot]?.item !== item.id || item.stamina <= 0) return false;
  const next = removeItem(bag, slot); if (!next) return false;
  r.set(BAG_KEY, next); r.set(ECONOMY_KEY, eat(economyOf(r), item.stamina)); return true;
}
export function giveGift(r: Registry, clock: Clock, card: PersonaCard, slot: number, item: Item): { eventId: string; reaction: ReturnType<typeof matchGift>; regard: TurnRegard } | null {
  const state = economyOf(r), bag = bagOf(r);
  if (!canGift(state, card.id, clock.day) || bag.slots[slot]?.item !== item.id) return null;
  const next = removeItem(bag, slot); if (!next) return null;
  const reaction = matchGift(item, card), before = regardFor(r, card.id);
  const after = Math.max(-100, Math.min(100, before + giftRegard(reaction, { birthday: isBirthday(clock.day, card.birthday) })));
  const event = appendEvent(r, { kind: 'gift', id: uuid(), day: clock.day, minute: clock.minute, resident: card.id, item: item.id });
  if (!event) return null;
  r.set(BAG_KEY, next); r.set(ECONOMY_KEY, { ...state, gifts: { ...state.gifts, [card.id]: clock.day } });
  const fellow = getFellow(r);
  // GDD-GAP: gifts award 10 Heart XP, once per accepted gift.
  if (fellow) setFellow(r, { ...fellow, skills: gainXp(fellow.skills, 'heart', 10) });
  meetResident(r, card.id, clock.day);
  updateFriendship(r, s => ({ ...s, regard: { ...s.regard, [card.id]: after }, residents: { ...s.residents,
    [card.id]: { ...s.residents[card.id]!, regard: after, likes: [...new Set([...s.residents[card.id]!.likes, `${item.name}: ${reaction}`])] } } }));
  return { eventId: event.id, reaction, regard: { before, after, delta: after - before, hearts_before: heartsOf(before), hearts_after: heartsOf(after), first_chat: false, capped: false } };
}

/** §11.3: a shared meal restores stamina and earns +2 Regard outside the talk cap. */
export function shareMeal(r: Registry, clock: Clock, card: PersonaCard, slot: number, item: Item): { eventId: string; regard: TurnRegard } | null {
  if (!item.tags.includes('meal') || !item.stamina || bagOf(r).slots[slot]?.item !== item.id) return null;
  const event = appendEvent(r, { kind: 'meal', id: uuid(), day: clock.day, minute: clock.minute, resident: card.id, item: item.id });
  if (!event || !consume(r, slot, item)) return null;
  const before = regardFor(r, card.id), after = Math.min(100, before + 2);
  meetResident(r, card.id, clock.day);
  updateFriendship(r, s => ({ ...s, regard: { ...s.regard, [card.id]: after }, residents: { ...s.residents, [card.id]: { ...s.residents[card.id]!, regard: after } } }));
  return { eventId: event.id, regard: { before, after, delta: after - before, hearts_before: heartsOf(before), hearts_after: heartsOf(after), first_chat: false, capped: false } };
}
