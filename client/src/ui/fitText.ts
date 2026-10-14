import Phaser from "phaser";

// Paginate a dialogue body into fixed-font pages that each fit the box.
//
// History: an earlier pass shrank the font per-beat so any length fit one
// box (fitBodyText). That kept everything on one page but produced tiny,
// inconsistent text on long beats and read badly. We reverted to the
// classic VN approach: a fixed, comfortable font, and when a beat is longer
// than the box, split it into pages the player clicks through ("More ▾").
// Paired with a script-wide verbosity cut, most beats are now one page and
// the few long ones page cleanly instead of shrinking.
//
// `textObj` must already have its fontSize, lineSpacing, and wordWrap.width
// configured (we read its wrapping at the real display font). We only touch
// its text contents transiently to measure, and restore it to empty.

// Split `body` into pages, each at most `maxLines` wrapped lines. Returns the
// page strings (wrapped lines joined with explicit newlines so the typewriter
// reveal doesn't reflow as characters appear). Never returns an empty array —
// an empty/blank body yields a single empty page so the page pointer stays
// valid.
export const paginateBody = (
  textObj: Phaser.GameObjects.Text,
  body: string,
  maxLines: number
): string[] => {
  const lines = textObj.getWrappedText(body);
  textObj.setText("");
  if (lines.length === 0) return [body];

  const perPage = Math.max(1, maxLines);
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage).join("\n"));
  }
  return pages;
};

// Compute how many lines of `fontSize` (+ `lineSpacing`) fit in `maxHeight`.
//
// Phaser's real per-line advance is the font's measured ascent+descent plus
// lineSpacing — NOT `fontSize + lineSpacing`. For the serif body face (EB
// Garamond) the ascent+descent runs ~1.2x the CSS px size, so budgeting with
// the naive formula over-packs the box and the last line's descenders clip
// the panel border. Budget with the 1.2x advance and floor, so the page
// always fits with room for descenders.
export const maxLinesFor = (
  fontSize: number,
  lineSpacing: number,
  maxHeight: number
): number => Math.max(1, Math.floor(maxHeight / (fontSize * 1.2 + lineSpacing)));
