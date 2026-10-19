import { expect, it } from 'vitest';
import { findLoopRegion } from '../loopRegion';
it('trims padding only when every channel is silent', () => {
  expect(findLoopRegion([new Float32Array([0, 0, 0.1, 0, 0]), new Float32Array([0, 0.1, 0, 0.1, 0])], 10)).toEqual({ start: 0.1, end: 0.4 });
});
it('preserves unpadded audio', () => {
  expect(findLoopRegion([new Float32Array([0.1, 0, -0.1])], 10)).toEqual({ start: 0, end: 0.3 });
});
it('returns a valid region for all-silent and empty buffers', () => {
  expect(findLoopRegion([new Float32Array(2)], 10)).toEqual({ start: 0, end: 0.2 });
  expect(findLoopRegion([new Float32Array(100)], 100)).toEqual({ start: 0.25, end: 0.75 });
  expect(findLoopRegion([], 100)).toEqual({ start: 0, end: 0 });
});
it('never scans more than a quarter second at either end', () => {
  const data = new Float32Array(100); data[50] = 1;
  expect(findLoopRegion([data], 100)).toEqual({ start: 0.25, end: 0.75 });
});
