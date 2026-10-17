import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { PlanOutput } from '@monde/shared';
import { createTestDatabase } from '../../db/testDatabase.js';
import { memories, plans, relationships, residents, worlds } from '../../db/schema.js';
import { createWorld } from '../../worlds/createWorld.js';
import { ingestClientEvents } from '../eventIngestion.js';
import { DisabledMindClient } from '../mindClient.js';
import { prepareFriendship } from '../ties.js';
import { resolveEncounter } from '../encounters.js';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); }, 30_000);
afterAll(async () => { await database?.client.close(); });

// Both the encounter and gossip rolls succeed for Odile → Roz on night 2 and Roz → Nell on night 3.
const SEED_MARKET_TO_WHARF = 2;
it('M-08: a witnessed Market Row Scuffle reaches the Wharf by night N+2 through a later-night hop', async () => {
  const db = database.db;
  const world = await createWorld(db, randomUUID(), 'invite');
  await db.update(worlds).set({ seed: SEED_MARKET_TO_WHARF }).where(eq(worlds.id, world.id));
  const roster = await db.select().from(residents).where(eq(residents.worldId, world.id));
  const plan = (place: string, awake: boolean): PlanOutput => ({
    blocks: [{ start: '06:00', end: '23:00', place, action: awake ? 'socialize' : 'sleep', with: ['odile', 'rosalind', 'nell'], note: '' }],
    barks: [], intentions: [], seek_player: null, whim: null,
  });
  for (const day of [1, 2, 3, 4]) for (const r of roster) {
    const awake = day === 1 ? r.id === 'odile' : day === 2 ? ['odile', 'rosalind'].includes(r.id) : ['rosalind', 'nell'].includes(r.id);
    const place = awake ? (day <= 2 ? 'market_row.bakery' : 'wharf.fish_market') : r.card.home;
    await db.insert(plans).values({ worldId: world.id, residentId: r.id, day, source: 'template', plan: plan(place, awake) });
  }
  for (const [a, b] of [['odile', 'rosalind'], ['rosalind', 'nell']]) for (const [fromId, toId] of [[a!, b!], [b!, a!]]) {
    await db.insert(relationships).values({ worldId: world.id, fromId, toId, affinity: 100, trust: 0, tag: 'friend', note: '' })
      .onConflictDoUpdate({ target: [relationships.worldId, relationships.fromId, relationships.toId], set: { affinity: 100 } });
  }
  const ingested = await ingestClientEvents(db, world.id, [{ id: 'market-scuffle', day: 1, minute: 600,
    kind: 'town_event', type: 'scuffle', place: 'market_row.bakery', participants: ['player'], importance: 7,
    summary: 'The Fellow stopped a Scuffle on Market Row.' }]);
  expect(ingested.accepted).toEqual(['market-scuffle']);
  const news = () => db.select().from(memories).where(and(eq(memories.worldId, world.id), eq(memories.sourceEvent, 'market-scuffle')));
  expect(await news()).toMatchObject([{ residentId: 'odile', kind: 'saw', importance: 7 }]);
  expect((await news())[0]!.id).not.toBe('market-scuffle');
  for (const day of [1, 2, 3, 4]) {
    const night = await prepareFriendship(db, { worldId: world.id, day, tiers: new Map(), modelEnabled: false, flags: [] });
    for (const encounter of night.encounters) {
      await resolveEncounter({ db, mind: new DisabledMindClient(), gate: task => task(), callTimeoutMs: 1000,
        log: { info: () => {}, warn: () => {}, error: () => {} },
      }, night.context(encounter), encounter, ...night.sides(encounter));
    }
    if (day === 1) expect(await news()).toHaveLength(1);
    if (day === 2) expect(await news()).toEqual(expect.arrayContaining([expect.objectContaining({ residentId: 'rosalind', kind: 'heard', importance: 6, day: 2 })]));
    if (day === 3) expect(await news()).toEqual(expect.arrayContaining([expect.objectContaining({ residentId: 'nell', kind: 'heard', importance: 5, day: 3 })]));
  }
  expect(await news()).toHaveLength(3); // no echo to Roz and no duplicate on a later encounter
});
