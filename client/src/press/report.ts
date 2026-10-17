// Report on the Lantern and on letters (GDD §9.13 "a Report line button on every generated line flags it to the
// review queue and swaps in a fallback immediately"; the dialogue panel's is in DialogueScene). Pure: no Phaser, no DOM.
//
// What's generated: the server's edition says `source: "model"` when Sable's model wrote the headline, dek and stories
// (server press.ts); a template edition is authored lines and the engine's own records. The client then prints its own
// changes on top (a Project opening, the Option clause, the Straw Poll), so publishing stamps what is still the
// model's (`model_index` on a story, `model_front` on the headline and dek) by comparing with the server's copy.
// Letters are written only by the night's reflections (`letter_<resident>_<day>`, model-written); others are authored.
// A Letter to the Lantern is the resident's own words in a template edition too, so it stays reportable there.
//
// A reported item is withdrawn at once and stays withdrawn: its key goes into the save (`friendship.reported`).
import { isGeneratedLetterId, type Press, type ReportBody, type SavedFriendship } from '@monde/shared';

/** The Lantern's own words for what it pulled (authored, in the paper's voice; the masthead line is fallbackPress's). */
export const WITHDRAWN = {
  headline: 'THE LANTERN — MORNING EDITION',
  dek: '[The front-page item was withdrawn by the Lantern. The forme is being reset.]',
  title: 'Withdrawn',
  story: '[This item was withdrawn by the Lantern. The type is back in the case.]',
  /** A letter printed in the paper's Letters to the Lantern. */
  letter: '[A letter was withdrawn by the Lantern.]',
} as const;

type Story = Press['stories'][number];

// ── What's generated ────────────────────────────────────────────────────────

/** The headline and dek are the model's, as printed. */
export const isGeneratedFront = (paper: Press): boolean => paper.source === 'model' && paper.model_front === true;
/** This story is the model's, as printed. */
export const isGeneratedStory = (paper: Press, story: Story): boolean => paper.source === 'model' && story.model_index !== undefined;
/** A letter a resident's reflection wrote (a Lantern letter without an id was printed before reports reached the paper). */
export const isGeneratedLetter = (letter: { id?: string }): boolean => !!letter.id && isGeneratedLetterId(letter.id);

/**
 * Stamp what the model still wrote once the client has printed its edition over the server's: each story that is one
 * of the server's (same event, title and text) gets its index there, and the front is the model's if neither the
 * headline nor the dek was replaced. A template edition, or no server edition (Quiet Mode), stamps nothing.
 */
export function stampGenerated(edition: Press, server: Press | null | undefined): Press {
  const { model_front: _front, ...rest } = edition;
  const plain = { ...rest, stories: edition.stories.map(({ model_index: _index, ...s }) => s) };
  if (!server || server.source !== 'model' || edition.source !== 'model') return plain;
  const used = new Set<number>();
  const stories = plain.stories.map(s => {
    const j = server.stories.findIndex((m, i) => !used.has(i) && m.event_id === s.event_id && m.title === s.title && m.text === s.text);
    if (j < 0) return s;
    used.add(j);
    return { ...s, model_index: j };
  });
  const front = edition.headline === server.headline && edition.dek === server.dek;
  return { ...plain, stories, ...(front ? { model_front: true } : {}) };
}

// ── Keys and the saved set ──────────────────────────────────────────────────

export const frontKey = (day: number): string => `press:${day}:front`;
export const storyKey = (day: number, modelIndex: number): string => `press:${day}:story:${modelIndex}`;
export const letterKey = (id: string): string => `letter:${id}`;

export const isReported = (state: Pick<SavedFriendship, 'reported'>, key: string): boolean => (state.reported ?? []).includes(key);
/** The state with `key` reported (the same state if it already was). */
export function markReported<S extends Pick<SavedFriendship, 'reported'>>(state: S, key: string): S {
  return isReported(state, key) ? state : { ...state, reported: [...(state.reported ?? []), key] };
}
/** The keys to add to an older copy of the save (the morning's autosave) so it agrees with this one. */
export const mergeReported = (saved: readonly string[] | undefined, now: readonly string[]): string[] =>
  [...new Set([...(saved ?? []), ...now])];

// ── The paper as printed ────────────────────────────────────────────────────

/** One item of the printed page: what to send if it's reported, or null (authored, or already withdrawn). */
export interface PrintedItem { key: string | null; withdrawn: boolean; report: ReportBody | null }
export interface PrintedPaper {
  /** The edition with every withdrawn item replaced by the Lantern's line. */
  paper: Press;
  front: PrintedItem;
  /** Aligned with `paper.stories`. */
  stories: PrintedItem[];
  /** Aligned with `paper.letters`. */
  letters: PrintedItem[];
}

const item = (key: string | null, reported: readonly string[], report: ReportBody | null): PrintedItem => {
  const withdrawn = key !== null && reported.includes(key);
  return { key, withdrawn, report: key !== null && !withdrawn ? report : null };
};

/** The edition as the Lantern prints it for this save: reported items withdrawn, the rest with what to report. */
export function printPaper(paper: Press, reported: readonly string[] = []): PrintedPaper {
  const day = paper.day;
  const front = item(isGeneratedFront(paper) ? frontKey(day) : null, reported, { kind: 'press', day, story: 'front', reason: 'Report headline' });
  const stories = paper.stories.map(s => item(isGeneratedStory(paper, s) ? storyKey(day, s.model_index!) : null, reported,
    { kind: 'press', day, story: s.model_index!, event_id: s.event_id, reason: 'Report story' }));
  const letters = paper.letters.map(l => item(isGeneratedLetter(l) ? letterKey(l.id!) : null, reported,
    { kind: 'letter', letter_id: l.id!, reason: 'Report letter' }));
  const printed: Press = {
    ...paper,
    ...(front.withdrawn ? { headline: WITHDRAWN.headline, dek: WITHDRAWN.dek } : {}),
    stories: paper.stories.map((s, i) => stories[i]!.withdrawn ? { ...s, title: WITHDRAWN.title, text: WITHDRAWN.story } : s),
    letters: paper.letters.map((l, i) => letters[i]!.withdrawn ? { ...l, text: WITHDRAWN.letter } : l),
  };
  return { paper: printed, front, stories, letters };
}
