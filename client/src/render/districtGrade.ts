// GDD §16.1: restored landmarks and occupied homes make a district warmer.
const unit = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
export interface DistrictGrade { saturation: number; warmth: number; brightness: number }
export function restorationShare(landmarks: readonly boolean[], homes: readonly boolean[]): number {
  // GDD-GAP: equal weight for the landmark and housing shares; omit an absent category.
  const shares = [landmarks, homes].filter(a => a.length).map(a => a.filter(Boolean).length / a.length);
  return shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 0;
}
export function districtGrade(restoration: number, indoors = false): DistrictGrade {
  const r = unit(restoration), strength = indoors ? 0.5 : 1;
  // GDD-GAP: endpoints and indoor strength are art tuning; §16.1 specifies the direction only.
  return { saturation: 1 + (-0.38 + 0.48 * r) * strength,
    warmth: (-0.06 + 0.12 * r) * strength, brightness: 1 + (-0.06 + 0.08 * r) * strength };
}
export function easeRestoration(current: number, target: number, deltaMs: number, reduced: boolean): number {
  // GDD-GAP: exponential ease, 95% settled in 3 seconds. Reduced motion snaps.
  return reduced ? unit(target) : unit(target) + (unit(current) - unit(target)) * Math.exp(-Math.max(0, deltaMs) / 1000);
}
/** Standard luminance saturation matrix, then channel warmth and brightness. Alpha is unchanged. */
export function gradeMatrix(g: DistrictGrade): number[] {
  const luma = [0.2126, 0.7152, 0.0722];
  return [0, 1, 2, 3].flatMap(row => row === 3 ? [0, 0, 0, 1, 0] :
    [0, 1, 2, 3, 4].map(col => col > 2 ? 0 :
      (luma[col]! * (1 - g.saturation) + (row === col ? g.saturation : 0)) *
      g.brightness * (row === 0 ? 1 + g.warmth : row === 2 ? 1 - g.warmth : 1)));
}
/** Canvas fallback: multiply tint cannot desaturate, but retains the cool/warm and dim/bright cues. */
export function gradeTint(g: DistrictGrade): number {
  const channel = (warm: number) => Math.round(unit(g.brightness * warm) * 255);
  return (channel(1 + g.warmth) << 16) | (channel(1) << 8) | channel(1 - g.warmth);
}
