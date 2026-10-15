import type { StorageLike } from '../mind/api';
/** Quiet Mode's existing prefs functions use this session adapter; save slots persist its contents. */
const values = new Map<string, string>();
export const quietStorage: StorageLike = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); },
  removeItem: key => { values.delete(key); }
};
