import { describe, expect, it } from 'vitest';
import { TEXT_SIZES } from '../../accessibility/preferences';
import { menuEllipsis, menuLayout, menuTextResolution, type MenuMode, type MenuRow } from '../menuLayout';

const settings: MenuRow[] = [
  ...Array.from({ length: 2 }, () => ({ group: 'Text & reading', value: 'normal' })),
  ...Array.from({ length: 3 }, () => ({ group: 'Accessibility', value: 'Follow OS' })),
  ...Array.from({ length: 6 }, () => ({ group: 'Connection & sharing', value: 'Off' })), {}
];
const saves = Array.from({ length: 3 }, () => ({ detail: 'Day 25 · spring · harbour · 23:50\nSaved October 18, 2026' }));
describe('menu layout at the 1280 × 720 design size', () => {
  for (const size of TEXT_SIZES) {
    for (const [mode, rows] of [
      ['home', [{}, {}, {}, {}]], ['settings', settings],
      ['pause', [...saves, {}, {}, {}, {}]], ['list', [...saves, {}, {}, {}]]
    ] as [MenuMode, MenuRow[]][]) {
      it(`${mode} fits ${size} without overlapping rows or the footer`, () => {
        const layout = menuLayout(rows, size, mode);
        expect(layout.y + layout.height).toBeLessThanOrEqual(604);
        layout.rows.forEach((r, index) => {
          for (const value of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(value)).toBe(true);
          expect(r.x).toBeGreaterThanOrEqual(layout.x);
          expect(r.x + r.w).toBeLessThanOrEqual(layout.x + layout.width);
          expect(r.h).toBeGreaterThan(layout.font * 1.2 + 12);
          if (rows[index]?.detail) expect(r.h).toBeGreaterThan(layout.font * 1.2 + layout.small * 2.4 + 12);
          for (const other of layout.rows.slice(index + 1)) {
            expect(r.x + r.w <= other.x || other.x + other.w <= r.x || r.y + r.h <= other.y || other.y + other.h <= r.y).toBe(true);
          }
        });
      });
    }
  }
  it('bounds long labels without reducing the selected font size', () => {
    const measure = (s: string) => s.length * 14;
    expect(menuEllipsis('Continue', 200, measure)).toBe('Continue');
    expect(measure(menuEllipsis('A very long saved game name', 200, measure))).toBeLessThanOrEqual(200);
  });
  it('rasterizes at least at camera resolution and honours high density displays', () => {
    expect(menuTextResolution(2, 1)).toBe(2);
    expect(menuTextResolution(2, 3)).toBe(3);
  });
});
