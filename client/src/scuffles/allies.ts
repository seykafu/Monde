import type Phaser from 'phaser';
import { getMind, uuid } from '../mind/api';
import { regardFor, applyServerRegard } from '../scenes/friendship';
import { personaCards } from '../world/residents';
import type { ResidentSim } from '../sim/residentSim';
import type { Clock } from '../sim/clock';
import type { TalkTurn } from '../mind/types';
export const ALLIES = ['augusta', 'kasimir', 'nell'] as const;
export type Ally = typeof ALLIES[number];
/** §7.5 supplies canon eligibility while older persona files omit the optional will_scuffle field. */
export function canInvite(scene: Phaser.Scene, id: Ally): boolean {
  return regardFor(scene.registry, id) >= 40 && personaCards.find(c => c.id === id)?.will_scuffle !== false;
}
const yes: Record<Ally, string> = { augusta: 'Yes. Behind the umbrella, please.', kasimir: 'Yes. Let me put my tea down.', nell: 'Yes. Nobody charges my neighbours for breathing.' };
export async function askAlly(scene: Phaser.Scene, clock: Clock, id: Ally, place: string, signal: AbortSignal): Promise<{ willing: boolean; line: string }> {
  if (!canInvite(scene, id)) return { willing: false, line: 'We need to know one another better first.' };
  const sim = scene.registry.get('monde.residents') as ResidentSim | undefined;
  const resident = sim?.sample(id, clock.day, clock.minute);
  // GDD-GAP: Quiet Mode consent is authored: willing unless asleep/working. Online, the resident decides in dialogue.
  const available = resident?.activity !== 'sleep' && resident?.activity !== 'work';
  const conversation = uuid();
  const fallback = (): TalkTurn => ({ conversation_id: conversation, resident_id: id, turn_index: 0, lines: [{ text: available ? yes[id] : 'No. I can’t leave this just now. Mind yourself.', expr: 'neutral' }], choices: [], wrap_up: true, fallback: true });
  const result = await getMind().talk({ resident_id: id, conversation_id: conversation,
    input: { kind: 'say', text: 'Will you stand with me in this scuffle? It is all right to say no. Please start with yes or no so I know.' },
    context: { day: clock.day, minute: clock.minute, place: resident?.place ?? place, weather: 'overcast', current_activity: 'Deciding whether to join the Fellow in a scuffle. Nobody will be hurt.' }
  }, { fallback, signal });
  if (!result) return { willing: false, line: 'Another time.' };
  if (result.turn.regard) applyServerRegard(scene.registry, { [id]: result.turn.regard.after });
  const line = result.turn.lines.map(l => l.text).join(' ');
  // The existing dialogue contract has no join enum. Only an explicit opening “Yes” counts; ambiguity is not consent.
  return { willing: /^\s*(?:\([^)]*\)\s*)?yes\b/i.test(line), line };
}
