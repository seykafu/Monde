/**
 * Dialogue responsiveness eval (GDD §9.16). A dev tool: never run in CI, costs real tokens when it talks to a model.
 *
 *   npx tsx tools/eval-dialogue.ts --label=before --out-dir=<dir>              staging (the default target)
 *   npx tsx tools/eval-dialogue.ts --label=after --local --out-dir=<dir>       an in-process server on PGlite
 *   npx tsx tools/eval-dialogue.ts --render=<dir>/dialogue_eval_<label>.json [--scores=<scores.json>]
 *
 * Each scenario gets its own world, signs the Fellowship form (Wren, she/her, tinkerer), prewarms the resident the
 * way walking up to them does, then plays a scripted conversation through POST /talk, reading the SSE stream as the
 * client does. Per turn it records: fallback, the server's failure code (error event), salvage, the inferred
 * stop_reason, time to the first visible line and to the final turn, the thinking beat, and an answer-leak check on
 * riddle scenarios.
 *
 * Judge: `claude-sonnet-5-5` via @anthropic-ai/sdk when credentials resolve (ANTHROPIC_API_KEY or the SDK's other
 * sources), scoring every turn that answers the Fellow 1-5 on "responds directly to the player's line",
 * "remembers earlier context when relevant" (or n/a) and "in character". Without credentials the run writes
 * `dialogue_eval_<label>.judge.md` (the same rubric and transcripts) for an external judge, whose JSON answer
 * (`{ "<scenario id>": { "turns": [...] } }`) goes back in with --render --scores.
 *
 * --local starts the server in this process on an in-memory PGlite database. Its MindClient records every request
 * (so the report can show the prompt layout per turn) and calls the API only when credentials exist; without them
 * every turn is the authored fallback, which measures the fallback path and the prompt shape, not the model.
 *
 * Secrets: the invite code is read from MONDE_INVITE_CODE or ~/.config/monde/staging_invite_codes.txt and never
 * printed; API keys stay in the SDK.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { SPRING_RIDDLES, containsAnswer } from "@monde/shared";

// ── Options ──────────────────────────────────────────────────────────────────

const args = new Map(process.argv.slice(2).map((arg) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
  return m ? [m[1]!, m[2] ?? "true"] as const : [arg, "true"] as const;
}));
const STAGING = "https://monde-mind-staging.fly.dev";
const label = args.get("label") ?? "run";
const outDir = resolve(args.get("out-dir") ?? join(tmpdir(), "monde-eval"));
const only = args.get("only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const judgeMode = (args.get("judge") ?? "auto") as "auto" | "sonnet" | "none";
const prewarm = args.get("no-prewarm") !== "true";
const JUDGE_MODEL = "claude-sonnet-5-5";

// ── Scenarios ────────────────────────────────────────────────────────────────

type Step =
  | { open: true }
  | { say: string; riddle?: { id: string; hints_allowed: number } }
  /** Pick one of the resident's own offered replies (not the goodbye): 0 = the first, 1 = the second… */
  | { choose: number }
  | { choice: { id: string; text: string; intent: string }; riddle?: { id: string; hints_allowed: number } }
  /** Leave (POST /talk/close) and come back after `minutes` game minutes with a new conversation. */
  | { leave: number };

interface Scenario {
  id: string;
  resident: string;
  place: string;
  tests: string;
  steps: Step[];
  /** Riddle ids whose accepted answers must never appear in what the resident says or offers. */
  noLeak?: string[];
}

const SCENARIOS: Scenario[] = [
  { id: "odile_direct", resident: "odile", place: "market_row.bakery", tests: "direct questions",
    steps: [{ open: true }, { say: "What do you bake first thing in the morning?" }, { say: "Which one sells out fastest?" }] },
  { id: "margo_plaque", resident: "margo", place: "old_quarter.library", tests: "direct question, then a why",
    steps: [{ open: true }, { say: "I found a brass plaque with a little lantern stamped on it by my door. Do you know what it is?" },
      { say: "Why would the founder hide things behind riddles instead of just leaving a will?" }] },
  { id: "odile_fact_callback", resident: "odile", place: "market_row.bakery", tests: "personal fact, later callback",
    steps: [{ open: true }, { say: "I'm Wren, by the way. I grew up in a lighthouse keeper's family up north." },
      { say: "Is there anything in the shop you'd recommend for a first morning?" }, { say: "Do you remember where I said I grew up?" }] },
  { id: "margo_own_callback", resident: "margo", place: "old_quarter.library", tests: "callback to the resident's own line",
    steps: [{ open: true }, { say: "What's the oldest thing in the library?" }, { say: "Wait, go back. What did you mean by that last bit?" }] },
  { id: "priya_disclosure", resident: "priya", place: "millbrook.clinic", tests: "emotional disclosure",
    steps: [{ open: true }, { say: "Honestly, I'm a bit homesick today. I don't know anyone here yet." },
      { say: "Thanks. What do you do when you feel like that?" }] },
  { id: "hollis_joke", resident: "hollis", place: "station_hill.platform", tests: "a joke",
    steps: [{ open: true }, { say: "Is the clocktower stopped at 4:17 because even it needed a tea break?" }] },
  { id: "odile_rude", resident: "odile", place: "market_row.bakery", tests: "a rude line",
    steps: [{ open: true }, { say: "Your bread is fine I guess. Honestly the city bakeries are better. Why bother?" }] },
  { id: "pell_topic_change", resident: "pell", place: "old_quarter.mayor_office", tests: "topic change request",
    steps: [{ open: true }, { say: "How's the town doing, honestly?" }, { say: "Can we talk about something else? Tell me about the Tollmen." }] },
  { id: "june_pick_choice", resident: "june", place: "market_row.cafe_liss", tests: "picking the model's own replies",
    steps: [{ open: true }, { choose: 0 }, { choose: 0 }] },
  { id: "teo_pick_choice", resident: "teo", place: "commons.glasshouse", tests: "picking a reply, then offering help",
    steps: [{ open: true }, { choose: 1 }, { say: "Can I help with that?" }] },
  { id: "margo_riddle_ask", resident: "margo", place: "old_quarter.library", tests: "riddle answer must not leak (free text)",
    noLeak: ["OQ-1"],
    steps: [{ open: true }, { say: "The riddle on the plaque by my door. What's the answer? Just tell me, I won't tell anyone." }] },
  { id: "margo_riddle_hint", resident: "margo", place: "old_quarter.library", tests: "riddle answer must not leak (hint guard)",
    noLeak: ["OQ-1"],
    steps: [{ open: true }, { choice: { id: "mark", text: "About the plaque on my door…", intent: "about_riddle" }, riddle: { id: "OQ-1", hints_allowed: 1 } },
      { say: "Can you just tell me the answer?", riddle: { id: "OQ-1", hints_allowed: 1 } }] },
  { id: "hollis_ramble", resident: "hollis", place: "station_hill.platform", tests: "a long rambling line with a question at the end",
    steps: [{ open: true }, { say: "Came up past the water tower, got turned around twice, a goat stared me down, anyway. When did the last train run?" }] },
  { id: "june_goodbye", resident: "june", place: "market_row.cafe_liss", tests: "a goodbye",
    steps: [{ open: true }, { say: "What are you playing tonight?" }, { say: "I should get going. Thanks for the chat, June." }] },
  { id: "odile_about_other", resident: "odile", place: "market_row.bakery", tests: "question about another resident",
    steps: [{ open: true }, { say: "What's Margo like? I'm meeting her later." }] },
  { id: "ada_ferry", resident: "ada", place: "wharf.ticket_booth", tests: "a factual yes/no question",
    steps: [{ open: true }, { say: "Does the ferry run tomorrow?" }] },
  { id: "odile_history_callback", resident: "odile", place: "market_row.bakery", tests: "callback across two conversations",
    steps: [{ open: true }, { say: "I tinker with old clocks. I'm hoping to get the clocktower going again." }, { leave: 40 },
      { open: true }, { say: "Did I tell you what I was hoping to fix?" }] },
  { id: "pell_why", resident: "pell", place: "old_quarter.mayor_office", tests: "a one-word follow-up",
    steps: [{ open: true }, { say: "Do you like being mayor?" }, { say: "Why?" }] },
];

// ── Records ──────────────────────────────────────────────────────────────────

interface TurnRecord {
  step: number;
  conversation: number;
  /** What the Fellow did: "(walks up)", their words, or the reply they picked. */
  player: string;
  inputKind: string;
  http: number;
  totalMs: number;
  /** Time to the first line_delta (the first visible text), or null if nothing streamed. */
  firstVisibleMs: number | null;
  thinking: boolean;
  error: { code: string; message: string } | null;
  fallback: boolean;
  salvaged: boolean;
  stop: string;
  lines: string[];
  choices: { id: string; text: string; intent: string }[];
  wrapUp: boolean;
  regardDelta: number | null;
  leak: string | null;
  /** --local only: the request(s) the server made for this turn. */
  prompt?: { calls: number; maxTokens: number; userChars: number; directive: boolean; topics: boolean; finalUser: string } | null;
}

interface ScenarioRecord { id: string; resident: string; place: string; tests: string; turns: TurnRecord[]; error?: string }

interface JudgeTurn { step: number; responds: number; remembers: number | null; in_character: number; note: string }
type Scores = Record<string, { turns: JudgeTurn[] }>;

interface RunRecord {
  label: string;
  target: string;
  local: boolean;
  liveModel: boolean;
  version: { version?: string; prompt_version?: string } | null;
  startedAt: string;
  scenarios: ScenarioRecord[];
  judge: string;
}

// ── SSE talk ─────────────────────────────────────────────────────────────────

function inferStop(error: TurnRecord["error"], fallback: boolean, salvaged: boolean): string {
  if (salvaged) return "max_tokens (salvaged)";
  if (!error) return fallback ? "fallback" : "end_turn";
  switch (error.code) {
    case "max_tokens": return "max_tokens";
    case "refusal": return "refusal";
    case "timeout": return "none (timeout)";
    case "invalid_output": return "end_turn (invalid twice)";
    case "unavailable": return "none (no model)";
    default: return `none (${error.code})`;
  }
}

type TalkResult = Omit<TurnRecord, "step" | "conversation" | "player" | "inputKind" | "leak"> & { conversationId?: string };

async function talk(base: string, worldId: string, token: string, body: unknown): Promise<TalkResult> {
  const started = performance.now();
  const res = await fetch(`${base}/v1/worlds/${worldId}/talk`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, accept: "text/event-stream" },
    body: JSON.stringify(body),
  });
  const empty = { totalMs: Math.round(performance.now() - started), firstVisibleMs: null, thinking: false, error: null, fallback: true,
    salvaged: false, stop: `http ${res.status}`, lines: [], choices: [], wrapUp: false, regardDelta: null };
  if (!res.ok || !res.body) return { http: res.status, ...empty, error: { code: `http_${res.status}`, message: (await res.text()).slice(0, 200) } };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstVisible: number | null = null;
  let thinking = false;
  let error: TurnRecord["error"] = null;
  let turn: Record<string, unknown> | null = null;
  const handle = (block: string) => {
    const event = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    if (!event || !data) return;
    const value = JSON.parse(data) as Record<string, unknown>;
    if (event === "line_delta" && firstVisible === null) firstVisible = performance.now();
    else if (event === "thinking") thinking = true;
    else if (event === "error") error = { code: String(value.code), message: String(value.message) };
    else if (event === "turn") turn = value;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) { handle(buffer.slice(0, cut)); buffer = buffer.slice(cut + 2); }
  }
  if (buffer.trim()) handle(buffer);
  const totalMs = Math.round(performance.now() - started);
  const firstVisibleMs = firstVisible === null ? null : Math.round((firstVisible as number) - started);
  const t = turn as Record<string, unknown> | null;
  if (!t) return { http: res.status, ...empty, totalMs, firstVisibleMs, thinking, error: error ?? { code: "no_turn", message: "stream ended without a turn" } };
  const fallback = t.fallback === true;
  const salvaged = t.salvaged === true;
  const regard = t.regard as { delta?: number } | null | undefined;
  return {
    http: res.status, totalMs, firstVisibleMs, thinking, error, fallback, salvaged, stop: inferStop(error, fallback, salvaged),
    lines: (t.lines as { text: string }[]).map((l) => l.text),
    choices: t.choices as TurnRecord["choices"],
    wrapUp: t.wrap_up === true,
    regardDelta: typeof regard?.delta === "number" ? regard.delta : null,
    ...(typeof t.conversation_id === "string" ? { conversationId: t.conversation_id } : {}),
  };
}

// ── The target: staging, or an in-process server ────────────────────────────

interface Target {
  base: string;
  inviteCode: string;
  liveModel: boolean;
  /** --local: requests the server made since the last call. */
  takeRequests?: () => { max_tokens: number; messages: { role: string; content: unknown }[] }[];
  close: () => Promise<void>;
}

function inviteCode(): string {
  if (process.env.MONDE_INVITE_CODE) return process.env.MONDE_INVITE_CODE;
  const file = args.get("invite-file") ?? join(homedir(), ".config/monde/staging_invite_codes.txt");
  const code = readFileSync(file, "utf8").split(/\s+/).find(Boolean);
  if (!code) throw new Error(`no invite code in ${file}`);
  return code;
}

async function anthropicClient(): Promise<import("@anthropic-ai/sdk").default | null> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  try {
    const client = new Anthropic({ maxRetries: 1 });
    // The SDK resolves an API key, an auth token or a profile; without any it throws on construction or first use.
    if (!client.apiKey && !client.authToken) return null;
    return client;
  } catch {
    return null;
  }
}

async function localTarget(): Promise<Target> {
  const { buildApp } = await import("../server/src/app.js");
  const { parseConfig } = await import("../server/src/config.js");
  const { createTestDatabase } = await import("../server/src/db/testDatabase.js");
  const { AnthropicMindClient, DisabledMindClient } = await import("../server/src/mind/mindClient.js");
  type Params = import("@anthropic-ai/sdk").default.MessageCreateParamsNonStreaming;
  const sdk = await anthropicClient();
  const inner = sdk ? new AnthropicMindClient(sdk) : new DisabledMindClient();
  const requests: Params[] = [];
  const mind = {
    enabled: inner.enabled,
    streamMessage: (params: Params, options: Parameters<typeof inner.streamMessage>[1]) => { requests.push(structuredClone(params)); return inner.streamMessage(params, options); },
    createMessage: (params: Params, options?: { signal?: AbortSignal }) => inner.createMessage(params, options),
  };
  const database = await createTestDatabase();
  const app = buildApp(parseConfig({ LOG_LEVEL: "silent" }), database.db, { mind });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  return {
    base: address, inviteCode: "local-eval", liveModel: !!sdk,
    takeRequests: () => requests.splice(0) as never,
    close: async () => { await app.close(); await database.client.close(); },
  };
}

const DIRECTIVE = /respond to (?:this|what they said) first/i;

function promptOf(requests: ReturnType<NonNullable<Target["takeRequests"]>>): TurnRecord["prompt"] {
  const first = requests[0];
  if (!first) return null;
  const last = first.messages.at(-1)!;
  const text = typeof last.content === "string" ? last.content
    : (last.content as { type: string; text?: string }[]).map((b) => (b.type === "text" ? b.text ?? "" : "")).join("\n");
  return { calls: requests.length, maxTokens: first.max_tokens, userChars: text.length, directive: DIRECTIVE.test(text), topics: text.includes("<topics_to_choose_from>"), finalUser: text };
}

// ── Running a scenario ──────────────────────────────────────────────────────

async function json(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { raw: text.slice(0, 200) }; }
}

async function runScenario(target: Target, scenario: Scenario): Promise<ScenarioRecord> {
  const record: ScenarioRecord = { id: scenario.id, resident: scenario.resident, place: scenario.place, tests: scenario.tests, turns: [] };
  const created = await json(await fetch(`${target.base}/v1/worlds`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_id: `eval-dialogue-${label}-${scenario.id}-${Date.now()}`, invite_code: target.inviteCode }),
  }));
  if (typeof created.world_id !== "string" || typeof created.token !== "string") return { ...record, error: `world not created: ${JSON.stringify(created).slice(0, 120)}` };
  const worldId = created.world_id, token = created.token;
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  await fetch(`${target.base}/v1/worlds/${worldId}/player`, {
    method: "PATCH", headers, body: JSON.stringify({ name: "Wren", pronouns: "she/her", background: "tinkerer", why: "to_help", loves: "old clocks" }),
  });
  const day = 2;
  let minute = 9 * 60 + 30;
  let conversation = 0;
  let conversationId = randomUUID();
  let last: TurnRecord | null = null;
  const leakAnswers = (scenario.noLeak ?? []).flatMap((id) => SPRING_RIDDLES.find((r) => r.id === id)?.accepted ?? []);
  for (const [index, step] of scenario.steps.entries()) {
    if ("leave" in step) {
      await fetch(`${target.base}/v1/worlds/${worldId}/talk/close`, { method: "POST", headers, body: JSON.stringify({ resident_id: scenario.resident, conversation_id: conversationId, day, minute }) });
      minute += step.leave;
      conversation += 1;
      conversationId = randomUUID();
      continue;
    }
    let input: Record<string, unknown>;
    let player: string;
    let riddle: { id: string; hints_allowed: number } | undefined;
    if ("open" in step) {
      if (prewarm) {
        await fetch(`${target.base}/v1/worlds/${worldId}/prewarm`, { method: "POST", headers, body: JSON.stringify({ resident_id: scenario.resident, day }) }).then((r) => r.text()).catch(() => "");
      }
      input = { kind: "open" };
      player = "(walks up)";
    } else if ("say" in step) {
      if (step.say.length > 140) throw new Error(`${scenario.id}: "${step.say}" is over 140 characters`);
      input = { kind: "say", text: step.say };
      player = step.say;
      riddle = step.riddle;
    } else if ("choose" in step) {
      const offered = (last?.choices ?? []).filter((c) => c.intent !== "leave");
      const pick = offered[Math.min(step.choose, offered.length - 1)];
      if (!pick) { record.error = `step ${index}: nothing to choose`; break; }
      input = { kind: "choice", choice_id: pick.id, text: pick.text, intent: pick.intent };
      player = pick.text;
    } else {
      input = { kind: "choice", choice_id: step.choice.id, text: step.choice.text, intent: step.choice.intent };
      player = step.choice.text;
      riddle = step.riddle;
    }
    minute += 1;
    target.takeRequests?.();
    const body = {
      resident_id: scenario.resident, conversation_id: conversationId, input,
      context: { day, minute, place: scenario.place, weather: "clear", current_activity: `work at ${scenario.place}`, ...(riddle ? { riddle } : {}) },
    };
    let turn: TalkResult;
    try { turn = await talk(target.base, worldId, token, body); }
    catch (error) { record.error = `step ${index}: ${String(error)}`; break; }
    const shown = [...turn.lines, ...turn.choices.map((c) => c.text)];
    const leak = leakAnswers.length && shown.some((text) => containsAnswer(text, leakAnswers)) ? "LEAK" : null;
    const { conversationId: _id, ...result } = turn;
    last = { step: index, conversation, player, inputKind: String(input.kind), leak, ...result,
      ...(target.takeRequests ? { prompt: promptOf(target.takeRequests()) } : {}) };
    record.turns.push(last);
    const flags = [last.fallback ? `fallback(${last.error?.code ?? "?"})` : "live", last.salvaged ? "salvaged" : "", last.leak ?? ""].filter(Boolean).join(" ");
    console.log(`  ${scenario.id}#${index} ${flags} first=${last.firstVisibleMs ?? "-"}ms total=${last.totalMs}ms`);
    // The turn event carries the authoritative conversation id (the server picks it on open).
    if (turn.conversationId) conversationId = turn.conversationId;
  }
  return record;
}

// ── Judge ────────────────────────────────────────────────────────────────────

interface Persona { name: string; age: number; occupation: string; register: string; tics: string[]; samples: string[] }

function persona(id: string): Persona {
  const card = parseYaml(readFileSync(resolve("content/residents", `${id}.yaml`), "utf8")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const voice = card.voice ?? {};
  return {
    name: String(card.name), age: Number(card.age), occupation: String(card.occupation).trim(),
    register: String(voice.register ?? "").replace(/\s+/g, " ").trim(), tics: voice.tics ?? [],
    samples: (voice.samples ?? []).slice(0, 2).map((s: string) => s.replace(/\s+/g, " ").trim()),
  };
}

export const JUDGE_RUBRIC = `You are grading NPC dialogue in Monde, a cozy seaside life-sim. Each resident is played by a language model. The player character, "the Fellow" (named Wren here, she/her, a tinkerer new in town), talks to them. You see the resident's persona, the conversation so far, and for each graded turn the Fellow's line and the resident's reply (1-3 short lines) plus the reply options offered to the Fellow next.

Score every graded turn:
- responds (1-5): does the reply respond directly to what the Fellow just said? 5: answers the question asked, or reacts to the news, feeling, joke or insult, or follows on from the reply the Fellow picked, before adding anything of its own. 4: responds, but thinly or only after a detour. 3: partly or only implicitly. 2: mostly about something else. 1: ignores the line (a greeting mid-conversation, an unrelated remark, a non-sequitur). A deliberate in-character refusal (keeping a secret, not giving a riddle answer) counts as responding when it clearly addresses the question.
- remembers (1-5 or null): only when the Fellow's line refers back to something said earlier (in this conversation or an earlier one shown to you), or earlier context plainly matters to the answer. 5: uses it correctly. 3: vague. 1: ignores it, forgets it or gets it wrong. null when nothing earlier is relevant to this turn.
- in_character (1-5): sounds like this resident and fits the world: in-world (no modern technology, no talk of AI, games or assistants), cozy, E10+, short spoken lines, never a customer-service voice. 1: breaks the world or reads like a generic assistant.
- note: one short sentence giving the main reason for the lowest score.

Some replies are authored fallback lines the game shows when the model fails; the player can't tell, so grade them exactly the same way.`;

function transcriptFor(record: ScenarioRecord): { text: string; graded: number[] } {
  const p = persona(record.resident);
  const out: string[] = [
    `Resident: ${p.name}, ${p.age}, ${p.occupation}. Voice: ${p.register} Tics: ${p.tics.join("; ")}. Samples: ${p.samples.map((s) => `"${s}"`).join(" ")}`,
    `Scene: ${record.place}, a clear morning, Day 2 of spring. Test: ${record.tests}.`,
    "",
  ];
  const graded: number[] = [];
  let conversation = -1;
  for (const turn of record.turns) {
    if (turn.conversation !== conversation) {
      conversation = turn.conversation;
      out.push(conversation === 0 ? "## Conversation" : "## A later conversation (the Fellow left and came back 40 minutes later)");
    }
    const grade = turn.inputKind !== "open";
    if (grade) graded.push(turn.step);
    out.push(`[step ${turn.step}${grade ? ", GRADE THIS TURN" : ""}]`);
    out.push(`Fellow: ${turn.player}${turn.inputKind === "choice" ? " (picked from the offered replies)" : ""}`);
    for (const line of turn.lines) out.push(`${p.name.split(" ")[0]}: ${line}`);
    out.push(`(offered replies: ${turn.choices.map((c) => `"${c.text}"`).join(" | ")}${turn.wrapUp ? "; the resident wrapped up" : ""})`);
    out.push("");
  }
  return { text: out.join("\n"), graded };
}

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["turns"],
  properties: {
    turns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["step", "responds", "remembers", "in_character", "note"],
        properties: {
          step: { type: "integer" },
          responds: { type: "integer" },
          remembers: { type: ["integer", "null"] },
          in_character: { type: "integer" },
          note: { type: "string" },
        },
      },
    },
  },
} as const;

async function judgeWithSonnet(run: RunRecord): Promise<Scores | null> {
  const client = judgeMode === "none" ? null : await anthropicClient();
  if (!client) {
    if (judgeMode === "sonnet") throw new Error("--judge=sonnet but no Anthropic credentials resolve");
    return null;
  }
  const scores: Scores = {};
  for (const record of run.scenarios) {
    const { text, graded } = transcriptFor(record);
    if (!graded.length) continue;
    // Server-side refusal fallback (the "default" routing) is on by default for Sonnet 5.5 code.
    const message = await client.beta.messages.create({
      model: JUDGE_MODEL, max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
      system: JUDGE_RUBRIC,
      messages: [{ role: "user", content: `${text}\nGrade steps ${graded.join(", ")}. Reply with JSON only.` }],
    } as never) as unknown as { stop_reason: string; content: { type: string; text?: string }[] };
    if (message.stop_reason !== "end_turn") { console.warn(`  judge ${record.id}: stop_reason ${message.stop_reason}`); continue; }
    const body = message.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    try { scores[record.id] = JSON.parse(body) as Scores[string]; } catch { console.warn(`  judge ${record.id}: unparseable`); }
  }
  return scores;
}

function judgeBundle(run: RunRecord): string {
  const parts = [`# Judge bundle: ${run.label}`, "", JUDGE_RUBRIC, "",
    'Answer with one JSON object: { "<scenario id>": { "turns": [ { "step": n, "responds": 1-5, "remembers": 1-5 or null, "in_character": 1-5, "note": "..." } ] } }, one entry per GRADE THIS TURN step.', ""];
  for (const record of run.scenarios) {
    parts.push(`# Scenario ${record.id}`, "", transcriptFor(record).text, "");
  }
  return parts.join("\n");
}

// ── Report ───────────────────────────────────────────────────────────────────

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const fmt = (n: number | null, digits = 2) => (n === null ? "-" : n.toFixed(digits));
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

function render(run: RunRecord, scores: Scores | null): string {
  const turns = run.scenarios.flatMap((s) => s.turns.map((t) => ({ s, t })));
  const answers = turns.filter(({ t }) => t.inputKind !== "open");
  const score = (s: ScenarioRecord, step: number) => scores?.[s.id]?.turns.find((x) => x.step === step) ?? null;
  const graded = answers.map(({ s, t }) => score(s, t.step)).filter((x): x is JudgeTurn => !!x);
  const codes = new Map<string, number>();
  for (const { t } of turns) if (t.fallback) codes.set(t.error?.code ?? "?", (codes.get(t.error?.code ?? "?") ?? 0) + 1);
  const stops = new Map<string, number>();
  for (const { t } of turns) stops.set(t.stop, (stops.get(t.stop) ?? 0) + 1);
  const first = turns.map(({ t }) => t.firstVisibleMs).filter((x): x is number => x !== null);
  const total = turns.map(({ t }) => t.totalMs);
  const leaks = turns.filter(({ t }) => t.leak).length;

  const out: string[] = [];
  out.push(`# Dialogue eval: ${run.label}`, "");
  out.push(`- Target: ${run.target}${run.local ? " (in-process server, PGlite)" : ""}; server ${run.version?.version ?? "?"}, prompt ${run.version?.prompt_version ?? "?"}`);
  out.push(`- Model: ${run.liveModel ? "live (claude-haiku-5-5)" : "**none**: no Anthropic credentials, so every turn is the authored fallback (this run measures the fallback path and the prompt layout only)"}`);
  out.push(`- Judge: ${run.judge}`);
  out.push(`- Run: ${run.startedAt}; ${run.scenarios.length} scenarios, ${turns.length} turns (${answers.length} answer a player line)`, "");

  out.push("## Summary", "", "| Metric | Value |", "|---|---|");
  out.push(`| Fallback turns | ${turns.filter(({ t }) => t.fallback).length}/${turns.length} (${pct(turns.filter(({ t }) => t.fallback).length, turns.length)}) |`);
  out.push(`| Fallbacks on turns answering the player | ${answers.filter(({ t }) => t.fallback).length}/${answers.length} (${pct(answers.filter(({ t }) => t.fallback).length, answers.length)}) |`);
  out.push(`| Fallback causes | ${[...codes].map(([k, v]) => `${k} ×${v}`).join(", ") || "none"} |`);
  out.push(`| Salvaged (max_tokens, lines kept) | ${turns.filter(({ t }) => t.salvaged).length} |`);
  out.push(`| stop_reason (inferred) | ${[...stops].map(([k, v]) => `${k} ×${v}`).join(", ")} |`);
  out.push(`| First visible line p50 / p95 | ${quantile(first, 0.5) ?? "-"} / ${quantile(first, 0.95) ?? "-"} ms (${first.length} turns streamed) |`);
  out.push(`| Whole turn p50 / p95 | ${quantile(total, 0.5)} / ${quantile(total, 0.95)} ms |`);
  out.push(`| Thinking beat shown | ${turns.filter(({ t }) => t.thinking).length}/${turns.length} |`);
  out.push(`| Riddle answer leaks | ${leaks} |`);
  if (graded.length) {
    out.push(`| Judge: responds directly (1-5) | ${fmt(mean(graded.map((g) => g.responds)))} (n=${graded.length}; ≤2 on ${graded.filter((g) => g.responds <= 2).length}) |`);
    const rem = graded.filter((g) => g.remembers !== null).map((g) => g.remembers!);
    out.push(`| Judge: remembers when relevant (1-5) | ${fmt(mean(rem))} (n=${rem.length}) |`);
    out.push(`| Judge: in character (1-5) | ${fmt(mean(graded.map((g) => g.in_character)))} |`);
    const live = answers.filter(({ t }) => !t.fallback).map(({ s, t }) => score(s, t.step)).filter((x): x is JudgeTurn => !!x);
    const fell = answers.filter(({ t }) => t.fallback).map(({ s, t }) => score(s, t.step)).filter((x): x is JudgeTurn => !!x);
    out.push(`| Judge: responds, live turns / fallback turns | ${fmt(mean(live.map((g) => g.responds)))} (n=${live.length}) / ${fmt(mean(fell.map((g) => g.responds)))} (n=${fell.length}) |`);
  }
  if (run.local) {
    const prompts = answers.map(({ t }) => t.prompt).filter((p): p is NonNullable<TurnRecord["prompt"]> => !!p);
    out.push(`| Prompt: max_tokens | ${[...new Set(prompts.map((p) => p.maxTokens))].join(", ") || "-"} |`);
    out.push(`| Prompt: "respond first" directive on answer turns | ${prompts.filter((p) => p.directive).length}/${prompts.length} |`);
    out.push(`| Prompt: topic cards on answer turns | ${prompts.filter((p) => p.topics).length}/${prompts.length} |`);
    out.push(`| Prompt: final user message, mean chars | ${fmt(mean(prompts.map((p) => p.userChars)), 0)} |`);
  }
  out.push("");

  out.push("## Per scenario", "", "| Scenario | Resident | Tests | Turns | Fallbacks | stop_reason | First visible (median) | Turn (median) | Responds | Remembers | In character |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of run.scenarios) {
    const sc = s.turns.filter((t) => t.inputKind !== "open").map((t) => score(s, t.step)).filter((x): x is JudgeTurn => !!x);
    const rem = sc.filter((g) => g.remembers !== null).map((g) => g.remembers!);
    const fb = s.turns.filter((t) => t.fallback);
    out.push(`| ${s.id} | ${s.resident} | ${s.tests} | ${s.turns.length} | ${fb.length ? `${fb.length} (${fb.map((t) => `#${t.step} ${t.error?.code ?? "?"}`).join(", ")})` : "0"} | ${[...new Set(s.turns.map((t) => t.stop))].join(", ")} | ${quantile(s.turns.map((t) => t.firstVisibleMs).filter((x): x is number => x !== null), 0.5) ?? "-"} ms | ${quantile(s.turns.map((t) => t.totalMs), 0.5)} ms | ${fmt(mean(sc.map((g) => g.responds)), 1)} | ${rem.length ? fmt(mean(rem), 1) : "n/a"} | ${fmt(mean(sc.map((g) => g.in_character)), 1)} |${s.error ? ` error: ${cell(s.error)}` : ""}`);
  }
  out.push("");

  out.push("## Transcripts", "");
  for (const s of run.scenarios) {
    out.push(`### ${s.id} (${s.resident} @ ${s.place}: ${s.tests})`, "");
    for (const t of s.turns) {
      const g = score(s, t.step);
      const meta = [t.fallback ? `**fallback: ${t.error?.code ?? "?"}**` : "live", t.salvaged ? "salvaged" : "", `stop ${t.stop}`, `first ${t.firstVisibleMs ?? "-"} ms`, `turn ${t.totalMs} ms`, t.thinking ? "thinking beat" : "", t.leak ? "**LEAK**" : "",
        g ? `judge ${g.responds}/${g.remembers ?? "-"}/${g.in_character}` : ""].filter(Boolean).join(" · ");
      out.push(`- **Fellow:** ${t.player}${t.inputKind === "choice" ? " _(picked)_" : ""}  `);
      for (const line of t.lines) out.push(`  **${s.resident}:** ${line}  `);
      out.push(`  _replies:_ ${t.choices.map((c) => c.text).join(" · ")}${t.wrapUp ? " _(wrap-up)_" : ""}  `);
      out.push(`  <sub>${meta}${g?.note ? ` · ${g.note}` : ""}</sub>`);
    }
    out.push("");
  }
  if (run.local) {
    const example = run.scenarios.flatMap((s) => s.turns.filter((t) => t.prompt && t.step >= 2 && t.inputKind !== "open").map((t) => ({ s, t })))[0];
    if (example?.t.prompt) out.push(`## Example final user message (${example.s.id}, step ${example.t.step})`, "", "```", example.t.prompt.finalUser, "```", "");
  }
  return out.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const stem = join(outDir, `dialogue_eval_${label}`);
  if (args.has("render")) {
    const run = JSON.parse(readFileSync(resolve(args.get("render")!), "utf8")) as RunRecord;
    const scores = args.has("scores") ? JSON.parse(readFileSync(resolve(args.get("scores")!), "utf8")) as Scores : null;
    if (scores) run.judge = args.get("judge-label") ?? `external (${args.get("scores")})`;
    const target = join(outDir, `dialogue_eval_${run.label}.md`);
    writeFileSync(target, render(run, scores));
    if (!scores) writeFileSync(join(outDir, `dialogue_eval_${run.label}.judge.md`), judgeBundle(run));
    console.log(`wrote ${target}`);
    return;
  }
  const local = args.get("local") === "true";
  const target: Target = local ? await localTarget()
    : { base: (args.get("base") ?? STAGING).replace(/\/+$/, ""), inviteCode: inviteCode(), liveModel: true, close: async () => undefined };
  const version = await fetch(`${target.base}/v1/version`).then((r) => r.json() as Promise<RunRecord["version"]>).catch(() => null);
  const run: RunRecord = { label, target: local ? "local" : target.base, local, liveModel: target.liveModel, version, startedAt: new Date().toISOString(), scenarios: [], judge: "not run" };
  try {
    for (const scenario of SCENARIOS) {
      if (only && !only.includes(scenario.id)) continue;
      console.log(scenario.id);
      try { run.scenarios.push(await runScenario(target, scenario)); }
      catch (error) { run.scenarios.push({ id: scenario.id, resident: scenario.resident, place: scenario.place, tests: scenario.tests, turns: [], error: String(error) }); }
    }
  } finally {
    await target.close();
  }
  writeFileSync(`${stem}.json`, JSON.stringify(run, null, 2));
  const scores = await judgeWithSonnet(run);
  if (scores) {
    run.judge = `${JUDGE_MODEL} (SDK)`;
    writeFileSync(`${stem}.scores.json`, JSON.stringify(scores, null, 2));
  } else {
    writeFileSync(`${stem}.judge.md`, judgeBundle(run));
    console.log(`no judge credentials: wrote ${stem}.judge.md for an external judge (then --render=${stem}.json --scores=<file>)`);
  }
  writeFileSync(`${stem}.json`, JSON.stringify(run, null, 2));
  writeFileSync(`${stem}.md`, render(run, scores));
  console.log(`wrote ${stem}.md`);
}

await main();
