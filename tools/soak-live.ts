/**
 * Live cost soak (MVP Q-02/Q-03, GDD §9.15). A dev tool: never run in CI; it spends real tokens on the target server.
 *
 *   npx tsx tools/soak-live.ts --days=5 --turns=60 --out-dir=<dir>          staging (the default target)
 *   npx tsx tools/soak-live.ts --days=3 --url=http://localhost:8080 ...     a local server
 *
 * Plays a fresh world the way the client does, one in-game day at a time: about `turns` dialogue turns a day (the
 * §9.15 mid-game volume is 60) as three-turn conversations with a mix of the hand-written cast and the Day-1 census,
 * each preceded by the proximity prewarm, the second reply a free-text line (so the safety pre-check runs) and the
 * rest picked from the resident's own replies. Then the night (POST /night) and the dawn (polled until the night's
 * background work is complete). At the end it reads /admin/costs.json for its world and reports the spend per in-game
 * day by call kind against the §9.15 targets ($0.06 standard, $0.089 estimate) and the world's budget cap.
 *
 * Secrets: the invite code comes from MONDE_INVITE_CODE or ~/.config/monde/staging_invite_codes.txt, the admin token
 * from ADMIN_TOKEN or ~/.config/monde/admin_token.txt; neither is printed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import YAML from "yaml";

const args = new Map(process.argv.slice(2).map((arg) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
  return m ? [m[1]!, m[2] ?? "true"] as const : [arg, "true"] as const;
}));
const BASE = (args.get("url") ?? "https://monde-mind-staging.fly.dev").replace(/\/$/, "");
const DAYS = Number(args.get("days") ?? 5);
const TURNS = Number(args.get("turns") ?? 60);
const OUT = args.get("out-dir") ?? ".";
const SEED = Number(args.get("seed") ?? 7);
const STANDARD_USD = 0.06, ESTIMATE_USD = 0.089;

const secret = (env: string, file: string): string => {
  if (process.env[env]) return process.env[env]!.trim();
  const p = path.join(os.homedir(), ".config/monde", file);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").split(/\s+/).find(Boolean) ?? "" : "";
};
const invite = secret("MONDE_INVITE_CODE", "staging_invite_codes.txt");
const admin = secret("ADMIN_TOKEN", "admin_token.txt");
if (!invite) { console.error("no invite code (MONDE_INVITE_CODE or ~/.config/monde/staging_invite_codes.txt)"); process.exit(2); }

// The roster, from content: hand-written residents (not the cat) and the census, with where to find them.
interface Who { id: string; core: boolean; place: string }
const cards = (dir: string, core: boolean): Who[] => fs.readdirSync(dir).filter((f) => f.endsWith(".yaml")).flatMap((f) => {
  const c = YAML.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { id: string; kind: string; workplace?: string; home?: string; age?: number };
  if (c.kind === "animal" || (c.age ?? 30) < 6) return [];
  const place = [c.workplace, c.home].find((p) => p && !p.startsWith("offmap")) ?? "old_quarter.fountain_square";
  return [{ id: c.id, core, place }];
});
const root = path.resolve(import.meta.dirname, "..");
const roster = [...cards(path.join(root, "content/residents"), true), ...cards(path.join(root, "content/residents/day1"), false)];
let seed = SEED;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

const SAYS = [
  "How's your day been?", "What's on your mind this morning?", "Anything I can help with?", "Have you heard the news from the Wharf?",
  "What do you make of the Fund?", "I keep getting lost in the Old Quarter.", "Do you know who fixes clocks around here?", "Busy today?",
];

let token = "";
const call = async (method: string, url: string, body?: unknown, auth = true): Promise<Response> => fetch(`${BASE}${url}`, {
  method, headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${token}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Turn { lines?: { text: string }[]; choices?: { id: string; text: string; intent: string }[]; fallback?: boolean; wrap_up?: boolean }
async function talk(worldId: string, who: Who, conv: string, day: number, minute: number, input: unknown): Promise<{ turn: Turn | null; status: number; ms: number }> {
  const t0 = Date.now();
  const res = await call("POST", `/v1/worlds/${worldId}/talk`, {
    resident_id: who.id, conversation_id: conv, input, context: { day, minute, place: who.place, weather: "bright spells" },
  });
  const text = await res.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => [m[1], JSON.parse(m[2]!)] as const);
  return { turn: (events.find((e) => e[0] === "turn")?.[1] as Turn | undefined) ?? null, status: res.status, ms: Date.now() - t0 };
}

const world = await (await call("POST", "/v1/worlds", { device_id: `soak-${Date.now()}`, invite_code: invite }, false)).json() as { world_id: string; token: string };
token = world.token;
const worldId = world.world_id;
await call("PATCH", `/v1/worlds/${worldId}/player`, { name: "Wren", pronouns: "she/her", background: "tinkerer", why: "to_help", loves: "bread" });
console.log(`world ${worldId.slice(0, 8)} on ${BASE}: ${DAYS} days × ~${TURNS} turns`);

const log: { day: number; turns: number; fallbacks: number; errors: number; p50: number; night: string }[] = [];
for (let day = 1; day <= DAYS; day++) {
  const times: number[] = [];
  let turns = 0, fallbacks = 0, errors = 0, minute = 8 * 60 + 30;
  while (turns < TURNS) {
    const who = rand() < 0.4 ? pick(roster.filter((r) => r.core)) : pick(roster.filter((r) => !r.core));
    const conv = randomUUID();
    await call("POST", `/v1/worlds/${worldId}/prewarm`, { resident_id: who.id }).catch(() => undefined);
    let input: unknown = { kind: "open" };
    for (let i = 0; i < 3 && turns < TURNS; i++) {
      const r = await talk(worldId, who, conv, day, minute, input).catch(() => ({ turn: null, status: 0, ms: 0 }));
      turns++; times.push(r.ms);
      if (r.status !== 200 || !r.turn) { errors++; break; }
      if (r.turn.fallback) fallbacks++;
      if (r.turn.wrap_up) break;
      const choice = r.turn.choices?.find((c) => c.intent !== "leave") ?? r.turn.choices?.[0];
      input = i === 0 ? { kind: "say", text: pick(SAYS) } : choice ? { kind: "choice", choice_id: choice.id, text: choice.text, intent: choice.intent } : { kind: "say", text: "Go on." };
    }
    minute = Math.min(minute + 14, 21 * 60);
  }
  const night = await call("POST", `/v1/worlds/${worldId}/night`, { day });
  let status = `night ${night.status}`;
  for (let i = 0; i < 90; i++) {
    const dawn = await call("GET", `/v1/worlds/${worldId}/dawn/${day + 1}`).then((r) => r.json() as Promise<{ complete?: boolean; pending?: number }>).catch(() => ({ complete: false, pending: -1 }));
    if (dawn.complete) { status += `, complete after ${i * 2}s`; break; }
    await sleep(2000);
    if (i === 89) status += `, still ${dawn.pending} pending after 180s`;
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)] ?? 0;
  log.push({ day, turns, fallbacks, errors, p50, night: status });
  console.log(`day ${day}: ${turns} turns, ${fallbacks} fallbacks, ${errors} errors, p50 ${p50} ms; ${status}`);
}

// The spend, from the server's own ledger.
let report = `# Live cost soak\n\n- Target: ${BASE}\n- World: ${worldId}\n- ${DAYS} in-game days, ~${TURNS} dialogue turns a day\n- Run: ${new Date().toISOString()}\n\n`;
report += `| Day | Turns | Fallbacks | Errors | Turn p50 | Night |\n|---|---|---|---|---|---|\n${log.map((l) => `| ${l.day} | ${l.turns} | ${l.fallbacks} | ${l.errors} | ${l.p50} ms | ${l.night} |`).join("\n")}\n\n`;
if (!admin) report += "No admin token: costs not read (ADMIN_TOKEN or ~/.config/monde/admin_token.txt).\n";
else {
  await sleep(5000);
  const costs = await (await fetch(`${BASE}/admin/costs.json`, { headers: { authorization: `Bearer ${admin}` } })).json() as {
    perWorldDay: { worldId: string; day: number; kind: string; costUsd: string }[]; worldTargetUsd: number; cappedWorlds: string[];
  };
  const mine = costs.perWorldDay.filter((r) => r.worldId === worldId);
  const kinds = [...new Set(mine.map((r) => r.kind))].sort();
  const byDay = new Map<number, Map<string, number>>();
  for (const r of mine) byDay.set(r.day, (byDay.get(r.day) ?? new Map()).set(r.kind, Number(r.costUsd)));
  const totals = [...byDay.entries()].sort(([a], [b]) => a - b).map(([day, m]) => [day, [...m.values()].reduce((n, v) => n + v, 0)] as const);
  report += `| Day | ${kinds.join(" | ")} | Total |\n|---|${kinds.map(() => "---|").join("")}---|\n`;
  for (const [day, total] of totals) report += `| ${day} | ${kinds.map((k) => `$${(byDay.get(day)!.get(k) ?? 0).toFixed(4)}`).join(" | ")} | **$${total.toFixed(4)}** |\n`;
  const played = totals.filter(([day]) => day <= DAYS);
  const mean = played.reduce((n, [, t]) => n + t, 0) / Math.max(1, played.length);
  report += `\nMean per in-game day: **$${mean.toFixed(4)}** (standard target $${STANDARD_USD}, §9.15 estimate $${ESTIMATE_USD}, this world's cap $${costs.worldTargetUsd} with the guard stepping in at 100/150/200%).`;
  report += costs.cappedWorlds.includes(worldId) ? " The world is at its cap now.\n" : "\n";
  console.log(`mean per in-game day: $${mean.toFixed(4)}`);
}
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `soak_${worldId.slice(0, 8)}.md`);
fs.writeFileSync(file, report);
console.log(`wrote ${file}`);
