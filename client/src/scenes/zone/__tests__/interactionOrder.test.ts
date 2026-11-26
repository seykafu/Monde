import { expect, it, vi } from 'vitest';
import { chooseInteraction } from '../interactionOrder';

it.each([
  ['placeAction', 'Start Litter', 'Start Litter  ·  Q: Talk to Corin'],
  ['mark', 'Read the plaque', 'Read the plaque  ·  Q: Talk to Corin'],
  ['door', 'Enter cottage', 'Enter cottage  ·  Q: Talk to Corin'],
  ['message', 'Harbor Steps', 'Talk to Corin'],
  ['message', 'Locked', 'Talk to Corin']
] as const)('chooses E beside Corin at %s (%s)', (slot, label, expected) => {
  const talk = { label: 'Talk to Corin', run: vi.fn() };
  const action = { label, run: vi.fn() };
  const choice = chooseInteraction({ talk, scuffle: null, mark: null, placeAction: null,
    door: null, message: null, ask: true, [slot]: action });
  expect(choice.label).toBe(expected + '  ·  H: Ask about the Projects');
  choice.run!();
  expect(slot === 'message' ? talk.run : action.run).toHaveBeenCalledOnce();
});
