import Phaser from "phaser";
import { ZoneScene } from "./scenes/ZoneScene";
import { DioramaDemoScene } from "./scenes/DioramaDemoScene";
import { DialogueScene } from "./scenes/DialogueScene";
import { getMind } from "./mind/api";
import { GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE } from "./util/constants";
import { installRenderScale } from "./util/renderScale";

installRenderScale();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: GAME_WIDTH * RENDER_SCALE,
  height: GAME_HEIGHT * RENDER_SCALE,
  backgroundColor: "#202820",
  pixelArt: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: new URLSearchParams(window.location.search).get("demo") === "1"
    ? [DioramaDemoScene, ZoneScene, DialogueScene] : [ZoneScene, DioramaDemoScene, DialogueScene]
});

// Join (or create) this device's world on monde-mind; without an invite code the game plays in Quiet Mode.
const mind = getMind();
void mind.ensureWorld();

// Dev-only handle for debugging and the capture harness.
if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __game: game, __mind: mind });
