// Dev only: `?spring=<style>` starts a game on Day 25 (or `?day=`) with a plausible Spring behind it, so the Bloom Fair,
// the Straw Poll and the End-of-Spring report can be tried without playing 25 days. The styles are the Straw Poll soak's
// (finale/__tests__/springSoak.ts): their Day-25 Pillars and Regard are the soak's numbers for world 2026; the Projects,
// Scuffles and Marks are their scripts' (town/__tests__/migrationSoak.ts). Use with `?skiptitle=1` (and `&offline`).
// Pure: the registry is anything with get/set/remove.
import { emptyFriendship, emptyProjects, emptyRiddles, emptyScuffles, type SavedFriendship, type SavedProjects, type SavedRiddles, type SavedScuffles } from '@monde/shared';
import type { RegistryLike } from '../fellow/state';
import { Clock } from '../sim/clock';
import { emptyLedger, encodeStory } from '../story/host';
import { PILLARS, createTownState, type Pillars, type TownState } from '../town/pillars';

export const SPRING_STYLES = ['strong', 'social', 'builder', 'lapsed', 'passive'] as const;
export type SpringStyle = (typeof SPRING_STYLES)[number];

interface Preset {
  pillars: Pillars;
  regard: Readonly<Record<string, number>>;
  /** Project id → the day it opened. */
  projects: Readonly<Record<string, number>>;
  scuffles: readonly { id: string; outcome: 'win' | 'loss'; day: number; zone: string }[];
  marks: readonly string[];
  /** S07: the clock runs (the Old Quarter chain) or chimed once on Bertrand's loan. */
  clock: 'runs' | 'loan';
  firstArrival: boolean;
}

const all = (ids: readonly string[], v: number): Record<string, number> => Object.fromEntries(ids.map(id => [id, v]));
const TALKED = ['odile', 'rosalind', 'margo', 'june', 'kasimir', 'teo', 'nell', 'bertrand', 'augusta', 'priya', 'felix', 'sable', 'pell', 'ada', 'hollis', 'delphine', 'ines'];

export const PRESETS: Readonly<Record<SpringStyle, Preset>> = {
  strong: {
    pillars: { prosperity: 32.4, safety: 41.7, spirit: 50.3, charm: 62 },
    regard: { ...all(TALKED, 24), ...all(['june', 'kasimir', 'teo', 'nell', 'bertrand', 'augusta', 'priya'], 30), tib: 18 },
    projects: { bakery_ovens: 4, fountain: 6, clocktower: 7, streetlights: 12, community_garden: 13, market_hall: 19 },
    scuffles: [{ id: 'sc_bakery_tutorial', outcome: 'win', day: 3, zone: 'market_row' }],
    marks: ['OQ-1', 'OQ-2', 'OQ-3', 'OQ-4', 'OQ-5', 'MR-1', 'MR-2', 'WF-1', 'WF-2'], clock: 'runs', firstArrival: true
  },
  social: {
    pillars: { prosperity: 18, safety: 26.7, spirit: 40.7, charm: 34 },
    regard: { ...all(TALKED, 58), ...all(['nell', 'bertrand', 'augusta', 'pell', 'ada', 'hollis', 'rosalind', 'margo'], 62), ...all(['june', 'kasimir', 'teo'], 52), tib: 30 },
    projects: { fountain: 6 }, scuffles: [], marks: ['OQ-1', 'OQ-2'], clock: 'loan', firstArrival: false
  },
  builder: {
    pillars: { prosperity: 32.4, safety: 38.7, spirit: 44.8, charm: 48 },
    regard: { ...all(TALKED, 3), ...all(['rosalind', 'margo', 'june', 'nell', 'bertrand', 'augusta'], 6), kasimir: 25, teo: 25, tib: 19 },
    projects: { bakery_ovens: 4, fountain: 6, streetlights: 12, community_garden: 13, market_hall: 19 },
    scuffles: [], marks: [], clock: 'loan', firstArrival: true
  },
  lapsed: {
    pillars: { prosperity: 20, safety: 19.7, spirit: 36.8, charm: 43 },
    regard: { ...all(TALKED, 6), ...all(['june', 'kasimir', 'teo', 'nell', 'bertrand', 'augusta', 'priya', 'felix', 'sable', 'pell'], 12) },
    projects: { bakery_ovens: 4, fountain: 6, clocktower: 7 },
    scuffles: [{ id: 'sc_bakery_tutorial', outcome: 'win', day: 3, zone: 'market_row' }, { id: 'sc_market_saturday', outcome: 'loss', day: 16, zone: 'market_row' }],
    marks: ['OQ-1', 'OQ-2', 'OQ-3', 'OQ-4', 'OQ-5', 'MR-1'], clock: 'runs', firstArrival: true
  },
  passive: {
    pillars: { prosperity: 18, safety: 26.7, spirit: 28.8, charm: 26 },
    regard: {}, projects: {}, scuffles: [], marks: [], clock: 'loan', firstArrival: false
  }
};

/** S01–S09 as played, with the flags their headers list (the clock's variant and S05 by the style). */
function storyFlags(p: Preset): { flags: string[]; completed: string[] } {
  const completed = ['s01a_ferry', 's01b_walk', 's01c_cottage', 's02_marks', 's03_tolls', 's04_water_again', ...(p.firstArrival ? ['s05_first_arrival'] : []),
    's06_good_coat', p.clock === 'runs' ? 's07a_chime_runs' : 's07b_chime_loan', 's08_option', 's09_pell_confession'];
  const flags = ['s01a_done', 'met_pell', 'met_moss', 'met_ada', 's01b_done', 'met_bertrand', 'saw_tollmen_idle', 's01c_done', 'cottage_keys_given',
    's02_done', 'met_margo', 'met_tib', 'marks_log_open', 'charter_claim_heard', 's03_done', 'met_rook', 'met_tollmen', 's04_done', 'met_kasimir',
    'fountain_started', ...(p.firstArrival ? ['s05_done', 'first_arrival_seen'] : ['s05_b_seen']), 's06_done', 'met_vane', 'met_ines', 's07_done', 'clock_chimed',
    ...(p.clock === 'runs' ? ['clock_running'] : ['clock_pending_pinion']), 's08_done', 'option_known', 'met_sable', 'sable_holds_story', 's09_done', 'pell_confessed',
    ...Object.keys(p.projects).map(id => `project_${id}_done`)];
  return { flags, completed };
}

/** Put a Day-`day` Spring of this style into the registry (clock at `minute`), before ZoneScene builds its clock and town. */
export function applySpringPreset(r: RegistryLike, style: SpringStyle, day = 25, minute = 9 * 60): void {
  const p = PRESETS[style];
  r.set('monde.clock', new Clock({ day, minute }));
  const base = createTownState({ day });
  const town: TownState = {
    ...base, pillars: { ...p.pillars }, dayStart: { ...p.pillars }, history: [{ day, pillars: { ...p.pillars } }],
    flags: { ...base.flags, option_known: true, ...('streetlights' in p.projects ? { project_streetlights_done: true } : {}) }
  };
  for (const pillar of PILLARS) town.pillars[pillar] = p.pillars[pillar];
  r.set('monde.town', town);

  const { flags, completed } = storyFlags(p);
  r.set('monde.story.flags', encodeStory({ version: 1, flags, completed, queue: [] }, emptyLedger()));

  const friendship: SavedFriendship = { ...emptyFriendship(), regard: { ...p.regard },
    residents: Object.fromEntries(Object.entries(p.regard).map(([id, regard]) => [id, { regard, source: 'server' as const, met_day: 2, last_talk_day: day - 1, likes: [] }])) };
  r.set('monde.friendship', friendship);

  const projects: SavedProjects = { ...emptyProjects(), applied: Object.keys(p.projects), projects: Object.fromEntries(Object.entries(p.projects).map(([id, opened]) => [id, {
    def: id, target: null, unlocked: Math.max(1, opened - 3), funded: Math.max(1, opened - 2), signed_by: 'pell' as const, materials: {}, vh: 6, player_vh: 4, volunteer_vh: 2,
    donors: [], material_donors: [], ceremony: null, opened, attendees: []
  }])) };
  r.set('monde.projects', projects);

  const scuffles: SavedScuffles = { ...emptyScuffles(), results: Object.fromEntries(p.scuffles.map(s => [`${s.id}:${s.day}`, { id: s.id, outcome: s.outcome, day: s.day, zone: s.zone }])) };
  r.set('monde.scuffles', scuffles);

  const riddles: SavedRiddles = { ...emptyRiddles(), entries: Object.fromEntries(p.marks.map((id, i) => [id, { status: 'solved' as const, foundAt: (2 + i * 2) * 1440 + 600, hints: 0, attempts: [] }])) };
  r.set('monde.riddles', riddles);
}

/** `?spring=<style>` in a dev build (or with `?dev`). */
export function springPresetFromQuery(query: URLSearchParams): SpringStyle | null {
  const style = query.get('spring');
  return style && (SPRING_STYLES as readonly string[]).includes(style) ? style as SpringStyle : null;
}
