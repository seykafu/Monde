import { beforeEach, expect, it, vi } from 'vitest';
const mind = vi.hoisted(() => ({ enabled: true, talk: vi.fn(), closeTalk: vi.fn() }));
vi.mock('../../../mind/api', () => ({ uuid: () => 'new-conversation', getMind: () => mind }));
import { JoinedChatter } from '../joinChatter';
const context = { day: 1, minute: 900, place: 'square', weather: 'clear' };
const join = () => new JoinedChatter({ secondary: 'odile', lines: [{ speaker: 'june', text: 'Sit a moment.', expr: 'warm' }] }, 'Odile', 'June');
beforeEach(() => { mind.enabled = true; vi.clearAllMocks(); });
it('addresses the secondary with the player words and closes the returned session', async () => {
  mind.talk.mockImplementation(async (_body, handlers) => ({ turn: { ...handlers.fallback(), conversation_id: 'server-session' }, source: 'server' }));
  const joined = join();
  await joined.comment({ kind: 'choice', choice_id: 'primary-only', text: 'May I sit here?', intent: 'kind' }, context, new AbortController().signal);
  expect(mind.talk.mock.calls[0]![0]).toMatchObject({ resident_id: 'odile', input: { kind: 'say', text: 'May I sit here?' }, context: { current_activity: 'Talking with June and the Fellow. Sit a moment.' } });
  joined.close(context);
  expect(mind.closeTalk).toHaveBeenCalledWith('odile', 'server-session', 1, 900);
});
it('keeps gifts on the primary and never calls after cancellation', async () => {
  const joined = join(), abort = new AbortController();
  expect(await joined.comment({ kind: 'meal', item: 'bread', event_id: 'meal', text: 'Bread?' }, context, abort.signal)).toBeNull();
  abort.abort();
  expect(await joined.comment({ kind: 'say', text: 'Hello' }, context, abort.signal)).toBeNull();
  expect(mind.talk).not.toHaveBeenCalled();
});
it('has an authored secondary reply offline', async () => {
  mind.enabled = false;
  const turn = await join().comment({ kind: 'open' }, context, new AbortController().signal);
  expect(turn).toMatchObject({ resident_id: 'odile', fallback: true, lines: [{ text: 'Come and stand with us.', expr: 'neutral' }] });
  expect(mind.talk).not.toHaveBeenCalled();
});
