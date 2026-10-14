import Phaser from "phaser";

type PostClass<T> = new (game: Phaser.Game) => T;

/**
 * Put a custom post pipeline on a camera and hand back the instance that
 * was just added, ready to configure. WebGL only: returns undefined under
 * the Canvas renderer, where post pipelines don't exist.
 *
 * Registration is per game and idempotent (Phaser ignores a name it has
 * already registered). The instance returned is the LAST one of that name
 * on the camera — the one this call appended — not whichever happened to
 * be first, so a camera that somehow already carried one never has the new
 * instance left at its defaults.
 */
export const attachPostPipeline = <T extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline>(
  cam: Phaser.Cameras.Scene2D.Camera,
  game: Phaser.Game,
  name: string,
  cls: PostClass<T>
): T | undefined => {
  if (game.renderer.type !== Phaser.WEBGL) return undefined;
  (game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).pipelines.addPostPipeline(name, cls);
  cam.setPostPipeline(name);
  const found = cam.getPostPipeline(name);
  const list = Array.isArray(found) ? found : [found];
  return list[list.length - 1] as T | undefined;
};
