import { describe, expect, it } from 'vitest';
import { DAY_START, MIDNIGHT, PASS_OUT, SEASONS, seasonOf } from '../clock';
import {
  TIDE_PERIOD, WEATHER_KINDS, WEATHER_ODDS, WIND_ODDS, dailyWeather, describeWeather, tideLevel, tideTable,
  weatherAt, windToward
} from '../weather';

const SEED = 20261014;
const DAYS = Array.from({ length: 1000 }, (_, i) => i + 1);

describe('weather tables', () => {
  it('every season row sums to 1 and only winter snows', () => {
    for (const season of SEASONS) {
      const row = WEATHER_ODDS[season];
      expect(WEATHER_KINDS.reduce((sum, k) => sum + row[k], 0)).toBeCloseTo(1, 10);
      if (season !== 'winter') expect(row.snow).toBe(0);
    }
    expect(Object.values(WIND_ODDS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe('dailyWeather', () => {
  it('is deterministic for a seed and day', () => {
    for (const day of [1, 7, 26, 88, 100]) {
      expect(dailyWeather(SEED, day)).toEqual(dailyWeather(SEED, day));
    }
  });
  it('varies from day to day and between worlds', () => {
    const kinds = new Set(DAYS.slice(0, 25).map(d => dailyWeather(SEED, d).kind));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    const a = DAYS.slice(0, 50).map(d => dailyWeather(SEED, d).kind).join();
    const b = DAYS.slice(0, 50).map(d => dailyWeather(SEED + 1, d).kind).join();
    expect(a).not.toBe(b);
  });
  it('never snows outside winter (Days 76–100 of each year)', () => {
    let winterSnow = 0;
    for (const seed of [SEED, 1, 99]) {
      for (const day of DAYS) {
        const w = dailyWeather(seed, day);
        if (seasonOf(day) !== 'winter') {
          expect(w.kind).not.toBe('snow');
          for (let m = DAY_START; m <= PASS_OUT; m += 30) expect(weatherAt(w, m).kind).not.toBe('snow');
        } else if (w.kind === 'snow') winterSnow++;
      }
    }
    expect(winterSnow).toBeGreaterThan(0);
  });
  it('blows from the west at least two days a week on average (MR-5)', () => {
    const west = DAYS.filter(d => dailyWeather(SEED, d).wind === 'W').length;
    expect(west / DAYS.length).toBeGreaterThanOrEqual(2 / 7);
  });
  it('roughly follows the seasonal odds', () => {
    const summer = DAYS.filter(d => seasonOf(d) === 'summer');
    const sunny = summer.filter(d => dailyWeather(SEED, d).kind === 'sun').length / summer.length;
    expect(Math.abs(sunny - WEATHER_ODDS.summer.sun)).toBeLessThan(0.1);
  });
  it('wind arrows point downwind', () => {
    expect(windToward('W')).toBe(90);
    expect(windToward('N')).toBe(180);
  });
});

describe('weatherAt (intra-day)', () => {
  const findDay = (kind: string) => {
    const day = DAYS.find(d => dailyWeather(SEED, d).kind === kind);
    if (day === undefined) throw new Error(`no ${kind} day`);
    return dailyWeather(SEED, day);
  };
  it('fog is a morning thing: thick at dawn, gone by its burn-off', () => {
    const fog = findDay('fog');
    expect(weatherAt(fog, DAY_START)).toEqual({ kind: 'fog', intensity: 1 });
    const until = fog.fogUntil!;
    expect(until).toBeGreaterThanOrEqual(10 * 60);
    expect(until).toBeLessThanOrEqual(13 * 60);
    expect(weatherAt(fog, until - 30).intensity).toBeLessThan(1);
    expect(weatherAt(fog, until + 60).kind).toBe('cloud');
    expect(weatherAt(fog, 15 * 60).kind).toBe('cloud');
  });
  it('rain falls only inside its spell', () => {
    const rain = findDay('rain');
    const { from, until } = rain.spell!;
    expect(weatherAt(rain, from).kind).toBe('rain');
    expect(weatherAt(rain, Math.floor((from + until) / 2)).intensity).toBeGreaterThan(0.9);
    if (from > DAY_START) expect(weatherAt(rain, from - 1).kind).toBe('cloud');
    if (until < PASS_OUT) expect(weatherAt(rain, until).kind).toBe('cloud');
  });
  it('labels follow intensity', () => {
    expect(describeWeather({ kind: 'rain', intensity: 0.3 })).toBe('Drizzle');
    expect(describeWeather({ kind: 'fog', intensity: 1 })).toBe('Thick fog');
  });
});

describe('tideTable (WF-1)', () => {
  it('has two low and two high waters every day, half a tide apart', () => {
    for (const day of DAYS.slice(0, 120)) {
      const t = tideTable(day);
      expect(t.lows).toHaveLength(2);
      expect(t.highs).toHaveLength(2);
      expect(t.lows[0]).toBeGreaterThanOrEqual(0);
      expect(t.lows[0]).toBeLessThan(TIDE_PERIOD);
      expect(t.lows[1] - t.lows[0]).toBe(TIDE_PERIOD);
      // Both lows fall before 26:00, inside the game day.
      expect(t.lows[1]).toBeLessThan(PASS_OUT);
      expect(t.highs[1]).toBeLessThan(PASS_OUT);
      // Highs sit between lows.
      expect(Math.abs(Math.abs(t.highs[0] - t.lows[0]) - TIDE_PERIOD / 2)).toBeLessThanOrEqual(0.5);
    }
  });
  it('comes about 50 minutes later each day', () => {
    for (const day of DAYS.slice(0, 120)) {
      const today = tideTable(day), tomorrow = tideTable(day + 1);
      // The same low water read off both days' tables, in minutes since Day 1's midnight.
      const abs = (d: number, m: number) => (d - 1) * MIDNIGHT + m;
      const shift = tomorrow.lows[0] - today.lows[0];
      if (shift > 0) {
        expect(shift).toBe(50);
      } else {
        // The day the first low slips past midnight: yesterday's second low is today's first.
        expect(abs(day, today.lows[1])).toBe(abs(day + 1, tomorrow.lows[0]));
      }
      expect(tomorrow.highs[0] - today.highs[0] === 50 || tomorrow.highs[0] < today.highs[0]).toBe(true);
    }
  });
  it('tideLevel is 0 at low water and 1 at high water', () => {
    const t = tideTable(5);
    expect(tideLevel(5, t.lows[0])).toBeCloseTo(0, 6);
    expect(tideLevel(5, t.lows[1])).toBeCloseTo(0, 6);
    expect(tideLevel(5, t.highs[0])).toBeGreaterThan(0.99);
  });
  it('is the same every time (deterministic)', () => {
    expect(tideTable(42)).toEqual(tideTable(42));
  });
});
