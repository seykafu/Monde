import Phaser from "phaser";
import { DioramaDemoScene } from "./scenes/DioramaDemoScene";
import { GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE } from "./util/constants";
import { installRenderScale } from "./util/renderScale";

installRenderScale();
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: GAME_WIDTH * RENDER_SCALE,
  height: GAME_HEIGHT * RENDER_SCALE,
  backgroundColor: "#202820",
  pixelArt: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [DioramaDemoScene]
});
