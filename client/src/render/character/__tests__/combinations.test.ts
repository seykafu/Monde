// Every Fellowship-form combination (GDD §11.1) draws inside the 32×48 cell with feet on the ground and at most
// §16.1's 24 colours a frame; and the badge (§11.1) is the bust of the same drawing.
//
// What a frame's outline and pixel count depend on is the geometry: build × height × hair style × outfit
// (432 looks, every one drawn here). Colours only pick tones for those parts, so the most colours a frame can
// have is when every base colour differs: the geometry sweep uses distinct ones, and a second sweep puts every
// swatch the form offers on the sprite at least once.
import { describe, expect, it } from 'vitest';
import { BUILDS, HAIR_STYLES, HEIGHTS } from '@monde/shared';
import { CLOTH_COLOURS, EYE_COLOURS, HAIR_COLOURS, SKIN_TONES, residentLook, type CharacterLook } from '../look';
import { BADGE_H, BADGE_W, bustRect, drawFrame, renderBadge, renderSheet } from '../rig';
import { FRAME_H as H, FRAME_W as W, PROCEDURAL_LAYOUT, columns } from '../sheet';
import { OUTFITS, STARTER_OUTFITS, lookFromChoices, randomChoices, type LookChoices } from '../../../fellow/options';

const FRAMES = PROCEDURAL_LAYOUT.rows.length * columns(PROCEDURAL_LAYOUT);
const CAP = 24;

interface Problem { look: string; frame: number; what: string }
/** Check every frame of a look's sheet; returns what's wrong (empty when all is well). */
function check(look: CharacterLook): Problem[] {
  const s = renderSheet(look), cols = s.width / W, problems: Problem[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const cx = (f % cols) * W, cy = Math.floor(f / cols) * H, colours = new Set<number>();
    let top = H, bottom = -1, left = W, right = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = ((cy + y) * s.width + cx + x) * 4, a = s.data[i + 3]!;
      if (a !== 0 && a !== 255) problems.push({ look: '', frame: f, what: `alpha ${a}` });
      if (!a) continue;
      colours.add((s.data[i]! << 16) | (s.data[i + 1]! << 8) | s.data[i + 2]!);
      top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x);
    }
    if (bottom !== H - 1) problems.push({ look: '', frame: f, what: `feet at row ${bottom}` });
    if (top <= 0 || left <= 0 || right >= W - 1) problems.push({ look: '', frame: f, what: `clipped: ${top}/${left}/${right}` });
    if (colours.size > CAP) problems.push({ look: '', frame: f, what: `${colours.size} colours` });
  }
  const id = `${look.build}/${look.height}/${look.hairStyle}/${look.outfit}`;
  return problems.map(p => ({ ...p, look: id }));
}

/** Slot colours that differ from each other and from the outfits' fixed boots, so no two parts share a ramp. */
const DISTINCT_SLOTS: readonly (readonly [number, number, number])[] = [[0, 3, 5], [4, 6, 8], [7, 9, 11], [12, 14, 15], [10, 1, 3]];

describe('every §11.1 combination', () => {
  it('draws build × height × hair style × outfit inside the cell, feet down, within 24 colours a frame', () => {
    const problems: Problem[] = [];
    let n = 0;
    for (const build of BUILDS) for (const height of HEIGHTS) for (const hairStyle of HAIR_STYLES) for (const outfit of STARTER_OUTFITS) {
      const choices: LookChoices = {
        build, height, hairStyle, outfit, skin: n % SKIN_TONES.length, hair: (n * 5) % HAIR_COLOURS.length,
        eyes: (n * 3) % EYE_COLOURS.length, slots: DISTINCT_SLOTS[n % DISTINCT_SLOTS.length]!
      };
      problems.push(...check(lookFromChoices(choices)));
      n++;
    }
    expect(n).toBe(3 * 2 * 12 * 6);
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it('puts every swatch the form offers on the sprite (skins, hair colours, eyes, and every cloth in every slot)', () => {
    const base: LookChoices = { build: 'broad', height: 'short', skin: 0, hairStyle: 'curly', hair: 0, eyes: 0, outfit: 'coat', slots: [0, 3, 5] };
    const looks: LookChoices[] = [
      ...SKIN_TONES.map((_, skin) => ({ ...base, skin })),
      ...HAIR_COLOURS.map((_, hair) => ({ ...base, hair })),
      ...EYE_COLOURS.map((_, eyes) => ({ ...base, eyes })),
      ...STARTER_OUTFITS.flatMap(outfit => [0, 1, 2].flatMap(slot => CLOTH_COLOURS.map((_, c) => {
        const slots = [...OUTFITS[outfit].defaults] as [number, number, number];
        slots[slot] = c;
        return { ...base, outfit, slots };
      })))
    ];
    const problems = looks.flatMap(c => check(lookFromChoices(c)));
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it('draws whatever "Leave it to chance" picks', () => {
    let seed = 1;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const problems = Array.from({ length: 120 }, () => check(lookFromChoices(randomChoices(rand)))).flat();
    expect(problems.slice(0, 10)).toEqual([]);
  });

  it('makes builds, heights and outfits visibly different', () => {
    const base: LookChoices = { build: 'medium', height: 'tall', skin: 0, hairStyle: 'short', hair: 1, eyes: 0, outfit: 'jumper', slots: [0, 1, 2] };
    const width = (c: LookChoices) => { const f = drawFrame(lookFromChoices(c), 'down', { ub: 0, breath: 0, lift: [0, 0], fwd: [0, 0], arm: [0, 0], flare: 0, lag: 0, sway: 0, blink: false });
      let l = W, r = -1; for (let y = 30; y < 40; y++) for (let x = 0; x < W; x++) if (f.get(x, y) >= 0) { l = Math.min(l, x); r = Math.max(r, x); } return r - l; };
    expect(width({ ...base, build: 'narrow' })).toBeLessThan(width(base));
    expect(width({ ...base, build: 'broad' })).toBeGreaterThan(width(base));
    const top = (c: LookChoices) => { const f = drawFrame(lookFromChoices(c), 'down', { ub: 0, breath: 0, lift: [0, 0], fwd: [0, 0], arm: [0, 0], flare: 0, lag: 0, sway: 0, blink: false });
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (f.get(x, y) >= 0) return y; return H; };
    expect(top({ ...base, height: 'short' })).toBe(top(base) + 2);
    const sheets = STARTER_OUTFITS.map(outfit => renderSheet(lookFromChoices({ ...base, outfit, slots: [0, 1, 2] })).data.join(','));
    expect(new Set(sheets).size).toBe(STARTER_OUTFITS.length);
    const hair = HAIR_STYLES.map(hairStyle => renderSheet(lookFromChoices({ ...base, hairStyle })).data.join(','));
    expect(new Set(hair).size).toBe(HAIR_STYLES.length);
  });

  it('leaves residents drawn as before: plain tops on the medium, tall body', () => {
    for (const id of ['pell', 'odile', 'tib', 'margo', 'resident_17']) {
      const look = residentLook(id, 0x336699);
      expect(look.build ?? 'medium').toBe('medium');
      expect(look.height ?? 'tall').toBe('tall');
      expect(look.outfit ?? 'plain').toBe('plain');
      expect(HAIR_STYLES.slice(0, 6)).toContain(look.hairStyle);
      expect(check(look)).toEqual([]);
    }
  });
});

describe('the badge (§11.1)', () => {
  it('is the resting front frame’s head and shoulders, with nothing of the head cut off', () => {
    for (const build of BUILDS) for (const height of HEIGHTS) for (const hairStyle of HAIR_STYLES) {
      const look = lookFromChoices({ build, height, hairStyle, skin: 3, hair: 2, eyes: 1, outfit: 'smock', slots: [0, 3, 5] });
      const badge = renderBadge(look), r = bustRect(look);
      expect([badge.width, badge.height]).toEqual([BADGE_W, BADGE_H]);
      const frame = drawFrame(look, 'down', { ub: 0, breath: 0, lift: [0, 0], fwd: [0, 0], arm: [0, 0], flare: 0, lag: 0, sway: 0, blink: false });
      // Above the bust there's nothing; the head (down to the chin) sits inside it; and the badge copies the frame.
      for (let y = 0; y < r.y; y++) for (let x = 0; x < W; x++) expect(frame.get(x, y)).toBe(-1);
      for (let y = r.y; y < r.y + 18; y++) for (let x = 0; x < W; x++) if (x < r.x || x >= r.x + r.w) expect(frame.get(x, y)).toBe(-1);
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const i = (y * r.w + x) * 4, c = frame.get(r.x + x, r.y + y);
        expect(badge.data[i + 3]).toBe(c < 0 ? 0 : 255);
        if (c >= 0) expect((badge.data[i]! << 16) | (badge.data[i + 1]! << 8) | badge.data[i + 2]!).toBe(c);
      }
    }
  });
});
