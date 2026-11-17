import type Phaser from 'phaser';
import { directionRuns, openAfter } from './stageDirections';

type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;

/**
 * The VN panel's body text, with stage directions set in italics and a softer colour:
 * "(hands over a biscuit tin) Forty-one names." Stands in for the single Text the panel used to draw.
 *
 * Pages arrive pre-wrapped (ui/fitText.ts), so each wrapped line is laid out run by run: one single-line Text per
 * run, placed at the advance a multi-line Text would use, so a page with no directions sits exactly where it did.
 * Italic Garamond is narrower than roman, so a line wrapped at roman widths still fits. A line whose base style is
 * already italic (narration, "thinking") draws plain: there's nothing to set apart.
 */
export class StyledBody {
  /** What the scene adds to its layers and tweens (alpha). */
  readonly container: Phaser.GameObjects.Container;
  /** The base style the panel sets (setColor / setFontStyle), read back by StoryScene's measuring text. */
  readonly style: { fontStyle: string; color: string };
  private readonly runs: Phaser.GameObjects.Text[] = [];
  private readonly runStyle: TextStyle;
  private advance = 0;
  private value = '';
  private before = '';

  constructor(private readonly scene: Phaser.Scene, x: number, y: number, style: TextStyle, private readonly directionColour: string) {
    this.container = scene.add.container(x, y);
    const { wordWrap: _wrap, ...rest } = style;
    this.runStyle = rest;
    this.style = { fontStyle: style.fontStyle ?? 'normal', color: String(style.color ?? '#ffffff') };
    // One line's advance, as a multi-line Text lays them out (line height + lineSpacing).
    const probe = scene.make.text({ x: 0, y: 0, text: 'Ág', style: rest }, false);
    const one = probe.height;
    this.advance = probe.setText('Ág\nÁg').height - one;
    probe.destroy();
  }

  setAlpha(alpha: number): this {
    this.container.setAlpha(alpha);
    return this;
  }

  /**
   * Show `text` (a page, or as much of it as is typed). `before` is the line's earlier pages, so a direction that
   * opened on the last page stays italic on this one.
   */
  setText(text: string, before = ''): this {
    if (text === this.value && before === this.before) return this;
    this.value = text;
    this.before = before;
    this.layout();
    return this;
  }

  setColor(color: string): this {
    if (color === this.style.color) return this;
    this.style.color = color;
    this.layout();
    return this;
  }

  setFontStyle(fontStyle: string): this {
    if (fontStyle === this.style.fontStyle) return this;
    this.style.fontStyle = fontStyle;
    this.layout();
    return this;
  }

  private layout(): void {
    const styled = this.style.fontStyle !== 'italic';
    const lines = directionRuns(this.value, styled && openAfter(this.before));
    let used = 0;
    lines.forEach((line, row) => {
      const runs = styled ? line : [{ text: line.map(r => r.text).join(''), direction: false }];
      let x = 0;
      for (const run of runs) {
        if (!run.text) continue;
        const t = this.run(used++);
        const fontStyle = run.direction ? 'italic' : this.style.fontStyle;
        const color = run.direction ? this.directionColour : this.style.color;
        if (t.style.fontStyle !== fontStyle) t.setFontStyle(fontStyle);
        if (t.style.color !== color) t.setColor(color);
        t.setText(run.text).setPosition(x, row * this.advance).setVisible(true);
        x += t.width;
      }
    });
    for (let i = used; i < this.runs.length; i++) this.runs[i]!.setText('').setVisible(false);
  }

  private run(index: number): Phaser.GameObjects.Text {
    let t = this.runs[index];
    if (!t) {
      t = this.scene.make.text({ x: 0, y: 0, text: '', style: this.runStyle }, false);
      this.runs.push(t);
      this.container.add(t);
    }
    return t;
  }
}
