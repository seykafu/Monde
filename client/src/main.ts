import { TitleScene, SaveMenuScene } from "./scenes/TitleScene";
import Phaser from "phaser";
import { ZoneScene } from "./scenes/ZoneScene";
import { DioramaDemoScene } from "./scenes/DioramaDemoScene";
import { DialogueScene } from "./scenes/DialogueScene";
import { TownLedgerScene } from "./scenes/TownLedgerScene";
import { PeopleScene } from "./scenes/PeopleScene";
import { StoryScene } from "./scenes/StoryScene";
import { FellowshipScene } from "./scenes/FellowshipScene";
import { LooksGalleryScene } from "./scenes/LooksGalleryScene";
import { getMind } from "./mind/api";
import { GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE } from "./util/constants";
import { installRenderScale } from "./util/renderScale";
import { TownBoard } from "./render/town/TownBoard";
import { applySpringPreset, springPresetFromQuery } from "./finale/devPreset";
import { parseClock } from "./sim/clock";

installRenderScale();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: GAME_WIDTH * RENDER_SCALE,
  height: GAME_HEIGHT * RENDER_SCALE,
  backgroundColor: "#202820",
  pixelArt: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // Dev-only `?looks=1`: the residents' sprite and bust contact sheet (scenes/LooksGalleryScene.ts).
  scene: import.meta.env.DEV && new URLSearchParams(window.location.search).get("looks") === "1"
    ? [LooksGalleryScene]
    : new URLSearchParams(window.location.search).get("demo") === "1"
    ? [DioramaDemoScene, TitleScene, FellowshipScene, ZoneScene, DialogueScene, TownLedgerScene, PeopleScene, StoryScene, SaveMenuScene]
    : (new URLSearchParams(window.location.search).get("skiptitle") === "1" || new URLSearchParams(window.location.search).has("puzzle") || new URLSearchParams(window.location.search).has("scuffle"))
      // Skips the Fellowship form too: ZoneScene signs a default application (fellow/state.ts ensureFellow).
      ? [ZoneScene, TitleScene, FellowshipScene, DioramaDemoScene, DialogueScene, TownLedgerScene, PeopleScene, StoryScene, SaveMenuScene]
      : [TitleScene, FellowshipScene, ZoneScene, DioramaDemoScene, DialogueScene, TownLedgerScene, PeopleScene, StoryScene, SaveMenuScene]
});

// Dev (`?spring=strong|social|builder|lapsed|passive`, a dev build or `?dev`): start on Day 25 with that Spring behind
// it (finale/devPreset.ts), for the Bloom Fair, the Straw Poll and the End-of-Spring report.
const springQuery = new URLSearchParams(window.location.search);
const springStyle = import.meta.env.DEV || springQuery.has("dev") ? springPresetFromQuery(springQuery) : null;
if (springStyle) applySpringPreset(game.registry, springStyle, Number(springQuery.get("day")) || 25, parseClock(springQuery.get("time") ?? "") ?? 9 * 60);

// Join (or create) this device's world on monde-mind; without an invite code the game plays in Quiet Mode.
const mind = getMind();
// Then send a Fellowship application that couldn't reach the server last time (fail soft; §11.1).
void mind.ensureWorld().then(() => mind.syncPlayer());

// Dev-only handle for debugging and the capture harness.
if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __game: game, __mind: mind, __townBake: TownBoard.bakeLog });
