/**
 * How the town stands today (MVP Q-01): the World Bible facts that story flags overturn, for block 4.
 *
 * The World Bible (block 1) describes Monde on the first day of spring, the stopped clocktower included, and must
 * stay identical for every world. Canon locks (block 2) carry each resident's own flag-dependent facts. The
 * town-wide facts that have changed since that first day live here and reach every resident request as one
 * `<town_now>` line in the dynamic block (dialogue, plan, reflection, gossip), built from the world's story flags
 * (synced by the client, M-06), so blocks 1-3 never change when a flag does.
 *
 * Only what differs from the first day of spring is listed, and the line is framed as background to bring up only
 * if the conversation comes to it. With nothing changed there is no line at all. (An always-on clocktower line
 * made residents drag the clock into answers about trains and goodbyes: blind A/B eval, 2026-10-16.) Facts and
 * wording come from the GDD story-flag table (§12.2), the Project summaries (content/projects.yaml) and the S07
 * scenes.
 */

/** A town fact that applies while `when` holds for the world's flags (names without the `flag.` prefix). */
interface TownFact {
  when: (flags: ReadonlySet<string>) => boolean;
  text: string;
}

const has = (...names: string[]) => (flags: ReadonlySet<string>) => names.some((name) => flags.has(name));

const CLOCK_RUNNING = has("clock_running", "project_clocktower_done");

/** In this order in the prompt. The first day of spring (the clock stopped at 4:17) is the World Bible's. */
const FACTS: readonly TownFact[] = [
  // S07a with PZ-15 solved (clock_running), or the clocktower Project's completion.
  { when: CLOCK_RUNNING, text: "The clocktower runs again: it keeps the time and strikes the hour." },
  // S07a without PZ-15, or S07b's borrowed pinion: one chime at the Quarter Chime, then stopped "at sixteen eighteen".
  {
    when: (f) => !CLOCK_RUNNING(f) && f.has("clock_chimed"),
    text: "The clocktower struck once at the Quarter Chime, then stopped again at 4:18. It doesn't keep the time yet.",
  },
  { when: has("project_fountain_done"), text: "The fountain in Fountain Square runs again." },
  { when: has("project_streetlights_done"), text: "The streetlamps from the Town Hall to Bell Row are lit again." },
  { when: has("project_market_hall_done"), text: "The Market Hall is open again, with painted stalls and a sound roof." },
  { when: has("project_community_garden_done"), text: "The garden beds on the Commons are dug and sown." },
  { when: has("bakery_ovens_fixed", "project_bakery_ovens_done"), text: "Odile's ovens at Fournier & Fille are relit on new firebrick." },
  { when: has("project_lighthouse_done"), text: "Point Lumière is lit again; its beam turns at night." },
  { when: has("glasshouse_repaired"), text: "The Glasshouse has its panes back." },
  { when: has("bandstand_rebuilt"), text: "The bandstand on the Commons is rebuilt." },
  { when: has("tollmen_broken"), text: "The Tollmen's collections have ended." },
  { when: has("project_ferry_done"), text: "The ferry runs every day now." },
  { when: has("cannery_coop"), text: "The cannery has reopened as a co-op." },
  { when: has("clinic_open"), text: "Monde Clinic is open again." },
  { when: has("school_saved"), text: "Millbrook School has its twenty pupils and stays open." },
  { when: has("station_open"), text: "Trains stop at Monde Station again." },
];

/** The facts that hold for these story flags (with or without the `flag.` prefix), in prompt order. */
export function townFacts(flags: Iterable<string>): string[] {
  const set = new Set([...flags].map((flag) => flag.replace(/^flag\./, "")));
  return FACTS.filter((fact) => fact.when(set)).map((fact) => fact.text);
}

/** The `<town_now>` element for block 4, or "" (the template drops the line) when nothing has changed. */
export function townNowBlock(flags: Iterable<string>): string {
  const facts = townFacts(flags);
  return facts.length
    ? `<town_now> Since the first day of spring (background: bring it up only if the talk comes to it): ${facts.join(" ")} </town_now>`
    : "";
}
