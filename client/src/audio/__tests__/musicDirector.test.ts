import { describe, expect, it } from 'vitest';
import { ambientTrack, NIGHT_DARKNESS } from '../musicDirector';

describe('ambientTrack', () => {
  const at = (zone: string, minute: number, darkness = 0) => ambientTrack({ zone, day: 3, minute, darkness });
  it('plays each district its own track by day', () => {
    expect(at('old_quarter', 600)).toBe('old_quarter');
    expect(at('market_row', 600)).toBe('market_row');
    expect(at('wharf', 600)).toBe('wharf');
    expect(at('commons', 600)).toBe('commons');
  });
  it('plays the morning track for the first hour of the day', () => {
    expect(at('wharf', 360)).toBe('morning');
    expect(at('wharf', 419)).toBe('morning');
    expect(at('wharf', 420)).toBe('wharf');
  });
  it('plays night music after dark, everywhere', () => {
    expect(at('market_row', 1290, NIGHT_DARKNESS)).toBe('night');
    expect(at('commons', 1500, 0.9)).toBe('night');
    expect(at('commons', 1150, NIGHT_DARKNESS - 0.1)).toBe('commons');
  });
  it('falls back to the main theme on a board without its own track', () => {
    expect(at('millbrook', 600)).toBe('main_theme');
  });
});
