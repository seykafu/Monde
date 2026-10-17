import { describe, expect, it } from 'vitest';
import { fitLines, splitLine } from '../clamps';

const long = "(Turns the watch over.) Fourteen years of tea, if you ask me. It's stopped at sixteen seventeen, Fellow, and it's been stopped that long because Bertrand Achterberg wouldn't lift a finger to the escapement after the mill went.";

describe('over-long lines', () => {
  it('splits at the last sentence within the cap, never mid-word', () => {
    const [head, rest] = splitLine(long, 220)!;
    expect(head).toBe('(Turns the watch over.) Fourteen years of tea, if you ask me.');
    expect(rest.startsWith("It's stopped at sixteen seventeen")).toBe(true);
    expect(splitLine('Short line.', 220)).toBeNull();
  });

  it('carries the rest to the next line while the turn has room, else fits with an ellipsis', () => {
    const two = fitLines([{ text: long, expr: 'neutral' }], 220, 3);
    expect(two.map((l) => l.expr)).toEqual(['neutral', 'neutral']);
    expect(two[0]!.text.endsWith('if you ask me.')).toBe(true);
    expect(two.every((l) => l.text.length <= 220)).toBe(true);
    const full = fitLines([{ text: 'One.' }, { text: 'Two.' }, { text: long }], 220, 3);
    expect(full).toHaveLength(3);
    expect(full[2]!.text.length).toBeLessThanOrEqual(220);
    expect(fitLines([{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }], 220, 3)).toHaveLength(3);
  });
});
