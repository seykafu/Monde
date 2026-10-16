import { Portrait } from "../dialogue/portrait";
import { portraitArtId, portraitLook } from "../dialogue/portraitModel";
import { findCard } from "../world/roster";
import Phaser from 'phaser';
import type { Press } from '@monde/shared';
import type { Clock } from '../sim/clock';
import { frontPage, printTime } from '../press/model';
import { FAMILY_BODY, FAMILY_DISPLAY, GAME_WIDTH, GAME_HEIGHT } from '../util/constants';
import { openPeople } from './PeopleScene';
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
    paper.stories.forEach((s,i) => { const x = 58 + i * 390; if (i) g.lineBetween(x-16,280,x-16,480); text(x,280,s.title,22,355).setMaxLines(2); text(x,336,s.text,17,355).setMaxLines(6); });
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
    const close = () => { if (closed) return; closed = true; this.scene.stop(); if (!this.opened.archive) openPeople(host,clock,'Today'); };
    this.input.on('pointerup',close); this.input.keyboard?.on('keydown-ENTER',close);
    this.events.once('shutdown',() => { clock.resume('paper'); host.input.enabled = true; if (host.input.keyboard) { host.input.keyboard.enabled = true; host.input.keyboard.resetKeys(); } });
  }
}
