// Ravage map geometry retained only as regression fixtures, never runtime content.
import type { MapDef, ObstacleKind, TerrainKind, TilePos } from "../../types";

// `elev` is presentation-only height for the ¾ diorama view (see MapDef).
// Most maps never pass it: terrain supplies a sensible default (walls
// stand up, water sinks). It exists for the maps whose design is ABOUT
// height — the mountain parapet, the cliff staircase — where two aliases
// of the same terrain were always meant to be two different levels.
const t = (terrain: TerrainKind, obstacle: ObstacleKind = "none", elev?: number) =>
  (elev === undefined ? { terrain, obstacle } : { terrain, obstacle, elev });

type Cell = { terrain: TerrainKind; obstacle?: ObstacleKind; elev?: number };

// Helper: build a rectangle map from a 2D array of cell descriptors.
//
// `elevation` (optional, presentation-only) sets height per cell for maps
// whose height varies by POSITION rather than by alias — a staircase
// descending row by row can't be expressed as one `t(...)` per terrain.
// Return undefined to leave a cell to its alias / terrain default.
const buildMap = (
  id: string,
  name: string,
  rows: ReadonlyArray<ReadonlyArray<Cell>>,
  starts: { player: TilePos[]; enemy: TilePos[]; ally?: TilePos[] },
  elevation?: (x: number, y: number, cell: Cell) => number | undefined
): MapDef => {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const flat: Cell[] = [];
  rows.forEach((r, y) => {
    if (r.length !== width) throw new Error(`Map ${id} row mismatch`);
    r.forEach((c, x) => {
      const e = elevation?.(x, y, c);
      flat.push(e === undefined ? c : { ...c, elev: e });
    });
  });
  return { id, name, width, height, tiles: flat, startPositions: starts };
};

// ============== Battle 1 — The Palace Coup ==============
// 18×14 throne hall — significantly expanded from the v1 13×9 to give
// the climactic opening battle the spatial weight the script asks for
// ("a grand, almost boss-fight encounter"). The hall is taller than
// the viewport (14 × 48 = 672px > ~588 visible), so the camera scrolls
// vertically — players see the squad at the south doors and have to
// pan up to see Nebu on the throne. Pillars in two staggered ranks
// + a third rank below break long sight lines into the throne so
// archers can't snipe across the whole map.
const _ = t("carpet");
// The stone ring is a raised gallery around a lower carpeted hall, and
// the throne sits a step higher again on its dais.
const S = t("stone", "none", 1);
const P = t("stone", "pillar", 1);
const TH = t("carpet", "throne", 2);
const TO = t("stone", "torch", 1);
const palaceRows = [
  [S,  S,  S,  S,  S,  P,  S,  S,  S, TH, S,  S,  S,  P,  S,  S,  S,  S ],
  [S,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  S ],
  [S,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  S ],
  [S,  P,  _,  _,  _,  _,  _,  P,  _,  _,  P,  _,  _,  _,  _,  _,  P,  S ],
  [S,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  S ],
  [S,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  S ],
  [S,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  S ],
  [S,  P,  _,  _,  _,  _,  _,  P,  _,  _,  P,  _,  _,  _,  _,  _,  P,  S ],
  [S,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  S ],
  [S,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  S ],
  [S,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  S ],
  [S,  P,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  P,  S ],
  [S,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  _,  S ],
  [TO, S,  S,  S,  S,  S,  S,  S,  S,  S,  S,  S,  S,  S,  S,  S,  S,  TO]
] as const;

export const palaceMap: MapDef = buildMap("palace_coup", "Royal Throne Hall", palaceRows, {
  // Player enters from south doors at row 13. Five-unit fan formation
  // hugs the south wall — Amar center with the originals on either side.
  player: [
    { x: 8,  y: 12 }, // Amar (center, lead)
    { x: 9,  y: 12 }, // Ranatoli (right of center)
    { x: 7,  y: 12 }, // Selene (left of center)
    { x: 10, y: 12 }, // unseen comrade right
    { x: 6,  y: 12 }  // unseen comrade left
  ],
  // Nebu on the throne at (9, 0), one guard on the dais steps below
  // him, two out in the hall. B1 is a new player's first fight, so the
  // guards start a couple of turns' walk from the squad: there is time
  // to learn to move before the first blow lands.
  enemy: [
    { x: 9,  y: 0 },  // King Nebu on the throne
    { x: 6,  y: 5 },  // Royal Guard mid-hall west
    { x: 12, y: 5 },  // Royal Guard mid-hall east
    { x: 9,  y: 2 }   // Royal Guard below the throne
  ]
});

// ============== Battle 2 — Bandits in the Farmland ==============
// 12×10 farmland: open grass, hay bales, fences, two wagons.
const G = t("grass");
const H = t("grass", "hay");
const F = t("grass", "fence");
const W = t("dirt", "wagon");
const D = t("dirt");

const farmlandRows = [
  [G, G, G, G, G, G, G, G, G, G, G, G],
  [G, G, F, F, F, F, F, F, G, G, G, G],
  [G, G, G, G, G, H, G, G, G, G, G, G],
  [G, H, G, G, G, G, G, G, H, G, G, G],
  [D, D, W, D, D, D, D, D, D, W, D, D],
  [D, D, D, D, D, D, D, D, D, D, D, D],
  [G, G, H, G, G, G, G, G, H, G, G, G],
  [G, G, G, G, G, G, F, G, G, G, G, G],
  [G, G, G, G, G, G, F, G, G, G, G, G],
  [G, G, G, G, G, G, G, G, G, G, G, G]
] as const;

export const farmlandMap: MapDef = buildMap("farmland", "Thuling Farmland", farmlandRows, {
  player: [
    { x: 1, y: 9 },
    { x: 2, y: 9 },
    { x: 3, y: 9 }
  ],
  enemy: [
    { x: 8, y: 0 },
    { x: 10, y: 0 },
    { x: 5, y: 1 },
    { x: 11, y: 2 }
  ]
});

// ============== Battle 3 — Madame Dawn's Bandits ==============
// 12×9 outskirts of Thuling: a dirt road running E-W (rows 3–5) with
// open grass farms to the south (player-friendly territory) and rubble
// from a recently burned-out smallholding to the north (where the Dawn
// raiders have set up). Two derelict wagons (Wg) on the road act as
// movement blockers and force the squad to commit to one flank or the
// other. Hay bales (Hy) at the corners and the rubble field give the
// raiders' archers a few cover tiles to fire from on round 1.
//
// `Gr` (grass) is hoisted to this section because it's the first map in
// source order to use it; the swamp section below shares the const.
const Gr = t("grass");
const Di = t("dirt");
const Hy = t("grass", "hay");
const Wg = t("dirt", "wagon");
const Ru = t("rubble");
const Fn = t("grass", "fence");

const dawnBanditsRows = [
  [Gr, Gr, Hy, Gr, Ru, Gr, Gr, Ru, Gr, Hy, Gr, Gr],
  [Gr, Fn, Fn, Gr, Ru, Ru, Ru, Ru, Gr, Fn, Fn, Gr],
  [Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr],
  [Di, Di, Di, Di, Di, Di, Di, Di, Di, Di, Di, Di],
  [Di, Di, Wg, Di, Di, Di, Di, Di, Di, Wg, Di, Di],
  [Di, Di, Di, Di, Di, Di, Di, Di, Di, Di, Di, Di],
  [Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr],
  [Gr, Fn, Fn, Gr, Gr, Gr, Gr, Gr, Gr, Fn, Fn, Gr],
  [Gr, Hy, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Hy, Gr]
] as const;

export const dawnBanditsMap: MapDef = buildMap("dawn_bandits", "Outskirts of Thuling", dawnBanditsRows, {
  // Squad braced south of the road, defending the farms behind them.
  // Maya enters from the east flank — narratively she "joins mid-fight"
  // (her appearance in pre-battle dialog is foreshadowed; mechanically
  // she just starts on the field separated from the main squad).
  player: [
    { x: 5, y: 7 }, // Amar
    { x: 6, y: 7 }, // Lucian
    { x: 4, y: 8 }, // Ning
    { x: 10, y: 5 }, // Maya — east flank, separated
    { x: 5, y: 6 }, // Veya
    { x: 4, y: 7 }  // Corin

  ],
  // Seven raiders in/around the rubble at the north field. Two archers
  // perched on hay/rubble for first-round shots, two swordsmen pressing
  // down the road, one spearton holding the rubble line. Last two added
  // in the difficulty pass — bracket Maya's isolated east-flank arrival
  // (an east-side archer can range her on round 1; an east-side
  // swordsman puts melee pressure on her join attempt).
  enemy: [
    { x: 5, y: 0 }, // Swordsman, north-center
    { x: 7, y: 0 }, // Swordsman
    { x: 5, y: 1 }, // Spearton in rubble cover
    { x: 4, y: 0 }, // Archer
    { x: 8, y: 0 }, // Archer
    { x: 10, y: 1 }, // Archer — east flank, threatens Maya on round 1
    { x: 9, y: 2 }   // Swordsman — east flank, presses Maya
  ]
});

// ============== Battle 4 — Ambush in the Swamp ==============
// 12×9 marsh on the road home. The squad is moving through a clear lane in
// the middle (rows 3–5, cols 4–7 are open grass) when bandits burst from
// the tree-line at the four corners. Mud and water frame the playable
// area for atmosphere; the only fully blocking cover is the four FT (forest+tree)
// chokes at (2,1)/(9,1)/(2,7)/(9,7) and a few mud "puddles" mid-map that
// constrain pathing without prohibiting it. Forest tiles at the corners
// (Fo) give the ambushers a 0.90 defend bonus on round 1 — they're shooting
// from cover until the squad pushes out to engage them.
const Mu = t("mud");
const Wa = t("water");
// Gr (grass) is shared with the Battle 3 section above — declared once there.
const Fo = t("forest");
const FT = t("forest", "tree");

const swampRows = [
  [Wa, Mu, Mu, Fo, Gr, Gr, Gr, Gr, Fo, Mu, Mu, Wa],
  [Mu, Mu, FT, Gr, Gr, Gr, Gr, Gr, Gr, FT, Mu, Mu],
  [Wa, Mu, Gr, Gr, Mu, Mu, Mu, Mu, Gr, Gr, Mu, Wa],
  [Mu, Gr, Gr, Gr, Mu, Gr, Gr, Mu, Gr, Gr, Gr, Mu],
  [Mu, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Gr, Mu],
  [Mu, Gr, Gr, Gr, Mu, Gr, Gr, Mu, Gr, Gr, Gr, Mu],
  [Wa, Mu, Gr, Gr, Mu, Mu, Mu, Mu, Gr, Gr, Mu, Wa],
  [Mu, Mu, FT, Gr, Gr, Gr, Gr, Gr, Gr, FT, Mu, Mu],
  [Wa, Mu, Mu, Fo, Gr, Gr, Gr, Gr, Fo, Mu, Mu, Wa]
] as const;

export const swampMap: MapDef = buildMap("swamp", "Marsh Road Ambush", swampRows, {
  // Squad walking single-file down the road, Maya scouting ahead.
  player: [
    { x: 6, y: 4 }, // Amar (center of formation)
    { x: 5, y: 4 }, // Lucian (left flank)
    { x: 7, y: 4 }, // Kian (right flank)
    { x: 6, y: 3 }, // Maya (point)
    { x: 6, y: 5 }  // Ning (rear, bow ready)
  ],
  // Six bandits ringing the squad. Speartons close on the lane, archers
  // open up from forest cover at the back corners, swordsmen flank from
  // the SW/SE corner cover. Distance from the corner forests to the squad
  // is ~6–7 tiles, so the archers spend round 1 advancing or shooting one
  // exposed scout (Maya/Ning), then settle into their effective range.
  enemy: [
    { x: 5, y: 1 }, // Spearton — north blocker
    { x: 6, y: 7 }, // Spearton — south blocker
    { x: 3, y: 0 }, // Archer in NW forest cover
    { x: 8, y: 0 }, // Archer in NE forest cover
    { x: 3, y: 8 }, // Swordsman in SW forest cover
    { x: 8, y: 8 }  // Swordsman in SE forest cover
  ]
});

// ============== Battle 5 — Mountain Bandits / Ndari ==============
// 20×13 mountain pass — expanded from the v1 14×10 to give the squad
// room to flank the elevated parapet where Ndari + the bandit speartons
// hold the high ground. The map is right at the horizontal limit of the
// viewport (20 × 48 = 960px = playW) and exceeds vertically (13 × 48 =
// 624 > ~588 visible), so the camera scrolls vertically. Trees + rocks
// scattered through rows 7–12 break up the open snow approach into
// multiple paths.
const SN = t("snow");
const SR = t("snow", "rock");
const ST = t("snow", "tree");
const SS = t("stone", "none", 1);   // parapet rim — one step up off the snow
const SE = t("stone", "none", 2);   // parapet core — the high ground itself

const mountainRows = [
  [SR, SN, SN, SN, SN, SS, SS, SS, SS, SS, SS, SS, SS, SS, SS, SN, SN, SN, SN, SR],
  [SN, SN, SN, SN, SS, SS, SE, SS, SS, SS, SE, SS, SS, SS, SE, SS, SN, SN, SN, SN],
  [SN, ST, SN, SS, SE, SE, SE, SE, SE, SE, SE, SE, SE, SE, SE, SE, SS, SN, ST, SN],
  [SN, SN, SN, SS, SE, SE, SE, SE, SE, SE, SE, SE, SE, SE, SE, SE, SS, SN, SN, SN],
  [SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN],
  [SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN],
  [SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN],
  [SN, ST, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, ST, SN],
  [SN, SN, SR, SN, SN, ST, SN, SN, ST, SN, SN, ST, SN, SN, SR, SN, SN, SR, SN, SN],
  [SN, SN, SN, SR, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SR, SN, SR, SN, SN, SN],
  [SR, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SN, SR],
  [SN, SN, SR, SN, SN, SN, SN, ST, SN, SN, SN, ST, SN, SN, SN, SN, SR, SN, SN, SN],
  [SR, SN, SN, SR, SN, SR, SN, SN, SR, SN, SN, SN, SR, SN, SR, SN, SN, SR, SN, SR]
] as const;

export const mountainMap: MapDef = buildMap("mountain_pass", "Ravaged Mountain Village", mountainRows, {
  // Squad spread along the south snow line (row 12) — wide enough to
  // pick a flanking approach via the gaps in the tree/rock obstacles
  // in rows 7–11.
  player: [
    { x: 4,  y: 12 },
    { x: 7,  y: 12 },
    { x: 10, y: 12 },
    { x: 13, y: 12 },
    { x: 16, y: 12 }
  ],
  // Ndari + flanking speartons on the stone parapet (row 1); 2 swordsmen
  // at the parapet edge (row 3); 2 archers in the open mid-pass (row 5)
  // ranging on the squad's south approach. Last two added in the
  // difficulty pass — extends the parapet threat further west and gives
  // the east mid-pass another archer mirror, so the squad's climb has
  // pressure from both flanks instead of just the center.
  enemy: [
    { x: 10, y: 1 }, // Ndari on the parapet, dead center
    { x: 7,  y: 1 }, // bandit spearton flanking left
    { x: 13, y: 1 }, // bandit spearton flanking right
    { x: 5,  y: 3 }, // bandit swordsman west edge
    { x: 15, y: 3 }, // bandit swordsman east edge
    { x: 8,  y: 5 }, // bandit archer mid-pass
    { x: 12, y: 5 }, // bandit archer mid-pass
    { x: 4,  y: 1 }, // bandit spearton — far-west parapet flank
    { x: 16, y: 5 }  // bandit archer — far-east mid-pass mirror
  ]
});

// ============== Battle 6 — The Caravan ==============
// 13×9 canyon road. The middle three rows (3–5) are the dirt road the
// caravan is travelling east → west; the top three rows (0–2) are the
// north canyon shelf where archers perch behind rock cover; the bottom
// three rows (6–8) mirror it. Two wagons block the middle of the road
// (the actual caravan being escorted) — they're treated as obstacles
// the bandits can shelter behind and the squad has to flow around.
//
// The squad enters from the west; bandits seal the east end and rain
// arrows from the perches. The script's "civilian drivers" aren't
// modeled mechanically (no ally faction yet); the wagons being
// preserved is the narrative payoff for routing the bandits.
const Sn = t("stone");
const SnR = t("stone", "rock");

const caravanRows = [
  [Sn,  Sn,  SnR, Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  SnR, Sn,  Sn,  Sn ],
  [Sn,  SnR, Sn,  Sn,  Sn,  SnR, Sn,  Sn,  SnR, Sn,  Sn,  SnR, Sn ],
  [Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn ],
  [Di,  Di,  Di,  Di,  Di,  Di,  Di,  Di,  Di,  Di,  Di,  Di,  Di ],
  [Di,  Di,  Di,  Di,  Di,  Wg,  Di,  Di,  Wg,  Di,  Di,  Di,  Di ],
  [Di,  Di,  Di,  Di,  Di,  Di,  Di,  Di,  Di,  Di,  Di,  Di,  Di ],
  [Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  Sn ],
  [Sn,  SnR, Sn,  Sn,  SnR, Sn,  Sn,  SnR, Sn,  Sn,  SnR, Sn,  Sn ],
  [Sn,  Sn,  SnR, Sn,  Sn,  Sn,  Sn,  Sn,  Sn,  SnR, Sn,  Sn,  Sn ]
] as const;

export const caravanMap: MapDef = buildMap("caravan", "Foothill Canyon Road", caravanRows, {
  // Squad enters from the west, formation tight on the road.
  player: [
    { x: 1, y: 4 }, // Amar (lead)
    { x: 0, y: 4 }, // Lucian (anchor)
    { x: 1, y: 3 }, // Ning (north flank — has bowline up the perch)
    { x: 1, y: 5 }, // Maya (south flank — the script's "took command of one flank")
    { x: 2, y: 4 }, // Leo (mounted, can swing wide either way)
    { x: 2, y: 3 }  // Corin

  ],
  // Eight bandits — coordinated ambush per the script. Two perched
  // archers each on the N and S shelves; two speartons sealing the east
  // end of the road; two swordsmen pressing west from the road itself.
  enemy: [
    { x: 4, y: 1 },  // North-shelf archer (advance west to engage)
    { x: 9, y: 1 },  // North-shelf archer
    { x: 5, y: 7 },  // South-shelf archer (x=4 is a shelf rock — see row 7)
    { x: 9, y: 7 },  // South-shelf archer
    { x: 12, y: 4 }, // Spearton sealing east entrance
    { x: 11, y: 5 }, // Spearton sealing east
    { x: 11, y: 3 }, // Swordsman pressing west
    { x: 10, y: 4 }  // Swordsman pressing west
  ]
});

// ============== Battle 7 — The Ghost from Para (monastery) ==============
// 16×15 abandoned monastery — expanded from the v1 12×10 to give the
// "climb up to the bell tower" arc the vertical real estate the script
// describes. Five rooms now stack vertically: vestibule (row 14, squad
// entry) → outer chapel (rows 9–12) → middle chamber (rows 5–8) →
// inner sanctum (rows 1–4) → bell tower altar (row 0). Each room is
// separated by a pillar wall with a single gap that the squad must
// push through under fire from the next room. The map exceeds the
// viewport vertically (15 × 48 = 720 > ~588 visible) so the camera
// scrolls — the player sees Selene at the top only after a few moves
// of advance.
const PP = t("stone", "pillar");
const Th = t("stone", "throne");

const monasteryRows = [
  [Sn, Sn, PP, Sn, Sn, Sn, Sn, Th, Sn, Sn, Sn, Sn, Sn, PP, Sn, Sn], // ← bell tower altar
  [Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn],
  [Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn],
  [Sn, Sn, PP, PP, PP, Sn, Sn, Sn, Sn, Sn, Sn, PP, PP, PP, Sn, Sn], // ← inner sanctum wall (gap rows 5–10)
  [Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn],
  [Sn, PP, Sn, Sn, PP, Sn, Sn, Sn, Sn, Sn, Sn, PP, Sn, Sn, PP, Sn], // ← middle-chamber pillar funnel
  [Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn],
  [Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn],
  [Sn, Sn, PP, PP, PP, Sn, Sn, Sn, Sn, Sn, Sn, PP, PP, PP, Sn, Sn], // ← middle-chamber north wall
  [Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn],
  [Sn, PP, Sn, Sn, PP, Sn, Sn, Sn, Sn, Sn, Sn, PP, Sn, Sn, PP, Sn], // ← outer-chapel pillar funnel
  [Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn],
  [Sn, Sn, PP, PP, PP, Sn, Sn, Sn, Sn, Sn, Sn, PP, PP, PP, Sn, Sn], // ← outer-chapel south wall
  [Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn],
  [Sn, Sn, PP, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, PP, Sn, Sn]  // ← vestibule (squad spawns here)
] as const;

export const monasteryMap: MapDef = buildMap("monastery", "Abandoned Monastery", monasteryRows, {
  // Squad breaches from the south at the vestibule. Leo at the rear
  // because his mount can't push through the narrowest pillar gaps
  // until the front line clears them.
  player: [
    { x: 7,  y: 13 }, // Amar
    { x: 8,  y: 13 }, // Lucian (per script: stays on Amar's flank)
    { x: 6,  y: 14 }, // Ning (bowline up the central nave)
    { x: 9,  y: 14 }, // Maya
    { x: 5,  y: 14 }  // Leo (rear)
  ],
  // Selene at the bell tower (north of the altar's gap). Two archers
  // perched in the inner sanctum, two swordsmen in the middle chamber,
  // one spearton anchoring the outer-chapel funnel. Last two added in
  // the difficulty pass — a third archer high in the inner sanctum
  // gives Selene better ranged cover, and a third swordsman in the
  // pillar funnel between middle chamber and outer chapel makes the
  // central corridor a real grind instead of a clear lane.
  enemy: [
    { x: 7,  y: 1 },  // Selene — boss
    { x: 5,  y: 2 },  // Raider archer (inner sanctum, west)
    { x: 10, y: 2 },  // Raider archer (inner sanctum, east)
    { x: 3,  y: 6 },  // Raider swordsman (middle chamber, west)
    { x: 12, y: 6 },  // Raider swordsman (middle chamber, east)
    { x: 7,  y: 10 }, // Raider spearton (outer chapel funnel)
    { x: 11, y: 2 },  // Raider archer — third high in the inner sanctum
    { x: 7,  y: 8 }   // Raider swordsman — center funnel between chambers
  ]
});

// ============== Battle 8 — The Town of Orinhal ==============
// 14×11 cobblestone town square. Squad enters from the south (row 10),
// tax collectors hold the north (rows 0–2) with a couple of hired-muscle
// bandits posted mid-square. Scattered barricades give cover for both
// sides — the central column at (5–8, 3–7) is the open killing ground.
// Fits in the viewport without scrolling.
//
// The script's "three-sided battle" with Madame Dawn's partisans is
// resolved narratively in the post arc (Leo's promotion beat triggers
// the squad's choice to side with the partisans). Mechanically this
// is a straight squad-vs-tax-collectors fight; the partisans + Ndara
// + the silver distribution all fire in post_orinhal.
const Cb = t("cobblestone");
const Bd = t("cobblestone", "barricade");

const orinhalRows = [
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb],
  [Cb, Cb, Bd, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Bd, Cb, Cb, Cb],
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb],
  [Cb, Cb, Cb, Cb, Cb, Bd, Cb, Cb, Bd, Cb, Cb, Cb, Cb, Cb],
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb],
  [Cb, Bd, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Bd, Cb], // ← mid-square cover
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb],
  [Cb, Cb, Cb, Cb, Cb, Bd, Cb, Cb, Bd, Cb, Cb, Cb, Cb, Cb],
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb],
  [Cb, Cb, Bd, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Bd, Cb, Cb, Cb],
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb]
] as const;

export const orinhalMap: MapDef = buildMap("orinhal", "Orinhal Town Square", orinhalRows, {
  // Squad spreads across the south end of the square; civilians
  // (off-field, narrative only) shelter behind the squad.
  player: [
    { x: 5,  y: 10 }, // Amar (center)
    { x: 6,  y: 10 }, // Lucian
    { x: 7,  y: 10 }, // Maya
    { x: 4,  y: 9 },  // Ning
    { x: 8,  y: 9 }   // Leo
  ],
  // Two royal guards + two crown archers represent the King's tax
  // enforcement detail. Two bandit swordsmen (hired muscle) press
  // the central square; one bandit spearton anchors the choke at row 6.
  enemy: [
    { x: 5,  y: 0 },  // Royal Guard, north-center left
    { x: 8,  y: 0 },  // Royal Guard, north-center right
    { x: 3,  y: 1 },  // Crown Archer, north-west
    { x: 10, y: 1 },  // Crown Archer, north-east
    { x: 4,  y: 4 },  // Hired bandit swordsman pressing west
    { x: 9,  y: 4 },  // Hired bandit swordsman pressing east
    { x: 6,  y: 6 }   // Bandit spearton, mid-square anchor
  ]
});

// ============== Battle 9 — The Price of Doubt (ravine trap) ==============
// 12×14 narrow canyon — Fergus's trap. Squad spawns mid-ravine (row 4)
// after being ambushed; the King's regiment in disguise holds the high
// ground at the north (rows 0–3); a river bottleneck at rows 8–9 forces
// any escape attempt south through a single 4-tile-wide ford. Sheer
// rock cliffs (Rk = stone+rock obstacle) line both sides, narrowing to
// a 6-tile-wide gap at the south escape point (row 13).
//
// Map exceeds viewport vertically (14 × 48 = 672 > ~588 visible) — the
// camera scrolls so the player sees the squad's predicament first and
// has to pan up to see the entrenched enemy line.
const Wt = t("water");

const ravineRows = [
  [SnR, SnR, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, SnR, SnR], // ← enemy high ground
  [SnR, Sn,  Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn,  SnR],
  [Sn,  Sn,  Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn,  Sn],
  [Sn,  Sn,  Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn,  Sn],
  [Sn,  Sn,  Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn,  Sn],  // ← squad spawns here
  [Sn,  Sn,  Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn,  Sn],
  [SnR, Sn,  Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn,  SnR],
  [SnR, SnR, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, SnR, SnR],
  [SnR, Sn,  Sn, Sn, Wt, Wt, Wt, Wt, Sn, Sn, Sn,  SnR], // ← river bottleneck
  [SnR, SnR, Sn, Wt, Wt, Wt, Wt, Wt, Wt, Sn, SnR, SnR],
  [Sn,  Sn,  Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn,  Sn],
  [Sn,  Sn,  Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn,  Sn],
  [Sn,  SnR, Sn, Sn, Sn, Sn, Sn, Sn, Sn, Sn, SnR, Sn],
  [SnR, SnR, SnR, Sn, Sn, Sn, Sn, Sn, Sn, SnR, SnR, SnR] // ← south escape (gap rows 3–8)
] as const;

export const ravineMap: MapDef = buildMap("ravine", "The Price of Doubt", ravineRows, {
  // Squad spawns mid-canyon at row 4, where the ambush hit. They have
  // to fight back against the entrenched line OR push south through the
  // river bottleneck to the escape gap at row 13.
  player: [
    { x: 4,  y: 4 }, // Amar
    { x: 5,  y: 4 }, // Lucian
    { x: 6,  y: 4 }, // Maya
    { x: 7,  y: 4 }, // Ning
    { x: 5,  y: 5 }  // Leo (rear)
  ],
  // King's regiment in disguise — three royal archers entrenched on
  // the high ground (rows 0–2), two royal guards holding the line
  // (row 2–3), two bandit-coded swordsmen pressing forward (row 5).
  // Total 7 — same count as B7's monastery, level-bumped to reflect
  // these being elite forces in disguise rather than rank-and-file.
  enemy: [
    { x: 5,  y: 0 }, // Crown Archer, top center
    { x: 3,  y: 1 }, // Crown Archer, west
    { x: 8,  y: 1 }, // Crown Archer, east
    { x: 4,  y: 2 }, // Royal Guard, north line
    { x: 7,  y: 2 }, // Royal Guard, north line
    { x: 4,  y: 3 }, // "Bandit" swordsman pressing forward
    { x: 7,  y: 3 }  // "Bandit" swordsman pressing forward
  ]
}, (_x, y, cell) => {
  // "The King's regiment in disguise holds the high ground at the north
  // (rows 0-3)" — now it actually is high ground.
  if (cell.terrain === "water") return undefined;
  if (y <= 1) return 2;
  if (y <= 3) return 1;
  return undefined;
});

// ============== Battle 10 — Leaving Thuling ==============
// 16×11 cobblestone village street. Lucian's house (large wall block at
// the EAST end, rows 4-6 cols 13-15) is where his family is being held
// — narratively present, not a tactical objective. Squad spawns
// CENTER-east, near the house, with the goal of breaking WEST through
// Kian's blockade (col 0, rows 4-6) to reach the road out of Thuling.
// Wood-shuttered shops on both sides of the street form the lateral
// walls; barricades placed by Kian's contingent block the central
// street to force the squad to fight, not run past.
//
// Victory is escape, not rout: the squad just needs to get a unit to
// the west edge. The full contingent of 7 enemies (Kian + 6 royals)
// is more than the squad can cleanly kill in 5-6 rounds, so the
// player has to make the choice — fight long enough to thin the line,
// or push hard west and accept the trades. Kian himself uses the
// holdPositionUntil pattern (see B1 King Nebu) so he doesn't charge
// out of his blocker tile until the squad has thinned his guard.
const Co = t("cobblestone");
const Ba = t("cobblestone", "barricade");
const Wb = t("wall");                   // building wall — full obstacle
const Tr = t("cobblestone", "torch");   // street torches for ambient

const leavingThulingRows = [
  [Wb, Wb, Wb, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Wb, Wb, Wb], // row 0 — north shop fronts
  [Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co],
  [Co, Tr, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Tr, Co],
  [Co, Co, Co, Co, Co, Ba, Co, Co, Ba, Co, Co, Co, Co, Co, Co, Co], // row 3 — barricade line
  [Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Wb, Wb, Wb], // row 4 — east edge: Lucian's house starts
  [Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Wb, Wb, Wb], // row 5 — house wall
  [Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Wb, Wb, Wb], // row 6 — house wall
  [Co, Co, Co, Co, Co, Ba, Co, Co, Ba, Co, Co, Co, Co, Co, Co, Co], // row 7 — barricade line
  [Co, Tr, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Tr, Co],
  [Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co],
  [Wb, Wb, Wb, Co, Co, Co, Co, Co, Co, Co, Co, Co, Co, Wb, Wb, Wb]  // row 10 — south shop fronts
] as const;

export const leavingThulingMap: MapDef = buildMap("leaving_thuling", "Thuling Streets", leavingThulingRows, {
  // Squad spawns just west of Lucian's house — they were inside it
  // when Kian arrived; they've come out into the street. Tight
  // formation across rows 4-6 col 11-12 so the squad starts near each
  // other and the two adjacent-eot triggers fire reliably.
  player: [
    { x: 11, y: 5 }, // Amar (center, lead — facing west into Kian's line)
    { x: 12, y: 5 }, // Lucian (right of Amar — defending his own home)
    { x: 11, y: 4 }, // Maya (north flank)
    { x: 11, y: 6 }, // Ning (south flank)
    { x: 12, y: 6 }  // Leo (rear-right)
  ],
  // Kian holds the central west blockade tile (col 1, row 5). Two
  // royal guards flank him on rows 4 + 6. Two crown archers behind
  // the barricades on cols 5 + 8 firing east. One royal guard at row
  // 3, one at row 7 — the back line that chases the squad if they
  // try to slip around Kian's center. Last two added in the difficulty
  // pass — a guard advancing through the center mid-street and a
  // crown archer on the south barricade ridge give the squad's escape
  // route a vertical pinch + extra ranged cover from cover terrain.
  enemy: [
    { x: 1,  y: 5 },  // Kian (center-west, blocking the road out — holdPositionUntil)
    { x: 1,  y: 4 },  // Royal Guard, north flank
    { x: 1,  y: 6 },  // Royal Guard, south flank
    { x: 5,  y: 3 },  // Crown Archer, north barricade
    { x: 5,  y: 7 },  // Crown Archer, south barricade
    { x: 3,  y: 4 },  // Royal Guard, advancing north
    { x: 3,  y: 6 },  // Royal Guard, advancing south
    { x: 7,  y: 4 },  // Royal Guard — central mid-street pincer
    { x: 8,  y: 7 }   // Crown Archer — south barricade ridge (Ba cover tile)
  ]
});

// ============== Battle 11 — The Cliffs ==============
// 12×15 vertical cliff-face map. Squad spawns NORTH on the cliff edge
// (the road from Thuling lets out here). They must descend the long
// stone STAIRCASE through the middle of the map (rows 4-12, col 5-6)
// to reach Madame Dawn's ship at the SOUTH dock (rows 13-14). Kian
// arrives with the King's elite to stop them. Cliff edges (Wb walls)
// line both sides — falling off would kill anyone, so the staircase
// is the only path down. Two stair landings (rows 7 and 10) widen
// briefly to give cover and allow tactical maneuver.
//
// Victory is defeat Kian. The script's "combined strike" lands when
// the player drops Kian's HP to zero. Lucian's death on the staircase
// is narrated in the post arc — mechanically Lucian survives B11.
//
// Map exceeds viewport vertically (15 × 48 = 720 > ~588 visible) — the
// camera scrolls. Player sees the squad on the cliff first; pans south
// to see the ship + Kian's contingent assembling on the lower stairs.
const Sn2 = t("stone");
const StU = t("stone");                 // upper landing — stairs widen here
const Mr = t("marble");                 // marble/stone polish on landings + staircase
const Cl = t("stone", "rock");          // cliff edge — impassable
const Wo = t("wood");                   // ship deck at the south end

const cliffsRows = [
  [Cl , Cl , Cl , Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Cl , Cl],
  [Cl , Cl , Cl , Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Cl , Cl],
  [Cl , Cl , Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Cl],
  [Cl , Cl , Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Cl],
  [Cl , Cl , Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Cl],
  [Cl , Cl , Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Sn2, Cl],
  [Cl , Cl , Cl , Cl , Cl , Cl , Mr , Mr , Mr , Mr , Mr , Cl , Cl , Cl , Cl , Cl],
  [Cl , Cl , Cl , Cl , Cl , Cl , Mr , Mr , Mr , Mr , Mr , Cl , Cl , Cl , Cl , Cl],
  [Cl , Cl , Cl , Cl , StU, StU, Mr , Mr , Mr , Mr , Mr , StU, Cl , Cl , Cl , Cl],
  [Cl , Cl , Cl , StU, StU, StU, Mr , Mr , Mr , Mr , Mr , StU, StU, StU, Cl , Cl],
  [Cl , Cl , Cl , StU, StU, StU, Mr , Mr , Mr , Mr , Mr , StU, StU, StU, Cl , Cl],
  [Cl , Cl , Cl , Cl , StU, StU, Mr , Mr , Mr , Mr , Mr , StU, Cl , Cl , Cl , Cl],
  [Cl , Cl , Cl , Cl , Cl , Cl , Mr , Mr , Mr , Mr , Mr , Cl , Cl , Cl , Cl , Cl],
  [Cl , Cl , Cl , StU, StU, StU, Mr , Mr , Mr , Mr , Mr , StU, StU, StU, Cl , Cl],
  [Cl , Cl , Cl , Cl , Cl , Cl , Mr , Mr , Mr , Mr , Mr , Cl , Cl , Cl , Cl , Cl],
  [Cl , Cl , Cl , Cl , Cl , Cl , Mr , Mr , Mr , Mr , Mr , Cl , Cl , Cl , Cl , Cl],
  [Cl , Cl , Cl , Cl , Cl , Cl , Mr , Mr , Mr , Mr , Mr , Cl , Cl , Cl , Cl , Cl],
  [Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo],
  [Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo , Wo],
] as const;

export const cliffsMap: MapDef = buildMap("cliffs", "Cliffs above Para Harbor", cliffsRows, {
  // Squad spawns on the cliff plateau (north). Tight formation — they
  // came down the Thuling road and met Kian's contingent already
  // positioned on the staircase below them.
  player: [
    { x: 7, y: 1 }, // Amar (center, lead)
    { x: 8, y: 1 }, // Lucian (right of Amar)
    { x: 5, y: 3 }, // Maya (north-west)
    { x: 10, y: 3 }, // Ning (north-east)
    { x: 7, y: 4 }, // Leo (rear-center)
  ],
  // Kian holds the lower landing (row 10) — the squad has to come
  // through him. Two royal guards flank him on the same landing. Two
  // crown archers on the middle landing (row 7) firing south as the
  // squad descends. Two royal guards on the upper-mid stairs (rows
  // 8-9) sealing the descent so the squad can't simply rush past.
  enemy: [
    { x: 7, y: 13 }, // Kian (lower landing center — tags["boss"])
    { x: 5, y: 13 }, // Royal Guard flanking Kian (west)
    { x: 10, y: 13 }, // Royal Guard flanking Kian (east)
    { x: 4, y: 9 }, // Crown Archer, middle landing west
    { x: 11, y: 9 }, // Crown Archer, middle landing east
    { x: 7, y: 10 }, // Royal Guard, mid-stair seal
    { x: 8, y: 10 }, // Royal Guard, mid-stair seal
  ]
}, (_x, y) => {
  // The descent the whole battle is about. The clifftop (rows 0-5) is the
  // high ground; the staircase drops half a level per row — each step a
  // visible riser — past the two landings; the ship deck is sea level.
  // A full level off the clifftop edge into the first stair gives the
  // top of the cliff its bite.
  if (y <= 5) return 6;
  if (y >= 17) return 0;
  return 5 - (y - 6) * 0.45;
});

// ============== Battle 12 — The Ravage (Grude harbor district) ==============
// 14×11 cobblestone harbor district at the foot of Grude's east port.
// Squad disembarks from Dawn's ship at the south wooden dock (rows 9-10)
// and must push north through Archbold's interception detail to reach
// the city interior (north edge, where Dawn's safe house waits). Stone
// warehouses line both sides of the street (col 0-2 + col 11-13 are
// solid wall) — only the central corridor is passable. Two stacked
// crates serve as cover at row 5; a marble customs platform at row 3
// gives the King's elite a small height advantage.
//
// Map fits in the viewport (no camera scrolling required). Victory:
// rout the elite OR escape any unit to row 0 (push into the city).
//
// Reuses tile aliases declared earlier: Cb (cobblestone), Wo (wood),
// Wb (wall), Tr (cobblestone+torch), Mr (marble), Bd (cobblestone+barricade).
const Wt2 = t("water"); // harbor edge

const ravageRows = [
  [Wb, Wb, Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Wb, Wb, Wb, Wb], // row 0 — north city gate (escape edge)
  [Wb, Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb, Wb, Wb], // row 1
  [Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb, Wb], // row 2 — warehouse fronts narrow to street
  [Wb, Cb, Cb, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Cb, Cb, Wb], // row 3 — marble customs platform
  [Wb, Cb, Cb, Cb, Cb, Tr, Cb, Cb, Tr, Cb, Cb, Cb, Cb, Wb], // row 4 — street with corner torches
  [Wb, Cb, Cb, Cb, Bd, Cb, Cb, Cb, Cb, Bd, Cb, Cb, Cb, Wb], // row 5 — barricade cover
  [Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb], // row 6 — open street
  [Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb], // row 7 — open street
  [Wb, Cb, Cb, Cb, Cb, Tr, Cb, Cb, Tr, Cb, Cb, Cb, Cb, Wb], // row 8 — dock-side torches
  [Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo], // row 9 — wooden dock (squad spawn)
  [Wt2,Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wt2] // row 10 — water/dock edge
] as const;

export const ravageMap: MapDef = buildMap("ravage", "Grude Harbor District", ravageRows, {
  // Squad steps off Dawn's ship onto the south dock. Tight formation —
  // they're all four still finding their land legs after fourteen
  // months at sea, which is how Archbold's spotter knew when to
  // signal the interception.
  player: [
    { x: 6, y: 9 },  // Amar (center, just off the gangway)
    { x: 5, y: 9 },  // Maya (left of Amar)
    { x: 7, y: 9 },  // Ning (right of Amar)
    { x: 6, y: 10 }  // Leo (rear-center, dactyl on the dock)
  ],
  // Archbold's interception detail. Captain on the marble customs
  // platform (row 3, center) — has full sight down the street and
  // commands the line. Two royal guards mid-street (row 5) behind
  // the barricades. Two crown archers flanking on the customs
  // platform (row 3 east + west). One royal guard advancing south
  // (row 6) to engage the squad before they can find cover.
  enemy: [
    { x: 7,  y: 3 },  // Captain (named — see ENEMIES.archboldCaptain)
    { x: 4,  y: 3 },  // Crown Archer, customs west
    { x: 10, y: 3 },  // Crown Archer, customs east
    { x: 4,  y: 5 },  // Royal Guard behind west barricade
    { x: 9,  y: 5 },  // Royal Guard behind east barricade
    { x: 7,  y: 6 }   // Royal Guard advancing south
  ]
});

// ============== Battle 13 — Madame Dawn's Rebellion =====================
// 14×11 cobblestone city plaza outside Archbold's nephew's residence
// in Grude's upper district. Dawn's coordinated strike — one of
// twelve operations across the city in a single coordinated night,
// per Madame Dawn's plan. The squad strikes the nephew's estate
// alongside Rose, Dawn's most senior lieutenant. The estate's
// ornate marble steps run across the north (row 0-1, the captain's
// firing position). Stone walls flank east + west (the residential
// neighbors). A central plaza with a dry fountain at the middle
// gives both sides something to fight around. Two stone benches at
// rows 4 + 7 act as low-cover barricades.
//
// Map fits in the viewport (14*48=672w, 11*48=528h — both under
// the playable area). Camera doesn't scroll, players see the whole
// engagement at once. Tight + intimate, fitting the heart-tier
// difficulty label.
//
// Reuses tile aliases declared earlier: Cb (cobblestone), Wb (wall),
// Bd (cobblestone+barricade), Mr (marble), Tr (cobblestone+torch).
// Pl = stone+pillar (the plaza's ornamental columns).
const Pl = t("stone", "pillar");

const dawnRebellionRows = [
  [Wb, Wb, Wb, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Wb, Wb],
  [Wb, Wb, Wb, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Wb, Wb],
  [Wb, Wb, Mr, Mr, Mr, Pl, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Mr, Pl, Mr, Mr, Mr, Wb],
  [Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Tr, Cb, Cb, Cb, Tr, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Wb, Cb, Bd, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Bd, Cb, Cb, Wb],
  [Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Pl, Pl, Pl, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Pl, Pl, Pl, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Wb, Cb, Bd, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Bd, Cb, Cb, Wb],
  [Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Tr, Cb, Cb, Cb, Tr, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb, Wb],
] as const;

export const dawnRebellionMap: MapDef = buildMap("dawn_rebellion", "Plaza of Archbold's Nephew", dawnRebellionRows, {
  // Squad enters the plaza from the south alley with Rose at the
  // lead — she knows the layout. Tight formation across rows 9-10
  // so the round-1 dialogue with Rose adjacent fires reliably and
  // the squad can choose flanks without committing immediately.
  player: [
    { x: 9, y: 13 }, // Amar (center, just behind Rose)
    { x: 10, y: 13 }, // Rose (lead — she's been the eyes on this estate for weeks)
    { x: 7, y: 13 }, // Maya (left of Amar)
    { x: 12, y: 13 }, // Ning (right, bowline)
    { x: 9, y: 12 }, // Leo (forward-left, dactyl)
    { x: 10, y: 12 }, // (front-right, open slot — see buildPlayers)
  ],
  // Royal Captain on the marble residence steps. Two crown archers
  // flanking him on the podium (row 1 cols 4 + 9) with full sight
  // down the plaza. Two royal guards behind the north benches
  // (row 4 cols 2 + 11). One royal guard advancing south through
  // the fountain channel (row 7 col 7) to engage the squad
  // directly. Total 6 enemies — same count as B7, level-bumped to
  // reflect Grude empire elite.
  enemy: [
    { x: 9, y: 0 }, // Royal Captain (boss — holdPositionUntil)
    { x: 6, y: 1 }, // Crown Archer, podium west (x=3 is a column)
    { x: 13, y: 1 }, // Crown Archer, podium east (x=10 is a column)
    { x: 3, y: 5 }, // Royal Guard, north bench west
    { x: 16, y: 5 }, // Royal Guard, north bench east
    { x: 10, y: 9 }, // Royal Guard, advancing through fountain
  ]
});

// ============== Battle 14 — The Origin =================================
// 13×11 Grude inner-district street outside Madame Dawn's safe house
// (the upstairs of a candle-maker's shop). The night the squad learns
// Amar's parentage, King Archbold's household guard arrives to retrieve
// him — the empire wants its hidden heir alive. The squad fights up the
// street to break the retrieval before Lord Castor's detail can pin them
// against the safe-house door.
//
// Buildings (Wb walls) frame both sides of the street. Cover comes from
// two ranks of overturned-market barricades (Bd, rows 3 + 7), a pair of
// stone well-heads / pillars (Pl, col 6 rows 4 + 6) breaking the central
// sight line, and street torches (Tr). A full-width junction at row 5
// lets either side swing a flank.
//
// Map fits the viewport (13*48=624w, 11*48=528h) — no camera scroll.
// Reuses tile aliases declared earlier: Cb (cobblestone), Wb (wall),
// Bd (cobblestone+barricade), Tr (cobblestone+torch), Mr (marble),
// Pl (stone+pillar — the street well-heads).
const originRows = [
  [Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb, Wb], // ← north street mouth (Castor's detail enters)
  [Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Cb, Cb, Cb, Tr, Cb, Cb, Cb, Tr, Cb, Cb, Cb, Wb], // ← street torches
  [Wb, Cb, Bd, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Bd, Cb, Wb], // ← north market barricades (cover)
  [Wb, Cb, Cb, Cb, Cb, Cb, Pl, Cb, Cb, Cb, Cb, Cb, Wb], // ← street well-head
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb], // ← full-width cross-street junction
  [Wb, Cb, Cb, Cb, Cb, Cb, Pl, Cb, Cb, Cb, Cb, Cb, Wb], // ← matching well-head
  [Wb, Cb, Bd, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Bd, Cb, Wb], // ← south barricades near the safe house
  [Wb, Cb, Cb, Cb, Tr, Cb, Cb, Cb, Tr, Cb, Cb, Cb, Wb], // ← south torches
  [Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb], // ← squad spawn line
  [Wb, Wb, Cb, Cb, Cb, Mr, Mr, Mr, Cb, Cb, Cb, Wb, Wb]  // ← safe-house front (marble doorstep)
] as const;

export const originMap: MapDef = buildMap("origin", "Safe-House Street, Grude", originRows, {
  // Squad spawns south, on the cobbles just outside the safe-house
  // door (the marble doorstep at row 10). Tight line on row 9 so the
  // round-1 dialogue fires reliably and the squad can pick a flank up
  // the street.
  player: [
    { x: 5, y: 9 }, // Maya
    { x: 6, y: 9 }, // Amar (center)
    { x: 7, y: 9 }, // Ning (bowline)
    { x: 8, y: 9 }, // Leo (dactyl, east)
    { x: 7, y: 8 }  // Veya

  ],
  // Lord Castor at the north street mouth — holdPositionUntil keeps
  // him back until his line is thinned. Two crown archers on row 1
  // with sight straight down the street; two royal guards at the
  // north barricades (row 2); one guard advancing through the center.
  enemy: [
    { x: 6, y: 0 },  // Lord Castor (boss — holdPositionUntil)
    { x: 3, y: 1 },  // Crown Archer, west
    { x: 9, y: 1 },  // Crown Archer, east
    { x: 5, y: 2 },  // Royal Guard, north-center west
    { x: 7, y: 2 },  // Royal Guard, north-center east
    { x: 6, y: 3 }   // Royal Guard, advancing down the street
  ]
});

// ============== Battle 15 — A Coup Within a Coup =======================
// 12×10 enclosed courtyard behind the candle-maker's shop — the same
// courtyard where Rose is buried under the lemon tree. The night Maya's
// hunt for the leak closes: Quartermaster Coyne, Dawn's own safe-house
// quartermaster, is exposed as Archbold's mole. Cornered, he makes his
// stand at the courtyard's back gate with the people he's turned + the
// imperial agents he smuggled in. The squad fights inward from the
// shop door (south) to stop him reaching the gate (north).
//
// Walls (Wb) enclose the courtyard on all four sides — only two gaps:
// the shop door (south, squad spawn) and the back gate (north, Coyne's
// escape). The lemon tree (Lt) over Rose's grave breaks the centre
// line; a stone well (Pl) and two ranks of stacked-crate barricades
// (Bd) give cover. Street torches (Tr) at the corners.
//
// Map fits the viewport (12*48=576w, 10*48=480h) — no camera scroll.
// Reuses Cb / Wb / Bd / Tr / Pl. New alias Lt = cobblestone + tree
// (the lemon tree).
const Lt = t("cobblestone", "tree");

const courtyardRows = [
  [Wb, Wb, Wb, Wb, Cb, Cb, Cb, Cb, Wb, Wb, Wb, Wb], // ← north wall + back gate gap (Coyne's escape)
  [Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Cb, Cb, Tr, Cb, Cb, Cb, Cb, Tr, Cb, Cb, Wb], // ← corner torches
  [Wb, Cb, Cb, Cb, Cb, Cb, Lt, Cb, Cb, Cb, Cb, Wb], // ← lemon tree (Rose's grave)
  [Wb, Cb, Bd, Cb, Cb, Cb, Cb, Cb, Cb, Bd, Cb, Wb], // ← stacked-crate barricades
  [Wb, Cb, Cb, Cb, Cb, Pl, Cb, Cb, Cb, Cb, Cb, Wb], // ← courtyard well
  [Wb, Cb, Cb, Tr, Cb, Cb, Cb, Cb, Tr, Cb, Cb, Wb], // ← corner torches
  [Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb], // ← squad spawn line
  [Wb, Wb, Wb, Wb, Cb, Cb, Cb, Cb, Wb, Wb, Wb, Wb]  // ← south wall + shop-door gap (squad enters)
] as const;

export const courtyardMap: MapDef = buildMap("courtyard", "Candle-Maker's Courtyard, Grude", courtyardRows, {
  // Squad pushes in from the candle-maker's back door (south gap).
  // Tight line on row 8 so the round-1 dialogue fires reliably.
  player: [
    { x: 4, y: 8 }, // Maya
    { x: 5, y: 8 }, // Amar (center)
    { x: 6, y: 8 }, // Ning (bowline)
    { x: 7, y: 8 }, // Leo (dactyl)
    { x: 5, y: 7 }  // Veya

  ],
  // Coyne holds the back gate (north) — holdPositionUntil keeps him
  // there until his line is thinned. Two imperial agents he smuggled
  // in flank the north (row 2); two turncoat rebels hold the crate
  // barricades (row 5); one turncoat archer covers the centre.
  enemy: [
    { x: 6, y: 0 }, // Quartermaster Coyne (boss — holdPositionUntil at the gate)
    { x: 3, y: 2 }, // imperial agent (royal guard), NW
    { x: 8, y: 2 }, // imperial agent (royal archer), NE
    { x: 3, y: 5 }, // turncoat (bandit swordsman), west barricade
    { x: 6, y: 3 }, // turncoat archer (bandit archer), north-centre
    { x: 8, y: 5 }  // turncoat (bandit spearton), east barricade
  ]
});

// ============== Battle 16 — Dawn's Proposal ============================
// 14×9 stone bridge over the Grude river. Dawn has proposed that Amar
// claim the Anthros throne as the rebellion's open heir; she sends the
// squad out on a night errand to seal the next step. On the bridge,
// King Archbold's answer arrives — no longer a retrieval detail but a
// kill-team. The empire has decided a living heir is worse than a dead
// one. Wren, the King's Knife, springs the ambush from both ends.
//
// Stone parapets (Wb) wall the bridge along its north + south edges —
// the deck is the whole playable area, a long east-west span. Stalled
// market carts (Bd barricades) and bridge lamps (Tr torches) give the
// only cover. The squad enters mid-WEST; Wren's main force holds the
// EAST end while two hired knives drop in behind from the west — a
// two-sided pinch with nowhere to flank but along the deck.
//
// Map fits the viewport (14*48=672w, 9*48=432h) — no camera scroll.
// Reuses Cb (cobblestone deck) / Wb (parapet) / Bd (cart) / Tr (lamp).
const bridgeRows = [
  [Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb], // ← north parapet
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb],
  [Cb, Cb, Cb, Tr, Cb, Cb, Cb, Cb, Cb, Cb, Tr, Cb, Cb, Cb], // ← bridge lamps
  [Cb, Cb, Cb, Cb, Cb, Bd, Cb, Cb, Bd, Cb, Cb, Cb, Cb, Cb], // ← stalled carts (cover)
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb], // ← open centre lane
  [Cb, Cb, Cb, Cb, Cb, Bd, Cb, Cb, Bd, Cb, Cb, Cb, Cb, Cb], // ← matching carts
  [Cb, Cb, Cb, Tr, Cb, Cb, Cb, Cb, Cb, Cb, Tr, Cb, Cb, Cb], // ← bridge lamps
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb],
  [Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb, Wb]  // ← south parapet
] as const;

export const bridgeMap: MapDef = buildMap("bridge", "River Bridge, Grude", bridgeRows, {
  // Squad mid-west, in a tight block so the round-1 ambush dialogue
  // fires reliably and the two-sided pinch lands on a formed-up unit.
  player: [
    { x: 1, y: 3 }, // Maya
    { x: 1, y: 4 }, // Amar (center)
    { x: 1, y: 5 }, // Ning (bowline)
    { x: 2, y: 4 }, // Leo (dactyl)
    { x: 2, y: 3 }  // Veya

  ],
  // Wren rushes — no holdPositionUntil; the King's Knife comes
  // straight for Amar. Her main force holds the east end; two hired
  // knives drop in behind the squad from the west to spring the pinch.
  enemy: [
    { x: 12, y: 4 }, // Wren, the King's Knife (boss — aggressive, no hold)
    { x: 11, y: 3 }, // Royal Guard, east
    { x: 12, y: 2 }, // Crown Archer, east-north
    { x: 12, y: 6 }, // Crown Archer, east-south
    { x: 2,  y: 2 }, // hired knife (bandit swordsman) — drops in behind, NW (x=3 is a lamp)
    { x: 2,  y: 6 }  // hired knife (bandit swordsman) — drops in behind, SW (x=3 is a lamp)
  ]
});

// ============== Battle 17 — Dawn's Lie =================================
// 13×10 Grude harbour quay. Khione has told Amar the whole of it — Dawn's
// rebellion spends Anthros as fuel; the heir is the spark. The squad
// breaks with Dawn and runs for Khione's ship at the south dock. Marshal
// Othren, Dawn's Grude garrison commander and a true believer in the
// plan, will not let the rebellion's lynchpin walk: he forms his
// loyalists across the quay between the squad and the gangway.
//
// Squad enters from the city edge (NORTH); the ship's gangway (Wo wood
// planks) is the SOUTH escape. Warehouse walls (Wb) flank the quay;
// stacked cargo (Bd) and dock lamps (Tr) give the only cover. Othren's
// line holds the open middle.
//
// Victory is anyOf(escapeToTile gangway, routEnemies) — mirrors B10's
// escape framing: the squad can break through and board, or clear the
// quay outright.
//
// Map fits the viewport (13*48=624w, 10*48=480h) — no camera scroll.
// Reuses Cb / Wb / Bd / Tr; Wo (ship's-deck wood) from the cliffs map.
const quayRows = [
  [Wb, Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb, Wb],
  [Wb, Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb, Wb],
  [Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Wb, Cb, Cb, Cb, Tr, Cb, Cb, Cb, Cb, Cb, Cb, Tr, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Wb, Cb, Bd, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Bd, Cb, Cb, Cb, Wb],
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb],
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb],
  [Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb],
  [Wb, Wb, Cb, Bd, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Bd, Cb, Cb, Cb, Wb],
  [Wb, Wb, Cb, Cb, Cb, Tr, Cb, Cb, Cb, Cb, Cb, Cb, Tr, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Wb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Cb, Wb],
  [Wb, Wb, Wb, Wb, Wb, Wb, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wo, Wb, Wb, Wb, Wb, Wb],
] as const;

export const quayMap: MapDef = buildMap("quay", "Harbour Quay, Grude", quayRows, {
  // Squad enters north from the city, tight block so the round-1
  // dialogue fires reliably before they commit to a lane south.
  player: [
    { x: 6, y: 1 }, // Maya
    { x: 8, y: 1 }, // Amar (center)
    { x: 9, y: 1 }, // Ning (bowline)
    { x: 10, y: 1 }, // Leo (dactyl)
    { x: 8, y: 2 }, // Veya
    { x: 9, y: 2 }, // Corin
  ],
  // Othren holds the open quay centre — holdPositionUntil keeps his
  // line formed until the squad thins it. Loyalist fighters (Dawn's
  // rebellion rank-and-file, bandit-tier) spread across rows 3-5.
  enemy: [
    { x: 9, y: 5 }, // Marshal Othren (boss — holdPositionUntil)
    { x: 4, y: 5 }, // loyalist (bandit swordsman), west
    { x: 14, y: 5 }, // loyalist (bandit spearton), east
    { x: 4, y: 4 }, // loyalist archer (bandit archer), west cargo
    { x: 14, y: 4 }, // loyalist archer (bandit archer), east cargo
    { x: 9, y: 6 }, // loyalist (bandit swordsman), centre-south
  ]
});

// ============== Battle 18 — Seven Names, One Choice ==============
// 13×11 ship's deck. Khione's ship under boarding attack three days out of
// Grude. A wood deck (Dk) floats inside a border of open sea (Sea) — the
// squad cannot retreat off the edges; they hold amidships and repel the
// boarders who come over BOTH rails (east + west) and the bow (north). Crate
// stacks (Cr = barricade) give cover along the centreline; two masts/capstans
// (Mp = rock) break the long fore-aft sight line so the boarders' archers
// can't rake the whole deck. The squad starts clustered around the wheel at
// the stern (south) so the round-1 dialogue fires before they commit.
const Sea = t("water");                 // open sea — impassable border
const Dk = t("wood");                   // ship's deck
const Cr = t("wood", "barricade");      // lashed cargo crates (cover)
const Mp = t("wood", "rock");           // mast base / capstan (blocks LoS)
const shipDeckRows = [
  [Sea, Sea, Sea, Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Sea, Sea, Sea], // ← bow (boarders come over)
  [Sea, Sea, Dk,  Dk,  Dk,  Dk,  Mp,  Dk,  Dk,  Dk,  Dk,  Sea, Sea],
  [Sea, Dk,  Dk,  Dk,  Cr,  Dk,  Dk,  Dk,  Cr,  Dk,  Dk,  Dk,  Sea], // ← fore cargo (cover)
  [Sea, Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Sea],
  [Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk ], // ← west rail ←→ east rail
  [Dk,  Dk,  Cr,  Dk,  Dk,  Dk,  Mp,  Dk,  Dk,  Dk,  Cr,  Dk,  Dk ], // ← waist (main fight line)
  [Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk ],
  [Sea, Dk,  Dk,  Dk,  Cr,  Dk,  Dk,  Dk,  Cr,  Dk,  Dk,  Dk,  Sea], // ← aft cargo (cover)
  [Sea, Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Sea],
  [Sea, Sea, Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Sea, Sea],
  [Sea, Sea, Sea, Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Dk,  Sea, Sea, Sea]  // ← stern / wheel (squad starts)
] as const;

export const shipDeckMap: MapDef = buildMap("ship_deck", "Khione's Deck, Open Water", shipDeckRows, {
  // Squad clustered at the stern around the wheel (row 9-10). Tight block so
  // the round-1 boarding dialogue fires before they push forward.
  player: [
    { x: 4, y: 9 }, // Maya
    { x: 5, y: 9 }, // Amar (center)
    { x: 6, y: 9 }, // Ning (bowline)
    { x: 7, y: 9 }, // Leo (dactyl)
    { x: 5, y: 8 }, // Veya
    { x: 6, y: 8 }  // Corin

  ],
  // Boarders swarm the bow + both rails. No boss — this is a swarm to be
  // broken (rout victory), the empire's last grab at the heir before the
  // choice. The imperial line-captain (banditSwordsman, strongest) leads
  // from the bow centre.
  enemy: [
    { x: 6, y: 0 },  // imperial line-captain, bow centre
    { x: 4, y: 0 },  // boarder, bow west
    { x: 8, y: 0 },  // boarder, bow east
    { x: 0, y: 4 },  // boarder over the west rail
    { x: 12, y: 4 }, // boarder over the east rail
    { x: 2, y: 2 },  // boarding archer, fore-west
    { x: 10, y: 2 }  // boarding archer, fore-east
  ]
});

// ═══════════════ Battle 19 — the Seven Path openers ═══════════════
// One battle per path; only the chosen path's opener is ever reached in a
// given run. Three reuse an existing tile layout under a new identity (the
// geometry reads correctly for the new fiction, and per-run only one B19 is
// seen, so layout reuse across paths costs nothing); two are authored fresh
// for the solo-Amar chapters, which want small, intimate maps.

// ---- Revolution: the border granary compound ----
// The candle-maker's-courtyard geometry re-cast as an imperial supply
// depot: same walled yard, crate barricades = grain sledges, the well =
// the tally post. Squad breaches the south gap; the depot garrison forms
// at the north stores.
export const granaryMap: MapDef = buildMap("granary", "Border Granary, Imperial Depot", courtyardRows, {
  player: [
    { x: 4, y: 8 }, // Maya
    { x: 5, y: 8 }, // Amar
    { x: 6, y: 8 }, // Ning
    { x: 7, y: 8 }, // Leo
    { x: 5, y: 7 }, // Veya
    { x: 4, y: 7 }  // Corin

  ],
  // Depot commander (royal captain) holds the north stores; garrison
  // spread through the yard behind the sledges.
  enemy: [
    { x: 6, y: 0 }, // depot commander (royal captain — holdPositionUntil)
    { x: 3, y: 2 }, // royal guard, NW stores
    { x: 8, y: 2 }, // royal archer, NE stores
    { x: 3, y: 5 }, // royal guard, west sledges
    { x: 8, y: 5 }, // royal guard, east sledges
    { x: 6, y: 3 }  // royal archer, centre
  ]
});

// ---- Duty: the frontier bridge ----
// The Grude river-bridge geometry re-cast as the frontier crossing Amar's
// column is ordered to hold. The squad forms up on the WEST end; the
// imperial push comes across from the EAST. Victory is surviving the
// assault, not clearing it — the column holds, whatever it costs.
export const dutyBridgeMap: MapDef = buildMap("duty_bridge", "Frontier Bridge", bridgeRows, {
  player: [
    { x: 2, y: 3 }, // Maya
    { x: 1, y: 4 }, // Amar (the captaincy — center of the line)
    { x: 2, y: 5 }, // Ning
    { x: 3, y: 4 }, // Leo
    { x: 2, y: 2 }, // Veya
    { x: 3, y: 3 }  // Corin

  ],
  // The imperial column stacks the east end and pushes west down the
  // deck. No boss — pressure is the enemy.
  enemy: [
    { x: 12, y: 4 }, // vanguard sergeant (royal guard)
    { x: 12, y: 2 }, // royal guard, north file
    { x: 12, y: 6 }, // royal guard, south file
    { x: 13, y: 3 }, // royal archer
    { x: 13, y: 5 }, // royal archer
    { x: 11, y: 4 }  // royal guard, point
  ]
});

// ---- Mercy: Greywall fort ----
// The monastery geometry re-cast as a border fort's interior — the same
// pillared halls read as barracks walls and the altar platform as the keep
// steps. Only the holdout captain and his few hardliners fight; the rest
// of the garrison has stood down and watches from the walls.
export const fortMap: MapDef = buildMap("mercy_fort", "Greywall Fort", monasteryRows, {
  player: [
    { x: 7, y: 13 }, // Amar
    { x: 8, y: 13 }, // Maya
    { x: 6, y: 14 }, // Ning
    { x: 9, y: 14 }, // Leo
    { x: 7, y: 12 }, // Veya
    { x: 8, y: 12 }  // Corin

  ],
  // The holdout captain at the keep steps; three hardliners between him
  // and the gate. Deliberately sparse — this is a duel of conviction,
  // not a siege.
  enemy: [
    { x: 7,  y: 1 }, // holdout captain (royal captain — holdPositionUntil)
    { x: 5,  y: 5 }, // hardliner (royal guard), west funnel
    { x: 10, y: 5 }, // hardliner (royal guard), east funnel
    { x: 7,  y: 9 }  // hardliner (royal archer), mid hall
  ]
});

// ---- Exile: the cold pass north ----
// 10×8 snow saddle between rock walls. Amar rides north alone; the
// assassins' three sets of tracks converge on the pass ahead of him.
// Small and open — a solo duel in the snow, nowhere to hide on either
// side. Reuses the mountain snow aliases (SN / SR / ST).
const exilePassRows = [
  [SR, SR, SN, SN, SN, SN, SN, SN, SR, SR], // ← north saddle (the way out)
  [SR, SN, SN, SN, ST, SN, SN, SN, SN, SR],
  [SN, SN, SR, SN, SN, SN, SN, SR, SN, SN],
  [SN, SN, SN, SN, SN, SN, SN, SN, SN, SN], // ← open middle — the killing ground
  [SN, SN, SN, SN, SN, SN, SN, SN, SN, SN],
  [SN, ST, SN, SN, SR, SN, SN, SN, ST, SN],
  [SR, SN, SN, SN, SN, SN, SN, SN, SN, SR],
  [SR, SR, SN, SN, SN, SN, SN, SN, SR, SR]  // ← south trail (Amar rides in)
] as const;

export const exilePassMap: MapDef = buildMap("exile_pass", "The Cold Pass", exilePassRows, {
  // Amar alone, south trail.
  player: [
    { x: 4, y: 7 } // Amar — no one else is coming
  ],
  // Three assassins converge: one holds the north saddle, two close the
  // jaws from the mid-pass flanks.
  enemy: [
    { x: 5, y: 0 }, // assassin, north saddle
    { x: 1, y: 3 }, // assassin, west jaw
    { x: 8, y: 3 }  // assassin (archer), east jaw
  ]
});

// ---- Forgetting: the cottage cove ----
// 11×8 southern-coast cove: water along the north edge, a sand shore, the
// cottage's low wall in the southeast, grass and boulders inland. The
// bounty men come up the beach; Amar meets them with a fisherman's calm
// and a soldier's hands. Fresh aliases (Snd/GrR/GrT) — sand shore, grass
// boulders, wind-bent shore trees.
const Snd = t("sand");
const GrR = t("grass", "rock");
const GrT = t("grass", "tree");
const cottageCoveRows = [
  [Wa,  Wa,  Wa,  Wa,  Wa,  Wa,  Wa,  Wa,  Wa,  Wa,  Wa ], // ← open water
  [Wa,  Wa,  Snd, Snd, Snd, Snd, Snd, Snd, Snd, Wa,  Wa ], // ← surf line
  [Snd, Snd, Snd, Snd, Snd, Snd, Snd, Snd, Snd, Snd, Snd], // ← the beach (they come up here)
  [G,   Snd, Snd, G,   G,   Snd, Snd, G,   Snd, Snd, G  ],
  [G,   G,   GrR, G,   G,   G,   G,   GrR, G,   G,   G  ], // ← grass shelf + boulders
  [G,   GrT, G,   G,   G,   G,   G,   G,   G,   GrT, G  ], // ← wind-bent trees
  [G,   G,   G,   G,   GrR, G,   G,   G,   Wb,  Wb,  Wb ], // ← cottage wall, SE corner
  [G,   G,   G,   G,   G,   G,   G,   G,   Wb,  G,   G  ]  // ← the door Amar stands in front of
] as const;

export const cottageCoveMap: MapDef = buildMap("cottage_cove", "A Fisherman's Cottage, South Coast", cottageCoveRows, {
  // Amar alone, between the cottage door and the beach.
  player: [
    { x: 7, y: 6 } // Amar — the name that is not Amar
  ],
  // Bounty men come up the beach from the west surf line.
  enemy: [
    { x: 2, y: 2 }, // bounty leader, beach west
    { x: 5, y: 2 }, // bounty man, beach centre
    { x: 3, y: 4 }  // bounty archer, grass shelf
  ]
});

// ============== Battle 20 — Dawn's War ==============
// 14×10 open war-field outside Grude. Two armies met here an hour ago;
// the squad fights in the seam. A dirt track crosses the field east-west,
// a shell of a supply wagon burns mid-field, and a broken trench of
// rubble runs down the centre — cover for whoever reaches it first.
// General Serrick anchors the imperial line NE behind his guard; the
// squad enters SW with Dawn's (unseen) rebels engaged off-map north.
const Wf = t("grass");                  // trampled field
const Wd = t("dirt");                   // supply track
const Wz = t("rubble");                 // broken trench line
const Wk = t("grass", "barricade");     // thrown-up fieldworks
const Wx = t("dirt", "wagon");          // burning supply wagon
const Wr = t("grass", "rock");          // field boulders
const warFieldRows = [
  [Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wr, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf],
  [Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf],
  [Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wz, Wz, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf],
  [Wf, Wf, Wf, Wf, Wr, Wf, Wf, Wf, Wf, Wf, Wf, Wz, Wz, Wf, Wf, Wf, Wk, Wf, Wf, Wf, Wf, Wf],
  [Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wk, Wf, Wf, Wf, Wz, Wz, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf],
  [Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wz, Wz, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf],
  [Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wx, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd],
  [Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wd, Wx, Wd, Wd, Wd, Wd, Wd, Wd],
  [Wf, Wf, Wf, Wf, Wf, Wk, Wf, Wf, Wf, Wf, Wz, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf],
  [Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wz, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf],
  [Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wz, Wf, Wf, Wf, Wf, Wk, Wf, Wf, Wf, Wr, Wf, Wf],
  [Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wz, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf],
  [Wf, Wf, Wf, Wf, Wr, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf, Wf],
];
export const warFieldMap: MapDef = buildMap("war_field", "The Field Before Grude", warFieldRows, {
  // Squad enters SW, clustered for the round-1 dialogue.
  player: [
    { x: 2, y: 11 }, // Maya
    { x: 3, y: 11 }, // Amar
    { x: 2, y: 9 }, // Ning
    { x: 3, y: 9 }, // Leo
    { x: 5, y: 9 }, // Veya
    { x: 5, y: 11 }, // Corin
  ],
  // Serrick holds the NE rise behind his guard line (holdPositionUntil).
  enemy: [
    { x: 18, y: 3 }, // General Serrick (boss)
    { x: 15, y: 4 }, // royal guard, line west
    { x: 18, y: 5 }, // royal guard, line centre
    { x: 19, y: 4 }, // royal guard, line east
    { x: 13, y: 3 }, // royal archer, ridge west
    { x: 19, y: 1 }, // royal archer, ridge east
  ]
});

// ============== Battle 21 — Archbold Advances ==============
// 14×9 stretch of the King's road west. The squad holds a barricade
// line thrown across the road at mid-map; Halden's vanguard pours in
// from the east edge. Forest crowds the north verge (cover for Ning),
// open field south. Victory is surviving six rounds, so the map is a
// funnel: everything east of the barricades belongs to the enemy.
const Kg = t("grass");                  // road verge
const Kr = t("dirt");                   // the King's road
const Kb = t("dirt", "barricade");      // the squad's held line
const Kf = t("grass", "fence");         // field fencing, south
const Kw = t("forest");                 // north woods
const Kt = t("forest", "tree");         // thick trunk (blocks)
const kingsRoadRows = [
  [Kw, Kw, Kw, Kw, Kt, Kw, Kw, Kw, Kw, Kw, Kt, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kt, Kw, Kw, Kw],
  [Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw],
  [Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw, Kw],
  [Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg],
  [Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kb, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr],
  [Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kb, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr],
  [Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr],
  [Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kb, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr, Kr],
  [Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kf, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg],
  [Kg, Kg, Kg, Kg, Kf, Kg, Kg, Kg, Kf, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kf, Kg, Kg, Kg, Kg, Kg],
  [Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg, Kg],
];
export const kingsRoadMap: MapDef = buildMap("kings_road", "The King's Road West", kingsRoadRows, {
  // Squad behind the barricade line, blocking the road.
  player: [
    { x: 6, y: 4 }, // Amar, on the road north lane
    { x: 6, y: 5 }, // Maya, road south lane
    { x: 5, y: 2 }, // Ning, forest verge (bow line)
    { x: 6, y: 6 }, // Leo, south shoulder
    { x: 5, y: 4 }, // Veya
    { x: 8, y: 4 }, // Corin
  ],
  // The vanguard pours in from the east edge, Halden at the front —
  // no holdPosition; he leads the push himself.
  enemy: [
    { x: 19, y: 5 }, // Captain Halden (boss, front and centre)
    { x: 21, y: 4 }, // royal guard
    { x: 21, y: 6 }, // royal guard
    { x: 19, y: 2 }, // royal guard, verge north
    { x: 21, y: 1 }, // royal archer, woods line
    { x: 21, y: 8 }, // royal archer, field south
    { x: 19, y: 9 }, // royal archer, far south
  ]
});

// ============== Battle 22 — Grude Burns ==============
// 12×10 upper-district streets. Two building blocks (walls) form the
// market row's alleys; Brask's burn teams have already torched the
// south corners (torches read as fire), rubble marks what's fallen.
// The squad enters the south gate; Brask directs from the fountain
// square north until his teams are thinned.
const Us = t("stone");                  // street cobbles
const Uw = t("wall");                   // building block
const Uf = t("stone", "torch");         // street on fire
const Ur = t("rubble");                 // collapsed frontage
const Ub = t("stone", "barricade");     // dragged-out furniture line
const upperDistrictRows = [
  [Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us],
  [Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us],
  [Us, Us, Uw, Uw, Uw, Uw, Us, Us, Us, Us, Uw, Uw, Uw, Uw, Uw, Us, Us],
  [Us, Us, Uw, Uw, Uw, Uw, Us, Us, Uf, Us, Uw, Uw, Uw, Uw, Uw, Us, Us],
  [Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Ur, Us, Us, Us],
  [Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us],
  [Us, Us, Uf, Us, Us, Ub, Us, Us, Us, Us, Ub, Us, Us, Us, Us, Us, Us],
  [Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Uf, Us],
  [Us, Us, Uw, Uw, Uw, Uw, Us, Us, Ur, Us, Uw, Uw, Uw, Uw, Uw, Us, Us],
  [Us, Us, Uw, Uw, Uw, Uw, Us, Us, Uw, Us, Uw, Uw, Uw, Uw, Uw, Us, Us],
  [Us, Us, Uw, Uw, Uw, Uw, Us, Us, Us, Us, Uw, Uw, Uw, Uw, Uw, Us, Us],
  [Us, Us, Us, Us, Us, Ur, Us, Us, Us, Uf, Us, Us, Us, Us, Us, Us, Us],
  [Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us, Us],
];
export const upperDistrictMap: MapDef = buildMap("upper_district", "The Upper District, Grude", upperDistrictRows, {
  // Squad enters the south gate.
  player: [
    { x: 6, y: 12 }, // Amar
    { x: 7, y: 12 }, // Maya
    { x: 9, y: 12 }, // Ning
    { x: 10, y: 12 }, // Leo
    { x: 7, y: 11 }, // Veya
    { x: 6, y: 11 }, // Corin
  ],
  // Brask at the fountain square (north centre); burn teams working
  // the alleys and market row.
  enemy: [
    { x: 7, y: 0 }, // Captain Brask (boss)
    { x: 6, y: 3 }, // royal guard, west alley
    { x: 9, y: 4 }, // royal guard, market row
    { x: 15, y: 5 }, // royal guard, east lane
    { x: 3, y: 7 }, // royal archer, west lane
    { x: 15, y: 1 }, // royal archer, NE rooftop line
    { x: 7, y: 7 }, // royal guard, centre push
  ]
});

// ============== Battle 23 — The Path Narrows ==============
// 13x9 canyon pass. Rock walls funnel both sides into a waisted centre;
// the imperial remnant holds the east mouth behind fieldworks. Whoever
// controls the waist controls the fight.
const Nc = t("stone");                  // canyon floor
const Nw = t("wall");                   // sheer rock
const Nr = t("rubble");                 // rockfall
const Nb = t("stone", "barricade");     // remnant fieldworks
const Nk = t("stone", "rock");          // fallen boulder
const narrowsRows = [
  [Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nc, Nc, Nc, Nc, Nc, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw],
  [Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nc, Nc, Nc, Nc, Nc, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw],
  [Nw, Nw, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nw, Nw, Nw],
  [Nw, Nw, Nc, Nc, Nc, Nc, Nc, Nc, Nk, Nc, Nc, Nc, Nc, Nc, Nc, Nb, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nw],
  [Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nr, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc],
  [Nc, Nc, Nc, Nc, Nc, Nc, Nr, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nb, Nc, Nc, Nc, Nc, Nc, Nc],
  [Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nr, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc],
  [Nw, Nw, Nc, Nc, Nc, Nc, Nc, Nc, Nk, Nc, Nc, Nc, Nc, Nc, Nc, Nb, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nw],
  [Nw, Nw, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nc, Nw, Nw, Nw],
  [Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nc, Nc, Nc, Nc, Nc, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw, Nw],
];
export const narrowsMap: MapDef = buildMap("narrows", "The Narrows", narrowsRows, {
  player: [
    { x: 2, y: 3 }, // Amar
    { x: 2, y: 6 }, // Maya
    { x: 4, y: 4 }, // Ning
    { x: 2, y: 4 }, // Leo
    { x: 4, y: 3 }, // Veya
    { x: 4, y: 6 }, // Selene
    { x: 6, y: 3 }, // Ranatoli
    { x: 4, y: 2 }, // Corin
  ],
  enemy: [
    { x: 21, y: 4 }, // Colonel Vasse (boss)
    { x: 17, y: 3 }, // royal guard
    { x: 17, y: 6 }, // royal guard
    { x: 19, y: 2 }, // royal archer
    { x: 19, y: 7 }, // royal archer
  ]
});

// ============== Battle 24 — The Bell Before the Sky ==============
// 12x10 bell court. A colonnaded square around the west's last muster
// bell; the warden's line forms across the north half. Torches burn at
// the corners: the last human-lit night of the campaign.
const Bc = t("stone");                  // court flagstones
const Bp = t("stone", "pillar");        // colonnade
const Bt = t("stone", "torch");         // corner braziers
const Bw = t("wall");                   // court walls
const Br = t("rubble");                 // collapsed arch
const bellCourtRows = [
  [Bw, Bw, Bw, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bw, Bw, Bw],
  [Bw, Bw, Bw, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bw, Bw, Bw],
  [Bw, Bw, Bt, Bc, Bc, Bc, Bp, Bp, Bc, Bc, Bc, Bp, Bc, Bc, Bc, Bt, Bc, Bw],
  [Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc],
  [Bc, Bc, Bc, Bp, Bp, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bp, Bc, Bc, Bc],
  [Bc, Bc, Bc, Bp, Bp, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bp, Bc, Bc, Bc],
  [Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Br, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc],
  [Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Br, Bc, Bc, Bc, Bc, Bc, Bc],
  [Bc, Bc, Bc, Bp, Bp, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bp, Bc, Bc, Bc],
  [Bc, Bc, Bc, Bp, Bp, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bp, Bc, Bc, Bc],
  [Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc],
  [Bw, Bw, Bt, Bc, Bc, Bc, Bp, Bp, Bc, Bc, Bc, Bp, Bc, Bc, Bc, Bt, Bc, Bw],
  [Bw, Bw, Bw, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bc, Bw, Bw, Bw],
];
export const bellCourtMap: MapDef = buildMap("bell_court", "The Bell Court", bellCourtRows, {
  // Row 7 — the clear rank inside the south colonnade (row 8's x=4/x=7
  // are pillars).
  player: [
    { x: 6, y: 9 }, // Amar
    { x: 8, y: 9 }, // Maya
    { x: 9, y: 9 }, // Ning
    { x: 11, y: 9 }, // Leo
    { x: 5, y: 9 }, // Veya
    { x: 12, y: 9 }, // Selene
    { x: 2, y: 9 }, // Ranatoli
    { x: 5, y: 8 }, // Corin
  ],
  enemy: [
    { x: 8, y: 1 }, // Warden Sarto (boss), before the bell
    { x: 5, y: 3 }, // guard, west colonnade
    { x: 12, y: 3 }, // guard, east colonnade
    { x: 2, y: 5 }, // guard, west aisle
    { x: 15, y: 5 }, // guard, east aisle
    { x: 9, y: 4 }, // archer, centre line,
    { x: 8, y: 3 },
    { x: 8, y: 4 },
    { x: 9, y: 3 },
    { x: 7, y: 3 },
    { x: 7, y: 4 },
    { x: 8, y: 2 }
  ]
});

// ============== Battles 25 + 27 — the landing field ==============
// 14x10 scorched plain where the first Ravage craft came down. One rows
// array, two MapDefs: B25 (first contact) enters from the west; B27
// (the Herald's descent, fought at night) re-stages the same scarred
// ground with the descent guard already formed at centre.
const Lf = t("dirt");                   // burnt-off plain
const Lg = t("grass");                  // surviving verge
const Lr = t("rubble");                 // impact scatter
const Lk = t("dirt", "rock");           // heat-fused slag
const Lt2 = t("dirt", "torch");         // burning craft debris
const landingRows = [
  [Lg , Lg , Lg , Lg , Lg , Lg , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lg , Lg , Lg , Lg , Lg , Lg , Lg],
  [Lg , Lg , Lg , Lg , Lg , Lg , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lg , Lg , Lg , Lg , Lg , Lg , Lg],
  [Lg , Lg , Lg , Lf , Lf , Lf , Lf , Lf , Lr , Lf , Lf , Lf , Lr , Lr , Lf , Lf , Lf , Lg , Lg , Lg , Lg],
  [Lg , Lg , Lf , Lf , Lf , Lk , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lg , Lg , Lg],
  [Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lt2, Lf , Lf , Lf , Lf , Lf , Lk , Lf , Lf , Lf , Lf , Lf , Lg],
  [Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lg],
  [Lf , Lf , Lf , Lr , Lr , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lr , Lf , Lf , Lf],
  [Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lt2, Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf],
  [Lg , Lg , Lf , Lf , Lf , Lf , Lk , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lg],
  [Lg , Lg , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lg],
  [Lg , Lg , Lf , Lf , Lf , Lr , Lf , Lf , Lf , Lt2, Lf , Lf , Lf , Lf , Lf , Lk , Lf , Lf , Lg , Lg , Lg],
  [Lg , Lg , Lg , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lr , Lr , Lf , Lf , Lf , Lg , Lg , Lg , Lg],
  [Lg , Lg , Lg , Lg , Lg , Lg , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lf , Lg , Lg , Lg , Lg , Lg , Lg , Lg],
];
export const landingFieldMap: MapDef = buildMap("landing_field", "The Landing Field", landingRows, {
  player: [
    { x: 2, y: 5 }, // Amar
    { x: 2, y: 7 }, // Maya
    { x: 3, y: 5 }, // Ning
    { x: 3, y: 7 }, // Leo
    { x: 2, y: 4 }, // Veya
    { x: 2, y: 8 }, // Selene
    { x: 3, y: 4 }, // Ranatoli
    { x: 5, y: 5 }, // Corin
  ],
  enemy: [
    { x: 15, y: 4 }, // trooper
    { x: 17, y: 7 }, // trooper
    { x: 14, y: 9 }, // trooper (x=10 is fused slag)
    { x: 18, y: 5 }, // lancer
    { x: 18, y: 8 }, // lancer
    { x: 20, y: 4 }, // marksman
    { x: 20, y: 9 }, // marksman,
    { x: 17, y: 6 },
    { x: 18, y: 7 },
    { x: 18, y: 6 },
    { x: 16, y: 7 },
    { x: 17, y: 8 },
    { x: 16, y: 6 }
  ]
});
export const descentFieldMap: MapDef = buildMap("descent_field", "The Landing Field, at Night", landingRows, {
  player: [
    { x: 2, y: 5 }, // Amar
    { x: 3, y: 7 }, // Maya
    { x: 2, y: 8 }, // Ning
    { x: 3, y: 4 }, // Leo
    { x: 2, y: 7 }, // Veya
    { x: 3, y: 8 }, // Selene
    { x: 2, y: 4 }, // Ranatoli
    { x: 5, y: 5 }, // Corin
  ],
  enemy: [
    { x: 17, y: 7 }, // Herald of the Ravage (boss)
    { x: 12, y: 4 }, // trooper (x=9 is fused slag)
    { x: 14, y: 9 }, // trooper
    { x: 15, y: 7 }, // lancer
    { x: 18, y: 3 }, // marksman
    { x: 18, y: 11 }, // marksman,
    { x: 16, y: 7 },
    { x: 16, y: 6 },
    { x: 15, y: 6 },
    { x: 16, y: 8 },
    { x: 15, y: 8 },
    { x: 17, y: 6 }
  ]
});

// ============== Battle 26 — Hold the Coast ==============
// 14x9 shoreline. Water claims the whole east edge: the Ravage come
// out of it. The squad holds a barricade line on the dune ridge; if the
// line breaks, the inland is open road.
const Cs = t("sand");                   // shore
const Cg = t("grass");                  // dune grass
const Cw = t("water");                  // the sea (impassable)
const Cd = t("sand", "barricade");      // dune-line fieldworks
const Ck = t("sand", "rock");           // shore boulders
const coastHoldRows = [
  [Cg, Cg, Cg, Cg, Cg, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cw, Cw, Cw, Cw],
  [Cg, Cg, Cg, Cg, Cg, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cw, Cw, Cw, Cw],
  [Cg, Cg, Cg, Cs, Cs, Cs, Cs, Cs, Cd, Cs, Cs, Cs, Ck, Cs, Cs, Cs, Cs, Cs, Cw, Cw],
  [Cg, Cg, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cw, Cw],
  [Cg, Cg, Cs, Cs, Cs, Cd, Cs, Cs, Cs, Cs, Ck, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cw],
  [Cg, Cg, Cg, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cw],
  [Cg, Cg, Cg, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cw],
  [Cg, Cg, Cs, Cs, Cs, Cd, Cs, Cs, Cs, Cs, Cs, Cs, Ck, Cs, Cs, Cs, Cs, Cs, Cs, Cw],
  [Cg, Cg, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cw, Cw],
  [Cg, Cg, Cg, Cs, Cs, Cs, Cs, Cs, Cd, Cs, Cs, Cs, Cs, Ck, Cs, Cs, Cs, Cs, Cw, Cw],
  [Cg, Cg, Cg, Cg, Cg, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cs, Cw, Cw, Cw, Cw],
];
export const coastHoldMap: MapDef = buildMap("coast_hold", "The Held Coast", coastHoldRows, {
  player: [
    { x: 3, y: 4 }, // Amar
    { x: 3, y: 6 }, // Maya
    { x: 1, y: 5 }, // Ning
    { x: 3, y: 5 }, // Leo
    { x: 1, y: 2 }, // Veya
    { x: 1, y: 8 }, // Selene
    { x: 1, y: 4 }, // Ranatoli
    { x: 4, y: 4 }, // Corin
  ],
  enemy: [
    { x: 15, y: 2 }, // trooper
    { x: 16, y: 5 }, // trooper
    { x: 15, y: 8 }, // trooper
    { x: 16, y: 1 }, // lancer
    { x: 16, y: 9 }, // lancer
    { x: 18, y: 4 }, // marksman
    { x: 18, y: 6 }, // marksman,
    { x: 17, y: 5 },
    { x: 16, y: 4 },
    { x: 16, y: 6 },
    { x: 17, y: 4 },
    { x: 17, y: 6 },
    { x: 15, y: 5 }
  ]
});

// ============== Battle 28 — The Path Ends ==============
// 13x10 before the grounded flagship. A marble processional (the old
// coronation road out of Grude) runs dead into the Ravage craft's
// shadow: the campaign's last ground, shared by every path's finale.
// Only the person waiting at the top of it changes.
const Pm = t("marble");                 // processional
const Ps = t("stone");                  // flanking ground
const Pp = t("stone", "pillar");        // shattered colonnade
const Pr = t("rubble");                 // wreckage
const Pt = t("stone", "torch");         // burning wreck-light
const pathFinalRows = [
  [Ps, Ps, Ps, Ps, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Ps, Ps, Ps, Ps],
  [Ps, Ps, Ps, Ps, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Ps, Ps, Ps, Ps],
  [Ps, Ps, Pp, Ps, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Ps, Ps, Pp, Ps],
  [Ps, Ps, Ps, Ps, Ps, Pr, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pr, Ps, Ps, Ps, Ps],
  [Ps, Ps, Ps, Ps, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Ps, Ps, Ps, Ps],
  [Ps, Ps, Ps, Pt, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Pt, Ps, Ps, Ps],
  [Ps, Ps, Pp, Ps, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Ps, Ps, Pp, Ps],
  [Ps, Ps, Ps, Ps, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Ps, Ps, Ps, Ps],
  [Ps, Ps, Ps, Ps, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Ps, Ps, Ps, Ps],
  [Ps, Ps, Ps, Pr, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Pr, Ps, Ps, Ps],
  [Ps, Ps, Pp, Ps, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Ps, Ps, Pp, Ps],
  [Ps, Ps, Pp, Ps, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Ps, Ps, Pp, Ps],
  [Ps, Ps, Ps, Ps, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Ps, Ps, Ps, Ps],
  [Ps, Ps, Ps, Ps, Ps, Ps, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Pm, Ps, Ps, Ps, Ps, Ps],
];
export const pathFinalMap: MapDef = buildMap("path_final", "The Processional", pathFinalRows, {
  player: [
    { x: 8, y: 13 }, // Amar
    { x: 9, y: 13 }, // Maya
    { x: 8, y: 12 }, // Ning
    { x: 10, y: 13 }, // Leo
    { x: 6, y: 13 }, // Veya
    { x: 10, y: 12 }, // Selene
    { x: 9, y: 12 }, // Ranatoli
    { x: 6, y: 12 }, // Corin
  ],
  enemy: [
    { x: 9, y: 1 }, // the path's final opponent (boss)
    { x: 6, y: 3 }, // escort west
    { x: 12, y: 3 }, // escort east
    { x: 4, y: 6 }, // flank west
    { x: 14, y: 6 }, // flank east,
    { x: 9, y: 4 },
    { x: 9, y: 3 },
    { x: 8, y: 4 },
    { x: 10, y: 4 },
    { x: 9, y: 5 },
    { x: 8, y: 3 },
    { x: 10, y: 3 },
    { x: 8, y: 5 }
  ]
}, (_x, y, cell) => {
  // "Only the person waiting at the top of it changes." The marble
  // processional is a raised causeway through the wreckage, stepping up
  // once more to the head of the road where the final opponent stands.
  if (cell.terrain !== "marble") return undefined;
  return y <= 2 ? 2 : 1;
});

// ============== Battle 29 — The Smallhold Road (post-credits epilogue) =======
// 14×10 harvest-season farm road: orchard trees at the verges, hay in the
// fields, a fenced kitchen garden. Deliberately small and open after the
// endgame's huge arenas — this is the warm one, a morning's work on a road
// that finally belongs to the people who live on it.
const Eg = t("grass");
const Eh = t("grass", "hay");
const Ef = t("grass", "fence");
const Et = t("grass", "tree");
const Ed = t("dirt");
const Ew = t("dirt", "wagon");

const smallholdRows = [
  [Eg, Eg, Eg, Et, Eg, Eg, Eg, Eg, Eg, Et, Eg, Eg, Eg, Eg],
  [Eg, Eg, Eg, Eg, Eg, Eg, Eh, Eg, Eg, Eg, Eg, Eg, Et, Eg],
  [Ed, Ed, Ed, Ed, Ed, Ed, Ed, Ed, Ed, Ed, Ed, Ew, Ed, Ed],
  [Ed, Ed, Ed, Ed, Ed, Ed, Ed, Ed, Ed, Ed, Ed, Ed, Ed, Ed],
  [Eg, Eg, Eh, Eg, Eg, Eg, Ef, Ef, Eg, Eg, Eg, Eh, Eg, Eg],
  [Eg, Eg, Eg, Eg, Eg, Eg, Ef, Ef, Eg, Eg, Eg, Eg, Eg, Eg],
  [Eg, Et, Eg, Eg, Eg, Eg, Eg, Eg, Eg, Eg, Eg, Et, Eg, Eg],
  [Eg, Eg, Eg, Eg, Eh, Eg, Eg, Eg, Eg, Eh, Eg, Eg, Eg, Eg],
  [Eg, Eg, Eg, Eg, Eg, Eg, Eg, Eg, Eg, Eg, Eg, Eg, Eg, Eg],
  [Eg, Eg, Et, Eg, Eg, Eg, Eg, Eg, Eg, Eg, Eg, Et, Eg, Eg]
] as const;

export const smallholdMap: MapDef = buildMap("smallhold", "The Smallhold Road", smallholdRows, {
  // The squad comes up the road from the west, unhurried.
  player: [
    { x: 1, y: 3 }, // Amar
    { x: 1, y: 2 }, // the spouse (or the first friend, walking alone)
    { x: 0, y: 3 },
    { x: 0, y: 2 },
    { x: 1, y: 4 },
    { x: 2, y: 5 }
  ],
  // Bandits between the squad and the smallhold, east.
  enemy: [
    { x: 12, y: 2 },
    { x: 12, y: 3 },
    { x: 11, y: 5 },
    { x: 13, y: 4 },
    { x: 10, y: 1 },
    { x: 10, y: 6 }
  ]
});
