// The Bloom Fair on the Commons (GDD §3.3 "D25 Bloom Fair", §13.2 Days 24–25, §13.3 S10a/S10b; MVP G-11). Pure: what the
// Commons wears and who is there, by day, hour and the fair's band. finale/attach.ts draws it and books the plans.
//
// Turnout and mood come from Spirit (§3.3): S10a's bands (Spirit < 35 low, < 60 mid, else high) and §13.3a's headcounts
// 31 / 73 / 190. The scripts' cast is always there: Pell with the ribbon, June on Kasimir's flatbed, Roz at the cider
// tent, Odile's buns, Teo's seedlings, Nell's herring, Tib's riddle trail, Margo at the Marks table, and at dusk Hollis,
// Bertrand and Felix. Everyone else comes in proportion to the headcount.
import { FAIR_HEADCOUNT, seededUnit, type FairBand } from '@monde/shared';
import { minutesToHhmm } from '../sim/plans';
import type { Shift } from '../sim/volunteers';

export const FAIR_DAY = 25;
/** §13.2 Day 24: "Fair set-up on the Commons". GDD-GAP: no hour; the trestles go up after lunch. */
export const SETUP_DAY = 24;
export const SETUP_FROM = 14 * 60;
/** S10a's window opens at 12:00; S10b's runs 17:30–21:00 ("Closing at sunset"). */
export const FAIR_OPEN = 12 * 60;
export const FAIR_DUSK = 17 * 60 + 30;
export const FAIR_CLOSE = 21 * 60;
/** GDD-GAP: when the lawn empties. S10b closes at sunset; people stay for the Straw Poll and the lamps (S10b: "until the last one gutters"). */
export const FAIR_LINGER = 22 * 60;
/** GDD-GAP: when the folded fair is cleared away. The oil lamps burn until the Straw Poll is counted and the lawn empties. */
export const FAIR_CLEARED = 24 * 60;

export type FairPhase = 'none' | 'setup' | 'morning' | 'fair' | 'dusk';
export function fairPhase(day: number, minute: number): FairPhase {
  if (day === SETUP_DAY) return minute >= SETUP_FROM ? 'setup' : 'none';
  if (day !== FAIR_DAY) return 'none';
  if (minute < FAIR_OPEN) return 'morning';
  if (minute < FAIR_DUSK) return 'fair';
  return minute < FAIR_CLEARED ? 'dusk' : 'none';
}

/** The fair's music (A-10 `bloom_fair`) on the Commons while it's open: S10a's ribbon to S10b's last song. */
export const fairMusic = (zone: string, day: number, minute: number): boolean =>
  zone === 'commons' && day === FAIR_DAY && minute >= FAIR_OPEN && minute < FAIR_CLOSE;

// ── Dressing ─────────────────────────────────────────────────────────────────

export interface Dressing {
  sprite: string;
  at: readonly [number, number];
  /** First phase it is up in (setup < morning < fair). */
  from: Exclude<FairPhase, 'none' | 'dusk'>;
  /** The fewest-stall band it shows in (S10a: seven stalls / a dozen / twenty). */
  band?: FairBand;
  flip?: boolean;
}

const PHASES: readonly FairPhase[] = ['setup', 'morning', 'fair', 'dusk'];
const BANDS: readonly FairBand[] = ['low', 'mid', 'high'];

/**
 * The Commons in fair dress (existing town sprites; tiles on content/zones/commons.zone.yaml's lawns, off the paths):
 * stalls up the avenue and round the sundial lawn, bunting across the avenue and the sundial path, the cider barrels,
 * crates and a handcart by the bandstand, and extra picnic tables on the lawn. Art placement, not a game rule.
 */
export const DRESSING: readonly Dressing[] = [
  // The trestles that go up on Day 24.
  { sprite: 'market_stall', at: [26, 28], from: 'setup' },
  { sprite: 'market_stall', at: [33, 28], from: 'setup' },
  { sprite: 'market_stall', at: [26, 32], from: 'setup', flip: true },
  { sprite: 'crates', at: [28, 27], from: 'setup' },
  { sprite: 'crates', at: [25, 30], from: 'setup' },
  { sprite: 'handcart', at: [36, 22], from: 'setup' },
  // Fair morning: the bunting and the cider tent's barrels.
  { sprite: 'bunting', at: [30, 26], from: 'morning' },
  { sprite: 'bunting', at: [30, 32], from: 'morning' },
  { sprite: 'barrel', at: [24, 30], from: 'morning' },
  { sprite: 'barrel', at: [24, 31], from: 'morning' },
  { sprite: 'flower_pots', at: [28, 34], from: 'morning' },
  { sprite: 'flower_pots', at: [32, 34], from: 'morning' },
  // A dozen stalls (mid) and twenty (high): more trestles, more bunting, more tables.
  { sprite: 'market_stall', at: [33, 32], from: 'fair', band: 'mid' },
  { sprite: 'market_stall', at: [10, 28], from: 'fair', band: 'mid' },
  { sprite: 'bunting', at: [18, 27], from: 'fair', band: 'mid' },
  { sprite: 'bunting', at: [30, 29], from: 'fair', band: 'mid' },
  { sprite: 'picnic_table', at: [36, 29], from: 'fair', band: 'mid' },
  { sprite: 'market_stall', at: [10, 31], from: 'fair', band: 'high' },
  { sprite: 'market_stall', at: [42, 28], from: 'fair', band: 'high' },
  { sprite: 'market_stall', at: [41, 33], from: 'fair', band: 'high', flip: true },
  { sprite: 'bunting', at: [18, 34], from: 'fair', band: 'high' },
  { sprite: 'bunting', at: [30, 35], from: 'fair', band: 'high' },
  { sprite: 'picnic_table', at: [26, 24], from: 'fair', band: 'high' },
  { sprite: 'barrel', at: [44, 31], from: 'fair', band: 'high' }
];

/** What stands on the Commons now. */
export function dressingFor(phase: FairPhase, band: FairBand): Dressing[] {
  if (phase === 'none') return [];
  const at = PHASES.indexOf(phase);
  return DRESSING.filter(d => PHASES.indexOf(d.from) <= at && BANDS.indexOf(d.band ?? 'low') <= BANDS.indexOf(band));
}

/**
 * S10b: "Somebody has lit oil lamps along the sundial path." Eight of them (Pell: "Eight lamps lit, out of eight"), on
 * the sundial lawn's ring path (rows 27 and 34, columns 13 and 23), lit from dusk.
 */
export const OIL_LAMPS: readonly (readonly [number, number])[] = [[13, 27], [18, 27], [23, 27], [13, 30], [23, 30], [13, 34], [18, 34], [23, 34]];
export const lampsLit = (phase: FairPhase): boolean => phase === 'dusk';

// ── Who comes ────────────────────────────────────────────────────────────────

/** The scripts' cast and stallholders (S10a/S10b): at the fair whatever the band. */
export const FAIR_CAST: readonly string[] = ['pell', 'june', 'kasimir', 'teo', 'margo', 'tib', 'rosalind', 'odile', 'nell', 'hollis', 'bertrand', 'felix', 'bastien'];
/** Residents who aren't at the fair: Vane sends tulips (§13.2: "Gift: a crate of tulips"); Rook calls a truce. */
export const NOT_AT_FAIR: ReadonlySet<string> = new Set(['vane', 'rook', 'bru', 'nettie']);
/** §13.3a headcounts over the census (210): the share of everyone else who comes. */
export const attendShare = (band: FairBand): number => Math.min(1, FAIR_HEADCOUNT[band] / 210);

export function fairAttendees(residents: readonly string[], band: FairBand, seed: number | string): string[] {
  return residents.filter(id => !NOT_AT_FAIR.has(id)
    && (FAIR_CAST.includes(id) || seededUnit('bloom-fair', seed, id) < attendShare(band)));
}

/** Tile areas on the Commons (content/zones/commons.zone.yaml): where each kind of fairgoer stands. */
export const FAIR_AREAS = {
  ribbon: { place: 'commons.sundial_lawn', area: [15, 28, 7, 5] },
  sundial: { place: 'commons.sundial_lawn', area: [13, 27, 11, 8] },
  avenue: { place: 'commons.old_elm', area: [24, 26, 12, 9] },
  picnic: { place: 'commons.picnic_lawn', area: [34, 24, 11, 10] },
  bandstand: { place: 'commons.bandstand', area: [24, 19, 13, 7] },
  cider: { place: 'commons.sundial_lawn', area: [24, 29, 2, 3] },
  stalls: { place: 'commons.old_elm', area: [25, 27, 10, 6] },
  elm: { place: 'commons.old_elm', area: [21, 24, 7, 5] }
} as const satisfies Record<string, { place: string; area: readonly [number, number, number, number] }>;
type AreaName = keyof typeof FAIR_AREAS;

const shift = (resident: string, action: Shift['action'], where: AreaName, start: number, end: number, note: string): Shift =>
  ({ resident, action, place: FAIR_AREAS[where].place, area: FAIR_AREAS[where].area, startMin: start, endMin: end, note });

/** Who does what, where (S10a, S10b): stallholders at their trestles, June on the tailgate, everyone else about the lawns. */
const ROLES: Readonly<Record<string, (open: number, dusk: number, close: number) => Shift[]>> = {
  pell: (o, d, c) => [shift('pell', 'attend', 'ribbon', o, o + 120, 'Cutting the Bloom Fair ribbon'), shift('pell', 'wander', 'sundial', o + 120, d, 'At the Bloom Fair'), shift('pell', 'attend', 'bandstand', d, c, 'Thanking everyone from the crate')],
  june: (o, d, c) => [shift('june', 'play_music', 'bandstand', o, o + 120, 'Playing on the tailgate'), shift('june', 'wander', 'avenue', o + 120, d, 'At the Bloom Fair'), shift('june', 'play_music', 'bandstand', d, c, 'Playing the closing set')],
  kasimir: (o, d, c) => [shift('kasimir', 'work', 'bandstand', o, c, 'Minding the flatbed stage')],
  rosalind: (o, d, c) => [shift('rosalind', 'work', 'cider', o, d, 'Serving cider at the fair tent'), shift('rosalind', 'attend', 'bandstand', d, c, 'At the back, arms folded')],
  odile: (o, d, c) => [shift('odile', 'work', 'stalls', o, d, 'Selling buns at the fair'), shift('odile', 'attend', 'bandstand', d, c, 'Listening to June')],
  nell: (o, d, c) => [shift('nell', 'work', 'stalls', o, d, 'Selling herring in paper cones'), shift('nell', 'attend', 'bandstand', d, c, 'Listening to June')],
  teo: (o, d, c) => [shift('teo', 'work', 'picnic', o, d, 'Selling seedlings at the swap table'), shift('teo', 'attend', 'bandstand', d, c, 'Listening to June')],
  margo: (o, d, c) => [shift('margo', 'work', 'ribbon', o, d, 'Minding the Marks table'), shift('margo', 'attend', 'bandstand', d, c, 'Listening to June')],
  tib: (o, d, c) => [shift('tib', 'wander', 'elm', o, d, "Running the riddle trail"), shift('tib', 'wander', 'sundial', d, c, 'Finishing the riddle trail')]
};

/**
 * The fair's plan blocks for Day 25 (spliced into the day plans like a Project's volunteers, sim/volunteers.ts): from
 * the ribbon to the lamps burning down. Everyone without a role strolls the lawns by day and gathers at the bandstand at
 * dusk.
 */
export function fairShifts(attendees: readonly string[], seed: number | string): Shift[] {
  const out: Shift[] = [];
  const lawns: AreaName[] = ['sundial', 'avenue', 'picnic', 'elm'];
  for (const id of attendees) {
    const role = ROLES[id];
    if (role) { out.push(...role(FAIR_OPEN, FAIR_DUSK, FAIR_LINGER)); continue; }
    // Some come for the ribbon, some after lunch; everyone stays for June.
    const arrive = FAIR_OPEN + Math.floor(seededUnit('fair-arrive', seed, id) * 4) * 30;
    const lawn = lawns[Math.floor(seededUnit('fair-lawn', seed, id) * lawns.length)]!;
    out.push(shift(id, seededUnit('fair-stroll', seed, id) < 0.5 ? 'wander' : 'socialize', lawn, arrive, FAIR_DUSK, 'At the Bloom Fair'));
    out.push(shift(id, 'attend', 'bandstand', FAIR_DUSK, FAIR_LINGER, "Listening to June's set"));
  }
  return out;
}

/** A stable key for the day's fair shifts (ResidentSim rebuilds its plans when it changes). */
export const fairKey = (band: FairBand, attendees: readonly string[]): string => `fair:${band}:${attendees.join(',')}`;

/** For logs and the dev tools. */
export const describeShift = (s: Shift): string => `${s.resident} ${s.action} ${s.place} ${minutesToHhmm(s.startMin)}–${minutesToHhmm(s.endMin)}`;
