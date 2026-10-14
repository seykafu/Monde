// How long a line of text needs on screen to be read at an easy pace: a
// second to find it, then about three words a second. Timed text (the
// cinematics' captions and narration, a finale's closing line, a boss's
// last words) holds for at least this long, however short its script's
// own timing.
export const readMs = (text: string): number =>
  1000 + text.trim().split(/\s+/).filter(Boolean).length * 330;
