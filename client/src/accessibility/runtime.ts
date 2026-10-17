import { loadAccessibility, saveAccessibility, scaledText, resolveMotion, type Accessibility } from './preferences';
const storage = () => { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } };
let value = loadAccessibility(storage());
const listeners = new Set<() => void>();
export const accessibility = (): Readonly<Accessibility> => value;
export function setAccessibility(patch: Partial<Accessibility>): void {
  value = { ...value, ...patch }; saveAccessibility(storage(), value);
  listeners.forEach(fn => fn());
}
export function watchAccessibility(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const textSize = (px: number): number => scaledText(px, value.textSize);
export function reducedMotion(): boolean {
  return resolveMotion(value.motion, typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('motion'));
}
