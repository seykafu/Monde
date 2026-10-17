// Browser adapter. Pure engine hooks use emit.ts, so Node tests never load this module.
import { browserStorage, getMind, mindConfig } from '../mind/api';
import { EventData } from './schema';
import { TelemetryQueue } from './queue';
import { readChoice, writeChoice, SurveyGate } from './prefs';
import { setTelemetrySink } from './emit';
const store = browserStorage();
let choice = readChoice(store);
let installId: string | undefined;
function identity(): string {
  if (installId) return installId;
  try { const old = store?.getItem('monde.telemetry.id'); if (old && /^[0-9a-f-]{36}$/i.test(old)) installId = old; } catch { /* session only */ }
  installId ??= crypto.randomUUID();
  try { store?.setItem('monde.telemetry.id', installId); } catch { /* session only */ }
  return installId;
}
export const queue = new TelemetryQueue(async (batch, signal) => {
  const world = batch[0]!.world;
  const auth = world && getMind().worldId === world ? await getMind().ensureWorld() : null;
  if (signal.aborted || (world && auth?.world_id !== world)) return false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 8000);
  try {
    const response = await fetch(`${mindConfig().baseUrl}/v1/telemetry`, {
      method: 'POST', signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'content-type': 'application/json', ...(world ? { authorization: `Bearer ${auth!.token}` } : {}) },
      body: JSON.stringify({ telemetry_id: identity(), ...(world ? { world_id: world } : {}), events: batch.map(p => p.event) }),
    });
    return response.ok;
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}, store, () => crypto.randomUUID());
queue.setEnabled(choice === 'yes'); queue.restore();
export const surveyGate = new SurveyGate(store);
export const telemetryChoice = () => choice;
export function chooseTelemetry(yes: boolean): void {
  choice = yes ? 'yes' : 'no'; writeChoice(store, yes); queue.setEnabled(yes);
}
setTelemetrySink(data => {
  if (!queue.enabled) return;
  const parsed = EventData.safeParse(data);
  if (parsed.success) queue.add(parsed.data, getMind().worldId ?? undefined);
});
// A single adapter timer across scene transitions; nothing leaves while opted out.
if (typeof window !== 'undefined') window.setInterval(() => { void queue.flush(); }, 30000);
