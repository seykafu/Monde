import { describe, expect, it } from 'vitest';
import { ACCESS_KEY, DEFAULTS, TEXT_SIZES, loadAccessibility, saveAccessibility, scaledText, pageLines, resolveMotion } from '../preferences';
import { reflowRows, focusScroll } from '../layout';
import { heartIcon, emoteIcon } from '../../friendship/icons';
import { loadTextSpeed, saveTextSpeed } from '../../mind/prefs';
import { TEXT_SPEEDS, MS_PER_CHAR } from '../../mind/reader';

const memory = () => { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } }; };
describe('accessibility preferences', () => {
  it('round trips all settings and keeps the existing speed key', () => {
    const storage = memory();
    const prefs = { textSize: 'larger', colorblind: true, choicesOnly: true, offline: true, motion: 'on' } as const;
    saveAccessibility(storage, prefs); expect(loadAccessibility(storage)).toEqual(prefs);
    for (const speed of TEXT_SPEEDS) { saveTextSpeed(storage, speed); expect(loadTextSpeed(storage)).toBe(speed); }
    expect(MS_PER_CHAR.instant).toBe(0);
  });
  it('validates old, corrupt and unavailable storage', () => {
    const storage = memory();
    for (const value of ['null', '{', '{"textSize":"huge","motion":"yes","offline":"true"}']) {
      storage.setItem(ACCESS_KEY, value); expect(loadAccessibility(storage)).toEqual(DEFAULTS);
    }
    const blocked = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); }, removeItem: () => {} };
    expect(loadAccessibility(blocked)).toEqual(DEFAULTS);
    expect(() => saveAccessibility(blocked, DEFAULTS)).not.toThrow();
  });
  it('overrides OS/query defaults explicitly and restores follow OS', () => {
    expect(resolveMotion('system', true, null)).toBe(true);
    expect(resolveMotion('system', false, '0')).toBe(true);
    expect(resolveMotion('system', true, '1')).toBe(false);
    expect(resolveMotion('off', true, '0')).toBe(false);
    expect(resolveMotion('on', false, '1')).toBe(true);
  });
  it('fits dialogue pages at every size without shrinking fonts', () => {
    expect(TEXT_SIZES.map(s => scaledText(22, s))).toEqual([22, 25, 29]);
    for (const size of TEXT_SIZES) {
      const font = scaledText(22, size), lines = pageLines(font, 8, 126);
      expect(lines * (font * 1.2 + 8)).toBeLessThanOrEqual(126);
      expect((lines + 1) * (font * 1.2 + 8)).toBeGreaterThan(126);
    }
  });
  it('reflows long notebook rows and scrolls choice focus into view', () => {
    expect(reflowRows([{ y: 100, height: 60 }, { y: 100, height: 30 }, { y: 125, height: 40 }, { y: 200, height: 50 }])).toEqual([100, 100, 166, 212]);
    expect(focusScroll(0, 600, 70, 20, 450, 400)).toBe(220);
    expect(focusScroll(220, 20, 70, 20, 450, 400)).toBe(0);
  });
  it('keeps all emotes and heart states distinguishable without hue', () => {
    const hearts = ['full', 'half', 'empty', 'cracked'] as const;
    const emotes = ['heart', 'note', 'ellipsis', 'anger'] as const;
    expect(new Set(hearts.map(k => JSON.stringify([...heartIcon(k, true).data]))).size).toBe(4);
    expect(new Set(emotes.map(k => JSON.stringify([...emoteIcon(k, true).data]))).size).toBe(4);
    expect(heartIcon('half', true).data).not.toEqual(heartIcon('half').data);
  });
});
