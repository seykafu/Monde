import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AMBIENCE, ambienceMix, chimeDue, chimeLevel } from '../ambienceDirector';
describe('town sound (§17)', () => {
  it('plays only the restored dawn/dusk motif, consumes held crossings, and does not chime on entry', () => {
    const before = { day: 2, minute: 1079.9 }, now = { day: 2, minute: 1080.1 };
    expect(chimeDue(before, now, true, false)).toBe(true);
    expect(chimeDue(before, now, false, false)).toBe(false);
    expect(chimeDue(before, now, true, true)).toBe(false);
    expect(chimeDue(now, now, true, false)).toBe(false);
    expect(chimeDue(undefined, now, true, false)).toBe(false);
    expect(chimeDue(now, before, true, false)).toBe(false);
    expect(chimeDue({ day: 2, minute: 1100 }, { day: 2, minute: 1140 }, true, false)).toBe(false);
    expect(chimeDue({ day: 2, minute: 1560 }, { day: 3, minute: 360 }, true, false)).toBe(true);
    expect(chimeDue({ day: 2, minute: 1200 }, { day: 3, minute: 360 }, true, false)).toBe(true);
    expect(chimeLevel('old_quarter', false)).toBe(1);
    expect(chimeLevel('wharf', false)).toBeLessThan(1);
    expect(chimeLevel('old_quarter', true)).toBeLessThan(1);
  });
  it('scales density with census, changes at night, softens indoors and adds rain', () => {
    const empty = ambienceMix('market_row', 600, 0, false, false);
    const full = ambienceMix('market_row', 600, 420, false, false);
    expect(empty.market).toBe(0); expect(full.market).toBeGreaterThan(0);
    expect(ambienceMix('market_row', 600, 210, false, false).market).toBeCloseTo(full.market! / 2);
    expect(ambienceMix('market_row', 1200, 210, false, false).pub).toBeGreaterThan(0);
    expect(ambienceMix('wharf', 600, 210, true, true).rain).toBeGreaterThan(0);
    expect(ambienceMix('wharf', 600, 210, true, false).surf).toBeLessThan(ambienceMix('wharf', 600, 210, false, false).surf!);
    expect(ambienceMix('unknown', 600, 210, false, false)).toEqual({});
  });
  it('documents every drop-in file', () => {
    const doc = readFileSync(new URL('../../../../docs/AUDIO.md', import.meta.url), 'utf8');
    for (const file of Object.values(AMBIENCE)) expect(doc).toContain(file);
  });
});

it('music holds suppress beds and discard bells elapsed while the zone is asleep', async () => {
  const { holdMusic, releaseMusic, musicHeld } = await import('../Music');
  const data = new Map<string, unknown>();
  const calls: boolean[] = [];
  data.set('monde:music', { holdAmbience: (held: boolean) => calls.push(held) });
  data.set('monde.clock', { day: 14, exactMinute: 1080 });
  const registry = { get: (key: string) => data.get(key), set: (key: string, value: unknown) => data.set(key, value) };
  const scene = { registry, game: { registry } } as unknown as Parameters<typeof holdMusic>[0];
  holdMusic(scene, 'story'); holdMusic(scene, 'festival');
  expect(musicHeld(scene)).toBe(true);
  releaseMusic(scene, 'story'); expect(musicHeld(scene)).toBe(true);
  releaseMusic(scene, 'festival'); expect(musicHeld(scene)).toBe(false);
  expect(calls).toEqual([true, true, true, false]);
  const previous = data.get('monde:chimeTime') as { day: number; minute: number };
  expect(chimeDue(previous, { day: 14, minute: 1080.1 }, true, false)).toBe(false);
});
