// Passing greetings: who is passing (greetingRules.ts) and the lines they say (ambientLines.ts, content/lines/ambient.yaml).
import { describe, expect, it } from 'vitest';
import { PAIR_LABELS, type PairLabel } from '@monde/shared';
import { GREETING_RULES, GreetingThrottle, passingPairs, type GreetSpot } from '../greetingRules';
import { AMBIENT, AMBIENT_LIMITS, authoredExchange, fits, greetingBeat, parseAmbient, pick, type AmbientContext } from '../ambientLines';
import { TIME_BANDS, WEATHER_TAGS } from '../../../mind/quietMode';
import { lexicalHits } from '../../../../../server/src/mind/filters';
import { personaCards } from '../../../world/residents';
import { Rng } from '../../../util/rng';

const walker: GreetSpot = { id: 'nell', x: 10, y: 10, moving: true, visible: true, busy: false };
const stander: GreetSpot = { ...walker, id: 'odile', x: 11, moving: false };
const here = { x: 10, y: 12 };

describe('who is passing', () => {
  it('pairs two within 1.5 tiles when one of them is walking, walker first', () => {
    expect(passingPairs([stander, walker], here)).toEqual([{ a: 'nell', b: 'odile', key: 'nell+odile', distance: 1 }]);
    expect(passingPairs([walker, { ...stander, x: 11.6 }], here)).toEqual([]);
    expect(passingPairs([{ ...walker, moving: false }, stander], here)).toEqual([]); // two standing: that's chatter's
  });
  it('only on screen, near the player, and not while either is busy talking', () => {
    expect(passingPairs([walker, { ...stander, visible: false }], here)).toEqual([]);
    expect(passingPairs([walker, { ...stander, busy: true }], here)).toEqual([]);
    expect(passingPairs([walker, stander], { x: 10, y: 10 + GREETING_RULES.seen + 1 })).toEqual([]);
  });
  it('one at a time on the board, and a pair rests four game hours', () => {
    const t = new GreetingThrottle();
    const pair = passingPairs([walker, stander], here);
    expect(t.pick(pair, 0, 600)?.key).toBe('nell+odile');
    expect(t.pick(pair, 1000, 601)).toBeNull();
    expect(t.pick(pair, 10_000, 700)).toBeNull();
    expect(t.pick(pair, 10_000, 840)?.key).toBe('nell+odile');
    t.note('odile', 'june', 900);
    expect(t.pick([{ a: 'june', b: 'odile', key: 'june+odile', distance: 1 }], 20_000, 950)).toBeNull();
    t.newDay();
    expect(t.pick(pair, 30_000, 0)).not.toBeNull();
  });
});

describe('the ambient lines', () => {
  const all = [...AMBIENT.greetings, ...AMBIENT.replies, ...Object.values(AMBIENT.voices).flat()];
  const texts = [...all.flatMap(l => [l.text, ...(l.reply ?? [])]), ...AMBIENT.animals, ...AMBIENT.toAnimals, ...AMBIENT.exchanges.flatMap(e => e.lines)];

  it('parse, are short, and pass the server\'s lexical filters (no modern things, brands or fourth wall)', () => {
    expect(AMBIENT.greetings.length).toBeGreaterThan(30);
    expect(AMBIENT.exchanges.length).toBeGreaterThan(20);
    for (const t of texts) {
      expect(lexicalHits(t), t).toEqual([]);
      expect(t.length, t).toBeLessThanOrEqual(AMBIENT_LIMITS.exchange);
      expect(t.replaceAll('{name}', '')).not.toMatch(/[{}]/);
    }
    const ids = new Set(personaCards.map(c => c.id));
    for (const id of Object.keys(AMBIENT.voices)) expect(ids.has(id), id).toBe(true);
  });

  it('greet every tie at every hour in every weather, filling names, and answer in kind', () => {
    let n = 0;
    for (const label of PAIR_LABELS) for (const band of TIME_BANDS) for (const weather of [null, ...WEATHER_TAGS]) {
      const c: AmbientContext = { label, band, weather };
      const rng = new Rng(++n);
      const [g, r] = greetingBeat(AMBIENT, { id: 'nell', name: 'Nell', animal: false }, { id: 'moss', name: 'Old Moss', animal: false }, c, () => rng.next());
      expect(g.speaker).toBe('nell');
      expect(r.speaker).toBe('moss');
      for (const line of [g, r]) { expect(line.text).not.toContain('{'); expect(line.text.length).toBeLessThanOrEqual(AMBIENT_LIMITS.greeting + 12); }
      expect(authoredExchange(AMBIENT, { id: 'a', name: 'A', animal: false }, { id: 'b', name: 'B', animal: false }, c, () => rng.next())
        .map(l => l.speaker).every((s, i) => s === (i % 2 ? 'b' : 'a'))).toBe(true);
    }
  });

  it('answers a greeting with its own reply when it has one', () => {
    const eaten = AMBIENT.greetings.find(g => g.text.startsWith('Eaten yet'))!;
    const lib = { ...AMBIENT, greetings: [eaten], voices: {} };
    const [g, r] = greetingBeat(lib, { id: 'a', name: 'June', animal: false }, { id: 'b', name: 'Odile', animal: false },
      { label: 'friends', band: 'midday', weather: null }, () => 0.3);
    expect(g.text).toBe('Eaten yet, Odile?');
    expect(eaten.reply).toContain(r.text);
  });

  it('keeps rivals grumbling and friends warm, and weather lines to their weather', () => {
    const c = (label: PairLabel, weather: AmbientContext['weather'] = null): AmbientContext => ({ label, band: 'afternoon', weather });
    for (const g of AMBIENT.greetings.filter(x => fits(x, c('rivals')))) expect(g.to ?? [], g.text).toContain('rivals');
    expect(AMBIENT.greetings.filter(x => fits(x, c('friends'))).some(x => x.to?.includes('rivals'))).toBe(false);
    expect(AMBIENT.greetings.filter(x => fits(x, c('friends', null))).some(x => x.w)).toBe(false);
    // In the rain, half the time a line about it.
    expect(pick(AMBIENT.greetings, c('acquaintances', 'rain'), () => 0.1, x => x.text)?.w).toEqual(expect.arrayContaining(['rain']));
    expect(pick(AMBIENT.greetings, c('acquaintances', 'rain'), () => 0.9, x => x.text)?.w).toBeUndefined();
  });

  it('has a narrated speaker act, and residents speak to an animal', () => {
    const [cat, person] = greetingBeat(AMBIENT, { id: 'bastien', name: 'Bastien', animal: true }, { id: 'odile', name: 'Odile', animal: false },
      { label: 'friends', band: 'morning', weather: null }, () => 0.1);
    expect(cat.text).toMatch(/^\(.*\)$/);
    expect(AMBIENT.toAnimals.map(t => t.replaceAll('{name}', 'Bastien'))).toContain(person.text);
    expect(authoredExchange(AMBIENT, { id: 'odile', name: 'Odile', animal: false }, { id: 'bastien', name: 'Bastien', animal: true },
      { label: 'friends', band: 'morning', weather: null }, () => 0.1)[1]!.text).toMatch(/^\(.*\)$/);
  });

  it('skips lines said lately while others fit', () => {
    const c: AmbientContext = { label: 'acquaintances', band: 'morning', weather: null };
    const first = pick(AMBIENT.greetings, c, () => 0, x => x.text)!;
    expect(pick(AMBIENT.greetings, c, () => 0, x => x.text, new Set([first.text]))!.text).not.toBe(first.text);
  });

  it('rejects malformed files, saying where', () => {
    const ok = 'greetings: [{ text: "Hi." }]\nreplies: [{ text: "Hi." }]\nanimals: ["(blinks)"]\nto_animals: ["Puss."]\nexchanges: [{ lines: ["A.", "B."] }]\n';
    expect(parseAmbient(ok).greetings).toHaveLength(1);
    expect(() => parseAmbient(ok.replace('{ text: "Hi." }]\nreplies', '{ text: "Hi.", to: [pals] }]\nreplies'))).toThrow(/greetings\[0\]: to must list/);
    expect(() => parseAmbient(ok.replace('"A.", "B."', '"A."'))).toThrow(/exchanges\[0\]: needs 2 to 4 lines/);
    expect(() => parseAmbient(ok.replace('"Puss."', '"Hello, {player}."'))).toThrow(/only \{name\}/);
    expect(() => parseAmbient(ok.replace('{ text: "Hi." }]\nreplies', `{ text: "${'x'.repeat(61)}" }]\nreplies`))).toThrow(/over 60/);
    expect(() => parseAmbient(ok.replace('replies: [{ text: "Hi." }]', 'replies: [{ text: "Hi.", reply: ["No."] }]'))).toThrow(/unknown field reply/);
  });
});
