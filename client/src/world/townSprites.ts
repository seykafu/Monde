// The town's sprites (GDD §16.4, MVP A-03): what client/public/assets/town/manifest.json says about each one,
// plus the little the art can't say for itself (where its chimneys are, which footprint column its door is
// in, how much ground a tree's trunk blocks, whether it is a light). Pure: no Phaser, no DOM.
//
// Contract (scripts/art/export_town.py): sizes are world px at the characters' scale; a building stands with
// its bottom-centre on the middle of its footprint's FRONT edge, a prop on the middle of its base tile.

import manifestJson from '../../public/assets/town/manifest.json';

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
}

// Chimney tops and door columns were read off the art (scratch contact sheets with the footprint grid drawn
// over each building); `block` sizes match each prop's trunk, base or legs, not its canopy.
export const SPRITE_META: Readonly<Record<string, SpriteMeta>> = {
  // ── buildings ──
  augusta_house: { chimneys: [[80, 2]], door: 0 },
  bakery: { chimneys: [[132, 22]], door: 2 },
  bandstand: { door: 1, unlit: true, project: 'bandstand', restoredBy: ['bandstand_rebuilt'] },
  bertrand_house: { chimneys: [[85, 2]], door: 0 },
  boathouse: { door: 1, unlit: true },
  bunkhouse: { chimneys: [[163, 1]], door: 2 },
  cafe_liss: { chimneys: [[45, 2]], door: 1 },
  cannery: { chimneys: [[280, 8]], door: 2, project: 'cannery_coop', restoredBy: ['cannery_coop'] },
  clocktower: { door: 0, unlit: true },
  constabulary: { chimneys: [[147, 10]], door: 1 },
  fish_market: { door: 2, unlit: true },
  founders_house: { chimneys: [[80, 8]], door: 1, unlit: true },
  garden_shed: { door: 1, unlit: true },
  general_store: { chimneys: [[52, 3], [184, 2]], door: 1 },
  glasshouse: { door: 2, unlit: true, project: 'glasshouse', restoredBy: ['glasshouse_repaired'] },
  gull_and_anchor: { chimneys: [[36, 1], [167, 1]], door: 2 },
  harbormaster_house: { chimneys: [[22, 36], [144, 36]], door: 1 },
  // GDD-GAP: §11.5 has the cottage "in rough shape" and its roof fixed by a personal upgrade, with no flag
  // named; `project_cottage_roof_done` (the declared project_<id>_done pattern) restores its art.
  lamplighter_cottage: { chimneys: [[146, 5]], door: 2, project: 'cottage_roof' },
  lantern_office: { chimneys: [[116, 4]], door: 2 },
  library: { chimneys: [[41, 6], [210, 6]], door: 2 },
  lighthouse: { door: 1, unlit: true, project: 'lighthouse' },
  market_hall: { door: 2, unlit: true, project: 'market_hall' },
  nell_cottage: { chimneys: [[35, 2]], door: 1 },
  okafor_house: { chimneys: [[23, 2]], door: 0 },
  pell_house: { chimneys: [[23, 2]], door: 0 },
  st_brigids: { door: 1, unlit: true },
  storefront_a: { chimneys: [[23, 2]], door: 1 },
  storefront_b: { chimneys: [[24, 2]], door: 2 },
  storefront_c: { chimneys: [[84, 2]], door: 2 },
  teo_cottage: { chimneys: [[37, 2]], door: 2 },
  ticket_booth: { door: 0, unlit: true },
  town_hall: { door: 3 },
  townhouse_a: { chimneys: [[20, 1]], door: 1 },
  townhouse_b: { chimneys: [[18, 1]], door: 1 },
  townhouse_c: { chimneys: [[23, 3]], door: 0 },
  townhouse_d: { chimneys: [[81, 2]], door: 1 },
  vane_office: { door: 1 },
  wharf_cottage: { chimneys: [[24, 2]], door: 0 },
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
}

/**
 * The art to show. Fixed states are kept (a faded request on art with no faded drawing shows restored).
 * `auto`: restored once its Project is done (`project_<project>_done`, the meta's own flags, or
 * `project_<place id>_done` for a single home or shop); otherwise faded where the town is still faded on
 * Day 1 (a sprite with a Project, a vacant home, an empty shop), restored everywhere else.
 * GDD-GAP: nothing tracks which vacant home is occupied yet (§6.4 counts homes, not doors), so a vacant
 * home stays faded until its own `project_<id>_done` flag is set.
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
    ...(r.id ? [`project_${r.id}_done`] : [])
  ];
  if (flags.some(f => look.flag(f))) return 'restored';
  if (project) return 'faded';
  return r.id && VACANT.test(r.id) ? 'faded' : 'restored';
}

/** Someone is home after dark: lit windows, a light at the door, smoke from the chimney (§16.4, occupied homes only). */
export function isLived(r: Pick<Restorable, 'id' | 'sprite'>, state: SpriteState): boolean {
  if (state === 'faded' || metaOf(r.sprite).unlit) return false;
  return !(r.id && VACANT.test(r.id));
}
