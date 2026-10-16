// The HUD's Online/Offline dot (GDD §9.14). A small dot in the HUD's top-right corner: green while residents speak
// for themselves, amber while joining, and grey with the word "offline" in Quiet Mode. Hovering shows what's going
// on; clicking retries at once, and while the server is unreachable it retries on its own (mind/connection.ts).
import Phaser from 'phaser';
import { FAMILY_BODY, RENDER_SCALE } from '../util/constants';
import { getMind } from '../mind/api';
import { Reconnect, statusDetail, statusLabel, type MindStatus } from '../mind/connection';

const COLOURS: Readonly<Record<MindStatus, number>> = {
  online: 0x7fd18b, connecting: 0xe4c77f, unreachable: 0xa7a08c, no_invite: 0xa7a08c, offline: 0xa7a08c
};

export class MindStatusDot {
  readonly objects: Phaser.GameObjects.GameObject[];
  private readonly dot: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly detail: Phaser.GameObjects.Text;
  private readonly reconnect = new Reconnect();
  private shown: MindStatus | null = null;
  private busy = false;

  /** `x, y` is the dot's centre; the label sits to its left and the detail below the HUD at `detailY`. */
  constructor(scene: Phaser.Scene, private readonly x: number, private readonly y: number, detailY: number) {
    this.dot = scene.add.graphics();
    this.label = scene.add.text(x - 9, y, '', { fontFamily: FAMILY_BODY, fontSize: '12px', color: '#d9cfb4', resolution: RENDER_SCALE }).setOrigin(1, 0.5);
    this.detail = scene.add.text(x + 6, detailY, '', {
      fontFamily: FAMILY_BODY, fontSize: '13px', color: '#fff0ce', backgroundColor: '#28372dee', padding: { x: 8, y: 4 },
      wordWrap: { width: 260 }, resolution: RENDER_SCALE
    }).setOrigin(1, 0).setDepth(50).setVisible(false);
    const hit = scene.add.rectangle(x - 46, y, 64, 20, 0x000000, 0).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => this.detail.setText(statusDetail(getMind().status)).setVisible(true));
    hit.on('pointerout', () => this.detail.setVisible(false));
    hit.on('pointerup', () => { if (getMind().status !== 'online') this.retry(); });
    this.objects = [this.dot, this.label, this.detail, hit];
  }

  /** Every frame: redraw when the status changes, and retry gently while the server is unreachable. */
  update(now: number): void {
    const mind = getMind();
    const status = mind.status;
    if (this.reconnect.due(now, status)) this.retry();
    if (status === this.shown) return;
    this.shown = status;
    this.dot.clear().fillStyle(COLOURS[status], 1).fillCircle(this.x, this.y, 4)
      .lineStyle(1, 0x1f2a22, 0.8).strokeCircle(this.x, this.y, 4);
    this.label.setText(statusLabel(status));
    if (this.detail.visible) this.detail.setText(statusDetail(status));
  }

  private retry(): void {
    if (this.busy) return;
    this.busy = true;
    void getMind().reconnect().finally(() => { this.busy = false; });
  }
}
