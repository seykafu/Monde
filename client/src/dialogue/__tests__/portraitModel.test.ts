import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { HAIR_COLOURS, HAIR_STYLES, PORTRAIT_SET, PersonaCard, SKIN_TONES } from '@monde/shared';
import {
  ART_H, ART_W, FACES, HAIR, MANIFEST_PATH, PORTRAIT_HAIR, PORTRAIT_HEADWEAR, SKIN, artExpression, parsePortraitManifest,
  portraitExpression, portraitLook, portraitTextureKey, portraitUrl
} from '../portraitModel';
import { lookFromCard, luma } from '../../render/character/look';
import { bottomFirst, visibleRange } from '../logLayout';
import { hashString } from '../../sim/plans';

const content = resolve(import.meta.dirname, '../../../..', 'content');
const card = (id: string): PersonaCard => PersonaCard.parse(parse(readFileSync(resolve(content, `residents/${id}.yaml`), 'utf8')));

describe('portrait expressions', () => {
  it('maps any expr onto the six; unknown and empty are neutral', () => {
    for (const e of PORTRAIT_SET) expect(portraitExpression(e)).toBe(e);
    expect(portraitExpression('laugh')).toBe('warm');
    expect(portraitExpression('thinking')).toBe('neutral');
    expect(portraitExpression('alarmed')).toBe('surprised');
    expect(portraitExpression('ledger_stare')).toBe('neutral');
    expect(portraitExpression('')).toBe('neutral');
    expect(portraitExpression(null)).toBe('neutral');
  });

  it('gives each of the six a face that differs from every other in at least two features', () => {
    const features = (e: keyof typeof FACES) => {
      const f = FACES[e];
      return [f.eyes, f.mouth, f.extras.join('+'), `${Math.sign(f.brow.inner - f.brow.outer)}:${f.brow.inner < -5 ? 'up' : f.brow.inner > 3 ? 'down' : 'mid'}`];
    };
    for (const a of PORTRAIT_SET) for (const b of PORTRAIT_SET) {
      if (a >= b) continue;
      const fa = features(a), fb = features(b);
      expect(fa.filter((v, i) => v !== fb[i]).length, `${a} vs ${b}`).toBeGreaterThanOrEqual(2);
    }
    expect(FACES.warm.extras).toContain('blush');
    expect(FACES.sad.mouth).toBe('frown');
    expect(FACES.angry.brow.inner).toBeGreaterThan(FACES.angry.brow.outer);
    expect(FACES.surprised.eyes).toBe('wide');
    expect(FACES.worried.mouth).toBe('wavy');
  });
});

describe('the art manifest', () => {
  it('lists only files that ship, so nothing 404s', () => {
    const publicDir = resolve(import.meta.dirname, '../../../public');
    const shipped = parsePortraitManifest(JSON.parse(readFileSync(resolve(publicDir, MANIFEST_PATH), 'utf8')));
    for (const [id, exprs] of Object.entries(shipped)) {
      const files = readdirSync(resolve(publicDir, 'assets/portraits', id));
      for (const expr of exprs) expect(files, `${id}/${expr}.png`).toContain(`${expr}.png`);
    }
    expect(artExpression({}, 'odile', 'warm')).toBeNull();
  });

  it('keeps only well-formed ids and expressions', () => {
    expect(parsePortraitManifest(null)).toEqual({});
    expect(parsePortraitManifest(['odile'])).toEqual({});
    expect(parsePortraitManifest({
      odile: ['neutral', 'warm', 'warm', 7, '../x', 'Sad'], pell: 'neutral', '../etc': ['neutral'], tib: []
    })).toEqual({ odile: ['neutral', 'warm'] });
  });

  it('shows the exact expression, else its portrait of the six, else neutral, else any of the resident\'s art', () => {
    const m = parsePortraitManifest({ odile: ['neutral', 'warm', 'flour_cloud'], bastien: ['loaf', 'warm'] });
    expect(artExpression(m, 'odile', 'warm')).toBe('warm');
    expect(artExpression(m, 'odile', 'laugh')).toBe('warm');
    expect(artExpression(m, 'odile', 'flour_cloud')).toBe('flour_cloud');
    expect(artExpression(m, 'odile', 'angry')).toBe('neutral');
    expect(artExpression(m, 'bastien', 'loaf')).toBe('loaf');
    expect(artExpression(m, 'bastien', 'angry')).toBe('loaf');
    expect(artExpression(m, 'pell', 'warm')).toBeNull();
  });

  it('builds file URLs against the base, never a leading slash', () => {
    expect(portraitUrl('./', 'odile', 'warm')).toBe('./assets/portraits/odile/warm.png');
    expect(portraitUrl('/monde/', 'tib', 'sad')).toBe('/monde/assets/portraits/tib/sad.png');
    expect(portraitTextureKey('tib', 'sad')).toBe('portrait:tib:sad');
    expect([ART_W, ART_H]).toEqual([460, 540]);
  });
});

describe('the procedural look without a card look (the fallback)', () => {
  const plain = (id: string): PersonaCard => ({ ...card(id), look: undefined });

  it('keeps the resident\'s existing skin and roster colour', () => {
    for (const id of ['odile', 'pell', 'tib', 'teo']) {
      const look = portraitLook(plain(id), 0x123456);
      expect(look.colour).toBe(0x123456);
      expect(look.cloth).toBe(0x123456);
      expect(look.skin).toBe(SKIN[hashString(id) % SKIN.length]);
    }
    expect(portraitLook(plain('ada'), 0).hair).toBe(HAIR[(hashString('ada') >> 4) % HAIR.length]);
  });

  it('draws what the card\'s appearance describes', () => {
    expect(portraitLook(plain('pell'), 0)).toMatchObject({ hairStyle: 'bob', hair: 0xc9cdd4, glasses: 'halfmoon', age: 'elder', build: 'narrow' });
    expect(portraitLook(plain('hollis'), 0)).toMatchObject({ headwear: 'peaked', moustache: true, age: 'elder' });
    expect(portraitLook(plain('margo'), 0)).toMatchObject({ glasses: 'on_head', hair: 0x1f1a1c });
    expect(portraitLook(plain('bertrand'), 0)).toMatchObject({ hairStyle: 'tufty', hair: 0xece8df });
    expect(portraitLook(plain('tib'), 0)).toMatchObject({ hairStyle: 'cowlick', age: 'child' });
    expect(portraitLook(plain('june'), 0)).toMatchObject({ hairStyle: 'bun', freckles: true });
    expect(portraitLook(plain('rook'), 0)).toMatchObject({ headwear: 'flat', capColour: 0x7d7a74, build: 'narrow', stubble: false });
    expect(portraitLook(plain('vane'), 0)).toMatchObject({ greyTemples: true, hair: 0x2e2a28 });
    expect(portraitLook(plain('odile'), 0)).toMatchObject({ hairStyle: 'bun', build: 'broad' });
    expect(portraitLook(plain('bastien'), 0)).toMatchObject({ animal: true });
    expect(portraitLook(plain('bastien'), 0).coat).toBeUndefined();
  });
});

describe('the procedural look from the card\'s look', () => {
  const cards = readdirSync(resolve(content, 'residents')).filter(f => f.endsWith('.yaml')).map(f => card(f.replace('.yaml', '')));
  const ROSTER = 0x8a6aa8;

  it('matches the walking sprite: skin, hair colour, glasses, cap and its colour, build and clothes', () => {
    const build = { narrow: 'narrow', medium: 'average', broad: 'broad' } as const;
    let people = 0;
    for (const c of cards) {
      expect(c.look, c.id).toBeDefined();
      const sprite = lookFromCard(c.look!, ROSTER), bust = portraitLook(c, ROSTER);
      expect(bust.colour, c.id).toBe(ROSTER);
      if (sprite.kind === 'cat') {
        expect(bust.animal).toBe(true);
        expect(bust.coat).toEqual({ fur: sprite.fur, markings: sprite.markings, bib: sprite.bib, eyes: sprite.eyes });
        continue;
      }
      people++;
      expect({ skin: bust.skin, hair: bust.hair, eyes: bust.eyes, cloth: bust.cloth }, c.id)
        .toEqual({ skin: sprite.skin, hair: sprite.hair, eyes: sprite.eyes, cloth: sprite.top });
      expect(bust.glasses === 'round' || bust.glasses === 'halfmoon' || bust.glasses === 'heavy', `${c.id} glasses`).toBe(sprite.accessory === 'glasses');
      expect(bust.headwear, `${c.id} cap`).toBe(PORTRAIT_HEADWEAR[sprite.headwear ?? 'none']);
      if (sprite.headwear) expect(bust.capColour, `${c.id} cap colour`).toBe(sprite.headwearColour);
      expect(bust.build, c.id).toBe(build[sprite.build ?? 'medium']);
      expect(bust.hairStyle, c.id).toBe(c.look!.kind === 'human' && c.look!.face?.cowlick ? 'cowlick' : PORTRAIT_HAIR[sprite.hairStyle]);
    }
    expect(people).toBe(23);
  });

  it('draws Tib dark-skinned (one of the two darkest swatches), a child with his cowlick', () => {
    const darkest = [...SKIN_TONES].sort((a, b) => luma(a) - luma(b)).slice(0, 2);
    const tib = portraitLook(card('tib'), ROSTER);
    expect(darkest).toContain(tib.skin);
    expect(tib).toMatchObject({ hairStyle: 'cowlick', age: 'child', hair: HAIR_COLOURS[3] });
    expect(darkest).toContain(portraitLook(card('ada'), ROSTER).skin);
  });

  it('still draws what the cards describe', () => {
    expect(portraitLook(card('pell'), 0)).toMatchObject({ hairStyle: 'bob', hair: 0xc9cdd4, glasses: 'halfmoon', age: 'elder', build: 'narrow' });
    expect(portraitLook(card('hollis'), 0)).toMatchObject({ headwear: 'peaked', moustache: true, age: 'elder' });
    expect(portraitLook(card('augusta'), 0)).toMatchObject({ headwear: 'peaked', capColour: 0x2f3d5c, hairStyle: 'braid', collar: 'shirt' });
    expect(portraitLook(card('margo'), 0)).toMatchObject({ glasses: 'on_head', hair: HAIR_COLOURS[3] });
    expect(portraitLook(card('rosalind'), 0)).toMatchObject({ glasses: 'on_head', hairStyle: 'curly', build: 'broad' });
    expect(portraitLook(card('bertrand'), 0)).toMatchObject({ hairStyle: 'tufty', hair: 0xece8df, age: 'elder' });
    expect(portraitLook(card('june'), 0)).toMatchObject({ hairStyle: 'bun', freckles: true });
    expect(portraitLook(card('rook'), 0)).toMatchObject({ headwear: 'flat', capColour: 0x7d7a74, build: 'narrow', stubble: true });
    expect(portraitLook(card('moss'), 0)).toMatchObject({ headwear: 'beanie', age: 'elder', stubble: true });
    expect(portraitLook(card('nell'), 0)).toMatchObject({ headwear: 'beanie', hairStyle: 'cropped' });
    expect(portraitLook(card('vane'), 0)).toMatchObject({ greyTemples: true, hair: 0x2e2a28 });
    expect(portraitLook(card('odile'), 0)).toMatchObject({ hairStyle: 'bun', build: 'broad' });
    expect(portraitLook(card('felix'), 0)).toMatchObject({ glasses: 'heavy', hairStyle: 'short' });
    expect(portraitLook(card('teo'), 0)).toMatchObject({ hairStyle: 'swept' });
    expect(portraitLook(card('nettie'), 0)).toMatchObject({ hairStyle: 'short' });
    expect(portraitLook(card('margo'), 0)).toMatchObject({ hairStyle: 'bun', glasses: 'on_head' });
    expect(portraitLook(card('june'), 0)).toMatchObject({ apron: 0xe8dcc0 });
    expect(portraitLook(card('hollis'), 0).scarf).toBe(0xc0504d);
  });

  it('maps every sprite hair style to a bust style, the same haircut', () => {
    for (const style of HAIR_STYLES) expect(PORTRAIT_HAIR[style], style).toBeDefined();
    expect(new Set(Object.values(PORTRAIT_HAIR)).size).toBe(HAIR_STYLES.length);
  });
});

describe('the log layout', () => {
  it('shows whole entries that fit, newest at the bottom', () => {
    const heights = [40, 40, 60, 40, 40];
    expect(bottomFirst(heights, 150, 10)).toBe(3);
    expect(visibleRange(heights, 3, 150, 10)).toEqual({ first: 3, last: 4 });
    expect(visibleRange(heights, 0, 150, 10)).toEqual({ first: 0, last: 1 });
    expect(bottomFirst([400], 150, 10)).toBe(0);
    expect(visibleRange([400], 0, 150, 10)).toEqual({ first: 0, last: 0 });
    expect(bottomFirst([], 150)).toBe(0);
  });
});
