// The loading screen's bar (client/index.html #loading, boot/loadingScreen.ts): how far along a load is. Pure: no
// Phaser, no DOM.
//
// Files count by their size, not one each, so a 220 KB backdrop moves the bar more than a 4 KB lamp post. A file's size
// is known once its response starts (the loader's file progress events); until then it counts as the typical size of
// its kind (expectedBytes), so the bar neither races ahead on a run of small files nor stalls behind a big one. On the
// first launch the game's code, already fetched when the loader starts, counts as done bytes up front: on a slow link
// it is most of the wait. The bar never moves back.

/** Typical sizes by kind, the averages of client/public/assets (2026-10): what a file counts as until it reports in. */
const TYPICAL: readonly (readonly [RegExp, number])[] = [
  [/\.json(?:[?#]|$)/, 1_000],
  [/(?:^|[/:])portraits?[/:]/, 545_000],
  [/\/backdrops\//, 245_000],
  [/(?:^|[/:])town[/:]/, 20_000]
];
/** Anything else. */
export const FALLBACK_BYTES = 24_000;

/** What a file is likely to weigh, from its URL (or its texture key, for a file another load is fetching). */
export function expectedBytes(urlOrKey: string): number {
  return TYPICAL.find(([pattern]) => pattern.test(urlOrKey))?.[1] ?? FALLBACK_BYTES;
}

interface Entry { loaded: number; total: number; expected: number; done: boolean }

export class LoadMeter {
  private readonly files = new Map<string, Entry>();
  private shown = 0;

  /** `head`: bytes already in before the loader started (the game's code on the first launch). */
  constructor(private readonly head = 0) {}

  get count(): { done: number; total: number } {
    let done = 0;
    for (const f of this.files.values()) if (f.done) done++;
    return { done, total: this.files.size };
  }

  /** A file to wait for, counted at `expected` bytes until it says. */
  add(key: string, expected = FALLBACK_BYTES): void {
    if (!this.files.has(key)) this.files.set(key, { loaded: 0, total: 0, expected, done: false });
  }

  /** Bytes in so far for a file, of `total` (0 while unknown). */
  progress(key: string, loaded: number, total: number): void {
    this.add(key);
    const f = this.files.get(key)!;
    if (total > 0) f.total = total;
    f.loaded = Math.max(f.loaded, loaded);
  }

  /** Loaded, or failed: either way it is no longer being waited for. */
  complete(key: string): void {
    this.add(key);
    this.files.get(key)!.done = true;
  }

  /** Bytes in and expected, files not yet sized at their expected size. */
  bytes(): { loaded: number; total: number } {
    let loaded = this.head, total = this.head;
    for (const f of this.files.values()) {
      const size = f.total || Math.max(f.expected, f.loaded);
      total += size;
      loaded += f.done ? size : Math.min(f.loaded, size);
    }
    return { loaded: Math.round(loaded), total: Math.round(total) };
  }

  /** 0 → 1, never less than before. Nothing to load is done. */
  fraction(): number {
    const { loaded, total } = this.bytes();
    this.shown = Math.max(this.shown, total > 0 ? Math.min(1, loaded / total) : 1);
    return this.shown;
  }
}

/** The game's code fetched so far (the page's script resource timings): what the first launch has already waited for. */
export function codeBytes(entries: readonly { name: string; transferSize: number; encodedBodySize: number }[]): number {
  return entries.filter(e => /\.m?js(?:[?#]|$)/.test(e.name)).reduce((sum, e) => sum + (e.transferSize > 0 ? e.transferSize : e.encodedBodySize), 0);
}

/** "0.4 of 1.1 MB", "180 of 220 KB": the bar's quiet second line. */
export function describeBytes(loaded: number, total: number): string {
  if (total >= 1e6) return `${(loaded / 1e6).toFixed(1)} of ${(total / 1e6).toFixed(1)} MB`;
  return `${Math.round(loaded / 1e3)} of ${Math.max(1, Math.round(total / 1e3))} KB`;
}
