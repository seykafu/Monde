import { TelemetryEvent, type EventData } from './schema';
export interface Store { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface Pending { event: TelemetryEvent; world?: string; attempts: number }
// GDD-GAP: operational defaults: 200 queued events, 25/batch, three attempts, 30-second flush.
export const QUEUE_LIMIT = 200;
export class TelemetryQueue {
  private pending: Pending[] = [];
  private running = false;
  private generation = 0;
  enabled = false;
  constructor(private send: (items: Pending[], signal: AbortSignal) => Promise<boolean>, private store: Store | null,
    private uuid: () => string, private now = () => new Date().toISOString()) {}
  private abort?: AbortController;
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) { this.generation++; this.abort?.abort(); this.pending = []; this.persist(); }
  }
  restore(): void {
    if (!this.enabled) return;
    try {
      const rows: unknown = JSON.parse(this.store?.getItem('monde.telemetry.queue') ?? '[]');
      if (Array.isArray(rows)) this.pending = rows.filter((r): r is Pending => {
        if (!r || typeof r !== 'object') return false;
        const p = r as Pending;
        return TelemetryEvent.safeParse(p.event).success && Number.isInteger(p.attempts) && p.attempts >= 0 && p.attempts < 3
          && (p.world === undefined || /^[0-9a-f-]{36}$/i.test(p.world));
      }).slice(-QUEUE_LIMIT);
    } catch { /* unavailable */ }
  }
  add(data: EventData, world?: string): void {
    if (!this.enabled) return;
    this.pending.push({ event: { event_id: this.uuid(), at: this.now(), data }, world, attempts: 0 });
    this.pending = this.pending.slice(-QUEUE_LIMIT); this.persist();
  }
  get size(): number { return this.pending.length; }
  private persist(): void { try { this.store?.setItem('monde.telemetry.queue', JSON.stringify(this.pending)); } catch { /* bounded memory queue still works */ } }
  async flush(): Promise<void> {
    if (!this.enabled || this.running || !this.pending.length) return;
    this.running = true;
    const generation = this.generation;
    const world = this.pending[0]!.world;
    const batch = this.pending.filter(p => p.world === world).slice(0,25);
    this.abort = new AbortController();
    try {
      let ok = false;
      try { ok = await this.send(batch, this.abort.signal); } catch { /* retry on next flush */ }
      if (generation !== this.generation) return;
      const drop = new Set(batch.filter(p => ok || ++p.attempts >= 3));
      this.pending = this.pending.filter(p => !drop.has(p)); this.persist();
    } finally { this.running = false; }
  }
}
