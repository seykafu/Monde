export const clamp = (n: number, min: number, max: number): number =>
  n < min ? min : n > max ? max : n;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export const manhattan = (
  ax: number,
  ay: number,
  bx: number,
  by: number
): number => Math.abs(ax - bx) + Math.abs(ay - by);
