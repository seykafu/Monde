import { z } from 'zod';
export const PressStory = z.object({ event_id: z.string().nullable(), title: z.string(), text: z.string() });
export const PressCopy = z.object({ headline: z.string(), dek: z.string(), stories: z.array(PressStory).min(2).max(3) });
export type PressCopy = z.infer<typeof PressCopy>;
const pillars = z.object({ prosperity:z.number(),safety:z.number(),spirit:z.number(),charm:z.number() });
export const Press = PressCopy.extend({
  ledger: z.object({ pillars,dayStart:pillars,census:z.number(),appeal:z.number(),fund:z.number() }).optional(), day: z.number().int().positive(), source: z.enum(['model', 'template']),
  event_ids: z.array(z.string()), letters: z.array(z.object({ from: z.string(), text: z.string() })),
  movement_residents: z.array(z.string()).optional(),
  movements: z.array(z.string()), notices: z.array(z.string()),
});
export type Press = z.infer<typeof Press>;
export const PressEventData = z.object({ id:z.string(),day:z.number().int(),minute:z.number(),type:z.string(),summary:z.string(),importance:z.number(),who:z.array(z.string()) });
export interface PressEvent { id: string; day: number; minute: number; type: string; summary: string; importance: number; who: readonly string[]; known?: number; }
/** GDD-GAP: §9.12 names ranking factors but no weights. Importance dominates, then novelty, reach and involvement. */
export function rankPressEvents(events: readonly PressEvent[], day: number, recentTypes: readonly string[] = []): PressEvent[] {
  const score = (e: PressEvent) => e.importance * 10 + (recentTypes.includes(e.type) ? 0 : 5) + Math.min(5, e.known ?? e.who.length) + (e.who.includes('player') ? 3 : 0);
  return [...new Map(events.filter(e => e.day === day).map(e => [e.id, e])).values()]
    .sort((a,b) => score(b) - score(a) || a.minute - b.minute || a.id.localeCompare(b.id)).slice(0, 5);
}
export interface HeadlineTemplate { id: string; category: string; headline: string; dek: string; }
export function fillHeadline(value: string, facts: Readonly<Record<string, string | number>>): string | null {
  let missing = false;
  const result = value.replace(/\{([^}|]+)(?:\|(upper|cap))?\}/g, (_, key: string, style: string | undefined) => {
    const fact = facts[key]; if (fact === undefined) { missing = true; return ''; }
    const s = String(fact); return style === 'upper' ? s.toUpperCase() : style === 'cap' ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  });
  return missing ? null : result;
}
/** B.5 templates only print when every necessary fact is available; never invent a cat sighting or a scuffle outcome. */
export function fallbackPress(day: number, events: readonly PressEvent[], templates: readonly HeadlineTemplate[], facts: Record<string, string | number> = {}): Press {
  const ranked = rankPressEvents(events, day - 1);
  const template = templates.find(t => t.id === 'HL-PJ-04' && facts.coins !== undefined);
  const headline = template ? fillHeadline(template.headline, facts) : null;
  const dek = template ? fillHeadline(template.dek, { 'resident:pell': 'Pell', ...facts }) : null;
  const stories: PressCopy["stories"] = ranked.slice(0,3).map(e => ({ event_id: e.id, title: 'From yesterday', text: e.summary }));
  // GDD-GAP: B.5 has no fact-free quiet-day template. These explicitly describe an empty news desk, not invented events.
  while (stories.length < 2) stories.push({ event_id: null, title: stories.length ? 'Letters desk' : 'The day book', text: stories.length ? 'Letters for the Lantern may be left at the office.' : 'No further reports reached the desk yesterday.' });
  return { day, source: 'template', headline: ranked[0]?.summary ?? headline ?? 'THE LANTERN — MORNING EDITION', dek: ranked.length ? 'Yesterday’s reports, entered in the day book.' : dek ?? 'The morning paper, set by hand.', stories, event_ids: ranked.map(e => e.id), letters: [], movements: [], notices: [] };
}
