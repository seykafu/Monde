import { describe, expect, it } from 'vitest';
import { scatter, type ScatterMap, type ScatterRule } from '../scatter';
import { SPRITE_META, TOWN_MANIFEST, propBlock, resolveState, type TownLook } from '../townSprites';
import type { TownTerrain } from '../townTerrain';

// ── Scatter ─────────────────────────────────────────────────────────────────

/** A 20 × 12 field of grass with a cobbled lane on row 6 and a pond in one corner. */
const field = (free: (x: number, y: number) => boolean = () => true): ScatterMap => ({
  width: 20, height: 12, doors: [[10, 6]],
  terrain: (x, y): TownTerrain => (y === 6 ? 'cobble' : x >= 16 && y >= 9 ? 'pond' : 'grass'),
  free
});
const rule: ScatterRule = { sprites: ['tall_grass', 'rock', 'bush_round'], on: ['grass'], density: 0.3, seed: 5 };

describe('scatter', () => {
  it('is deterministic: the same rule on the same map lays the same items', () => {
    expect(scatter(rule, field())).toEqual(scatter(rule, field()));
    expect(scatter(rule, field()).length).toBeGreaterThan(20);
  });

  it('changes with the seed and with the rule index, and keeps to its density', () => {
    const a = scatter(rule, field()), b = scatter({ ...rule, seed: 6 }, field()), c = scatter(rule, field(), 1);
    expect(b).not.toEqual(a);
    expect(c).not.toEqual(a);
    const grass = 20 * 12 - 20 - 12;
    for (const items of [a, b, c]) {
      expect(items.length / grass).toBeGreaterThan(0.18);
      expect(items.length / grass).toBeLessThan(0.42);
    }
    expect(scatter({ ...rule, density: 0 }, field())).toEqual([]);
    expect(scatter({ ...rule, density: 1 }, field())).toHaveLength(grass);
  });

  it('keeps to its ground, off taken tiles, out of keepouts and (with near) by its kinds', () => {
    const items = scatter({ ...rule, density: 1, keepout: { kinds: ['cobble'], radius: 1, doors: 3 } }, field((x, y) => !(x === 2 && y === 2)));
    for (const { at: [x, y] } of items) {
      expect(field().terrain(x, y)).toBe('grass');
      expect(Math.abs(y - 6)).toBeGreaterThan(1);
      expect(x === 2 && y === 2).toBe(false);
    }
    const reeds = scatter({ ...rule, sprites: ['reeds'], density: 1, near: { kinds: ['pond'], radius: 1 } }, field());
    expect(reeds.length).toBeGreaterThan(0);
    for (const { at: [x, y] } of reeds) expect(x >= 15 && y >= 8).toBe(true);
  });

  it('jitters items inside their tile and picks only listed sprites', () => {
    for (const item of scatter({ ...rule, density: 1 }, field())) {
      expect(Math.abs(item.dx)).toBeLessThanOrEqual(12);
      expect(Math.abs(item.dy)).toBeLessThanOrEqual(8);
      expect(rule.sprites).toContain(item.sprite);
    }
  });
});

// ── Sprites and the town's state ────────────────────────────────────────────

const look = (...flags: string[]): TownLook => ({ flag: f => flags.includes(f) });

describe('town sprites', () => {
  it('only describes sprites that exist, with doors inside their footprints and chimneys on their art', () => {
    for (const [id, meta] of Object.entries(SPRITE_META)) {
      const art = TOWN_MANIFEST[id];
      expect(art, id).toBeDefined();
      if (meta.door !== undefined) expect(meta.door, id).toBeLessThan(art!.foot![0]);
      for (const [x, y] of meta.chimneys ?? []) { expect(x, id).toBeLessThan(art!.w); expect(y, id).toBeLessThan(art!.h / 2); }
    }
    for (const [id, art] of Object.entries(TOWN_MANIFEST)) if (art.kind === 'building') expect(SPRITE_META[id]?.door, `${id} door column`).toBeDefined();
  });

  it('shows Day-1 faded art on vacant homes, empty shops and unfinished Projects, restored art elsewhere', () => {
    expect(resolveState({ id: 'vacant_house_39', sprite: 'townhouse_a', state: 'auto' }, look())).toBe('faded');
    expect(resolveState({ id: 'storefront_3', sprite: 'storefront_c', state: 'auto' }, look())).toBe('faded');
    expect(resolveState({ sprite: 'fountain', state: 'auto' }, look())).toBe('faded');
    expect(resolveState({ id: 'market_hall', sprite: 'market_hall', state: 'auto' }, look())).toBe('faded');
    expect(resolveState({ id: 'home_bunkhouse', sprite: 'bunkhouse', state: 'auto' }, look())).toBe('restored');
    expect(resolveState({ id: 'fish_market', sprite: 'fish_market', state: 'auto' }, look())).toBe('restored');
    expect(resolveState({ id: 'bakery', sprite: 'bakery', state: 'auto' }, look())).toBe('restored'); // no faded art
  });

  it('restores art when its Project is done, by the project flag, its own flags or the place\'s', () => {
    expect(resolveState({ sprite: 'fountain', state: 'auto' }, look('project_fountain_done'))).toBe('restored');
    expect(resolveState({ sprite: 'bandstand', state: 'auto' }, look('bandstand_rebuilt'))).toBe('restored');
    expect(resolveState({ sprite: 'crane', state: 'auto' }, look('cannery_coop'))).toBe('restored');
    expect(resolveState({ sprite: 'market_stall', state: 'auto' }, look('project_market_hall_done'))).toBe('restored');
    expect(resolveState({ id: 'vacant_house_40', sprite: 'townhouse_b', state: 'auto' }, look('project_vacant_house_40_done'))).toBe('restored');
    expect(resolveState({ id: 'vacant_house_41', sprite: 'townhouse_c', state: 'auto' }, look('project_vacant_house_40_done'))).toBe('faded');
    expect(resolveState({ sprite: 'veg_bed', state: 'auto', project: 'glasshouse' }, look('project_glasshouse_done'))).toBe('restored');
  });

  it('keeps fixed states, except faded on art that has none', () => {
    expect(resolveState({ sprite: 'fountain', state: 'restored' }, look())).toBe('restored');
    expect(resolveState({ id: 'bakery', sprite: 'townhouse_a', state: 'faded' }, look('project_bakery_done'))).toBe('faded');
    expect(resolveState({ sprite: 'oak', state: 'faded' }, look())).toBe('restored');
  });

  it('restores a vacant home a household has moved into, and keeps a plain vacant home faded', () => {
    const homes = ['old_quarter.vacant_house_46'];
    expect(resolveState({ id: 'vacant_house_46', sprite: 'townhouse_d', state: 'auto', homes }, look())).toBe('faded');
    expect(resolveState({ id: 'vacant_house_46', sprite: 'townhouse_d', state: 'auto', homes }, look('home_occupied:old_quarter.vacant_house_46'))).toBe('restored');
    expect(resolveState({ sprite: 'townhouse_a', state: 'auto', homes: ['wharf.vacant'] }, look())).toBe('faded');
    expect(resolveState({ sprite: 'townhouse_a', state: 'auto', homes: ['wharf.home_02'] }, look())).toBe('restored');
  });

  it('blocks a prop\'s trunk or base, centred on its tile and running back from it', () => {
    expect(propBlock('lamp_post', [5, 5])).toEqual([[5, 5]]);
    expect(propBlock('fountain', [10, 8])).toEqual([[9, 8], [10, 8], [11, 8], [9, 7], [10, 7], [11, 7]]);
    expect(propBlock('market_stall', [3, 3])).toEqual([[3, 3], [4, 3]]);
    expect(propBlock('tall_grass', [1, 1])).toEqual([]);
    expect(propBlock('tall_grass', [1, 1], true)).toEqual([[1, 1]]);
    expect(propBlock('bench', [1, 1], false)).toEqual([]);
  });
});
