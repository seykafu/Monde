import { describe, expect, it } from 'vitest';
import { DialogueTurnOutput, modelOutputFormat } from '@monde/shared';
import { generateTurn } from '../dialogue.js';
import { message } from './fakeMind.js';
import type { MindClient } from '../mindClient.js';
import type { ValidationContext } from '../validate.js';
import { StreamedTurn } from '../../../../client/src/mind/talkStream.js';
import type { TalkTurn } from '../../../../client/src/mind/types.js';

const ctx: ValidationContext = {
  card: { portrait_expressions: ['warm'] }, emotion: 'content', revealable: new Set(), riddle: null,
  recentLines: [], exitOnly: [{ owner: 'june', phrase: 'Anyway.' }],
  neverSays: ['splendid'], borrowed: [{ owner: 'odile', phrase: 'Mind the step.' }],
  fellow: { name: 'Wren', pronouns: 'she/her' },
  samples: ['The kettle has been singing since dawn.'],
};
const turn = (lines: string[], wrap_up = false): DialogueTurnOutput => ({
  lines: lines.map(text => ({ text, expr: 'warm' })), wrap_up,
  choices: [{ id: 'a', text: 'Tell me more.', intent: 'curious' }, { id: 'b', text: 'Thank you.', intent: 'kind' }],
  effects: { regard_delta: 0, mood: { valence: 0, stress: 0 }, memory: null, favor: null, reveal_secret: null, topic: '' },
});
const clientTurn = (output: DialogueTurnOutput): TalkTurn => ({ ...output, conversation_id: 'c', resident_id: 'june', turn_index: 0, fallback: false });
async function run(outputs: DialogueTurnOutput[], chunk: number, validation = ctx) {
  let calls = 0;
  const stream = new StreamedTurn();
  const changes: string[] = [];
  const mind: MindClient = {
    createBatch: async () => { throw new Error("unused"); },
    retrieveBatch: async () => { throw new Error("unused"); },
    async *batchResults() { yield* []; }, async *listBatches() { yield* []; },
    enabled: true, warm: async () => undefined,
    createMessage: async () => message('', 'end_turn'),
    streamMessage: async (_params, options) => {
      const raw = JSON.stringify(outputs[calls++] ?? outputs.at(-1));
      for (let i = 0; i < raw.length; i += chunk) options.onText(raw.slice(i, i + chunk));
      return message(raw, 'end_turn');
    },
  };
  const result = await generateTurn({
    mind, validation,
    request: { system: [], messages: [{ role: 'user', content: 'Hello.' }], output_config: { format: modelOutputFormat(DialogueTurnOutput) } },
    onLineDelta: d => { changes.push(stream.applyDelta(d)); },
  });
  const visible = stream.lines.some(Boolean);
  if (result.output) changes.push(stream.applyTurn(clientTurn(result.output)));
  return { result, calls, stream, visible, changes };
}

describe('dialogue stream continuity', () => {
  it('property: repairs and soft slips continue the stream across chunk sizes', async () => {
    const variants = [
      ['*Sets the cup down.* Tea is ready.'], ['(*Sets the cup down.*) Tea is ready.'],
      ['Anyway. Tea is ready.'], ['Tea is ready. Anyway.'], ['Anyway.', 'Tea is ready.'], ['Anyway.'],
      ['Tea is ready. Anyway, have a seat.'], ['Two shillings for the loaf.'], ['A penny whistle costs five pounds.'],
      ['Sit, petit. Tea is ready.'], ['Tea is ready.', 'Splendid weather.'],
      ['The kettle has been singing since dawn.'], ['Tea is ready.', 'Mind the step.'],
      ['  Tea is ready.  ', 'Have a seat.'], ['', 'Tea is ready.'],
      ['The kettle is warm and the cups are waiting on the table. '.repeat(7)],
      ['The kettle is warm and the cups are waiting on the table. '.repeat(7), 'Have a seat.', 'Sugar?'],
      ['Tea '.repeat(100)], ['Tea is ready.', 'Tea '.repeat(100), 'Sugar?'],
    ];
    let restarts = 0, total = 0, visible = 0;
    for (const lines of variants) for (const wrap of [false, true]) for (const chunk of [1, 7, 10000]) {
      const outcome = await run([turn(lines, wrap)], chunk);
      total++;
      if (outcome.visible) visible++;
      if (outcome.changes.includes('reset')) restarts++;
      expect(outcome.result.output).not.toBeNull();
    }
    console.log(`Simulated visible restarts: ${restarts}/${total}; turns with streamed text: ${visible}`);
    expect(restarts).toBe(0);
    expect(visible).toBeGreaterThan(total / 2);
  });

  it('accepts visible soft slips, logs repairs, and does not regenerate', async () => {
    const outcome = await run([turn(['Two shillings for the loaf.', 'Splendid weather.'])], 1);
    expect(outcome.calls).toBe(1);
    expect(outcome.result.output?.lines[0]?.text).toBe('Two coins for the loaf.');
    expect(outcome.result.adjustments.join(' ')).toMatch(/currency/);
    expect(outcome.result.adjustments.join(' ')).toMatch(/never_says/);
    expect(outcome.changes).not.toContain('reset');
  });

  it('keeps silent regeneration but never returns attempt one after attempt two was visible', async () => {
    const outcome = await run([turn(['Mind the step.']), turn(['Tea is ready.', 'Mind the step. Splendid weather.'])], 7);
    expect(outcome.calls).toBe(2);
    expect(outcome.result.output?.lines[0]?.text).toBe('Tea is ready.');
    expect(outcome.changes).not.toContain('reset');
  });

  it('falls back instead of reviving a silent spare after a visible hard failure', async () => {
    const outcome = await run([turn(['Mind the step.']), turn(['Tea is ready.', 'A smartphone.'])], 7);
    expect(outcome.calls).toBe(2);
    expect(outcome.visible).toBe(true);
    expect(outcome.result.output).toBeNull();
  });

  it('holds back an opening line that quotes a sample or repeats its own tic, and regenerates it unseen', async () => {
    const withTic: ValidationContext = { ...ctx, own: [{ owner: 'june', phrase: 'Steady on.' }], conversationLines: ['Steady on, it is only rain.'] };
    for (const opener of ['The kettle has been singing since dawn.', 'Steady on. Tea is ready.']) {
      const outcome = await run([turn([opener, 'Have a seat.']), turn(['Tea is ready.'])], 7, withTic);
      expect(outcome.calls).toBe(2);
      expect(outcome.changes).not.toContain('reset');
      expect(outcome.result.output?.lines.map(l => l.text)).toEqual(['Tea is ready.']);
    }
  });

  it('allows regeneration after a visible hard failure', async () => {
    const outcome = await run([turn(['Tea is ready.', 'A smartphone.']), turn(['Have a seat.'])], 7);
    expect(outcome.calls).toBe(2);
    expect(outcome.changes.filter(c => c === 'reset')).toHaveLength(1);
    expect(outcome.result.output?.lines[0]?.text).toBe('Have a seat.');
  });
});
