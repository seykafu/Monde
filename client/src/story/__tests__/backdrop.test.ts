import { describe, expect, it } from 'vitest';
import { backdropMood, backdropTitle, backdropUrl, parseBackdropManifest } from '../backdrop';
import { SPRING_SCENES } from '../session';

describe('backdrops', () => {
  it('reads the manifest in any of its forms, skipping junk', () => {
    expect([...parseBackdropManifest({})]).toEqual([]);
    expect([...parseBackdropManifest({ bg_ferry_slip_morning: true, bg_x: false, 'Bad Id': true, bg_y: 'bg_y.jpg', bg_z: '../evil.png' })]).toEqual([['bg_ferry_slip_morning', 'bg_ferry_slip_morning.png'], ['bg_y', 'bg_y.jpg']]);
    expect([...parseBackdropManifest(['bg_a', 7, 'bg_b']).keys()]).toEqual(['bg_a', 'bg_b']);
    expect([...parseBackdropManifest(null)]).toEqual([]);
  });

  it('resolves art against the base URL, never a leading slash', () => {
    expect(backdropUrl('./', 'bg_cottage_door')).toBe('./assets/backdrops/bg_cottage_door.png');
    expect(backdropUrl('./', 'bg_cottage_door', 'bg_cottage_door.jpg')).toBe('./assets/backdrops/bg_cottage_door.jpg');
  });

  it('reads a mood and a name from every Spring backdrop id', () => {
    expect(backdropMood('bg_ferry_slip_morning')).toBe('morning');
    expect(backdropMood('bg_pell_kitchen_night')).toBe('night');
    expect(backdropMood('bg_library_reading_room')).toBe('interior');
    expect(backdropMood('bg_commons_fair_dusk')).toBe('dusk');
    expect(backdropMood('bg_clocktower_square')).toBe('day');
    expect(backdropTitle('bg_ferry_slip_morning')).toBe('Ferry Slip');
    expect(backdropTitle('bg_fountain_square_dry')).toBe('Fountain Square');
    expect(backdropTitle('bg_library_reading_room')).toBe('Library Reading Room');
    for (const s of SPRING_SCENES) if (s.header) expect(backdropTitle(s.header.backdrop)).toMatch(/^[A-Z]/);
  });
});
