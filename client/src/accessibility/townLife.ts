// Adapter keeps the renderer's ownership separate while making its motion option live.
import type Phaser from 'phaser';
import { TownLife as RenderLife, type LifeEnv } from '../render/town/TownLife';
import type { TownBoard } from '../render/town/TownBoard';
import { reducedMotion } from './runtime';
export { reducedMotion } from './runtime';
export class TownLife extends RenderLife {
  private readonly moving: Phaser.GameObjects.Image[];
  constructor(scene: Phaser.Scene, board: TownBoard, opts: { reduced: boolean; seaside: boolean }) {
    const before = new Set(scene.children.list);
    // Allocate all pools so turning motion back on works without rebuilding the scene.
    let ready = false;
    super(scene, board, { seaside: opts.seaside, get reduced() { return ready && reducedMotion(); } });
    ready = true;
    this.moving = scene.children.list.filter(o => !before.has(o) && 'texture' in o) as Phaser.GameObjects.Image[];
  }
  override update(dt: number, env: LifeEnv): void {
    super.update(dt, env);
    if (reducedMotion()) for (const img of this.moving) {
      if (/bird|gull|butterfly|leaf/.test(img.texture.key)) img.setVisible(false);
    }
  }
}
