// The Projects in the Dawn Report (GDD §6.6; MVP G-03). Pure: no Phaser, no DOM.
//
// - An opening makes the next morning's front page: the morning edition the client sets itself (Quiet Mode, or when
//   the server's paper doesn't come) leads with Appendix B.5's HL-PJ-01 ("{PROJECT} IS DONE, AND IT WORKS."), and the
//   `project_open` town event's story goes first. The server's own paper (written as Sable) saw the same town event.
// - The notices carry "Project calls for volunteers" (§6.6) and any opening set for today.
import { fillHeadline, type HeadlineTemplate, type Press } from '@monde/shared';

export interface OpeningNews {
  /** "the fountain", "the house at No. 39". */
  name: string;
  /** "Fountain Square". */
  place: string;
  /** The opening's town event summary, for its story. */
  summary: string;
  /** The town event's id, if it's in the paper's stories already. */
  eventId?: string;
}

export interface ProjectNotices {
  calls: readonly { name: string; left: number; place: string; lead: string }[];
  openingsToday: readonly { name: string; time: string; place: string }[];
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** "the bakery ovens", "the streetlights" take a plural verb; "the fountain", "the Market Hall" a singular one. */
export const isPlural = (name: string): boolean => /s$/.test(name.trim().split(/\s+/).at(-1) ?? '') && !/(glass|brass|ss)$/.test(name);
const verb = (name: string, one: string, many: string): string => (isPlural(name) ? many : one);
/** A name the B.5 headline's "{PROJECT} IS DONE" fits: plural ones become "the work on …". */
export const headlineName = (name: string): string => (isPlural(name) ? `the work on ${name}` : name);

/** The notice lines, in print order: today's openings, then the calls for hands. */
export function projectNotices(n: ProjectNotices): string[] {
  return [
    ...n.openingsToday.map(o => `${cap(o.name)} ${verb(o.name, 'opens', 'open')} today at ${o.time}, ${o.place}. All welcome.`),
    ...n.calls.map(c => `${cap(c.name)} ${verb(c.name, 'needs', 'need')} hands: ${c.left} hour${c.left === 1 ? '' : 's'} to go. Ask ${c.lead} at ${c.place}.`)
  ];
}

/**
 * The morning's edition with yesterday's opening on the front (template editions only: a model edition keeps its
 * own front page) and the Project notices added. Returns a new Press.
 */
export function withProjects(edition: Press, opening: OpeningNews | null, notices: ProjectNotices, templates: readonly HeadlineTemplate[]): Press {
  let paper: Press = { ...edition, notices: [...new Set([...projectNotices(notices), ...edition.notices])] };
  if (!opening || edition.source !== 'template') return paper;
  const t = templates.find(h => h.id === 'HL-PJ-01');
  const headline = t ? fillHeadline(t.headline, { project: headlineName(opening.name), place: opening.place }) : null;
  const dek = t ? fillHeadline(t.dek, { project: opening.name, place: opening.place }) : null;
  const stories = paper.stories.some(s => s.event_id && s.event_id === opening.eventId) || paper.stories.some(s => s.text === opening.summary)
    ? paper.stories
    : [{ event_id: opening.eventId ?? null, title: 'Opened yesterday', text: opening.summary }, ...paper.stories].slice(0, 3);
  // The opening's story leads.
  const lead = stories.findIndex(s => s.text === opening.summary);
  const ordered = lead > 0 ? [stories[lead]!, ...stories.filter((_, i) => i !== lead)] : stories;
  paper = { ...paper, headline: headline ?? paper.headline, dek: dek ?? paper.dek, stories: ordered };
  return paper;
}
