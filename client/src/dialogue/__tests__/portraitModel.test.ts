import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { PORTRAIT_SET, PersonaCard } from '@monde/shared';
import {
  ART_H, ART_W, FACES, HAIR, MANIFEST_PATH, SKIN, artExpression, parsePortraitManifest, portraitExpression, portraitLook,
  portraitTextureKey, portraitUrl
} from '../portraitModel';
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
  it('starts empty, so every resident draws the procedural bust and nothing 404s', () => {
    const shipped = parsePortraitManifest(JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../public', MANIFEST_PATH), 'utf8')));
    expect(shipped).toEqual({});
    expect(artExpression(shipped, 'odile', 'warm')).toBeNull();
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

describe('the procedural look', () => {
  it('keeps the resident\'s existing skin and roster colour', () => {
    for (const id of ['odile', 'pell', 'tib', 'teo']) {
      const look = portraitLook(card(id), 0x123456);
      expect(look.colour).toBe(0x123456);
      expect(look.skin).toBe(SKIN[hashString(id) % SKIN.length]);
    }
    expect(portraitLook(card('ada'), 0).hair).toBe(HAIR[(hashString('ada') >> 4) % HAIR.length]);
  });

  it('draws what the card describes', () => {
    expect(portraitLook(card('pell'), 0)).toMatchObject({ hairStyle: 'bob', hair: 0xc9cdd4, glasses: 'halfmoon', age: 'elder', build: 'narrow' });
    expect(portraitLook(card('hollis'), 0)).toMatchObject({ headwear: 'peaked', moustache: true, age: 'elder' });
    expect(portraitLook(card('margo'), 0)).toMatchObject({ glasses: 'on_head', hair: 0x1f1a1c });
    expect(portraitLook(card('bertrand'), 0)).toMatchObject({ hairStyle: 'tufty', hair: 0xece8df });
    expect(portraitLook(card('tib'), 0)).toMatchObject({ hairStyle: 'cowlick', age: 'child' });
    expect(portraitLook(card('june'), 0)).toMatchObject({ hairStyle: 'bun', freckles: true });
    expect(portraitLook(card('rook'), 0)).toMatchObject({ headwear: 'flat', capColour: 0x7d7a74, build: 'narrow' });
    expect(portraitLook(card('vane'), 0)).toMatchObject({ greyTemples: true, hair: 0x2e2a28 });
    expect(portraitLook(card('odile'), 0)).toMatchObject({ hairStyle: 'bun', build: 'broad' });
    expect(portraitLook(card('bastien'), 0).animal).toBe(true);
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
