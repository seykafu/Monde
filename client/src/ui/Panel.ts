import Phaser from "phaser";
import { COLORS } from "../util/constants";

// A reusable parchment / steel UI panel — Graphics-based, recolorable.
export interface PanelStyle {
  fillTop: number;
  fillBottom: number;
  edge: number;
  edgeBright: number;
  cornerInset: number;
  alpha?: number;
}

export const PARCHMENT_STYLE: PanelStyle = {
  fillTop: 0x1a1c2a,
  fillBottom: 0x0c0d18,
  edge: 0x322f24,
  edgeBright: COLORS.gold,
  cornerInset: 6,
  alpha: 0.92
};

export const drawPanel = (
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  style: PanelStyle = PARCHMENT_STYLE
): void => {
  g.clear();
  g.fillGradientStyle(style.fillTop, style.fillTop, style.fillBottom, style.fillBottom, style.alpha ?? 1);
  g.fillRect(x, y, w, h);
  g.lineStyle(1, style.edge, 1);
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  // Inner highlight — slightly stronger gold rule for chrome polish.
  g.lineStyle(1, style.edgeBright, 0.45);
  g.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
  // Hairline gold inset — adds a subtle "framed" look.
  g.lineStyle(1, style.edgeBright, 0.18);
  g.strokeRect(x + 5.5, y + 5.5, w - 11, h - 11);
  // Corner accents
  const ci = style.cornerInset;
  g.lineStyle(1, style.edgeBright, 1);
  g.beginPath();
  g.moveTo(x + 2, y + 2 + ci);
  g.lineTo(x + 2, y + 2);
  g.lineTo(x + 2 + ci, y + 2);
  g.moveTo(x + w - 2 - ci, y + 2);
  g.lineTo(x + w - 2, y + 2);
  g.lineTo(x + w - 2, y + 2 + ci);
  g.moveTo(x + 2, y + h - 2 - ci);
  g.lineTo(x + 2, y + h - 2);
  g.lineTo(x + 2 + ci, y + h - 2);
  g.moveTo(x + w - 2 - ci, y + h - 2);
  g.lineTo(x + w - 2, y + h - 2);
  g.lineTo(x + w - 2, y + h - 2 - ci);
  g.strokePath();
};

export const makePanel = (
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  style?: PanelStyle
): Phaser.GameObjects.Graphics => {
  const g = scene.add.graphics();
  drawPanel(g, x, y, w, h, style);
  return g;
};
