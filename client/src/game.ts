// The game past the title, in a chunk of its own (boot/gameCode.ts): the town and its scenes, the residents, the stories
// and the save runtime. The title draws without it and fetches it while it idles; New Game, Continue and Load wait on
// it, and `?skiptitle`, `?puzzle`, `?scuffle` and `?demo` open straight into it behind the loading screen.
import type Phaser from 'phaser';
import { SaveMenuScene, TitleScene } from './scenes/TitleScene';
import { ZoneScene } from './scenes/ZoneScene';
import { DioramaDemoScene } from './scenes/DioramaDemoScene';
import { DIALOGUE_SCENE, DialogueScene } from './scenes/DialogueScene';
import { TOWN_LEDGER_SCENE, TownLedgerScene } from './scenes/TownLedgerScene';
import { PEOPLE_SCENE, PeopleScene } from './scenes/PeopleScene';
import { STORY_SCENE, StoryScene } from './scenes/StoryScene';
import { FELLOWSHIP_SCENE, FellowshipScene } from './scenes/FellowshipScene';
import { TownBoard, prefetchTownSprites } from './render/town/TownBoard';
import { boardNeighbours, boards } from './world/zones';
import { OPENING_BOARD } from './story/session';
import { applySpringPreset, springPresetFromQuery } from './finale/devPreset';
import { parseClock } from './sim/clock';

export { loadGame, resetGame, saveGame } from './save/runtime';

/** The game's scenes in the order main.ts listed them before the split: a later one draws over an earlier one. */
const SCENES: readonly (readonly [string, new () => Phaser.Scene])[] = [
  ['Title', TitleScene], [FELLOWSHIP_SCENE, FellowshipScene], ['Zone', ZoneScene], ['DioramaDemo', DioramaDemoScene],
  [DIALOGUE_SCENE, DialogueScene], [TOWN_LEDGER_SCENE, TownLedgerScene], [PEOPLE_SCENE, PeopleScene],
  [STORY_SCENE, StoryScene], ['SaveMenu', SaveMenuScene]
];

/** Add the scenes the game doesn't have yet, `first` lowest and started (the title, already up, stays as it is). */
export function addScenes(game: Phaser.Game, first: string): void {
  // Dev (`?spring=strong|social|builder|lapsed|passive`, a dev build or `?dev`): start on Day 25 with that Spring behind
  // it (finale/devPreset.ts), for the Bloom Fair, the Straw Poll and the End-of-Spring report.
  const query = new URLSearchParams(window.location.search);
  const spring = import.meta.env.DEV || query.has('dev') ? springPresetFromQuery(query) : null;
  if (spring) applySpringPreset(game.registry, spring, Number(query.get('day')) || 25, parseClock(query.get('time') ?? '') ?? 9 * 60);
  for (const [key, scene] of [...SCENES.filter(([k]) => k === first), ...SCENES.filter(([k]) => k !== first)]) {
    if (!game.scene.getScene(key)) game.scene.add(key, scene, key === first);
  }
  // Dev-only handle for the capture harness.
  if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __townBake: TownBoard.bakeLog });
}

/**
 * While the title waits, the town's art comes in: the board Continue opens on, else New Game's two (the Old Quarter,
 * then the ferry slip its opening scene moves to), then the rest.
 */
export function prefetchForTitle(scene: Phaser.Scene, continueBoard: string | undefined): void {
  const first = [continueBoard, 'old_quarter', OPENING_BOARD].filter((id): id is string => !!id);
  prefetchTownSprites(scene, boards, boardNeighbours, ...first);
}
