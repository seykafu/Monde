import { telemetry } from '../telemetry/emit';
import { enqueue } from '../mind/events';
import { emptyEventLog } from '@monde/shared';
import { requestHint } from '../riddles/engine';
/** Registry adapter for the pure Marks engine. */
import { gainXp, Wallet, Economy, Inventory, emptyRiddles, type SavedRiddles } from '@monde/shared';
import type { RegistryLike } from '../fellow/state';
import { ensureFellow, setFellow } from '../fellow/state';
import type { Clock } from '../sim/clock';
import type { StorySession } from '../story/session';
import { applyPillarDelta, type TownState } from '../town/pillars';
import { answerMark, gameMinute, readMark, tickHints, type RiddleContext, type RewardHooks } from '../riddles/engine';
export const RIDDLES_KEY = 'monde.riddles';
export function marks(registry: RegistryLike): SavedRiddles {
  let state = registry.get(RIDDLES_KEY) as SavedRiddles | undefined;
  if (!state) { state = emptyRiddles(); registry.set(RIDDLES_KEY, state); }
  return state;
}
function sessionOf(registry: RegistryLike): StorySession | undefined { return (registry.get('monde.story.session') as { session: StorySession } | undefined)?.session; }
export function markContext(registry: RegistryLike, clock: Pick<Clock, 'day' | 'minute'>): RiddleContext {
  const session = sessionOf(registry);
  const flags = session?.flags.snapshot() ?? new Set(Object.entries((registry.get('monde.story.flags') ?? {}) as Record<string, unknown>).filter(([,v]) => v === true).map(([k]) => k));
  // District start days are checked by the engine; the three built districts have no additional opening flag.
  return { day: clock.day, minute: clock.minute, flags, openDistricts: new Set(['old_quarter', 'market_row', 'wharf', ...(clock.day >= 6 ? ['commons'] : [])]) };
}
export function findMark(registry: RegistryLike, clock: Pick<Clock, 'day' | 'minute'>, id: string): boolean {
  const state = marks(registry); const ok = readMark(state, id, markContext(registry, clock));
  registry.set(RIDDLES_KEY, state); return ok;
}
export function refreshHints(registry: RegistryLike, clock: Pick<Clock, 'day' | 'minute'>): void { tickHints(marks(registry), gameMinute(clock)); }
/** Missing economy/project consumers can register this typed hook; durable pending rewards remain in the ledger. */
export interface RiddleRewardConsumer { apply(id: string, coins: number, items: readonly string[], tibRegard: number): void }
export function submitMark(registry: RegistryLike, clock: Pick<Clock, 'day' | 'minute'>, id: string, text: string, method: 'named' | 'found' = 'named') {
  const state = marks(registry), session = sessionOf(registry);
  const hooks: RewardHooks = { apply: (key, reward) => {
    const fellow = ensureFellow(registry);
    setFellow(registry, { ...fellow, skills: gainXp(fellow.skills, 'wits', reward.xp) });
    const wallet = Wallet.parse(registry.get('monde.coins') ?? {});
    registry.set('monde.coins', { balance: wallet.balance + reward.coins });
    let town = registry.get('monde.town') as TownState | undefined;
    if (town) { town = applyPillarDelta(town, 'charm', reward.charm, 'riddle', key); town = applyPillarDelta(town, 'spirit', reward.spirit, 'riddle', key); registry.set('monde.town', town); }
    for (const flag of reward.flags) session?.flags.set(flag);
    const enqueueReward = (event: Parameters<typeof enqueue>[1]) => {
      const log = (registry.get('monde.events') as ReturnType<typeof emptyEventLog> | undefined) ?? emptyEventLog();
      registry.set('monde.events', enqueue(log, event).log);
    };
    if (reward.regard) enqueueReward({ kind: 'scripted_regard', id: `riddle:${key}:regard`, day: clock.day, minute: Math.floor(clock.minute), resident: 'tib', scene_id: 'riddles', cue_key: key, delta: reward.regard });
    if (reward.fragment) {
      const headline = `${key.split('-')[0]} trail complete: a Charter fragment recovered.`;
      state.headlines.push({ day: clock.day, text: headline });
      // GDD-GAP: §14.3 supplies no memory importance; 6 matches a landmark opening.
      for (const resident of ['margo', 'bertrand', 'tib']) enqueueReward({ kind: 'scripted_memory', id: `riddle:${key}:memory:${resident}`, day: clock.day, minute: Math.floor(clock.minute), resident, scene_id: 'riddles', cue_key: key, place: 'old_quarter.library', text: headline, importance: 6 });
    }
    const consumer = registry.get('monde.riddle.rewardConsumer') as RiddleRewardConsumer | undefined;
    if (consumer) consumer.apply(key, 0, reward.items, reward.regard);
    else if (session) { for (const item of reward.items) session.ledger.items[item] = (session.ledger.items[item] ?? 0) + 1; session.ledger.regard.tib = (session.ledger.regard.tib ?? 0) + reward.regard; }
    if (session) registry.set('monde.story.flags', session.snapshot());
  } };
  const result = answerMark(state, id, text, method, markContext(registry, clock), hooks);
  if (result === 'solved') telemetry({ type: 'mark_solved', day: clock.day, id, hints: state.entries[id]?.hints ?? 0 });
  registry.set(RIDDLES_KEY, state); return result;
}

/** Home is checked against the live story position, never the Journal tab. */
export function homeHint(registry: RegistryLike, id: string): boolean {
  if (sessionOf(registry)?.context().place !== 'old_quarter.lamplighter_cottage') return false;
  return requestHint(marks(registry), id, { kind: 'home', spendStamina: cost => {
    const state = Economy.parse(registry.get('monde.economy') ?? {});
    if (state.stamina < cost) return false;
    registry.set('monde.economy', { ...state, stamina: state.stamina - cost }); return true;
  } });
}
export function notebookHint(registry: RegistryLike, id: string): boolean {
  return requestHint(marks(registry), id, { kind: 'notebook', consumePage: chain => {
    // GDD-GAP: Notebook item ids are not authored. The item hook uses founders_notebook_<chain>.
    const bag = Inventory.parse(registry.get('monde.inventory') ?? {});
    const index = bag.slots.findIndex(s => s?.item === `founders_notebook_${chain.toLowerCase()}`);
    if (index < 0) return false;
    const slot = bag.slots[index]!;
    bag.slots[index] = slot.count === 1 ? null : { ...slot, count: slot.count - 1 };
    registry.set('monde.inventory', bag); return true;
  } });
}
