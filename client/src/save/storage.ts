import { migrateSave, type SaveGame } from '@monde/shared';
import type { SaveEntry } from './slots';
export interface SaveStorage {
  list(): Promise<SaveEntry[]>;
  read(slot: string): Promise<SaveGame | null>;
  write(slot: string, save: SaveGame): Promise<void>;
  delete(slot: string): Promise<void>;
}
/** Electron preload must expose only these scoped save operations, never filesystem access. */
export interface DesktopSaveBridge {
  list(): Promise<{ slot: string; save: unknown }[]>;
  read(slot: string): Promise<unknown | null>;
  write(slot: string, save: SaveGame): Promise<void>;
  delete(slot: string): Promise<void>;
}
declare global { interface Window { mondeDesktop?: { saves?: DesktopSaveBridge } } }
function validEntries(entries: { slot: string; save: unknown }[]): SaveEntry[] {
  return entries.flatMap(e => { try { return [{ slot: e.slot, save: migrateSave(e.save) }]; } catch { return []; } });
}
export class MemorySaveStorage implements SaveStorage {
  private readonly saves = new Map<string, SaveGame>();
  async list(): Promise<SaveEntry[]> { return [...this.saves].map(([slot, save]) => ({ slot, save: migrateSave(save) })); }
  async read(slot: string): Promise<SaveGame | null> { const save = this.saves.get(slot); return save ? migrateSave(save) : null; }
  async write(slot: string, save: SaveGame): Promise<void> { this.saves.set(slot, migrateSave(save)); }
  async delete(slot: string): Promise<void> { this.saves.delete(slot); }
}
export class DesktopSaveStorage implements SaveStorage {
  constructor(private readonly bridge: DesktopSaveBridge) {}
  async list(): Promise<SaveEntry[]> { return validEntries(await this.bridge.list()); }
  async read(slot: string): Promise<SaveGame | null> { const raw = await this.bridge.read(slot); return raw === null ? null : migrateSave(raw); }
  async write(slot: string, save: SaveGame): Promise<void> { await this.bridge.write(slot, migrateSave(save)); }
  async delete(slot: string): Promise<void> { await this.bridge.delete(slot); }
}
/** Every IndexedDB operation is guarded. Once unavailable, keep a coherent in-memory session. */
export class IndexedDBSaveStorage implements SaveStorage {
  private db?: Promise<IDBDatabase>;
  private failed = false;
  readonly fallback = new MemorySaveStorage();
  get temporary(): boolean { return this.failed; }
  constructor(private readonly factory: () => IDBFactory = () => globalThis.indexedDB) {}
  private open(): Promise<IDBDatabase> {
    return this.db ??= new Promise((resolve, reject) => {
      const req = this.factory().open('monde-saves', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('saves'); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Save database blocked'));
      req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    });
  }
  private async access<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('saves', mode);
      const req = action(tx.objectStore('saves'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Save transaction aborted'));
    });
  }
  async list(): Promise<SaveEntry[]> {
    if (!this.failed) try {
      const entries = validEntries(await this.access('readonly', s => s.getAll()) as SaveEntry[]);
      for (const e of entries) await this.fallback.write(e.slot, e.save);
      return entries;
    } catch { this.failed = true; }
    return this.fallback.list();
  }
  async read(slot: string): Promise<SaveGame | null> {
    if (!this.failed) {
      let raw: SaveEntry | undefined;
      try { raw = await this.access('readonly', s => s.get(slot)) as SaveEntry | undefined; }
      catch { this.failed = true; return this.fallback.read(slot); }
      if (!raw) return null;
      const save = migrateSave(raw.save);
      await this.fallback.write(slot, save);
      return save;
    }
    return this.fallback.read(slot);
  }
  async write(slot: string, save: SaveGame): Promise<void> {
    const value = migrateSave(save);
    if (!this.failed) try { await this.access('readwrite', s => s.put({ slot, save: value }, slot)); }
    catch { this.failed = true; }
    await this.fallback.write(slot, value);
  }
  async delete(slot: string): Promise<void> {
    if (!this.failed) try { await this.access('readwrite', s => s.delete(slot)); }
    catch { this.failed = true; }
    await this.fallback.delete(slot);
  }
}
export function createSaveStorage(): SaveStorage {
  try { if (window.mondeDesktop?.saves) return new DesktopSaveStorage(window.mondeDesktop.saves); } catch { /* unavailable bridge */ }
  return new IndexedDBSaveStorage();
}
