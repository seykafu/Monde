// Pure preference validation and layout math; storage is injected.
import type { StorageLike } from '../mind/api';
export const ACCESS_KEY = 'monde.accessibility';
export const TEXT_SIZES = ['normal', 'large', 'larger'] as const;
export type TextSize = typeof TEXT_SIZES[number];
export type Motion = 'system' | 'on' | 'off';
export interface Accessibility { textSize: TextSize; colorblind: boolean; motion: Motion; choicesOnly: boolean; offline: boolean }
export const DEFAULTS: Accessibility = { textSize: 'normal', colorblind: false, motion: 'system', choicesOnly: false, offline: false };
export function loadAccessibility(storage: StorageLike | null): Accessibility {
  try {
    const v = JSON.parse(storage?.getItem(ACCESS_KEY) ?? '{}') as Partial<Accessibility> | null;
    return { textSize: TEXT_SIZES.includes(v?.textSize as TextSize) ? v!.textSize! : 'normal',
      motion: ['system', 'on', 'off'].includes(v?.motion ?? '') ? v!.motion! : 'system',
      colorblind: v?.colorblind === true, choicesOnly: v?.choicesOnly === true, offline: v?.offline === true };
  } catch { return { ...DEFAULTS }; }
}
export function saveAccessibility(storage: StorageLike | null, value: Accessibility): void {
  try { storage?.setItem(ACCESS_KEY, JSON.stringify(value)); } catch { /* Session preferences still work. */ }
}
// GDD-GAP: §18 specifies three steps but no multipliers. Use 100%, 115%, 130%.
export const scaledText = (px: number, size: TextSize): number => Math.round(px * ({ normal: 1, large: 1.15, larger: 1.3 }[size]));
export const pageLines = (font: number, spacing: number, height: number): number => Math.max(1, Math.floor(height / (font * 1.2 + spacing)));
export const resolveMotion = (mode: Motion, os: boolean, query: string | null): boolean => mode === 'system' ? query === '0' || (query !== '1' && os) : mode === 'on';
