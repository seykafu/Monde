import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase } from '../../db/testDatabase.js';
import { createWorld } from '../../worlds/createWorld.js';
import { feasibleFavor } from '../favorFeasibility.js';
import { eventTransaction, ingestInTransaction } from '../eventIngestion.js';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); }, 30_000);
afterAll(async () => { await database.client.close(); });
it('offers closed-district residents reachable chores, finds and Last Chances', async () => {
  const world = await createWorld(database.db, randomUUID(), 'invite');
  for (const resident of ['bru', 'delphine', 'felix', 'hollis', 'kasimir', 'nettie', 'priya', 'rook', 'vane']) {
    for (const template of ['help_chore', 'find', 'last_chance'] as const) {
      const f = await feasibleFavor(database.db, world.id, resident, 2, `${resident}_${template}`, { template, target: template === 'find' ? 'flowers' : resident, text: 'Help?' }, { resident, deadline: 4, factors: { town: 10, friends: 20, purpose: 0, roots: 10 } });
      expect(f, resident).not.toBeNull();
      expect(['old_quarter', 'market_row', 'wharf', 'commons']).toContain(f!.task.place.split('.')[0]);
    }
  }
}, 30_000);
it('reconstructs an offline chore on reconnect, completes it, and rejects a forged offering date', async () => {
  const world = await createWorld(database.db, randomUUID(), 'invite');
  const id = 'quiet_chore_odile_0';
  const contract = await feasibleFavor(database.db, world.id, 'odile', 2, id, { template: 'help_chore', target: 'odile', text: 'Help?' });
  const result = await eventTransaction(database.db, tx => ingestInTransaction(tx, world.id, [
    { kind: 'favor_choice', id: 'choice', day: 2, minute: 600, resident: 'odile', favor: id, accept: true, offered_day: 2 },
    { kind: 'favor_done', id: 'done', day: 2, minute: 630, resident: 'odile', favor: id, proof: { kind: 'chore', place: contract!.task.place, resident: 'odile', item: null, nearby: [], minutes: 30, found: false } },
    { kind: 'favor_choice', id: 'forged', day: 2, minute: 640, resident: 'odile', favor: 'quiet_chore_odile_1', accept: true, offered_day: 6 },
  ]));
  expect(result.accepted).toEqual(['choice', 'done']); expect(result.rejected.map(e => e.id)).toEqual(['forged']);
});
it('rebuilds a dream stage’s Favor from its id, and mirrors the stage into the resident’s dream', async () => {
  const { and, eq } = await import('drizzle-orm');
  const { favors, memories, residents } = await import('../../db/schema.js');
  const { dreamFavorId, dreamFavorRequest } = await import('@monde/shared');
  const world = await createWorld(database.db, randomUUID(), 'invite');
  const id = dreamFavorId('felix', 0, 4);
  const contract = await feasibleFavor(database.db, world.id, 'felix', 4, id, dreamFavorRequest({ id: 'felix' }, 0));
  const first = await eventTransaction(database.db, tx => ingestInTransaction(tx, world.id, [
    { kind: 'favor_choice', id: 'choice', day: 4, minute: 600, resident: 'felix', favor: id, accept: true, offered_day: 4 },
    { kind: 'favor_done', id: 'done', day: 4, minute: 640, resident: 'felix', favor: id, proof: { kind: 'chore', place: contract!.task.place, resident: 'felix', item: null, nearby: [], minutes: 30, found: false } },
    { kind: 'favor_choice', id: 'forged', day: 4, minute: 650, resident: 'felix', favor: dreamFavorId('felix', 1, 9), accept: true, offered_day: 9 },
    { kind: 'dream_stage', id: 'stage1', day: 4, minute: 641, resident: 'felix', stage: 1 },
    { kind: 'dream_stage', id: 'stage2', day: 4, minute: 641, resident: 'felix', stage: 2 },
    { kind: 'dream_stage', id: 'too_far', day: 4, minute: 641, resident: 'felix', stage: 5 },
  ]));
  expect(first.accepted).toEqual(['choice', 'done', 'stage1', 'stage2']);
  expect(first.rejected.map(e => [e.id, e.reason])).toEqual([['forged', 'favor is no longer offered'], ['too_far', 'the dream has fewer stages']]);
  const [stored] = await database.db.select().from(favors).where(and(eq(favors.worldId, world.id), eq(favors.id, id)));
  expect(stored).toMatchObject({ status: 'completed', template: 'help_chore' });
  expect((stored!.reward as { reward: { dream: string } }).reward.dream).toBe('felix#0');
  const felix = async () => (await database.db.select().from(residents).where(and(eq(residents.worldId, world.id), eq(residents.id, 'felix'))))[0]!;
  expect((await felix()).state.dream.stage).toBe(2);
  // Never lowered; a repeated stage is a duplicate; the help is remembered.
  const again = await eventTransaction(database.db, tx => ingestInTransaction(tx, world.id, [
    { kind: 'dream_stage', id: 'stage1_again', day: 5, minute: 600, resident: 'felix', stage: 1 },
    { kind: 'dream_stage', id: 'stage1', day: 4, minute: 641, resident: 'felix', stage: 1 },
  ]));
  expect(again.duplicates).toEqual(['stage1_again', 'stage1']);
  expect((await felix()).state.dream.stage).toBe(2);
  const remembered = await database.db.select().from(memories).where(and(eq(memories.worldId, world.id), eq(memories.residentId, 'felix')));
  expect(remembered.filter(m => m.sourceEvent?.startsWith('stage')).map(m => m.text)).toEqual([
    'The Fellow helped me a step nearer what I want: Take the pupils to the library on a Saturday.',
    'The Fellow helped me a step nearer what I want: Carry the school prospectus to three families with children.'
  ]);
}, 30_000);
