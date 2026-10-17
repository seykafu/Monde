/**
 * Write the Day-1 residents' cards (MVP M-03 step 2; GDD Appendix A.1.5, A.3.6–A.3.8): one Haiku call per household of
 * content/census/day1.yaml with MODE: native, validated here with the shared validator (profile "native"), two retries
 * with the errors fed back, a second round of three with a new whim, then the template card. The engine is
 * shared/src/census/generate.ts; this is its files and its wire.
 *
 *   (npm run census:write -- <options> is the same.)
 *   npx tsx tools/gen-residents.ts --dry-run [--no-prompts]     prompts and a cost estimate; no calls, no writes
 *   npx tsx tools/gen-residents.ts [--target=staging]           through POST /admin/census/write on staging (default)
 *   npx tsx tools/gen-residents.ts --local                      in process, with ANTHROPIC_API_KEY (env or .env)
 *   npx tsx tools/gen-residents.ts --template-only [--out <dir>]   development: every household's template card, no call
 *   options: --limit N (a trial of N households) · --concurrency N (4) · --regen <household> · --url <server>
 *
 * Staging reads ADMIN_TOKEN from the environment or ~/.config/monde/admin_token.txt (never printed). --local is charged
 * against CENSUS_BUDGET_USD (default 3) counted here; staging's is the server's (and its global daily cap).
 *
 * Writes content/residents/day1/<id>.yaml, one card per resident, and records each household's status ("drafted"),
 * generation record and input hash in content/census/day1.yaml. Idempotent: households whose cards exist, or whose
 * status is past skeleton, are skipped; --regen <household> removes that household's cards and writes it again. The
 * game loads content/residents/day1/ when cards are there (M-03 step 3); npm run lint:content checks it.
 *
 * --template-only (M-03 step 3, development): A.3.8's template card for every household still to write, flagged
 * generated_by: template, with no model call and no token. --out <dir> writes the cards there instead; a folder other
 * than content/residents/day1 starts from the skeleton as seeded and leaves content/census/day1.yaml alone (the records
 * stay in memory), so it is always the whole town. Into content/residents/day1 it records the households in the
 * skeleton like any run (lint:content checks the two agree): remove the cards and `git checkout content/census/day1.yaml`
 * before the real census, or it skips them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { runCensus, stringifyGeneratedCard, stringifySkeleton, type CensusStore, type CensusWriter } from "@monde/shared";
import { lexicalHits } from "../server/src/mind/filters.ts";
import { HAIKU_55_PRICES_PER_MTOK } from "../server/src/mind/pricing.ts";
import { DAY1_CARDS_DIR, REPO_ROOT, SKELETON_FILE, loadCensusInput } from "./census-inputs.ts";

const root = REPO_ROOT;
const SKELETON = SKELETON_FILE;
const CARDS_DIR = DAY1_CARDS_DIR;
const STAGING = "https://monde-mind-staging.fly.dev";

// ── Arguments ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};
const dryRun = flag("dry-run");
const local = flag("local") || value("target") === "local";
const target = local ? "local" : value("target") ?? "staging";
if (target !== "staging" && target !== "local") { console.error(`unknown --target ${target}: staging or local`); process.exit(2); }
const limit = value("limit") !== undefined ? Number(value("limit")) : undefined;
const concurrency = value("concurrency") !== undefined ? Number(value("concurrency")) : undefined;
const regen = value("regen") ?? null;
const serverUrl = (value("url") ?? STAGING).replace(/\/+$/, "");
const templateOnly = flag("template-only");
const out = value("out");
if (flag("out") && !out) { console.error("--out needs a folder"); process.exit(2); }

// ── Inputs ──────────────────────────────────────────────────────────────────

const cardsDir = out ? path.resolve(out) : path.join(root, CARDS_DIR);
/** Writing anywhere but content/residents/day1 leaves the skeleton's records alone (and starts from it as seeded). */
const elsewhere = cardsDir !== path.join(root, CARDS_DIR);
const input = loadCensusInput({ root, cardsDir, resetProgress: elsewhere });
const written = input.written;

// ── Files ───────────────────────────────────────────────────────────────────

const store: CensusStore = {
  householdsWithCards: () => new Set([...written.values()].map(c => c.household).filter((h): h is string => !!h)),
  writeCards(_h, list) {
    fs.mkdirSync(cardsDir, { recursive: true });
    for (const c of list) fs.writeFileSync(path.join(cardsDir, `${c.id}.yaml`), stringifyGeneratedCard(c));
  },
  removeCards(household) {
    if (!fs.existsSync(cardsDir)) return;
    for (const f of fs.readdirSync(cardsDir).filter(x => x.endsWith(".yaml"))) {
      const c = YAML.parse(fs.readFileSync(path.join(cardsDir, f), "utf8")) as { household?: string };
      if (c.household === household) fs.rmSync(path.join(cardsDir, f));
    }
  },
  saveSkeleton: sk => { if (!elsewhere) fs.writeFileSync(path.join(root, SKELETON), stringifySkeleton(sk)); },
  log: line => console.log(line),
};

// ── The wire ────────────────────────────────────────────────────────────────

interface CensusReply { text?: string; stop_reason?: string; usage?: Record<string, number>; cost_usd?: number; error?: string; spent_usd?: number; cap_usd?: number }

function adminToken(): string | null {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN.trim();
  const file = path.join(os.homedir(), ".config/monde/admin_token.txt");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() || null : null;
}

const usageOf = (u: Record<string, number> | undefined) => ({
  input_tokens: u?.input_tokens ?? 0, output_tokens: u?.output_tokens ?? 0,
  cache_read_input_tokens: u?.cache_read_input_tokens ?? 0, cache_creation_input_tokens: u?.cache_creation_input_tokens ?? 0,
});
const answered = (stop: string) => stop === "end_turn" || stop === "stop_sequence";

function stagingWriter(token: string): CensusWriter {
  return async (draw, context) => {
    let res: Response;
    try {
      res = await fetch(`${serverUrl}/admin/census/write`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ draw, context }), signal: AbortSignal.timeout(180_000),
      });
    } catch (e) { return { kind: "error", message: `${serverUrl} unreachable: ${(e as Error).message}` }; }
    const body = (await res.json().catch(() => ({}))) as CensusReply;
    if (res.status === 429) return { kind: "budget", message: `the census has spent $${body.spent_usd?.toFixed(4) ?? "?"} of $${body.cap_usd ?? "?"} (or the global daily cap is reached)` };
    if (res.status === 404) return { kind: "error", fatal: true, message: "POST /admin/census/write is 404: ADMIN_TOKEN isn't set on the server, or the deploy predates the endpoint" };
    if (res.status === 401) return { kind: "error", fatal: true, message: "401: the ADMIN_TOKEN here doesn't match the server's" };
    if (!res.ok) return { kind: "error", fatal: res.status === 400 || res.status === 503, message: `${res.status} ${body.error ?? ""}`.trim() };
    const stop = body.stop_reason ?? "none";
    const usage = usageOf(body.usage);
    const cost = body.cost_usd ?? 0;
    return answered(stop) ? { kind: "text", text: body.text ?? "", stop_reason: stop, usage, cost_usd: cost } : { kind: "stop", stop_reason: stop, usage, cost_usd: cost };
  };
}

/** In process: the server's own request builder and call, with a key from the environment or the repo's .env. */
async function localWriter(): Promise<CensusWriter> {
  const envFile = path.join(root, ".env");
  if (!process.env.ANTHROPIC_API_KEY && fs.existsSync(envFile)) {
    const line = fs.readFileSync(envFile, "utf8").split("\n").find(l => l.startsWith("ANTHROPIC_API_KEY="));
    if (line) process.env.ANTHROPIC_API_KEY = line.slice("ANTHROPIC_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  }
  const { createMindClient } = await import("../server/src/mind/mindClient.ts");
  const { callModel } = await import("../server/src/mind/callModel.ts");
  const { censusRequest, CENSUS_CALL_TIMEOUT_MS } = await import("../server/src/mind/census.ts");
  const mind = createMindClient({ ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_WORKSPACE_ID: process.env.ANTHROPIC_WORKSPACE_ID });
  if (!mind.enabled) { console.error("--local needs ANTHROPIC_API_KEY (environment or .env)"); process.exit(2); }
  const cap = Number(process.env.CENSUS_BUDGET_USD ?? 3);
  let spent = 0;
  return async (draw, context) => {
    if (spent >= cap) return { kind: "budget", message: `spent $${spent.toFixed(4)} of CENSUS_BUDGET_USD $${cap}` };
    const call = await callModel(mind, censusRequest(draw, context), { timeoutMs: CENSUS_CALL_TIMEOUT_MS });
    const t = call.call?.tokens;
    const usage = { input_tokens: t?.input ?? 0, output_tokens: t?.output ?? 0, cache_read_input_tokens: t?.cacheRead ?? 0, cache_creation_input_tokens: t?.cacheWrite ?? 0 };
    spent += call.call?.costUsd ?? 0;
    if (call.ok) return { kind: "text", text: call.text, stop_reason: call.call.stopReason, usage, cost_usd: call.call.costUsd };
    if (call.call && (call.failure === "refusal" || call.failure === "max_tokens" || call.failure.startsWith("stop:"))) return { kind: "stop", stop_reason: call.call.stopReason, usage, cost_usd: call.call.costUsd };
    return { kind: "error", message: call.failure };
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────

let writer: CensusWriter | undefined;
if (!dryRun && !templateOnly) {
  if (target === "local") writer = await localWriter();
  else {
    const token = adminToken();
    if (!token) { console.error("no ADMIN_TOKEN: set it in the environment or ~/.config/monde/admin_token.txt"); process.exit(2); }
    writer = stagingWriter(token);
  }
}

const started = Date.now();
const result = await runCensus(
  { ...input, banned: text => lexicalHits(text).map(h => h.group) },
  // Template cards one household at a time: the same ids every run.
  { writer, store, dryRun, regen, limit, concurrency: templateOnly ? 1 : concurrency, templateOnly, prices: HAIKU_55_PRICES_PER_MTOK },
);

if (dryRun) {
  if (!flag("no-prompts")) for (const p of result.prompts) console.log(`\n════ ${p.id} ════\n${p.text}`);
  const e = result.estimate!;
  console.log(`\nDry run: ${e.households} households, ${e.members} residents to write (${result.skipped.length} already written).`);
  if (!e.households) process.exit(0);
  console.log(`Expected: ~${e.calls} calls (one each, plus ${Math.round((e.calls / Math.max(1, e.households) - 1) * 100)}% retries), ~${e.input_tokens.toLocaleString()} uncached input tokens, ~${e.cached_tokens.toLocaleString()} cached system tokens, ~${e.output_tokens.toLocaleString()} output tokens: about $${e.cost_usd.toFixed(2)}.`);
  console.log(`Ceiling (every household failing six times at max_tokens): $${e.worst_cost_usd.toFixed(2)}.`);
  process.exit(0);
}

if (templateOnly) {
  const n = result.written.length;
  console.log(`\n${n} households written as template cards (${[...written.values()].filter(c => c.generated_by === "template").length} cards) into ${path.relative(root, cardsDir) || cardsDir} in ${Date.now() - started} ms; ${result.skipped.length} skipped, ${result.failed.length} not written.`);
  if (!elsewhere && n) console.log(`content/census/day1.yaml records them: remove the cards and git checkout ${SKELETON} before the real census.`);
  for (const f of result.failed) console.log(`not written: ${f.id}: ${f.reason}`);
  process.exit(result.failed.length ? 1 : 0);
}

const models = result.written.filter(w => w.source === "model").length;
const templates = result.written.filter(w => w.source === "template").length;
console.log(`\n${result.written.length} households written (${models} by the model, ${templates} template cards), ${result.skipped.length} skipped, ${result.failed.length} not written.`);
console.log(`${result.calls} calls, ${result.usage.input_tokens.toLocaleString()} input + ${result.usage.cache_read_input_tokens.toLocaleString()} cached + ${result.usage.output_tokens.toLocaleString()} output tokens, $${result.cost_usd.toFixed(4)}.`);
if (result.stale.length) console.log(`Inputs changed since writing: ${result.stale.join(", ")}`);
for (const f of result.failed) console.log(`not written: ${f.id}: ${f.reason}`);
if (result.stopped) console.log(`Stopped: ${result.stopped}. Run again to continue; written households are skipped.`);
process.exit(result.failed.length || result.stopped ? 1 : 0);
