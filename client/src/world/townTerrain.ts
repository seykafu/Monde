// The town's ground (GDD §16.4 "Tilesets"; zone format v2, see zoneFormat.ts). Pure: no Phaser, no DOM.
//
// Every tile of a v2 zone is one of these kinds. The ASCII `terrain:` layer names them with the default
// legend below (a zone may add its own characters under `legend:`). Each kind knows whether you can walk
// on it, whether it is water, how its edges meet its neighbours' (render/town/autotile.ts), and which of
// the combat Grid's terrains it stands in for (ZoneDef.tiles stays a MapDef, so Grid and elevationFor work
// unchanged).

import type { TerrainKind } from '../combat/types';

export const TOWN_TERRAINS = [
  'grass', 'meadow', 'cobble', 'brick', 'plaza', 'gravel', 'road', 'sand', 'shingle', 'wet_sand', 'soil',
  'boards', 'steps', 'weedy', 'river', 'sea', 'pond', 'shallows'
] as const;
export type TownTerrain = (typeof TOWN_TERRAINS)[number];

/** Which way a river runs (compass; the board is seen from the south, so north is up the screen). */
export type Flow = 'north' | 'south' | 'east' | 'west';
export const FLOWS: readonly Flow[] = ['north', 'south', 'east', 'west'];

export interface LegendEntry { terrain: TownTerrain; flow?: Flow; solid?: boolean }

/**
 * The default legend. Rivers are drawn with arrows pointing downstream, so the map shows the flow.
 * Letters a–z other than those here are free for a zone's own legend.
 */
export const DEFAULT_LEGEND: Readonly<Record<string, LegendEntry>> = {
  ',': { terrain: 'grass' },
  "'": { terrain: 'meadow' },
  '.': { terrain: 'cobble' },
  b: { terrain: 'brick' },
  p: { terrain: 'plaza' },
  ':': { terrain: 'gravel' },
  r: { terrain: 'road' },
  s: { terrain: 'sand' },
  h: { terrain: 'shingle' },
  w: { terrain: 'wet_sand' },
  m: { terrain: 'soil' },
  '=': { terrain: 'boards' },
  _: { terrain: 'steps' },
  g: { terrain: 'weedy' },
  '~': { terrain: 'sea' },
  o: { terrain: 'pond' },
  '-': { terrain: 'shallows' },
  '>': { terrain: 'river', flow: 'east' },
  '<': { terrain: 'river', flow: 'west' },
  '^': { terrain: 'river', flow: 'north' },
  v: { terrain: 'river', flow: 'south' }
};

export interface TerrainInfo {
  water: boolean;
  walkable: boolean;
  /**
   * Stacking order where two kinds meet: the higher one's edge lies over the lower one (grass spills onto a
   * path, a path onto sand, sand into the sea). Art tuning, not a rule.
   */
  layer: number;
  /** A soft edge (grass, sand, gravel) spills a ragged few pixels over a lower neighbour; a hard one stops at the line. */
  soft: boolean;
  /** Laid by hand: kerbs, boards, steps. Water against a paved or planked edge shows a quay wall, not a beach. */
  built: boolean;
  /** The combat Grid's terrain this stands in for. */
  legacy: TerrainKind;
}

export const TERRAIN_INFO: Readonly<Record<TownTerrain, TerrainInfo>> = {
  sea: { water: true, walkable: false, layer: 0, soft: false, built: false, legacy: 'water' },
  river: { water: true, walkable: false, layer: 0, soft: false, built: false, legacy: 'water' },
  pond: { water: true, walkable: false, layer: 0, soft: false, built: false, legacy: 'water' },
  shallows: { water: true, walkable: false, layer: 1, soft: true, built: false, legacy: 'water' },
  wet_sand: { water: false, walkable: true, layer: 2, soft: true, built: false, legacy: 'sand' },
  sand: { water: false, walkable: true, layer: 3, soft: true, built: false, legacy: 'sand' },
  shingle: { water: false, walkable: true, layer: 4, soft: true, built: false, legacy: 'rubble' },
  road: { water: false, walkable: true, layer: 5, soft: true, built: false, legacy: 'dirt' },
  gravel: { water: false, walkable: true, layer: 6, soft: true, built: false, legacy: 'dirt' },
  cobble: { water: false, walkable: true, layer: 7, soft: false, built: true, legacy: 'cobblestone' },
  brick: { water: false, walkable: true, layer: 7, soft: false, built: true, legacy: 'stone' },
  plaza: { water: false, walkable: true, layer: 7, soft: false, built: true, legacy: 'marble' },
  grass: { water: false, walkable: true, layer: 9, soft: true, built: false, legacy: 'grass' },
  meadow: { water: false, walkable: true, layer: 10, soft: true, built: false, legacy: 'grass' },
  soil: { water: false, walkable: true, layer: 11, soft: false, built: true, legacy: 'mud' },
  boards: { water: false, walkable: true, layer: 12, soft: false, built: true, legacy: 'wood' },
  steps: { water: false, walkable: true, layer: 12, soft: false, built: true, legacy: 'stone' },
  weedy: { water: false, walkable: true, layer: 12, soft: false, built: true, legacy: 'moss_stone' }
};

export const isTownTerrain = (v: unknown): v is TownTerrain => typeof v === 'string' && (TOWN_TERRAINS as readonly string[]).includes(v);
export const isFlow = (v: unknown): v is Flow => typeof v === 'string' && (FLOWS as readonly string[]).includes(v);

/** Unit step of a flow on the grid (y grows down the screen, i.e. south). */
export const FLOW_VECTOR: Readonly<Record<Flow, readonly [number, number]>> = {
  north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0]
};
