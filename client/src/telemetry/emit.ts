import type { EventData } from './schema';
let sink: ((data: EventData) => void) | undefined;
export function setTelemetrySink(next: (data: EventData) => void): void { sink = next; }
export function telemetry(data: EventData): void {
  try { sink?.(data); } catch { /* Optional diagnostics must never interrupt play. */ }
}
