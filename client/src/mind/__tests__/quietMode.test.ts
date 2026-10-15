import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { gameContext } from '@monde/shared';
import { Rng } from '../../util/rng';
import {
  applyWindows, emptyQuietState, FILLER_IDS, fillLine, firstName, kindFor, lineMatches, lineScore, parseLineLibrary,
  pickLine, quietContext, quietTurn, rememberLine, restoreQuietState, timeBand, WINDOW_LEVELS, type ContextInput,
  type LineLibrary, type QuietContext, type QuietState
} from '../quietMode';

const content = resolve(import.meta.dirname, '../../../..', 'content');
const library = parseLineLibrary(parse(readFileSync(resolve(content, 'lines/lines.yaml'), 'utf8')));
const RESIDENTS = { odile: 'Odile', bastien: 'Bastien', hollis: 'Hollis', augusta: 'Augusta', sable: 'Sable', pell: 'Edwina' };

const base: ContextInput = {
  kind: 'greet', day: 3, minute: 10 * 60, weather: 'sun', zone: 'market_row', valence: 0, regard: 0,
  speaker: { id: 'pell', name: 'Edwina Pell' }, player: 'Wren', residents: RESIDENTS
};
const ctx = (over: Partial<ContextInput> = {}): QuietContext => quietContext({ ...base, ...over });
const rng = (seed: number) => { const r = new Rng(seed); return () => r.next(); };

/** A small library with known tags, for exact window and weighting checks. */
const tiny = (lines: { id: string; kind?: string; when?: Record<string, string[]>; text?: string }[]): LineLibrary =>
  parseLineLibrary({
    lines: [
      ...lines.map(l => ({ kind: 'talk', when: {}, text: `line ${l.id}`, ...l })),
      ...FILLER_IDS.map(id => ({ id, kind: 'talk', when: {}, text: `filler ${id}` }))
    ]
  });

describe('the line library', () => {
  it('loads every Appendix B line with its tags and groups', () => {
    expect(library.lines.length).toBeGreaterThan(280);
    expect(library.fillers.map(l => l.id)).toEqual(FILLER_IDS);
    const gr001 = library.byId.get('GR-001')!;
    expect(gr001).toMatchObject({ kind: 'greet', when: { t: ['dawn'], m: ['glum'] } });
    expect(gr001.group).toBe(library.byId.get('GR-002')!.group);
    expect(gr001.group).not.toBe(library.byId.get('GR-003')!.group);
  });

  it('rejects a malformed line', () => {
    expect(() => parseLineLibrary({ lines: [{ id: 'GR-001', kind: 'greet', when: { t: ['teatime'] }, text: 'x' }] })).toThrow(/GR-001/);
    expect(() => parseLineLibrary({ lines: [{ id: 'GR-001', kind: 'shout', text: 'x' }] })).toThrow(/kind/);
  });
});

describe('context', () => {
  it('builds B.1 bands from the clock, mood and Regard', () => {
    expect([360, 539, 540, 720, 840, 1080, 1320, 1559].map(timeBand)).toEqual(['dawn', 'dawn', 'morning', 'midday', 'afternoon', 'evening', 'night', 'night']);
    const c = ctx({ valence: 70, regard: 45 });
    expect([c.mood, c.tier, c.place, c.speaker.firstName]).toEqual(['glowing', 'Friend', 'Market Row', 'Edwina']);
    expect(firstName('Captain Augusta Reyes')).toBe('Augusta');
    expect(firstName('Juniper "June" Castellanos')).toBe('June');
  });
});

describe('filtering and scoring (B.1 steps 1–2)', () => {
  it('keeps only lines whose every tag matches', () => {
    const c = ctx({ kind: 'greet', minute: 7 * 60 }); // dawn, even, Stranger
    const pool = library.lines.filter(l => lineMatches(l, c));
    expect(pool.length).toBeGreaterThan(0);
    for (const l of pool) {
      expect(l.kind).toBe('greet');
      if (l.when.t) expect(l.when.t).toContain('dawn');
      if (l.when.m) expect(l.when.m).toContain('even');
      if (l.when.r_exact) expect(l.when.r_exact).toContain('Stranger');
    }
    expect(pool.map(l => l.id)).toContain('GR-005');
    expect(pool.map(l => l.id)).not.toContain('GR-001'); // glum
    expect(pool.map(l => l.id)).not.toContain('GR-061'); // r:=Wary
  });

  it('applies minimum tiers, exact tiers, weather, zone, events and req flags', () => {
    const wary = ctx({ regard: -10 });
    expect(library.lines.filter(l => lineMatches(l, wary) && l.when.r).length).toBe(0); // r:Stranger lines are out
    const news = (over: Partial<ContextInput>) => library.lines.filter(l => lineMatches(l, ctx({ kind: 'ctx', ...over }))).map(l => l.id);
    expect(news({ weather: 'rain' })).toContain('CX-009');
    expect(news({ weather: 'sun' })).not.toContain('CX-009');
    expect(news({ zone: 'old_quarter' })).toContain('CX-029'); // !flag.quarter_chime
    expect(news({ zone: 'old_quarter' })).not.toContain('CX-030');
    const chimed = gameContext({ flags: new Set(['quarter_chime']) });
    const withFlag = library.lines.filter(l => lineMatches(l, { ...ctx({ kind: 'ctx', zone: 'old_quarter' }), req: chimed })).map(l => l.id);
    expect(withFlag).toContain('CX-030');
    expect(withFlag).not.toContain('CX-029');
    expect(news({})).not.toContain('CX-084'); // ev:station_open
    expect(news({ event: 'station_open' })).toContain('CX-085');
  });

  it('skips lines whose placeholders cannot be filled', () => {
    const c = ctx({ kind: 'ctx', residents: { bastien: 'Bastien' } });
    const ids = library.lines.filter(l => lineMatches(l, c)).map(l => l.id);
    expect(ids).toContain('CX-088'); // {resident:bastien}
    expect(ids).not.toContain('CX-091'); // {resident:sable} isn't in town
    const asBastien = { ...c, speaker: { id: 'bastien', firstName: 'Bastien' } };
    expect(library.lines.filter(l => lineMatches(l, asBastien)).map(l => l.id)).not.toContain('CX-088');
    const nowhere = { ...c, place: null };
    expect(library.lines.filter(l => lineMatches(l, nowhere)).map(l => l.id)).not.toContain('CX-010');
  });

  it('scores ev 8 · w 4 · z 3 · r:= 3 · t 2 · m 2 · r: 1', () => {
    const s = (id: string) => lineScore(library.byId.get(id)!);
    expect(s('ST-046')).toBe(0);
    expect(s('GR-001')).toBe(2 + 2);
    expect(s('RX-001')).toBe(8 + 1);
    expect(s('GR-061')).toBe(3 + 2);
    expect(s('CX-086')).toBe(8 + 3);
  });
});

describe('drawing (B.1 step 3)', () => {
  it('draws only from lines within 2 points of the best', () => {
    const lib = tiny([{ id: 'ST-001', when: { m: ['even'], t: ['morning'] } }, { id: 'ST-002', when: { m: ['even'] } }, { id: 'ST-003' }]);
    const c = ctx({ kind: 'talk' });
    const picked = new Set<string>();
    for (let seed = 1; seed < 200; seed++) picked.add(pickLine(lib, c, emptyQuietState(), rng(seed)).line.id);
    expect(picked).toEqual(new Set(['ST-001', 'ST-002'])); // 4 and 2 points; ST-003 (0) is out of the band
  });

  it('weights by 1 / (1 + the group\'s uses by this resident in the last 3 days)', () => {
    const lib = tiny([{ id: 'ST-001', when: { m: ['even'], t: ['morning'] } }, { id: 'ST-002', when: { m: ['glum', 'even'], t: ['morning', 'midday'] } }]);
    const c = ctx({ kind: 'talk', day: 10 });
    const state = emptyQuietState();
    const a = lib.byId.get('ST-001')!;
    // Three uses of ST-001's group on days 8–10 (within 3 days), one on day 7 (outside).
    state.residents.pell = { recent: [], uses: [{ group: a.group, day: 7 }, { group: a.group, day: 8 }, { group: a.group, day: 9 }, { group: a.group, day: 10 }] };
    let first = 0;
    const n = 4000;
    for (let seed = 1; seed <= n; seed++) if (pickLine(lib, c, state, rng(seed)).line.id === 'ST-001') first++;
    expect(first / n).toBeCloseTo(0.25 / 1.25, 1); // weights 1/4 vs 1
  });

  it('is deterministic for a seed', () => {
    const c = ctx({ kind: 'ctx', event: 'station_open', weather: 'rain' });
    const a = Array.from({ length: 20 }, (_, i) => pickLine(library, c, emptyQuietState(), rng(i)).line.id);
    const b = Array.from({ length: 20 }, (_, i) => pickLine(library, c, emptyQuietState(), rng(i)).line.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBeGreaterThan(1);
  });

  it('prefers an ev line about 70% of the time for ctx with an event', () => {
    const c = ctx({ kind: 'ctx', event: 'station_open' });
    let ev = 0;
    for (let seed = 1; seed <= 1000; seed++) if (pickLine(library, c, emptyQuietState(), rng(seed)).line.when.ev) ev++;
    expect(ev / 1000).toBeGreaterThan(0.62);
    expect(ev / 1000).toBeLessThan(0.78);
  });
});

describe('no-repeat windows (B.1 step 4)', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => ({ id: `ST-${String(100 + i)}`, when: { m: ['even'] }, text: `line ${i}` }));

  it('keeps a resident\'s last 12 lines and last 4 groups out', () => {
    // 20 lines in 20 distinct groups (each its own zone/time combination is overkill; distinct texts suffice for ids).
    const groups = ['dawn', 'morning', 'midday', 'afternoon', 'evening', 'night'] as const;
    const lib = tiny(twenty.map((l, i) => ({ ...l, when: { m: ['even'], ...(i < 6 ? { t: [groups[i]!] } : {}) } })));
    const state = emptyQuietState();
    const recentIds = ['ST-106', 'ST-107', 'ST-108'];
    for (const id of recentIds) rememberLine(state, 'pell', lib.byId.get(id)!, 3);
    const c = ctx({ kind: 'talk' });
    const out = applyWindows(lib.lines.filter(l => lineMatches(l, c)), c, state, WINDOW_LEVELS[0]!).map(l => l.id);
    for (const id of recentIds) expect(out).not.toContain(id);
    // ST-106..119 share one group (m:even only), and that group is in the last 4: all of them are out.
    expect(out.filter(id => Number(id.slice(3)) >= 106 && Number(id.slice(3)) < 120)).toEqual([]);
    expect(out).toContain('ST-101'); // t:morning, its own group
  });

  it('keeps the player\'s last 40 lines out, across residents', () => {
    const lib = tiny(twenty);
    const state = emptyQuietState();
    for (const l of lib.lines.slice(0, 15)) rememberLine(state, 'odile', l, 3);
    const c = ctx({ kind: 'talk' });
    const out = applyWindows(lib.lines.filter(l => lineMatches(l, c)), c, state, WINDOW_LEVELS[0]!).map(l => l.id);
    expect(out).toEqual(['ST-115', 'ST-116', 'ST-117', 'ST-118', 'ST-119', ...FILLER_IDS]);
  });

  it('avoids a line another resident used today while at least 2 others survive', () => {
    const lib = tiny([{ id: 'ST-001' }, { id: 'ST-002' }, { id: 'ST-003' }]);
    const plain = (ids: string[]) => ({ ...lib, lines: lib.lines.filter(l => ids.includes(l.id)) });
    const c = ctx({ kind: 'talk' });
    const state: QuietState = { ...emptyQuietState(), day: c.day, today: { 'ST-001': ['odile'] } };
    const three = plain(['ST-001', 'ST-002', 'ST-003']).lines;
    expect(applyWindows(three, c, state, WINDOW_LEVELS[0]!).map(l => l.id)).toEqual(['ST-002', 'ST-003']);
    const two = plain(['ST-001', 'ST-002']).lines;
    expect(applyWindows(two, c, state, WINDOW_LEVELS[0]!).map(l => l.id)).toEqual(['ST-001', 'ST-002']);
    // A different day: yesterday's lines don't count.
    expect(applyWindows(three, { ...c, day: c.day + 1 }, state, WINDOW_LEVELS[0]!).map(l => l.id)).toEqual(['ST-001', 'ST-002', 'ST-003']);
  });

  it('exhausts in order: halve the windows, drop the player rule, drop the resident rule, then fillers', () => {
    const lib = tiny([{ id: 'ST-001', when: { m: ['even'] } }, { id: 'ST-002', when: { m: ['even', 'low'] } }]);
    const only = { ...lib, lines: lib.lines.filter(l => !FILLER_IDS.includes(l.id)) };
    const c = ctx({ kind: 'talk' });
    // Both lines said by this resident 8 lines ago: out of the full window of 12, back in the halved 6.
    const state = emptyQuietState();
    rememberLine(state, 'pell', lib.byId.get('ST-001')!, 3);
    rememberLine(state, 'pell', lib.byId.get('ST-002')!, 3);
    for (let i = 0; i < 8; i++) rememberLine(state, 'pell', lib.fillers[i % 6]!, 3);
    for (let i = 0; i < 12; i++) rememberLine(state, 'odile', lib.fillers[i % 6]!, 3); // 20 lines since: out of the halved 20
    expect(pickLine(only, c, state, rng(1)).level).toBe(1);
    // Said by the player's other conversations only recently: the player rule goes.
    const s2 = emptyQuietState();
    rememberLine(s2, 'odile', lib.byId.get('ST-001')!, 3);
    rememberLine(s2, 'odile', lib.byId.get('ST-002')!, 3);
    expect(pickLine(only, c, s2, rng(1)).level).toBe(2);
    // Just said by this very resident: only dropping the resident rule frees them.
    const s3 = emptyQuietState();
    rememberLine(s3, 'pell', lib.byId.get('ST-001')!, 3);
    rememberLine(s3, 'pell', lib.byId.get('ST-002')!, 3);
    expect(pickLine(only, c, s3, rng(1)).level).toBe(3);
    // Nothing matches at all: the always-valid fillers.
    const none = pickLine(only, ctx({ kind: 'react' }), emptyQuietState(), rng(1));
    expect(none.filler).toBe(true);
    expect(FILLER_IDS).toContain(none.line.id);
  });

  it('survives a long Quiet Mode day without repeating inside the windows', () => {
    const state = emptyQuietState(), r = rng(42);
    const seenBy: Record<string, string[]> = {};
    const player: string[] = [];
    for (let i = 0; i < 300; i++) {
      const who = ['pell', 'odile', 'hollis'][i % 3]!;
      const kind = (['greet', 'talk', 'ctx', 'bye'] as const)[i % 4]!;
      const c = { ...ctx({ kind, minute: 400 + i * 3, valence: (i % 5) * 40 - 80 }), speaker: { id: who, firstName: who } };
      const p = pickLine(library, c, state, r);
      if (p.level === 0 && !p.filler) {
        expect((seenBy[who] ?? []).slice(-12)).not.toContain(p.line.id);
        expect(player.slice(-40)).not.toContain(p.line.id);
      }
      rememberLine(state, who, p.line, c.day);
      (seenBy[who] ??= []).push(p.line.id);
      player.push(p.line.id);
    }
  });
});

describe('filling (B.1 step 5)', () => {
  it('fills every placeholder', () => {
    const c = ctx({ kind: 'ctx', minute: 13 * 60, weather: 'fog' });
    expect(fillLine('{player}, {name}, {place}, {weather}, {time_of_day}, {resident:odile}.', c))
      .toBe('Wren, Edwina, Market Row, fog, afternoon, Odile.');
    expect(fillLine(library.byId.get('RX-051')!.text, ctx({ minute: 19 * 60 }))).toBe("Well, I've kept you long enough. Good evening.");
  });
});

describe('a Quiet Mode turn', () => {
  it('has the server turn\'s shape: one neutral line, neutral replies and Leave', () => {
    const state = emptyQuietState();
    const { turn, pick } = quietTurn({
      lib: library, state, rng: rng(3), conversationId: 'conv', residentId: 'pell', turnIndex: 0,
      input: { kind: 'open' }, context: (({ kind: _k, ...rest }) => rest)(ctx())
    });
    expect(pick!.line.kind).toBe('greet');
    expect(turn).toMatchObject({ conversation_id: 'conv', resident_id: 'pell', turn_index: 0, wrap_up: false, fallback: true });
    expect(turn.lines).toEqual([{ text: pick!.text, expr: 'neutral' }]);
    expect(turn.choices.map(c => c.intent)).toEqual(['kind', 'curious', 'leave']);
    expect(state.residents.pell!.recent.map(r => r.id)).toEqual([pick!.line.id]);
  });

  it('maps inputs to kinds and wraps up on Leave or after six exchanges', () => {
    expect(kindFor({ kind: 'open' }, 0)).toBe('greet');
    expect(kindFor({ kind: 'choice', choice_id: 'news', text: "What's the news?", intent: 'curious' }, 1)).toBe('ctx');
    expect(kindFor({ kind: 'say', text: 'Nice hat.' }, 2)).toBe('talk');
    expect(kindFor({ kind: 'choice', choice_id: 'leave', text: 'Leave', intent: 'leave' }, 2)).toBe('bye');
    expect(kindFor({ kind: 'say', text: 'And another thing' }, 6)).toBe('bye');
    const { turn } = quietTurn({
      lib: library, state: emptyQuietState(), rng: rng(1), conversationId: 'c', residentId: 'pell', turnIndex: 6,
      input: { kind: 'say', text: 'More?' }, context: (({ kind: _k, ...rest }) => rest)(ctx())
    });
    expect(turn.wrap_up).toBe(true);
    expect(turn.choices).toEqual([{ id: 'leave', text: 'Leave', intent: 'leave' }]);
  });

  it('gives narrated-action residents narrated lines', () => {
    const { turn, pick } = quietTurn({
      lib: library, state: emptyQuietState(), rng: rng(1), conversationId: 'c', residentId: 'bastien', turnIndex: 0, narrated: true,
      input: { kind: 'open' }, context: { ...(({ kind: _k, ...rest }) => rest)(ctx()), speaker: { id: 'bastien', firstName: 'Bastien' } }
    });
    expect(pick).toBeNull();
    expect(turn.lines[0]!.text).toMatch(/^\(Bastien .*\)$/);
  });

  it('restores a saved state and shrugs off junk', () => {
    const state = emptyQuietState();
    rememberLine(state, 'pell', library.byId.get('GR-005')!, 4);
    expect(restoreQuietState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(restoreQuietState('nonsense')).toEqual(emptyQuietState());
    expect(restoreQuietState({ residents: { pell: { recent: [1, { id: 'x' }], uses: 'no' } } }).residents.pell).toEqual({ recent: [], uses: [] });
  });
});
