import { eq } from 'drizzle-orm';
import { instantiateFavor, type FavorRequest, type LeavingFavorNotice } from '@monde/shared';
import { loadItems } from '../content/loadContent.js';
import { residents, relationships } from '../db/schema.js';
import type { WorldDatabase } from '../worlds/createWorld.js';
import { loadPlaceRegistry } from './places.js';
type Database = WorldDatabase | Parameters<Parameters<WorldDatabase['transaction']>[0]>[0];
export async function feasibleFavor(db: Database, worldId: string, owner: string, day: number, id: string, request: FavorRequest, notice?: LeavingFavorNotice) {
  const [items, people, ties, places] = await Promise.all([
    loadItems(), db.select().from(residents).where(eq(residents.worldId, worldId)),
    db.select().from(relationships).where(eq(relationships.worldId, worldId)), loadPlaceRegistry(),
  ]);
  return instantiateFavor(request, id, owner, { day, items: new Set(items.map(i => i.id)), places: places.ids,
    leaving: notice ? new Map([[owner, notice]]) : undefined,
    residents: new Map(people.map(p => [p.id, { home: p.card.home, reachable: p.id === owner || p.tier !== 'ambient' }])),
    met: (a,b) => ties.some(t => t.fromId === a && t.toId === b || t.fromId === b && t.toId === a),
  });
}
