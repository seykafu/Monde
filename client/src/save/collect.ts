import { SAVE_SCHEMA_VERSION, SaveGame } from '@monde/shared';
import type { Clock } from '../sim/clock';
import { serialize } from '../town/townEngine';
import type { TownState } from '../town/pillars';
export interface GameState {
  inventory?: SaveGame['inventory'];
  coins?: SaveGame['coins'];
  economy?: SaveGame['economy'];
  clock: Clock;
  town: TownState;
  player: SaveGame['player'];
  weather: SaveGame['weather'];
  story_flags: SaveGame['story_flags'];
  quiet: SaveGame['quiet'];
  /** The ClientEvent log (M-06; mind/events.ts): what's still to send, what the server refused, the flags revision. */
  client_events: SaveGame['client_events'];
  player_name: string;
  playtime: number;
  /** The Fellowship application and look (W-07); profile null before the form is signed. */
  fellow: SaveGame['fellow'];
  skills: SaveGame['skills'];
  /** G-13 friendship (scenes/friendship.ts); absent means nothing known yet. */
  riddles?: SaveGame['riddles'];
  friendship?: SaveGame['friendship'];
}
export function collect(state: GameState, kind: SaveGame['kind'], label: string, savedAt = new Date().toISOString()): SaveGame {
  return SaveGame.parse({ schema_version: SAVE_SCHEMA_VERSION, saved_at: savedAt, kind, label,
    summary: { day: state.clock.day, weekday: state.clock.time.weekday, time: state.clock.minute,
      zone: state.player.zone, player_name: state.player_name, playtime: state.playtime },
    mind: { world_id: null, branch_id: null, snapshot_id: null }, clock: state.clock.time,
    town: serialize(state.town), player: state.player, weather: state.weather,
    story_flags: state.story_flags, quiet: state.quiet, client_events: state.client_events,
    fellow: state.fellow, inventory: state.inventory, coins: state.coins, economy: state.economy, skills: state.skills, friendship: state.friendship, riddles: state.riddles
  });
}
