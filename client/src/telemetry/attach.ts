import type { Clock } from '../sim/clock';
import type { RegistryLike } from '../fellow/state';
import type { TownState } from '../town/pillars';
import { computeAppeal } from '../town/appeal';
import { telemetry } from './emit';
import { queue } from './runtime';
const attached = new WeakSet<Clock>();
export function attachTelemetry(registry: RegistryLike, clock: Clock): void {
  if (attached.has(clock)) return;
  attached.add(clock);
  const dawn = () => {
    telemetry({ type: 'day_reached', day: clock.day });
    const town = registry.get('monde.town') as TownState | undefined;
    if (town) telemetry({ type: 'appeal_snapshot', day: clock.day, appeal: computeAppeal(town).appeal });
    void queue.flush();
  };
  telemetry({ type: 'session_start', day: clock.day }); dawn();
  clock.onDawn(dawn);
}
