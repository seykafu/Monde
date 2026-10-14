/**
 * Applying a dialogue turn (GDD §9.1 "the engine disposes", §9.6, §9.9, §19.6; MVP M-05). One transaction:
 * resident state (Regard, mood, recent topics), the proposed memory and favor, the dialogue_turns row and an
 * ai_log row per model call. Only validated, clamped effects reach here (validate.ts).
 */
import { and, eq, inArray } from "drizzle-orm";
import { ResidentState, clamp, type DialogueTurnOutput } from "@monde/shared";
import { aiLog, dialogueTurns, favors, memories, residents } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import type { CallRecord } from "./dialogue.js";
import { LIVE_FAVOR_STATUSES } from "./context.js";
import { formatUsd } from "./pricing.js";

/** §9.4: the last 10 topics with the player. */
export const RECENT_TOPICS = 10;
/**
 * GDD-GAP: §9.9 says favors expire in 2-5 days and the engine sets the reward; both belong to M-09's feasibility
 * pass. A proposed favor is stored with the longest window and an empty reward until then.
 */
const PROPOSED_FAVOR_DAYS = 5;

/** Regard, mood and recent topics after one turn. Pure, so the arithmetic is testable on its own. */
export function applyTurnToState(state: ResidentState, effects: DialogueTurnOutput["effects"]): ResidentState {
  const topic = effects.topic.trim();
  const topics = topic
    ? [...state.recent_topics.filter((t) => t.toLowerCase() !== topic.toLowerCase()), topic].slice(-RECENT_TOPICS)
    : state.recent_topics;
  return ResidentState.parse({
    ...state,
    regard: clamp(state.regard + effects.regard_delta, -100, 100),
    mood: {
      ...state.mood,
      valence: clamp(state.mood.valence + effects.mood.valence, -100, 100),
      stress: clamp(state.mood.stress + effects.mood.stress, 0, 100),
    },
    recent_topics: topics,
  });
}

/**
 * GDD-GAP: the dialogue contract's memory has no valence (§9.10.2). Derive it from the turn's mood valence delta
 * (−10..10 → −5..5) so a warm exchange is remembered warmly.
 */
export const memoryValence = (moodValence: number): number => {
  const half = clamp(moodValence / 2, -5, 5);
  return Math.sign(half) * Math.round(Math.abs(half)); // symmetric: −1.5 → −2 like 1.5 → 2
};

export interface AiLogEntry {
  worldId: string;
  residentId: string | null;
  kind: string;
  promptVersion: string;
  call: CallRecord;
  fallback: boolean;
}

export function aiLogRow(entry: AiLogEntry): typeof aiLog.$inferInsert {
  const { call } = entry;
  return {
    worldId: entry.worldId,
    kind: entry.kind,
    residentId: entry.residentId,
    promptVersion: entry.promptVersion,
    model: call.model,
    inputTokens: call.tokens.input,
    cachedTokens: call.tokens.cacheRead,
    cacheWriteTokens: call.tokens.cacheWrite,
    outputTokens: call.tokens.output,
    costUsd: formatUsd(call.costUsd),
    latencyMs: call.latencyMs,
    firstTokenMs: call.firstTokenMs,
    stopReason: call.stopReason,
    validation: call.validation,
    fallback: entry.fallback,
  };
}

export interface PersistTurnArgs {
  worldId: string;
  residentId: string;
  conversationId: string;
  turnIndex: number;
  day: number;
  minute: number;
  place: string;
  /** What the player said (choice or free text); null when they walked up. */
  playerInput: string | null;
  output: DialogueTurnOutput;
  fallback: boolean;
  calls: readonly CallRecord[];
  promptVersion: string;
  /** False when the client left mid-turn: log the calls (they cost money) but record no turn and no effects. */
  recordTurn: boolean;
}

export const dialogueTurnId = (conversationId: string, turnIndex: number): string => `${conversationId}/${turnIndex}`;

export async function persistTurn(db: WorldDatabase, args: PersistTurnArgs): Promise<void> {
  const { worldId, residentId, output } = args;
  const effects = output.effects;
  await db.transaction(async (tx) => {
    if (args.recordTurn && !args.fallback) {
      const where = and(eq(residents.worldId, worldId), eq(residents.id, residentId));
      const [row] = await tx.select({ state: residents.state }).from(residents).where(where).for("update");
      if (!row) throw new Error(`resident ${residentId} vanished mid-turn`);
      await tx.update(residents).set({ state: applyTurnToState(row.state, effects), updatedAt: new Date() }).where(where);

      if (effects.memory) {
        await tx.insert(memories).values({
          worldId, id: `said_${dialogueTurnId(args.conversationId, args.turnIndex)}`, residentId,
          day: args.day, minute: args.minute, kind: "said", text: effects.memory.text, who: ["player"],
          wherePlace: args.place, importance: effects.memory.importance, valence: memoryValence(effects.mood.valence),
        });
      }
      if (effects.favor) {
        // §9.9: one open favor per resident. A second proposal while one is live is dropped.
        const live = await tx.select({ id: favors.id }).from(favors).where(and(
          eq(favors.worldId, worldId), eq(favors.residentId, residentId), inArray(favors.status, [...LIVE_FAVOR_STATUSES]),
        ));
        if (live.length === 0) {
          await tx.insert(favors).values({
            worldId, id: `favor_${dialogueTurnId(args.conversationId, args.turnIndex)}`, residentId,
            template: effects.favor.template, target: effects.favor.target, text: effects.favor.text, status: "proposed",
            createdDay: args.day, expiresDay: args.day + PROPOSED_FAVOR_DAYS, reward: {},
          });
        }
      }
    }
    if (args.recordTurn) {
      await tx.insert(dialogueTurns).values({
        worldId, id: dialogueTurnId(args.conversationId, args.turnIndex), residentId, conversationId: args.conversationId,
        day: args.day, minute: args.minute, playerInput: args.playerInput, output, fallback: args.fallback,
        turnIndex: args.turnIndex,
      });
    }
    if (args.calls.length) {
      await tx.insert(aiLog).values(args.calls.map((call) => aiLogRow({
        worldId, residentId, kind: "dialogue", promptVersion: args.promptVersion, call, fallback: args.fallback,
      })));
    }
  });
}
