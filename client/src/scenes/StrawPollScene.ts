// The Straw Poll's card (MVP G-11; S10c "The Straw Poll"): Sable's three jam jars filling bean by bean, the shares with
// their honest margin, and three residents in their own words. Opened over StoryScene by its `strawPoll` presenter cue
// (finale/attach.ts openStrawPoll); resolves when the player reads on. Newsprint, in the Ledger's paper and ink.
import Phaser from 'phaser';
import { CANDIDATES, percentages, type Candidate, type QuoteBand, type StrawPollRecord } from '@monde/shared';
import { playSfx } from '../audio/Sfx';
import { Portrait } from '../dialogue/portrait';
import { portraitArtId, portraitLook } from '../dialogue/portraitModel';
import { rosterColour } from '../dialogue/panel';
import { findCard, rosterEntry } from '../world/roster';
import { FAMILY_BODY, FAMILY_DISPLAY, FAMILY_HEADING, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';

export const STRAW_POLL_SCENE = 'StrawPoll';
export const STRAW_POLL_CLOSED = 'monde:strawPollClosed';

export interface StrawPollQuote { id: string; band: QuoteBand; text: string }
export interface StrawPollOpen {
  poll: StrawPollRecord;
  quotes: readonly StrawPollQuote[];
  name(id: string): string;
  /** The resident's own words (a live {ai_line}); null keeps the written line. */
  ask?(id: string, band: QuoteBand): Promise<string | null>;
}

const PAPER = 0xf2e8d0, PAPER_EDGE = 0xe3d4b0, BRASS = 0xa67c2e, BRASS_LIGHT = 0xd9b45e, INK = 0x2b2219;
const INK_CSS = '#2b2219', MUTED = '#6f6150', RED_CSS = '#9a3b1f';
const X0 = 140, Y0 = 36, W = 1000, H = 648;
const JAR_X: Readonly<Record<Candidate, number>> = { fellow: 400, vane: 640, moss: 880 };
const JAR_TOP = 214, JAR_W = 124, JAR_H = 156;
const LABEL: Readonly<Record<Candidate, string>> = { fellow: 'THE FELLOW', vane: 'MR. VANE', moss: 'OLD MOSS' };
const NAME: Readonly<Record<Candidate, string>> = { fellow: 'The Fellow', vane: 'Mr. Vane', moss: 'Old Moss' };
const NOTE: Readonly<Record<Candidate, string>> = { fellow: 'if they stood', vane: 'he says he might', moss: 'he says he would' };
/** Bean rows inside a jar. Art tuning. */
const COLS = 9, ROW_H = 7;
const BEAN_MS = 2400;

function beanTexture(scene: Phaser.Scene): string {
  const key = 'poll-bean';
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x6b3f22).fillEllipse(6, 4, 11, 7);
  g.fillStyle(0xa8693b).fillEllipse(5, 3, 6, 3);
  g.generateTexture(key, 12, 8);
  g.destroy();
  return key;
}

export class StrawPollScene extends Phaser.Scene {
  private open!: StrawPollOpen;
  private done = false;
  private finished = false;
  private skip: (() => void) | null = null;

  constructor() { super(STRAW_POLL_SCENE); }

  init(data: StrawPollOpen): void { this.open = data; this.done = false; this.finished = false; this.skip = null; }

  create(): void {
    this.scene.bringToTop();
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0c100d, 0.62).setOrigin(0).setInteractive().on('pointerup', () => this.advance());
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); this.advance(); } });
    this.drawCard();
    const { poll } = this.open;
    const pct = percentages(poll.shares), margin = Math.round(poll.margin * 100);
    const text = (x: number, y: number, s: string, size: number, o: { color?: string; family?: string; italic?: boolean; bold?: boolean; origin?: number; wrap?: number } = {}) =>
      this.add.text(x, y, s, {
        fontFamily: o.family ?? FAMILY_BODY, fontSize: `${size}px`, color: o.color ?? INK_CSS,
        fontStyle: [o.italic ? 'italic' : '', o.bold ? 'bold' : ''].join(' ').trim() || 'normal', resolution: RENDER_SCALE,
        ...(o.wrap ? { wordWrap: { width: o.wrap } } : {})
      }).setOrigin(o.origin ?? 0.5, 0);
    text(GAME_WIDTH / 2, Y0 + 22, 'THE LANTERN  ·  BLOOM FAIR STRAW POLL', 14, { family: FAMILY_HEADING, color: MUTED }).setLetterSpacing(3);
    text(GAME_WIDTH / 2, Y0 + 44, 'If Monde voted tomorrow', 44, { family: FAMILY_DISPLAY });
    text(GAME_WIDTH / 2, Y0 + 102, `${poll.ballots} beans in three of Odile's jam jars  ·  margin of error ±${margin} points`, 17, { italic: true, color: MUTED });
    const g = this.add.graphics();
    g.fillStyle(INK, 1).fillRect(X0 + 40, Y0 + 136, W - 80, 2).fillRect(X0 + 40, Y0 + 140, W - 80, 1);

    // The jars, then the beans dropping in, round the jars in a seeded-looking but fixed order.
    const counts: Record<Candidate, Phaser.GameObjects.Text> = {} as Record<Candidate, Phaser.GameObjects.Text>;
    const shares: Record<Candidate, Phaser.GameObjects.Text> = {} as Record<Candidate, Phaser.GameObjects.Text>;
    for (const c of CANDIDATES) {
      this.drawJar(JAR_X[c], c);
      text(JAR_X[c], JAR_TOP + JAR_H + 14, LABEL[c], 19, { family: FAMILY_HEADING, bold: true });
      text(JAR_X[c], JAR_TOP + JAR_H + 38, NOTE[c], 13, { italic: true, color: MUTED });
      shares[c] = text(JAR_X[c], JAR_TOP + JAR_H + 58, '', 34, { family: FAMILY_DISPLAY, color: c === poll.leader ? RED_CSS : INK_CSS });
      counts[c] = text(JAR_X[c], JAR_TOP + JAR_H + 100, '0 beans', 14, { color: MUTED });
    }
    const order: Candidate[] = [];
    const left = { ...poll.votes };
    while (left.fellow + left.vane + left.moss > 0) for (const c of CANDIDATES) if (left[c] > 0) { order.push(c); left[c]--; }
    const filled: Record<Candidate, number> = { fellow: 0, vane: 0, moss: 0 };
    const bean = beanTexture(this);
    const drop = (c: Candidate) => {
      const i = filled[c]++, col = i % COLS, row = Math.floor(i / COLS);
      const x = JAR_X[c] - JAR_W / 2 + 14 + col * ((JAR_W - 28) / (COLS - 1)) + ((row % 2) * 4 - 2);
      const y = JAR_TOP + JAR_H - 10 - row * ROW_H;
      const b = this.add.image(x, JAR_TOP - 20, bean).setAngle((i * 47) % 180).setDepth(2);
      this.tweens.add({ targets: b, y, duration: 260, ease: 'Quad.easeIn' });
      counts[c].setText(`${filled[c]} bean${filled[c] === 1 ? '' : 's'}`);
    };
    const reveal = () => {
      if (this.done) return;
      this.done = true;
      while (order.length) drop(order.shift()!);
      for (const c of CANDIDATES) shares[c].setText(`${pct[c]}%`).setAlpha(0);
      this.tweens.add({ targets: CANDIDATES.map(c => shares[c]), alpha: 1, duration: 300 });
      const inside = poll.leader !== 'tie' && pct[poll.leader] - Math.max(...CANDIDATES.filter(c => c !== poll.leader).map(c => pct[c])) <= margin;
      const lead = poll.leader === 'tie' ? 'Dead level at the jars.' : `${NAME[poll.leader]} leads${inside ? ', inside the margin of error' : ''}.`;
      text(GAME_WIDTH / 2, JAR_TOP + JAR_H + 124, lead, 18, { italic: true });
      playSfx('fair_cheer');
      this.showQuotes();
    };
    this.skip = reveal;
    const step = Math.max(8, BEAN_MS / Math.max(1, order.length));
    this.time.addEvent({ delay: step, repeat: order.length - 1, callback: () => {
      if (this.done) return;
      const c = order.shift();
      if (c) drop(c);
      if (!order.length) this.time.delayedCall(300, reveal);
    } });
    if (!order.length) this.time.delayedCall(300, reveal);
    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 220 });
  }

  /** Read on: the first press finishes the count; once everything is up, the next one closes the card. */
  private advance(): void {
    if (!this.done) { this.skip?.(); return; }
    if (this.finished) return;
    this.finished = true;
    playSfx('page_turn');
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 200, onComplete: () => this.scene.stop() });
  }

  private drawCard(): void {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.35).fillRoundedRect(X0 + 6, Y0 + 8, W, H, 10);
    g.fillStyle(BRASS, 1).fillRoundedRect(X0 - 6, Y0 - 6, W + 12, H + 12, 12);
    g.lineStyle(1.5, BRASS_LIGHT, 0.9).strokeRoundedRect(X0 - 4, Y0 - 4, W + 8, H + 8, 11);
    g.fillGradientStyle(PAPER, PAPER, PAPER_EDGE, PAPER_EDGE, 1).fillRect(X0, Y0, W, H);
    g.lineStyle(1, BRASS, 0.5).strokeRect(X0 + 10, Y0 + 10, W - 20, H - 20);
  }

  /** One of Odile's jam jars: glass, a brass lid, a pencilled paper label. */
  private drawJar(cx: number, c: Candidate): void {
    const g = this.add.graphics().setDepth(1);
    const x = cx - JAR_W / 2, y = JAR_TOP;
    g.fillStyle(0xdfe9e6, 0.35).fillRoundedRect(x, y, JAR_W, JAR_H, 18);
    g.lineStyle(2.5, 0x6f8784, 0.9).strokeRoundedRect(x, y, JAR_W, JAR_H, 18);
    g.lineStyle(2, 0xffffff, 0.6).lineBetween(x + 12, y + 22, x + 12, y + JAR_H - 26);
    g.fillStyle(BRASS, 1).fillRoundedRect(x + 8, y - 16, JAR_W - 16, 18, 5);
    g.fillStyle(BRASS_LIGHT, 1).fillRect(x + 12, y - 13, JAR_W - 24, 3);
    // The label sits low on the glass, under the beans' first rows: they fill up behind it.
    g.fillStyle(0xfaf3df, 0.92).fillRect(cx - 34, y + 44, 68, 26);
    g.lineStyle(1, INK, 0.5).strokeRect(cx - 34, y + 44, 68, 26);
    this.add.text(cx, y + 50, c === 'fellow' ? 'Fellow' : c === 'vane' ? 'Vane' : 'Moss', {
      fontFamily: FAMILY_BODY, fontSize: '14px', fontStyle: 'italic', color: INK_CSS, resolution: RENDER_SCALE
    }).setOrigin(0.5, 0).setDepth(3);
  }

  /** Three residents in their own words: a written line at once, replaced by their live one if it comes. */
  private showQuotes(): void {
    const quotes = this.open.quotes.slice(0, 3);
    const top = JAR_TOP + JAR_H + 160;
    const g = this.add.graphics();
    g.fillStyle(INK, 1).fillRect(X0 + 40, top - 12, W - 80, 1);
    if (!quotes.length) {
      this.add.text(GAME_WIDTH / 2, top + 30, 'Nobody you know well enough was at the trestle to give a quote.', {
        fontFamily: FAMILY_BODY, fontSize: '16px', fontStyle: 'italic', color: MUTED, resolution: RENDER_SCALE
      }).setOrigin(0.5, 0);
      return;
    }
    const colW = (W - 80) / quotes.length;
    quotes.forEach((q, i) => {
      const x = X0 + 40 + i * colW;
      const card = findCard(q.id);
      if (card) {
        const portrait = new Portrait(this, { residentId: portraitArtId(card), look: portraitLook(card, rosterColour(rosterEntry(q.id)?.index ?? 0)), x, y: top, art: true });
        portrait.root.setScale(0.24);
        portrait.setExpression(q.band === 'torn' ? 'thinking' : q.band === 'fellow_strong' || q.band === 'fellow' ? 'warm' : 'neutral', true);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => portrait.destroy());
      }
      this.add.text(x + 64, top + 4, this.open.name(q.id), {
        fontFamily: FAMILY_HEADING, fontSize: '17px', fontStyle: 'bold', color: INK_CSS, resolution: RENDER_SCALE
      });
      const line = this.add.text(x + 64, top + 28, `“${q.text}”`, {
        fontFamily: FAMILY_BODY, fontSize: '14px', fontStyle: 'italic', color: INK_CSS, resolution: RENDER_SCALE,
        wordWrap: { width: colW - 80 }, lineSpacing: 2
      }).setMaxLines(5).setAlpha(0);
      this.tweens.add({ targets: line, alpha: 1, duration: 260, delay: 160 * i });
      void this.open.ask?.(q.id, q.band).then(live => { if (live && line.active) line.setText(`“${live}”`); });
    });
    this.add.text(GAME_WIDTH / 2, Y0 + H - 28, 'Enter or click to read on', {
      fontFamily: FAMILY_BODY, fontSize: '13px', color: MUTED, resolution: RENDER_SCALE
    }).setOrigin(0.5, 0);
  }
}

/** Launch the card over `host` and resolve when the player reads on. */
export function showStrawPoll(host: Phaser.Scene, data: StrawPollOpen): Promise<void> {
  if (!host.scene.get(STRAW_POLL_SCENE)) host.scene.add(STRAW_POLL_SCENE, StrawPollScene, false);
  return new Promise(resolve => {
    host.scene.launch(STRAW_POLL_SCENE, data);
    host.scene.bringToTop(STRAW_POLL_SCENE);
    host.scene.get(STRAW_POLL_SCENE).events.once(Phaser.Scenes.Events.SHUTDOWN, () => resolve());
  });
}
