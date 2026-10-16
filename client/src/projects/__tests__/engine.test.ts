// The Projects engine's rules (GDD §6.3, §11.1; MVP G-03), one at a time, on the real content and on small stand-ins.
import { describe, expect, it } from 'vitest';
import { emptyEconomy, emptyProjects } from '@monde/shared';
import { createTownState, type TownState } from '../../town/pillars';
import { fundDay } from '../../town/fund';
import { computeAppeal } from '../../town/appeal';
import { PROJECTS, PROJECT_CONTENT } from '../catalog';
import * as E from '../engine';
import type { ProjectDef } from '../schema';

const def = (id: string): ProjectDef => PROJECTS.find(p => p.id === id)!;
const world = (day: number, over: Partial<E.ProjectWorld> = {}): E.ProjectWorld =>
  ({ day, minute: 600, flags: new Set(), puzzleSolved: () => false, ...over });
const town = (fund = 1800): TownState => ({ ...createTownState({ day: 1 }), fund });
const bag = (...stacks: [string, number][]) => ({ slots: [...stacks.map(([item, count]) => ({ item, count })), ...Array.from({ length: 24 - stacks.length }, () => null)] });

/** A Project opened and signed for, ready for materials and hands. */
function funded(id: string, day = 10): E.ProjectsState {
  const d = def(id);
  const opened = d.opens.cue
    ? E.projectCue(PROJECTS, emptyProjects(), town(), id, 'elsewhere', { day }).state
    : E.unlockDue(PROJECTS, emptyProjects(), world(day, { flags: new Set(d.opens.flag ? [d.opens.flag] : []) })).state;
  const signed = E.signOff(d, opened, id, town(), { day });
  if (!signed.ok) throw new Error(`can't sign ${id}`);
  return signed.state;
}

describe('the stage machine', () => {
  it('walks locked → open → funded → gathering → building → puzzle → ready → opened', () => {
    const d = def('bakery_ovens');
    let solved = false;
    const w = (day: number) => world(day, { puzzleSolved: id => id === 'PZ-02' && solved });
    let s = emptyProjects();
    expect(E.stageOf(d, s.projects.bakery_ovens, w(3))).toBe('locked');
    expect(E.unlockDue(PROJECTS, s, w(3)).unlocked).not.toContain('bakery_ovens');
    s = E.unlockDue(PROJECTS, s, w(4)).state;
    expect(E.stageOf(d, s.projects.bakery_ovens, w(4))).toBe('open');
    const sign = E.signOff(d, s, 'bakery_ovens', town(), { day: 4 });
    if (!sign.ok) throw new Error('unsigned');
    expect(sign.town.fund).toBe(1800 - 150);
    s = sign.state;
    expect(E.stageOf(d, s.projects.bakery_ovens, w(4))).toBe('funded');
    s = E.handOver(d, s, 'bakery_ovens', bag(['firebrick', 6]), w(4)).state;
    expect(E.stageOf(d, s.projects.bakery_ovens, w(4))).toBe('gathering');
    const more = E.handOver(d, s, 'bakery_ovens', bag(['firebrick', 9], ['timber', 3]), w(4));
    expect(more.moved).toEqual({ firebrick: 4 });
    expect(more.bag.slots[0]).toEqual({ item: 'firebrick', count: 5 });
    expect(more.bag.slots[1]).toEqual({ item: 'timber', count: 3 });
    s = more.state;
    expect(E.stageOf(d, s.projects.bakery_ovens, w(4))).toBe('building');
    for (let i = 0; i < 4; i++) {
      const shift = E.work(d, s, 'bakery_ovens', { ...emptyEconomy(), day: 4 }, { day: 4, minute: 600, tinkerer: false });
      if (!shift.ok) throw new Error(shift.reason);
      s = shift.state;
    }
    expect(E.stageOf(d, s.projects.bakery_ovens, w(4))).toBe('puzzle');
    solved = true;
    expect(E.stageOf(d, s.projects.bakery_ovens, w(4))).toBe('ready');
    const done = E.completeProject(d, s, 'bakery_ovens', town(), { day: 5, place: 'market_row.bakery', attendees: ['odile'] });
    expect(E.stageOf(d, done.state.projects.bakery_ovens, w(5))).toBe('opened');
    expect(E.STAGES).toEqual(['locked', 'open', 'funded', 'gathering', 'building', 'puzzle', 'ready', 'opened']);
  });

  it('takes materials and hours in either order once funded, and nothing before', () => {
    const d = def('fountain');
    const open = E.projectCue(PROJECTS, emptyProjects(), town(10), 'fountain', 's04_water_again', { day: 5 });
    expect(open).toMatchObject({ unlocked: true, funded: false });
    expect(E.handOver(d, open.state, 'fountain', bag(['pipe_fitting', 4]), world(5)).moved).toEqual({});
    expect(E.work(d, open.state, 'fountain', { ...emptyEconomy(), day: 5 }, { day: 5, minute: 600, tinkerer: true })).toEqual({ ok: false, reason: 'not_funded' });
    const s = funded('fountain', 5);
    const hours = E.work(d, s, 'fountain', { ...emptyEconomy(), day: 5 }, { day: 5, minute: 600, tinkerer: true });
    if (!hours.ok) throw new Error(hours.reason);
    expect(E.stageOf(d, hours.state.projects.fountain, world(5))).toBe('gathering');
  });
});

describe('funding (§6.3 step 2)', () => {
  it("S04's cue carries Pell's signature: the Fund pays when it can, and the cue opens it only once", () => {
    const first = E.projectCue(PROJECTS, emptyProjects(), town(), 'fountain', 's04_water_again', { day: 5 });
    expect(first).toMatchObject({ unlocked: true, funded: true, known: true });
    expect(first.town.fund).toBe(1600);
    expect(first.state.projects.fountain).toMatchObject({ funded: 5, signed_by: 'scene' });
    const again = E.projectCue(PROJECTS, first.state, first.town, 'fountain', 's04_water_again', { day: 5 });
    expect(again.town.fund).toBe(1600);
    expect(E.projectCue(PROJECTS, emptyProjects(), town(), 'station', 's11_station', { day: 30 }).known).toBe(false);
    // The fountain only opens on its cue, never by the day alone.
    expect(E.unlockDue(PROJECTS, emptyProjects(), world(9)).unlocked).not.toContain('fountain');
  });

  it("Pell won't sign what the Fund can't cover; donations (Regard ≥ 40, 5% of savings, once) and the player's coins close the gap", () => {
    const d = def('lighthouse');
    let s = E.unlockDue(PROJECTS, emptyProjects(), world(16)).state;
    let t = town(760);
    expect(E.signOff(d, s, 'lighthouse', t, { day: 16 })).toEqual({ ok: false, reason: 'short', short: 40 });
    expect(E.askDonation(d, s, 'lighthouse', 'odile', 39, t).verdict).toBe('low_regard');
    expect(E.askDonation(d, s, 'lighthouse', 'pell', 90, t).verdict).toBe('never');
    const gift = E.askDonation(d, s, 'lighthouse', 'odile', 40, t);
    expect(gift).toMatchObject({ verdict: 'given', coins: E.donationAmount() });
    expect(E.donationAmount()).toBe(20);
    s = gift.state; t = gift.town;
    expect(t.fund).toBe(780);
    expect(E.askDonation(d, s, 'lighthouse', 'odile', 80, t).verdict).toBe('already');
    const own = E.donateOwn(d, s, 'lighthouse', 500, t);
    expect(own.coins).toBe(20);
    t = own.town;
    expect(E.askDonation(d, s, 'lighthouse', 'nell', 60, t).verdict).toBe('not_needed');
    const signed = E.signOff(d, s, 'lighthouse', t, { day: 16 });
    expect(signed.ok && signed.town.fund).toBe(0);
  });
});

describe('materials (§6.3 step 3)', () => {
  it("gives an authored donor's material once, at Regard ≥ 10, while it's still short", () => {
    const d = def('fountain');
    const s = funded('fountain', 5);
    expect(E.askMaterial(d, s, 'fountain', 'bertrand', 5, world(5)).verdict).toBe('low_regard');
    const given = E.askMaterial(d, s, 'fountain', 'bertrand', 12, world(5));
    expect(given).toMatchObject({ verdict: 'given', item: 'pipe_fitting', count: 1 });
    expect(E.askMaterial(d, given.state, 'fountain', 'bertrand', 12, world(5)).verdict).toBe('already');
    expect(E.askMaterial(d, given.state, 'fountain', 'odile', 99, world(5)).verdict).toBe('none');
    const full = E.handOver(d, given.state, 'fountain', bag(['pipe_fitting', 4]), world(5)).state;
    expect(E.askMaterial(d, full, 'fountain', 'moss', 50, world(5)).verdict).toBe('not_needed');
  });

  it('Handiwork 5 takes 20% off a home (rounded, at least one of each)', () => {
    expect(E.needs(def('homes'), {})).toEqual([{ item: 'timber', count: 4 }, { item: 'glass', count: 2 }]);
    expect(E.needs(def('homes'), { homeMaterialMultiplier: 0.8 })).toEqual([{ item: 'timber', count: 3 }, { item: 'glass', count: 2 }]);
    expect(E.needs(def('market_hall'), { homeMaterialMultiplier: 0.8 })).toEqual(def('market_hall').materials);
  });

  it("keeps Dunmore's two pipe fittings, with two more on a ferry day once they're gone and still wanted", () => {
    const stock = PROJECT_CONTENT.shopStock;
    let s = emptyProjects();
    expect(E.stockLeft(s, 'pipe_fitting', stock)).toBe(2);
    expect(E.stockLeft(s, 'timber', stock)).toBeNull();
    expect(E.stockLeft(E.dawn(PROJECTS, s, world(4), { ferryDay: true, stock }).state, 'pipe_fitting', stock)).toBe(2);
    s = E.recordSale(E.recordSale(funded('fountain', 5), 'pipe_fitting'), 'pipe_fitting');
    expect(E.stockLeft(s, 'pipe_fitting', stock)).toBe(0);
    expect(E.stockLeft(E.dawn(PROJECTS, s, world(7), { ferryDay: false, stock }).state, 'pipe_fitting', stock)).toBe(0);
    s = E.dawn(PROJECTS, s, world(8), { ferryDay: true, stock }).state;
    expect(E.stockLeft(s, 'pipe_fitting', stock)).toBe(2);
  });
});

describe('hands (§6.3 step 4)', () => {
  it("the player's shift: 10 Stamina for 1 VH (Tinkerer 1.5), capped at what's needed, not when tired or late", () => {
    const d = def('bakery_ovens');
    const s = funded('bakery_ovens', 4);
    const econ = { ...emptyEconomy(), day: 4 };
    const one = E.work(d, s, 'bakery_ovens', econ, { day: 4, minute: 600, tinkerer: false });
    expect(one.ok && [one.vh, one.minutes, one.economy.stamina]).toEqual([1, 60, 90]);
    const tink = E.work(d, s, 'bakery_ovens', econ, { day: 4, minute: 600, tinkerer: true });
    expect(tink.ok && tink.vh).toBe(1.5);
    let st = s;
    for (let i = 0; i < 3; i++) { const r = E.work(d, st, 'bakery_ovens', econ, { day: 4, minute: 600, tinkerer: true }); if (r.ok) st = r.state; }
    expect(st.projects.bakery_ovens!.vh).toBe(4);
    expect(E.work(d, st, 'bakery_ovens', econ, { day: 4, minute: 600, tinkerer: true })).toEqual({ ok: false, reason: 'hours_in' });
    expect(E.work(d, s, 'bakery_ovens', { ...econ, stamina: 9 }, { day: 4, minute: 600, tinkerer: false })).toEqual({ ok: false, reason: 'tired' });
    expect(E.work(d, s, 'bakery_ovens', econ, { day: 4, minute: 1510, tinkerer: false })).toEqual({ ok: false, reason: 'too_late' });
  });

  it('residents say yes on Regard and their values; leads always; Organizers ask 10 cheaper; four a day; once a day', () => {
    const d = def('streetlights');
    const s = funded('streetlights', 8);
    const ask = (resident: string, regard: number, organizer = false, state = s) =>
      E.askVolunteer(d, state, 'streetlights', { resident, regard, values: { prosperity: 0.4, safety: 0.2, spirit: 0.2, charm: 0.2 } }, { day: 8, organizer });
    expect(ask('augusta', -10).verdict).toBe('yes');
    expect(ask('ada', 19).verdict).toBe('no');
    expect(ask('ada', 20).verdict).toBe('yes');
    expect(ask('ada', 10, true).verdict).toBe('yes');
    // Keen: safety is what the streetlights raise.
    expect(E.askVolunteer(d, s, 'streetlights', { resident: 'ada', regard: 10, values: { prosperity: 0.1, safety: 0.6, spirit: 0.2, charm: 0.1 } }, { day: 8, organizer: false }).verdict).toBe('yes');
    expect(ask('rook', 90).verdict).toBe('never');
    const no = ask('ada', 0);
    expect(ask('ada', 50, false, no.state).verdict).toBe('asked_today');
    let st = s;
    for (const r of ['ada', 'june', 'teo', 'margo']) st = ask(r, 30, false, st).state;
    expect(st.volunteers.filter(v => v.day === 9)).toHaveLength(4);
    expect(ask('sable', 30, false, st).verdict).toBe('not_needed'); // 4 pledged × 2 = 8 VH: all the hours
    expect(ask('june', 30, false, st).verdict).toBe('not_needed');
  });

  it('credits 2 VH each at the next dawn, books standing volunteers daily until the hours are in', () => {
    const d = def('fountain');
    let s = E.projectCue(PROJECTS, emptyProjects(), town(), 'fountain', 's04_water_again', { day: 5 }).state;
    expect(s.standing).toEqual([{ project: 'fountain', resident: 'tib', from: 6 }]);
    s = E.askVolunteer(d, s, 'fountain', { resident: 'kasimir', regard: 0 }, { day: 5, organizer: false }).state;
    let r = E.dawn(PROJECTS, s, world(6, { minute: 360 }), { ferryDay: false, stock: {} });
    expect(r.credited).toEqual({});
    expect(r.state.volunteers.filter(v => v.day === 6).map(v => v.resident).sort()).toEqual(['kasimir', 'tib']);
    r = E.dawn(PROJECTS, r.state, world(7, { minute: 360 }), { ferryDay: false, stock: {} });
    expect(r.credited).toEqual({ fountain: 4 });
    expect(r.state.projects.fountain).toMatchObject({ vh: 4, volunteer_vh: 4 });
    // Tib again today: 4 + 2 pledged = all 6 hours.
    expect(E.pledgedVh(r.state, 'fountain')).toBe(6);
    r = E.dawn(PROJECTS, r.state, world(8, { minute: 360 }), { ferryDay: true, stock: {} });
    expect(r.state.projects.fountain!.vh).toBe(6);
    expect(r.state.standing).toEqual([]);
    expect(E.stageOf(d, r.state.projects.fountain, world(8))).toBe('gathering');
  });
});

describe('the opening (§6.3 step 6)', () => {
  it('is set 90 minutes on from 10:00 to 18:00, else the next morning; a ceremony with its own hour keeps it', () => {
    const d = def('fountain');
    expect(E.ceremonyTime(d, { day: 7, minute: 360 })).toEqual({ day: 7, minute: 600 });
    expect(E.ceremonyTime(d, { day: 7, minute: 700 })).toEqual({ day: 7, minute: 810 });
    expect(E.ceremonyTime(d, { day: 7, minute: 1000 })).toEqual({ day: 8, minute: 600 });
    expect(E.ceremonyTime(def('streetlights'), { day: 9, minute: 900 })).toEqual({ day: 9, minute: 1200 });
    expect(E.ceremonyTime(def('streetlights'), { day: 9, minute: 1185 })).toEqual({ day: 10, minute: 1200 });
    const p = { ceremony: { day: 7, minute: 600 }, opened: null } as E.Progress;
    expect(E.ceremonyOpen(p, { day: 7, minute: 599 })).toBe(false);
    expect(E.ceremonyOpen(p, { day: 7, minute: 600 })).toBe(true);
    expect(E.ceremonyOpen(p, { day: 7, minute: 600 + E.CEREMONY_WINDOW })).toBe(false);
  });

  it('a missed opening is set again at the next dawn', () => {
    const d = def('bakery_ovens');
    let s = funded('bakery_ovens', 4);
    s = { ...s, projects: { ...s.projects, bakery_ovens: { ...s.projects.bakery_ovens!, materials: { firebrick: 10 }, vh: 4 } } };
    const w = (day: number) => world(day, { minute: 360, puzzleSolved: () => true });
    const set = E.settle(PROJECTS, s, { ...w(5), minute: 700 });
    expect(set.scheduled).toEqual(['bakery_ovens']);
    expect(set.state.projects.bakery_ovens!.ceremony).toEqual({ day: 5, minute: 810 });
    const next = E.dawn(PROJECTS, set.state, w(6), { ferryDay: false, stock: {} });
    expect(next.state.projects.bakery_ovens!.ceremony).toEqual({ day: 6, minute: 600 });
    expect(E.stageOf(d, next.state.projects.bakery_ovens, w(6))).toBe('ready');
  });

  it('applies the Pillars (project source, uncapped), the town flags (upkeep, ElderAppeal) and the effects, once', () => {
    const d = def('streetlights');
    const s = funded('streetlights', 8);
    const t0 = town();
    const done = E.completeProject(d, s, 'streetlights', t0, { day: 9, place: 'old_quarter.town_hall', attendees: ['augusta', 'pell', 'augusta'] });
    expect(done.pillars).toEqual({ safety: 6, charm: 2 });
    expect(done.town.pillars.safety).toBe(t0.pillars.safety + 6);
    expect(done.town.log.filter(c => c.source === 'project').map(c => [c.pillar, c.applied, c.capped])).toEqual([['safety', 6, false], ['charm', 2, false]]);
    expect(done.town.flags.project_streetlights_done).toBe(true);
    expect(done.flags).toEqual(['project_streetlights_done']);
    expect(fundDay(9, 123, done.town.flags).upkeep).toEqual([{ id: 'streetlights', coins: 10 }]);
    const lit = { ...t0, flags: done.town.flags };
    expect(computeAppeal(lit).elder - computeAppeal(t0).elder).toBeCloseTo(3, 5);
    expect(E.nightTollmenReduction(PROJECTS, done.state)).toBe(1);
    expect(E.activeEffects(PROJECTS, done.state)).toEqual(['night_tollmen_minus_1']);
    expect(done.state.openings).toEqual([{ project: 'streetlights', day: 9, place: 'old_quarter.town_hall', attendees: ['augusta', 'pell'] }]);
    const again = E.completeProject(d, done.state, 'streetlights', done.town, { day: 9, place: 'x.y', attendees: [] });
    expect(again.town).toBe(done.town);
    expect(again.pillars).toEqual({});
  });

  it('a home joins the free homes and swaps its own art; one house at a time', () => {
    const d = def('homes');
    const w = world(10);
    let s = E.startHomes(d, emptyProjects(), 'old_quarter.vacant_house_39', w)!;
    expect(s).not.toBeNull();
    expect(E.startHomes(d, s, 'old_quarter.vacant_house_40', w)).toBeNull();
    expect(E.startHomes(d, emptyProjects(), 'old_quarter.vacant_house_39', world(9))).toBeNull();
    const id = E.homesId('old_quarter.vacant_house_39');
    const signed = E.signOff(d, s, id, town(), { day: 10 });
    if (!signed.ok) throw new Error('unsigned');
    s = signed.state;
    const done = E.completeProject(d, s, id, signed.town, { day: 12, place: 'old_quarter.vacant_house_39', attendees: [] });
    expect(done.town.homes).toMatchObject({ vacant_restorable: 60, restored_free: 1 });
    expect(done.flags).toEqual(['project_vacant_house_39_done']);
    expect(done.town.flags).toMatchObject({ project_vacant_house_39_done: true });
    expect(E.activeHomes(done.state)).toBeNull();
    expect(E.startHomes(d, done.state, 'old_quarter.vacant_house_39', { ...w, flags: new Set(['project_vacant_house_39_done']) })).toBeNull();
    expect(E.startHomes(d, done.state, 'old_quarter.vacant_house_40', w)).not.toBeNull();
  });
});

describe('who comes to the site', () => {
  it("books the day's volunteers at their shift, the leads alongside, and everyone at an opening", () => {
    const d = def('fountain');
    let s = funded('fountain', 5);
    s = E.askVolunteer(d, s, 'fountain', { resident: 'tib', regard: 30 }, { day: 5, organizer: false }).state;
    expect(E.siteShifts(PROJECTS, s, 5)).toEqual([]);
    expect(E.siteShifts(PROJECTS, s, 6)).toEqual([
      { resident: 'tib', project: 'fountain', action: 'volunteer', startMin: 600, endMin: 780 },
      { resident: 'kasimir', project: 'fountain', action: 'work', startMin: 600, endMin: 780 },
      { resident: 'bertrand', project: 'fountain', action: 'work', startMin: 600, endMin: 780 }
    ]);
    s = { ...s, projects: { ...s.projects, fountain: { ...s.projects.fountain!, ceremony: { day: 6, minute: 900 } } } };
    const attend = E.siteShifts(PROJECTS, s, 6).filter(x => x.action === 'attend');
    expect(attend.map(x => x.resident)).toEqual(['kasimir', 'bertrand', 'pell', 'tib']);
    expect(attend[0]).toMatchObject({ startMin: 885, endMin: 990 });
    // Once it's open the crowd keeps the same blocks for the day (plans don't change under anyone's feet).
    const opened = E.completeProject(def('fountain'), s, 'fountain', town(), { day: 6, place: 'old_quarter.fountain_square', attendees: [] }).state;
    expect(E.siteShifts(PROJECTS, opened, 6).filter(x => x.action === 'attend')).toEqual(attend);
    expect(E.siteShifts(PROJECTS, opened, 7)).toEqual([]);
  });
});

describe('the next step', () => {
  it('says something useful at every stage', () => {
    const ctx: E.StepContext = { fund: 1800, carried: () => 0, count: (i, n) => `${n} ${i}`, placeName: p => p, residentName: r => r };
    const d = def('fountain');
    expect(E.nextStep(d, undefined, world(3), ctx)).toContain('Day 5');
    expect(E.nextStep(def('community_garden'), undefined, world(9), ctx)).toContain('ducks');
    const open = E.projectCue(PROJECTS, emptyProjects(), town(10), 'fountain', 's04_water_again', { day: 5 }).state;
    expect(E.nextStep(d, open.projects.fountain, world(5), { ...ctx, fund: 10 })).toContain('190 short');
    const s = funded('fountain', 5);
    expect(E.nextStep(d, s.projects.fountain, world(5), ctx)).toContain("Dunmore's");
    expect(E.nextStep(d, s.projects.fountain, world(5), { ...ctx, carried: () => 2 })).toContain('Hand over 2 pipe_fitting');
  });
});
