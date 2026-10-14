// Mulberry32 — small, deterministic PRNG. Lets us run battles repeatably.
export class Rng {
  private state: number;
  constructor(seed = Date.now()) {
    this.state = seed >>> 0;
  }
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  intRange(min: number, maxExclusive: number): number {
    return Math.floor(this.next() * (maxExclusive - min)) + min;
  }
  // Roll a percent check (0..100).
  rollPercent(threshold: number): boolean {
    return this.next() * 100 < threshold;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.intRange(0, arr.length)] as T;
  }
}

export const globalRng = new Rng();
