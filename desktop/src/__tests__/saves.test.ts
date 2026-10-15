import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { SaveStore, isValidSlot, slotFileName, slotFromFileName } from '../saves';

const save = (day: number) => ({ schema_version: 2, label: `Day ${day}`, clock: { day } });

describe('slot ids', () => {
  it.each(['manual:1', 'dawn:3', 'checkpoint:campaign_season'])('accepts %s', slot => {
    expect(isValidSlot(slot)).toBe(true);
    expect(slotFromFileName(slotFileName(slot))).toBe(slot);
  });

  it('maps slots to Windows-safe names', () => {
    expect(slotFileName('manual:1')).toBe('manual-1.json');
    expect(slotFileName('checkpoint:campaign_season')).toBe('checkpoint-campaign_season.json');
  });

  it.each([
    '../x', 'manual:../../etc', 'manual:1/..', 'manual:', ':1', 'manual', 'Manual:1', 'manual:1\0', 'manual:a.b',
    'manual:1:2', 'manual:-1', 'C:\\x', '/etc/passwd', `manual:${'a'.repeat(65)}`, 42, null, undefined
  ])('refuses %j', slot => {
    expect(isValidSlot(slot)).toBe(false);
  });

  it('ignores files that are not slots', () => {
    for (const name of ['manual-1.json.bak', 'manual-1.json.123-abcd.tmp', 'notes.txt', '.DS_Store', 'Manual-1.json']) {
      expect(slotFromFileName(name)).toBeNull();
    }
  });
});

describe('SaveStore', () => {
  let dir: string;
  let store: SaveStore;
  beforeEach(async () => {
    dir = path.join(await mkdtemp(path.join(tmpdir(), 'monde-saves-')), 'saves');
    store = new SaveStore(dir);
  });
  afterEach(async () => { await rm(path.dirname(dir), { recursive: true, force: true }); });

  it('starts empty, even before the folder exists', async () => {
    expect(await store.list()).toEqual([]);
    expect(await store.read('manual:1')).toBeNull();
  });

  it('writes, reads, lists and deletes', async () => {
    await store.write('manual:1', save(1));
    await store.write('dawn:2', save(2));
    expect(await store.read('manual:1')).toEqual(save(1));
    expect(await store.list()).toEqual([{ slot: 'dawn:2', save: save(2) }, { slot: 'manual:1', save: save(1) }]);
    expect(JSON.parse(await readFile(path.join(dir, 'manual-1.json'), 'utf8'))).toEqual(save(1));
    await store.delete('manual:1');
    expect(await store.read('manual:1')).toBeNull();
    expect((await store.list()).map(e => e.slot)).toEqual(['dawn:2']);
  });

  it('keeps the previous save as one .bak and leaves no temp files', async () => {
    await store.write('manual:1', save(1));
    await store.write('manual:1', save(2));
    await store.write('manual:1', save(3));
    expect(JSON.parse(await readFile(path.join(dir, 'manual-1.json.bak'), 'utf8'))).toEqual(save(2));
    expect((await readdir(dir)).sort()).toEqual(['manual-1.json', 'manual-1.json.bak']);
  });

  it('reads a damaged slot from its backup, and never backs up the damage', async () => {
    await store.write('manual:1', save(1));
    await store.write('manual:1', save(2));
    await writeFile(path.join(dir, 'manual-1.json'), '{"schema_version": 2, "lab');
    expect(await store.read('manual:1')).toEqual(save(1));
    expect(await store.list()).toEqual([{ slot: 'manual:1', save: save(1) }]);
    await store.write('manual:1', save(3));
    expect(JSON.parse(await readFile(path.join(dir, 'manual-1.json.bak'), 'utf8'))).toEqual(save(1));
  });

  it('skips a slot with neither a good file nor a backup', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'manual-2.json'), 'not json');
    await writeFile(path.join(dir, 'manual-3.json'), '[1, 2]');
    expect(await store.list()).toEqual([]);
    expect(await store.read('manual:2')).toBeNull();
  });

  it('deletes the backup with the slot', async () => {
    await store.write('manual:1', save(1));
    await store.write('manual:1', save(2));
    await store.delete('manual:1');
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses bad slots, non-objects and oversized saves', async () => {
    await expect(store.write('../evil', save(1))).rejects.toThrow('Invalid save slot');
    await expect(store.read('manual:../../x')).rejects.toThrow('Invalid save slot');
    await expect(store.delete('/etc/passwd')).rejects.toThrow('Invalid save slot');
    await expect(store.write('manual:1', [1, 2])).rejects.toThrow('must be an object');
    await expect(store.write('manual:1', 'text')).rejects.toThrow('must be an object');
    const small = new SaveStore(dir, { maxBytes: 64 });
    await expect(small.write('manual:1', { blob: 'x'.repeat(100) })).rejects.toThrow('too large');
  });

  it('treats an oversized file on disk as damaged', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'manual-1.json'), JSON.stringify({ blob: 'x'.repeat(100) }));
    expect(await new SaveStore(dir, { maxBytes: 64 }).read('manual:1')).toBeNull();
  });

  it('serializes concurrent writes to a slot', async () => {
    await Promise.all([1, 2, 3, 4, 5].map(day => store.write('manual:1', save(day))));
    expect(await store.read('manual:1')).toEqual(save(5));
    expect(await store.read('manual:1')).not.toBeNull();
    expect((await readdir(dir)).sort()).toEqual(['manual-1.json', 'manual-1.json.bak']);
  });

  it('cleans up temp files left by a crash', async () => {
    await store.write('manual:1', save(1));
    await writeFile(path.join(dir, 'manual-1.json.999-deadbeef.tmp'), '{"half');
    await store.cleanup();
    expect(await readdir(dir)).toEqual(['manual-1.json']);
  });
});
