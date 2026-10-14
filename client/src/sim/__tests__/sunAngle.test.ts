import { describe, expect, it } from 'vitest';
import { DAY_START, PASS_OUT, SOLAR_NOON, sunrise, sunset } from '../clock';
import { darkness, daylightLevel, isDaylight, shadowBearing, sunPosition, twilightGlow } from '../sunAngle';
import { sunShadow } from '../../render/sunClock';
import { SUN } from '../../render/sun';

describe('sunPosition', () => {
  it('there is no daylight at 03:00 (or after the 26:00 pass-out)', () => {
    for (const day of [1, 26, 51, 76, 100]) {
      expect(isDaylight(day, 3 * 60)).toBe(false);
      expect(isDaylight(day, PASS_OUT)).toBe(false);
      expect(sunPosition(day, 3 * 60).elevation).toBeLessThan(0);
      expect(darkness(day, 3 * 60)).toBe(1);
    }
  });
  it('is highest near midday', () => {
    for (const day of [1, 13, 26, 51, 76]) {
      let best = DAY_START, high = -90;
      for (let m = DAY_START; m <= PASS_OUT; m++) {
        const e = sunPosition(day, m).elevation;
        if (e > high) { high = e; best = m; }
      }
      expect(Math.abs(best - SOLAR_NOON)).toBeLessThanOrEqual(30);
      expect(sunPosition(day, best).azimuth).toBeCloseTo(180, 0);
    }
  });
  it('rises at sunrise in the east and sets at sunset in the west', () => {
    const day = 1;
    expect(sunPosition(day, sunrise(day)).elevation).toBeCloseTo(0, 6);
    expect(sunPosition(day, sunset(day)).elevation).toBeCloseTo(0, 6);
    expect(sunPosition(day, sunrise(day)).azimuth).toBeLessThan(100);
    expect(sunPosition(day, sunset(day)).azimuth).toBeGreaterThan(260);
    expect(isDaylight(day, sunrise(day) + 1)).toBe(true);
    expect(isDaylight(day, sunset(day) + 1)).toBe(false);
  });
  it('rides higher in summer than in winter', () => {
    expect(sunPosition(26, SOLAR_NOON).elevation).toBeGreaterThan(sunPosition(1, SOLAR_NOON).elevation);
    expect(sunPosition(76, SOLAR_NOON).elevation).toBeLessThan(sunPosition(51, SOLAR_NOON).elevation);
  });
  it('darkness fades in at dusk and out at dawn', () => {
    const day = 1;
    expect(daylightLevel(day, SOLAR_NOON)).toBe(1);
    const before = darkness(day, sunset(day) - 30), at = darkness(day, sunset(day)), after = darkness(day, sunset(day) + 60);
    expect(before).toBeLessThan(at);
    expect(at).toBeLessThan(after);
    expect(after).toBeGreaterThan(0.9);
    expect(darkness(day, sunrise(day) - 60)).toBeGreaterThan(darkness(day, sunrise(day) + 30));
    expect(twilightGlow(day, sunset(day))).toBeGreaterThan(0.8);
    expect(twilightGlow(day, SOLAR_NOON)).toBe(0);
  });
  it('shadows swing from west (morning) through north (noon) to east (evening)', () => {
    const day = 1;
    expect(shadowBearing(day, 3 * 60)).toBeNull();
    const morning = shadowBearing(day, 8 * 60)!, noon = shadowBearing(day, SOLAR_NOON)!, evening = shadowBearing(day, 18 * 60)!;
    expect(morning).toBeGreaterThan(250);
    expect(morning).toBeLessThan(300);
    expect(Math.min(noon, 360 - noon)).toBeLessThan(1);
    expect(evening).toBeGreaterThan(60);
    expect(evening).toBeLessThan(110);
    // CM-2: on a mid-afternoon the shadow points north-east, the same way each day.
    const cm2 = shadowBearing(day, 15 * 60 + 30)!;
    expect(cm2).toBeGreaterThan(20);
    expect(cm2).toBeLessThan(70);
  });
});

describe('sunShadow (render adapter)', () => {
  it('is long in the morning and evening, short at noon, gone at night', () => {
    const day = 1;
    const morning = sunShadow(sunPosition(day, 8 * 60));
    const noon = sunShadow(sunPosition(day, SOLAR_NOON));
    const evening = sunShadow(sunPosition(day, 18 * 60));
    const night = sunShadow(sunPosition(day, 23 * 60));
    expect(morning.squash).toBeGreaterThan(noon.squash);
    expect(evening.squash).toBeGreaterThan(noon.squash);
    expect(noon.squash).toBeCloseTo(SUN.squash, 1);
    expect(night.alpha).toBe(0);
    expect(noon.alpha).toBeCloseTo(SUN.alpha);
    // Morning shadows lean left (west), evening ones right (east), noon straight up the board.
    expect(morning.angle).toBeLessThan(-60);
    expect(evening.angle).toBeGreaterThan(60);
    expect(Math.abs(noon.angle)).toBeLessThan(1);
  });
  it('weather dims the shadow', () => {
    const pos = sunPosition(1, SOLAR_NOON);
    expect(sunShadow(pos, 0.2).alpha).toBeCloseTo(SUN.alpha * 0.2);
  });
  it('writes into the record it is given', () => {
    const out = { angle: 0, squash: 0, alpha: 0 };
    expect(sunShadow(sunPosition(1, SOLAR_NOON), 1, out)).toBe(out);
  });
});
