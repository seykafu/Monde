// The conversation log (GDD §18 Dialogue): this conversation's exchange so far, newest at the bottom.
//
// Opened from the panel's "Log" button or the L key; Up/Down, Page Up/Down and the mouse wheel scroll by
// whole entries, and L, Esc or a click outside closes it. No masks: entries that don't fit are hidden, so
// the overlay is crisp at any render scale. The entries themselves are kept by DialogueScene.
import Phaser from 'phaser';
import { FAMILY_BODY, FAMILY_HEADING, RENDER_SCALE } from '../util/constants';
import { LOG_GAP, bottomFirst, visibleRange, type LogEntry } from './logLayout';

export type { LogEntry } from './logLayout';

export interface BacklogLayout { x: number; y: number; w: number; h: number }

const INK = 0x1f2a22;
const GOLD = 0xe4c77f;
const NAME_W = 118;
const PAD = 22;
const HEADER = 46;

export class Backlog {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly rows: { name: Phaser.GameObjects.Text; text: Phaser.GameObjects.Text; h: number }[] = [];
  private readonly more: { up: Phaser.GameObjects.Text; down: Phaser.GameObjects.Text };
  private first = 0;
  private readonly room: number;
  private readonly wheel: (pointer: Phaser.Input.Pointer, over: unknown, dx: number, dy: number) => void;

  constructor(private readonly scene: Phaser.Scene, private readonly box: BacklogLayout, entries: readonly LogEntry[], residentName: string, onClose: () => void,
    opts: { title?: string } = {}) {
    const { x, y, w, h } = box;
    // A click anywhere outside the box closes it; inside, it's swallowed.
    const shield = scene.add.zone(0, 0, scene.scale.gameSize.width * 4, scene.scale.gameSize.height * 4).setOrigin(0).setInteractive().setDepth(69);
    shield.on('pointerup', (p: Phaser.Input.Pointer) => {
      const px = p.worldX, py = p.worldY;
      if (px < x || px > x + w || py < y || py > y + h) onClose();
    });
    const bg = scene.add.graphics().setDepth(70);
    bg.fillStyle(0x0c100d, 0.45).fillRect(0, 0, scene.scale.gameSize.width * 4, scene.scale.gameSize.height * 4);
    bg.fillStyle(INK, 1).fillRoundedRect(x, y, w, h, 14);
    bg.lineStyle(2, GOLD, 0.6).strokeRoundedRect(x, y, w, h, 14);
    bg.lineStyle(1, GOLD, 0.25).lineBetween(x + PAD, y + HEADER, x + w - PAD, y + HEADER);
    const title = scene.add.text(x + PAD, y + HEADER / 2 + 2, opts.title ?? `Talking with ${residentName}`, {
      fontFamily: FAMILY_HEADING, fontSize: '20px', color: '#fff0ce', resolution: RENDER_SCALE
    }).setOrigin(0, 0.5).setDepth(71);
    const hint = scene.add.text(x + w - PAD, y + HEADER / 2 + 2, '↑↓ scroll · L or Esc to close', {
      fontFamily: FAMILY_BODY, fontSize: '14px', color: '#cfc4a6', resolution: RENDER_SCALE
    }).setOrigin(1, 0.5).setDepth(71);
    this.objects.push(shield, bg, title, hint);

    const textW = w - PAD * 2 - NAME_W - 16;
    for (const entry of entries) {
      const player = entry.who === 'player', narrator = entry.who === 'narrator';
      const name = scene.add.text(0, 0, player ? 'You' : narrator ? '' : entry.name ?? residentName, {
        fontFamily: FAMILY_HEADING, fontSize: '17px', color: player ? '#9fd3b6' : '#e4c77f', resolution: RENDER_SCALE,
        align: 'right', fixedWidth: NAME_W
      }).setDepth(71);
      const text = scene.add.text(0, 0, entry.text, {
        fontFamily: FAMILY_BODY, fontSize: '18px', color: player ? '#f6dc9c' : narrator ? '#e6dcc0' : '#f3ecd9', fontStyle: player || narrator ? 'italic' : 'normal',
        lineSpacing: 4, wordWrap: { width: textW }, resolution: RENDER_SCALE
      }).setDepth(71);
      this.rows.push({ name, text, h: Math.max(name.height, text.height) });
      this.objects.push(name, text);
    }
    if (!entries.length) {
      this.objects.push(scene.add.text(x + w / 2, y + HEADER + 40, 'Nothing said yet.', {
        fontFamily: FAMILY_BODY, fontSize: '17px', fontStyle: 'italic', color: '#cfc4a6', resolution: RENDER_SCALE
      }).setOrigin(0.5, 0).setDepth(71));
    }
    const arrow = (yy: number, label: string) => scene.add.text(x + w / 2, yy, label, {
      fontFamily: FAMILY_BODY, fontSize: '14px', color: '#e4c77f', resolution: RENDER_SCALE
    }).setOrigin(0.5).setDepth(71);
    this.more = { up: arrow(y + HEADER + 10, '▲ earlier'), down: arrow(y + h - 12, '▼ later') };
    this.objects.push(this.more.up, this.more.down);
    this.room = h - HEADER - 34 - 18;
    this.first = bottomFirst(this.rows.map(r => r.h), this.room);
    this.wheel = (_p, _o, _dx, dy) => this.scroll(dy > 0 ? 1 : -1);
    scene.input.on('wheel', this.wheel);
    this.layout();
  }

  /** Scroll by whole entries (negative is earlier). */
  scroll(step: number): void {
    const heights = this.rows.map(r => r.h);
    const maxFirst = bottomFirst(heights, this.room);
    const next = Phaser.Math.Clamp(this.first + step, 0, maxFirst);
    if (next === this.first) return;
    this.first = next;
    this.layout();
  }

  destroy(): void {
    this.scene.input.off('wheel', this.wheel);
    for (const o of this.objects) o.destroy();
  }

  private layout(): void {
    const { x, y } = this.box;
    const heights = this.rows.map(r => r.h);
    const { first, last } = visibleRange(heights, this.first, this.room);
    let top = y + HEADER + 24;
    this.rows.forEach((row, i) => {
      const show = i >= first && i <= last;
      row.name.setVisible(show);
      row.text.setVisible(show);
      if (!show) return;
      row.name.setPosition(x + PAD, top + 1);
      row.text.setPosition(x + PAD + NAME_W + 16, top);
      top += row.h + LOG_GAP;
    });
    this.more.up.setVisible(first > 0);
    this.more.down.setVisible(last < this.rows.length - 1);
  }
}
