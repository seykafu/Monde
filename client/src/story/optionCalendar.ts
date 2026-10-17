import type { Press } from '@monde/shared';
import type { StorySession } from './session';
import { appendEvent } from '../scenes/events';
import type Phaser from 'phaser';

/** Spring calendar: Sable prints facts from the contract, never guesses Pell's motives. */
export function optionCalendar(registry: Phaser.Data.DataManager, day: number, paper: Press): Press {
  const flags = { ...(registry.get('monde.story.flags') as Record<string, unknown> | undefined) };
  const due = flags.option_kept_secret && !flags.option_public && day === (flags.sable_week_granted ? 25 : 21);
  if (due) {
    flags.option_public = true;
    const broken = !flags.sable_week_granted;
    if (broken) flags.pell_promise_broken = true;
    const held = registry.get('monde.story.session') as { session: StorySession } | undefined;
    for (const flag of ['option_public', ...(broken ? ['pell_promise_broken'] : [])]) held?.session.flags.set(flag);
    registry.set('monde.story.flags', held ? { ...flags, ...held.session.snapshot() } : flags);
    if (broken) appendEvent(registry, { kind: 'scripted_regard', id: 'calendar_option_pell', day, minute: 360,
      resident: 'pell', scene_id: 'spring_calendar', cue_key: 'option_public', delta: -10 });
  }
  if (!due && !(day === 19 && flags.option_public)) return paper;
  const headline = 'THE WHARF HAS AN OPTION ON IT';
  const text = 'Clause nine of the streetlight loan lets Vane Consolidated buy the Wharf if the census stays below 200 for seven consecutive days. The price: one coin per metre of frontage.';
  return { ...paper, headline, dek: 'The Lantern prints the clause in the council’s streetlight contract.',
    stories: [{ event_id: null, title: 'Page nine', text }, ...paper.stories].slice(0, 3) };
}
