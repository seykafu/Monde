// The town's sprites (GDD §16.4, MVP A-03): what client/public/assets/town/manifest.json says about each one,
// plus the little the art can't say for itself (where its chimneys are, which footprint column its door is
// in, how much ground a tree's trunk blocks, whether it is a light). Pure: no Phaser, no DOM.
//
// Contract (scripts/art/export_town.py): sizes are world px at the characters' scale; a building stands with
// its bottom-centre on the middle of its footprint's FRONT edge, a prop on the middle of its base tile.

import manifestJson from '../../public/assets/town/manifest.json';
import type { LetterStyle } from '../render/town/lettering';
import { occupiedFlag } from '../town/occupancy';

export type SpriteState = 'restored' | 'faded';

export interface SpriteEntry {
  kind: 'building' | 'prop';
  /** World px. */
  w: number;
  h: number;
  /** Buildings: [width, depth] in tiles. */
  foot?: readonly [number, number];
  /** Props: drawn width in tiles. */
  width?: number;
  states: readonly SpriteState[];
}

export type TownManifest = Readonly<Record<string, SpriteEntry>>;

export const TOWN_MANIFEST: TownManifest = manifestJson as unknown as TownManifest;

/** The texture file (and Phaser texture key suffix) for a sprite in a state: `bakery`, `fountain__faded`. */
export const spriteFile = (id: string, state: SpriteState): string => (state === 'faded' ? `${id}__faded` : id);

export interface SpriteMeta {
  /**
   * Props: the ground it blocks, [width, depth] in tiles, centred across the base tile and running back
   * (north) from it. [0, 0]: walk-through (tufts, reeds, bunting). Default [1, 1].
   */
  block?: readonly [number, number];
  /** Fades to see-through while the player is behind it (§16.4). Every building does; tall props opt in. */
  fade?: boolean;
  /** Floats: it may stand on water (boats, buoys, lilies, ducks); it may not stand on land unless `shore`. */
  water?: boolean;
  /** May stand on water or land (a beached rowboat, the footbridge). */
  shore?: boolean;
  /** Hangs overhead, drawn above the people (bunting), lifted this many px off the ground. */
  overhead?: number;
  /** Leans in the wind: degrees at a full gale. */
  sway?: number;
  /** A light (lamp posts): the flame, px from the sprite's base point, and the pool's reach. */
  light?: { dx: number; dy: number; radius: number };
  /** Chimney tops, px from the sprite's top-left: smoke rises from here while someone lives inside. */
  chimneys?: readonly (readonly [number, number])[];
  /** Buildings: the footprint column (from the left, 0-based) the drawn door is in. Default the middle. */
  door?: number;
  /** Nobody lives or works inside after dark: no lit windows, no smoke. */
  unlit?: boolean;
  /** No sun shadow: lies flat on the ground or on the water. */
  flat?: boolean;
  /** Drawn on the ground, under the people walking over it (the footbridge's deck, lilies). */
  under?: boolean;
  /** The Project (GDD §6.3) whose completion turns its faded art restored (state: auto). */
  project?: string;
  /** Story flags that also mean it is restored (the projects' own flags, §13.6). */
  restoredBy?: readonly string[];
  /** Buildings: a house. Scenery houses must say who lives there (zone `home:`; town/occupancy.ts). */
  dwelling?: boolean;
  /** Buildings: where a datestone goes over the door, px from the sprite's top-left; `plain` carves the year straight into the stone. */
  lintel?: { x: number; y: number; plain?: boolean };
  /** Buildings: the sign panel a zone's `sign:` is lettered on (its centre, px), and in what. */
  sign?: { x: number; y: number; style: LetterStyle };
  /** Buildings: where a zone's `number:` plate goes (its centre, px). */
  plate?: readonly [number, number];
  /** Props: the panel a zone's `text:` is lettered on (its centre, px), and in what. */
  letter?: { x: number; y: number; style: LetterStyle };
}

// Chimney tops and door columns were read off the art (scratch contact sheets with the footprint grid drawn
// over each building); `block` sizes match each prop's trunk, base or legs, not its canopy.
export const SPRITE_META: Readonly<Record<string, SpriteMeta>> = {
  // ── buildings ──
  augusta_house: { chimneys: [[80, 2]], door: 0, dwelling: true },
  bakery: { chimneys: [[132, 22]], door: 2 },
  bandstand: { door: 1, unlit: true, project: 'bandstand', restoredBy: ['bandstand_rebuilt'] },
  bertrand_house: { chimneys: [[85, 2]], door: 0, dwelling: true },
  boathouse: { door: 1, unlit: true },
  bunkhouse: { chimneys: [[163, 1]], door: 2, dwelling: true },
  cafe_liss: { chimneys: [[45, 2]], door: 1 },
  cannery: { chimneys: [[280, 8]], door: 2, project: 'cannery_coop', restoredBy: ['cannery_coop'] },
  clocktower: { door: 0, unlit: true, lintel: { x: 40, y: 271 } },
  constabulary: { chimneys: [[147, 10]], door: 1, lintel: { x: 76, y: 101, plain: true } },
  fish_market: { door: 2, unlit: true },
  founders_house: { chimneys: [[80, 8]], door: 1, unlit: true, lintel: { x: 79, y: 146 } },
  garden_shed: { door: 1, unlit: true },
  general_store: { chimneys: [[52, 3], [184, 2]], door: 1 },
  glasshouse: { door: 2, unlit: true, project: 'glasshouse', restoredBy: ['glasshouse_repaired'] },
  gull_and_anchor: { chimneys: [[36, 1], [167, 1]], door: 2 },
  harbormaster_house: { chimneys: [[22, 36], [144, 36]], door: 1, dwelling: true },
  // GDD-GAP: §11.5 has the cottage "in rough shape" and its roof fixed by a personal upgrade, with no flag
  // named; `project_cottage_roof_done` (the declared project_<id>_done pattern) restores its art.
  lamplighter_cottage: { chimneys: [[146, 5]], door: 2, project: 'cottage_roof', dwelling: true },
  lantern_office: { chimneys: [[116, 4]], door: 2, lintel: { x: 110, y: 116 } },
  library: { chimneys: [[41, 6], [210, 6]], door: 2, lintel: { x: 125, y: 126 } },
  lighthouse: { door: 1, unlit: true, project: 'lighthouse' },
  market_hall: { door: 2, unlit: true, project: 'market_hall' },
  nell_cottage: { chimneys: [[35, 2]], door: 1, dwelling: true },
  okafor_house: { chimneys: [[23, 2]], door: 0, dwelling: true, lintel: { x: 37, y: 120 } },
  pell_house: { chimneys: [[23, 2]], door: 0, dwelling: true, lintel: { x: 30, y: 115 } },
  st_brigids: { door: 1, unlit: true, lintel: { x: 85, y: 95 } },
  storefront_a: { chimneys: [[23, 2]], door: 1, sign: { x: 64, y: 99, style: 'ghost' }, plate: [97, 121] },
  storefront_b: { chimneys: [[24, 2]], door: 2, sign: { x: 65, y: 99, style: 'ghost' }, plate: [90, 125] },
  storefront_c: { chimneys: [[84, 2]], door: 2, sign: { x: 62, y: 101, style: 'ghost' }, plate: [96, 124] },
  teo_cottage: { chimneys: [[37, 2]], door: 2, dwelling: true },
  ticket_booth: { door: 0, unlit: true },
  town_hall: { door: 3, lintel: { x: 126, y: 130 } },
  townhouse_a: { chimneys: [[20, 1]], door: 1, dwelling: true },
  townhouse_b: { chimneys: [[18, 1]], door: 1, dwelling: true },
  townhouse_c: { chimneys: [[23, 3]], door: 0, dwelling: true },
  townhouse_d: { chimneys: [[81, 2]], door: 1, dwelling: true },
  // Vane drives in Tue/Thu/Sat 10:00–17:00 (§9.5): nobody there after dark.
  vane_office: { door: 1, unlit: true },
  wharf_cottage: { chimneys: [[24, 2]], door: 0, dwelling: true },
  // ── trees and plants ──
  oak: { block: [1, 1], fade: true, sway: 1.2 },
  birch: { block: [1, 1], fade: true, sway: 1.6 },
  pine: { block: [1, 1], fade: true, sway: 0.8 },
  willow: { block: [1, 1], fade: true, sway: 1.8 },
  apple_tree: { block: [1, 1], fade: true, sway: 1.2 },
  old_elm: { block: [2, 1], fade: true, sway: 0.6 },
  bush_round: { block: [1, 1] },
  bush_flowering: { block: [1, 1] },
  hedge: { block: [1, 1] },
  flowerbed: { block: [1, 1] },
  tall_grass: { block: [0, 0], sway: 9 },
  reeds: { block: [0, 0], sway: 7, shore: true },
  lilypads: { block: [0, 0], water: true, flat: true, under: true },
  rock: { block: [1, 1] },
  planter: { block: [1, 1] },
  flower_pots: { block: [1, 1] },
  veg_bed: { block: [2, 1], project: 'community_garden' },
  // ── street furniture ──
  lamp_post: { block: [1, 1], fade: true, light: { dx: 0, dy: -100, radius: 120 } },
  bench: { block: [1, 1] },
  barrel: { block: [1, 1] },
  crates: { block: [1, 1] },
  handcart: { block: [1, 1] },
  signpost: { block: [1, 1] },
  postbox: { block: [1, 1] },
  well: { block: [1, 1] },
  notice_board: { block: [1, 1] },
  bicycle: { block: [1, 1] },
  fence: { block: [1, 1] },
  stone_wall: { block: [1, 1] },
  market_stall: { block: [2, 1], project: 'market_hall' },
  bunting: { block: [0, 0], overhead: 78, flat: true },
  picnic_table: { block: [2, 1] },
  // ── landmarks ──
  fountain: { block: [3, 2], project: 'fountain' },
  sundial: { block: [1, 1] },
  footbridge: { block: [0, 0], shore: true, flat: true, under: true },
  crane: { block: [2, 2], fade: true, project: 'cannery_coop', restoredBy: ['cannery_coop'] },
  // ── the wharf ──
  rowboat: { block: [0, 0], water: true, shore: true },
  fishing_boat: { block: [0, 0], water: true },
  bollard: { block: [1, 1] },
  net_rack: { block: [2, 1] },
  lobster_pots: { block: [1, 1] },
  fish_crates: { block: [1, 1] },
  buoy: { block: [0, 0], water: true },
  anchor: { block: [1, 1] },
  // ── riddle objects (GDD §14): the chapel gate's old bell (OQ-1), the public scale (MR-1), the Commons gate post (CM-1) ──
  old_bell: { block: [1, 1] },
  public_scale: { block: [1, 1] },
  gate_pillar: { block: [1, 1] },
  // ── riddle details (town fixes): the Marks, and what the Spring riddles name. Wall-hung things lie flat (no
  // ground shadow); lettered panels are set in code (render/town/lettering.ts) ──
  mark_plaque: { block: [0, 0], flat: true },
  watch_sign: { block: [0, 0], flat: true },
  herring_vane: { block: [0, 0], flat: true },
  datestone: { block: [0, 0], flat: true, letter: { x: 14, y: 9, style: 'carved' } },
  lantern_pane: { block: [0, 0], flat: true },
  clock_window: { block: [0, 0], flat: true },
  welcome_sign: { block: [2, 1], letter: { x: 50, y: 30, style: 'painted' } },
  brass_stone: { block: [1, 1] },
  foundation_stone: { block: [0, 0] },
  gannet: { block: [0, 0], water: true, letter: { x: 182, y: 100, style: 'hull' } },
  // ── interiors (W-03): furniture stands on the floor like the town's props; what hangs on the back wall (a shelf, a
  // lantern) is flat and lifted onto it in the zone file. Two-tile pieces sit centred over both tiles with
  // `offset: [24, 0]`. Fires and lamps are lights (they glow by day indoors too, render/town/InteriorRoom.ts) ──
  bed: { block: [1, 2] },
  stove: { block: [1, 1], light: { dx: 0, dy: -22, radius: 90 } },
  kitchen_table: { block: [2, 1] },
  chest: { block: [1, 1] },
  armchair: { block: [1, 1] },
  dresser: { block: [1, 1], fade: true },
  wall_shelf: { block: [0, 0], flat: true },
  potted_plant: { block: [1, 1] },
  oil_lamp: { block: [1, 1], light: { dx: 0, dy: -42, radius: 110 } },
  wall_lamp: { block: [0, 0], flat: true, light: { dx: 0, dy: -14, radius: 100 } },
  workbench: { block: [2, 1] },
  staircase: { block: [2, 1], fade: true },
  bread_oven: { block: [2, 1], light: { dx: 0, dy: -46, radius: 150 } },
  bakery_counter: { block: [3, 1] },
  bread_rack: { block: [1, 1], fade: true },
  flour_sacks: { block: [1, 1] },
  kneading_table: { block: [2, 1] },
  espresso_counter: { block: [3, 1] },
  cafe_table: { block: [1, 1] },
  bar_counter: { block: [4, 1] },
  bar_stool: { block: [0, 0] },
  pub_table: { block: [1, 1] },
  beer_barrels: { block: [2, 1] },
  fireplace: { block: [2, 1], light: { dx: 0, dy: -30, radius: 160 } },
  store_shelves: { block: [2, 1], fade: true },
  store_counter: { block: [3, 1] },
  produce_crates: { block: [1, 1] },
  bookshelf: { block: [2, 1], fade: true },
  reading_table: { block: [3, 1] },
  card_catalogue: { block: [1, 1] },
  librarian_desk: { block: [3, 1] },
  printing_press: { block: [2, 1] },
  type_cases: { block: [2, 1] },
  office_desk: { block: [3, 1] },
  pigeonholes: { block: [2, 1], fade: true },
  registry_counter: { block: [3, 1] },
  clock_wall: { block: [2, 1], fade: true },
  grandfather_clock: { block: [1, 1], fade: true },
  watch_counter: { block: [3, 1] },
  pilot_gig: { block: [5, 1] },
  oars_rack: { block: [2, 1], fade: true },
  // ── animals (placed as props; the town's life layer animates its own) ──
  duck: { block: [0, 0], water: true, shore: true },
  gull: { block: [0, 0], shore: true },
  cat_sleeping: { block: [0, 0] }
};

export const metaOf = (sprite: string): SpriteMeta => SPRITE_META[sprite] ?? {};

/** The blocked tiles of a prop standing at `at` (empty for walk-through props). */
export function propBlock(sprite: string, at: readonly [number, number], solid?: boolean): [number, number][] {
  const [w, d] = metaOf(sprite).block ?? [1, 1];
  if (solid === false || (solid === undefined && (w === 0 || d === 0))) return [];
  const bw = Math.max(1, w), bd = Math.max(1, d);
  const x0 = at[0] - Math.floor((bw - 1) / 2);
  const out: [number, number][] = [];
  for (let dy = 0; dy < bd; dy++) for (let dx = 0; dx < bw; dx++) out.push([x0 + dx, at[1] - dy]);
  return out;
}

// ── Which art a restorable place shows ──────────────────────────────────────

/** What the town knows that decides faded or restored: the story flags and the town engine's flags. */
export interface TownLook {
  flag(name: string): boolean;
}

/** Place ids whose buildings stand empty on Day 1 (§2.4 vacant homes, A.1.4 the nine empty storefronts). */
const VACANT = /^(vacant_house|storefront)_/;

export interface Restorable {
  /** The place the building is (absent for scenery). */
  id?: string;
  sprite: string;
  state: SpriteState | 'auto';
  project?: string;
  /** Buildings: the homes inside, `zone.home` (town/occupancy.ts buildingHomes). */
  homes?: readonly string[];
}

/**
 * The art to show. Fixed states are kept (a faded request on art with no faded drawing shows restored).
 * `auto`: restored once its Project is done (`project_<project>_done`, the meta's own flags, or
 * `project_<place id>_done` for a single home or shop) or a household has moved in (town/occupancy.ts:
 * a vacant home is restored before anyone lives in it, §6.4); otherwise faded where the town is still faded on
 * Day 1 (a sprite with a Project, a vacant home, a plain vacant home, an empty shop), restored everywhere else.
 */
export function resolveState(r: Restorable, look: TownLook, manifest: TownManifest = TOWN_MANIFEST): SpriteState {
  const states = manifest[r.sprite]?.states ?? ['restored'];
  if (!states.includes('faded')) return 'restored';
  if (r.state !== 'auto') return r.state;
  const meta = metaOf(r.sprite);
  const project = r.project ?? meta.project;
  const flags = [
    ...(project ? [`project_${project}_done`] : []),
    ...(meta.restoredBy ?? []),
    ...(r.id ? [`project_${r.id}_done`] : []),
    ...(r.homes ?? []).map(occupiedFlag)
  ];
  if (flags.some(f => look.flag(f))) return 'restored';
  if (project) return 'faded';
  if ((r.homes ?? []).some(h => h.endsWith('.vacant'))) return 'faded';
  return r.id && VACANT.test(r.id) ? 'faded' : 'restored';
}
