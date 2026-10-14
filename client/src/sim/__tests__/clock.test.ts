import { describe, expect, it } from 'vitest';
import {
  Clock, DAY_SPAN, DAY_START, MIDNIGHT, MS_PER_GAME_MINUTE, PASS_OUT, dayOfSeason, formatClock, formatGameTime,
  gameTime, parseClock, seasonOf, sunrise, sunset, weekdayOf
} from '../clock';

describe('calendar (GDD §3.2)', () => {
  it('Day 1 is Tuesday, Spring 1', () => {
    expect(gameTime(1, DAY_START)).toEqual({ day: 1, minute: 360, weekday: 'Tue', season: 'spring', dayOfSeason: 1 });
  });
  it('weeks run Mon–Sun', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(weekdayOf)).toEqual(['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']);
  });
  it('seasons are 25 days long', () => {
    expect([seasonOf(25), dayOfSeason(25)]).toEqual(['spring', 25]);
    expect([seasonOf(26), dayOfSeason(26)]).toEqual(['summer', 1]);
    expect([seasonOf(51), dayOfSeason(51)]).toEqual(['autumn', 1]);
    expect([seasonOf(76), dayOfSeason(76)]).toEqual(['winter', 1]);
    expect([seasonOf(100), dayOfSeason(100)]).toEqual(['winter', 25]);
  });
  it('formats the HUD line', () => {
    expect(formatGameTime(gameTime(1, 9 * 60 + 40))).toBe('Tue · Spring 1 · 9:40');
    expect(formatGameTime(gameTime(3, 9 * 60 + 40))).toBe('Thu · Spring 3 · 9:40');
    expect(formatGameTime(gameTime(26, 12 * 60 + 5))).toBe('Sat · Summer 1 · 12:05');
  });
  it('formats the small hours after midnight', () => {
    expect(formatClock(MIDNIGHT + 15)).toBe('0:15');
    expect(formatClock(PASS_OUT)).toBe('2:00');
  });
  it('parses clock text into game minutes', () => {
    expect(parseClock('9:40')).toBe(580);
    expect(parseClock('1:30')).toBe(1530);
    expect(parseClock('25:30')).toBe(1530);
    expect(parseClock('noon')).toBeNull();
  });
});

describe('sunrise and sunset', () => {
  it('spring opens near 06:20 / 19:40', () => {
    expect(sunrise(1)).toBe(6 * 60 + 20);
    expect(sunset(1)).toBe(19 * 60 + 40);
  });
  it('drift with the seasons: long summer days, short winter ones', () => {
    expect(sunset(26) - sunrise(26)).toBeGreaterThan(sunset(1) - sunrise(1));
    expect(sunset(76) - sunrise(76)).toBeLessThan(sunset(51) - sunrise(51));
    for (let day = 1; day <= 100; day++) {
      expect(sunrise(day)).toBeGreaterThan(5 * 60);
      expect(sunset(day)).toBeLessThan(21 * 60);
      // Consecutive days never jump more than a few minutes.
      expect(Math.abs(sunrise(day + 1) - sunrise(day))).toBeLessThanOrEqual(4);
    }
  });
});

describe('Clock (GDD §5.3)', () => {
  it('starts on Day 1 at 06:00', () => {
    const clock = new Clock();
    expect(clock.time).toMatchObject({ day: 1, minute: DAY_START, weekday: 'Tue', season: 'spring' });
  });
  it('runs 0.75 s of real time per minute', () => {
    const clock = new Clock();
    expect(clock.advance(MS_PER_GAME_MINUTE - 1)).toBe(0);
    expect(clock.advance(1)).toBe(1);
    expect(clock.minute).toBe(DAY_START + 1);
    expect(clock.advance(MS_PER_GAME_MINUTE * 2.5)).toBe(2);
    expect(clock.exactMinute).toBeCloseTo(DAY_START + 3.5);
  });
  it('1,200 in-game minutes take 15 real minutes', () => {
    expect(DAY_SPAN).toBe(1200);
    const clock = new Clock({ autoRollover: false });
    // Feed it at 60 fps for 15 real minutes.
    for (let frame = 0; frame < 15 * 60 * 60; frame++) clock.advance(1000 / 60);
    expect(clock.minute).toBe(PASS_OUT);
    expect(DAY_SPAN * MS_PER_GAME_MINUTE).toBe(15 * 60 * 1000);
  });
  it('stops while paused and resumes once every hold is released', () => {
    const clock = new Clock();
    clock.pause('dialogue');
    clock.pause('menu');
    expect(clock.advance(60_000)).toBe(0);
    expect(clock.minute).toBe(DAY_START);
    clock.resume('dialogue');
    expect(clock.paused).toBe(true);
    expect(clock.advance(60_000)).toBe(0);
    clock.resume('menu');
    expect(clock.paused).toBe(false);
    expect(clock.advance(MS_PER_GAME_MINUTE * 10)).toBe(10);
    expect(clock.minute).toBe(DAY_START + 10);
  });
  it('fires minute, hour, dusk, midnight and 26:00 events', () => {
    const clock = new Clock();
    const seen: string[] = [];
    let minutes = 0;
    clock.onMinute(() => minutes++);
    clock.onHour(t => seen.push(`hour ${formatClock(t.minute)}`));
    clock.onDusk(t => seen.push(`dusk ${formatClock(t.minute)}`));
    clock.onMidnight(t => seen.push(`midnight d${t.day}`));
    clock.on26(t => seen.push(`passOut d${t.day} ${t.minute}`));
    clock.onDawn(t => seen.push(`dawn d${t.day}`));
    clock.advanceMinutes(DAY_SPAN);
    expect(minutes).toBe(DAY_SPAN);
    expect(seen.filter(s => s.startsWith('hour'))).toHaveLength(20);
    expect(seen).toContain('dusk 19:40');
    expect(seen).toContain('midnight d1');
    expect(seen.at(-1)).toBe('passOut d1 1560');
    // The next minute rolls into Day 2 at 06:00.
    clock.advanceMinutes(1);
    expect(clock.time).toMatchObject({ day: 2, minute: DAY_START, weekday: 'Wed' });
    expect(seen.at(-1)).toBe('dawn d2');
  });
  it('holds at 26:00 for the night pass when rollover is off', () => {
    const clock = new Clock({ minute: PASS_OUT - 1, autoRollover: false });
    expect(clock.advance(MS_PER_GAME_MINUTE * 5)).toBe(1);
    expect(clock.minute).toBe(PASS_OUT);
    clock.startNextDay();
    expect(clock.time).toMatchObject({ day: 2, minute: DAY_START });
  });
  it('unsubscribes', () => {
    const clock = new Clock();
    let n = 0;
    const off = clock.onMinute(() => n++);
    clock.advanceMinutes(2);
    off();
    clock.advanceMinutes(2);
    expect(n).toBe(2);
  });
  it('jumps across days without firing events', () => {
    const clock = new Clock({ day: 3, minute: DAY_START + 30 });
    let fired = 0;
    clock.onMinute(() => fired++);
    clock.setTime(3, DAY_START - 30);
    expect([clock.day, clock.minute]).toEqual([2, PASS_OUT - 30]);
    clock.setTime(2, PASS_OUT + 10);
    expect([clock.day, clock.minute]).toEqual([3, DAY_START + 10]);
    clock.setTime(1, 0);
    expect([clock.day, clock.minute]).toEqual([1, DAY_START]);
    expect(fired).toBe(0);
  });
});
