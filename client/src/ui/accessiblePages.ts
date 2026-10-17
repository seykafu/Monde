import Phaser from 'phaser';
import { accessibility } from '../accessibility/runtime';
import { reflowRows } from '../accessibility/layout';

/** Enlarged notebook bodies reflow and scroll inside the paper. Existing buttons remain interactive. */
export function accessiblePages(scene: Phaser.Scene, content: Phaser.GameObjects.Container): void {
  if (accessibility().textSize === 'normal') return;
  const top = 85, bottom = 650;
  const shape = scene.make.graphics({}, false).fillRect(100, top, 1080, bottom - top);
  const mask = shape.createGeometryMask();
  let first: Phaser.GameObjects.GameObject | undefined, scroll = 0, limit = 0;
  const layout = () => {
    if (first === content.list[0]) return;
    first = content.list[0]; scroll = 0; content.y = 0;
    if (accessibility().textSize === 'normal') { content.clearMask(); limit = 0; return; }
    content.setMask(mask);
    // Decoration stays on the paper; enlarged reading rows carry their own spacing.
    for (const child of content.list) if (child instanceof Phaser.GameObjects.Graphics) child.setVisible(false);
    const texts = content.list.filter(o => o instanceof Phaser.GameObjects.Text) as Phaser.GameObjects.Text[];
    for (const right of [false, true]) {
      const column = texts.filter(t => (t.x >= 640) === right).sort((a, b) => a.y - b.y || a.x - b.x);
      for (const [i, t] of column.entries()) {
        const edge = right ? 1160 : 620;
        // Origin-aware wrap keeps right-aligned amounts and centered datelines on paper.
        const width = t.originX === 1 ? t.x - (right ? 660 : 120) : t.originX === 0.5 ? Math.min(t.x - 120, 1160 - t.x) * 2 : edge - t.x;
        const next = column[i + 1];
        const available = next && next.y === t.y && next.x > t.x && t.originX === 0 ? Math.min(width, next.x - t.x - 8) : width;
        t.setWordWrapWidth(Math.max(20, Math.min(t.style.wordWrapWidth || available, available)), true);
      }
      const original = column.map(t => t.y);
      const rows = reflowRows(column.map(t => ({ y: t.y, height: t.height })));
      for (const child of content.list) {
        if (child instanceof Phaser.GameObjects.Text || child instanceof Phaser.GameObjects.Graphics || !('x' in child) || !('y' in child)) continue;
        const item = child as Phaser.GameObjects.Container;
        if ((item.x >= 640) !== right) continue;
        // Keep portraits, hearts and hit targets beside their original reading row.
        let nearest = 0;
        for (let i = 1; i < original.length; i++) if (Math.abs(original[i]! - item.y) < Math.abs(original[nearest]! - item.y)) nearest = i;
        if (original.length) item.y += rows[nearest]! - original[nearest]!;
      }
      column.forEach((t, i) => t.setY(rows[i]!));
    }
    limit = Math.max(0, ...texts.map(t => t.y + t.height - bottom));
    move(0);
  };
  const move = (dy: number) => {
    scroll = Phaser.Math.Clamp(scroll + dy, 0, limit); content.y = -scroll;
    for (const child of content.list) {
      if (!child.input || !('getBounds' in child)) continue;
      const bounds = (child as Phaser.GameObjects.Text).getBounds();
      child.input.enabled = bounds.top >= top && bounds.bottom <= bottom;
    }
  };
  const key = (e: KeyboardEvent) => { if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); move(e.key === 'PageDown' ? 300 : -300); } };
  const wheel = (_p: Phaser.Input.Pointer, _o: unknown, _x: number, dy: number) => move(dy);
  scene.events.on('postupdate', layout);
  scene.input.keyboard?.on('keydown', key); scene.input.on('wheel', wheel);
  const hint = scene.add.text(640, 662, 'Larger text: wheel or Page Up / Page Down to read', { fontSize: '14px', color: '#705740' }).setOrigin(.5).setVisible(accessibility().textSize !== 'normal');
  scene.events.once('shutdown', () => { scene.events.off('postupdate', layout); scene.input.keyboard?.off('keydown', key); scene.input.off('wheel', wheel); mask.destroy(); shape.destroy(); hint.destroy(); });
}
