import { TitleScene } from "./scenes/TitleScene";
import Phaser from "phaser";
import { getMind } from "./mind/api";
import { GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE } from "./util/constants";
import { installRenderScale } from "./util/renderScale";
import { installTextureFetch } from "./boot/textureFetch";
import { bootFailed, endBootOnFirstFrame } from "./boot/loadingScreen";
import { gameCode, onGameCode } from "./boot/gameCode";

const query = new URLSearchParams(window.location.search);
// Dev-only `?looks=1`: the residents' sprite and bust contact sheet (scenes/LooksGalleryScene.ts).
const looks = import.meta.env.DEV && query.get("looks") === "1";
// The scene the game opens on. Skipping the title skips the Fellowship form too: ZoneScene signs a default application
// (fellow/state.ts ensureFellow).
const first = looks ? "LooksGallery"
  : query.get("demo") === "1" ? "DioramaDemo"
  : query.get("skiptitle") === "1" || query.has("puzzle") || query.has("scuffle") ? "Zone"
  : "Title";

installRenderScale();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: GAME_WIDTH * RENDER_SCALE,
  height: GAME_HEIGHT * RENDER_SCALE,
  backgroundColor: "#202820",
  pixelArt: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // The first download is Phaser and the title; the rest of the game's code (game.ts) adds its scenes when it arrives.
  scene: first === "Title" ? [TitleScene] : []
});
// The page's loading screen (index.html) gives way to the first scene's first frame; a hidden scene fetches art ahead.
installTextureFetch(game);
const firstFrame = endBootOnFirstFrame(game);
onGameCode(code => code.addScenes(game, first));
// The title fetches the rest while it idles (New Game and Continue wait for it if they have to); anywhere else waits for
// it behind the loading screen.
if (looks) void import("./scenes/LooksGalleryScene").then(({ LooksGalleryScene }) => game.scene.add(first, LooksGalleryScene, true));
else if (first === "Title") void firstFrame.then(gameCode).catch(() => undefined);
else void gameCode().catch(bootFailed);

// Join (or create) this device's world on monde-mind; without an invite code the game plays in Quiet Mode.
const mind = getMind();
// Then send a Fellowship application that couldn't reach the server last time (fail soft; §11.1).
void mind.ensureWorld().then(() => mind.syncPlayer());

// Dev-only handle for debugging and the capture harness.
if (import.meta.env.DEV) Object.assign(window as unknown as Record<string, unknown>, { __game: game, __mind: mind });
