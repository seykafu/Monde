// The place prompts for the Spring puzzles (puzzles/interaction.ts): a puzzle a scene opens waits for its scene.
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => import('../../qa/__tests__/phaserStub'));
const { PUZZLE_SITES, puzzleAt } = await import('../interaction');

const none = () => false;
describe('puzzle place prompts', () => {
  it('offers a scene\'s puzzle only after its scene (the deferred re-entry), others from their day', () => {
    expect(puzzleAt('old_quarter.library', 2, new Set(), none)).toBeNull();
    expect(puzzleAt('old_quarter.library', 2, new Set(['s02_done', 'pz03_deferred']), none)).toBe('PZ-03');
    expect(puzzleAt('old_quarter.fountain_square', 5, new Set(), none)).toBeNull();
    expect(puzzleAt('old_quarter.fountain_square', 5, new Set(['s04_done']), none)).toBe('PZ-01');
    expect(puzzleAt('market_row.bakery', 3, new Set(), none)).toBeNull();
    expect(puzzleAt('market_row.bakery', 4, new Set(), none)).toBe('PZ-02');
  });

  it('keeps the gears for S07a once the pinion is found, then for the later fitting after S07b', () => {
    // OQ-5 on Day 2: no prompt at the clocktower until S07 has played (S07a fits it from Day 6).
    expect(puzzleAt('old_quarter.clocktower', 2, new Set(['pinion_found']), none)).toBeNull();
    expect(puzzleAt('old_quarter.clocktower', 9, new Set(['pinion_found', 's07_done', 'pz15_pending']), none)).toBe('PZ-15');
    expect(puzzleAt('old_quarter.clocktower', 16, new Set(['s07_done', 'clock_pending_pinion']), none)).toBeNull();
    expect(puzzleAt('old_quarter.clocktower', 16, new Set(['s07_done', 'clock_pending_pinion', 'pinion_found']), none)).toBe('PZ-15');
    expect(puzzleAt('old_quarter.clocktower', 16, new Set(['s07_done', 'pinion_found']), id => id === 'PZ-15')).toBeNull();
  });

  it('places every Spring puzzle once', () => {
    expect(Object.values(PUZZLE_SITES).map(s => s.id).sort()).toEqual(['PZ-01', 'PZ-02', 'PZ-03', 'PZ-04', 'PZ-05', 'PZ-06', 'PZ-13', 'PZ-15', 'PZ-18']);
  });
});
