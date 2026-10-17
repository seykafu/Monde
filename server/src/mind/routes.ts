import { favors } from "../db/schema.js";
import { Favor } from "@monde/shared";
import { loadItems } from '../content/loadContent.js';
import { ingestClientEvents } from './eventIngestion.js';
import { matchGift } from '@monde/shared';
import { closeSession, historyFor, selectSession } from "./sessions.js";
import { compactSession } from "./compaction.js";
import { WorldSemaphores } from "./semaphore.js";
import { SILENT_LOG } from "./nightJob.js";
/**
 * monde-mind HTTP routes for M-05 (GDD §19.4): the player profile, live dialogue over Server-Sent Events and the
 * proximity prewarm. All three sit under /v1/worlds/:w and are authorized by the world token hook in
 * worlds/routes.ts.
 *
 * POST /v1/worlds/:w/talk answers `text/event-stream`:
 *   event: line_delta  {index, text_so_far, attempt}   lines as they stream (attempt 2 replaces attempt 1)
 *   event: thinking    {text: "Hm."}                   nothing visible after 2.5 s
 *   event: error       {code, message}                 the turn failed; a fallback turn follows
 *   event: turn        {conversation_id, resident_id, turn_index, lines[{text, expr}], choices, wrap_up, fallback,
 *                       regard}
 * `turn` is always last and is authoritative: the client replaces any streamed text with its lines.
 * `regard` (G-13, §9.11.2) is the Regard change the engine actually applied this turn, after the first-chat bonus,
 * the +6 daily cap and the clamp: {before, after, delta, hearts_before, hearts_after, first_chat, capped}
 * (shared TurnRegard), or null when nothing was saved (the turn couldn't be persisted).
 */
import type { OutgoingHttpHeaders } from "node:http";
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, asc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { SUMMARY_TIMEOUT_MS, Intent, PlaceId, ResidentId, normalizeChoices, type DialogueTurnOutput, type TurnRegard } from "@monde/shared";
import { aiLog, dialogueTurns, worlds } from "../db/schema.js";
import type { WorldDatabase } from "../worlds/createWorld.js";
import { WALK_UP, buildDialogueRequest, promptVersion, speech } from "./promptBuilder.js";
import { loadDialogueContext, loadResidentPrefix, type DialogueContext } from "./context.js";
import {
  WRAP_UP_NOTE, generateTurn, prewarmParams, type CallRecord, type DialogueTimings, type TurnFailure,
} from "./dialogue.js";
import { aiLogRow, persistTurn } from "./effects.js";
import { LEAVE_CHOICE, THINKING_BEAT, fallbackTurn, giftLine } from "./fallback.js";
import { tokensOf, type MindClient } from "./mindClient.js";
import { PlayerProfile, PlayerProfilePatch, savePlayerProfile, storedProfile } from "./player.js";
import { costUsd } from "./pricing.js";

export interface MindRouteOptions {
  mind: MindClient;
  timings?: Partial<DialogueTimings>;
  /** §9.10 step 1 / brief: at most one prewarm per resident per world every 4 minutes. */
  prewarmIntervalMs?: number;
  /** GDD-GAP: a prewarm is prefill only (no output); 5 s is ample and keeps a stuck call from piling up. */
  prewarmTimeoutMs?: number;
  now?: () => number;
}

export const PREWARM_INTERVAL_MS = 4 * 60 * 1000;

/** §9.10: free text is at most 140 characters; generated choices are at most 90. */
const PLAYER_TEXT = z.string().trim().min(1).max(140);

export const TalkBody = z.object({
  resident_id: ResidentId,
  conversation_id: z.uuid(),
  input: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("open") }),
    z.object({ kind: z.literal('meal'), item: z.string().min(1).max(200), event_id: z.string().min(1).max(200), text: PLAYER_TEXT }),
    z.object({ kind: z.literal('gift'), item: z.string().min(1).max(200), reaction: z.enum(['love', 'like', 'neutral', 'dislike']), event_id: z.string().min(1).max(200), text: PLAYER_TEXT }),
    z.object({ kind: z.literal("choice"), choice_id: z.string().min(1).max(8), text: PLAYER_TEXT, intent: Intent }),
    z.object({ kind: z.literal("say"), text: PLAYER_TEXT }),
  ]),
  context: z.object({
    heart_level: z.number().int().min(1).max(10).optional(),
    day: z.number().int().min(1),
    minute: z.number().int().min(360).max(1560),
    place: PlaceId,
    weather: z.string().trim().min(1).max(40),
    current_activity: z.string().trim().min(1).max(120).nullish(),
    riddle: z.object({ id: z.string().min(1).max(16), hints_allowed: z.number().int().min(0).max(3) }).nullish(),
  }),
});
export type TalkBody = z.infer<typeof TalkBody>;

export const PrewarmBody = z.object({
  resident_id: ResidentId,
  /** The in-game day of the coming conversation (day-gated canon locks are part of block 2). Defaults to the world's. */
  day: z.number().int().min(1).optional(),
});

const issues = (error: z.ZodError) => error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

/** Keep the CORS and request-id headers Fastify's hooks already set; hijacked replies skip Fastify's send path. */
function sseHeaders(reply: FastifyReply): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined) headers[name] = value;
  return {
    ...headers,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  };
}

/** §9.10 step 6: past six exchanges the resident wraps up, and Leave is the only reply. */
function forceWrapUp(output: DialogueTurnOutput): DialogueTurnOutput {
  return { ...output, wrap_up: true, choices: [{ ...LEAVE_CHOICE }] };
}

export function registerMindRoutes(app: FastifyInstance, db: WorldDatabase | undefined, options: MindRouteOptions): void {
  const { mind } = options;
  const now = options.now ?? (() => Date.now());
  const interval = options.prewarmIntervalMs ?? PREWARM_INTERVAL_MS;
  const lastPrewarm = new Map<string, number>();
  const sessions = new WorldSemaphores(1);
  const models = new WorldSemaphores(8);
  const background = new Set<Promise<void>>();
  app.addHook('onClose', async () => { await Promise.allSettled([...background]); });
  // A machine that has just started (a deploy, a cold start) opens its Anthropic connection now, not on the
  // first player's turn. Never blocks startup and never fails it.
  app.addHook('onReady', async () => { void mind.warm?.().catch(() => undefined); });

  app.post<{ Params: { w: string } }>('/v1/worlds/:w/talk/close', async (request, reply) => {
    const parsed = z.object({ resident_id: ResidentId, conversation_id: z.uuid(), day: z.number().int().min(1), minute: z.number().int().min(360).max(1560) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid close request' });
    const b = parsed.data;
    const closed = await sessions.run(`${request.params.w}:${b.resident_id}`, () => closeSession(db!, request.params.w, b.resident_id, b.conversation_id, b.day, b.minute));
    return { closed };
  });

  // ------------------------------------------------------------------------------------------------------------
  // Player profile (GDD §11.1)
  // ------------------------------------------------------------------------------------------------------------
  app.patch<{ Params: { w: string } }>("/v1/worlds/:w/player", async (request, reply) => {
    const patch = PlayerProfilePatch.safeParse(request.body);
    if (!patch.success) return reply.code(400).send({ error: "invalid player profile", issues: issues(patch.error) });
    const [world] = await db!.select({ player: worlds.player }).from(worlds).where(eq(worlds.id, request.params.w));
    const merged = PlayerProfile.safeParse({ ...(world?.player ?? {}), ...patch.data });
    if (!merged.success) return reply.code(400).send({ error: "incomplete player profile", issues: issues(merged.error) });
    // Also applies the Background's starting Regard (a Homecomer's six old neighbours, §11.1).
    await savePlayerProfile(db!, request.params.w, storedProfile(world?.player), merged.data);
    return { player: merged.data };
  });

  // ------------------------------------------------------------------------------------------------------------
  // Dialogue (GDD §9.10)
  // ------------------------------------------------------------------------------------------------------------
  app.post<{ Params: { w: string } }>("/v1/worlds/:w/talk", async (request, reply) => {
    const parsed = TalkBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid talk request", issues: issues(parsed.error) });
    const body = parsed.data;
    const worldId = request.params.w;
    return sessions.run(`${worldId}:${body.resident_id}`, async () => {
      const selected = await selectSession(db!, { worldId, residentId: body.resident_id, requestedId: body.conversation_id, open: body.input.kind === 'open', scene: body.context });
      if ('error' in selected) return reply.code(selected.error === 'unknown_resident' ? 404 : 409).send({ error: selected.error });
      body.conversation_id = selected.session.id;
      const giftId = body.input.kind === 'gift' || body.input.kind === 'meal' ? body.input.item : null;
      const giftItem = giftId ? (await loadItems()).find(i => i.id === giftId) : undefined;
      if (body.input.kind === 'gift' || body.input.kind === 'meal') {
        if (!giftItem) return reply.code(400).send({ error: 'unknown gift item' });
        const receipt = await ingestClientEvents(db!, worldId, [{ kind: body.input.kind, id: body.input.event_id, day: body.context.day, minute: body.context.minute, resident: body.resident_id, item: giftItem.id }]);
        if (receipt.rejected.length) return reply.code(400).send({ error: receipt.rejected[0]!.reason });
      }
      const playerText = body.input.kind === "open" ? null : body.input.text;
      const playerIntent = body.input.kind === "choice" ? body.input.intent : null;
      const loaded = await loadDialogueContext(db!, {
        worldId, residentId: body.resident_id, conversationId: body.conversation_id, scene: body.context,
        playerText, playerIntent, playerSaid: playerText ?? WALK_UP,
      });
      if (!loaded.ok) {
        return loaded.error === "unknown_resident"
          ? reply.code(404).send({ error: "unknown resident" })
          : reply.code(409).send({ error: "conversation belongs to another resident" });
      }
      const ctx = loaded.context;
      // GDD-GAP: the ±7 Heart judgment range unlocks with the L3 Regard perk.
      ctx.validation.heartPerk = (body.context.heart_level ?? 1) >= 3;
      if (giftItem) { ctx.input.focus = 'gift'; ctx.validation.exit = false; }
      if (giftItem) ctx.input.playerSaid = body.input.kind === 'meal' ? `The player shares ${giftItem.name} with you. React in character; the engine already applied the meal's Regard.` : `The player gives you ${giftItem.name}. Your engine-decided reaction is ${matchGift(giftItem, ctx.prefix.card)}. React in character; do not award Regard for this gift (already applied outside conversation).`;
      ctx.input.sessionHistory = selected.session.history;
      ctx.input.sessionSystem = selected.session.system;
      if (selected.resumed) ctx.input.resumedAfter = selected.afterMinutes;
      const previous = selected.resumed ? await db!.select().from(dialogueTurns).where(and(eq(dialogueTurns.worldId, worldId), eq(dialogueTurns.conversationId, body.conversation_id))).orderBy(asc(dialogueTurns.turnIndex)) : [];
      const backlog = previous.flatMap(t => [...(t.playerInput ? [{ who: 'player', text: t.playerInput }] : []), ...t.output.lines.map(l => ({ who: 'resident', text: l.text }))]);
      if (body.context.riddle && !ctx.riddle) {
        return reply.code(400).send({ error: "unknown riddle id" });
      }

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, sseHeaders(reply));
      raw.flushHeaders();
      const send = (event: string, data: unknown) => {
        if (!raw.writableEnded && !raw.destroyed) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const clientGone = new AbortController();
      raw.on("close", () => { if (!raw.writableFinished) clientGone.abort(); });

      const forced = ctx.turnIndex >= selected.session.exchangeLimit - 1;
      // The forced last exchange sees the Fellow off, so a leaving tic belongs in it (validate.ts step 10).
      if (forced) ctx.validation.exit = true;
      const applyLimit = (turn: DialogueTurnOutput): DialogueTurnOutput => {
        if (forced) return forceWrapUp(turn);
        if (ctx.turnIndex + 1 < selected.session.resumeUntil) return { ...turn, wrap_up: false,
          choices: normalizeChoices(turn.choices, { cue: { text: turn.lines.at(-1)?.text ?? '' } }) };
        return turn;
      };
      const fallbackFor = (context: DialogueContext): DialogueTurnOutput => {
        // Mid-conversation the authored line answers the moment (fallback.ts), never greets again.
        const turn = fallbackTurn({
          card: context.prefix.card, state: context.prefix.state, playerName: context.playerName,
          turnIndex: context.turnIndex, riddle: context.riddle, playerText, intent: playerIntent,
          said: (context.input.conversation ?? []).filter((t) => t.speaker === "resident").map((t) => t.text),
          met: selected.resumed || (selected.session.history ?? "").trim() !== "",
          playerPronouns: context.input.player.pronouns, borrowed: context.validation.borrowed,
        });
        if (giftItem) {
          // Authored, but still the resident's: the first line of the pool they could say (fallback.ts GIFT_LINES).
          const reaction = matchGift(giftItem, context.prefix.card);
          const text = giftLine(body.input.kind === 'meal' ? 'meal' : reaction, { card: context.prefix.card, borrowed: context.validation.borrowed });
          turn.lines = [{ text, expr: reaction === 'dislike' ? 'worried' : 'warm' }];
        }
        return applyLimit(turn);
      };
      let proposedFavors: Favor[] = [];
      let salvaged = false;
      const sendTurn = (output: DialogueTurnOutput, fallback: boolean, regard: TurnRegard | null) => send("turn", {
        conversation_id: body.conversation_id, resident_id: body.resident_id, turn_index: ctx.turnIndex,
        resumed: selected.resumed, history: backlog,
        lines: output.lines, choices: output.choices, wrap_up: output.wrap_up, fallback, regard, favors: proposedFavors,
        // The model's reply was cut short and its whole lines kept (dialogue.ts); for logs and evals.
        ...(salvaged && !fallback ? { salvaged: true } : {}),
      });

      try {
        let calls: CallRecord[] = [];
        let rawOutput: string | undefined;
        const built = buildDialogueRequest(ctx.input);
        const promptUser = `${selected.resumed ? `<resumed after_minutes="${selected.afterMinutes}"/>\n` : ''}<player_said> ${speech(playerText ?? WALK_UP)} </player_said>`;
        let output: DialogueTurnOutput;
        let failure: TurnFailure | null = null;
        try {
          const result = await generateTurn({
            mind,
            request: built,
            notes: forced ? [WRAP_UP_NOTE] : [],
            validation: ctx.validation,
            timings: options.timings,
            signal: clientGone.signal,
            onLineDelta: (delta) => send("line_delta", delta),
            onThinking: () => send("thinking", { text: THINKING_BEAT }),
          });
          calls = result.calls;
          rawOutput = result.rawOutput;
          failure = result.failure;
          salvaged = result.salvaged;
          output = result.output ? applyLimit(result.output) : fallbackFor(ctx);
          if (result.salvaged) request.log.warn({ calls: calls.map((c) => [c.stopReason, c.validation, c.tokens.output]) }, "dialogue reply cut short; whole lines salvaged");
          if (result.adjustments.length) request.log.info({ adjustments: result.adjustments }, "dialogue output adjusted");
        } catch (error) {
          request.log.error({ err: error }, "dialogue generation crashed");
          failure = { code: "api_error", message: "The turn failed; using an authored line." };
          output = fallbackFor(ctx);
        }
        const fallback = failure !== null;
        if (failure) request.log.warn({ failure, calls: calls.map((c) => c.validation) }, "dialogue fell back");

        let regard: TurnRegard | null;
        try {
          regard = await persistTurn(db!, {
            worldId, residentId: body.resident_id, conversationId: body.conversation_id, turnIndex: ctx.turnIndex,
            day: body.context.day, minute: body.context.minute, place: body.context.place, playerInput: playerText,
            output, rawOutput, promptUser, gift: body.input.kind === 'gift' || body.input.kind === 'meal', heartLevel: body.context.heart_level, fallback, calls, promptVersion: promptVersion(), recordTurn: !clientGone.signal.aborted,
          });
        } catch (error) {
          request.log.error({ err: error, calls }, "persisting the dialogue turn failed");
          send("error", { code: "persist_failed", message: "The turn couldn't be saved; using an authored line." });
          sendTurn(fallbackFor(ctx), true, null);
          return;
        }
        proposedFavors = (await db!.select().from(favors).where(and(eq(favors.worldId,worldId),eq(favors.residentId,body.resident_id),eq(favors.status,'proposed'),gte(favors.expiresDay,body.context.day))))
          .flatMap(f => { const parsed = Favor.safeParse(f.reward); return parsed.success ? [parsed.data] : []; });
        if (failure) send("error", failure);
        sendTurn(output, fallback, regard);
      } catch (error) {
        request.log.error({ err: error }, "talk stream failed");
        send("error", { code: "internal", message: "Something went wrong; using an authored line." });
        sendTurn(fallbackFor(ctx), true, null);
      } finally {
        if (!raw.writableEnded) raw.end();
        if (selected.staleId) {
          const work = compactSession({ db: db!, mind, gate: task => models.run(worldId, task), callTimeoutMs: SUMMARY_TIMEOUT_MS, log: SILENT_LOG }, worldId, selected.staleId)
            .catch((error: unknown) => { request.log.error({ err: error }, 'conversation compaction failed; night pass will retry'); });
          background.add(work);
          void work.finally(() => background.delete(work));
        }
      }
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  // Prewarm (GDD §9.10 step 1): never fails the client.
  // ------------------------------------------------------------------------------------------------------------
  app.post<{ Params: { w: string } }>("/v1/worlds/:w/prewarm", async (request, reply) => {
    const parsed = PrewarmBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid prewarm request", issues: issues(parsed.error) });
    const worldId = request.params.w;
    const residentId = parsed.data.resident_id;
    if (!mind.enabled) return { warmed: false, reason: "disabled" };

    const key = `${worldId}:${residentId}`;
    const at = now();
    const last = lastPrewarm.get(key);
    if (last !== undefined && at - last < interval) return { warmed: false, reason: "recent" };

    const prefix = await loadResidentPrefix(db!, worldId, residentId);
    if (!prefix) return reply.code(404).send({ error: "unknown resident" });
    const [world] = await db!.select({ day: worlds.day }).from(worlds).where(eq(worlds.id, worldId));
    const day = parsed.data.day ?? world?.day ?? 1;

    if (lastPrewarm.size > 10_000) for (const [k, t] of lastPrewarm) if (at - t >= interval) lastPrewarm.delete(k);
    lastPrewarm.set(key, at);

    const params = prewarmParams(prefix, day, await historyFor(db!, worldId, residentId));
    const started = performance.now();
    try {
      const message = await mind.createMessage(params, { signal: AbortSignal.timeout(options.prewarmTimeoutMs ?? 5000) });
      const tokens = tokensOf(message.usage);
      try {
        await db!.insert(aiLog).values(aiLogRow({
          worldId, residentId, kind: "prewarm", promptVersion: promptVersion(), fallback: false,
          call: {
            attempt: 1, model: params.model, tokens, costUsd: costUsd(tokens), latencyMs: Math.round(performance.now() - started),
            firstTokenMs: null, stopReason: message.stop_reason ?? "none", validation: "ok",
          },
        }));
      } catch (error) {
        request.log.warn({ err: error }, "prewarm ai_log write failed");
      }
      return { warmed: true };
    } catch (error) {
      // The API may reject max_tokens: 0 (or anything else): log it and move on. The real turn will just be cold.
      request.log.warn({ err: error, residentId }, "prewarm failed");
      return { warmed: false, reason: "error" };
    }
  });
}
