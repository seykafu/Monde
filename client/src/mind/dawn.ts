// The night and the dawn package (GDD §9.7 step 3, §9.8, §19.4; MVP M-07 and G-13 client). Pure: the network, the
// clock and the waiting are injected, so the polling runs under vitest with fakes.
//
// At dawn on Day N+1 the client POSTs the night of Day N (the day's town events it has, and the town's facts), then
// GETs the dawn package for N+1. The server answers the night within 4 s and keeps working in the background; while
// the package says `complete: false` the client asks again every second, for a few seconds in all, then takes what it
// has: the model plans that are in replace the routine templates, everyone else keeps their template (§9.8 lag
// tolerance). Without a server (Quiet Mode, no world, a network failure) nothing changes: templates, and the ties the
// client last knew.
import {
  DawnFavorData, DawnLetterData, DawnPlanData, PlanOutput, TieData, TieMilestoneData, TownEvent, type SaveGame
} from '@monde/shared';

/** POST /v1/worlds/:w/night (server/src/mind/night.ts NightBody). */
export interface NightRequest {
  day: number;
  events?: TownEvent[];
  town?: { pillars?: { prosperity: number; safety: number; spirit: number; charm: number }; census?: number; weather_tomorrow?: string };
}

/** GET /v1/worlds/:w/dawn/:day, as the client keeps it (server/src/mind/dawn.ts). */
export interface DawnPackage {
  day: number;
  weekday: string;
  plans: DawnPlanData[];
  letters: DawnLetterData[];
  favors: DawnFavorData[];
  ties: { pairs: TieData[]; milestones: TieMilestoneData[] };
  /** Residents the night is still working on. */
  pending: number;
  /** Every night job has finished (its plans are final). */
  complete: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Each well-formed item of a list (one bad letter doesn't lose the rest). */
const each = <T>(v: unknown, schema: { safeParse(x: unknown): { success: true; data: T } | { success: false } }): T[] =>
  Array.isArray(v) ? v.flatMap(x => { const r = schema.safeParse(x); return r.success ? [r.data] : []; }) : [];

/** A dawn package off the wire, or null if it isn't one. Malformed items are dropped, not fatal. */
export function parseDawnPackage(v: unknown): DawnPackage | null {
  if (!isObject(v) || typeof v.day !== 'number' || !Number.isInteger(v.day) || v.day < 1 || !Array.isArray(v.plans)) return null;
  const ties = isObject(v.ties) ? v.ties : {};
  return {
    day: v.day, weekday: typeof v.weekday === 'string' ? v.weekday : '',
    plans: each(v.plans, DawnPlanData), letters: each(v.letters, DawnLetterData), favors: each(v.favors, DawnFavorData),
    ties: { pairs: each(ties.pairs, TieData), milestones: each(ties.milestones, TieMilestoneData) },
    pending: typeof v.pending === 'number' && v.pending > 0 ? v.pending : 0,
    // A package that doesn't say is taken as final.
    complete: v.complete !== false
  };
}

/** The model plans in a package that pass the plan schema, by resident (templates are the client's own already). */
export function modelPlans(plans: readonly DawnPlanData[]): Record<string, PlanOutput> {
  const out: Record<string, PlanOutput> = {};
  for (const p of plans) {
    if (p.source !== 'model') continue;
    const parsed = PlanOutput.safeParse(p.plan);
    if (parsed.success && parsed.data.blocks.length > 0) out[p.resident_id] = parsed.data;
  }
  return out;
}

// ── Syncing ─────────────────────────────────────────────────────────────────

/**
 * GDD-GAP: §9.8 caps the night transition at 4 s (the server's answer) but not the client's wait for background
 * work. The client asks again every second and gives up 6 s after the dawn began, taking the plans that are in.
 */
export const DAWN_SYNC = { pollMs: 1000, budgetMs: 6000 } as const;

export interface DawnSyncDeps {
  /** The night's HTTP status (409: already passed, which is fine), or null when the server can't be reached. */
  postNight(body: NightRequest): Promise<number | null>;
  /** The dawn package, or null when the server can't be reached or answered with something else. */
  getDawn(day: number): Promise<DawnPackage | null>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export type DawnSyncResult =
  | { status: 'complete' | 'partial'; pkg: DawnPackage; polls: number }
  | { status: 'offline'; pkg: null; polls: number; reason: string };

/**
 * Run one dawn: post the night (unless `night` is null: resuming a day whose night already ran), then read the
 * package for `day` until it's complete or the budget runs out.
 */
export async function syncDawn(deps: DawnSyncDeps, day: number, night: NightRequest | null, rules: { pollMs: number; budgetMs: number } = DAWN_SYNC): Promise<DawnSyncResult> {
  const started = deps.now();
  if (night) {
    const status = await deps.postNight(night);
    if (status === null) return { status: 'offline', pkg: null, polls: 0, reason: 'night unreachable' };
  }
  let polls = 0;
  let last: DawnPackage | null = null;
  for (;;) {
    const pkg = await deps.getDawn(day);
    polls++;
    if (!pkg) return last ? { status: 'partial', pkg: last, polls } : { status: 'offline', pkg: null, polls, reason: 'dawn unreachable' };
    last = pkg;
    if (pkg.complete) return { status: 'complete', pkg, polls };
    if (deps.now() - started + rules.pollMs > rules.budgetMs) return { status: 'partial', pkg, polls };
    await deps.sleep(rules.pollMs);
  }
}

// ── The night's body ────────────────────────────────────────────────────────

/**
 * The client's town events for `day` as the night takes them (TownEvent, §9.12). GDD-GAP: the client doesn't log
 * town events yet (§9.12's events come with M-06); what it has is the save's `offline_events` (§9.14), which nothing
 * writes so far. Each becomes an event with its `data.where`, `data.summary` and `data.importance` when they're there.
 */
export function nightEvents(offline: SaveGame['offline_events'], day: number): TownEvent[] {
  const out: TownEvent[] = [];
  offline.forEach((e, i) => {
    if (e.day !== day) return;
    const d = e.data;
    const importance = typeof d.importance === 'number' ? d.importance : 3;
    const parsed = TownEvent.safeParse({
      id: `client-${day}-${i}`, day, minute: Math.max(0, Math.min(1560, Math.round(e.minute))), type: e.type,
      where: typeof d.where === 'string' ? d.where : 'town', who: e.resident_id ? [e.resident_id] : [],
      importance: Math.max(1, Math.min(10, Math.round(importance))), tags: typeof d.tag === 'string' ? [d.tag] : [],
      summary: (typeof d.summary === 'string' ? d.summary : e.type).slice(0, 240)
    });
    if (parsed.success) out.push(parsed.data);
  });
  return out.slice(-500);
}
