// MVP_PLAN G-03's acceptance: "Every MVP Project completes in a scripted test." One game, Day 1 to Day 20, through the
// game's own runtime (projects/runtime.ts on a registry, the town engine's dawn, the real puzzles and their checkers):
// every Spring Project is unlocked, funded (S04's cue, Pell, donations), gathered (Dunmore's, a resident's spares),
// worked (the player's shifts and residents' days), solved and opened, and the town changes as §6.3 says.
import { describe, expect, it } from 'vitest';
import { emptyEventLog, emptyFriendship, Inventory, type ClientEvent, type Pillar, type Press } from '@monde/shared';
import { addItem } from '../../economy/inventory';
import { itemById } from '../../economy/content';
import { setFellow, defaultFellow } from '../../fellow/state';
import { puzzles } from '../../puzzles/catalog';
import { indices } from '../../puzzles/core';
import { solution as PZ01 } from '../../puzzles/PZ-01';
import { completePuzzle } from '../../puzzles/runtime';
import { computeAppeal } from '../../town/appeal';
import { decideArrivals } from '../../town/migration';
import { createTownState, type TownState } from '../../town/pillars';
import { runDawn } from '../../town/townEngine';
import { PROJECTS } from '../catalog';
import * as E from '../engine';
import {
  askForDonation, askForHelp, askForMaterial, donateOwnCoins, flagsOf, handOverAt, openProject, projectCue, projectPaper,
  projectsDawn, projectsOf, recordSale, shiftsFor, signWithPell, startHouse, stockLeft, syncProjects, workAt, worldOf
} from '../runtime';

function registry() {
  const data = new Map<string, unknown>();
  const r = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => { data.set(k, v); return r; }, remove: (k: string) => data.delete(k), has: (k: string) => data.has(k) };
  r.set('monde.town', createTownState());
  r.set('monde.friendship', emptyFriendship());
  r.set('monde.events', emptyEventLog());
  r.set('monde.coins', { balance: 400 });
  r.set('monde.economy', { stamina: 100, maxStamina: 100, day: 1, gifts: {}, work: {} });
  setFellow(r, defaultFellow()); // ?skiptitle's Fellow: a Tinkerer (VH ×1.5)
  return r;
}
type R = ReturnType<typeof registry>;

const assignments = (n: number) => indices(2 ** n).map(mask => indices(n).map(i => (mask >> i) & 1));
/** A winning board for each puzzle, found the way the verifier test does (or authored, where the README gives it). */
const SOLUTIONS: Record<string, () => number[]> = {
  'PZ-01': () => [...PZ01],
  'PZ-02': () => [3, 5, 6, 7].reduce((s, m) => puzzles['PZ-02']!.move(s, m), puzzles['PZ-02']!.reset()).cells,
  'PZ-04': () => [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4],
  'PZ-05': () => assignments(5).find(c => puzzles['PZ-05']!.win({ ...puzzles['PZ-05']!.reset(), cells: c }))!,
  'PZ-06': () => [1],
  'PZ-13': () => assignments(6).find(c => puzzles['PZ-13']!.win({ ...puzzles['PZ-13']!.reset(), cells: c }))!,
  'PZ-15': () => [10, 30, 8, 32]
};

class Game {
  readonly r: R = registry();
  day = 1;
  minute = 600;
  /** What the openings applied to the Pillars (as the engine reports it, after clamps). */
  readonly gains: Record<Pillar, number> = { prosperity: 0, safety: 0, spirit: 0, charm: 0 };
  get now() { return { day: this.day, minute: this.minute }; }
  get town(): TownState { return this.r.get('monde.town') as TownState; }
  stage(id: string): E.Stage { const def = E.defOf(PROJECTS, id)!; return E.stageOf(def, projectsOf(this.r).projects[id], worldOf(this.r, this.now)); }
  /** Sleep: the town's dawn, then the Projects' (as attachTown and attachProjectsClock run them), a fresh day's Stamina. */
  sleep(): E.DawnResult {
    this.day++; this.minute = 360;
    this.r.set('monde.town', runDawn(this.town, { day: this.day }).state);
    this.r.set('monde.economy', { stamina: 100, maxStamina: 100, day: this.day, gifts: {}, work: {} });
    const result = projectsDawn(this.r, this.now);
    this.minute = 600;
    return result;
  }
  until(day: number): void { while (this.day < day) this.sleep(); }
  give(item: string, n: number): void { this.r.set('monde.inventory', addItem(Inventory.parse(this.r.get('monde.inventory') ?? {}), itemById(item)!, n)); }
  /** Buy at Dunmore's, minding the limited Project stock. */
  buy(item: string, n: number): number {
    let bought = 0;
    for (let i = 0; i < n; i++) {
      if (stockLeft(this.r, item) === 0) break;
      const price = itemById(item)!.price, coins = (this.r.get('monde.coins') as { balance: number }).balance;
      if (coins < price) break;
      this.r.set('monde.coins', { balance: coins - price });
      this.give(item, 1); recordSale(this.r, item); bought++;
    }
    return bought;
  }
  solve(id: string): void { expect(completePuzzle(this.r, this.now, id, { ...puzzles[id]!.reset(), cells: SOLUTIONS[id]!() })).toBe(true); syncProjects(this.r, this.now); }
  /** The player works shifts until the hours are in (or Stamina runs out, or `max` shifts). */
  work(id: string, present: string[] = [], max = Infinity): number {
    let shifts = 0;
    while (shifts < max) {
      const result = workAt(this.r, this.now, id, present);
      if (!result.ok) break;
      this.minute += result.minutes; shifts++;
    }
    return shifts;
  }
  /** Open it the way the ceremony does, at its time. */
  open(id: string, present: string[] = []): ReturnType<typeof openProject> {
    const p = projectsOf(this.r).projects[id]!;
    expect(p.ceremony).not.toBeNull();
    while (this.day < p.ceremony!.day) this.sleep();
    this.minute = p.ceremony!.minute;
    expect(E.ceremonyOpen(p, this.now)).toBe(true);
    const done = openProject(this.r, this.now, id, present);
    for (const [k, v] of Object.entries(done.pillars)) this.gains[k as Pillar] += v ?? 0;
    return done;
  }
  events(): ClientEvent[] { return (this.r.get('monde.events') as ReturnType<typeof emptyEventLog>).outbox; }
}

const projectGain = (town: TownState, p: Pillar): number => town.log.filter(c => c.source === 'project' && c.pillar === p).reduce((n, c) => n + c.applied, 0);

describe('every Spring Project, unlock to opening (MVP G-03)', () => {
  it('fountain, bakery ovens, streetlights, garden, Market Hall, two homes, lighthouse and clocktower all open', () => {
    const g = new Game();
    const opened: string[] = [];

    // ── Day 4: the bakery ovens open by day. ──
    g.until(4);
    expect(g.stage('bakery_ovens')).toBe('open');
    expect(g.stage('fountain')).toBe('locked');
    // PZ-02 can be solved before the Project is funded; the step waits.
    g.solve('PZ-02');
    let pell = signWithPell(g.r, g.now, 'bakery_ovens');
    expect(pell.ok).toBe(true);
    expect(g.town.fund).toBe(1800 + 3 * 123 - 150);
    g.buy('firebrick', 10);
    expect(handOverAt(g.r, g.now, 'bakery_ovens')).toEqual({ firebrick: 10 });
    expect(g.stage('bakery_ovens')).toBe('building');
    // Odile leads (yes at any Regard); June at Acquaintance. Tomorrow they're on site at 10:00.
    expect(askForHelp(g.r, g.now, 'bakery_ovens', 'odile', 0).verdict).toBe('yes');
    expect(askForHelp(g.r, g.now, 'bakery_ovens', 'june', 25).verdict).toBe('yes');
    expect(shiftsFor(g.r, 5).shifts.map(s => [s.resident, s.action, s.place])).toEqual([
      ['odile', 'volunteer', 'market_row.bakery'], ['june', 'volunteer', 'market_row.bakery']
    ]);

    // ── Day 5: S04 "Water Again": {project: fountain}, Pell's chit already signed; Tib signs on. ──
    let dawn = g.sleep();
    expect(dawn.credited).toEqual({});
    expect(projectCue(g.r, g.now, 'fountain', 's04_water_again')).toBe(true);
    expect(g.stage('fountain')).toBe('funded');
    expect(projectsOf(g.r).projects.fountain).toMatchObject({ signed_by: 'scene', funded: 5 });
    g.solve('PZ-01'); // S04's "I'll go down."
    expect(g.buy('pipe_fitting', 4)).toBe(2); // "Dunmore's has two. Rest, ask around."
    expect(askForMaterial(g.r, g.now, 'fountain', 'bertrand', 12)).toMatchObject({ verdict: 'given', item: 'pipe_fitting', count: 1 });
    expect(askForMaterial(g.r, g.now, 'fountain', 'moss', 15)).toMatchObject({ verdict: 'given', item: 'pipe_fitting', count: 1 });
    expect(handOverAt(g.r, g.now, 'fountain')).toEqual({ pipe_fitting: 4 });
    // Two of the player's shifts (Tinkerer: 1.5 VH each), beside Kasimir.
    expect(workAt(g.r, g.now, 'fountain', ['kasimir'])).toMatchObject({ ok: true, vh: 1.5, regard: ['kasimir'] });
    g.minute += 60;
    expect(workAt(g.r, g.now, 'fountain', ['kasimir'])).toMatchObject({ ok: true, vh: 1.5, regard: [] }); // once a day each
    g.minute += 60;
    expect(g.stage('fountain')).toBe('building');

    // ── Day 6: the ovens' volunteers are credited (2 VH each: all 4); Tib's first day at the fountain. ──
    dawn = g.sleep();
    expect(dawn.credited).toEqual({ bakery_ovens: 4 });
    expect(g.stage('bakery_ovens')).toBe('ready');
    const ovens = projectsOf(g.r).projects.bakery_ovens!.ceremony!;
    expect(ovens).toEqual({ day: 6, minute: 600 });
    expect(shiftsFor(g.r, 6).shifts.filter(s => s.action === 'attend').map(s => s.resident)).toEqual(['odile', 'pell', 'june']);
    // The morning paper: the opening is on today, and the fountain wants hands.
    const paper6 = projectPaper(g.r, 6, blankPaper(6), HEADLINES);
    expect(paper6.notices).toEqual(expect.arrayContaining(['The bakery ovens open today at 10:00, Fournier & Fille. All welcome.']));
    expect(paper6.notices.some(n => n.startsWith('The fountain needs hands: 1 hour to go'))).toBe(true);
    let o = g.open('bakery_ovens', ['odile', 'june']);
    expect(o).toMatchObject({ opened: true, pillars: { prosperity: 3 }, flags: ['project_bakery_ovens_done'] });
    opened.push('bakery_ovens');
    // An afternoon shift at the fountain, while Tib works beside the player.
    g.minute = 840;
    expect(workAt(g.r, g.now, 'fountain', ['tib'])).toMatchObject({ ok: true, vh: 1.5, regard: ['tib'] });

    // ── Day 7: Tib's hours are credited (capped at the last 1.5): the fountain is ready, and opens at 10:00. ──
    dawn = g.sleep();
    expect(dawn.credited).toEqual({ fountain: 1.5 });
    expect(projectsOf(g.r).projects.fountain).toMatchObject({ vh: 6, player_vh: 4.5, volunteer_vh: 1.5 });
    expect(projectsOf(g.r).standing).toEqual([]);
    // Yesterday's opening leads this morning's paper.
    const paper7 = projectPaper(g.r, 7, blankPaper(7), HEADLINES);
    expect(paper7.headline).toBe('THE WORK ON THE BAKERY OVENS IS DONE, AND IT WORKS.');
    expect(paper7.stories[0]!.text).toContain("Odile's ovens at Fournier & Fille were relit");
    const charm0 = g.town.pillars.charm, spirit0 = g.town.pillars.spirit;
    o = g.open('fountain', ['kasimir', 'bertrand', 'tib']);
    expect(o).toMatchObject({ opened: true, pillars: { charm: 6, spirit: 2 } });
    expect(g.town.pillars.charm).toBeCloseTo(charm0 + 6, 5);
    expect(g.town.pillars.spirit).toBeCloseTo(spirit0 + 2, 5);
    // The board swaps the fountain's art on this flag (§16.4.1); S23 reads it.
    expect(flagsOf(g.r).has('project_fountain_done')).toBe(true);
    // One town event for everyone there (the server writes their memories), and the leads' own.
    const open = g.events().filter(e => e.kind === 'town_event' && e.type === 'project_open');
    expect(open.at(-1)).toMatchObject({ place: 'old_quarter.fountain_square', importance: 6 });
    const last = open.at(-1)!;
    expect(last.kind === 'town_event' ? last.participants : []).toEqual(expect.arrayContaining(['player', 'kasimir', 'bertrand', 'tib', 'pell']));
    expect(g.events().filter(e => e.kind === 'scripted_memory' && e.cue_key.startsWith('open:fountain:')).map(e => e.kind === 'scripted_memory' && e.resident)).toEqual(['kasimir', 'bertrand']);
    expect(g.events().filter(e => e.kind === 'scripted_regard' && e.scene_id === 'projects').map(e => e.kind === 'scripted_regard' && [e.resident, e.delta])).toEqual([['kasimir', 1], ['tib', 1]]);
    opened.push('fountain');

    // ── Day 8: the streetlights open by day; the garden waits for PZ-06. ──
    g.until(8);
    expect(g.stage('streetlights')).toBe('open');
    expect(g.stage('community_garden')).toBe('locked');
    g.solve('PZ-06');
    expect(g.stage('community_garden')).toBe('open');
    expect(signWithPell(g.r, g.now, 'streetlights').ok).toBe(true);
    expect(signWithPell(g.r, g.now, 'community_garden').ok).toBe(true);
    g.give('lamp_glass', 12); g.give('seeds', 10);
    handOverAt(g.r, g.now, 'streetlights'); handOverAt(g.r, g.now, 'community_garden');
    // Eight hours of lamps: four volunteers tomorrow; ten of garden: the player and three neighbours a day.
    for (const r of ['augusta', 'ada', 'margo', 'sable']) expect(askForHelp(g.r, g.now, 'streetlights', r, 30).verdict).toBe('yes');
    expect(askForHelp(g.r, g.now, 'streetlights', 'priya', 30).verdict).toBe('not_needed');
    expect(g.work('community_garden', [], 6)).toBe(6); // 1.5 × 6 = 9 VH; Teo brings the last hour
    expect(projectsOf(g.r).projects.community_garden!.vh).toBe(9);
    expect(askForHelp(g.r, g.now, 'community_garden', 'teo', 0).verdict).toBe('yes');
    g.sleep(); // Day 9: the lamp volunteers and Teo are on site.
    expect(shiftsFor(g.r, 9).shifts.filter(s => s.action === 'volunteer').map(s => s.resident).sort()).toEqual(['ada', 'augusta', 'margo', 'sable', 'teo']);
    g.solve('PZ-13');
    dawn = g.sleep(); // Day 10
    expect(dawn.credited).toEqual({ streetlights: 8, community_garden: 1 });
    expect(g.stage('streetlights')).toBe('ready');
    expect(g.stage('community_garden')).toBe('ready');
    const safety0 = g.town.pillars.safety, elder0 = computeAppeal(g.town).elder;
    expect(g.open('streetlights').pillars).toEqual({ safety: 6, charm: 2 });
    expect(g.town.pillars.safety).toBeCloseTo(safety0 + 6, 5);
    expect(g.town.flags.project_streetlights_done).toBe(true);
    expect(computeAppeal(g.town).elder).toBeGreaterThan(elder0 + 3);
    expect(E.nightTollmenReduction(PROJECTS, projectsOf(g.r))).toBe(1);
    opened.push('streetlights');
    expect(g.open('community_garden').pillars).toEqual({ spirit: 3, charm: 2 });
    expect(flagsOf(g.r).has('project_community_garden_done')).toBe(true);
    opened.push('community_garden');
    // The streetlights' upkeep comes out of tomorrow's books.
    const fund10 = g.town.fund;
    g.sleep(); // Day 11
    expect(g.town.fund).toBe(fund10 + 123 - 10);

    // ── Day 10–14: homes, one house at a time (repeatable). ──
    for (const house of ['old_quarter.vacant_house_39', 'wharf.vacant_house_48']) {
      const id = startHouse(g.r, g.now, house)!;
      expect(id).toBe(E.homesId(house));
      expect(startHouse(g.r, g.now, 'old_quarter.vacant_house_40')).toBeNull();
      expect(signWithPell(g.r, g.now, id).ok).toBe(true);
      g.give('timber', 4); g.give('glass', 2);
      handOverAt(g.r, g.now, id);
      expect(g.work(id, ['kasimir'])).toBe(4); // 4 × 1.5 = 6
      expect(g.stage(id)).toBe('ready');
      const free0 = g.town.homes.restored_free;
      const home = g.open(id, ['kasimir']);
      expect(home.flags).toEqual([`project_${house.split('.')[1]}_done`]);
      expect(g.town.homes.restored_free).toBe(free0 + 1);
      opened.push(id);
      g.sleep();
    }
    expect(g.town.homes).toMatchObject({ restored_free: 2, vacant_restorable: 59 });

    // ── Day 13–14: the Market Hall (Day 12). ──
    g.until(13);
    expect(g.stage('market_hall')).toBe('open');
    expect(signWithPell(g.r, g.now, 'market_hall').ok).toBe(true);
    g.give('timber', 20); g.give('paint', 6);
    expect(handOverAt(g.r, g.now, 'market_hall')).toEqual({ timber: 20, paint: 6 });
    for (const r of ['odile', 'nell', 'kasimir', 'june']) expect(askForHelp(g.r, g.now, 'market_hall', r, 25).verdict).toBe('yes');
    g.work('market_hall'); // 9 of the 16 hours
    g.solve('PZ-04');
    g.sleep(); // Day 14: 8 more VH at the dawn after
    g.sleep(); // Day 15
    expect(g.stage('market_hall')).toBe('ready');
    expect(g.open('market_hall').pillars).toEqual({ prosperity: 6, spirit: 3 });
    expect(E.activeEffects(PROJECTS, projectsOf(g.r))).toEqual(expect.arrayContaining(['bakery_stays_open', 'weekly_market', 'night_tollmen_minus_1']));
    opened.push('market_hall');

    // ── Day 16: the lighthouse (the stretch Project), with a short Fund made up by donations. ──
    g.until(16);
    expect(g.stage('lighthouse')).toBe('open');
    g.r.set('monde.town', { ...g.town, fund: 750 });
    pell = signWithPell(g.r, g.now, 'lighthouse');
    expect(pell).toMatchObject({ ok: false, short: 50 });
    expect(pell.line).toContain('50 short');
    expect(askForDonation(g.r, 'lighthouse', 'nell', 45)).toMatchObject({ verdict: 'given', coins: 20 });
    expect(askForDonation(g.r, 'lighthouse', 'moss', 41)).toMatchObject({ verdict: 'given', coins: 20 });
    expect(askForDonation(g.r, 'lighthouse', 'moss', 41).verdict).toBe('already');
    expect(donateOwnCoins(g.r, 'lighthouse')).toBe(10);
    expect(signWithPell(g.r, g.now, 'lighthouse').ok).toBe(true);
    expect(g.town.fund).toBe(0);
    g.give('lens_oil', 4); g.give('brass', 6);
    handOverAt(g.r, g.now, 'lighthouse');
    for (const r of ['nell', 'moss', 'rosalind']) askForHelp(g.r, g.now, 'lighthouse', r, 30);
    g.work('lighthouse');
    g.solve('PZ-05');
    g.sleep(); g.sleep(); // Day 18
    expect(g.stage('lighthouse')).toBe('ready');
    expect(projectsOf(g.r).projects.lighthouse!.ceremony).toEqual({ day: 18, minute: 1200 }); // at dusk, for the beam
    expect(g.open('lighthouse').pillars).toEqual({ safety: 4, charm: 4 });
    expect(flagsOf(g.r).has('project_lighthouse_done')).toBe(true);
    opened.push('lighthouse');

    // ── The clocktower: the OQ chain finds the pinion; PZ-15 (S07a) opens it on the spot. ──
    expect(g.stage('clocktower')).toBe('locked');
    g.r.set('monde.story.flags', { ...(g.r.get('monde.story.flags') as object), pinion_found: true });
    syncProjects(g.r, g.now);
    expect(g.stage('clocktower')).toBe('puzzle');
    const charmBefore = g.town.pillars.charm;
    g.solve('PZ-15');
    expect(g.stage('clocktower')).toBe('opened');
    expect(flagsOf(g.r).has('project_clocktower_done')).toBe(true);
    expect(g.town.pillars.charm).toBeCloseTo(charmBefore + 5, 5); // PZ-15's own Charm +5, nothing on top
    opened.push('clocktower');

    // Every Spring Project is open, and the town changed by exactly §6.3's numbers.
    expect(PROJECTS.map(p => p.id).every(id => opened.some(o => E.defIdOf(o) === id))).toBe(true);
    for (const id of Object.keys(projectsOf(g.r).projects)) expect(g.stage(id)).toBe('opened');
    const expected = { prosperity: 3 + 6, safety: 6 + 4, spirit: 2 + 3 + 3, charm: 6 + 2 + 2 + 4 };
    for (const p of Object.keys(expected) as Pillar[]) expect(g.gains[p]).toBeCloseTo(expected[p], 5);
    // Through the town engine's `project` source, uncapped (the log keeps the last seven days).
    expect(projectGain(g.town, 'safety')).toBeGreaterThanOrEqual(4);
    // Two free homes: a ferry day with Appeal over 35 can bring two households (§6.4's hard cap).
    const appeal = computeAppeal(g.town);
    expect(appeal.appeal).toBeGreaterThan(35);
    expect(decideArrivals({ day: 22, appeal: appeal.appeal, youthShare: appeal.youthShare, freeHomes: g.town.homes.restored_free }).households).toBeGreaterThan(0);
    expect(decideArrivals({ day: 22, appeal: 60, youthShare: 0.5, freeHomes: g.town.homes.restored_free }).households).toBe(2);
  });
});

const HEADLINES = [
  { id: 'HL-PJ-01', category: 'Project milestones', headline: '{project|upper} IS DONE, AND IT WORKS.', dek: 'Residents gathered at {place} to confirm the miracle, and the builders declined to comment, which is how builders comment.' }
];
const blankPaper = (day: number): Press => ({
  day, source: 'template', headline: 'THE LANTERN — MORNING EDITION', dek: 'The morning paper, set by hand.',
  stories: [{ event_id: null, title: 'The day book', text: 'No further reports reached the desk yesterday.' }, { event_id: null, title: 'Letters desk', text: 'Letters for the Lantern may be left at the office.' }],
  event_ids: [], letters: [], movements: [], notices: []
});
