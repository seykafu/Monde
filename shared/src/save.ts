import { z } from 'zod';
import { CharacterLookData } from './look';
import { PlayerProfile, Skills, baseSkills } from './player';
import { SavedFriendship, emptyFriendship } from './friendshipData';
import { ClientEvent } from './events';

const n = z.number().finite();
const count = n.int().nonnegative();
const day = n.int().positive();
const pillars = z.object({ prosperity: n, safety: n, spirit: n, charm: n });
export const SavedTown = z.object({
  day, pillars, dayStart: pillars, census: count, fund: n,
  homes: z.object({ occupied: count, vacant_restorable: count, restored_free: count }),
  flags: z.record(z.string(), z.boolean()), openJobs: count, tollmenLevelMax: n,
  history: z.array(z.object({ day, pillars })),
  communityWork: z.object({ week: count, gained: pillars }),
  log: z.array(z.object({ day, pillar: z.enum(['prosperity', 'safety', 'spirit', 'charm']),
    source: z.enum(['community_work', 'project', 'riddle', 'story', 'resident_sim', 'scuffle', 'tollmen', 'event', 'drift', 'dev']),
    requested: n, applied: n, capped: z.boolean(), note: z.string().optional() })),
  migration: z.object({ lowStayNights: z.record(z.string(), count), notices: z.record(z.string(), day) }),
  optionClause: z.object({ dawnsUnder: count, exercised: z.boolean(), exercisedDay: day.nullable() })
});
export const SavedQuiet = z.object({
  day: count, residents: z.record(z.string(), z.object({
    recent: z.array(z.object({ id: z.string(), group: z.string() })),
    uses: z.array(z.object({ group: z.string(), day: count }))
  })), player: z.array(z.string()), today: z.record(z.string(), z.array(z.string()))
});
const weekday = z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const weatherKind = z.enum(['sun', 'cloud', 'rain', 'fog', 'wind', 'snow']);
const empty = z.record(z.string(), z.never());
/**
 * The Fellowship application (GDD §11.1) and the player's look. `profile` is null until the form is signed (a
 * save from before it, or one migrated from v1); `look` null means the rig's default player.
 */
export const SavedFellow = z.object({ profile: PlayerProfile.nullable(), look: CharacterLookData.nullable() });
/**
 * The client's event log (M-06; shared/src/events.ts, server/src/mind/EVENTS.md): ClientEvents waiting for the server
 * (`outbox`, in order, each with the id it was given when it was queued), the ones the server refused (`rejected`,
 * kept with the reason so nothing is discarded silently), and the story-flags snapshot bookkeeping: the last
 * revision used and the flags it carried (null: none sent from this save yet).
 */
export const SavedEventLog = z.object({
  outbox: z.array(ClientEvent),
  /** Refused events: by the server (`event`), or locally as not a valid ClientEvent (`raw`, its JSON, cut to 2000 characters). */
  rejected: z.array(z.object({ id: z.string(), kind: z.string(), reason: z.string(), event: ClientEvent.optional(), raw: z.string().max(2000).optional() })),
  flags_revision: z.number().int().min(0).max(2_147_483_647),
  flags: z.array(z.string()).nullable(),
});
export type SavedEventLog = z.infer<typeof SavedEventLog>;
export const emptyEventLog = (): SavedEventLog => ({ outbox: [], rejected: [], flags_revision: 0, flags: null });

export const SAVE_SCHEMA_VERSION = 3;
export const SaveGame = z.object({
  schema_version: z.literal(SAVE_SCHEMA_VERSION), saved_at: z.string().datetime(), label: z.string(),
  kind: z.enum(['manual', 'autosave', 'checkpoint']),
  // time is game minutes since midnight; playtime is active real seconds.
  summary: z.object({ day, weekday, time: n, zone: z.string(), player_name: z.string(), playtime: n.nonnegative() }),
  mind: z.object({ world_id: z.string().nullable(), branch_id: z.string().nullable(), snapshot_id: z.string().nullable() }),
  clock: z.object({ day, minute: n.min(360).max(1560), weekday, season: z.enum(['spring', 'summer', 'autumn', 'winter']) }),
  weather: z.object({ seed: n, override: weatherKind.nullable(), daily: z.object({
    day, kind: weatherKind, wind: z.enum(['N', 'E', 'S', 'W']), windStrength: n,
    spell: z.object({ from: n, until: n }).nullable(), fogUntil: n.nullable(), eveningFog: z.boolean()
  }) }),
  town: SavedTown,
  // Facing is radians in world coordinates (+x = 0), independent of renderer animation frames.
  player: z.object({ zone: z.string(), x: n, y: n, facing: n }),
  story_flags: z.record(z.string(), z.union([z.boolean(), n, z.string()])),
  quiet: SavedQuiet,
  /** v3 (M-06): the ClientEvent log, sent to POST /events when online and with the night pass (§9.14). */
  client_events: SavedEventLog,
  fellow: SavedFellow,
  inventory: empty, coins: empty,
  /** §11.2 skills, from the Background's start (§11.1). */
  skills: Skills,
  /**
   * G-13 friendship (friendshipData.ts). Optional on read: a save from before it starts with nothing known, so it
   * needs no version bump or migration step.
   */
  friendship: SavedFriendship.default(emptyFriendship)
});
export type SaveGame = z.infer<typeof SaveGame>;

/** v1–v2's offline log record: `{day, minute, type, resident_id, data}` (G-10 wrote `memory` and `regard`). */
const LegacyEvent = z.object({ day, minute: n, type: z.string(), resident_id: z.string().nullable(), data: z.record(z.string(), z.union([n, z.string(), z.boolean(), z.null()])) });

/**
 * v2 → v3: the old offline log's records as ClientEvents. G-10's story host wrote two kinds: `memory` (→
 * `scripted_memory`) and `regard` (→ `scripted_regard`), each with `data.scene` / `data.cue`; their ids are derived
 * from that cue identity (the server dedupes a cue by kind + scene + cue key anyway). Anything else, or a record that
 * doesn't make a valid ClientEvent, is dropped and reported to `warn`.
 */
export function legacyClientEvents(records: unknown, warn: (message: string) => void = () => undefined): ClientEvent[] {
  const out: ClientEvent[] = [];
  const list = Array.isArray(records) ? records : [];
  list.forEach((raw, i) => {
    const legacy = LegacyEvent.safeParse(raw);
    const r = legacy.success ? legacy.data : null;
    const d = r?.data ?? {};
    const scene = typeof d.scene === "string" ? d.scene : "", cue = typeof d.cue === "string" ? d.cue : "";
    const kind = r?.type === "memory" ? "scripted_memory" : r?.type === "regard" ? "scripted_regard" : null;
    const stamp = r ? { id: `legacy:${kind}:${scene}|${cue}`.slice(0, 200), day: r.day, minute: Math.round(r.minute), resident: r.resident_id ?? "", scene_id: scene, cue_key: cue } : null;
    const candidate = !stamp || !kind ? null : kind === "scripted_memory"
      ? { ...stamp, kind, place: d.place, text: d.text, importance: d.importance }
      : { ...stamp, kind, delta: d.delta };
    const parsed = ClientEvent.safeParse(candidate);
    if (parsed.success) out.push(parsed.data);
    else warn(`[save] dropped offline event ${i} (${r?.type ?? "unreadable"}): not a valid ClientEvent`);
  });
  return out;
}

/**
 * Read any supported version into the current one. v1 → v2 (W-07): adds `fellow` (no profile, the default
 * look) and fills the reserved empty `skills` with every skill at level 1. v2 → v3 (M-06): the offline log becomes
 * the ClientEvent log (legacyClientEvents), with no flags snapshot sent yet.
 */
export function migrateSave(raw: unknown, warn: (message: string) => void = message => console.warn(message)): SaveGame {
  const version = z.object({ schema_version: z.number() }).parse(raw).schema_version;
  let data = raw as Record<string, unknown>;
  if (!Number.isInteger(version) || version < 1 || version > SAVE_SCHEMA_VERSION) {
    throw new Error(`Unsupported save schema version ${version}; expected 1–${SAVE_SCHEMA_VERSION}`);
  }
  if (version === 1) {
    z.object({ skills: empty }).parse(data);
    data = { ...data, schema_version: 2, fellow: { profile: null, look: null }, skills: baseSkills() };
  }
  if (version <= 2) {
    const { offline_events: legacy, ...rest } = data;
    data = { ...rest, schema_version: 3, client_events: { ...emptyEventLog(), outbox: legacyClientEvents(legacy, warn) } };
  }
  return SaveGame.parse(data);
}
