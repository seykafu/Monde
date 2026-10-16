import { uuid, getMind } from '../../mind/api';
import type { TalkContext, TalkInput, TalkTurn } from '../../mind/types';
import type { ChatterJoin } from './chatter';

/** A second ordinary dialogue session preserves moderation, voice, memory and server fallbacks. */
export class JoinedChatter {
  private conversation = uuid();
  private turns = 0;
  constructor(readonly join: ChatterJoin, readonly name: string, readonly primaryName: string, private readonly narrated = false) {}
  async comment(input: TalkInput, context: TalkContext, signal: AbortSignal): Promise<TalkTurn | null> {
    // Gifts/meals are addressed to the primary only, never applied twice.
    if (input.kind === 'gift' || input.kind === 'meal') return null;
    const fallback = (): TalkTurn => ({ conversation_id: this.conversation, resident_id: this.join.secondary,
      turn_index: this.turns, lines: [{ text: this.narrated ? '(makes room beside them)' : input.kind === 'open' ? 'Come and stand with us.' : 'Go on. I’m listening.', expr: 'neutral' }],
      choices: [], wrap_up: false, fallback: true });
    if (signal.aborted) return null;
    if (!getMind().enabled) return fallback();
    try {
      const result = await getMind().talk({ resident_id: this.join.secondary, conversation_id: this.conversation,
        input: input.kind === 'choice' ? { kind: 'say', text: input.text } : input,
        context: { ...context, current_activity: `Talking with ${this.primaryName} and the Fellow. ${this.join.lines.at(-1)?.text ?? ''}`.slice(0, 120) },
      }, { signal, fallback });
      if (result) { this.conversation = result.turn.conversation_id; this.turns++; }
      return result?.turn ?? null;
    } catch { return signal.aborted ? null : fallback(); }
  }
  close(context: TalkContext): void { void getMind().closeTalk(this.join.secondary, this.conversation, context.day, context.minute); }
}
