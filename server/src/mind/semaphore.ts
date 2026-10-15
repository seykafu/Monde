/**
 * In-process concurrency caps for model calls (GDD §9.8 "Concurrency": each world has its own queue with a cap of
 * 8 in-flight model calls). §9.8 puts the queue in Redis; one Fly machine serves a world's night pass, so for now an
 * in-process semaphore keyed by world does the job.
 *
 * Waiters are served by priority (lower first), then first come first served, so a Core resident's plan call
 * isn't stuck behind every Acquainted reflection queued before it.
 */

export class AbortedError extends Error {
  constructor(message = "aborted while waiting for a model slot") {
    super(message);
    this.name = "AbortedError";
  }
}

interface Waiter { priority: number; seq: number; grant: () => void }

export class PrioritySemaphore {
  private active = 0;
  private seq = 0;
  private readonly waiters: Waiter[] = [];

  constructor(readonly capacity: number) {
    if (!(capacity >= 1)) throw new Error("capacity must be at least 1");
  }

  get inFlight(): number { return this.active; }
  get waiting(): number { return this.waiters.length; }
  get idle(): boolean { return this.active === 0 && this.waiters.length === 0; }

  /** Resolves with a release function once a slot is free. Rejects with AbortedError if `signal` aborts first. */
  acquire(priority = 0, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new AbortedError());
    return new Promise((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.active--;
        this.next();
      };
      const waiter: Waiter = {
        priority,
        seq: this.seq++,
        grant: () => {
          signal?.removeEventListener("abort", onAbort);
          this.active++;
          resolve(release);
        },
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new AbortedError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
      this.waiters.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      this.next();
    });
  }

  /** Run `task` in a slot. */
  async run<T>(task: () => Promise<T>, priority = 0, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(priority, signal);
    try {
      return await task();
    } finally {
      release();
    }
  }

  private next(): void {
    while (this.active < this.capacity && this.waiters.length > 0) this.waiters.shift()!.grant();
  }
}

/** One semaphore per world, created on demand and dropped when idle. */
export class WorldSemaphores {
  private readonly byWorld = new Map<string, PrioritySemaphore>();

  constructor(readonly capacity: number) {}

  get(worldId: string): PrioritySemaphore {
    let semaphore = this.byWorld.get(worldId);
    if (!semaphore) {
      semaphore = new PrioritySemaphore(this.capacity);
      this.byWorld.set(worldId, semaphore);
    }
    return semaphore;
  }

  async run<T>(worldId: string, task: () => Promise<T>, priority = 0, signal?: AbortSignal): Promise<T> {
    const semaphore = this.get(worldId);
    try {
      return await semaphore.run(task, priority, signal);
    } finally {
      if (semaphore.idle && this.byWorld.get(worldId) === semaphore) this.byWorld.delete(worldId);
    }
  }
}
