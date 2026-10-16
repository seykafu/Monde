// content/projects.yaml against GDD §6.3's table, and its sites against the boards (MVP G-03).
import { describe, expect, it } from 'vitest';
import { RoutineExecutor } from '../../sim/routineExecutor';
import { loadWorld } from '../../sim/__tests__/content';
import { PROJECTS } from '../catalog';
import { parseProjects } from '../schema';
import { siteOf } from '../site';

const world = loadWorld();
const def = (id: string) => PROJECTS.find(p => p.id === id)!;

describe('content/projects.yaml', () => {
  it("holds the MVP's Spring Projects (MVP_PLAN: fountain, bakery_ovens, streetlights, community_garden, market_hall, homes, lighthouse; the clocktower)", () => {
    expect(PROJECTS.map(p => p.id)).toEqual(['fountain', 'bakery_ovens', 'streetlights', 'community_garden', 'market_hall', 'homes', 'lighthouse', 'clocktower']);
    expect(PROJECTS.filter(p => p.stretch).map(p => p.id)).toEqual(['lighthouse']);
    expect(PROJECTS.filter(p => p.repeatable).map(p => p.id)).toEqual(['homes']);
  });

  it("transcribes §6.3's table: opening, Fund, materials, VH, puzzle, lead and completion", () => {
    const row = (id: string) => {
      const p = def(id);
      return [p.zone, p.opens.day ?? null, p.fund, p.materials.map(m => `${m.item}×${m.count}`).join(' '), p.vh, p.puzzle ?? null, p.leads.join(','), p.complete.pillars];
    };
    expect(row('fountain')).toEqual(['old_quarter', 5, 200, 'pipe_fitting×4', 6, 'PZ-01', 'kasimir,bertrand', { charm: 6, spirit: 2 }]);
    expect(row('bakery_ovens')).toEqual(['market_row', 4, 150, 'firebrick×10', 4, 'PZ-02', 'odile', { prosperity: 3 }]);
    expect(row('streetlights')).toEqual(['old_quarter', 8, 400, 'lamp_glass×12', 8, 'PZ-13', 'augusta', { safety: 6, charm: 2 }]);
    expect(row('community_garden')).toEqual(['commons', 8, 100, 'seeds×10', 10, null, 'teo', { spirit: 3, charm: 2 }]);
    expect(row('market_hall')).toEqual(['market_row', 12, 600, 'timber×20 paint×6', 16, 'PZ-04', 'odile,nell', { prosperity: 6, spirit: 3 }]);
    expect(row('homes')).toEqual(['various', 10, 150, 'timber×4 glass×2', 6, null, 'kasimir', {}]);
    expect(row('lighthouse')).toEqual(['wharf', 16, 800, 'lens_oil×4 brass×6', 12, 'PZ-05', 'nell,moss', { safety: 4, charm: 4 }]);
    expect(row('clocktower')).toEqual(['old_quarter', null, 0, '', 0, 'PZ-15', 'bertrand', {}]);
    expect(def('fountain').opens).toEqual({ day: 5, cue: 's04_water_again' });
    expect(def('community_garden').opens).toEqual({ day: 8, flag: 'pz06_solved' });
    expect(def('clocktower').opens).toEqual({ flag: 'pinion_found' });
    expect(def('market_hall').bonusPuzzle).toBe('PZ-17');
    expect(def('homes').complete.homes).toBe(1);
    expect(def('streetlights').complete.effects).toEqual(['night_tollmen_minus_1']);
    expect(def('bakery_ovens').complete.effects).toEqual(['bakery_stays_open']);
    expect(def('market_hall').complete.effects).toEqual(['weekly_market']);
    for (const p of PROJECTS) if (!p.repeatable) expect(p.complete.flags).toContain(`project_${p.id}_done`);
  });

  it('puts every site on a built board, with room for volunteers to stand and work', () => {
    const ex = new RoutineExecutor(world);
    for (const p of PROJECTS.filter(d => !d.repeatable)) {
      const site = siteOf(p, undefined, world.zones)!;
      expect(site, p.id).not.toBeNull();
      expect(world.zones[site.zone]!.places.some(pl => `${site.zone}.${pl.id}` === site.place), p.id).toBe(true);
      const info = ex.resolveArea(site.work.place, site.work.area as [number, number, number, number]);
      expect(info.kind, p.id).toBe('open');
      expect(info.spots.length, p.id).toBeGreaterThanOrEqual(5);
    }
    // Every vacant house on a built board can be a homes site, its pavement room for Kasimir.
    const homes = def('homes');
    const houses = Object.values(world.zones).flatMap(z => z.places.filter(pl => /^vacant_house_\d+$/.test(pl.id)).map(pl => `${z.id}.${pl.id}`));
    expect(houses.length).toBeGreaterThan(15);
    for (const house of houses) {
      const site = siteOf(homes, { target: house }, world.zones)!;
      expect(site.place).toBe(house);
      expect(ex.resolveArea(site.work.place, site.work.area as [number, number, number, number]).spots.length, house).toBeGreaterThanOrEqual(2);
    }
  });

  it('refuses a malformed file, naming the Project and field', () => {
    expect(() => parseProjects({ projects: [{ id: 'x' }] })).toThrow(/projects\.yaml x: opens must be a mapping/);
    const bad = { shift: ['10:00', '13:00'], pell: { short: 'a', signed: 'b', wait: 'c' }, asks: {}, projects: [] };
    expect(() => parseProjects(bad)).toThrow(/asks\.yes must be a mapping/);
  });
});
