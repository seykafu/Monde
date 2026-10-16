// Template days' outdoor stops (gathering.ts): where and when residents step out to talk, and what they never leave.
import { describe, expect, it } from 'vitest';
import {
  GATHERING_PLACES, LINGER_CHANCE, LINGER_WINDOWS, gatherHash, lingerFor, spliceLinger, withLingers, type Linger, type LingerBlock
} from '../gathering';

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const at = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
/** A contiguous day from [start, action, place] rows; the last runs to 26:00. */
function day(rows: [string, string, string][]): LingerBlock[] {
  return rows.map(([start, action, place], i) => {
    const s = at(start), e = i + 1 < rows.length ? at(rows[i + 1]![0]) : 26 * 60;
    return { start: hhmm(s), end: hhmm(e), action, place, with: [], note: '', startMin: s, endMin: e };
  });
}
const make = (l: Linger): LingerBlock => ({ start: hhmm(l.startMin), end: hhmm(l.endMin), action: l.action, place: l.place, with: [], note: '', startMin: l.startMin, endMin: l.endMin });
const brief = (blocks: readonly LingerBlock[]) => blocks.map(b => `${b.start}-${b.end} ${b.action}@${b.place}`);
const [LUNCH, AFTERNOON] = LINGER_WINDOWS as [typeof LINGER_WINDOWS[number], typeof LINGER_WINDOWS[number]];
/** Resident ids that do stop in `window` on `weekday` (the chance is a hash of id, weekday and window). */
const stoppers = (weekday: string, window = LUNCH, n = 3) =>
  Array.from({ length: 200 }, (_, i) => `r${i}`).filter(id => gatherHash(`${id}|${weekday}|${window.id}`) / 2 ** 32 < LINGER_CHANCE).slice(0, n);
const shopDay = day([['06:00', 'eat', 'market_row.bakery_flat'], ['08:00', 'work', 'market_row.bakery'], ['18:00', 'socialize', 'market_row.gull_and_anchor'], ['22:00', 'sleep', 'market_row.bakery_flat']]);

describe('outdoor stops', () => {
  it('steps out to the district gathering place at the same time as everybody else that weekday', () => {
    const ids = stoppers('Wed');
    const stops = ids.map(id => lingerFor(shopDay, id, 'Wed', LUNCH));
    expect(stops.every(s => s && s.place === 'market_row.market_street' && s.action === 'socialize')).toBe(true);
    expect(new Set(stops.map(s => `${s!.startMin}-${s!.endMin}`)).size).toBe(1);
    expect(LUNCH.starts).toContain(stops[0]!.startMin);
    expect(stops[0]!.endMin - stops[0]!.startMin).toBe(LUNCH.minutes);
    // Spliced in, the day stays contiguous: work, the stop, back to work.
    const out = withLingers(shopDay, { id: ids[0]! }, 'Wed', make);
    out.slice(1).forEach((b, i) => expect(b.startMin, brief(out).join(' | ')).toBe(out[i]!.endMin));
    expect(out.filter(b => b.place === 'market_row.market_street').length).toBeGreaterThanOrEqual(1);
    expect(out.filter(b => b.action === 'work').length).toBeGreaterThanOrEqual(2);
  });

  it('stops on about seven weekdays in ten, the same ones each week', () => {
    const ids = Array.from({ length: 400 }, (_, i) => `x${i}`);
    const share = ids.filter(id => lingerFor(shopDay, id, 'Thu', AFTERNOON)).length / ids.length;
    expect(share).toBeGreaterThan(LINGER_CHANCE - 0.08);
    expect(share).toBeLessThan(LINGER_CHANCE + 0.08);
    expect(lingerFor(shopDay, 'x7', 'Thu', AFTERNOON)).toEqual(lingerFor(shopDay, 'x7', 'Thu', AFTERNOON));
  });

  it('never leaves sleep, a nap, a service, company or a Project shift, and stops short of a nap', () => {
    for (const verb of ['sleep', 'nap', 'attend', 'pray', 'socialize', 'visit', 'volunteer']) {
      const d = day([['06:00', 'eat', 'market_row.bakery_flat'], ['11:00', verb, 'market_row.bakery'], ['15:00', 'work', 'market_row.bakery'], ['22:00', 'sleep', 'market_row.bakery_flat']]);
      for (const id of stoppers('Tue')) expect(lingerFor(d, id, 'Tue', LUNCH), verb).toBeNull();
    }
    const id = stoppers('Tue')[0]!, s = LUNCH.starts[gatherHash(`Tue|${LUNCH.id}`) % LUNCH.starts.length]!;
    // A nap 25 minutes in: the stop ends where the nap starts.
    const napAt = s + 25;
    const d = day([['06:00', 'work', 'market_row.bakery'], [hhmm(napAt), 'nap', 'market_row.bakery_flat'], ['16:00', 'work', 'market_row.bakery'], ['22:00', 'sleep', 'market_row.bakery_flat']]);
    expect(lingerFor(d, id, 'Tue', LUNCH)).toMatchObject({ startMin: s, endMin: napAt });
    // Ten minutes in: too short a stop to make.
    const short = day([['06:00', 'work', 'market_row.bakery'], [hhmm(s + 10), 'nap', 'market_row.bakery_flat'], ['16:00', 'work', 'market_row.bakery'], ['22:00', 'sleep', 'market_row.bakery_flat']]);
    expect(lingerFor(short, id, 'Tue', LUNCH)).toBeNull();
  });

  it('folds leftovers under half an hour into the stop, and makes a lunch stop of lunch', () => {
    const id = stoppers('Fri')[0]!, s = LUNCH.starts[gatherHash(`Fri|${LUNCH.id}`) % LUNCH.starts.length]!;
    // Lunch indoors from 20 minutes before the stop to 10 minutes after it: all of it on the bench instead.
    const d = day([['06:00', 'work', 'market_row.bakery'], [hhmm(s - 20), 'eat', 'market_row.bakery_flat'], [hhmm(s + LUNCH.minutes + 10), 'work', 'market_row.bakery'], ['22:00', 'sleep', 'market_row.bakery_flat']]);
    expect(lingerFor(d, id, 'Fri', LUNCH)).toEqual({ window: 'lunch', place: 'market_row.market_street', action: 'eat', startMin: s - 20, endMin: s + LUNCH.minutes + 10 });
    expect(brief(spliceLinger(d, lingerFor(d, id, 'Fri', LUNCH)!, make))).toEqual([
      `06:00-${hhmm(s - 20)} work@market_row.bakery`,
      `${hhmm(s - 20)}-${hhmm(s + LUNCH.minutes + 10)} eat@market_row.market_street`,
      `${hhmm(s + LUNCH.minutes + 10)}-22:00 work@market_row.bakery`,
      '22:00-26:00 sleep@market_row.bakery_flat',
    ]);
  });

  it('stops in the district they go on to, never in an unbuilt one, on the way out of town, or where they already are', () => {
    const id = stoppers('Mon')[0]!, s = LUNCH.starts[gatherHash(`Mon|${LUNCH.id}`) % LUNCH.starts.length]!;
    // Leaving the bakery for the Wharf at the stop's end: the stop is at the Wharf (the walk on from it stays short).
    const toWharf = day([['06:00', 'work', 'market_row.bakery'], [hhmm(s + LUNCH.minutes), 'work', 'wharf.fish_market'], ['22:00', 'sleep', 'wharf.nell_cottage']]);
    expect(GATHERING_PLACES.wharf).toContain(lingerFor(toWharf, id, 'Mon', LUNCH)!.place);
    const millbrook = day([['06:00', 'work', 'millbrook.school'], ['22:00', 'sleep', 'millbrook.felix_house']]);
    expect(lingerFor(millbrook, id, 'Mon', LUNCH)).toBeNull();
    const leaving = day([['06:00', 'work', 'market_row.bakery'], [hhmm(s + LUNCH.minutes), 'work', 'offmap.city'], ['22:00', 'sleep', 'offmap.city']]);
    expect(lingerFor(leaving, id, 'Mon', LUNCH)).toBeNull();
    const there = day([['06:00', 'sit', 'market_row.market_street'], ['22:00', 'sleep', 'market_row.bakery_flat']]);
    expect(lingerFor(there, id, 'Mon', LUNCH)).toBeNull();
  });

  it("doesn't stop animals", () => {
    for (const id of stoppers('Sat', LUNCH, 10)) expect(withLingers(shopDay, { id, kind: 'animal' }, 'Sat', make)).toEqual(shopDay);
  });

  it('splices a stop over several blocks, keeping their edges', () => {
    const out = spliceLinger(shopDay, { window: 'lunch', place: 'market_row.market_street', action: 'socialize', startMin: 470, endMin: 500 }, make);
    expect(brief(out)).toEqual([
      '06:00-07:50 eat@market_row.bakery_flat', '07:50-08:20 socialize@market_row.market_street', '08:20-18:00 work@market_row.bakery',
      '18:00-22:00 socialize@market_row.gull_and_anchor', '22:00-26:00 sleep@market_row.bakery_flat',
    ]);
  });
});
