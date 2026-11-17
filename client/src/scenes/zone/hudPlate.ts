import type Phaser from 'phaser';

export function hudPlate(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  g.clear().fillStyle(0x28372d, 0.92).fillRoundedRect(x, y, w, h, 10)
    .lineStyle(2, 0xe4c77f, 0.55).strokeRoundedRect(x, y, w, h, 10);
}
