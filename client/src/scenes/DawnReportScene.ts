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
export class DawnReportScene extends Phaser.Scene {
  private opened!: Open;
  constructor() { super('DawnReport'); }
  init(data: Open): void { this.opened = data; }
  create(): void {
    const { paper, clock, seed } = this.opened, host = this.scene.get(this.opened.host);
    clock.pause('paper'); host.input.enabled = false; if (host.input.keyboard) host.input.keyboard.enabled = false;
    this.scene.bringToTop();
    const ink = '#30291f';
    this.add.rectangle(0,0,GAME_WIDTH,GAME_HEIGHT,0xece2c8).setOrigin(0).setInteractive();
    const text = (x: number,y: number,t: string,size: number,width = 1100) => this.add.text(x,y,t,{ fontFamily: FAMILY_BODY, fontSize: `${size}px`, color: ink, wordWrap: { width } });
    const { masthead: m } = frontPage(paper,seed);
    text(420,22,'The Lantern',58).setFontFamily(FAMILY_DISPLAY);
    text(58,92,`Day ${m.day} · ${m.season} · ${m.weather} · Wind from ${m.wind} · Sunrise ${printTime(m.sunrise)} · Sunset ${printTime(m.sunset)}`,17);
    text(58,119,`LOW WATER ${m.tides.lows.map(printTime).join(' / ')}     HIGH WATER ${m.tides.highs.map(printTime).join(' / ')}`,16);
    const g = this.add.graphics().lineStyle(2,0x30291f); g.lineBetween(55,150,1225,150);
    text(58,164,paper.headline,29).setMaxLines(2); text(58,232,paper.dek,17);
    // G-11: the Straw Poll takes the third column on the morning after the Bloom Fair.
    const poll = paper.poll;
    paper.stories.slice(0, poll ? 2 : 3).forEach((s,i) => { const x = 58 + i * 390; if (i) g.lineBetween(x-16,280,x-16,480); text(x,280,s.title,22,355).setMaxLines(2); text(x,336,s.text,17,355).setMaxLines(6); });
    if (poll) drawPollBox(this, g, poll, 838, 280);
    // Small engraved lantern: ink hatch marks and simple cut lines, never a fabricated news photograph.
    g.strokeRect(1150,28,35,48).lineBetween(1150,28,1167,15).lineBetween(1167,15,1185,28);
    for (let x=1155;x<1185;x+=6) g.lineBetween(x,35,x,70);
    const town = paper.ledger;
    if (town) text(58,490,`TOWN LEDGER  ${Object.entries(town.pillars).map(([k,v]) => `${k} ${v.toFixed(1)} ${v > town.dayStart[k as keyof typeof town.pillars] ? '↑' : v < town.dayStart[k as keyof typeof town.pillars] ? '↓' : '→'}`).join(' · ')}\nCensus ${town.census} · Appeal ${town.appeal.toFixed(1)} · Fund ${town.fund} coins`,16);
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
      text(880,553,`LETTERS TO THE LANTERN\n${paper.letters.map(l => `${l.from}: ${l.text}`).join('\n') || 'The letters desk is open.'}`,15,340).setMaxLines(6);
    } else {
      text(58,553,`NOTICES\n${paper.notices.join('\n')}`,15,550).setMaxLines(6);
      text(660,553,`LETTERS TO THE LANTERN\n${paper.letters.map(l => `${l.from}: ${l.text}`).join('\n') || 'The letters desk is open.'}`,15,550).setMaxLines(6);
    }
    text(450,682,'Tap or Enter · Keep in Journal → Today → Papers',15);
    let closed = false;
    // The morning Spring ends, the End-of-Spring report follows the paper (finale/attach.ts) instead of the People page.
    const close = () => { if (closed) return; closed = true; this.scene.stop(); if (!this.opened.archive && openSurvey(host, clock, 'day7')) return; if (!this.opened.archive && !reportDue(this.registry, clock.day)) openPeople(host,clock,'Today'); };
    this.input.on('pointerup',close); this.input.keyboard?.on('keydown-ENTER',close); this.input.keyboard?.on('keydown-ESC',close);
    this.events.once('shutdown',() => { clock.resume('paper'); host.input.enabled = true; if (host.input.keyboard) { host.input.keyboard.enabled = true; host.input.keyboard.resetKeys(); } });
  }
}
