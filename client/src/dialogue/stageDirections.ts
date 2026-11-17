// Stage directions in spoken lines: "(hands over a biscuit tin) Forty-one names." The parenthetical is business,
// not speech, so the panel sets it apart (italic, a softer colour: dialogue/styledBody.ts). Pure, for vitest.
//
// Pages arrive pre-wrapped (ui/fitText.ts paginateBody joins wrapped lines with "\n"), and a direction can run
// across a line or page break, or be half-typed while a reply streams in: an unclosed "(" stays a direction until
// its ")" arrives.

export interface Run { text: string; direction: boolean }

/** Whether `text` ends inside a stage direction (starting `open`). */
export function openAfter(text: string, open = false): boolean {
  for (const c of text) {
    if (c === '(') open = true;
    else if (c === ')') open = false;
  }
  return open;
}

/** Split pre-wrapped page text into its lines, each a list of plain and direction runs. Parentheses belong to the direction. */
export function directionRuns(text: string, open = false): Run[][] {
  return text.split('\n').map(line => {
    const runs: Run[] = [];
    let current = '';
    for (const c of line) {
      if (c === '(' && !open) {
        if (current) runs.push({ text: current, direction: false });
        current = c;
        open = true;
      } else if (c === ')' && open) {
        runs.push({ text: current + c, direction: true });
        current = '';
        open = false;
      } else current += c;
    }
    if (current) runs.push({ text: current, direction: open });
    return runs;
  });
}
