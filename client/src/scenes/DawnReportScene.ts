import { openSurvey } from './SurveyScene';
import { Portrait } from "../dialogue/portrait";
import { portraitArtId, portraitLook } from "../dialogue/portraitModel";
import { findCard } from "../world/roster";
import Phaser from 'phaser';
import type { Press } from '@monde/shared';
import type { Clock } from '../sim/clock';
import { frontPage, printTime } from '../press/model';
import { FAMILY_BODY, FAMILY_DISPLAY, GAME_WIDTH, GAME_HEIGHT } from '../util/constants';
import { openPeople } from './PeopleScene';
import { reportDue } from '../finale/state';
import type { ReportBody } from '@monde/shared';
import { WITHDRAWN, markReported, printPaper, type PrintedItem } from '../press/report';
import { getFriendship, updateFriendship } from './friendship';
import { getMind } from '../mind/api';
import { amendLastSave } from '../save/runtime';

const POLL_NAME = { fellow: 'The Fellow', vane: 'Mr. Vane', moss: 'Old Moss' } as const;
/** The Straw Poll in print: three ruled bars, the beans and the margin, and one resident in their own words. */
function drawPollBox(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, poll: NonNullable<Press['poll']>, x: number, y: number): void {
  const ink = '#30291f';
  const t = (tx: number, ty: number, s: string, size: number, o: { italic?: boolean; bold?: boolean; width?: number } = {}) => scene.add.text(tx, ty, s, {
    fontFamily: FAMILY_BODY, fontSize: `${size}px`, color: ink, fontStyle: [o.italic ? 'italic' : '', o.bold ? 'bold' : ''].join(' ').trim() || 'normal',
    ...(o.width ? { wordWrap: { width: o.width } } : {})
  });
  g.lineBetween(x - 16, 280, x - 16, 480);
  t(x, y, 'THE STRAW POLL', 20, { bold: true });
  (['fellow', 'vane', 'moss'] as const).forEach((c, i) => {
    const yy = y + 34 + i * 30;
    t(x, yy, POLL_NAME[c], 16, { bold: poll.leader === c });
    g.strokeRect(x + 110, yy + 3, 170, 14);
    g.fillStyle(0x30291f, poll.leader === c ? 0.85 : 0.45).fillRect(x + 110, yy + 3, (170 * poll.percent[c]) / 100, 14);
    t(x + 290, yy, `${poll.percent[c]}%`, 16, { bold: poll.leader === c });
  });
  t(x, y + 128, `${poll.ballots} beans at the Bloom Fair · ±${poll.margin} points`, 13, { italic: true });
  const q = poll.quotes[0];
  if (q) t(x, y + 150, `“${q.text}” (${q.from})`, 14, { italic: true, width: 355 }).setMaxLines(3);
}
export const PAPER_PENDING = 'monde.press.pending';
interface Open { host: string; clock: Clock; paper: Press; seed: number; archive?: boolean }
export function openPaper(host: Phaser.Scene, data: Omit<Open, 'host'>): void {
  if (!host.scene.get('DawnReport')) host.scene.add('DawnReport', DawnReportScene, false);
  if (!host.scene.isActive('DawnReport')) host.scene.launch('DawnReport', { ...data, host: host.scene.key });
}
/** A Report control's armed state lasts this long before it reads "Report" again (GDD-GAP: §9.13 has no confirm step). */
const ARM_MS = 4000;
const INK = '#30291f', FADED = '#7a6a52', ARMED = '#8a2e1f';
/** New words for a control, with its hit area resized to them (Phaser keeps the first text's size otherwise). */
function relabel(label: Phaser.GameObjects.Text, text: string, color: string, style: string): void {
  label.setText(text).setColor(color).setFontStyle(style);
  (label.input?.hitArea as Phaser.Geom.Rectangle | undefined)?.setTo(0, 0, label.width, label.height);
}
/** One Report control on the page: the item it withdraws, and how to withdraw it in print. */
interface Control { key: string; report: ReportBody; label: Phaser.GameObjects.Text; withdraw(): void; armed: boolean; disarm?: Phaser.Time.TimerEvent }

export class DawnReportScene extends Phaser.Scene {
  private opened!: Open;
  private controls: Control[] = [];
  private focus = -1;
  private closed = false;
  private toastText!: Phaser.GameObjects.Text;
  constructor() { super('DawnReport'); }
  init(data: Open): void { this.opened = data; this.controls = []; this.focus = -1; this.closed = false; }
  create(): void {
    const { clock, seed } = this.opened, host = this.scene.get(this.opened.host);
    clock.pause('paper'); host.input.enabled = false; if (host.input.keyboard) host.input.keyboard.enabled = false;
    this.scene.bringToTop();
    // §9.13: what the player already reported stays withdrawn; the model's other items carry a small Report control.
    const printed = printPaper(this.opened.paper, getFriendship(this.registry).reported);
    const paper = printed.paper;
    this.add.rectangle(0,0,GAME_WIDTH,GAME_HEIGHT,0xece2c8).setOrigin(0).setInteractive();
    const text = (x: number,y: number,t: string,size: number,width = 1100) => this.add.text(x,y,t,{ fontFamily: FAMILY_BODY, fontSize: `${size}px`, color: INK, wordWrap: { width } });
    const { masthead: m } = frontPage(paper,seed);
    text(420,22,'The Lantern',58).setFontFamily(FAMILY_DISPLAY);
    text(58,92,`Day ${m.day} · ${m.season} · ${m.weather} · Wind from ${m.wind} · Sunrise ${printTime(m.sunrise)} · Sunset ${printTime(m.sunset)}`,17);
    text(58,119,`LOW WATER ${m.tides.lows.map(printTime).join(' / ')}     HIGH WATER ${m.tides.highs.map(printTime).join(' / ')}`,16);
    const g = this.add.graphics().lineStyle(2,0x30291f); g.lineBetween(55,150,1225,150);
    const headline = text(58,164,paper.headline,29).setMaxLines(2), dek = text(58,232,paper.dek,17);
    this.control(printed.front, 1225, 234, () => { headline.setText(WITHDRAWN.headline); dek.setText(WITHDRAWN.dek); });
    // G-11: the Straw Poll takes the third column on the morning after the Bloom Fair.
    const poll = paper.poll;
    paper.stories.slice(0, poll ? 2 : 3).forEach((s,i) => {
      const x = 58 + i * 390; if (i) g.lineBetween(x-16,280,x-16,480);
      const title = text(x,280,s.title,22,355).setMaxLines(2), body = text(x,336,s.text,17,355).setMaxLines(6);
      this.control(printed.stories[i]!, x + 355, 464, () => { title.setText(WITHDRAWN.title); body.setText(WITHDRAWN.story); });
    });
    if (poll) drawPollBox(this, g, poll, 838, 280);
    // Small engraved lantern: ink hatch marks and simple cut lines, never a fabricated news photograph.
    g.strokeRect(1150,28,35,48).lineBetween(1150,28,1167,15).lineBetween(1167,15,1185,28);
    for (let x=1155;x<1185;x+=6) g.lineBetween(x,35,x,70);
    const town = paper.ledger;
    if (town) text(58,490,`TOWN LEDGER  ${Object.entries(town.pillars).map(([k,v]) => `${k} ${v.toFixed(1)} ${v > town.dayStart[k as keyof typeof town.pillars] ? '↑' : v < town.dayStart[k as keyof typeof town.pillars] ? '↓' : '→'}`).join(' · ')}\nCensus ${town.census} · Appeal ${town.appeal.toFixed(1)} · Fund ${town.fund} coins`,16);
    // Letters to the Lantern, one by one so each letter a resident wrote can be reported.
    const letters = (x: number, width: number) => {
      text(x,553,'LETTERS TO THE LANTERN',15,width);
      if (!paper.letters.length) { text(x,571,'The letters desk is open.',15,width); return; }
      // The block keeps its six lines: one letter may take five, two take two each.
      let y = 571;
      const lines = paper.letters.length === 1 ? 5 : 2;
      paper.letters.forEach((l,i) => {
        const shown = printed.letters[i]!.withdrawn ? l.text : `${l.from}: ${l.text}`;
        const line = text(x,y,shown,15,width - 64).setMaxLines(lines);
        this.control(printed.letters[i]!, x + width, y, () => line.setText(WITHDRAWN.letter));
        y += Math.min(line.getWrappedText(shown).length, lines) * 18 + 4;
      });
    };
    // §6.6: comings and goings, each with the newcomer's (or the leaver's) portrait and one line (G-02).
    const movers = paper.movement_residents ?? [];
    if (paper.movements.length) {
      text(58,553,`NOTICES\n${paper.notices.join('\n')}`,15,360).setMaxLines(6);
      text(440,553,'COMINGS AND GOINGS',15,400);
      paper.movements.slice(0,3).forEach((line,i) => {
        const y = 578 + i * 40, card = movers[i] ? findCard(movers[i]!) : undefined;
        if (card) {
          const portrait = new Portrait(this,{ residentId:portraitArtId(card),look:portraitLook(card,0x66543d),x:440,y:y - 4,art:true });
          portrait.root.setScale(0.17); portrait.setExpression('warm',true);
          this.events.once('shutdown',() => portrait.destroy());
        }
        text(488,y + 2,line,13,366).setMaxLines(2);
      });
      letters(880,340);
    } else {
      text(58,553,`NOTICES\n${paper.notices.join('\n')}`,15,550).setMaxLines(6);
      letters(660,550);
    }
    text(450,682,this.controls.length ? 'Tap or Enter · Tab: Report · Keep in Journal → Today → Papers' : 'Tap or Enter · Keep in Journal → Today → Papers',15);
    this.toastText = text(GAME_WIDTH / 2,656,'',15,900).setOrigin(0.5,0).setAlign('center').setAlpha(0).setFontStyle('italic');
    // The morning Spring ends, the End-of-Spring report follows the paper (finale/attach.ts) instead of the People page.
    const close = () => { if (this.closed) return; this.closed = true; this.scene.stop(); if (!this.opened.archive && openSurvey(host, clock, 'day7')) return; if (!this.opened.archive && !reportDue(this.registry, clock.day)) openPeople(host,clock,'Today'); };
    this.input.on('pointerup',close);
    // Keys: Tab / ← → pick a Report control, Enter presses it (none picked: Enter closes), Esc lets go of it, then closes.
    const keys = this.input.keyboard;
    const pick = (step: (e: KeyboardEvent) => number) => (e: KeyboardEvent) => { if (!this.controls.length) return; e.preventDefault(); this.moveFocus(step(e)); };
    keys?.on('keydown-TAB', pick(e => e.shiftKey ? -1 : 1)); keys?.on('keydown-RIGHT', pick(() => 1)); keys?.on('keydown-LEFT', pick(() => -1));
    // A held Enter repeats: it never arms and confirms a report in one press.
    keys?.on('keydown-ENTER', (e?: KeyboardEvent) => { const c = this.controls[this.focus]; if (c) { if (!e?.repeat) this.activate(c); } else close(); });
    keys?.on('keydown-ESC', () => { if (this.focus >= 0) this.moveFocus(0); else close(); });
    this.events.once('shutdown',() => { this.closed = true; clock.resume('paper'); host.input.enabled = true; if (host.input.keyboard) { host.input.keyboard.enabled = true; host.input.keyboard.resetKeys(); } });
  }

  /** A small "Report" at (x, y), right-aligned, for a model-written item still in print. */
  private control(item: PrintedItem, x: number, y: number, withdraw: () => void): void {
    if (!item.report || !item.key) return;
    const label = this.add.text(x, y, 'Report', { fontFamily: FAMILY_BODY, fontSize: '13px', color: FADED, fontStyle: 'italic', padding: { x: 3, y: 1 } })
      .setOrigin(1, 0).setInteractive({ useHandCursor: true });
    const c: Control = { key: item.key, report: item.report, label, withdraw, armed: false };
    label.on('pointerover', () => { if (!c.armed) label.setColor(INK); });
    label.on('pointerout', () => { if (!c.armed) label.setColor(FADED); });
    // The page closes on any other tap, so the control keeps its own.
    label.on('pointerup', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => { event.stopPropagation(); this.activate(c); });
    this.controls.push(c);
  }

  /** Tab order through the controls; 0 clears the focus. */
  private moveFocus(step: number): void {
    const n = this.controls.length;
    this.focus = step === 0 || !n ? -1 : this.focus < 0 ? (step > 0 ? 0 : n - 1) : (this.focus + step + n) % n;
    this.highlight();
  }

  private highlight(): void {
    this.controls.forEach((c, i) => c.label.setBackgroundColor(i === this.focus ? '#d9cba6' : ''));
  }

  /** First press arms ("Confirm report"); the second withdraws the item at once and sends the report (§9.13). */
  private activate(c: Control): void {
    if (!c.armed) {
      c.armed = true; relabel(c.label, 'Confirm report', ARMED, 'bold italic');
      c.disarm = this.time.delayedCall(ARM_MS, () => { c.armed = false; relabel(c.label, 'Report', FADED, 'italic'); });
      return;
    }
    c.disarm?.remove();
    c.withdraw();
    const at = this.controls.indexOf(c);
    this.controls.splice(at, 1); c.label.destroy();
    // Keyboard focus stays on the same control, or moves on from this one (none left: Enter closes the paper again).
    if (this.focus > at) this.focus--;
    else if (this.focus === at) this.focus = this.controls.length ? Math.min(at, this.controls.length - 1) : -1;
    this.highlight();
    updateFriendship(this.registry, s => markReported(s, c.key));
    void amendLastSave([c.key]).catch(error => console.warn('[report] the save was not amended', error));
    this.toast('Withdrawn. Sending the report…');
    void getMind().report(c.report).then(saved => {
      if (!this.closed) this.toast(saved ? 'Thanks. The Lantern withdrew it and sent it for review.' : 'Couldn’t send the report. The item stays withdrawn.');
    });
  }

  private toast(message: string): void {
    this.tweens.killTweensOf(this.toastText);
    this.toastText.setText(message).setAlpha(1);
    this.tweens.add({ targets: this.toastText, alpha: 0, delay: 2200, duration: 400 });
  }
}
