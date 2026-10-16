import { expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { fallbackPress, fillHeadline, rankPressEvents, UNSUPPORTED_SCHEMA_KEYS, type HeadlineTemplate } from '@monde/shared';
import { pressRequest, validatePress } from '../press.js';
const event = (id: string,importance=2,day=3) => ({ id,importance,day,minute:600,type:'sweeping',summary:`A broom was used at ${id}.`,who:['player'] });
it('ranks yesterday only, deduplicates, and uses novelty, reach and player involvement',() => {
  const ranked = rankPressEvents([event('small'),event('big',7),event('future',10,4),event('big',7),{ ...event('novel'),type:'arrival',known:20 }],3,['sweeping']);
  expect(ranked.map(e => e.id)).toEqual(['big','novel','small']);
});
it('uses B.5 with complete facts and never leaves placeholders or invents missing facts',() => {
  const { headlines } = parse(readFileSync(new URL('../../../../content/lines/headlines.yaml',import.meta.url),'utf8')) as { headlines: HeadlineTemplate[] };
  const paper = fallbackPress(4,[],headlines,{ coins:123 });
  expect(paper.headline).toBe('TOWN FUND STANDS AT 123 COINS.'); expect(paper.stories).toHaveLength(2);
  expect(JSON.stringify(paper)).not.toMatch(/\{resident:/); expect(fillHeadline('{name|upper}',{})).toBeNull();
  expect(fallbackPress(4,[event('real')],headlines).stories[0]!.text).toContain('real');
});
it('uses low effort, required closed objects, no unsupported schema keywords or sampling',() => {
  const request = pressRequest([]); expect(request.model).toBe('claude-haiku-5-5'); expect(request.output_config.effort).toBe('low');
  for (const key of ['temperature','top_p','top_k','thinking']) expect(request).not.toHaveProperty(key);
  const visit = (node: unknown): void => { if (!node || typeof node !== 'object') return;
    for (const [k,v] of Object.entries(node)) { expect(UNSUPPORTED_SCHEMA_KEYS).not.toContain(k); visit(v); }
    if ('properties' in node) { const n = node as { properties: object;required: string[];additionalProperties: boolean }; expect(n.additionalProperties).toBe(false); expect(n.required.sort()).toEqual(Object.keys(n.properties).sort()); }
  }; visit(request.output_config.format.schema);
});
it('rejects banned language, invented sources and the wrong story count',() => {
  const copy = { headline:'The lamps are lit.',dek:'From yesterday.',stories:[{ event_id:'e',title:'The lane',text:'The lamps were lit.' },{ event_id:null,title:'Letters',text:'The desk is open.' }] };
  expect(validatePress(JSON.stringify(copy),new Set(['e']))).toEqual(copy);
  expect(validatePress(JSON.stringify({ ...copy,headline:'A vibrant community.' }),new Set(['e']))).toBeNull();
  expect(validatePress(JSON.stringify(copy),new Set())).toBeNull();
  expect(validatePress(JSON.stringify({ ...copy,stories:[] }),new Set(['e']))).toBeNull();
});

it('persists one edition from yesterday’s real events, includes Lantern letters and survives a retry',async () => {
  const { createTestDatabase } = await import('../../db/testDatabase.js');
  const { createWorld } = await import('../../worlds/createWorld.js');
  const { events,letters } = await import('../../db/schema.js');
  const { loadPlaceRegistry } = await import('../places.js');
  const { SILENT_LOG } = await import('../nightJob.js');
  const { runPress,readPress } = await import('../press.js');
  const { message } = await import('./fakeMind.js');
  const database = await createTestDatabase();
  try {
    const world = await createWorld(database.db,'press-test','invite');
    await database.db.insert(events).values({ worldId:world.id,id:'actual',day:1,minute:600,type:'sweeping',wherePlace:'market_row.market_street',who:['player','odile'],importance:2,tags:['sweeping'],summary:'The Fellow swept Market Row.' });
    await database.db.insert(letters).values({ worldId:world.id,id:'editor',fromId:'odile',toId:'lantern',day:2,text:'The broom is by the door.' });
    const copy = { headline:'MARKET ROW SWEPT',dek:'A broom and a morning.',stories:[{ event_id:'actual',title:'Market Row',text:'The Fellow swept Market Row.' },{ event_id:null,title:'Letters desk',text:'The letters desk is open.' }] };
    let calls = 0;
    const mind = { enabled:true,createMessage:async () => { calls++; return message(JSON.stringify(copy),"end_turn"); },streamMessage:async () => { throw new Error('press must not stream'); } };
    const deps = { db:database.db,mind,gate:<T>(work:() => Promise<T>) => work(),callTimeoutMs:1000,log:SILENT_LOG };
    const night = { worldId:world.id,day:1,residentIds:new Set(['sable']),places:await loadPlaceRegistry(),town:{ pillars:{ prosperity:18,safety:30,spirit:22,charm:25 },census:210,events:[] },forecast:'sun',eventsTomorrow:['Market today.'],flags:[] };
    await runPress(deps,night,100); await runPress(deps,night,100);
    expect(calls).toBe(1);
    const paper = await readPress(database.db,world.id,2);
    expect(paper).toMatchObject({ source:'model',event_ids:['actual'],notices:['Market today.'],letters:[{ from:'odile',text:'The broom is by the door.' }] });
    expect(paper!.stories[0]!.text).toContain('swept Market Row');
  } finally { await database.client.close(); }
},30_000);
