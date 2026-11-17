import { expect, it } from 'vitest';
import { fontFaces } from '../fonts';

it('registers the seven faces under the deployed asset base', () => {
  const faces = fontFaces('./');
  expect(faces.map(f => f.family)).toEqual(['EB Garamond', 'EB Garamond', 'Inter', 'Caveat', ...Array(3).fill('Old Standard TT')]);
  expect(new Set(faces.map(f => f.source)).size).toBe(7);
  expect(fontFaces('/itch/build/').every(f => f.source.startsWith('url(/itch/build/assets/fonts/'))).toBe(true);
});
