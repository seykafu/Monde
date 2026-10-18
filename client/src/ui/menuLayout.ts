import { scaledText, type TextSize } from '../accessibility/preferences';

export interface MenuRow { group?: string; detail?: string; value?: string }
export type MenuMode = 'home' | 'pause' | 'settings' | 'list';
/** Integer design pixels. Settings use two notebook columns; lists reserve room for pagination. */
export function menuLayout(rows: readonly MenuRow[], size: TextSize, mode: MenuMode) {
  const font = scaledText(18, size), small = scaledText(14, size);
  const x = 64, y = mode === 'home' ? 246 : 142;
  const width = mode === 'home' ? 480 : 1152;
  const cursors = [y + 22, y + 22];
  const details = rows.filter(row => row.detail).length;
  const navigation = (mode === 'list' || mode === 'pause') && details > 0;
  let navIndex = 0;
  const geometry = rows.map((row, index) => {
    const column = mode === 'settings' && row.group === 'Connection & sharing' ? 1 : 0;
    const heading = mode === 'settings' && !!row.group && !rows.slice(0, index).some(r => r.group === row.group);
    if (heading) cursors[column]! += 32;
    const h = row.detail ? font + small * 2 + 26 : font + 22;
    const box = { x: x + 20 + column * 566, y: cursors[column]!, w: mode === 'settings' ? 546 : width - 40, h, heading };
    if (navigation && !row.detail) {
      const count = rows.length - details;
      const w = Math.floor((width - 40 - (count - 1) * 8) / count);
      box.x += navIndex++ * (w + 8);
      box.w = w;
      if (navIndex === count) cursors[column]! += h + 8;
    } else cursors[column]! += h + 8;
    return box;
  });
  return { x, y, width, height: Math.max(...cursors) - y + 12, font, small, rows: geometry };
}

export const menuTextResolution = (renderScale: number, pixelRatio: number): number => Math.max(renderScale, pixelRatio || 1);

/** Keep arbitrary save names and invite masks inside their allotted column without shrinking text. */
export function menuEllipsis(value: string, width: number, measure: (text: string) => number): string {
  if (measure(value) <= width) return value;
  let end = value.length;
  while (end > 0 && measure(`${value.slice(0, end)}…`) > width) end--;
  return `${value.slice(0, end)}…`;
}
