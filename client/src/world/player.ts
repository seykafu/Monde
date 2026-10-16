import type { Edge, Place, ZoneDef } from './zoneFormat';
export interface Position { x: number; y: number }
export const PLAYER_SPEED = 4; // Task W-02: tiles per second.
// GDD-GAP: placeholder collision half-width; tune with final character art.
export const PLAYER_RADIUS = 0.18;
export function resolveEdge(zone: ZoneDef, p: Position): Edge | undefined {
  const side = p.x < 0 ? 'west' : p.x >= zone.width ? 'east' : p.y < 0 ? 'north' : p.y >= zone.height ? 'south' : undefined;
  const along = side === 'west' || side === 'east' ? p.y : p.x;
  return zone.edges.find(e => e.side === side && along >= e.from && along < e.to + 1);
}
function fits(zone: ZoneDef, p: Position): boolean {
  for (const dx of [-PLAYER_RADIUS, PLAYER_RADIUS]) for (const dy of [-PLAYER_RADIUS, PLAYER_RADIUS]) {
    const q = { x: p.x + dx, y: p.y + dy };
    if (q.x < 0 || q.y < 0 || q.x >= zone.width || q.y >= zone.height) {
      if (!resolveEdge(zone, q)) return false;
    } else if (!zone.walkability[Math.floor(q.y)]?.[Math.floor(q.x)]) return false;
  }
  return true;
}
export function movePlayer(zone: ZoneDef, start: Position, input: Position, seconds: number): { position: Position; edge?: Edge } {
  const p = { ...start }, length = Math.hypot(input.x, input.y);
  if (!length || seconds <= 0) return { position: p };
  const distance = PLAYER_SPEED * Math.min(seconds, 0.25);
  const steps = Math.ceil(distance / 0.1); // Substeps prevent tunnelling through a tile.
  for (let i = 0; i < steps; i++) {
    const x = { x: p.x + input.x / length * distance / steps, y: p.y };
    if (fits(zone, x)) p.x = x.x;
    const y = { x: p.x, y: p.y + input.y / length * distance / steps };
    if (fits(zone, y)) p.y = y.y;
    const edge = resolveEdge(zone, p);
    if (edge) return { position: p, edge };
  }
  return { position: p };
}
export function nearbyPlace(zone: ZoneDef, p: Position): Place | undefined {
  return zone.places.map(place => ({ place, distance: Math.hypot(p.x - place.door[0] - 0.5, p.y - place.door[1] - 0.5) }))
    .filter(p => p.distance <= 1).sort((a, b) => a.distance - b.distance)[0]?.place;
}
export function placeName(id: string): string {
  const names: Record<string, string> = { bakery: 'Fournier & Fille', general_store: "Dunmore’s General Store", gull_and_anchor: 'The Gull & Anchor', cafe_liss: 'Café Liss', library: 'Monde Free Library', lantern_office: 'The Lantern', st_brigids: 'St. Brigid’s', bertrand_house: 'Achterberg Horlogerie', market_hall: 'Covered Market Hall', mayor_office: 'the Mayor’s Office', storefront_9: 'No. 9 Market Row', lamplighter_cottage: 'the Lamplighter’s Cottage' };
  return names[id] ?? id.split('_').map(s => s[0]!.toUpperCase() + s.slice(1)).join(' ');
}

/**
 * Where a saved position may stand: itself if the player fits there, else the centre of the nearest
 * walkable tile (a save from an older layout of the board can put the player inside what is now a wall).
 */
export function standable(zone: ZoneDef, p: Position): Position {
  if (fits(zone, p)) return p;
  const sx = Math.min(zone.width - 1, Math.max(0, Math.floor(p.x))), sy = Math.min(zone.height - 1, Math.max(0, Math.floor(p.y)));
  for (let r = 0; r < Math.max(zone.width, zone.height); r++) {
    let best: Position | undefined, bestD = Infinity;
    for (let y = sy - r; y <= sy + r; y++) for (let x = sx - r; x <= sx + r; x++) {
      if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) !== r || !zone.walkability[y]?.[x]) continue;
      const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
      if (d < bestD) { bestD = d; best = { x: x + 0.5, y: y + 0.5 }; }
    }
    if (best) return best;
  }
  return { x: zone.spawn[0] + 0.5, y: zone.spawn[1] + 0.5 };
}
