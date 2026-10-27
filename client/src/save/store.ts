// The save slots and their write queue: what the title needs to list saves, without the game the saves restore
// (save/runtime.ts, which loads behind the title: boot/gameCode.ts).
import { createSaveStorage } from './storage';

export const saveStorage = createSaveStorage();
let queue: Promise<unknown> = Promise.resolve();
/** Writes go one at a time, so simultaneous requests cannot lose a slot; a failed one doesn't stop the next. */
export function queueSave<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(work);
  queue = result.catch(() => undefined);
  return result;
}
export async function finishSaving(): Promise<void> { await queue; }
