import { BAG_SLOTS, type Inventory, type Item } from '@monde/shared';
export const emptyInventory = (): Inventory => ({ slots: Array.from({ length: BAG_SLOTS }, () => null) });
const quantity = (n: number) => Number.isSafeInteger(n) && n > 0;
/** Atomic: a full bag leaves the original untouched. */
export function addItem(bag: Inventory, item: Item, count = 1): Inventory | null {
  if (!quantity(count)) return null;
  const slots = bag.slots.map(s => s && { ...s });
  let left = count;
  for (const s of slots) if (s?.item === item.id) { const n = Math.min(left, Math.max(0, item.stack - s.count)); s.count += n; left -= n; }
  for (let i = 0; i < slots.length && left; i++) if (!slots[i]) { const n = Math.min(left, item.stack); slots[i] = { item: item.id, count: n }; left -= n; }
  return left ? null : { slots };
}
export function removeItem(bag: Inventory, slot: number, count = 1): Inventory | null {
  const s = bag.slots[slot];
  if (!Number.isInteger(slot) || !s || !quantity(count) || s.count < count) return null;
  return { slots: bag.slots.map((v, i) => i !== slot ? v : s.count === count ? null : { ...s, count: s.count - count }) };
}
export function moveItem(bag: Inventory, from: number, to: number, catalog: readonly Item[]): Inventory {
  if (![from, to].every(i => Number.isInteger(i) && i >= 0 && i < BAG_SLOTS) || from === to) return bag;
  const a = bag.slots[from], b = bag.slots[to]; if (!a) return bag;
  const slots = [...bag.slots];
  if (b?.item === a.item) {
    const cap = catalog.find(i => i.id === a.item)?.stack; if (!cap) return bag;
    const n = Math.min(a.count, cap - b.count);
    slots[to] = { ...b, count: b.count + n }; slots[from] = a.count === n ? null : { ...a, count: a.count - n };
  } else { slots[to] = a; slots[from] = b ?? null; }
  return { slots };
}
export function changeCoins(balance: number, delta: number): number | null {
  const next = balance + delta;
  return Number.isSafeInteger(balance) && balance >= 0 && Number.isSafeInteger(delta) && Number.isSafeInteger(next) && next >= 0 ? next : null;
}
