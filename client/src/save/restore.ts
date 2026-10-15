import { migrateSave } from '@monde/shared';
import { Clock } from '../sim/clock';
import { restore as restoreTown } from '../town/townEngine';
import type { GameState } from './collect';
/** Build a fresh state first: invalid files never partly mutate a running game. */
export function restore(raw: unknown): GameState {
  const save = migrateSave(raw);
  const clock = new Clock({ day: save.clock.day, minute: 360 });
  // setTime normally normalizes 26:00 to the next day. Preserve a save at pass-out exactly.
  if (save.clock.minute === 1560) { clock.autoRollover = false; clock.advanceMinutes(1200); clock.autoRollover = true; }
  else clock.setTime(save.clock.day, save.clock.minute);
  return { clock, town: restoreTown(save.town), player: save.player, weather: save.weather,
    story_flags: save.story_flags, quiet: save.quiet, offline_events: save.offline_events,
    player_name: save.summary.player_name, playtime: save.summary.playtime };
}
