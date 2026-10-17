import { eq } from 'drizzle-orm';
import { instantiateFavor, type FavorRequest, type LeavingFavorNotice } from '@monde/shared';
import { loadItems } from '../content/loadContent.js';
import { residents, relationships, favors } from '../db/schema.js';
import type { WorldDatabase } from '../worlds/createWorld.js';
import { loadPlaceRegistry } from './places.js';
type Database = WorldDatabase | Parameters<Parameters<WorldDatabase['transaction']>[0]>[0];
export async function feasibleFavor(db: Database, worldId: string, owner: string, day: number, id: string, request: FavorRequest, notice?: LeavingFavorNotice) {
  const [items, people, ties, places] = await Promise.all([
    loadItems(), db.select().from(residents).where(eq(residents.worldId, worldId)),
    db.select().from(relationships).where(eq(relationships.worldId, worldId)), loadPlaceRegistry(),
  ]);
  return instantiateFavor(request, id, owner, { day, items: new Set(items.map(i => i.id)), places: places.ids,
    reachablePlace: place => ['old_quarter', 'market_row', 'wharf', 'commons'].includes(place.split('.')[0]!),
    leaving: notice ? new Map([[owner, notice]]) : undefined,
    residents: new Map(people.map(p => [p.id, { home: p.card.home, workplace: p.card.workplace, places: [...p.card.routine.weekday, ...p.card.routine.weekend].map(b => b.where), reachable: p.id === owner || p.tier !== 'ambient' }])),
    met: (a,b) => ties.some(t => t.fromId === a && t.toId === b || t.fromId === b && t.toId === a),
  });
}

/** Reconstruct an offline template from its deterministic identity; client rewards and task parameters are never trusted. */
export async function restoreQuietFavor(db: Database, worldId: string, event: { resident: string; favor: string; day: number; offered_day?: number }): Promise<void> {
  const offered = event.offered_day;
  if (!offered || offered > event.day || event.day > offered + 5 || event.favor !== `quiet_chore_${event.resident}_${Math.floor((offered - 1) / 5)}`) return;
  const existing = await db.select().from(favors).where(eq(favors.worldId, worldId));
  const open = existing.filter(f => ['proposed', 'accepted'].includes(f.status) && f.expiresDay >= event.day);
  if (existing.some(f => f.id === event.favor) || open.length >= 6 || open.some(f => f.residentId === event.resident)) return;
  const contract = await feasibleFavor(db, worldId, event.resident, offered, event.favor, {
    template: 'help_chore', target: event.resident, text: 'Could you lend a hand with a chore? Half an hour would help.',
  });
  if (contract) await db.insert(favors).values({ worldId, id: contract.id, residentId: contract.resident_id, template: contract.template,
    target: contract.target, text: contract.text, status: 'proposed', createdDay: contract.created_day, expiresDay: contract.expires_day, reward: contract });
}
