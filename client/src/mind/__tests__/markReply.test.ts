import { describe, expect, it } from 'vitest';
import { SPRING_RIDDLES } from '@monde/shared';
import { markReply } from '../markReply';

describe('the Mark reply', () => {
  it('uses every inscription title and preserves routing', () => {
    for (const riddle of SPRING_RIDDLES) {
      expect(markReply(riddle.id)).toEqual({ id: 'mark', text: `About ${riddle.title === riddle.id ? 'that Mark' : riddle.title}…`, intent: 'about_riddle' });
      expect(markReply(riddle.id).text).not.toContain(riddle.id);
    }
    expect(markReply('OQ-1').text).toBe('About The Retired Voice…');
  });

  it('keeps an unknown saved Mark readable', () => {
    expect(markReply('unknown').text).toBe('About that Mark…');
  });
});
