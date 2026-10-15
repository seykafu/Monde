// A tiny pixel raster for the procedural character rig: boolean masks built from integer spans and
// a frame that paints them with an automatic 1 px outline. Every coordinate is an integer pixel, so
// the output is hard-edged pixel art with binary alpha (§16.7: "binary alpha hardening for sprites").
// Pure: no Phaser, no DOM (the contact-sheet script and the tests run it under Node).

export class Mask {
  readonly bits: Uint8Array;
  constructor(readonly w: number, readonly h: number) { this.bits = new Uint8Array(w * h); }

  has(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.bits[y * this.w + x] === 1;
  }
  set(x: number, y: number): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.bits[y * this.w + x] = 1;
    return this;
  }
  /** Row y from x0 to x1, inclusive. */
  span(y: number, x0: number, x1: number): this {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y);
    return this;
  }
  /** Consecutive rows from y0: each a list of inclusive [x0, x1] spans (or null for a gap row). */
  rows(y0: number, rows: ReadonlyArray<ReadonlyArray<readonly [number, number]> | null>): this {
    rows.forEach((spans, i) => spans?.forEach(([a, b]) => this.span(y0 + i, a, b)));
    return this;
  }
  rect(x: number, y: number, w: number, h: number): this {
    for (let j = 0; j < h; j++) this.span(y + j, x, x + w - 1);
    return this;
  }
  /** A slanted limb: `width` px wide, its left edge running from x0 (at y0) to x1 (at y1), rounded to whole pixels. */
  strip(x0: number, y0: number, x1: number, y1: number, width: number): this {
    const n = Math.max(1, y1 - y0);
    for (let y = y0; y <= y1; y++) {
      const x = Math.round(x0 + ((x1 - x0) * (y - y0)) / n);
      this.span(y, x, x + width - 1);
    }
    return this;
  }
  add(other: Mask): this {
    for (let i = 0; i < this.bits.length; i++) if (other.bits[i]) this.bits[i] = 1;
    return this;
  }
  cut(other: Mask): this {
    for (let i = 0; i < this.bits.length; i++) if (other.bits[i]) this.bits[i] = 0;
    return this;
  }
  /** Keep only the pixels also in `other`. */
  clip(other: Mask): this {
    for (let i = 0; i < this.bits.length; i++) if (!other.bits[i]) this.bits[i] = 0;
    return this;
  }
  /** Keep only rows y0..y1. */
  band(y0: number, y1: number): this {
    for (let y = 0; y < this.h; y++) if (y < y0 || y > y1) this.bits.fill(0, y * this.w, (y + 1) * this.w);
    return this;
  }
  shifted(dx: number, dy: number): Mask {
    const m = new Mask(this.w, this.h);
    this.each((x, y) => m.set(x + dx, y + dy));
    return m;
  }
  clone(): Mask { return this.shifted(0, 0); }
  each(fn: (x: number, y: number) => void): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.bits[y * this.w + x]) fn(x, y);
  }
  get empty(): boolean { return !this.bits.some(b => b === 1); }
}

export type Fill = number | ((x: number, y: number) => number);

/** One frame: -1 is transparent, anything else 0xRRGGBB. */
export class Frame {
  readonly px: Int32Array;
  constructor(readonly w: number, readonly h: number) { this.px = new Int32Array(w * h).fill(-1); }

  mask(): Mask { return new Mask(this.w, this.h); }
  get(x: number, y: number): number { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x]! : -1; }
  dot(x: number, y: number, c: number): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
    return this;
  }
  /** Paint over pixels that are already opaque only (details that must not grow the silhouette). */
  decal(m: Mask, fill: Fill): this {
    m.each((x, y) => { if (this.get(x, y) >= 0) this.dot(x, y, typeof fill === 'number' ? fill : fill(x, y)); });
    return this;
  }
  /**
   * Fill a mask, first ringing it (4-neighbours, so corners stay soft) with an edge colour: `line`
   * where the ring falls on transparent pixels (the silhouette's outline), `inner` where it falls on a
   * part already painted (a softer line between overlapping parts). One fixed tone each, so a sprite
   * keeps a small palette.
   */
  paint(m: Mask, fill: Fill, edge: { line: number; inner: number } | null = null): this {
    if (edge) {
      const ringed = new Uint8Array(this.w * this.h);
      m.each((x, y) => {
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
          if (m.has(nx, ny) || nx < 0 || ny < 0 || nx >= this.w || ny >= this.h || ringed[ny * this.w + nx]) continue;
          ringed[ny * this.w + nx] = 1;
          this.dot(nx, ny, this.get(nx, ny) < 0 ? edge.line : edge.inner);
        }
      });
    }
    m.each((x, y) => this.dot(x, y, typeof fill === 'number' ? fill : fill(x, y)));
    return this;
  }
  /** Copy into an RGBA buffer `stride` px wide at (ox, oy), optionally mirrored left-right. */
  blit(out: Uint8ClampedArray, stride: number, ox: number, oy: number, mirror = false): void {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.px[y * this.w + (mirror ? this.w - 1 - x : x)]!;
      const i = ((oy + y) * stride + ox + x) * 4;
      if (c < 0) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }
      out[i] = (c >> 16) & 0xff; out[i + 1] = (c >> 8) & 0xff; out[i + 2] = c & 0xff; out[i + 3] = 255;
    }
  }
}

/**
 * Directional shading for a part lit from the upper left (the board's low west-south-west sun):
 * `right` px along the right edge and `bottom` px along the bottom in shade, `left` px on the left
 * edge and `top` px on the top edge in light.
 */
export function lit(m: Mask, tones: { light: number; base: number; shade: number },
  o: { right?: number; bottom?: number; left?: number; top?: number } = {}): (x: number, y: number) => number {
  const near = (x: number, y: number, dx: number, dy: number, n = 0) => {
    for (let i = 1; i <= n; i++) if (!m.has(x + dx * i, y + dy * i)) return true;
    return false;
  };
  return (x, y) => {
    if (near(x, y, 1, 0, o.right) || near(x, y, 0, 1, o.bottom)) return tones.shade;
    if (near(x, y, -1, 0, o.left) || near(x, y, 0, -1, o.top)) return tones.light;
    return tones.base;
  };
}
