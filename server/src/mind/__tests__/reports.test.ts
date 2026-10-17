import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { fallbackPress, isGeneratedLetterId, parseReportBody, type Press } from '@monde/shared';
import { buildApp } from '../../app.js';
import { parseConfig } from '../../config.js';
import { createTestDatabase } from '../../db/testDatabase.js';
import { createWorld } from '../../worlds/createWorld.js';
import { worldToken } from '../../worlds/routes.js';
import { dialogueTurns, letters, reportedTurns, worlds } from '../../db/schema.js';
import { REPORT_DAILY_LIMIT } from '../admin.js';
import { letterId } from '../reflect.js';

// §9.13 Report on every generated surface: dialogue (unchanged), the Lantern's model copy, and reflection letters.
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
beforeAll(async () => {
  database = await createTestDatabase();
  app = buildApp(parseConfig({ LOG_LEVEL: 'silent', ADMIN_TOKEN: 'secret' }), database.db);
}, 30_000);
afterAll(async () => { await app.close(); await database.client.close(); });

type World = { id: string; deviceId: string };
const world = (): Promise<World> => createWorld(database.db, `reports-${randomUUID()}`, 'invite');
const headers = (w: World) => ({ authorization: `Bearer ${worldToken(w.id, w.deviceId, 'monde-local-development-only')}` });
const report = (w: World, payload: object) => app.inject({ method: 'POST', url: `/v1/worlds/${w.id}/reports`, headers: headers(w), payload });
const rows = (w: World) => database.db.select().from(reportedTurns).where(eq(reportedTurns.worldId, w.id));

const MODEL: Press = {
  ...fallbackPress(2, [], []), source: 'model', headline: 'BROOMS OUT ON MARKET ROW', dek: 'The Fellow sweeps; the desk notes it.',
  stories: [
    { event_id: 'sweep', title: 'Market Row', text: 'The Fellow swept Market Row before the stalls opened.' },
    { event_id: null, title: 'Letters desk', text: 'The letters desk is open. Bring ink.' },
  ],
};
async function printEdition(worldId: string, paper: Press): Promise<void> {
  await database.db.insert(letters).values({ worldId, id: `press_${paper.day}`, fromId: 'sable', toId: '@press', day: paper.day, text: JSON.stringify(paper), delivered: true });
}
async function talk(w: World): Promise<{ conversationId: string }> {
  const response = await app.inject({ method: 'POST', url: `/v1/worlds/${w.id}/talk`, headers: headers(w), payload: {
    resident_id: 'pell', conversation_id: randomUUID(), input: { kind: 'open' }, context: { day: 1, minute: 600, place: 'old_quarter.fountain_square', weather: 'clear' },
  } });
  expect(response.statusCode).toBe(200);
  const [turn] = await database.db.select().from(dialogueTurns).where(eq(dialogueTurns.worldId, w.id));
  return { conversationId: turn!.conversationId };
}

describe('dialogue reports', () => {
  it('keep the original body (no kind) working and accept an explicit kind', async () => {
    const w = await world(), { conversationId } = await talk(w);
    expect((await report(w, { conversation_id: conversationId, turn_index: 0, reason: 'Report line' })).statusCode).toBe(200);
    expect((await report(w, { kind: 'dialogue', conversation_id: conversationId, turn_index: 0, reason: 'again' })).statusCode).toBe(200);
    const [row, ...more] = await rows(w);
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({ kind: 'dialogue', conversationId, turnIndex: 0, residentId: 'pell', text: null });
    expect(row!.lines!.length).toBeGreaterThan(0);
    expect((await report(w, { conversation_id: randomUUID(), turn_index: 0, reason: 'x' })).statusCode).toBe(404);
  });
});

describe('press reports', () => {
  it('store the server copy of a model story or the front, idempotently', async () => {
    const w = await world();
    await printEdition(w.id, MODEL);
    expect((await report(w, { kind: 'press', day: 2, story: 0, event_id: 'sweep', reason: 'Report story' })).statusCode).toBe(200);
    expect((await report(w, { kind: 'press', day: 2, story: 0, event_id: 'sweep', reason: 'twice' })).statusCode).toBe(200);
    expect((await report(w, { kind: 'press', day: 2, story: 1, reason: 'no event id given' })).statusCode).toBe(200);
    expect((await report(w, { kind: 'press', day: 2, story: 'front', reason: 'headline' })).statusCode).toBe(200);
    const stored = (await rows(w)).sort((a, b) => (a.storyIndex ?? -1) - (b.storyIndex ?? -1));
    expect(stored.map(r => [r.kind, r.day, r.storyIndex, r.eventId, r.residentId])).toEqual([
      ['press', 2, null, null, 'sable'], ['press', 2, 0, 'sweep', 'sable'], ['press', 2, 1, null, 'sable'],
    ]);
    expect(stored[0]!.text).toBe(`${MODEL.headline}\n${MODEL.dek}`);
    expect(stored[1]!.text).toBe('Market Row\nThe Fellow swept Market Row before the stalls opened.');
    expect(stored.every(r => r.conversationId === null && r.lines === null)).toBe(true);
  });
  it('refuse template editions, missing stories, stale event ids and editions never printed', async () => {
    const w = await world();
    await printEdition(w.id, { ...MODEL, day: 3, source: 'template' });
    await printEdition(w.id, { ...MODEL, day: 4 });
    for (const payload of [
      { kind: 'press', day: 3, story: 0, reason: 'template' }, { kind: 'press', day: 3, story: 'front', reason: 'template' },
      { kind: 'press', day: 4, story: 2, reason: 'only two stories' }, { kind: 'press', day: 4, story: 0, event_id: 'other', reason: 'stale' },
      { kind: 'press', day: 4, story: 1, event_id: 'sweep', reason: 'stale' }, { kind: 'press', day: 9, story: 0, reason: 'never printed' },
    ]) expect((await report(w, payload)).statusCode, JSON.stringify(payload)).toBe(404);
    expect(await rows(w)).toHaveLength(0);
  });
  it('find a paper printed in the world a save was restored from', async () => {
    const parent = await world();
    await printEdition(parent.id, MODEL);
    const [row] = await database.db.select().from(worlds).where(eq(worlds.id, parent.id));
    const branch = { id: randomUUID(), deviceId: parent.deviceId };
    await database.db.insert(worlds).values({ ...row!, id: branch.id, branchId: randomUUID(), parentWorldId: parent.id });
    expect((await report(branch, { kind: 'press', day: 2, story: 0, event_id: 'sweep', reason: 'after a reload' })).statusCode).toBe(200);
    expect((await rows(branch))[0]).toMatchObject({ kind: 'press', storyIndex: 0, text: expect.stringContaining('swept Market Row') });
    expect(await rows(parent)).toHaveLength(0);
  });
});

describe('letter reports', () => {
  it('store a delivered reflection letter and refuse authored, undelivered or unknown ones', async () => {
    const w = await world(), id = letterId('odile', 1);
    expect(isGeneratedLetterId(id)).toBe(true);
    await database.db.insert(letters).values([
      { worldId: w.id, id, fromId: 'odile', toId: 'lantern', day: 2, text: 'The broom is by the door.', delivered: true },
      { worldId: w.id, id: letterId('pell', 1), fromId: 'pell', toId: 'player', day: 2, text: 'Not yet read.', delivered: false },
      { worldId: w.id, id: 'welcome_note', fromId: 'pell', toId: 'player', day: 1, text: 'An authored note.', delivered: true },
    ]);
    expect((await report(w, { kind: 'letter', letter_id: id, reason: 'Report letter' })).statusCode).toBe(200);
    for (const letter_id of [letterId('pell', 1), 'welcome_note', letterId('june', 1), 'press_2'])
      expect((await report(w, { kind: 'letter', letter_id, reason: 'x' })).statusCode, letter_id).toBe(404);
    const [row, ...more] = await rows(w);
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({ kind: 'letter', letterId: id, residentId: 'odile', day: 2, text: 'The broom is by the door.' });
  });
});

describe('other reports, validation, the limit and /admin', () => {
  it('keep the client text for other, reject malformed bodies, and limit every kind together', async () => {
    const w = await world();
    await printEdition(w.id, MODEL);
    for (const payload of [
      { kind: 'gossip', ref: 'x', text: 'y', reason: 'unknown kind' }, { kind: 'press', day: 2, story: 3, reason: 'index' },
      { kind: 'press', day: 0, story: 0, reason: 'day' }, { kind: 'press', day: 2, story: 'back', reason: 'item' },
      { kind: 'press', day: 2, story: 0, reason: '' }, { kind: 'press', day: 2, story: 0, reason: 'x'.repeat(501) },
      { kind: 'letter', letter_id: '', reason: 'id' }, { kind: 'other', ref: 'chat', text: '  ', reason: 'empty' },
      { conversation_id: 'not-a-uuid', turn_index: 0, reason: 'x' }, [],
    ]) expect((await report(w, payload)).statusCode, JSON.stringify(payload)).toBe(400);
    expect((await report(w, { kind: 'other', ref: 'chatter:1', text: '<b>odd</b>', resident_id: 'pell', reason: 'bubble' })).statusCode).toBe(200);
    expect((await report(w, { kind: 'press', day: 2, story: 'front', reason: 'front' })).statusCode).toBe(200);
    for (let i = 2; i < REPORT_DAILY_LIMIT; i++)
      expect((await report(w, { kind: 'other', ref: `chatter:${i}`, text: 'line', reason: 'r' })).statusCode).toBe(200);
    expect((await report(w, { kind: 'press', day: 2, story: 0, reason: 'over the limit' })).statusCode).toBe(429);
    // A repeat of something already reported today is still answered, not limited.
    expect((await report(w, { kind: 'press', day: 2, story: 'front', reason: 'repeat' })).statusCode).toBe(200);
    const stored = await rows(w);
    expect(stored).toHaveLength(REPORT_DAILY_LIMIT);
    expect(stored.find(r => r.ref === 'chatter:1')).toMatchObject({ kind: 'other', text: '<b>odd</b>', residentId: 'pell' });

    const json = (await app.inject({ url: '/admin/costs.json', headers: { authorization: 'Bearer secret' } })).json() as { reports: { kind: string; world_id: string }[]; reportsByKind: Record<string, number> };
    const mine = json.reports.filter(r => r.world_id === w.id);
    expect(new Set(mine.map(r => r.kind))).toEqual(new Set(['press', 'other']));
    expect(Object.keys(mine[0]!)[0]).toBe('kind');
    expect(json.reportsByKind.other).toBeGreaterThanOrEqual(REPORT_DAILY_LIMIT - 1);
    const html = (await app.inject({ url: '/admin', headers: { authorization: 'Bearer secret' } })).body;
    expect(html).toContain('<th>Kind</th>'); expect(html).toContain('client text, unverified');
    expect(html).toContain('&lt;b&gt;odd&lt;/b&gt;'); expect(html).not.toContain('<b>odd</b>');
  });
  it('parses the shared contract the client sends', () => {
    expect(parseReportBody({ conversation_id: randomUUID(), turn_index: 1, reason: 'Report line' })?.kind).toBe('dialogue');
    expect(parseReportBody({ kind: 'press', day: 2, story: 'front', reason: 'r' })).toEqual({ kind: 'press', day: 2, story: 'front', reason: 'r' });
    expect(parseReportBody(null)).toBeNull();
    expect(isGeneratedLetterId(letterId('census_12', 4))).toBe(true);
    expect(isGeneratedLetterId('press_4')).toBe(false);
  });
});

it('leaves other worlds alone', async () => {
  const a = await world(), b = await world();
  await printEdition(a.id, MODEL);
  expect((await report(b, { kind: 'press', day: 2, story: 0, reason: 'not mine' })).statusCode).toBe(404);
  expect((await app.inject({ method: 'POST', url: `/v1/worlds/${a.id}/reports`, headers: headers(b), payload: { kind: 'press', day: 2, story: 0, reason: 'x' } })).statusCode).toBe(401);
  expect(await database.db.select().from(reportedTurns).where(and(eq(reportedTurns.worldId, a.id)))).toHaveLength(0);
});
