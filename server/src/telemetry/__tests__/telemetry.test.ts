import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { createTestDatabase } from '../../db/testDatabase.js';
import { aiLog, devices, worlds, surveyAnswers, telemetryEvents } from '../../db/schema.js';
import { parseConfig } from '../../config.js';
import { worldToken } from '../../worlds/routes.js';
import { registerTelemetryRoutes, TelemetryBatch } from '../routes.js';
import { exportTelemetry, csv } from '../export.js';
import type { EventData } from '@monde/shared';
const config = parseConfig({ LOG_LEVEL: 'silent' });
const event = (data: EventData) => ({ event_id: randomUUID(), at: new Date().toISOString(), data });
const body = (data: EventData = { type: 'day_reached', day: 1 }) => ({ telemetry_id: randomUUID(), events: [event(data)] });
describe('Q-06 ingestion and CSV export', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  const app = Fastify();
  beforeAll(async () => { db = await createTestDatabase(); registerTelemetryRoutes(app,config,db.db); await app.ready(); },30000);
  afterAll(async () => { await app.close(); await db.client.close(); });
  it('strict schema rejects private/unknown fields, invalid answers and oversized batches', () => {
    expect(TelemetryBatch.safeParse(body()).success).toBe(true);
    for(const invalid of [ { ...body(), name:'secret' }, { ...body(), events: Array.from({length:26},() => event({ type:'day_reached',day:1 })) },
      { ...body(), events: [{ ...event({type:'day_reached',day:1}), text:'secret' }] },
      body({ type:'survey_answer', day:7, answer:{ survey:'day7', question:'pace', value:6 } }),
      { ...body(), events:[event({ type:'conversation_started',day:1,resident:'pell' }), { ...event({type:'day_reached',day:1}), data:{type:'day_reached',day:1,dialogue:'secret'} }] },
    ]) expect(TelemetryBatch.safeParse(invalid).success).toBe(false);
  });
  it('rejects unknown fields, oversize batches and bodies on the route', async () => {
    for (const payload of [{ ...body(), invite_code:'private' }, { ...body(), events: Array.from({length:26},() => event({type:'day_reached',day:1})) }]) {
      expect((await app.inject({method:'POST',url:'/v1/telemetry',payload})).statusCode).toBe(400);
    }
    expect((await app.inject({method:'POST',url:'/v1/telemetry',payload:{...body(), padding:'x'.repeat(70000)}})).statusCode).toBe(413);
  });
  it('accepts anonymous installs, deduplicates retries, persists survey answers, limits per ID', async () => {
    const payload = body({type:'survey_answer',day:26,answer:{survey:'spring',question:'anything_else',value:'=SUM(1,2)\n"hello"'}});
    for(let i=0;i<12;i++) expect((await app.inject({method:'POST',url:'/v1/telemetry',payload})).statusCode).toBe(202);
    expect((await app.inject({method:'POST',url:'/v1/telemetry',payload})).statusCode).toBe(429);
    expect((await db.db.select().from(surveyAnswers)).filter(a => a.telemetryId === payload.telemetry_id)).toHaveLength(1);
  });
  it('authenticates world links and exports seeded metrics and escaped CSV', async () => {
    const world = randomUUID(), install = randomUUID();
    await db.db.insert(devices).values({id:'telemetry-test-device',inviteCode:'DO-NOT-EXPORT'});
    await db.db.insert(worlds).values({id:world,deviceId:'telemetry-test-device',seed:1,status:'active',branchId:randomUUID(),aiSpendDay:1});
    await db.db.insert(aiLog).values({worldId:world,kind:'dialogue',model:'test',promptVersion:'test',inputTokens:1,cachedTokens:0,cacheWriteTokens:0,outputTokens:1,costUsd:'0.03',latencyMs:400,firstTokenMs:200,stopReason:'end_turn',validation:'ok',fallback:false});
    const payload = { telemetry_id:install,world_id:world,events:[
      event({type:'session_start',day:1}),event({type:'day_reached',day:1}),event({type:'day_reached',day:10}),event({type:'day_reached',day:25}),
      event({type:'conversation_started',day:1,resident:'pell'}),event({type:'appeal_snapshot',day:10,appeal:35}),
      event({type:'puzzle_opened',day:1,id:'PZ-01'}),event({type:'puzzle_opened',day:1,id:'PZ-02'}),event({type:'puzzle_solved',day:1,id:'PZ-01'}),
      event({type:'mark_solved',day:1,id:'T-01',hints:2}),
      ...['pell','tib','margo'].map(resident => event({type:'survey_answer',day:26,answer:{survey:'spring',question:'talk_again',resident,value:'yes'}})),
      event({type:'survey_answer',day:26,answer:{survey:'spring',question:'town_change',value:4}}),
    ] };
    expect((await app.inject({method:'POST',url:'/v1/telemetry',payload})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/v1/telemetry',payload,headers:{authorization:`Bearer ${'0'.repeat(64)}`}})).statusCode).toBe(401);
    expect((await app.inject({method:'POST',url:'/v1/telemetry',payload,headers:{authorization:`Bearer ${worldToken(world,'telemetry-test-device','monde-local-development-only')}`}})).statusCode).toBe(202);
    const result = await exportTelemetry(db.db);
    expect(result.eventsCsv).toContain(world); expect(result.surveysCsv).toContain('talk_again');
    expect(result.surveysCsv).toContain("'=SUM(1,2)"); expect(result.surveysCsv).toContain('""hello""');
    expect(result.eventsCsv).not.toContain('DO-NOT-EXPORT');
    expect(result.summary.metrics).toMatchObject({ reached_day10:1,reached_day25:1,appeal35_by_day10:1,finishers_talk_again_at_least3:1,town_change_agree:1,marks_at_most_hint2:1,puzzles_abandoned:0.5,conversations_per_day_median:0 });
    expect(result.summary.ai_by_world[0]?.world_id).toBe(world);
    expect(result.summary.ai_fleet).toMatchObject({ai_cost_per_observed_world_day:0.01,dialogue_first_token_p50_ms:200,logged_call_validation_pass_rate:1});
    expect((await db.db.select().from(telemetryEvents)).some(e => e.worldId === world)).toBe(true);
    expect(csv(['note'],[['hello, "town"\nagain']])).toBe('"note"\r\n"hello, ""town""\nagain"\r\n');
  });
});
