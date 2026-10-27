// The game past the title (game.ts) is a chunk of its own: the first download is Phaser and the title, and the town's
// code follows while the title idles. Whatever needs the town (New Game, Continue, Load, opening straight into it)
// waits here.
import { showCodeWait } from './loadingScreen';

export type GameCode = typeof import('../game');

let code: Promise<GameCode> | null = null;
let arrived: ((code: GameCode) => void) | null = null;

/** main.ts, once: what to do with the code when it arrives (add its scenes to the game), before anyone else gets it. */
export function onGameCode(then: (code: GameCode) => void): void { arrived = then; }

/** The rest of the game, fetched once; after a failed fetch the next call tries again. */
export function gameCode(): Promise<GameCode> {
  return code ??= import('../game').then(c => { arrived?.(c); return c; }, (error: unknown) => { code = null; throw error; });
}

/** The same, for a player waiting on it: if it isn't in yet, the loading screen shows the wait. */
export function awaitGameCode(): Promise<GameCode> { return showCodeWait(gameCode()); }
