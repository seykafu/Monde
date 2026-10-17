import { describe, expect, it, vi } from 'vitest';
import type { TalkHandlers, TalkResult } from '../../mind/api';
import type { TalkRequest, TalkTurn } from '../../mind/types';
import { liveLine } from '../live';

const context = { day: 25, minute: 760, place: 'commons.sundial_lawn', weather: 'bright spells', current_activity: null };
const turn = (over: Partial<TalkTurn> = {}): TalkTurn => ({
  conversation_id: 'c', resident_id: 'rosalind', turn_index: 0, lines: [{ text: 'Sixty cups, pet.', expr: 'warm' }, { text: 'Second.', expr: 'neutral' }],
  choices: [], wrap_up: false, fallback: false, ...over
});
const mind = (enabled: boolean, answer: (req: TalkRequest, h: TalkHandlers) => Promise<TalkResult | null>) => ({ enabled, talk: vi.fn(answer) });

describe('liveLine ({ai_line})', () => {
  it('takes the first line of a live server turn, with the brief as the activity', async () => {
    const m = mind(true, async () => ({ turn: turn(), source: 'server' }));
    const lines = await liveLine(m, { residentId: 'rosalind', brief: 'x '.repeat(100), context }, { conversationId: 'c' });
    // §9.13: the stored turn travels with the line so the story panel can report it.
    expect(lines).toEqual([{ kind: 'say', speaker: 'rosalind', text: 'Sixty cups, pet.', expr: 'warm', report: { conversation_id: 'c', turn_index: 0 } }]);
    const req = m.talk.mock.calls[0]![0];
    expect(req.input).toEqual({ kind: 'open' });
    expect(req.context.current_activity!.length).toBeLessThanOrEqual(120);
  });

  it('falls back (returns nothing) offline, in Quiet Mode, on a server fallback and on errors', async () => {
    const offline = mind(false, async () => ({ turn: turn(), source: 'server' }));
    expect(await liveLine(offline, { residentId: 'rosalind', brief: 'b', context }, { conversationId: 'c' })).toEqual([]);
    expect(offline.talk).not.toHaveBeenCalled();
    const quiet = mind(true, async (_r, h) => ({ turn: h.fallback(), source: 'quiet', reason: 'offline' }));
    expect(await liveLine(quiet, { residentId: 'rosalind', brief: 'b', context }, { conversationId: 'c' })).toEqual([]);
    const authored = mind(true, async () => ({ turn: turn({ fallback: true }), source: 'server' }));
    expect(await liveLine(authored, { residentId: 'rosalind', brief: 'b', context }, { conversationId: 'c' })).toEqual([]);
    const broken = mind(true, async () => { throw new Error('boom'); });
    expect(await liveLine(broken, { residentId: 'rosalind', brief: 'b', context }, { conversationId: 'c' })).toEqual([]);
  });

  it('gives up after the timeout (§9.10: by 6 s the authored line plays)', async () => {
    vi.useFakeTimers();
    try {
      const slow = mind(true, (_r, h) => new Promise(resolve => h.signal!.addEventListener('abort', () => resolve(null))));
      const pending = liveLine(slow, { residentId: 'rosalind', brief: 'b', context }, { conversationId: 'c', timeoutMs: 6000 });
      await vi.advanceTimersByTimeAsync(6000);
      expect(await pending).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
