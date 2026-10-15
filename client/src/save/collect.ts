import { SaveGame } from '@monde/shared';
import type { Clock } from '../sim/clock';
import { serialize } from '../town/townEngine';
import type { TownState } from '../town/pillars';
export interface GameState {
  clock: Clock;
  town: TownState;
  player: SaveGame['player'];
  weather: SaveGame['weather'];
  story_flags: SaveGame['story_flags'];
  quiet: SaveGame['quiet'];
  offline_events: SaveGame['offline_events'];
  player_name: string;
  playtime: number;
}
export function collect(state: GameState, kind: SaveGame['kind'], label: string, savedAt = new Date().toISOString()): SaveGame {
  return SaveGame.parse({ schema_version: 1, saved_at: savedAt, kind, label,
    summary: { day: state.clock.day, weekday: state.clock.time.weekday, time: state.clock.minute,
      zone: state.player.zone, player_name: state.player_name, playtime: state.playtime },
    mind: { world_id: null, branch_id: null, snapshot_id: null }, clock: state.clock.time,
    town: serialize(state.town), player: state.player, weather: state.weather,
    story_flags: state.story_flags, quiet: state.quiet, offline_events: state.offline_events,
    inventory: {}, coins: {}, skills: {}
  });
}
