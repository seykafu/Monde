// Lettering in code (GDD §14: a riddle's years, the welcome sign's founding year, a door's number): the art is
// drawn blank by the generator and the words are set here in a tiny pixel font, so they are exact and crisp.
// Pure: returns RGBA buffers; TownBoard turns them into textures. No Phaser, no DOM.

/** A 5-row pixel font: capitals, digits and the few marks the town's signs use. `#` is ink. */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
  '.': ['.', '.', '.', '.', '#'], ',': ['.', '.', '.', '#', '#'], '·': ['.', '.', '#', '.', '.'], "'": ['#', '#', '.', '.', '.'],
  '-': ['...', '...', '###', '...', '...'], '&': ['.#..', '#.#.', '.#..', '#.##', '.##.'], ' ': ['..', '..', '..', '..', '..']
};
export const GLYPH_H = 5;

/** True when every character of `line` is in the font (a leading `^` sets the line at twice the size). */
export const canLetter = (line: string): boolean => [...(line.startsWith('^') ? line.slice(1) : line)].every(c => c in GLYPHS);

export interface LetterMask {
  w: number;
  h: number;
  /** 1 where there is ink, row-major. */
  ink: Uint8Array;
}

/** One line set solid at `scale` (whole pixels), a pixel between letters. */
export function setLine(line: string, scale = 1): LetterMask {
  const glyphs = [...line].map(c => GLYPHS[c] ?? GLYPHS[' ']!);
  const w = Math.max(1, glyphs.reduce((s, g) => s + g[0]!.length + 1, -1)) * scale;
  const h = GLYPH_H * scale;
  const ink = new Uint8Array(w * h);
  let x0 = 0;
  for (const g of glyphs) {
    for (let gy = 0; gy < GLYPH_H; gy++) for (let gx = 0; gx < g[0]!.length; gx++) {
      if (g[gy]![gx] !== '#') continue;
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) ink[(gy * scale + sy) * w + (x0 + gx) * scale + sx] = 1;
    }
    x0 += g[0]!.length + 1;
  }
  return { w, h, ink };
}

/** Lines (`|` between them) centred under each other, `gap` px apart; a line prefixed `^` is set at twice the size. */
export function setText(text: string, gap = 2): LetterMask {
  const lines = text.split('|').map(l => (l.startsWith('^') ? setLine(l.slice(1), 2) : setLine(l)));
  const w = Math.max(...lines.map(l => l.w));
  const h = lines.reduce((s, l) => s + l.h + gap, -gap);
  const ink = new Uint8Array(w * h);
  let y0 = 0;
  for (const l of lines) {
    const x0 = Math.floor((w - l.w) / 2);
    for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) if (l.ink[y * l.w + x]) ink[(y0 + y) * w + x0 + x] = 1;
    y0 += l.h + gap;
  }
  return { w, h, ink };
}

export type LetterStyle = 'carved' | 'painted' | 'ghost' | 'hull' | 'plate';

interface StyleDef {
  ink: number;
  alpha: number;
  /** A one-pixel edge below and right of each stroke (a carved cut's lit lip, a painted letter's shadow). */
  edge?: number;
  edgeAlpha?: number;
  /** A plate behind the letters (an enamel door number), padded by `pad` px. */
  plate?: { fill: number; rim: number; pad: number };
}

const STYLES: Readonly<Record<LetterStyle, StyleDef>> = {
  carved: { ink: 0x4a3524, alpha: 1, edge: 0xf2dfb4, edgeAlpha: 0.9 },
  painted: { ink: 0x23406a, alpha: 1 },
  ghost: { ink: 0xf3ead2, alpha: 0.62, edge: 0x6e5a48, edgeAlpha: 0.25 },
  hull: { ink: 0xf4f1e6, alpha: 1 },
  plate: { ink: 0xf6f2e4, alpha: 1, plate: { fill: 0x2a4f8a, rim: 0xd9d2bd, pad: 2 } }
};

export interface Lettered { w: number; h: number; rgba: Uint8ClampedArray }

/** The text in a style, as RGBA (transparent round the letters). */
export function letter(text: string, style: LetterStyle): Lettered {
  const s = STYLES[style];
  const m = setText(text);
  const pad = s.plate ? s.plate.pad + 1 : s.edge !== undefined ? 1 : 0;
  const w = m.w + pad * 2, h = m.h + pad * 2;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const put = (x: number, y: number, rgb: number, a: number) => {
    const i = (y * w + x) * 4;
    rgba[i] = (rgb >> 16) & 255; rgba[i + 1] = (rgb >> 8) & 255; rgba[i + 2] = rgb & 255; rgba[i + 3] = Math.round(a * 255);
  };
  if (s.plate) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const rim = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
      if (!corner) put(x, y, rim ? s.plate.rim : s.plate.fill, 1);
    }
  }
  const inkAt = (x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h && m.ink[y * m.w + x] === 1;
  if (s.edge !== undefined) {
    for (let y = 0; y < m.h + 1; y++) for (let x = 0; x < m.w + 1; x++) {
      if (!inkAt(x, y) && (inkAt(x - 1, y - 1) || inkAt(x, y - 1))) put(x + pad, y + pad, s.edge, s.edgeAlpha ?? 1);
    }
  }
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (inkAt(x, y)) put(x + pad, y + pad, s.ink, s.alpha);
  return { w, h, rgba };
}
