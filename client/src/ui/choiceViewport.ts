import type Phaser from 'phaser';
import { focusScroll } from '../accessibility/layout';
interface Button { h: number; hit: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; bg: Phaser.GameObjects.Graphics; moveTo(y: number): void }
/** Overflow remains readable at full font size; wheel and keyboard focus scroll the same viewport. */
export function choiceViewport(scene: Phaser.Scene, buttons: Button[], bottom: number): (index: number) => void {
  const top = 20, first = Math.min(...buttons.map(b => b.hit.y));
  if (!Number.isFinite(first) || first >= top) return () => undefined;
  const positions = buttons.map(b => b.hit.y + top - first);
  const limit = top - first;
  let scroll = 0;
  const shape = scene.make.graphics({}, false).fillRect(0, top, 1280, bottom - top);
  const mask = shape.createGeometryMask();
  buttons.forEach(b => { b.bg.setMask(mask); b.label.setMask(mask); });
  const draw = () => buttons.forEach((b, i) => {
    const y = positions[i]! - scroll; b.moveTo(y);
    if (b.hit.input) b.hit.input.enabled = y >= top && y + b.h <= bottom;
  });
  const wheel = (_p: unknown, _o: unknown, _x: number, dy: number) => { scroll = Math.max(0, Math.min(limit, scroll + dy)); draw(); };
  scene.input.on('wheel', wheel);
  buttons[0]?.hit.once('destroy', () => { scene.input.off('wheel', wheel); mask.destroy(); shape.destroy(); });
  draw();
  return index => { const b = buttons[index]; if (!b) return; scroll = focusScroll(scroll, positions[index]!, b.h, top, bottom, limit); draw(); };
}
