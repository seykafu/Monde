import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_LOOK } from '../../render/character/look';
import { lookFromChoices, randomChoices } from '../options';
import {
  FELLOW_KEY, PLAYER_LOOK_KEY, SAVE_NAME_KEY, clearFellow, ensureFellow, getFellow, perksOf, setFellow, signedFellow, storyPlayer,
  type RegistryLike
} from '../state';

function registry(): RegistryLike & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, get: k => data.get(k), set: (k, v) => data.set(k, v), remove: k => data.delete(k) };
}
const wren = { name: 'Wren', pronouns: 'xe/xem/xyr', background: 'homecomer', why: 'running', loves: 'tea' } as const;

describe('the fellow in the registry', () => {
  it('signs a default application for ?skiptitle=1, once', () => {
    const r = registry();
    const fellow = ensureFellow(r);
    expect(fellow.profile).toMatchObject({ name: 'Fellow', pronouns: 'they/them' });
    expect(fellow.look).toEqual(DEFAULT_PLAYER_LOOK);
    expect(r.get(PLAYER_LOOK_KEY)).toEqual(DEFAULT_PLAYER_LOOK);
    const signed = signedFellow(wren, lookFromChoices(randomChoices(() => 0.42)));
    setFellow(r, signed);
    expect(ensureFellow(r)).toBe(signed);
    expect(r.get(SAVE_NAME_KEY)).toBe('Wren');
    expect(r.get(PLAYER_LOOK_KEY)).toEqual(signed.look);
    clearFellow(r);
    expect(getFellow(r)).toBeNull();
    expect(r.data.has(PLAYER_LOOK_KEY) || r.data.has(FELLOW_KEY)).toBe(false);
  });

  it('starts skills from the Background (§11.1 over §11.2)', () => {
    const level = (background: typeof wren.background | 'tinkerer' | 'scrapper' | 'organizer') => {
      const s = signedFellow({ ...wren, background }, DEFAULT_PLAYER_LOOK).skills;
      return [s.handiwork.level, s.wits.level, s.heart.level, s.grit.level];
    };
    expect(level('homecomer')).toEqual([1, 1, 1, 1]);
    expect(level('tinkerer')).toEqual([2, 1, 1, 1]);
    expect(level('organizer')).toEqual([1, 1, 2, 1]);
    expect(level('scrapper')).toEqual([1, 1, 1, 2]);
    expect(perksOf(signedFellow({ ...wren, background: 'organizer' }, DEFAULT_PLAYER_LOOK))).toEqual({ communityWorkBonus: 0.25, volunteerRegardDiscount: 10 });
  });

  it('gives story scripts player.why, player.background, the name and pronoun words', () => {
    expect(storyPlayer(signedFellow(wren, DEFAULT_PLAYER_LOOK))).toEqual({
      name: 'Wren', pronouns: 'xe/xem/xyr', they: 'xe', them: 'xem', their: 'xyr', background: 'homecomer', why: 'running', loves: 'tea'
    });
    expect(storyPlayer(null)).toEqual({});
  });

  it('keeps the signed look apart from later edits to the form', () => {
    const look = lookFromChoices(randomChoices(() => 0.3));
    const fellow = signedFellow(wren, look);
    look.top = 0x000000;
    expect(fellow.look!.top).not.toBe(0x000000);
  });
});
