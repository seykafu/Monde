import { describe, expect, it } from 'vitest';
import { FALLBACK_BYTES, LoadMeter, codeBytes, describeBytes, expectedBytes } from '../loadMeter';

describe('load meter', () => {
  it('weights files by their size once known, until then by what their kind weighs', () => {
    const m = new LoadMeter();
    m.add('menu:harbour', 245_000); m.add('town:lamp', 20_000);
    expect(m.bytes()).toEqual({ loaded: 0, total: 265_000 });
    m.progress('menu:harbour', 50_000, 216_000);
    expect(m.bytes()).toEqual({ loaded: 50_000, total: 236_000 });
    m.progress('town:lamp', 4_000, 4_000);
    m.complete('town:lamp');
    expect(m.bytes()).toEqual({ loaded: 54_000, total: 220_000 });
    m.complete('menu:harbour');
    expect(m.fraction()).toBe(1);
  });

  it('isn’t thrown by a tiny file sizing first (the 3-byte sprite manifest)', () => {
    const m = new LoadMeter(1_250_000);
    m.add('sprites:manifest', expectedBytes('assets/sprites/manifest.json'));
    for (let i = 0; i < 52; i++) m.add(`town:${i}`, expectedBytes(`assets/town/${i}.png`));
    m.progress('sprites:manifest', 3, 3);
    m.complete('sprites:manifest');
    // The code is in and none of the town: about half way, not done.
    expect(m.fraction()).toBeCloseTo(1_250_003 / (1_250_003 + 52 * 20_000), 3);
  });

  it('counts a finished file whole even without progress events (cached, or waited on)', () => {
    const m = new LoadMeter();
    m.add('a'); m.add('b');
    m.complete('a');
    expect(m.fraction()).toBeCloseTo(0.5);
    expect(m.count).toEqual({ done: 1, total: 2 });
  });

  it('counts the code already fetched as done, so the bar starts where the wait is', () => {
    const m = new LoadMeter(1_250_000);
    m.progress('town:bakery', 0, 250_000);
    expect(m.fraction()).toBeCloseTo(1_250_000 / 1_500_000);
  });

  it('never moves back when a big file reports its size late', () => {
    const m = new LoadMeter();
    m.add('b', 1_000);
    m.progress('a', 1_000, 1_000);
    m.complete('a');
    const before = m.fraction();
    expect(before).toBeCloseTo(0.5);
    // b turns out to be 5 MB: by bytes the load is barely begun, but the bar holds where it was.
    m.progress('b', 1_000, 5_000_000);
    expect(m.bytes().loaded / m.bytes().total).toBeLessThan(0.01);
    expect(m.fraction()).toBe(before);
    m.progress('b', 4_000_000, 5_000_000);
    expect(m.fraction()).toBeCloseTo(0.8);
    m.complete('b');
    expect(m.fraction()).toBe(1);
  });

  it('is done with nothing to load', () => {
    expect(new LoadMeter().fraction()).toBe(1);
  });

  it('never counts a file past its size', () => {
    const m = new LoadMeter();
    m.progress('a', 900, 1_000);
    m.progress('a', 500, 1_000);
    expect(m.bytes()).toEqual({ loaded: 900, total: 1_000 });
  });
});

describe('expected bytes', () => {
  it('knows the kinds the game loads, by URL or by texture key', () => {
    expect(expectedBytes('./assets/town/bakery.png')).toBe(20_000);
    expect(expectedBytes('town:bakery__faded')).toBe(20_000);
    expect(expectedBytes('./assets/backdrops/bg_harbor_steps_dusk.jpg')).toBe(245_000);
    expect(expectedBytes('./assets/portraits/sable.webp')).toBe(545_000);
    expect(expectedBytes('portrait:sable')).toBe(545_000);
    expect(expectedBytes('./assets/town/manifest.json')).toBe(1_000);
    expect(expectedBytes('./assets/sprites/pell/walk.png')).toBe(FALLBACK_BYTES);
  });
});

describe('code bytes', () => {
  it('sums the scripts, over the wire where it says, else the body', () => {
    expect(codeBytes([
      { name: 'https://x/assets/index-abc.js', transferSize: 624_396, encodedBodySize: 624_096 },
      { name: 'https://x/assets/phaser-abc.js', transferSize: 0, encodedBodySize: 339_717 },
      { name: 'https://x/assets/backdrops/bg.jpg', transferSize: 216_520, encodedBodySize: 216_220 },
      { name: 'https://x/assets/harness.js?v=2', transferSize: 2_000, encodedBodySize: 1_800 }
    ])).toBe(624_396 + 339_717 + 2_000);
  });
});

describe('describe bytes', () => {
  it('reads in MB from a megabyte, else KB', () => {
    expect(describeBytes(1_400_000, 2_310_000)).toBe('1.4 of 2.3 MB');
    expect(describeBytes(180_400, 216_520)).toBe('180 of 217 KB');
    expect(describeBytes(0, 300)).toBe('0 of 1 KB');
  });
});
