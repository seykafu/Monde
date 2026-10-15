import { describe, expect, it } from 'vitest';
import { BACKGROUNDS, BACKGROUND_STARTS, BUILDS, HAIR_STYLES, HEIGHTS, LOVES, PlayerProfile, WHY_MONDE } from '@monde/shared';
import { CLOTH_COLOURS, DEFAULT_PLAYER_LOOK, EYE_COLOURS, HAIR_COLOURS, SKIN_TONES, luma } from '../../render/character/look';
import {
  BACKGROUND_TEXT, CLOTH_TEXT, DEFAULT_CHOICES, EYE_TEXT, HAIR_COLOUR_TEXT, HAIR_STYLE_TEXT, LOVE_TEXT, OUTFITS, SKIN_ORDER,
  STARTER_OUTFITS, WHY_TEXT, blankForm, choicesFromLook, formFrom, lookFromChoices, randomChoices, readForm, type FormState, type LookChoices
} from '../options';

let seed = 11;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

describe('the Fellowship form’s options (§11.1)', () => {
  it('offers every field §11.1 lists, with a word for each option', () => {
    expect([BUILDS.length, HEIGHTS.length, SKIN_TONES.length, HAIR_STYLES.length, HAIR_COLOURS.length, EYE_COLOURS.length, STARTER_OUTFITS.length])
      .toEqual([3, 2, 10, 12, 12, 8, 6]);
    expect([BACKGROUNDS.length, WHY_MONDE.length, LOVES.length]).toEqual([4, 4, 12]);
    expect(HAIR_COLOUR_TEXT).toHaveLength(HAIR_COLOURS.length);
    expect(EYE_TEXT).toHaveLength(EYE_COLOURS.length);
    expect(CLOTH_TEXT).toHaveLength(CLOTH_COLOURS.length);
    for (const s of HAIR_STYLES) expect(HAIR_STYLE_TEXT[s]).toBeTruthy();
    for (const w of WHY_MONDE) expect(WHY_TEXT[w]).toBeTruthy();
    for (const l of LOVES) expect(LOVE_TEXT[l].toLowerCase()).toBe(l);
    // Skins show lightest first, every swatch once.
    expect([...SKIN_ORDER].sort((a, b) => a - b)).toEqual(SKIN_TONES.map((_, i) => i));
    for (let i = 1; i < SKIN_ORDER.length; i++) expect(luma(SKIN_TONES[SKIN_ORDER[i]!]!)).toBeLessThanOrEqual(luma(SKIN_TONES[SKIN_ORDER[i - 1]!]!));
  });

  it('gives each starter outfit three recolourable slots, each of which changes the sprite', () => {
    for (const id of STARTER_OUTFITS) {
      const outfit = OUTFITS[id];
      expect(outfit.slots).toHaveLength(3);
      expect(outfit.defaults.every(i => i >= 0 && i < CLOTH_COLOURS.length)).toBe(true);
      const base: LookChoices = { ...DEFAULT_CHOICES, outfit: id, slots: [0, 1, 3] };
      for (let k = 0; k < 3; k++) {
        const slots = [...base.slots] as [number, number, number];
        slots[k] = 5;
        expect(lookFromChoices({ ...base, slots })).not.toEqual(lookFromChoices(base));
      }
      expect(lookFromChoices(base).outfit).toBe(id);
    }
  });

  it('starts (and rubs out) to the default player look', () => {
    expect(lookFromChoices(DEFAULT_CHOICES)).toEqual(DEFAULT_PLAYER_LOOK);
    expect(choicesFromLook(DEFAULT_PLAYER_LOOK)).toEqual(DEFAULT_CHOICES);
  });

  it('reads a look back into the choices that made it', () => {
    for (let i = 0; i < 300; i++) {
      const c = randomChoices(rand);
      expect(new Set(c.slots).size).toBe(3);
      expect(choicesFromLook(lookFromChoices(c))).toEqual(c);
    }
  });

  it('leaves it to chance even with a stuck die', () => {
    const c = randomChoices(() => 0.999);
    expect(new Set(c.slots).size).toBe(3);
    expect(HAIR_STYLES).toContain(c.hairStyle);
  });
});

describe('reading the form', () => {
  const filled = (over: Partial<FormState> = {}): FormState => ({ ...blankForm(), name: 'Wren Abbot', ...over });

  it('says what is wrong with the name in plain words', () => {
    const problem = (name: string) => { const r = readForm(filled({ name })); return r.ok ? null : r.problems[0]!.problem; };
    expect(problem('')).toBe('Pell needs something to call you.');
    expect(problem('   ')).toBe('Pell needs something to call you.');
    expect(problem('Anastasia Featherstonehaugh')).toMatch(/16 letters at most/);
    expect(problem('Wren<b>')).toMatch(/Letters, spaces/);
    expect(problem('1234')).toMatch(/at least one letter/);
    expect(problem("Ma'at-Ré O.")).toBeNull();
  });

  it('wants all three custom pronouns, letters only', () => {
    const custom = (words: [string, string, string]) => readForm(filled({ pronouns: 'custom', custom: words }));
    expect(custom(['xe', '', 'xyr']).ok).toBe(false);
    expect(custom(['xe', 'x3m', 'xyr']).ok).toBe(false);
    const ok = custom(['Xe', 'xem', 'xyr']);
    expect(ok.ok && ok.profile.pronouns).toBe('xe/xem/xyr');
  });

  it('makes a profile the server schema accepts, and fills a second form from it', () => {
    const form = filled({ name: '  Wren  Abbot ', pronouns: 'she/her', background: 'scrapper', why: 'running', loves: 'old clocks', look: randomChoices(rand) });
    const result = readForm(form);
    if (!result.ok) throw new Error('expected a valid form');
    expect(result.profile).toEqual({ name: 'Wren Abbot', pronouns: 'she/her', background: 'scrapper', why: 'running', loves: 'old clocks' });
    expect(PlayerProfile.parse(result.profile)).toEqual(result.profile);
    const again = readForm(formFrom(result.profile, result.look));
    expect(again).toEqual(result);
    const custom = formFrom({ ...result.profile, pronouns: 'ze/zir/zirs' }, null);
    expect([custom.pronouns, custom.custom]).toEqual(['custom', ['ze', 'zir', 'zirs']]);
  });

  it('spells out every Background’s start and perk, with §11.1’s numbers', () => {
    for (const b of BACKGROUNDS) expect(BACKGROUND_TEXT[b].start && BACKGROUND_TEXT[b].perk && BACKGROUND_TEXT[b].who).toBeTruthy();
    expect(BACKGROUND_TEXT.homecomer.start).toContain(`Regard ${BACKGROUND_STARTS.homecomer.regard.pell}`);
    expect(BACKGROUND_TEXT.tinkerer.start).toContain(`Handiwork ${BACKGROUND_STARTS.tinkerer.skills.handiwork}`);
    expect(BACKGROUND_TEXT.scrapper.start).toContain(`Grit ${BACKGROUND_STARTS.scrapper.skills.grit}`);
    expect(BACKGROUND_TEXT.organizer.start).toContain(`Heart ${BACKGROUND_STARTS.organizer.skills.heart}`);
  });
});
