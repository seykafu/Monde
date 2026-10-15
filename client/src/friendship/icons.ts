// Pixel icons for friendship (GDD §9.11.1 hearts, §16.5 emotes, §16.6 UI): the name plate's and People page's hearts
// and the emotes that float over residents who meet. Drawn on the character rig's raster (render/character/pixels)
// so they share its look: hard 1 px outlines, a light upper-left and a shaded lower-right, binary alpha. The world
// emotes add a cream halo so they read over cobbles and grass alike. Pure: no Phaser, no DOM.
import { HEARTS, type HeartRow, type PairEmote } from '@monde/shared';
import { Frame, Mask, lit } from '../render/character/pixels';

export interface IconArt { w: number; h: number; data: Uint8ClampedArray }
export type HeartIcon = 'full' | 'half' | 'empty' | 'cracked';
export type EmoteIcon = PairEmote['id'];

/** The ten icons a heart row shows (§9.11.1), or the one cracked heart below 0 Regard. */
export function heartIconsFor(row: HeartRow): HeartIcon[] {
  if (row.cracked) return ['cracked'];
  return Array.from({ length: HEARTS.max }, (_, i) => (i < row.full ? 'full' : i === row.full && row.half ? 'half' : 'empty'));
}

const toArt = (f: Frame): IconArt => {
  const data = new Uint8ClampedArray(f.w * f.h * 4);
  f.blit(data, f.w, 0, 0);
  return { w: f.w, h: f.h, data };
};

const dilate = (m: Mask): Mask => m.clone().add(m.shifted(1, 0)).add(m.shifted(-1, 0)).add(m.shifted(0, 1)).add(m.shifted(0, -1));

// ── Hearts: 9×8 inside an 11×10 cell (the outline takes the margin) ──────────

export const HEART_CELL = { w: 11, h: 10 } as const;

const heartMask = (): Mask => new Mask(HEART_CELL.w, HEART_CELL.h).rows(1, [
  [[2, 3], [7, 8]], [[1, 4], [6, 9]], [[1, 9]], [[1, 9]], [[2, 8]], [[3, 7]], [[4, 6]], [[5, 5]]
]);

const RED = { light: 0xff8c98, base: 0xe0475a, shade: 0xa92b42 } as const;
const HOLLOW = { light: 0x77605a, base: 0x5c4943, shade: 0x46362f } as const;
const STONE = { light: 0xc2c6d0, base: 0x969cab, shade: 0x6d7383 } as const;
const HEART_LINE = 0x2a1418;
const CRACK_LINE = 0x262932;

export function heartIcon(kind: HeartIcon): IconArt {
  const f = new Frame(HEART_CELL.w, HEART_CELL.h);
  const m = heartMask();
  const edge = { line: kind === 'cracked' ? CRACK_LINE : HEART_LINE, inner: kind === 'cracked' ? CRACK_LINE : HEART_LINE };
  const shading = { top: 1, left: 1, right: 1, bottom: 1 };
  if (kind === 'half') {
    const left = m.clone().clip(new Mask(m.w, m.h).rect(0, 0, 6, m.h));
    f.paint(m, lit(m, HOLLOW, shading), edge);
    f.decal(left, lit(m, RED, shading));
  } else {
    f.paint(m, lit(m, kind === 'full' ? RED : kind === 'empty' ? HOLLOW : STONE, shading), edge);
  }
  if (kind === 'full' || kind === 'half') f.dot(3, 3, 0xffd6dc);
  if (kind === 'cracked') for (const [x, y] of [[5, 2], [4, 3], [5, 4], [6, 5], [5, 6], [5, 7]] as const) f.dot(x, y, m.has(x, y) ? CRACK_LINE : -1);
  return toArt(f);
}

// ── Emotes: 16×16 (§16.5) ───────────────────────────────────────────────────

export const EMOTE_CELL = 16;
const HALO = 0xfff4dc;
const EMOTE_COLOURS: Readonly<Record<EmoteIcon, { tones: { light: number; base: number; shade: number }; line: number }>> = {
  heart: { tones: RED, line: HEART_LINE },
  note: { tones: { light: 0x7ea6e0, base: 0x3f6fb8, shade: 0x2c4f8a }, line: 0x141c30 },
  ellipsis: { tones: { light: 0x8a8590, base: 0x625d69, shade: 0x4a4650 }, line: 0x1d1a20 },
  anger: { tones: { light: 0xff7d6a, base: 0xd8392d, shade: 0xa3241b }, line: 0x3d0e0b }
};

function emoteMask(id: EmoteIcon): Mask {
  const m = new Mask(EMOTE_CELL, EMOTE_CELL);
  switch (id) {
    case 'heart':
      return m.rows(3, [[[3, 5], [9, 11]], [[2, 6], [8, 12]], [[2, 12]], [[2, 12]], [[2, 12]], [[3, 11]], [[4, 10]], [[5, 9]], [[6, 8]], [[7, 7]]]);
    case 'note':
      // A quaver: an oval head low left, a stem and a flag.
      m.rows(9, [[[4, 7]], [[3, 8]], [[3, 8]], [[4, 7]]]);
      m.rect(7, 2, 2, 9);
      return m.rows(2, [[[9, 10]], [[9, 11]], [[10, 12]], [[11, 12]], [[11, 12]], [[11, 11]]]);
    case 'ellipsis':
      return m.rect(3, 8, 2, 2).rect(7, 8, 2, 2).rect(11, 8, 2, 2);
    case 'anger':
      // Four corner brackets around an open middle (the 💢 mark).
      return m.rect(5, 2, 2, 4).rect(2, 5, 5, 2).rect(9, 2, 2, 4).rect(9, 5, 5, 2)
        .rect(2, 9, 5, 2).rect(5, 9, 2, 4).rect(9, 9, 5, 2).rect(9, 9, 2, 4);
  }
}

export function emoteIcon(id: EmoteIcon): IconArt {
  const f = new Frame(EMOTE_CELL, EMOTE_CELL);
  const m = emoteMask(id);
  const { tones, line } = EMOTE_COLOURS[id];
  f.paint(dilate(dilate(m)), HALO);
  f.paint(m, lit(m, tones, { top: 1, left: 1, right: 1, bottom: 1 }), { line, inner: line });
  if (id === 'heart') f.dot(4, 5, 0xffd6dc);
  return toArt(f);
}
