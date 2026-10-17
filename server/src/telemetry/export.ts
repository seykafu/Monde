import { and, inArray, ne } from 'drizzle-orm';
import { aiLog, surveyAnswers, telemetryEvents } from '../db/schema.js';
import type { WorldDatabase } from '../worlds/createWorld.js';
type EventRow = typeof telemetryEvents.$inferSelect;
type SurveyRow = typeof surveyAnswers.$inferSelect;
/** RFC 4180; guard spreadsheet formula injection, including the optional typed note. */
export function csv(headers: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    let s = v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[\s]*[=+@-]/.test(s)) s = `'${s}`;
    return `"${s.replaceAll('"', '""')}"`;
  };
  return [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
const ratio = (n: number, d: number) => d ? n / d : null;
const median = (xs: number[]) => {
  const s = [...xs].sort((a,b) => a-b), m = Math.floor(s.length/2);
  return s.length ? s.length % 2 ? s[m]! : (s[m-1]!+s[m]!)/2 : null;
};
const key = (e: { telemetryId: string; worldId: string | null }) => `${e.telemetryId}/${e.worldId ?? 'offline'}`;
export function summarize(events: EventRow[], answers: SurveyRow[]) {
  const groups = new Map<string, EventRow[]>();
  for (const e of events) { const k = key(e); groups.set(k,[...(groups.get(k) ?? []),e]); }
  const players = [...groups].map(([k, rows]) => {
    const reached = rows.filter(e => e.type === 'day_reached');
    const days = new Set(reached.map(e => e.day));
    const opened = new Set(rows.flatMap(e => e.data.type === 'puzzle_opened' ? [e.data.id] : []));
    const solved = new Set(rows.flatMap(e => e.data.type === 'puzzle_solved' ? [e.data.id] : []));
    const marks = new Map(rows.flatMap(e => e.data.type === 'mark_solved' ? [[e.data.id,e.data.hints] as const] : []));
    const poll = [...rows].reverse().find(e => e.data.type === 'straw_poll_result')?.data;
    const responses = answers.filter(a => key(a) === k && a.survey === 'spring');
    const yes = new Set(responses.filter(a => a.question === 'talk_again' && a.value === 'yes').map(a => a.resident));
    const change = [...responses].reverse().find(a => a.question === 'town_change');
    return { telemetry_id: rows[0]!.telemetryId, world_id: rows[0]!.worldId,
      starter: rows.some(e => e.type === 'session_start' && e.day === 1),
      reached_day10: [...days].some(d => d >= 10), reached_day25: [...days].some(d => d >= 25),
      observed_days: days.size,
      conversations_per_day: [...days].map(day => rows.filter(e => e.type === 'conversation_started' && e.day === day).length),
      appeal35_by_day10: rows.some(e => e.data.type === 'appeal_snapshot' && e.day <= 10 && e.data.appeal >= 35),
      marks_solved: marks.size, marks_at_most_hint2: [...marks.values()].filter(h => h <= 2).length,
      puzzles_opened: opened.size, puzzles_abandoned: [...opened].filter(id => !solved.has(id)).length,
      straw_poll_share: poll?.type === 'straw_poll_result' ? poll.share : null,
      spring_respondent: responses.length > 0, talk_again_yes: yes.size,
      town_change: typeof change?.value === 'number' ? change.value : null,
    };
  });
  const starters = players.filter(p => p.starter), finishers = players.filter(p => p.reached_day25);
  const shares = players.flatMap(p => p.straw_poll_share === null ? [] : [p.straw_poll_share]);
  const mean = shares.reduce((a,b) => a+b,0)/(shares.length || 1);
  const changes = players.filter(p => p.town_change !== null);
  const sum = (field: 'marks_solved' | 'marks_at_most_hint2' | 'puzzles_opened' | 'puzzles_abandoned') => players.reduce((s,p) => s+p[field],0);
  return { definitions: {
    unit: 'installation + world; offline games share one installation cohort',
    retention: 'Only observed Day-1 session starters; later opt-ins excluded from retention denominators.',
    conversations: 'Median over observed player-days, including zero-conversation days; repeated loads of a day share a bucket.',
    appeal: 'Dawn snapshots through Day 10; improvements reversed before dawn are not observed.',
    finishers: 'Reached Day 25; skipped surveys count as no positive response for talk-again. Town-change agreement uses answered items (4 or 5).',
    abandonment: 'Distinct player/puzzle opened and never solved by export time; ongoing games may solve later.',
    limitations: 'Opt-in sample; capped retries can lose data. Safety incidents require separate confirmed reports. AI logs lack attempt identity, so exact first-attempt validation cannot be derived.',
  }, counts: { observed_players: players.length, starters: starters.length, finishers: finishers.length, spring_respondents: players.filter(p => p.spring_respondent).length, town_change_answers: changes.length },
  metrics: {
    reached_day10: ratio(starters.filter(p => p.reached_day10).length,starters.length),
    reached_day25: ratio(starters.filter(p => p.reached_day25).length,starters.length),
    conversations_per_day_median: median(players.flatMap(p => p.conversations_per_day)),
    appeal35_by_day10: ratio(starters.filter(p => p.appeal35_by_day10).length,starters.length),
    finishers_talk_again_at_least3: ratio(finishers.filter(p => p.talk_again_yes >= 3).length,finishers.length),
    town_change_agree: ratio(changes.filter(p => p.town_change! >= 4).length,changes.length),
    marks_at_most_hint2: ratio(sum('marks_at_most_hint2'),sum('marks_solved')),
    puzzles_abandoned: ratio(sum('puzzles_abandoned'),sum('puzzles_opened')),
    straw_poll_share_population_stddev_points: shares.length ? Math.sqrt(shares.reduce((s,v) => s+(v-mean)**2,0)/shares.length) : null,
  }, players };
}
export async function exportTelemetry(db: WorldDatabase) {
  const events = await db.select().from(telemetryEvents).orderBy(telemetryEvents.at, telemetryEvents.eventId);
  const answers = await db.select().from(surveyAnswers).orderBy(surveyAnswers.createdAt, surveyAnswers.eventId);
  const worldIds = [...new Set(events.flatMap(e => e.worldId ? [e.worldId] : []))];
  // No raw prompts, replies, resident text, device IDs, or invite codes in exports.
  const ai = worldIds.length ? await db.select({ world_id: aiLog.worldId, kind: aiLog.kind, cost: aiLog.costUsd,
    first_token_ms: aiLog.firstTokenMs, validation: aiLog.validation }).from(aiLog).where(and(inArray(aiLog.worldId,worldIds),ne(aiLog.model,'none'))) : [];
  const aiByWorld = worldIds.map(world_id => {
    const logs = ai.filter(l => l.world_id === world_id);
    const latencies = logs.filter(l => l.kind === 'dialogue').flatMap(l => l.first_token_ms === null ? [] : [l.first_token_ms]).sort((a,b) => a-b);
    const days = new Set(events.filter(e => e.worldId === world_id && e.type === 'day_reached').map(e => e.day)).size;
    const cost = logs.reduce((s,l) => s+Number(l.cost),0);
    return { world_id, observed_days: days, ai_cost_usd: cost, ai_cost_per_observed_day: ratio(cost,days), logged_calls: logs.length,
      logged_call_validation_pass_rate: ratio(logs.filter(l => l.validation === 'ok').length,logs.length),
      dialogue_first_token_p50_ms: median(latencies), dialogue_first_token_p95_ms: latencies.length ? latencies[Math.ceil(latencies.length*0.95)-1] : null };
  });
  const fleetDays = aiByWorld.reduce((s,w) => s+w.observed_days,0);
  const fleetLatency = ai.filter(l => l.kind === 'dialogue').flatMap(l => l.first_token_ms === null ? [] : [l.first_token_ms]).sort((a,b) => a-b);
  return {
    eventsCsv: csv(['event_id','telemetry_id','world_id','at','received_at','type','day','data'],events.map(e => [e.eventId,e.telemetryId,e.worldId,e.at,e.createdAt,e.type,e.day,e.data])),
    surveysCsv: csv(['event_id','telemetry_id','world_id','survey','question','resident_id','answer','received_at'],answers.map(a => [a.eventId,a.telemetryId,a.worldId,a.survey,a.question,a.resident,a.value,a.createdAt])),
    summary: { ...summarize(events,answers), ai_by_world: aiByWorld,
      ai_fleet: {
        ai_cost_per_observed_world_day: ratio(aiByWorld.reduce((s,w) => s+w.ai_cost_usd,0),fleetDays),
        dialogue_first_token_p50_ms: median(fleetLatency),
        dialogue_first_token_p95_ms: fleetLatency.length ? fleetLatency[Math.ceil(fleetLatency.length*0.95)-1] : null,
        logged_call_validation_pass_rate: ratio(ai.filter(l => l.validation === 'ok').length,ai.length),
      },
      ai_note: 'Existing ai_log totals for consenting worlds, including calls before opt-in; observed days are telemetry coverage, not exact billed days. Per-call validation is not first-attempt validation. No AI events are duplicated.' },
  };
}
