// Persona cards' looks (content/residents/*.yaml `look:`): the resolver, every card drawn by the rig, and caps.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { CardLook, HAIR_STYLES, HEADWEAR_KINDS, PersonaCard } from '@monde/shared';
import {
  CLOTH_COLOURS, DEFAULT_CAP, DEFAULT_PLAYER_LOOK, EYE_COLOURS, HAIR_COLOURS, SKIN_TONES, lookFromCard, luma, ramp,
  type CharacterLook, type Look
} from '../look';
import { IDLE_POSES, drawFrame, renderSheet } from '../rig';
import { FRAME_H as H, FRAME_W as W, PROCEDURAL_LAYOUT, columns } from '../sheet';

const dir = resolve(import.meta.dirname, '../../../../..', 'content/residents');
const cards = readdirSync(dir).filter(f => f.endsWith('.yaml')).sort()
  .map(f => PersonaCard.parse(parse(readFileSync(resolve(dir, f), 'utf8'))));
const byId = new Map(cards.map(c => [c.id, c]));
const ROSTER = 0x5fa36a;

const human = (extra: object = {}) => CardLook.parse({
  kind: 'human', skin: 8, hair: { style: 'cropped', colour: 3 }, eyes: 1, build: 'narrow', height: 'short',
  outfit: { cut: 'jumper', top: 4, bottom: 15, bottom_style: 'shorts', shoes: 2 }, accessory: { kind: 'none' }, ...extra
});

describe('lookFromCard', () => {
  it('turns palette indices and #rrggbb strings into the sprite look', () => {
    expect(lookFromCard(human({ outfit: { cut: 'pinafore', top: '#123456', trim: 9, bottom: 0, bottom_style: 'skirt', shoes: 13 } }), ROSTER)).toEqual({
      kind: 'human', skin: SKIN_TONES[8], hair: HAIR_COLOURS[3], hairStyle: 'cropped', eyes: EYE_COLOURS[1],
      top: 0x123456, trim: CLOTH_COLOURS[9], bottom: CLOTH_COLOURS[0], bottomStyle: 'skirt', shoes: CLOTH_COLOURS[13],
      accessory: 'none', accessoryColour: 0xe8dcc0, build: 'narrow', height: 'short', outfit: 'pinafore'
    });
  });

  it('wears worn glasses as the glasses accessory, and leaves glasses pushed up on the head out', () => {
    expect(lookFromCard(human({ glasses: 'halfmoon', accessory: { kind: 'glasses' } }), ROSTER)).toMatchObject({ accessory: 'glasses' });
    expect(lookFromCard(human({ glasses: 'on_head', accessory: { kind: 'scarf', colour: 3 } }), ROSTER))
      .toMatchObject({ accessory: 'scarf', accessoryColour: CLOTH_COLOURS[3] });
  });

  it('puts a cap on (slate when the card gives no colour), and nothing for none', () => {
    expect(lookFromCard(human({ headwear: { kind: 'knit_cap', colour: 11 } }), ROSTER)).toMatchObject({ headwear: 'knit_cap', headwearColour: CLOTH_COLOURS[11] });
    expect(lookFromCard(human({ headwear: { kind: 'flat_cap' } }), ROSTER)).toMatchObject({ headwear: 'flat_cap', headwearColour: DEFAULT_CAP });
    expect(lookFromCard(human({ headwear: { kind: 'none', colour: 3 } }), ROSTER)).not.toHaveProperty('headwear');
  });

  it('gives a cat without a collar colour the roster colour', () => {
    const cat = CardLook.parse({ kind: 'cat', fur: '#d98a3d', markings: '#a8592a', bib: '#f4ecdc', eyes: '#9bbf4a' });
    expect(lookFromCard(cat, ROSTER)).toEqual({ kind: 'cat', fur: 0xd98a3d, markings: 0xa8592a, bib: 0xf4ecdc, eyes: 0x9bbf4a, collar: ROSTER });
    expect(lookFromCard(CardLook.parse({ ...cat, collar: 3 }), ROSTER)).toMatchObject({ collar: CLOTH_COLOURS[3] });
  });
});

/** Every frame inside the cell, feet on the ground, hard alpha and at most §16.1's 24 colours. */
function problems(look: Look): string[] {
  const s = renderSheet(look), cols = s.width / W, out: string[] = [];
  for (let f = 0; f < PROCEDURAL_LAYOUT.rows.length * columns(PROCEDURAL_LAYOUT); f++) {
    const cx = (f % cols) * W, cy = Math.floor(f / cols) * H, colours = new Set<number>();
    let top = H, bottom = -1, left = W, right = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = ((cy + y) * s.width + cx + x) * 4, a = s.data[i + 3]!;
      if (a !== 0 && a !== 255) out.push(`frame ${f}: alpha ${a}`);
      if (!a) continue;
      colours.add((s.data[i]! << 16) | (s.data[i + 1]! << 8) | s.data[i + 2]!);
      top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x);
    }
    if (bottom !== H - 1) out.push(`frame ${f}: feet at row ${bottom}`);
    if (top <= 0 || left <= 0 || right >= W - 1) out.push(`frame ${f}: clipped ${top}/${left}/${right}`);
    if (colours.size > 24) out.push(`frame ${f}: ${colours.size} colours`);
  }
  return out;
}

describe('every resident card', () => {
  it('has a look, of the right kind', () => {
    expect(cards).toHaveLength(24);
    for (const c of cards) {
      expect(c.look, c.id).toBeDefined();
      expect(c.look!.kind, c.id).toBe(c.kind === 'animal' ? 'cat' : 'human');
    }
  });

  it('draws inside the cell, feet down, within 24 colours a frame', () => {
    for (const c of cards) expect(problems(lookFromCard(c.look!, ROSTER)), c.id).toEqual([]);
  });

  it('draws Tib (and his mother Ada) dark-skinned: one of the two darkest swatches', () => {
    const darkest = [...SKIN_TONES].sort((a, b) => luma(a) - luma(b)).slice(0, 2);
    for (const id of ['tib', 'ada']) expect(darkest, id).toContain((lookFromCard(byId.get(id)!.look!, ROSTER) as CharacterLook).skin);
  });

  it('gives the six cap wearers their caps', () => {
    const caps = Object.fromEntries(cards.flatMap(c => {
      const look = lookFromCard(c.look!, ROSTER);
      return look.kind === 'human' && look.headwear ? [[c.id, look.headwear]] : [];
    }));
    expect(caps).toEqual({ augusta: 'peaked_cap', bru: 'flat_cap', hollis: 'peaked_cap', moss: 'knit_cap', nell: 'knit_cap', rook: 'flat_cap' });
  });

  it('dresses residents distinctly: no two share hair, skin, cut and top', () => {
    const keys = cards.filter(c => c.look?.kind === 'human').map(c => {
      const l = lookFromCard(c.look!, ROSTER) as CharacterLook;
      return [l.hairStyle, l.hair, l.skin, l.outfit, l.top].join('/');
    });
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('caps', () => {
  const capped = (headwear: (typeof HEADWEAR_KINDS)[number], hairStyle: CharacterLook['hairStyle']): CharacterLook =>
    ({ ...DEFAULT_PLAYER_LOOK, hairStyle, hair: 0x9c4a26, headwear, headwearColour: 0x2f3d5c });

  it('draw in every view, over the hair: nothing of a tall style pokes out above the cap', () => {
    const cap = ramp(0x2f3d5c), hair = ramp(0x9c4a26, true);
    for (const kind of HEADWEAR_KINDS.filter(k => k !== 'none')) for (const style of HAIR_STYLES) for (const view of ['down', 'left', 'up'] as const) {
      const f = drawFrame(capped(kind, style), view, IDLE_POSES[0]!);
      let capPx = 0, hairTop = H;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const c = f.get(x, y);
        if (c === cap.base) capPx++;
        if ((c === hair.base || c === hair.light) && y < hairTop) hairTop = y;
      }
      expect(capPx, `${kind} ${style} ${view}`).toBeGreaterThan(20);
      // The head's top row is 7 at rest; caps hide the hair down to row 2 or 3 of the head.
      expect(hairTop, `${kind} ${style} ${view}`).toBeGreaterThanOrEqual(7 + 3);
    }
  });

  it('stay inside the cell with every style, build and height', () => {
    for (const kind of HEADWEAR_KINDS) for (const style of HAIR_STYLES) for (const height of ['short', 'tall'] as const) {
      expect(problems({ ...capped(kind, style), height, build: 'broad' }), `${kind} ${style} ${height}`).toEqual([]);
    }
  });

  it('leave a look without one drawn exactly as before', () => {
    const before = renderSheet(DEFAULT_PLAYER_LOOK).data;
    expect(renderSheet({ ...DEFAULT_PLAYER_LOOK, headwear: 'none', headwearColour: 0x123456 }).data).toEqual(before);
  });
});
