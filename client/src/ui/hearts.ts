// Hearts and emote icons on screen (GDD §9.11.1, §16.5): textures from the pixel art in friendship/icons.ts, and
// the ten-heart row the dialogue name plate and the People page draw.
import Phaser from 'phaser';
import { heartRow, type HeartRow } from '@monde/shared';
import { EMOTE_CELL, HEART_CELL, emoteIcon, heartIcon, heartIconsFor, type EmoteIcon, type HeartIcon, type IconArt } from '../friendship/icons';

/** A canvas texture from pixel art, made once per game (textures outlive scenes); hard-edged when scaled. */
export function iconTexture(scene: Phaser.Scene, key: string, art: () => IconArt): string {
  if (scene.textures.exists(key)) return key;
  const a = art();
  const tex = scene.textures.createCanvas(key, a.w, a.h);
  if (!tex) return key;
  const ctx = tex.getContext(), img = ctx.createImageData(a.w, a.h);
  img.data.set(a.data);
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
  return key;
}

export const heartTexture = (scene: Phaser.Scene, kind: HeartIcon): string => iconTexture(scene, `heart-${kind}`, () => heartIcon(kind));
export const emoteTexture = (scene: Phaser.Scene, id: EmoteIcon): string => iconTexture(scene, `pair-emote-${id}`, () => emoteIcon(id));
export { EMOTE_CELL, HEART_CELL };

/** Ten hearts in a row, one per 10 Regard with halves at 5, or one cracked heart below 0 (§9.11.1). */
export class HeartRowView {
  readonly container: Phaser.GameObjects.Container;
  private readonly images: Phaser.GameObjects.Image[];
  private icons: string[] = [];
  readonly width: number;
  readonly height: number;

  /** At (x, y), the row's left edge and vertical middle. `scale` is design pixels per art pixel. */
  constructor(private readonly scene: Phaser.Scene, x: number, y: number, private readonly scale = 2, gap = 1) {
    const step = HEART_CELL.w * scale + gap;
    this.width = step * 10 - gap;
    this.height = HEART_CELL.h * scale;
    this.images = Array.from({ length: 10 }, (_, i) =>
      scene.add.image(i * step + (HEART_CELL.w * scale) / 2, 0, heartTexture(scene, 'empty')).setScale(scale));
    this.container = scene.add.container(x, y, this.images);
  }

  setRegard(regard: number, pop = false): void { this.set(heartRow(regard), pop); }

  /** Show a row; with `pop`, hearts that changed bounce. */
  set(row: HeartRow, pop = false): void {
    const icons = heartIconsFor(row);
    this.images.forEach((img, i) => {
      const icon = icons[i];
      if (!icon) { img.setVisible(false); return; }
      img.setVisible(true).setTexture(heartTexture(this.scene, icon));
      if (pop && this.icons[i] !== icon) {
        this.scene.tweens.killTweensOf(img);
        this.scene.tweens.add({ targets: img, scale: { from: this.scale * 1.45, to: this.scale }, duration: 220, ease: 'Back.easeOut' });
      }
    });
    this.icons = icons;
  }

  /** The middle of heart `i` in the row's container space (for floating things off it). */
  heartX(i: number): number { return this.images[Math.max(0, Math.min(9, i))]!.x; }

  destroy(): void { this.container.destroy(); }
}
