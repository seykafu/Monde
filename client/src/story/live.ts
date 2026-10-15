// {ai_line} (GDD §13.1, §9.10): one live line from a resident through the existing talk API. Pure: the mind
// client is injected, so this runs under vitest with a fake.
//
// GDD-GAP: monde-mind has no scripted-slot endpoint, so the slot is an `open` turn on /talk with the brief as
// the scene's `current_activity` (clipped to the API's 120 characters), and the first line of the turn is the
// slot. Anything short of a live server line (Quiet Mode, an authored server fallback, an error, nothing within
// §9.10's 6 s) returns [] and the runtime plays the authored {fallback}.
import type { MindClient } from '../mind/api';
import type { TalkContext, TalkTurn } from '../mind/types';
import { clipActivity } from './host';
import type { StoryLine } from './runtime';

/** §9.10 step 4: by 6 s the line falls back to the authored library and the call is abandoned. */
export const AI_LINE_TIMEOUT_MS = 6000;

export interface AiLineRequest {
  residentId: string;
  brief: string;
  context: TalkContext;
}

export async function liveLine(
  mind: Pick<MindClient, 'enabled' | 'talk'>, req: AiLineRequest,
  opts: { conversationId: string; timeoutMs?: number }
): Promise<StoryLine[]> {
  if (!mind.enabled) return [];
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? AI_LINE_TIMEOUT_MS);
  const empty = (): TalkTurn => ({ conversation_id: opts.conversationId, resident_id: req.residentId, turn_index: 0, lines: [], choices: [], wrap_up: true, fallback: true });
  try {
    const result = await mind.talk({
      resident_id: req.residentId, conversation_id: opts.conversationId, input: { kind: 'open' },
      context: { ...req.context, current_activity: clipActivity(req.brief) }
    }, { signal: abort.signal, fallback: empty });
    if (!result || result.source !== 'server' || result.turn.fallback) return [];
    const line = result.turn.lines.find(l => l.text.trim());
    return line ? [{ kind: 'say', speaker: req.residentId, text: line.text.trim(), expr: line.expr }] : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
