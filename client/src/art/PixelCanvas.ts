// Tiny abstraction over an offscreen 2D canvas for drawing pixel art procedurally,
// then handing the resulting bitmap to Phaser as a texture.
//
// HD supersampling (SSAA): when `scale` > 1 the drawing buffer is
// `scale×` larger than the logical size and the 2D context is pre-scaled
// by that factor. All drawing code keeps working in LOGICAL coordinates
// (this.width / this.height report the logical size, and every method
// takes logical x/y/w/h) — the transform maps each logical unit onto a
// `scale×scale` device block. Curves, ellipses, and gradients are
// rasterised at the higher device resolution, so they gain genuine
// detail; hand-placed 1px features stay full-strength. The `canvas`
// getter downsamples that high-res buffer back to the logical dimensions
// with smoothing, so the texture handed to Phaser is exactly the size it
// always was — no layout or display-site changes anywhere.

import { ART_SCALE } from "../util/constants";

export class PixelCanvas {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;   // logical
  readonly height: number;  // logical
  readonly scale: number;   // supersampling factor (>= 1)
  // The high-resolution buffer we actually draw into (width*scale × height*scale).
  private readonly buffer: HTMLCanvasElement;

  constructor(width: number, height: number, scale: number = ART_SCALE) {
    this.width = width;
    this.height = height;
    this.scale = Math.max(1, Math.floor(scale));
    this.buffer = document.createElement("canvas");
    this.buffer.width = width * this.scale;
    this.buffer.height = height * this.scale;
    const ctx = this.buffer.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D context unavailable");
    // Keep intra-texture pixels crisp while drawing; the only smoothing
    // happens in the single downsample step in the `canvas` getter.
    ctx.imageSmoothingEnabled = false;
    if (this.scale !== 1) ctx.scale(this.scale, this.scale);
    this.ctx = ctx;
  }

  // Logical-resolution canvas handed to Phaser via textures.addCanvas.
  // At scale 1 this is the buffer itself (byte-identical to the old
  // behaviour). When supersampling, the high-res buffer is downsampled
  // once into a fresh logical-size canvas (smoothed) so the resulting
  // texture is anti-aliased but keeps its original dimensions. Generated
  // fresh on each access so a draw → read → draw-more → read sequence
  // never returns a stale snapshot (callers today read exactly once).
  get canvas(): HTMLCanvasElement {
    if (this.scale === 1) return this.buffer;
    const out = document.createElement("canvas");
    out.width = this.width;
    out.height = this.height;
    const octx = out.getContext("2d", { alpha: true });
    if (!octx) throw new Error("2D context unavailable");
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(this.buffer, 0, 0, this.width, this.height);
    return out;
  }

  clear(): void {
    // clearRect respects the active transform, so logical coords are correct.
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  fillRect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    this.ctx.fillStyle = colorToCss(color, alpha);
    this.ctx.fillRect(x, y, w, h);
  }

  pixel(x: number, y: number, color: number, alpha = 1): void {
    this.ctx.fillStyle = colorToCss(color, alpha);
    this.ctx.fillRect(x, y, 1, 1);
  }

  // Symmetric brush: mirrors the pixel about the vertical centerline. Useful for character art.
  pixelMirror(x: number, y: number, color: number, alpha = 1): void {
    const cx = (this.width - 1) - x;
    this.pixel(x, y, color, alpha);
    if (cx !== x) this.pixel(cx, y, color, alpha);
  }

  outlineRect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    this.ctx.strokeStyle = colorToCss(color, alpha);
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  // Lighten or darken a pixel: simple multiplicative shading useful for "3D" volume.
  shadePixel(x: number, y: number, factor: number): void {
    // getImageData is NOT affected by the context transform — it always
    // addresses device pixels. So sample the top-left device pixel of this
    // logical cell, but fill in LOGICAL coords (the transform expands the
    // fill back across the whole scale×scale block).
    const s = this.scale;
    const data = this.ctx.getImageData(x * s, y * s, 1, 1).data;
    const r = clamp255(data[0]! * factor);
    const g = clamp255(data[1]! * factor);
    const b = clamp255(data[2]! * factor);
    this.ctx.fillStyle = `rgba(${r},${g},${b},${(data[3]! / 255).toFixed(3)})`;
    this.ctx.fillRect(x, y, 1, 1);
  }
}

const clamp255 = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

export const colorToCss = (color: number, alpha = 1): string => {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
};

export const mixColor = (a: number, b: number, t: number): number => {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bx = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bx;
};

export const lightenColor = (c: number, amount: number): number => mixColor(c, 0xffffff, amount);
export const darkenColor = (c: number, amount: number): number => mixColor(c, 0x000000, amount);
