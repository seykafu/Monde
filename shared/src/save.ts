import { z } from 'zod';

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
export const SaveGame = z.object({
  schema_version: z.literal(1), saved_at: z.string().datetime(), label: z.string(),
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
  // Offline events are retained for the future online night-pass synchronizer (§9.14).
  offline_events: z.array(z.object({ day, minute: n, type: z.string(), resident_id: z.string().nullable(), data: z.record(z.string(), z.union([n, z.string(), z.boolean(), z.null()])) })),
  inventory: empty, coins: empty, skills: empty
});
export type SaveGame = z.infer<typeof SaveGame>;

/** Version 1 is the first format. Add sequential migrations here when version 2 ships. */
export function migrateSave(raw: unknown): SaveGame {
  const version = z.object({ schema_version: z.number() }).parse(raw).schema_version;
  if (version !== 1) throw new Error(`Unsupported save schema version ${version}; expected 1`);
  return SaveGame.parse(raw);
}
