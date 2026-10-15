// Little pixel-art for the town's life layer (TownLife.ts): birds, gulls, butterflies, a swimming duck,
// leaves, smoke and fountain drops. Pure: no Phaser, no DOM. Each sprite is a list of frames drawn as rows
// of palette characters ('.' is clear), so the art reads in the source.

export interface LifeSprite {
  w: number;
  h: number;
  frames: Uint8ClampedArray[];
}

type Pal = Record<string, number>;

function draw(rows: string[], pal: Pal): Uint8ClampedArray {
  const h = rows.length, w = rows[0]!.length;
  const out = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const c = pal[ch];
    if (c === undefined) return;
    const o = (y * w + x) * 4;
    out[o] = (c >> 16) & 0xff; out[o + 1] = (c >> 8) & 0xff; out[o + 2] = c & 0xff; out[o + 3] = 255;
  }));
  return out;
}

function sprite(frames: string[][], pal: Pal): LifeSprite {
  return { w: frames[0]![0]!.length, h: frames[0]!.length, frames: frames.map(f => draw(f, pal)) };
}

/** A small dark bird, wings up then level. */
export const BIRD = sprite([
  ['#.....#', '.#...#.', '..#.#..', '...#...'],
  ['.......', '##...##', '..###..', '...#...']
], { '#': 0x2e2a30 });

/** A gull: white, grey wingtips, gliding with an occasional beat. */
export const GULL = sprite([
  ['k.........k', '.gw.....wg.', '..wwwywww..', '....www....', '...........'],
  ['...........', 'kgww...wwgk', '...wwywww..', '....www....', '...........']
], { k: 0x3a3a40, g: 0xa8aeb8, w: 0xf6f8fa, y: 0xf0b030 });

/** Butterflies: wings open, wings shut. The colour key `c` is swapped per butterfly. */
export const BUTTERFLY_COLOURS = [0xfaf6e6, 0xffd23c, 0xff9a3c, 0x8cb8ff, 0xe89ae0] as const;
export const butterfly = (colour: number): LifeSprite => sprite([
  ['c.c', 'cbc', 'c.c'],
  ['.c.', '.b.', '.c.']
], { c: colour, b: 0x3a2a20 });

/** A mallard on the water, two bobbing frames, facing right. */
export const DUCK = sprite([
  ['......gg.', '.....ggwo', '..bbbbbb.', '.bbcccbb.', '..wwwwww.', '.........'],
  ['.........', '......gg.', '.....ggwo', '..bbbbbb.', '.bbcccbb.', '..wwwwww.']
], { g: 0x2e7a3c, w: 0xe8eef0, o: 0xf09a2a, b: 0x8a6a4a, c: 0xb89a74 });

/** Leaves: three greens and two turned ones. */
export const LEAF_COLOURS = [0x6aa040, 0x8cb84a, 0x4e8a34, 0xd8a03a, 0xc8662e] as const;
export const leaf = (colour: number): LifeSprite => sprite([['.cc', 'cc.']], { c: colour });

/** A puff of chimney smoke: a soft dithered round. */
export const SMOKE = sprite([[
  '..aaaa..',
  '.abbbba.',
  'abbccbba',
  'abccccba',
  'abccccba',
  'abbccbba',
  '.abbbba.',
  '..aaaa..'
]], { a: 0xc8c8cc, b: 0xdcdce0, c: 0xeeeef0 });

/** A drop of fountain water. */
export const DROP = sprite([['w', 'b']], { w: 0xf0fbff, b: 0x8fd4f0 });

/** A sparkle on the water in sunshine: a plus that blinks. */
export const SPARKLE = sprite([
  ['.w.', 'www', '.w.'],
  ['...', '.w.', '...']
], { w: 0xffffff });
