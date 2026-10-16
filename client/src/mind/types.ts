// Wire types for monde-mind's dialogue API (GDD §9.10, §19.4; MVP M-05). Mirrors server/src/mind/routes.ts:
// the client never imports server code, so the shapes are restated here and checked at runtime (talkStream.ts).
import type { Intent, TurnRegard } from '@monde/shared';

export interface TalkLine { text: string; expr: string }
export interface TalkChoice { id: string; text: string; intent: Intent }

/** The `turn` event: always last on the stream and authoritative over anything streamed before it. */
export interface TalkTurn {
  favors?: import("@monde/shared").Favor[];
  conversation_id: string;
  resumed?: boolean;
  history?: { who: 'player' | 'resident'; text: string }[];
  resident_id: string;
  /** 0-based exchange number within the conversation. */
  turn_index: number;
  lines: TalkLine[];
  choices: TalkChoice[];
  /** A natural last line: the client offers only Leave after it (§9.10 step 6). */
  wrap_up: boolean;
  /** An authored line stood in for the model (server fallback or client Quiet Mode). Rendered the same. */
  fallback: boolean;
  /**
   * The Regard change the server applied this turn (G-13, §9.11.2): null when it saved nothing, absent on Quiet
   * Mode turns (the client never judges replies).
   */
  regard?: TurnRegard | null;
}

export type TalkInput =
  | { kind: 'open' }
  | { kind: 'meal'; item: string; event_id: string; text: string }
  | { kind: 'gift'; item: string; reaction: import('@monde/shared').GiftReaction; event_id: string; text: string }
  | { kind: 'choice'; choice_id: string; text: string; intent: Intent }
  | { kind: 'say'; text: string };

/** What the client reports with every turn: it owns the clock, positions and weather. */
export interface TalkContext {
  heart_level?: number;
  day: number;
  /** Minutes since midnight of `day`, 360..1560. */
  minute: number;
  /** `zone.place` where the resident is standing. */
  place: string;
  /** A short weather phrase ("drizzle", "bright spells"). */
  weather: string;
  current_activity?: string | null;
  riddle?: { id: string; hints_allowed: number } | null;
}

export interface TalkRequest {
  resident_id: string;
  conversation_id: string;
  input: TalkInput;
  context: TalkContext;
}

export interface LineDelta {
  index: number;
  text_so_far: string;
  /** 1 for the first model call, 2 for the regeneration: lines from an earlier attempt are void. */
  attempt: number;
}

export type TalkEvent =
  | { type: 'line_delta'; data: LineDelta }
  | { type: 'thinking'; data: { text: string } }
  | { type: 'error'; data: { code: string; message: string } }
  | { type: 'turn'; data: TalkTurn };

/** The player's Fellowship application (GDD §11.1): one schema for client and server (@monde/shared player.ts). */
export type { PlayerProfile } from '@monde/shared';
