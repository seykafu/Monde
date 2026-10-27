// The background fetcher's queue (boot/textureFetch.ts): which file to fetch next. Pure: no Phaser, no DOM.
//
//   now    a scene is waiting on it (a portrait as its conversation opens)
//   soon   wanted shortly (the portrait of a resident the player is walking up to)
//   idle   the other boards' sprites, fetched while nothing else is loading
//
// Higher priority first, then first asked. Asking again for a queued file can raise its priority, never lower it.

export type FetchPriority = 'now' | 'soon' | 'idle';

const RANK: Readonly<Record<FetchPriority, number>> = { now: 0, soon: 1, idle: 2 };

export class FetchQueue<T extends { key: string }> {
  private readonly waiting = new Map<string, { item: T; rank: number; order: number }>();
  private asked = 0;

  get size(): number { return this.waiting.size; }

  has(key: string): boolean { return this.waiting.has(key); }

  /** Queue an item, or raise a queued one to `priority` if that is higher. */
  push(item: T, priority: FetchPriority): void {
    const rank = RANK[priority], queued = this.waiting.get(item.key);
    if (!queued) this.waiting.set(item.key, { item, rank, order: this.asked++ });
    else if (rank < queued.rank) queued.rank = rank;
  }

  /** Take up to `n` items, most wanted first; idle ones only when `idle` is allowed. */
  take(n: number, idle = true): T[] {
    const ready = [...this.waiting.values()].filter(w => idle || w.rank < RANK.idle)
      .sort((a, b) => a.rank - b.rank || a.order - b.order).slice(0, Math.max(0, n));
    for (const w of ready) this.waiting.delete(w.item.key);
    return ready.map(w => w.item);
  }

  /** Drop a queued item (someone else fetches it now). True if it was queued. */
  remove(key: string): boolean { return this.waiting.delete(key); }

  /** Drop everything queued at `priority` (the idle list, before it is queued again in a new order). */
  clear(priority: FetchPriority): void {
    for (const [key, w] of this.waiting) if (w.rank === RANK[priority]) this.waiting.delete(key);
  }
}
