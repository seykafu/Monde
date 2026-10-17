import type Phaser from 'phaser';
import { SPRING_RIDDLES } from '@monde/shared';
import type { Clock } from '../sim/clock';
import { sfxCineChime } from '../audio/Sfx';
import { FAMILY_BODY, RENDER_SCALE } from '../util/constants';
import { marks, refreshHints, submitMark, homeHint, notebookHint } from './riddles';
import { riddle } from '../riddles/engine';
/** Extra pages drawn inside PeopleScene's existing two-page notebook. */
export class MarkPages {
  private input = ''; private feedback = ''; private editing = false; private page = 0;
  constructor(private scene: Phaser.Scene, private clock: Clock, private content: Phaser.GameObjects.Container, private redraw: () => void) {}
  key(e: KeyboardEvent): boolean {
    if (!this.editing) return false;
    if (e.key === 'Escape') { this.editing = false; this.redraw(); return true; }
    if (e.key === 'Enter') { this.submit(); return true; }
    if (e.key === 'Backspace') this.input = this.input.slice(0, -1);
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && this.input.length < 120) this.input += e.key;
    e.preventDefault(); this.redraw(); return true;
  }
  private text(x: number, y: number, value: string, size = 17, width = 440): Phaser.GameObjects.Text {
    const t = this.scene.add.text(x, y, value, { fontFamily: FAMILY_BODY, fontSize: `${size}px`, color: '#2b2219', wordWrap: { width }, resolution: RENDER_SCALE }); this.content.add(t); return t;
  }
  private button(x: number, y: number, label: string, action: () => void): void { this.text(x, y, label, 17).setInteractive({ useHandCursor: true }).on('pointerdown', action); }
  private submit(): void {
    const id = marks(this.scene.registry).selected; if (!id) return;
    const result = submitMark(this.scene.registry, this.clock, id, this.input);
    this.feedback = result === 'solved' ? '✦ The lantern catches the light. A place remembered.' : result === 'wrong' ? 'Not quite. There is time to think it over.' : 'This Mark is not ready yet.';
    if (result === 'solved') { sfxCineChime(); this.editing = false; this.scene.cameras.main.flash(250, 240, 210, 140, false); }
    this.input = ''; this.redraw();
  }
  draw(tab: 'Marks' | 'Today'): void {
    refreshHints(this.scene.registry, this.clock);
    const state = marks(this.scene.registry);
    if (tab === 'Today') {
      this.text(132, 155, `Day ${this.clock.day}`, 28);
      const hint = this.scene.registry.get('monde.story.hint') as { text?: string } | undefined;
      this.text(132, 210, hint?.text ?? 'Read a plaque, or spend a little time with a neighbour.');
      this.text(132, 350, state.headlines.filter(h => h.day === this.clock.day).map(h => h.text).join('\n\n'), 16);
      const upcoming = Object.entries(state.entries).filter(([,e]) => e.status === 'found');
      this.text(674, 155, 'Marks in mind', 26);
      this.text(674, 205, upcoming.map(([id,e]) => `${id} · ${e.hints ? `Hint ${e.hints} in your notes` : 'A nudge after one game hour'}`).join('\n\n') || 'No unanswered Marks yet.'); return;
    }
    const found = SPRING_RIDDLES.filter(r => state.entries[r.id]);
    found.slice(this.page * 8, this.page * 8 + 8).forEach((r,i) => this.button(132, 151 + i * 47, `${state.entries[r.id]!.status === 'solved' ? '✦' : '○'} ${r.id} · ${r.title}`, () => { state.selected = r.id; this.feedback = ''; this.input = ''; this.editing = false; this.redraw(); }));
    if (!found.length) this.text(132, 160, 'Small brass plaques, stamped with a lantern. Read one to begin your notes.');
    this.button(132, 550, '← Earlier', () => { this.page = Math.max(0, this.page - 1); this.redraw(); });
    this.button(310, 550, 'Later →', () => { if ((this.page + 1) * 8 < found.length) this.page++; this.redraw(); });
    this.button(132, 590, 'The Charter →', () => { state.selected = null; this.redraw(); });
    const r = state.selected ? riddle(state.selected) : undefined; const e = r ? state.entries[r.id] : undefined;
    if (!r || !e) {
      this.text(674, 85, 'The Commons Charter', 28);
      this.text(674, 145, found.filter(r => state.entries[r.id]?.status === 'solved' && r.fragment).map(r => r.fragment).join('\n\n') || 'The fragments will gather here.', 16); return;
    }
    const stamp = this.scene.add.graphics().lineStyle(2, 0xa67c2e).strokeCircle(1138, 104, 19);
    stamp.strokeRect(1130, 98, 16, 20).lineBetween(1130, 98, 1138, 91).lineBetween(1138, 91, 1146, 98).lineBetween(1138, 102, 1138, 114);
    this.content.add(stamp);
    if (this.feedback.startsWith('✦')) this.scene.tweens.add({ targets: stamp, alpha: 0.3, duration: 240, yoyo: true, repeat: 1 });
    this.text(674, 85, `${r.id} · ${r.district.replaceAll('_', ' ')}`, 24);
    this.text(674, 128, r.inscription + (r.chain === 'T' ? '' : '\n— A.M.  ✦'), 17);
    this.text(674, 305, r.hints.slice(0, e.hints).filter(Boolean).map((h,i) => `${i+1}. ${h}`).join('\n') || (e.status === 'solved' ? '' : 'A nudge will appear one game hour after finding this Mark.'), 14);
    if (e.status !== 'solved') {
      this.button(132, 630, e.hints === 2 ? 'Use a Notebook page' : 'Ponder at home · 10 Stamina', () => { this.feedback = (e.hints === 2 ? notebookHint(this.scene.registry, r.id) : homeHint(this.scene.registry, r.id)) ? 'A little clearer now.' : 'This hint is not available yet.'; this.redraw(); });
    }
    this.text(674, 430, `Your attempts: ${e.attempts.slice(-3).join(' · ') || 'None yet'}`, 14);
    if (e.status !== 'solved') {
      this.button(674, 480, this.editing ? `> ${this.input || 'Type your answer'} ▏` : 'Name the answer…', () => { this.editing = true; this.redraw(); });
      if (this.editing) this.button(674, 530, 'Enter · Check answer', () => this.submit());
    } else this.text(674, 475, `✦ ${r.answerLocation}`, 15);
    this.text(674, 575, this.feedback, 15);
  }
}
