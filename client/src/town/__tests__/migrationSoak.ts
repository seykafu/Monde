// The G-02 mock soak: Days 1–25 of the town engine with arrivals and departures, for a strong player, a passive one
// and one who lapses after a strong first week (MVP_PLAN G-02: "A 25-day mock soak produces plausible arrivals and
// departures"). Deterministic: a fixed world seed, scripted Pillar gains, and a fake model in place of Haiku.
//
// Each day: the town's dawn (runDawn), then the arrivals pass (town/people.ts migrationDawn: leavers, the Sunday house,
// Stay, today's boat), then the "server": a fake model writes each of today's households (its first answer to every
// third household fails validation and the retry fixes it, A.3.8), and they replace the local templates as the dawn
// package's would (adoptServerArrivals). The boat lands at 08:00 (bookArrivals), then the day's scripted events.
//
// Scripted gains are the town-engine soak's (soakScenarios.ts: §6.3, §8, §13, §14 numbers). Two things the soak has to
// stand in for are assumptions, not GDD numbers:
//   - friendships (G-13 encounters): a newcomer counts their household, plus one new friend in town for every 5 days
//     here while Spirit is 40 or more, every 9 days otherwise;
//   - the Last Chance Favor: the strong player completes every one the day before the boat; the others never do
//     (unless the run says otherwise, SoakOptions.lastChance).
import {
  ARCHETYPE_BY_ID, cardsFromHousehold, drawHousehold, livingArrivals, templateHousehold, validateHousehold,
  type ArrivalHousehold, type ArrivalHouseholdOutput, type HouseholdDraw
} from '@monde/shared';
import { weekdayOf } from '../../sim/clock';
import { loadCards, loadRegistry, loadZones } from '../../sim/__tests__/content';
import { homeBeds, homeName, townHomeKeys } from '../../world/townHomes';
import { computeAppeal } from '../appeal';
import { directoryFromCards, restoreHome } from '../occupancy';
import {
  adoptServerArrivals, arrivalFacts, bookArrivals, departureDay, migrationDawn, peopleOf, resolveNotice, type MigrationWorld
} from '../people';
import {
  applyPillarDelta, applyPillarDeltas, createTownState, setTollmenLevelMax, setTownFlag,
  type Pillar, type Pillars, type PillarSource, type TownFlag, type TownState
} from '../pillars';
import { runDawn } from '../townEngine';
import { tollmenBaseline } from './soakScenarios';

type Act = (s: TownState) => TownState;
const cw = (pillar: Pillar, amount: number, task: string): Act => s => applyPillarDelta(s, pillar, amount, 'community_work', task);
const gain = (source: PillarSource, deltas: Partial<Pillars>, note: string, flag?: TownFlag): Act =>
  s => { const t = applyPillarDeltas(s, deltas, source, note); return flag ? setTownFlag(t, flag) : t; };
/** The `homes` Project restores a house (§6.3), door and all: the Old Quarter's Bell Row first, then the Wharf. */
const HOUSE_ORDER = ['old_quarter.vacant_house_46', 'old_quarter.vacant_house_45', 'old_quarter.vacant_house_44', 'old_quarter.vacant_house_43', 'wharf.vacant_house_50', 'wharf.vacant_house_49', 'old_quarter.vacant_house_42'];
let restored = 0;
const restoreNext: Act = s => restoreHome(s, HOUSE_ORDER[restored++ % HOUSE_ORDER.length]!);

/** Steady community work for a strong player (soakScenarios.ts routine). */
const routine = (day: number): Act[] => [
  cw('charm', 0.5, 'Sweep Market Row'),
  ...(day >= 2 ? [cw('spirit', 0.3, 'Mail Round'), cw('charm', 0.2, 'Library Returns')] : []),
  ...(day >= 3 ? [cw('charm', 0.4, 'Litter pick')] : []),
  ...(day >= 8 ? [cw('prosperity', 0.3, 'Net Mending'), cw('charm', 0.4, 'Weeding')] : []),
  ...(day >= 12 ? [cw('spirit', 0.4, 'Tutor at school')] : []),
  ...(day >= 15 ? [cw('safety', 0.8, 'Night watch')] : [])
];
const STRONG_WEEK: Record<number, Act[]> = {
  1: [gain('riddle', { charm: 1 }, 'OQ-1')], 2: [gain('riddle', { charm: 1 }, 'OQ-2')],
  3: [gain('story', { safety: 1 }, 'S03 Tolls'), gain('scuffle', { safety: 2 }, 'sc_bakery_tutorial won')],
  4: [gain('project', { prosperity: 3 }, 'bakery_ovens', undefined), s => ({ ...s, flags: { ...s.flags, project_bakery_ovens_done: true } as TownState['flags'] })],
  5: [gain('riddle', { charm: 1 }, 'OQ-3')], 6: [gain('project', { charm: 6, spirit: 2 }, 'fountain')],
  7: [gain('riddle', { charm: 1 }, 'OQ-4'), gain('riddle', { charm: 1 }, 'OQ-5'), gain('riddle', { spirit: 3 }, 'OQ chain complete'),
    gain('project', { charm: 5 }, 'clocktower (PZ-15)'), gain('story', { spirit: 4 }, 'S07 Quarter Chime (A)')],
  8: [gain('story', { spirit: 3, charm: 1 }, 'S05 First Arrival')], 9: [gain('riddle', { charm: 1 }, 'MR-1')]
};
const STRONG: Record<number, Act[]> = {
  ...STRONG_WEEK,
  11: [restoreNext], 12: [gain('project', { safety: 6, charm: 2 }, 'streetlights', 'project_streetlights_done')],
  13: [gain('project', { spirit: 3, charm: 2 }, 'community_garden'), s => ({ ...s, flags: { ...s.flags, project_community_garden_done: true } as TownState['flags'] })],
  14: [restoreNext, gain('riddle', { charm: 1 }, 'MR-2')], 17: [restoreNext],
  19: [gain('project', { prosperity: 6, spirit: 3 }, 'market_hall')], 20: [restoreNext, gain('riddle', { charm: 1 }, 'WF-1')],
  23: [restoreNext], 24: [gain('riddle', { charm: 1 }, 'WF-2')]
};
const PASSIVE: Record<number, Act[]> = { 14: [gain('story', { spirit: 2, charm: 1 }, 'S07 Quarter Chime (B)')] };
/**
 * A strong first week and two houses paid for (the `homes` Project, Days 9 and 10), then the player stops: no work, no
 * more Projects, and the Tollmen have their way (§6.1 incidents −1 to −3 Safety, a lost Scuffle, a public argument).
 */
const LAPSED: Record<number, Act[]> = {
  ...STRONG_WEEK,
  9: [...STRONG_WEEK[9]!, restoreNext],
  10: [restoreNext],
  13: [gain('tollmen', { safety: -3, prosperity: -0.5 }, 'a Tollmen incident on Market Row')],
  16: [gain('scuffle', { safety: -2 }, 'sc_market_saturday lost'), gain('event', { spirit: -2 }, 'a public argument at the pub')],
  19: [gain('tollmen', { safety: -3, prosperity: -0.5 }, 'a Tollmen incident at the Wharf')],
  22: [gain('tollmen', { safety: -2 }, 'Tollmen at the Saturday stalls')]
};

/**
 * G-11 (the Straw Poll soak, finale/__tests__/springSoak.ts): a builder who puts every coin and hour into the Projects
 * and the homes (two more houses than the strong player) and does the community work, but skips the Marks and the
 * fight, so the clock restarts on Day 14 with the borrowed chime (S07 B).
 */
const BUILDER: Record<number, Act[]> = {
  4: STRONG_WEEK[4]!, 6: STRONG_WEEK[6]!, 9: [restoreNext], 10: [restoreNext], 11: [restoreNext],
  12: STRONG[12]!, 13: STRONG[13]!, 14: [restoreNext, ...PASSIVE[14]!], 17: [restoreNext],
  19: STRONG[19]!, 20: [restoreNext], 23: [restoreNext]
};
/**
 * G-11: a social player who spends the days talking (finale/__tests__/springSoak.ts has their Regard). In the town's
 * numbers: the two Marks people point them to, the fountain the town pitches in for, the borrowed chime, and the
 * sociable community work (socialRoutine).
 */
const SOCIAL: Record<number, Act[]> = {
  2: [gain('riddle', { charm: 1 }, 'OQ-1')], 5: [gain('riddle', { charm: 1 }, 'OQ-2')],
  6: STRONG_WEEK[6]!, 14: PASSIVE[14]!
};
/** §8 for the social player: the Mail Round every day, tutoring from Day 12, and hosting Roz's quiz on Thursdays. */
const socialRoutine = (day: number): Act[] => [
  ...(day >= 2 ? [cw('spirit', 0.3, 'Mail Round')] : []),
  ...(day >= 12 ? [cw('spirit', 0.4, 'Tutor at school')] : []),
  ...(day >= 14 && weekdayOf(day) === 'Thu' ? [cw('spirit', 0.8, 'Pub quiz host')] : [])
];
/** Who does community work every day, and which. */
const ROUTINES: Readonly<Record<string, (day: number) => Act[]>> = { strong: routine, builder: routine, social: socialRoutine };

export const MIGRATION_SCENARIOS = { strong: STRONG, passive: PASSIVE, lapsed: LAPSED, social: SOCIAL, builder: BUILDER } as const;
export type MigrationScenario = keyof typeof MIGRATION_SCENARIOS;

export interface MigrationSoakDay {
  day: number; weekday: string; appeal: number; pillars: Pillars;
  households: number; people: number; arrived: string[]; notices: string[]; leaving: string[]; departed: string[];
  census: number; freeHomes: number; generated: number;
}
export interface MigrationSoakResult {
  days: MigrationSoakDay[];
  firstArrivalDay: number | null;
  households: ArrivalHousehold[];
  people: number;
  archetypes: Record<string, number>;
  notices: number;
  departures: number;
  savedByLastChance: number;
  /** Households the fake model wrote (and how many needed the retry), and template fallbacks. */
  model: number; retried: number; templates: number;
  final: TownState;
}

/** The fake model (A.3.6): a household in the contract's shape, in its own words; every third first answer is broken. */
function fakeModel(draw: HouseholdDraw, attempt: number, n: number, residents: ReadonlyMap<string, { name: string }>): ArrivalHouseholdOutput {
  const out = structuredClone(templateHousehold(draw, { residents }, `model-${n}`));
  out.members.forEach(m => {
    m.backstory = `${m.name.split(' ')[0]} spent eleven winters in ${['Carrow', 'Port Sallow', 'Hessle Cross'][n % 3]} and was sure the sea here would be colder. It isn't, much. Came for a door that closes properly.`;
    m.voice.samples = ["Can't say I mind the wind.", "That's the third gull today. They've a system.", "Right. I'll put the kettle on."];
  });
  if (n % 3 === 0 && attempt === 1) out.members[0]!.name = 'Odile Fournier'; // V03: the validator sends it back
  return out;
}

export interface SoakOptions {
  /** The world seed (A.3.1). */
  seed?: number;
  /** Does the player do every Last Chance Favor in time? Default: only the strong player. */
  lastChance?: boolean;
}

export function runMigrationSoak(name: MigrationScenario, lastDay = 25, opts: SoakOptions = {}): MigrationSoakResult {
  const seed = opts.seed ?? 2026;
  const lastChance = opts.lastChance ?? name === 'strong';
  restored = 0;
  const cards = loadCards();
  const dir = directoryFromCards(cards);
  const places = new Set(Object.entries(loadRegistry()).flatMap(([zone, ids]) => ids.map(id => `${zone}.${id}`)));
  const script = MIGRATION_SCENARIOS[name];
  let friendsOf = (_id: string) => 0;
  const world: MigrationWorld = {
    seed, homes: townHomeKeys(loadZones(), dir), dir, beds: homeBeds, homeName, storyFlags: new Set(),
    cast: new Map(cards.map(c => [c.id, { name: c.name }])), friends: id => friendsOf(id), regard: () => 0
  };
  let s = createTownState();
  const days: MigrationSoakDay[] = [];
  const all: ArrivalHousehold[] = [];
  let firstArrivalDay: number | null = null, notices = 0, departures = 0, saved = 0, model = 0, retried = 0, templates = 0, n = 0;
  for (let day = 1; day <= lastDay; day++) {
    let arrived: string[] = [], given: string[] = [], leaving: string[] = [], departed: string[] = [], households = 0, people = 0;
    if (day > 1) {
      const { state, report } = runDawn(s, { day });
      // Friends in town: their household, and one more for every few days here (see the head of this file).
      friendsOf = id => {
        const r = livingArrivals(state.people).find(x => x.card.id === id);
        if (!r) return 0;
        const kin = livingArrivals(state.people).filter(x => x.household === r.household && x.card.id !== id).length;
        return kin + Math.floor((day - r.arrived_day) / (state.pillars.spirit >= 40 ? 5 : 9));
      };
      const dawn = migrationDawn(state, day, world, { decision: report.arrivals });
      s = dawn.state;
      given = dawn.notices.map(x => x.resident); leaving = dawn.leaving; departed = dawn.departed.map(d => d.id);
      notices += given.length; departures += departed.length;
      // The server writes today's households with the (fake) model and the client adopts them before 08:00.
      if (dawn.arriving.length) {
        const names = new Map([...world.cast, ...livingArrivals(s.people).map(r => [r.card.id, { name: r.card.name }] as const)]);
        const facts = arrivalFacts(s, { ...peopleOf(s), pending: peopleOf(s).pending.filter(h => h.day !== day) }, world, day);
        const server: ArrivalHousehold[] = [];
        dawn.arriving.forEach((local, slot) => {
          const draw = drawHousehold({ seed: `server-${seed}`, day, slot, facts, youthShare: report.arrivals.youthShare, recent: [], alive: new Map(), portraitUses: new Map(),
            archetype: local.archetype as never })!;
          let output: ArrivalHouseholdOutput | null = null;
          n++;
          for (let attempt = 1; attempt <= 3 && !output; attempt++) {
            const v = validateHousehold(fakeModel(draw, attempt, n, names), draw, { places, residents: names });
            if (v.ok) { output = v.output; if (attempt > 1) retried++; }
          }
          const source = output ? 'model' : 'template';
          if (output) model++; else { templates++; output = templateHousehold(draw, { residents: names }, 2026); }
          const built = cardsFromHousehold(output, draw, new Set(names.keys()), local.home);
          for (const b of built) names.set(b.card.id, { name: b.card.name });
          server.push({ id: `srv_${draw.id}`, archetype: draw.archetype, day, home: local.home, summary: output.household.summary, generated_by: source,
            residents: built.map(b => ({ card: b.card, household: `srv_${draw.id}`, archetype: draw.archetype, arrived_day: day, dream_template: b.dream_template })) });
        });
        s = adoptServerArrivals(s, day, server);
      }
      const landed = bookArrivals(s, day, 8 * 60);
      s = landed.state;
      households = landed.booked.length;
      people = landed.booked.reduce((sum, h) => sum + h.residents.length, 0);
      arrived = landed.booked.flatMap(h => h.residents.map(r => `${r.card.name} (${r.card.age}, ${h.archetype})`));
      all.push(...landed.booked);
      if (households) firstArrivalDay ??= day;
    }
    // A player who does every Last Chance Favor does it the day before the boat (§6.4: "done in time, they stay").
    if (lastChance) {
      for (const [id, givenDay] of Object.entries(s.migration.notices)) {
        if (departureDay(givenDay, s.flags) - 1 === day) { s = resolveNotice(s, id, day); saved++; }
      }
    }
    const a = computeAppeal(s);
    days.push({
      day, weekday: weekdayOf(day), appeal: Math.round(a.appeal * 10) / 10, pillars: { ...s.pillars }, households, people, arrived,
      notices: given, leaving, departed, census: s.census, freeHomes: s.homes.restored_free, generated: livingArrivals(s.people).length
    });
    s = setTollmenLevelMax(s, tollmenBaseline(day));
    for (const act of [...(script[day] ?? []), ...(ROUTINES[name]?.(day) ?? [])]) s = act(s);
  }
  const archetypes: Record<string, number> = {};
  for (const h of all) archetypes[h.archetype] = (archetypes[h.archetype] ?? 0) + 1;
  return {
    days, firstArrivalDay, households: all, people: all.reduce((sum, h) => sum + h.residents.length, 0), archetypes,
    notices, departures, savedByLastChance: saved, model, retried, templates, final: s
  };
}

/** One line per day, for the report. */
export const soakTable = (r: MigrationSoakResult): string => r.days.map(d =>
  `D${String(d.day).padStart(2)} ${d.weekday} appeal ${d.appeal.toFixed(1).padStart(4)} census ${d.census} free ${d.freeHomes}` +
  (d.arrived.length ? ` | in: ${d.arrived.join('; ')}` : '') + (d.notices.length ? ` | notice: ${d.notices.join(', ')}` : '') +
  (d.leaving.length ? ` | to the slip: ${d.leaving.join(', ')}` : '') + (d.departed.length ? ` | left: ${d.departed.join(', ')}` : '')).join('\n');

export const archetypeLabel = (id: string): string => ARCHETYPE_BY_ID.get(id as never)?.label ?? id;
