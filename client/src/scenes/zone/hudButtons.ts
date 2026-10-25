// The HUD's menu buttons (Kasey, 2026-10-24: Tasks and the map "from a key and a HUD button"): Bag, Tasks, Journal,
// Ledger and Map in a column at the bottom right (clear of the E prompt and the toasts, which are centred), each
// showing its key, for the mouse. They open what their keys open and hide whenever the objective line does (scenes,
// dialogue, menus, a door's fade).
import type Phaser from 'phaser';
import { playSfx } from '../../audio/Sfx';
import { OBJECTIVE_HIDDEN_UNDER } from '../../quests/hud';
import { FAMILY_UI, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../../util/constants';

export interface HudButton {
  /** The key that does the same ("T"). */
  key: string;
  label: string;
  run(): void;
}

const H = 30, GAP = 6, MARGIN = 20;

/** The column's box (design px), for what keeps out of it (the objective marker's edge arrow). */
export function hudButtonsBox(count: number, width: number): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: GAME_WIDTH - MARGIN - width, y0: GAME_HEIGHT - MARGIN - count * (H + GAP) + GAP, x1: GAME_WIDTH, y1: GAME_HEIGHT };
}
/** Every button is as wide as this. */
export const HUD_BUTTON_W = 104;

/** Draw the buttons (UI camera objects: the caller keeps them off the world camera) and keep their visibility in step. */
export function attachHudButtons(scene: Phaser.Scene, buttons: readonly HudButton[], busy: () => boolean): Phaser.GameObjects.GameObject[] {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const box = hudButtonsBox(buttons.length, HUD_BUTTON_W), w = HUD_BUTTON_W, x = box.x0;
  buttons.forEach((b, i) => {
    const y = box.y0 + i * (H + GAP);
    const bg = scene.add.graphics();
    const label = scene.add.text(x + 39, y + H / 2, b.label, { fontFamily: FAMILY_UI, fontSize: '14px', color: '#fff0ce', resolution: RENDER_SCALE }).setOrigin(0, 0.5);
    const draw = (hot: boolean) => {
      bg.clear().fillStyle(0x28372d, hot ? 1 : 0.88).fillRoundedRect(x, y, w, H, 8).lineStyle(1.5, 0xe4c77f, hot ? 0.95 : 0.5).strokeRoundedRect(x, y, w, H, 8);
      bg.fillStyle(0xe4c77f, hot ? 1 : 0.85).fillRoundedRect(x + 9, y + 5, 20, 20, 5);
    };
    draw(false);
    const key = scene.add.text(x + 19, y + H / 2, b.key, { fontFamily: FAMILY_UI, fontSize: '13px', fontStyle: 'bold', color: '#28372d', resolution: RENDER_SCALE }).setOrigin(0.5);
    const hit = scene.add.zone(x, y, w, H).setOrigin(0).setInteractive({ useHandCursor: true })
      .on('pointerover', () => draw(true)).on('pointerout', () => draw(false))
      .on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, e: Phaser.Types.Input.EventData) => { e.stopPropagation(); playSfx('click'); b.run(); });
    objects.push(bg, key, label, hit);
  });
  let at = 0, shown = true;
  const update = (time: number) => {
    if (time - at < 200) return;
    at = time;
    const show = !busy() && !OBJECTIVE_HIDDEN_UNDER.some(k => scene.scene.isActive(k));
    if (show === shown) return;
    shown = show;
    for (const o of objects) (o as Phaser.GameObjects.Components.Visible & Phaser.GameObjects.GameObject).setVisible(show);
  };
  scene.events.on('update', update);
  scene.events.once('shutdown', () => scene.events.off('update', update));
  return objects;
}
