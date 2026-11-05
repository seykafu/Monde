// The weekly rhythm in the Lantern (GDD §13.2's "standing weekly rhythm"; §6.6's notices). Pure: no Phaser, no DOM.
// scenes/friendship.ts publish() runs rhythmPaper on every morning's edition.
//
//   Wednesday (from Day 9)  a notice for Roz's quiz that night (wk_pub_quiz);
//   Thursday                the quiz result, when the Fellow played;
//   Saturday                (the market notice is publish()'s own);
//   Sunday                  the service at St. Brigid's, and Saturday's round: the Tollmen collect from Market Row's
//                           open shops (A.1.4: all six). If the Fellow was at the bakery for it (wk_saturday_round),
//                           what they did leads a template edition, or joins a model one's stories.
import type { Press } from '@monde/shared';
import { weekdayOf } from '../sim/clock';
import { occurrence } from '../story/triggers';

/** §13.2: "Wednesday (from D9): pub quiz at the Gull & Anchor, 20:00." */
export const QUIZ_FIRST_DAY = 9;
export const SATURDAY_ROUND = 'wk_saturday_round';
export const PUB_QUIZ = 'wk_pub_quiz';

export interface RhythmState {
  /** The story director's completed list (a repeating scene is `id@day`, story/triggers.ts occurrence). */
  completed: ReadonlySet<string>;
  /** The story's flags and the town's. */
  flags: ReadonlySet<string>;
}

/** The round's line for the morning after, by what the Fellow did (the scene's outcome flags). */
export function roundStory(day: number, state: RhythmState): { headline: string; dek: string; title: string; text: string } | null {
  if (weekdayOf(day) !== 'Sun' || !state.completed.has(occurrence(SATURDAY_ROUND, day - 1))) return null;
  const title = 'Saturday on Market Row';
  if (state.flags.has('round_stood')) return { title, headline: 'Fellow Stands in the Bakery Door',
    dek: 'The Tollmen made their Saturday round', text: 'The Tollmen made their Saturday round of Market Row. At Fournier & Fille the Fellow stood in the doorway beside Madame Fournier when the collectors came in.' };
  if (state.flags.has('round_paid')) return { title, headline: 'Fellow Pays the Bakery’s Twenty',
    dek: 'The Tollmen made their Saturday round', text: 'The Tollmen made their Saturday round of Market Row. At Fournier & Fille the Fellow paid the bakery’s twenty coins out of their own pocket. Madame Fournier was not consulted.' };
  return { title, headline: 'The Saturday Round', dek: 'Twenty coins a shop, as every week',
    text: 'The Tollmen made their Saturday round of Market Row, twenty coins from each open shop. The Fellow was at Fournier & Fille to see it.' };
}

/** The notices the rhythm adds to a morning's paper. */
export function rhythmNotices(day: number, state: RhythmState): string[] {
  const weekday = weekdayOf(day);
  const out: string[] = [];
  if (weekday === 'Wed' && day >= QUIZ_FIRST_DAY) out.push('Quiz night at the Gull & Anchor, 20:00. Teams welcome.');
  if (weekday === 'Thu' && state.completed.has(occurrence(PUB_QUIZ, day - 1)))
    out.push(state.flags.has('quiz_won') ? 'Wednesday’s quiz at the Gull & Anchor went to the Fellow’s table.' : 'Wednesday’s quiz at the Gull & Anchor: the Fellow’s table did not win. There is always next week.');
  if (weekday === 'Sun') {
    out.push('Service at St. Brigid’s, 10:00.');
    // The round happens whether or not the Fellow sees it (from the first Saturday after the courtesy call, S03).
    if (!state.flags.has('tollmen_broken') && state.flags.has('s03_done') && !state.completed.has(occurrence(SATURDAY_ROUND, day - 1)))
      out.push('The Tollmen made their Saturday round of Market Row.');
  }
  return out;
}

/** The morning's edition with the weekly rhythm in it. */
export function rhythmPaper(edition: Press, day: number, state: RhythmState): Press {
  const notices = rhythmNotices(day, state);
  let paper: Press = notices.length ? { ...edition, notices: [...new Set([...edition.notices, ...notices])] } : edition;
  const round = roundStory(day, state);
  if (!round) return paper;
  const eventId = occurrence(SATURDAY_ROUND, day - 1);
  if (paper.stories.some(s => s.event_id === eventId)) return paper;
  const story = { event_id: eventId, title: round.title, text: round.text };
  // A Project opening keeps the lead (projects/press.ts); otherwise, in a template edition, the round leads.
  const opening = paper.stories[0]?.event_id?.startsWith('project:') ?? false;
  if (paper.source === 'template' && !opening) {
    paper = { ...paper, headline: round.headline, dek: round.dek, stories: [story, ...paper.stories].slice(0, 3) };
  } else {
    paper = { ...paper, stories: [paper.stories[0]!, story, ...paper.stories.slice(1)].slice(0, 3) };
  }
  return paper;
}
