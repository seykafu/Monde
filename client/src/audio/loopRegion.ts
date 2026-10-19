/** Exclusive end, in seconds. Only digital silence at the edges is trimmed. */
export function findLoopRegion(channels: readonly Float32Array[], sampleRate: number): { start: number; end: number } {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Invalid sample rate');
  const length = channels[0]?.length ?? 0;
  if (channels.some(channel => channel.length !== length)) throw new RangeError('Channel lengths differ');
  const limit = Math.min(length, Math.floor(sampleRate * 0.25));
  const silent = (i: number) => channels.every(channel => Math.abs(channel[i]!) < 1e-5);
  let start = 0, end = length;
  while (start < limit && silent(start)) start++;
  while (end > length - limit && end > start && silent(end - 1)) end--;
  // No usable region: keep the original buffer, including very short silent buffers.
  if (start >= end) return { start: 0, end: length / sampleRate };
  return { start: start / sampleRate, end: end / sampleRate };
}
