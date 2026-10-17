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
