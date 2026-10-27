import { describe, expect, it } from 'vitest';
import { boardLinks, boardSpriteFiles, prefetchOrder } from '../boardAssets';
import { boards, doorLinks, interiors, zones } from '../zones';
import { TOWN_MANIFEST, spriteFile } from '../townSprites';
import { DRESSING } from '../../finale/fair';

const allFiles = Object.entries(TOWN_MANIFEST).flatMap(([id, art]) => art.states.map(state => spriteFile(id, state)));

describe('a board’s sprite files', () => {
  it('lists every building and prop it draws, in every state, and nothing painted in code', () => {
    for (const zone of Object.values(boards)) {
      const files = new Set(boardSpriteFiles(zone));
      for (const b of zone.town?.buildings ?? []) for (const state of TOWN_MANIFEST[b.sprite]!.states) expect(files.has(spriteFile(b.sprite, state)), `${zone.id}: ${b.sprite}`).toBe(true);
      for (const p of zone.town?.props ?? []) {
        if (['hedge', 'stone_wall', 'fence'].includes(p.sprite)) continue;
        for (const state of TOWN_MANIFEST[p.sprite]!.states) expect(files.has(spriteFile(p.sprite, state)), `${zone.id}: ${p.sprite}`).toBe(true);
      }
      for (const file of files) expect(allFiles, file).toContain(file);
      expect(files.has('hedge') || files.has('stone_wall') || files.has('fence')).toBe(false);
    }
  });

  it('adds the datestone where a building carries one, and the fair’s dressing on the Commons', () => {
    for (const zone of Object.values(boards)) {
      const dated = zone.town?.buildings.some(b => b.datestone !== undefined) ?? false;
      expect(boardSpriteFiles(zone).includes('datestone'), zone.id).toBe(dated);
    }
    const commons = new Set(boardSpriteFiles(zones.commons!));
    for (const d of DRESSING) expect(commons.has(d.sprite), d.sprite).toBe(true);
  });

  it('is a fraction of the town’s files for each district', () => {
    for (const id of Object.keys(zones)) expect(boardSpriteFiles(zones[id]!).length, id).toBeLessThan(allFiles.length * 0.6);
  });

  it('is empty for a board without town art', () => {
    expect(boardSpriteFiles({ ...zones.old_quarter!, town: undefined })).toEqual([]);
  });
});

describe('prefetch order', () => {
  const links = boardLinks(boards, doorLinks);

  it('joins districts across their edges and rooms to their doors, both ways', () => {
    for (const zone of Object.values(zones)) for (const edge of zone.edges) {
      expect(links.get(zone.id)).toContain(edge.zone);
      expect(links.get(edge.zone)).toContain(zone.id);
    }
    for (const door of doorLinks) {
      expect(links.get(door.district)).toContain(door.interior);
      expect(links.get(door.interior)).toContain(door.district);
    }
  });

  it('starts with the neighbours, districts first, and reaches every other board once', () => {
    const order = prefetchOrder('old_quarter', boards, links);
    expect(order).not.toContain('old_quarter');
    expect(new Set(order).size).toBe(Object.keys(boards).length - 1);
    const near = links.get('old_quarter')!;
    expect(order.slice(0, near.length).sort()).toEqual([...near].sort());
    const firstRoom = order.findIndex(id => interiors[id]);
    expect(order.slice(0, firstRoom).every(id => near.includes(id) && zones[id])).toBe(true);
  });

  it('goes from a room to its district first', () => {
    const door = doorLinks[0]!;
    expect(prefetchOrder(door.interior, boards, links)[0]).toBe(door.district);
  });

  it('puts boards nothing reaches last', () => {
    const lone = { ...zones.wharf!, id: 'island', edges: [] };
    const order = prefetchOrder('old_quarter', { ...boards, island: lone }, boardLinks({ ...boards, island: lone }, doorLinks));
    expect(order.at(-1)).toBe('island');
  });
});
