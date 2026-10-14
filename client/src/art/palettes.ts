// Curated palettes for procedural art. Hand-tuned for legibility on dark BG.

export interface UnitPalette {
  primary: number;   // armor / cloth color
  secondary: number; // trim / leather
  accent: number;    // eyes / weapon glint
  skin: number;
  hair: number;
}

export const PLAYER_PALETTES: Record<string, UnitPalette> = {
  amar:   { primary: 0x3a7bcb, secondary: 0x1a4078, accent: 0xf2d34a, skin: 0xc69372, hair: 0x1b1610 },
  lucian: { primary: 0x6a4d2c, secondary: 0x35261a, accent: 0xd9b777, skin: 0xc89a73, hair: 0x2a1d12 },
  ning:   { primary: 0x357c5d, secondary: 0x1b3d2c, accent: 0xefc15c, skin: 0xb78870, hair: 0x101010 },
  maya:   { primary: 0x6a3a8a, secondary: 0x3b1c4c, accent: 0xf0c97b, skin: 0xc69372, hair: 0x4f1b1b },
  leo:    { primary: 0xb55330, secondary: 0x6e2e1c, accent: 0xf3d572, skin: 0xd09a78, hair: 0xb46d2b },
  ranatoli: { primary: 0x6c7188, secondary: 0x3a3e54, accent: 0xc7c4d8, skin: 0xc69372, hair: 0x1a1a1a },
  selene: { primary: 0x222238, secondary: 0x101020, accent: 0xc83a3a, skin: 0xd2a380, hair: 0x111111 },
  // Veya (B14+): slate-blue optician's coat over a scorched work apron,
  // amber lens-light accent — matches her portrait set.
  veya:   { primary: 0x4a6b8a, secondary: 0x5a4632, accent: 0xffb347, skin: 0x8a5c3f, hair: 0x3d3733 },
  // Corin (B17+): charcoal riding coat leading, oxblood lacquer plates
  // second, silver clasp accent. Charcoal-first deliberately — a red
  // PRIMARY would read as an enemy palette on the board.
  corin:  { primary: 0x3e3e48, secondary: 0x7e2b26, accent: 0xc9ccd4, skin: 0xb08a62, hair: 0x151210 },
  // Kian rides with the squad in early-game battles (b02 referenced, b04
  // ambush, b07/b08 escort), and turns hostile from b10 onward when his
  // suspicion crystallizes. Same character — same palette — appears here
  // and in ENEMY_PALETTES so either-side factories resolve correctly.
  kian:   { primary: 0x1a3a6a, secondary: 0x0a1838, accent: 0xefcf6a, skin: 0xc8a07e, hair: 0x202020 },
  // Rose joins the squad for B13 only — Madame Dawn's most senior
  // lieutenant, dies in post_dawn_rebellion. Cool-toned palette
  // (deep teal + dusty rose accent) reads as a poised officer who
  // chose her colors carefully, not a fighter who took whatever
  // armor the quartermaster had on hand.
  rose:   { primary: 0x2c5a5a, secondary: 0x163030, accent: 0xc77a82, skin: 0xd9aa84, hair: 0x4a2820 }
};

export const ENEMY_PALETTES: Record<string, UnitPalette> = {
  bandit:    { primary: 0x6c2727, secondary: 0x371414, accent: 0xb89a3a, skin: 0xa6856a, hair: 0x271916 },
  bandit_archer: { primary: 0x4a1f1f, secondary: 0x281010, accent: 0xa1b86d, skin: 0xb38a6a, hair: 0x1a0d09 },
  royal_guard: { primary: 0x9c1a3c, secondary: 0x4d0c1d, accent: 0xefd07a, skin: 0xb38a6a, hair: 0x161616 },
  ndari:     { primary: 0x4f2a4a, secondary: 0x231022, accent: 0xeac35a, skin: 0xc69372, hair: 0x191412 },
  kian:      { primary: 0x1a3a6a, secondary: 0x0a1838, accent: 0xefcf6a, skin: 0xc8a07e, hair: 0x202020 },
  archbold:  { primary: 0x101018, secondary: 0x000000, accent: 0xff3030, skin: 0x9e8a72, hair: 0xc8c8d8 },
  // The Ravage fleet — the off-world enemy of the endgame arc. Deep
  // sea-glass teal over black with a cold luminous accent: reads as
  // "not from any kingdom on this map" next to the redgold imperials
  // and earth-tone rebels.
  ravage:    { primary: 0x14383a, secondary: 0x081a1c, accent: 0x7affd9, skin: 0x8a9a96, hair: 0x0e1414 }
};

// Map class color overlays so different units of the same class look distinct.
export const CLASS_TINTS: Record<string, number> = {
  swordsman: 0x88a4d4,
  spearton: 0x9aaca0,
  knight: 0xc2a172,
  archer: 0x9bcf9a,
  shinobi: 0x6a6a6a,
  sentinel: 0xb39d6e,
  dactyl_rider: 0xd07c3a,
  swordmaster: 0xffd06a,
  boss: 0xff5555
};
