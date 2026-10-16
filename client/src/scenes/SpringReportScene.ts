// The End-of-Spring report and "To be continued" (MVP G-11; MVP_PLAN §11: "the Straw Poll and End-of-Spring report close
// the run"). Opened over ZoneScene by finale/attach.ts on the morning after the Bloom Fair, once the Lantern (with the
// poll) has been read. Page one is the Spring on one sheet of the Ledger's paper (finale/report.ts); page two is
// "To be continued — Summer in Monde", with the choice to keep wandering (free play, no new story beats) or go back to
// the title. Opening it saves the "End of Spring" checkpoint, so the save carries over.
import Phaser from 'phaser';
import { emptyRiddles, firstArrival, percentages, type SavedRiddles, type StrawPollRecord } from '@monde/shared';
import { playSfx } from '../audio/Sfx';
import { finishSaving, requestCheckpoint } from '../save/runtime';
import type { Clock } from '../sim/clock';
import { flagsOf, projectsOf } from '../projects/runtime';
import { scufflesOf } from '../scuffles/runtime';
import { HeartRowView } from '../ui/hearts';
import { FAMILY_BODY, FAMILY_DISPLAY, FAMILY_HEADING, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import { findCard } from '../world/roster';
import { springReport, type SpringReport } from '../finale/report';
import { REPORT_DAY, finaleOf, updateFinale } from '../finale/state';
import { getFriendship, regardFor, townNames } from './friendship';
import { PILLAR_COLOR, drawPillarIcon, getTown } from './TownLedgerScene';

export const SPRING_REPORT_SCENE = 'SpringReport';
/** The checkpoint the report saves (save/slots.ts checkpointSlot): "End of Spring". */
export const END_OF_SPRING = 'end_of_spring';

interface ReportOpen { host: string; clock: Clock }

const PAPER = 0xf2e8d0, PAPER_EDGE = 0xe3d4b0, BRASS = 0xa67c2e, BRASS_LIGHT = 0xd9b45e, INK = 0x2b2219;
const INK_CSS = '#2b2219', MUTED = '#6f6150', BRASS_CSS = '#8a6a24', UP_CSS = '#005a8c', DOWN_CSS = '#b5461f';
const CREAM = '#fff0ce';
const PX = 70, PY = 26, PW = GAME_WIDTH - 140, PH = GAME_HEIGHT - 52;
const COL = [PX + 40, PX + 400, PX + 760] as const, COL_W = 330;
const PILLAR_NAME = { prosperity: 'Prosperity', safety: 'Safety', spirit: 'Spirit', charm: 'Charm' } as const;
const CANDIDATE_NAME = { fellow: 'The Fellow', vane: 'Mr. Vane', moss: 'Old Moss' } as const;

/** Open the report over `host` (once: it marks the finale's reportDay). */
export function openSpringReport(host: Phaser.Scene, clock: Clock): void {
  if (!host.scene.get(SPRING_REPORT_SCENE)) host.scene.add(SPRING_REPORT_SCENE, SpringReportScene, false);
  if (host.scene.isActive(SPRING_REPORT_SCENE)) return;
  host.scene.launch(SPRING_REPORT_SCENE, { host: host.scene.key, clock } satisfies ReportOpen);
}

const nameOf = (id: string): string => townNames()[id] ?? findCard(id)?.name ?? id;

/** A white disc fading to nothing (tinted and added for a lamp's glow). */
function softGlow(scene: Phaser.Scene): string {
  const key = 'finale-soft-glow';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 256, 256);
  if (!tex) return key;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  tex.refresh();
  return key;
}
const fmt = (v: number): string => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');

export class SpringReportScene extends Phaser.Scene {
  private open!: ReportOpen;
  private page: 'report' | 'continue' = 'report';
  private layer!: Phaser.GameObjects.Container;
  private choices: { text: Phaser.GameObjects.Text; run(): void }[] = [];
  private focus = 0;
  private busy = false;

  constructor() { super(SPRING_REPORT_SCENE); }

  init(data: ReportOpen): void { this.open = data; this.page = 'report'; this.choices = []; this.focus = 0; this.busy = false; }

  create(): void {
    const r = this.registry, clock = this.open.clock;
    this.scene.bringToTop();
    this.pauseWorld(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.pauseWorld(false));
    // Spring has been seen: the report shows once (and the save that carries over is written now).
    updateFinale(r, s => ({ ...s, reportDay: Math.max(REPORT_DAY, clock.day) }));
    void requestCheckpoint(END_OF_SPRING).catch(error => console.warn('[finale] the End of Spring checkpoint failed', error));
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x10140f, 0.66).setOrigin(0).setInteractive().on('pointerup', () => { if (this.page === 'report') this.turn(); });
    this.layer = this.add.container(0, 0);
    this.drawReport(this.report());
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 260 });
  }

  private report(): SpringReport {
    const r = this.registry, town = getTown(r)!;
    const first = firstArrival(town.people);
    return springReport({
      day: this.open.clock.day, town, projects: projectsOf(r), scuffles: scufflesOf(r), friendship: getFriendship(r),
      riddles: (r.get('monde.riddles') as SavedRiddles | undefined) ?? emptyRiddles(),
      regard: id => regardFor(r, id), name: nameOf, flags: flagsOf(r), poll: finaleOf(r).poll,
      firstArrival: first ? { name: nameOf(first.card.id), day: first.arrived_day } : null
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.busy) return;
    if (this.page === 'report') {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); this.turn(); }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') { e.preventDefault(); this.setFocus((this.focus + 1) % this.choices.length); return; }
    if (/^[12]$/.test(e.key)) { this.choices[Number(e.key) - 1]?.run(); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.choices[this.focus]?.run(); }
  }

  private text(x: number, y: number, s: string, size: number, o: { color?: string; family?: string; italic?: boolean; bold?: boolean; align?: 'left' | 'center' | 'right'; wrap?: number; lines?: number } = {}): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, s, {
      fontFamily: o.family ?? FAMILY_BODY, fontSize: `${size}px`, color: o.color ?? INK_CSS, resolution: RENDER_SCALE,
      fontStyle: [o.italic ? 'italic' : '', o.bold ? 'bold' : ''].join(' ').trim() || 'normal',
      ...(o.wrap ? { wordWrap: { width: o.wrap } } : {})
    }).setOrigin(o.align === 'center' ? 0.5 : o.align === 'right' ? 1 : 0, 0);
    if (o.lines) t.setMaxLines(o.lines);
    this.layer.add(t);
    return t;
  }

  private header(x: number, y: number, s: string, w = COL_W): void {
    this.text(x, y, s, 15, { family: FAMILY_HEADING, color: BRASS_CSS, bold: true }).setLetterSpacing(2);
    const g = this.add.graphics();
    g.fillStyle(BRASS, 0.7).fillRect(x, y + 22, w, 1.5);
    this.layer.add(g);
  }

  // ── Page one: the Spring on one sheet ─────────────────────────────────────

  private drawReport(rep: SpringReport): void {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.35).fillRoundedRect(PX + 6, PY + 8, PW, PH, 10);
    g.fillStyle(BRASS, 1).fillRoundedRect(PX - 6, PY - 6, PW + 12, PH + 12, 12);
    g.lineStyle(1.5, BRASS_LIGHT, 0.9).strokeRoundedRect(PX - 4, PY - 4, PW + 8, PH + 8, 11);
    g.fillGradientStyle(PAPER, PAPER, PAPER_EDGE, PAPER_EDGE, 1).fillRect(PX, PY, PW, PH);
    g.lineStyle(1, BRASS, 0.5).strokeRect(PX + 10, PY + 10, PW - 20, PH - 20);
    g.fillStyle(INK, 1).fillRect(PX + 40, PY + 84, PW - 80, 2.5).fillRect(PX + 40, PY + 89, PW - 80, 1);
    this.layer.add(g);
    this.text(GAME_WIDTH / 2, PY + 18, 'Spring in Monde', 42, { family: FAMILY_DISPLAY, align: 'center' });
    this.text(GAME_WIDTH / 2, PY + 64, `The End-of-Spring report  ·  Days 1–${rep.days}  ·  the Thaw`, 16, { italic: true, color: MUTED, align: 'center' });

    // The town.
    let y = PY + 108;
    this.header(COL[0], y, 'THE TOWN');
    y += 34;
    const icons = this.add.graphics();
    this.layer.add(icons);
    for (const row of rep.pillars) {
      drawPillarIcon(icons, row.pillar, COL[0] + 11, y + 11, 9, PILLAR_COLOR[row.pillar], 0xf2e8d0);
      const d = row.now - row.start;
      this.text(COL[0] + 30, y, PILLAR_NAME[row.pillar], 17);
      this.text(COL[0] + 150, y, `${fmt(row.start)} → ${fmt(row.now)}`, 17);
      this.text(COL[0] + COL_W, y, d >= 0.05 ? `▲ ${fmt(d)}` : d <= -0.05 ? `▼ ${fmt(-d)}` : '–', 16, { align: 'right', color: d >= 0.05 ? UP_CSS : d <= -0.05 ? DOWN_CSS : MUTED });
      y += 28;
    }
    y += 6;
    this.text(COL[0], y, 'Appeal', 17); this.text(COL[0] + 150, y, `${fmt(rep.appeal.start)} → ${fmt(rep.appeal.now)}`, 17);
    y += 26;
    this.text(COL[0], y, 'Census', 17); this.text(COL[0] + 150, y, `${rep.census.start} → ${rep.census.now}`, 17);
    y += 28;
    const came = rep.arrivals.people ? `${rep.arrivals.people} newcomer${rep.arrivals.people === 1 ? '' : 's'} in ${rep.arrivals.households} household${rep.arrivals.households === 1 ? '' : 's'}` : 'No newcomers yet';
    this.text(COL[0], y, `${came} · ${rep.departures ? `${rep.departures} left on the ferry` : 'nobody left'}.`, 14, { italic: true, color: MUTED, wrap: COL_W });

    // What the Fellow did.
    y = PY + 108;
    this.header(COL[1], y, 'WHAT YOU DID');
    y += 34;
    this.text(COL[1], y, 'Projects opened', 17, { bold: true });
    y += 24;
    const projects = rep.projects.length ? rep.projects : ['None yet. The Fund waits.'];
    const shown = projects.slice(0, 6);
    for (const p of shown) { this.text(COL[1] + 12, y, `· ${p}`, 15, { lines: 1, wrap: COL_W - 12 }); y += 21; }
    if (projects.length > shown.length) { this.text(COL[1] + 12, y, `and ${projects.length - shown.length} more`, 14, { italic: true, color: MUTED }); y += 21; }
    y += 8;
    this.text(COL[1], y, "Monde's Marks", 17, { bold: true }); this.text(COL[1] + COL_W, y, `${rep.marks.solved} of ${rep.marks.total}`, 17, { align: 'right' });
    y += 26;
    this.text(COL[1], y, 'Scuffles won', 17, { bold: true }); this.text(COL[1] + COL_W, y, rep.scuffles.fought ? `${rep.scuffles.won} of ${rep.scuffles.fought}` : 'none fought', 17, { align: 'right' });

    // Friends.
    y = PY + 108;
    this.header(COL[2], y, 'FRIENDS MADE');
    y += 34;
    if (!rep.friends.length) {
      this.text(COL[2], y, rep.met ? `You've talked with ${rep.met} resident${rep.met === 1 ? '' : 's'}. Nobody's a friend yet: there's always Summer.` : 'Nobody has heard your voice yet. There\'s always Summer.', 15, { italic: true, color: MUTED, wrap: COL_W });
    }
    const friends = rep.friends.slice(0, 7);
    for (const f of friends) {
      this.text(COL[2], y, f.name, 16, { lines: 1 });
      const row = new HeartRowView(this, COL[2] + 128, y + 10, 1.5, 1);
      row.setRegard(f.hearts * 10);
      this.layer.add(row.container);
      y += 25;
    }
    if (rep.friends.length > friends.length) this.text(COL[2], y, `and ${rep.friends.length - friends.length} more`, 14, { italic: true, color: MUTED });

    // The poll, the moments, the standing.
    const lower = PY + 400;
    this.header(COL[0], lower, 'THE SPRING STRAW POLL');
    this.drawPoll(rep.poll, COL[0], lower + 34);
    this.header(COL[1], lower, 'MOMENTS', COL_W * 2 + 30);
    let my = lower + 34;
    for (const m of rep.moments) {
      this.text(COL[1], my, `Day ${m.day}`, 15, { bold: true, color: BRASS_CSS });
      this.text(COL[1] + 64, my, m.text, 15, { wrap: COL_W * 2 - 34, lines: 2 });
      my += 26;
    }
    if (!rep.moments.length) this.text(COL[1], my, 'A quiet Spring. The town was watching anyway.', 15, { italic: true, color: MUTED });
    const g2 = this.add.graphics();
    g2.fillStyle(INK, 1).fillRect(PX + 40, PY + PH - 84, PW - 80, 1);
    this.layer.add(g2);
    this.text(GAME_WIDTH / 2, PY + PH - 74, `The Fellow's standing: ${rep.standing.title}.`, 20, { family: FAMILY_HEADING, align: 'center' });
    this.text(GAME_WIDTH / 2, PY + PH - 46, `${rep.standing.line}   ·   Enter: read on`, 14, { italic: true, color: MUTED, align: 'center' });
  }

  private drawPoll(poll: StrawPollRecord | null, x: number, y: number): void {
    if (!poll) { this.text(x, y, 'Sable never got her jars out.', 15, { italic: true, color: MUTED }); return; }
    const pct = percentages(poll.shares);
    const g = this.add.graphics();
    this.layer.add(g);
    (['fellow', 'vane', 'moss'] as const).forEach((c, i) => {
      const yy = y + i * 30;
      this.text(x, yy, CANDIDATE_NAME[c], 15, { bold: c === poll.leader });
      g.fillStyle(0xe6d9b8, 1).fillRect(x + 100, yy + 4, 170, 14);
      g.fillStyle(c === 'fellow' ? 0xa67c2e : c === 'vane' ? 0x6b5a7a : 0x3f6f73, 1).fillRect(x + 100, yy + 4, (170 * pct[c]) / 100, 14);
      this.text(x + COL_W, yy, `${pct[c]}%`, 15, { align: 'right', bold: c === poll.leader });
    });
    this.text(x, y + 94, `${poll.ballots} beans at the Bloom Fair, margin ±${Math.round(poll.margin * 100)} points.`, 13, { italic: true, color: MUTED, wrap: COL_W });
  }

  // ── Page two: to be continued ─────────────────────────────────────────────

  private turn(): void {
    if (this.page !== 'report' || this.busy) return;
    this.page = 'continue';
    playSfx('page_turn');
    this.tweens.add({ targets: this.layer, alpha: 0, duration: 260, onComplete: () => { this.layer.removeAll(true); this.layer.setAlpha(1); this.drawContinue(); } });
  }

  private drawContinue(): void {
    const g = this.add.graphics();
    g.fillStyle(0x0c100d, 0.97).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.layer.add(g);
    // One of the fair's oil lamps, still lit: the Spring's last light.
    const glow = this.add.image(GAME_WIDTH / 2, 262, softGlow(this)).setDisplaySize(520, 300).setTint(0xffb45e).setAlpha(0.32).setBlendMode(Phaser.BlendModes.ADD);
    const lamp = this.add.graphics();
    const lx = GAME_WIDTH / 2, ly = 262;
    lamp.fillStyle(0x6e5320, 1).fillRect(lx - 2, ly + 18, 4, 30).fillRect(lx - 12, ly + 46, 24, 4);
    lamp.fillStyle(0xa67c2e, 1).fillRect(lx - 11, ly - 16, 22, 34).fillTriangle(lx - 15, ly - 15, lx + 15, ly - 15, lx, ly - 30);
    lamp.fillStyle(0xffd27a, 1).fillRect(lx - 7, ly - 11, 14, 25);
    lamp.fillStyle(0xfff3d6, 1).fillEllipse(lx, ly + 2, 5, 11);
    this.layer.add([glow, lamp]);
    this.tweens.add({ targets: glow, alpha: 0.22, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.text(GAME_WIDTH / 2, 120, 'To be continued', 64, { family: FAMILY_DISPLAY, color: CREAM, align: 'center' });
    this.text(GAME_WIDTH / 2, 340, 'SUMMER IN MONDE', 22, { family: FAMILY_HEADING, color: '#e4c77f', align: 'center' }).setLetterSpacing(6);
    this.text(GAME_WIDTH / 2, 380, "Spring ends with the Bloom Fair. Your save carries over: when Summer comes to Monde it picks up from here, with every friend, every lamp and every bean in Sable's jars. A checkpoint called End of Spring is waiting in the Load list.",
      18, { color: '#e9dfc4', align: 'center', wrap: 760, italic: true }).setAlign('center');
    this.text(GAME_WIDTH / 2, 470, 'Until then the town is yours. The days go on; the story waits for Summer.', 16, { color: '#bfb59c', align: 'center', italic: true });
    const options: { label: string; run(): void }[] = [
      { label: 'Keep wandering', run: () => this.keepWandering() },
      { label: 'Return to the title', run: () => void this.toTitle() }
    ];
    this.choices = options.map((o, i) => {
      const t = this.text(GAME_WIDTH / 2, 530 + i * 46, o.label, 24, { color: CREAM, align: 'center', family: FAMILY_HEADING });
      t.setInteractive({ useHandCursor: true }).on('pointerover', () => this.setFocus(i)).on('pointerup', () => o.run());
      return { text: t, run: o.run };
    });
    this.setFocus(0);
  }

  private setFocus(i: number): void {
    this.focus = i;
    this.choices.forEach((c, k) => c.text.setColor(k === i ? '#e4c77f' : CREAM).setText(`${k === i ? '›  ' : ''}${c.text.text.replace(/^›\s+/, '')}`));
  }

  private keepWandering(): void {
    if (this.busy) return;
    this.busy = true;
    updateFinale(this.registry, s => ({ ...s, freePlay: true }));
    playSfx('click');
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 260, onComplete: () => this.scene.stop() });
  }

  private async toTitle(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    playSfx('click');
    await finishSaving();
    this.scene.stop(this.open.host);
    this.scene.start('Title');
  }

  private pauseWorld(paused: boolean): void {
    const host = this.scene.get(this.open.host);
    if (host?.input) {
      host.input.enabled = !paused;
      const keys = host.input.keyboard;
      if (keys) { keys.enabled = !paused; keys.resetKeys(); }
    }
    if (paused) this.open.clock.pause('report'); else this.open.clock.resume('report');
  }
}
