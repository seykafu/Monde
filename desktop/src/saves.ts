// Save files for the desktop build: <userData>/saves/<kind>-<key>.json, one per slot (MVP: manual:1–3,
// dawn:1–3, checkpoint:<key>; client/src/save/slots.ts). The main process is a careful, dumb store: the client
// migrates and validates every save it reads (DesktopSaveStorage → migrateSave), so this only checks that a
// save is a JSON object of a sane size. No Electron imports (tested under vitest).
//
// Durability: a write goes to a temp file (flushed), the previous good save is kept as <file>.bak, then the
// temp file is renamed over the slot. A crash at any point leaves either the old or the new save in place;
// a slot whose file is damaged reads from its .bak instead.
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SaveFileEntry } from './ipc';

/**
 * GDD-GAP: the GDD sets no size for a save. A Day-100 save (town log, history, offline events, friendship)
 * is well under 1 MiB; 16 MiB rejects runaway data without ever touching a real one.
 */
export const MAX_SAVE_BYTES = 16 * 1024 * 1024;

const SLOT = /^([a-z][a-z0-9_]{0,31}):([a-z0-9][a-z0-9_]{0,63})$/;
const FILE = /^([a-z][a-z0-9_]{0,31})-([a-z0-9][a-z0-9_]{0,63})\.json$/;

/** "kind:key", lowercase letters, digits and underscores; nothing that could name another path. */
export function isValidSlot(slot: unknown): slot is string {
  return typeof slot === 'string' && SLOT.test(slot);
}

/** manual:1 → manual-1.json (":" is not allowed in Windows file names; "-" never appears in a slot). */
export function slotFileName(slot: string): string {
  const m = SLOT.exec(slot);
  if (!m) throw new Error('Invalid save slot');
  return `${m[1]}-${m[2]}.json`;
}

export function slotFromFileName(name: string): string | null {
  const m = FILE.exec(name);
  return m ? `${m[1]}:${m[2]}` : null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type Read = { ok: true; value: Record<string, unknown>; text: string } | { ok: false; missing: boolean };

export interface SaveStoreOptions {
  maxBytes?: number;
  /** For tests: Windows retries renames that antivirus or cloud sync briefly block. */
  platform?: NodeJS.Platform;
}

export class SaveStore {
  private readonly maxBytes: number;
  private readonly platform: NodeJS.Platform;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string, options: SaveStoreOptions = {}) {
    this.maxBytes = options.maxBytes ?? MAX_SAVE_BYTES;
    this.platform = options.platform ?? process.platform;
  }

  /** Every readable slot, in slot order. Damaged files fall back to their .bak; unreadable ones are skipped. */
  async list(): Promise<SaveFileEntry[]> {
    let names: string[];
    try { names = await fs.readdir(this.dir); } catch (error) {
      if (code(error) === 'ENOENT') return [];
      throw error;
    }
    const slots = names.map(slotFromFileName).filter((s): s is string => s !== null).sort();
    const entries: SaveFileEntry[] = [];
    for (const slot of slots) {
      const save = await this.read(slot);
      if (save !== null) entries.push({ slot, save });
    }
    return entries;
  }

  /** The slot's save; null if it has none (or neither it nor its backup can be read). */
  async read(slot: unknown): Promise<Record<string, unknown> | null> {
    const file = this.file(slot);
    const primary = await this.readFile(file);
    if (primary.ok) return primary.value;
    if (primary.missing) return null;
    const backup = await this.readFile(`${file}.bak`);
    if (backup.ok) return backup.value;
    return null;
  }

  async write(slot: unknown, save: unknown): Promise<void> {
    const file = this.file(slot);
    if (!isObject(save)) throw new Error('A save must be an object');
    let text: string;
    try { text = JSON.stringify(save); } catch { throw new Error('A save must be plain JSON'); }
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > this.maxBytes) throw new Error(`Save is too large (${bytes} bytes; the limit is ${this.maxBytes})`);
    return this.exclusive(async () => {
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const tmp = this.tempName(file);
      await writeFlushed(tmp, `${text}\n`);
      try {
        // Keep the previous save only if it is a good one: a damaged file must not replace a good backup.
        const previous = await this.readFile(file);
        if (previous.ok) {
          const bakTmp = this.tempName(`${file}.bak`);
          await writeFlushed(bakTmp, previous.text);
          await this.rename(bakTmp, `${file}.bak`);
        }
        await this.rename(tmp, file);
      } catch (error) {
        await fs.rm(tmp, { force: true });
        throw error;
      }
      await this.syncDir();
    });
  }

  /** Removes the slot and its backup (the game asks the player first: "This cannot be undone"). */
  async delete(slot: unknown): Promise<void> {
    const file = this.file(slot);
    return this.exclusive(async () => {
      await fs.rm(file, { force: true });
      await fs.rm(`${file}.bak`, { force: true });
      await this.syncDir();
    });
  }

  /** Removes temp files left by a crash mid-write. */
  async cleanup(): Promise<void> {
    let names: string[];
    try { names = await fs.readdir(this.dir); } catch { return; }
    await Promise.all(names.filter(n => n.endsWith('.tmp')).map(n => fs.rm(path.join(this.dir, n), { force: true })));
  }

  private file(slot: unknown): string {
    if (!isValidSlot(slot)) throw new Error('Invalid save slot');
    return path.join(this.dir, slotFileName(slot));
  }

  private tempName(file: string): string {
    return `${file}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
  }

  private async readFile(file: string): Promise<Read> {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > this.maxBytes) return { ok: false, missing: false };
      const text = await fs.readFile(file, 'utf8');
      const value: unknown = JSON.parse(text);
      return isObject(value) ? { ok: true, value, text } : { ok: false, missing: false };
    } catch (error) {
      return { ok: false, missing: code(error) === 'ENOENT' };
    }
  }

  /** rename() replaces the target atomically. On Windows it can fail briefly while another process has the file open. */
  private async rename(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(from, to); return; } catch (error) {
        const c = code(error);
        if (this.platform !== 'win32' || attempt >= 8 || (c !== 'EPERM' && c !== 'EACCES' && c !== 'EBUSY')) throw error;
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  }

  /** Makes the renames durable (POSIX; Windows can't open a directory for fsync). */
  private async syncDir(): Promise<void> {
    if (this.platform === 'win32') return;
    let handle: FileHandle | undefined;
    try { handle = await fs.open(this.dir, 'r'); await handle.sync(); } catch { /* best effort */ } finally { await handle?.close(); }
  }

  /** One write or delete at a time, so two writes to a slot can't interleave their temp and backup files. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

async function writeFlushed(file: string, text: string): Promise<void> {
  const handle = await fs.open(file, 'wx', 0o600);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

const code = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;
