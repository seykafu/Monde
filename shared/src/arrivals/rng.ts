// Seeded randomness for the arrival pipeline (GDD Appendix A.3.1: "The night pass seeds every random choice with
// hash(world_seed, day, slot), so a reload gives the same archetype, shape and portraits"). Pure.

/** FNV-1a over the parts joined with `|`: a stable 32-bit seed. */
export function hashParts(...parts: readonly (string | number)[]): number {
  const text = parts.join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32: a small, fast, deterministic generator. */
export class SeededRng {
  private state: number;
  constructor(seed: number) { this.state = seed >>> 0 || 0x9e3779b9; }
  static of(...parts: readonly (string | number)[]): SeededRng { return new SeededRng(hashParts(...parts)); }
  /** [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** An integer in [lo, hi]. */
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new RangeError("pick from an empty list");
    return items[Math.floor(this.next() * items.length)]!;
  }
  /** A key by weight (weights ≤ 0 never win); null when nothing has weight. */
  weighted<K>(entries: readonly (readonly [K, number])[]): K | null {
    const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
    if (total <= 0) return null;
    let r = this.next() * total;
    for (const [k, w] of entries) { if (w <= 0) continue; r -= w; if (r < 0) return k; }
    return entries.filter(([, w]) => w > 0).at(-1)![0];
  }
}
