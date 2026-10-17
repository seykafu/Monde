/** Linear interpolation between sorted ranks (R-7). Empty input has no percentile. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new RangeError('Percentile must be in [0, 1]');
  if (values.some(v => !Number.isFinite(v))) throw new RangeError('Samples must be finite');
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p, lo = Math.floor(rank);
  return sorted[lo]! + (sorted[Math.ceil(rank)]! - sorted[lo]!) * (rank - lo);
}

export function frameStatistics(frameMs: readonly number[]) {
  if (frameMs.some(v => !Number.isFinite(v) || v <= 0)) throw new RangeError('Frame times must be positive and finite');
  const elapsedMs = frameMs.reduce((sum, v) => sum + v, 0);
  return {
    frames: frameMs.length, elapsedMs,
    fpsMean: elapsedMs ? 1000 * frameMs.length / elapsedMs : null,
    fpsP5: percentile(frameMs.map(ms => 1000 / ms), 0.05),
    frameMsP50: percentile(frameMs, 0.5), frameMsP95: percentile(frameMs, 0.95), frameMsP99: percentile(frameMs, 0.99),
    longFramesOver50Ms: frameMs.filter(ms => ms > 50).length,
  };
}
