/**
 * What every night job (reflection, plan, encounter) gets from the night runner (night.ts): the world facts loaded
 * once per night, and the database, Mind client, concurrency gate and deadlines.
 */
import type { WorldDatabase } from "../worlds/createWorld.js";
import { aiLog } from "../db/schema.js";
import type { CallRecord } from "./dialogue.js";
import { aiLogRow } from "./effects.js";
import type { MindClient } from "./mindClient.js";
import type { FellowView } from "./naming.js";
import type { PlaceRegistry } from "./places.js";
import type { TownFacts } from "./promptBuilder.js";

/** Facts shared by every job of one night pass. */
export interface NightWorld {
  worldId: string;
  /** The night being run: Day N. Reflections are about Day N; plans are for Day N + 1. */
  day: number;
  /** Every resident id in the world. */
  residentIds: ReadonlySet<string>;
  places: PlaceRegistry;
  /** Pillars, census and today's notable events, for the reflection's town facts. */
  town: TownFacts;
  /** Tomorrow's weather, from the client. */
  forecast: string;
  /** Tomorrow's scheduled town events, one line each. */
  eventsTomorrow: readonly string[];
  /**
   * World story flags. GDD-GAP: same as context.ts: flags are client-owned and no endpoint syncs them yet, so
   * canon locks see none.
   */
  flags: readonly string[];
  /** Who the Fellow is (the Fellowship form), so plans and reflections get their pronouns right (naming.ts). */
  fellow?: FellowView | null;
}

export interface NightLog {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}
export const SILENT_LOG: NightLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

export interface NightJobDeps {
  db: WorldDatabase;
  mind: MindClient;
  /** A slot in the world's model-call semaphore (cap 8, §9.8), at this job's priority. */
  gate: <T>(task: () => Promise<T>) => Promise<T>;
  /** Aborts every call (server shutting down). */
  signal?: AbortSignal;
  /** Per-call deadline. */
  callTimeoutMs: number;
  log: NightLog;
  now?: () => number;
}

/** The ai_log row for one night call (§19.6). An encounter's "resident" is the pair key ("june+odile"). */
export function nightLogRow(
  worldId: string, residentId: string, kind: "reflect" | "plan" | "gossip", version: string, call: CallRecord, fallback: boolean,
): typeof aiLog.$inferInsert {
  return aiLogRow({ worldId, residentId, kind, promptVersion: version, call, fallback });
}
