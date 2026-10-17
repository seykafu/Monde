// The Spring finale's pure parts (MVP G-11): the fair's dress, crowd and plans; the quotes; the poll in the paper; the
// End-of-Spring report; the dev presets.
import { describe, expect, it } from 'vitest';
import {
  emptyFinale, emptyFriendship, emptyProjects, emptyRiddles, emptyScuffles, fallbackPress, QUOTE_BANDS, type StrawPollRecord
} from '@monde/shared';
import { createTownState } from '../../town/pillars';
import { personaCards } from '../../world/residents';
import { PRESETS, SPRING_STYLES, applySpringPreset } from '../devPreset';
import {
  DRESSING, FAIR_CAST, OIL_LAMPS, attendShare, dressingFor, fairAttendees, fairMusic, fairPhase, fairShifts, lampsLit
} from '../fair';
import { bandOf, springPoll, springWorldOf, voteOutcome } from '../poll';
import { NOT_QUOTED, fallbackQuote, pickQuoted, quoteBrief, quoteLines, quotedResidents } from '../quotes';
import { DAY1_APPEAL, springReport, standingOf } from '../report';
import { REPORT_DAY, finaleOf, reportDue, updateFinale } from '../state';
import { ensureStrawPoll, setQuote, withStrawPoll } from '../take';

const registry = () => {
  const data = new Map<string, unknown>();
  const r = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => { data.set(k, v); return r; }, remove: (k: string) => data.delete(k) };
  return r;
};

describe('the Bloom Fair', () => {
  it('runs on the calendar: set-up on Day 24, the fair from noon on Day 25, the lamps from 17:30', () => {
    expect(fairPhase(24, 13 * 60)).toBe('none');
    expect(fairPhase(24, 15 * 60)).toBe('setup');
    expect(fairPhase(25, 9 * 60)).toBe('morning');
    expect(fairPhase(25, 12 * 60)).toBe('fair');
    expect(fairPhase(25, 18 * 60)).toBe('dusk');
    expect(fairPhase(26, 12 * 60)).toBe('none');
    expect(lampsLit('dusk')).toBe(true);
    expect(lampsLit('fair')).toBe(false);
    expect(OIL_LAMPS).toHaveLength(8); // Pell: "Eight lamps lit, out of eight."
  });

  it('dresses the Commons by phase and by band (S10a: seven stalls / a dozen / twenty)', () => {
    const stalls = (band: 'low' | 'mid' | 'high') => dressingFor('fair', band).filter(d => d.sprite === 'market_stall').length;
    expect(stalls('low')).toBeLessThan(stalls('mid'));
    expect(stalls('mid')).toBeLessThan(stalls('high'));
    expect(dressingFor('setup', 'high').some(d => d.sprite === 'bunting')).toBe(false);
    expect(dressingFor('none', 'high')).toEqual([]);
    expect(dressingFor('dusk', 'high')).toHaveLength(DRESSING.length);
  });

  it('plays the fair track on the Commons while the fair is open', () => {
    expect(fairMusic('commons', 25, 12 * 60)).toBe(true);
    expect(fairMusic('commons', 25, 11 * 60)).toBe(false);
    expect(fairMusic('market_row', 25, 13 * 60)).toBe(false);
    expect(fairMusic('commons', 25, 21 * 60)).toBe(false);
  });

  it('draws a crowd in proportion to §13.3a\'s headcounts, the scripts\' cast always there', () => {
    const everyone = Array.from({ length: 400 }, (_, i) => `r${i}`);
    const share = (band: 'low' | 'mid' | 'high') => fairAttendees(everyone, band, 7).length / everyone.length;
    expect(share('low')).toBeCloseTo(attendShare('low'), 1);
    expect(share('mid')).toBeCloseTo(attendShare('mid'), 1);
    expect(share('high')).toBeCloseTo(attendShare('high'), 1);
    const cast = fairAttendees([...FAIR_CAST, 'vane', 'rook'], 'low', 7);
    expect(cast).toEqual(FAIR_CAST);
  });

  it('books stallholders at their trestles, June on the tailgate, and everyone at the bandstand at dusk', () => {
    const shifts = fairShifts(['rosalind', 'june', 'margo', 'odile', 'r1'], 3);
    expect(shifts.find(s => s.resident === 'rosalind')).toMatchObject({ action: 'work', place: 'commons.sundial_lawn' });
    expect(shifts.filter(s => s.resident === 'june' && s.action === 'play_music')).toHaveLength(2);
    const r1 = shifts.filter(s => s.resident === 'r1');
    expect(r1).toHaveLength(2);
    expect(r1[1]).toMatchObject({ action: 'attend', place: 'commons.bandstand', startMin: 17 * 60 + 30 });
    for (const s of shifts) { expect(s.endMin).toBeGreaterThan(s.startMin); expect(s.area).toBeDefined(); }
  });
});

describe('the quotes', () => {
  it('have a written line for every band, for every resident who has their own', () => {
    for (const id of quotedResidents()) for (const band of QUOTE_BANDS) expect(quoteLines().residents[id]?.[band], `${id} ${band}`).toBeTruthy();
    for (const band of QUOTE_BANDS) expect(quoteLines().generic[band].length).toBeGreaterThanOrEqual(3);
    for (const id of quotedResidents()) expect(personaCards.some(c => c.id === id), id).toBe(true);
    expect(fallbackQuote('odile', 'moss', 1)).toMatch(/Gannet/);
    expect(QUOTE_BANDS.map(b => fallbackQuote('arrival_x', b, 4)).every(Boolean)).toBe(true);
  });

  it('quotes three met residents across the leans, never Pell or Sable', () => {
    const leans: StrawPollRecord['leans'] = [
      { id: 'pell', choice: 'fellow', band: 'fellow_strong' }, { id: 'sable', choice: 'vane', band: 'vane' },
      { id: 'odile', choice: 'fellow', band: 'fellow' }, { id: 'nell', choice: 'moss', band: 'moss' }, { id: 'hollis', choice: 'vane', band: 'torn' },
      { id: 'june', choice: 'fellow', band: 'fellow_strong' }, { id: 'teo', choice: 'fellow', band: 'fellow' }
    ];
    const picked = pickQuoted({ leans }, id => id !== 'teo', 9);
    expect(picked).toHaveLength(3);
    expect(picked.some(p => NOT_QUOTED.has(p.id))).toBe(false);
    expect(picked.map(p => p.band)).toEqual(expect.arrayContaining(['moss', 'torn']));
    expect(picked.some(p => p.id === 'teo')).toBe(false);
    expect(pickQuoted({ leans }, () => false, 9)).toEqual([]);
    expect(quoteBrief('Odile', 'vane')).toMatch(/Mr\. Vane's jar/);
  });
});

/** A Day-25 registry from a dev preset (the soak's numbers). */
function spring(style: (typeof SPRING_STYLES)[number]) {
  const r = registry();
  applySpringPreset(r, style, 25);
  return r;
}
const regardIn = (r: ReturnType<typeof registry>) => (id: string) => (r.get('monde.friendship') as ReturnType<typeof emptyFriendship>).regard[id] ?? 0;

describe('the poll in the game', () => {
  it('reads the world from the registry: deeds, met residents, the fair band', () => {
    const r = spring('strong');
    const w = springWorldOf(r, regardIn(r), 5)!;
    expect(w.deeds.projects.length).toBe(Object.keys(PRESETS.strong.projects).length);
    expect(w.deeds.scuffles).toEqual([{ zone: 'market_row', won: true }]);
    expect(w.met('odile')).toBe(true);
    expect(w.met('rook')).toBe(false);
    expect(bandOf(w.flags, 50)).toBe('mid');
    expect(bandOf(new Set(['fair_band_high']), 10)).toBe('high');
  });

  it('is counted once, saved, and its live quotes replace the written ones', () => {
    const r = spring('social');
    expect(finaleOf(r).poll).toBeNull();
    const first = ensureStrawPoll(r, regardIn(r), 5)!;
    expect(first.poll!.ballots).toBe(65);
    expect(first.quotes.length).toBe(3);
    expect(ensureStrawPoll(r, () => 100, 5)).toEqual(first); // never recounted
    const id = first.quotes[0]!.id;
    expect(setQuote(r, id, 'Yours. Obviously.').quotes[0]).toMatchObject({ text: 'Yours. Obviously.', live: true });
  });

  it("gives S10c `vote.*`: whole percentages, the margin in points, and whether the lead beats it", () => {
    const poll = springPoll(springWorldOf(spring('strong'), regardIn(spring('strong')), 5)!);
    const v = voteOutcome(poll);
    expect(v.share + v.vane + v.moss).toBe(100);
    expect(v.margin).toBe(12);
    expect(v.winner).toBe('fellow');
    expect(v.clear).toBe(true);
    const passive = voteOutcome(springPoll(springWorldOf(spring('passive'), () => 0, 5)!));
    expect(passive.winner).not.toBe('fellow');
  });

  it('leads the Day 26 Lantern (a template edition takes the poll\'s headline and the fair)', () => {
    const r = spring('builder');
    const finale = ensureStrawPoll(r, regardIn(r), 5)!;
    const edition = fallbackPress(REPORT_DAY, [], []);
    const paper = withStrawPoll(edition, finale, REPORT_DAY, id => id.toUpperCase());
    expect(paper.headline).toMatch(/^IF MONDE VOTED TOMORROW: /);
    expect(paper.stories[0]).toMatchObject({ title: 'Bloom Fair' });
    expect(paper.poll!.percent.fellow + paper.poll!.percent.vane + paper.poll!.percent.moss).toBe(100);
    expect(paper.poll!.quotes.length).toBe(finale.quotes.length);
    expect(withStrawPoll(edition, finale, 27, id => id)).toBe(edition);
    expect(withStrawPoll({ ...edition, source: 'model', headline: 'TULIPS' }, finale, REPORT_DAY, id => id).headline).toBe('TULIPS');
  });
});

describe('the End-of-Spring report', () => {
  it('is due from the morning of Day 26 until it has been shown', () => {
    const r = registry();
    expect(reportDue(r, 25)).toBe(false);
    expect(reportDue(r, 26)).toBe(true);
    updateFinale(r, s => ({ ...s, reportDay: 26 }));
    expect(reportDue(r, 30)).toBe(false);
    expect(finaleOf(registry())).toEqual(emptyFinale());
  });

  it('adds up the Spring from the game\'s own record', () => {
    const r = spring('strong');
    const finale = ensureStrawPoll(r, regardIn(r), 5)!;
    const rep = springReport({
      day: 26, town: r.get('monde.town') as ReturnType<typeof createTownState>, projects: r.get('monde.projects') as ReturnType<typeof emptyProjects>,
      riddles: r.get('monde.riddles') as ReturnType<typeof emptyRiddles>, scuffles: r.get('monde.scuffles') as ReturnType<typeof emptyScuffles>,
      friendship: r.get('monde.friendship') as ReturnType<typeof emptyFriendship>, regard: regardIn(r), name: id => id,
      flags: new Set(['fair_band_mid', 'clock_running', 'option_known']), poll: finale.poll
    });
    expect(rep.days).toBe(25);
    expect(rep.pillars.map(p => p.start)).toEqual([18, 30, 22, 25]);
    expect(rep.pillars.find(p => p.pillar === 'charm')!.now).toBe(62);
    expect(rep.appeal.start).toBeCloseTo(DAY1_APPEAL, 5);
    expect(rep.projects).toEqual(['The bakery ovens', 'The fountain', 'The clocktower', 'The streetlights', 'The Commons garden', 'The Market Hall']);
    expect(rep.marks).toEqual({ solved: 9, total: 25 });
    expect(rep.scuffles).toEqual({ won: 1, fought: 1 });
    expect(rep.friends).toEqual([]);
    expect(rep.met).toBe(Object.keys(PRESETS.strong.regard).length);
    expect(rep.moments.length).toBeLessThanOrEqual(5);
    expect(rep.moments.at(-1)).toEqual({ day: 25, text: 'Seventy-three on the lawn for the Bloom Fair.' });
    expect(rep.moments.map(m => m.day)).toEqual([...rep.moments.map(m => m.day)].sort((a, b) => a - b));
    expect(rep.standing.title).toBe("The town's choice, if you stood");
  });

  it('dates the clock by the clocktower opening (S07a can chime from Day 6), and gives it one line', () => {
    const r = spring('strong');
    const projects = r.get('monde.projects') as ReturnType<typeof emptyProjects>;
    // The preset opens the bakery ovens on Day 4; here the clock runs first, on Day 3.
    const early = { ...projects, projects: { ...projects.projects, clocktower: { ...projects.projects.clocktower!, opened: 3 } } };
    const rep = springReport({
      day: 26, town: r.get('monde.town') as ReturnType<typeof createTownState>, projects: early, riddles: emptyRiddles(), scuffles: emptyScuffles(),
      friendship: r.get('monde.friendship') as ReturnType<typeof emptyFriendship>, regard: regardIn(r), name: id => id, flags: new Set(['clock_running']), poll: null
    });
    expect(rep.moments.find(m => m.text.startsWith('The clocktower runs'))?.day).toBe(3);
    expect(rep.moments.find(m => m.text.endsWith('the first Project of the Spring.'))).toEqual({ day: 4, text: 'The bakery ovens opened, the first Project of the Spring.' });
  });

  it('counts friends in hearts, and says where the Fellow stands', () => {
    const r = spring('social');
    const rep = springReport({
      day: 26, town: r.get('monde.town') as ReturnType<typeof createTownState>, projects: emptyProjects(), riddles: emptyRiddles(), scuffles: emptyScuffles(),
      friendship: r.get('monde.friendship') as ReturnType<typeof emptyFriendship>, regard: regardIn(r), name: id => id, flags: new Set(), poll: null
    });
    expect(rep.friends.length).toBe(17);
    expect(rep.friends.every(f => f.hearts >= 4)).toBe(true);
    expect(rep.friends[0]!.hearts).toBeGreaterThanOrEqual(rep.friends.at(-1)!.hearts);
    expect(standingOf(null, 0, 0).title).toBe('Still new in town');
    expect(standingOf(null, 0, 0).line).toMatch(/Hardly anyone/);
    expect(standingOf(null, 1, 3).line).toBe('3 residents know your voice; one counts you a friend.');
  });
});

describe('the dev presets', () => {
  it('set a whole Day-25 game in the registry for every play style', () => {
    for (const style of SPRING_STYLES) {
      const r = spring(style);
      expect((r.get('monde.town') as { pillars: unknown }).pillars).toEqual(PRESETS[style].pillars);
      expect((r.get('monde.clock') as { day: number }).day).toBe(25);
      expect(Object.keys((r.get('monde.story.flags') as Record<string, unknown>)).length).toBeGreaterThan(30);
    }
  });
});
