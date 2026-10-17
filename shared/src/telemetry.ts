// Q-06's closed wire vocabulary (client queue and server route share it). No dialogue, profile, invite, or arbitrary properties.
import { z } from 'zod';
const day = z.number().int().min(1).max(100000);
const id = z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/);
const scale = z.number().int().min(1).max(5);
export const SurveyAnswer = z.union([
  z.object({ survey: z.literal('day7'), question: z.enum(['pace', 'residents', 'next']), value: scale }).strict(),
  z.object({ survey: z.literal('spring'), question: z.literal('town_change'), value: scale }).strict(),
  z.object({ survey: z.literal('spring'), question: z.literal('talk_again'), resident: id, value: z.enum(['yes', 'not_sure', 'no']) }).strict(),
  z.object({ survey: z.literal('spring'), question: z.literal('anything_else'), value: z.string().max(1000) }).strict(),
]);
export const EventData = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session_start'), day }).strict(),
  z.object({ type: z.literal('day_reached'), day }).strict(),
  z.object({ type: z.literal('conversation_started'), day, resident: id }).strict(),
  z.object({ type: z.literal('mark_solved'), day, id, hints: z.number().int().min(0).max(3) }).strict(),
  ...(['puzzle_opened', 'puzzle_solved', 'puzzle_left'] as const).map(type => z.object({ type: z.literal(type), day, id }).strict()),
  z.object({ type: z.literal('appeal_snapshot'), day, appeal: z.number().finite().min(-1000).max(1000) }).strict(),
  z.object({ type: z.literal('straw_poll_result'), day, share: z.number().min(0).max(100), vane: z.number().min(0).max(100), moss: z.number().min(0).max(100), margin: z.number().min(0).max(100), ballots: z.number().int().nonnegative(), winner: z.enum(['fellow', 'vane', 'moss', 'tie']), clear: z.boolean() }).strict(),
  z.object({ type: z.literal('survey_answer'), day, answer: SurveyAnswer }).strict(),
]);
export type EventData = z.infer<typeof EventData>;
export const TelemetryEvent = z.object({ event_id: z.uuid(), at: z.iso.datetime(), data: EventData }).strict();
export type TelemetryEvent = z.infer<typeof TelemetryEvent>;
export const TelemetryBatch = z.object({ telemetry_id: z.uuid(), world_id: z.uuid().optional(), events: z.array(TelemetryEvent).min(1).max(25) }).strict();
