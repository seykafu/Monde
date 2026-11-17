import { describe, expect, it } from 'vitest';
import { directionRuns, openAfter } from '../stageDirections';

describe('stage directions', () => {
  it('sets a leading direction apart from the speech after it', () => {
    expect(directionRuns('(throws a loop of rope) Monde. Mind the gap.')).toEqual([[
      { text: '(throws a loop of rope)', direction: true },
      { text: ' Monde. Mind the gap.', direction: false }
    ]]);
  });

  it('finds directions mid-line, more than one to a line', () => {
    expect(directionRuns('Oh. (stops) Hi, friends. (starts again, louder)')).toEqual([[
      { text: 'Oh. ', direction: false },
      { text: '(stops)', direction: true },
      { text: ' Hi, friends. ', direction: false },
      { text: '(starts again, louder)', direction: true }
    ]]);
  });

  it('carries a direction across a wrapped line', () => {
    expect(directionRuns('Here. (hands over a flat biscuit\ntin with a lid) Forty-one names.')).toEqual([
      [{ text: 'Here. ', direction: false }, { text: '(hands over a flat biscuit', direction: true }],
      [{ text: 'tin with a lid)', direction: true }, { text: ' Forty-one names.', direction: false }]
    ]);
  });

  it('keeps a half-typed direction styled until its ")" arrives, and carries it across a page', () => {
    expect(directionRuns('(unclips a sin')).toEqual([[{ text: '(unclips a sin', direction: true }]]);
    const firstPage = 'Well. (looks at the lawn,';
    expect(openAfter(firstPage)).toBe(true);
    expect(directionRuns('takes her glasses off) I had a speech.', openAfter(firstPage))).toEqual([[
      { text: 'takes her glasses off)', direction: true },
      { text: ' I had a speech.', direction: false }
    ]]);
  });

  it('leaves plain speech and empty lines alone', () => {
    expect(directionRuns('Morning. Early start?')).toEqual([[{ text: 'Morning. Early start?', direction: false }]]);
    expect(directionRuns('')).toEqual([[]]);
    expect(openAfter('No directions here.')).toBe(false);
  });
});
