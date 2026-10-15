import { z } from 'zod';
import { CharacterLookData } from './look';
import { PlayerProfile, Skills, baseSkills } from './player';
import { SavedFriendship, emptyFriendship } from './friendshipData';

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
export const SAVE_SCHEMA_VERSION = 2;
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
  // Offline events are retained for the future online night-pass synchronizer (§9.14).
  offline_events: z.array(z.object({ day, minute: n, type: z.string(), resident_id: z.string().nullable(), data: z.record(z.string(), z.union([n, z.string(), z.boolean(), z.null()])) })),
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

/**
 * Read any supported version into the current one. v1 → v2 (W-07): adds `fellow` (no profile, the default
 * look) and fills the reserved empty `skills` with every skill at level 1.
 */
export function migrateSave(raw: unknown): SaveGame {
  const version = z.object({ schema_version: z.number() }).parse(raw).schema_version;
  let data = raw as Record<string, unknown>;
  if (version === 1) {
    z.object({ skills: empty }).parse(data);
    data = { ...data, schema_version: 2, fellow: { profile: null, look: null }, skills: baseSkills() };
  } else if (version !== SAVE_SCHEMA_VERSION) {
    throw new Error(`Unsupported save schema version ${version}; expected 1–${SAVE_SCHEMA_VERSION}`);
  }
  return SaveGame.parse(data);
}
