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
  return { inventory: save.inventory, coins: save.coins, economy: save.economy, clock, town: restoreTown(save.town), player: save.player, weather: save.weather,
    story_flags: save.story_flags, quiet: save.quiet, client_events: save.client_events,
    player_name: save.summary.player_name, playtime: save.summary.playtime, fellow: save.fellow, skills: save.skills, puzzles: save.puzzles, riddles: save.riddles, friendship: save.friendship, projects: save.projects, scuffles: save.scuffles };
}
