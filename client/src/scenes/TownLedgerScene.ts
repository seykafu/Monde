// The Town Ledger (GDD §6.6, §18 Journal → Town Ledger; MVP G-01), the HUD Pillar strip, and the town's
// registry wiring.
//
// The town engine (src/town) is pure; this file is its Phaser side:
// - attachTown() keeps one TownState in the game registry (`monde.town`), created with the Day-1 numbers
//   alongside the clock, and runs the dawn pass (runDawn) whenever the clock's dawn fires. The latest
//   DawnReport goes in `monde.dawnReport` for the Dawn Report (M-10). Nothing is saved yet.
// - TownLedgerScene is opened over ZoneScene with L and closed with L or Esc. The clock is held for "ledger"
//   while it is open and the zone's input is paused, as the dialogue panel does. It shows the four Pillars with
//   today's change, census, Appeal with its Youth/Elder split and Momentum, homes, the Town Fund, and the
//   Option Clause gauge once the clause is known (§6.5).
// - PillarStrip is the small Pillar strip under the HUD clock (§18), toggled with P.
// Placeholder art in the brass / paper / newsprint direction (§16.6): drawn shapes for the Pillar icons
// (coin, lamp, heart, flower) and system serif fonts until A-08 brings the real UI art.
import Phaser from 'phaser';
import { FAMILY_BODY, FAMILY_DISPLAY, FAMILY_HEADING, FAMILY_UI, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import { formatClock, formatDate, gameTime, weekdayOf, type Clock } from '../sim/clock';
import { computeAppeal } from '../town/appeal';
import { MARKET_DAY_STALL_FEES, UPKEEP_RULES, dailyRates } from '../town/fund';
import { ARRIVAL_APPEAL, householdsForAppeal, isArrivalDay, isFerryDay } from '../town/migration';
import { optionGauge } from '../town/optionClause';
import { PILLARS, communityWorkRoom, createTownState, todayChange, COMMUNITY_WORK_WEEKLY_CAP, type Pillar, type TownState } from '../town/pillars';
import { runDawnsThrough, type DawnReport } from '../town/townEngine';
import { DIALOGUE_SCENE } from './DialogueScene';

export const TOWN_LEDGER_SCENE = 'TownLedger';
/** The TownState in the game registry. */
export const TOWN_KEY = 'monde.town';
/** The last dawn's DawnReport. */
export const DAWN_REPORT_KEY = 'monde.dawnReport';
/** Whether the HUD Pillar strip is showing (kept across zone changes). */
const STRIP_KEY = 'monde.hud.pillarStrip';

const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const DEV_KEYS = import.meta.env.DEV || query.has('dev');

// ── Registry wiring ─────────────────────────────────────────────────────────

export const getTown = (registry: Phaser.Data.DataManager): TownState | undefined => registry.get(TOWN_KEY) as TownState | undefined;

const attached = new WeakSet<Clock>();
/**
 * Put a Day-1 TownState in the registry (dated the clock's day, so a `?day=` start isn't run through a pile of
 * empty nights) and run the dawn pass on every dawn of this clock. Once per clock; the clock outlives zone
 * changes, so this does too.
 */
export const attachTown = (registry: Phaser.Data.DataManager, clock: Clock): void => {
  if (!getTown(registry)) registry.set(TOWN_KEY, createTownState({ day: clock.day }));
  if (attached.has(clock)) return;
  attached.add(clock);
  clock.onDawn(t => {
    const town = getTown(registry);
    if (!town || t.day <= town.day) return; // a dev jump back over a dawn doesn't run it twice
    const { state, reports } = runDawnsThrough(town, t.day);
    const report = reports.at(-1);
    registry.set(TOWN_KEY, state);
    if (!report) return;
    registry.set(DAWN_REPORT_KEY, report);
    if (import.meta.env.DEV) {
      const a = report.appeal;
      console.info(`[town] dawn · Day ${report.day} · Appeal ${a.appeal.toFixed(1)} (youth ${a.youth.toFixed(1)}, elder ${a.elder.toFixed(1)}, momentum ${a.momentum.toFixed(1)}) · arrivals ${report.arrivals.households} (${report.arrivals.outcome}) · fund ${report.fund.after}`);
    }
  });
};

/** Open the Ledger over `host` (no-op if it, or the dialogue panel, is already up). */
export const openTownLedger = (host: Phaser.Scene, clock: Clock): void => {
  if (host.scene.isActive(TOWN_LEDGER_SCENE) || host.scene.isActive(DIALOGUE_SCENE)) return;
  host.scene.launch(TOWN_LEDGER_SCENE, { host: host.scene.key, clock } satisfies LedgerOpen);
};

// ── Pillar look ─────────────────────────────────────────────────────────────

/** Okabe–Ito colours, so the four stay apart under the common colour-vision deficiencies (§18). */
export const PILLAR_COLOR: Readonly<Record<Pillar, number>> = { prosperity: 0xe69f00, safety: 0x0072b2, spirit: 0xcc79a7, charm: 0x009e73 };
const PILLAR_NAME: Readonly<Record<Pillar, string>> = { prosperity: 'Prosperity', safety: 'Safety', spirit: 'Spirit', charm: 'Charm' };
/** §6.1, "What it measures". */
const PILLAR_MEASURES: Readonly<Record<Pillar, string>> = {
  prosperity: 'Jobs, open shops, money moving',
  safety: 'Feeling safe at any hour',
  spirit: 'Belonging, events, friendships',
  charm: 'Beauty, culture, history'
};

/**
 * §16.6's Pillar icons as plain shapes: a coin (Prosperity), a lamp (Safety), a heart (Spirit), a flower
 * (Charm). Drawn in `fg` around (cx, cy), about 2·s across; `cut` fills the small details (coin rim, lamp
 * glass, flower heart).
 */
export const drawPillarIcon = (g: Phaser.GameObjects.Graphics, pillar: Pillar, cx: number, cy: number, s: number, fg: number, cut: number): void => {
  switch (pillar) {
    case 'prosperity':
      g.fillStyle(fg, 1).fillCircle(cx, cy, s);
      g.lineStyle(Math.max(1, s * 0.16), cut, 1).strokeCircle(cx, cy, s * 0.62);
      g.fillStyle(cut, 1).fillRect(cx - s * 0.1, cy - s * 0.38, s * 0.2, s * 0.76);
      break;
    case 'safety':
      g.fillStyle(fg, 1);
      g.fillRect(cx - s * 0.11, cy - s * 0.25, s * 0.22, s * 1.1); // post
      g.fillRect(cx - s * 0.42, cy + s * 0.78, s * 0.84, s * 0.2); // foot
      g.fillRect(cx - s * 0.4, cy - s * 0.78, s * 0.8, s * 0.58); // lantern
      g.fillTriangle(cx - s * 0.55, cy - s * 0.76, cx + s * 0.55, cy - s * 0.76, cx, cy - s * 1.08); // cap
      g.fillStyle(cut, 1).fillRect(cx - s * 0.22, cy - s * 0.66, s * 0.44, s * 0.34); // glass
      break;
    case 'spirit':
      g.fillStyle(fg, 1);
      g.fillCircle(cx - s * 0.46, cy - s * 0.28, s * 0.52).fillCircle(cx + s * 0.46, cy - s * 0.28, s * 0.52);
      g.fillTriangle(cx - s * 0.95, cy - s * 0.12, cx + s * 0.95, cy - s * 0.12, cx, cy + s * 0.92);
      break;
    case 'charm':
      g.fillStyle(fg, 1);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        g.fillCircle(cx + Math.cos(a) * s * 0.56, cy + Math.sin(a) * s * 0.56, s * 0.44);
      }
      g.fillStyle(cut, 1).fillCircle(cx, cy, s * 0.3);
      break;
  }
};

const signed = (v: number, digits = 1): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`;
const coins = (n: number): string => Math.round(n).toLocaleString('en-US');
/** Today's change as an arrow and amount: "▲ 0.5", "▼ 0.3" or "–". */
const arrow = (delta: number): { glyph: string; dir: 1 | -1 | 0 } =>
  delta >= 0.05 ? { glyph: `▲ ${delta.toFixed(1)}`, dir: 1 } : delta <= -0.05 ? { glyph: `▼ ${Math.abs(delta).toFixed(1)}`, dir: -1 } : { glyph: '–', dir: 0 };

// ── HUD strip ───────────────────────────────────────────────────────────────

const HUD_CREAM = '#fff0ce';
const HUD_UP = '#9fd3ff';
const HUD_DOWN = '#ffb08a';

/** §18: the small Pillar strip under the clock. Each Pillar's icon, its value and today's arrow. */
export class PillarStrip {
  readonly objects: Phaser.GameObjects.GameObject[];
  private readonly values: Phaser.GameObjects.Text[] = [];
  private readonly arrows: Phaser.GameObjects.Text[] = [];
  private readonly hit: Phaser.GameObjects.Zone;

  constructor(private readonly scene: Phaser.Scene, x: number, y: number, w: number) {
    const h = 32, cell = w / PILLARS.length;
    const bg = scene.add.graphics();
    bg.fillStyle(0x28372d, 0.92).fillRoundedRect(x, y, w, h, 8);
    bg.lineStyle(2, 0xe4c77f, 0.55).strokeRoundedRect(x, y, w, h, 8);
    const icons = scene.add.graphics();
    const style = (size: number, color: string): Phaser.Types.GameObjects.Text.TextStyle =>
      ({ fontFamily: FAMILY_UI, fontSize: `${size}px`, color, resolution: RENDER_SCALE });
    PILLARS.forEach((p, i) => {
      const cx = x + cell * i + 16;
      drawPillarIcon(icons, p, cx, y + h / 2, 7.5, PILLAR_COLOR[p], 0x28372d);
      this.values.push(scene.add.text(cx + 12, y + h / 2, '', style(15, HUD_CREAM)).setOrigin(0, 0.5));
      this.arrows.push(scene.add.text(cx + 34, y + h / 2, '', style(10, HUD_CREAM)).setOrigin(0, 0.5));
    });
    // The whole strip is a button for the Ledger too.
    this.hit = scene.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
    this.objects = [bg, icons, ...this.values, ...this.arrows, this.hit];
    const refresh = () => this.refresh();
    scene.registry.events.on(`changedata-${TOWN_KEY}`, refresh);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.registry.events.off(`changedata-${TOWN_KEY}`, refresh));
    this.setVisible(scene.registry.get(STRIP_KEY) !== false);
    this.refresh();
  }

  /** Make clicking the strip do something (ZoneScene opens the Ledger). */
  onClick(fn: () => void): this {
    this.hit.on('pointerup', fn);
    return this;
  }

  get visible(): boolean { return this.scene.registry.get(STRIP_KEY) !== false; }

  toggle(): void { this.setVisible(!this.visible); }

  setVisible(on: boolean): void {
    this.scene.registry.set(STRIP_KEY, on);
    for (const o of this.objects) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(on);
  }

  refresh(): void {
    const town = getTown(this.scene.registry);
    if (!town) return;
    const change = todayChange(town);
    PILLARS.forEach((p, i) => {
      this.values[i]!.setText(String(Math.round(town.pillars[p])));
      const a = arrow(change[p]);
      this.arrows[i]!.setText(a.dir === 0 ? '' : a.dir > 0 ? '▲' : '▼').setColor(a.dir > 0 ? HUD_UP : HUD_DOWN)
        .setX(this.values[i]!.x + this.values[i]!.width + 3);
    });
  }
}

// ── The Ledger ──────────────────────────────────────────────────────────────

export interface LedgerOpen {
  /** The scene underneath: its input is paused while the Ledger is open. */
  host: string;
  clock: Clock;
}

// Layout (design pixels, 1280×720).
const PX = 120, PY = 44, PW = GAME_WIDTH - 240, PH = GAME_HEIGHT - 88;
const LX = PX + 44, LW = 500;
const RX = PX + 600, RW = PW - 600 - 44;
// Paper, ink and brass.
const PAPER = 0xf2e8d0;
const PAPER_EDGE = 0xe3d4b0;
const BRASS = 0xa67c2e;
const BRASS_LIGHT = 0xd9b45e;
const INK = 0x2b2219;
const INK_CSS = '#2b2219';
const MUTED = '#6f6150';
const BRASS_CSS = '#8a6a24';
const UP_CSS = '#005a8c';
const DOWN_CSS = '#b5461f';
const TRACK = 0xe6d9b8;
const YOUTH = 0x56b4e9;
const ELDER = 0xd55e00;
/** The Appeal bar's scale. */
const APPEAL_SCALE = 60;
/** The Option Clause gauge's census range. */
const GAUGE_MIN = 180, GAUGE_MAX = 220;

export class TownLedgerScene extends Phaser.Scene {
  private open!: LedgerOpen;
  private content!: Phaser.GameObjects.Container;
  private openedAt = 0;
  private closed = false;
  private seenKeys = new WeakSet<KeyboardEvent>();

  constructor() { super(TOWN_LEDGER_SCENE); }

  init(data: LedgerOpen): void {
    this.open = data;
    this.closed = false;
  }

  create(): void {
    this.scene.bringToTop();
    this.pauseWorld(true);
    this.openedAt = performance.now();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());

    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x10140f, 0.55).setOrigin(0).setInteractive(); // swallows clicks
    this.drawPaper();
    this.content = this.add.container(0, 0);
    this.refresh();

    const onChange = () => this.refresh();
    this.registry.events.on(`changedata-${TOWN_KEY}`, onChange);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.registry.events.off(`changedata-${TOWN_KEY}`, onChange));
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));

    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 140 });
  }

  private onKey(e: KeyboardEvent): void {
    // Phaser can re-emit a native event when several keydowns land in one frame (as ZoneScene notes): once each.
    if (this.closed || e.repeat || this.seenKeys.has(e)) return;
    this.seenKeys.add(e);
    if (e.key === 'Escape') { this.close(); return; }
    // The L that opened the Ledger mustn't close it again.
    if ((e.key === 'l' || e.key === 'L' || e.code === 'KeyL') && performance.now() - this.openedAt > 150) { this.close(); return; }
    if (DEV_KEYS && (e.key === ']' || e.code === 'BracketRight')) {
      // Dev: an hour forward, paused or not, so a dawn can be run from here.
      this.open.clock.advanceMinutes(60);
      this.refresh();
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  /** The sheet: paper in a brass frame, with rivets and a masthead. Drawn once. */
  private drawPaper(): void {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.35).fillRoundedRect(PX + 6, PY + 8, PW, PH, 10);
    g.fillStyle(BRASS, 1).fillRoundedRect(PX - 6, PY - 6, PW + 12, PH + 12, 12);
    g.lineStyle(1.5, BRASS_LIGHT, 0.9).strokeRoundedRect(PX - 4, PY - 4, PW + 8, PH + 8, 11);
    g.fillGradientStyle(PAPER, PAPER, PAPER_EDGE, PAPER_EDGE, 1).fillRect(PX, PY, PW, PH);
    g.lineStyle(1, BRASS, 0.5).strokeRect(PX + 10, PY + 10, PW - 20, PH - 20);
    for (const [x, y] of [[PX - 1, PY - 1], [PX + PW + 1, PY - 1], [PX - 1, PY + PH + 1], [PX + PW + 1, PY + PH + 1]] as const) {
      g.fillStyle(BRASS_LIGHT, 1).fillCircle(x, y, 5);
      g.fillStyle(0x6e5320, 1).fillCircle(x + 1, y + 1, 2);
    }
    // Masthead and its newsprint double rule.
    this.add.text(PX + PW / 2, PY + 22, 'The Town Ledger', {
      fontFamily: FAMILY_DISPLAY, fontSize: '40px', color: INK_CSS, resolution: RENDER_SCALE
    }).setOrigin(0.5, 0);
    g.fillStyle(INK, 1).fillRect(PX + 40, PY + 76, PW - 80, 2.5).fillRect(PX + 40, PY + 81, PW - 80, 1);
    // Column rule.
    g.fillStyle(INK, 0.25).fillRect(RX - 30, PY + 120, 1, PH - 170);
  }

  private text(x: number, y: number, s: string, size: number, opts: { color?: string; family?: string; italic?: boolean; bold?: boolean; align?: 'left' | 'right' | 'center'; wrap?: number } = {}): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, s, {
      fontFamily: opts.family ?? FAMILY_BODY, fontSize: `${size}px`, color: opts.color ?? INK_CSS,
      fontStyle: [opts.italic ? 'italic' : '', opts.bold ? 'bold' : ''].join(' ').trim() || 'normal',
      resolution: RENDER_SCALE, ...(opts.wrap ? { wordWrap: { width: opts.wrap } } : {})
    }).setOrigin(opts.align === 'right' ? 1 : opts.align === 'center' ? 0.5 : 0, 0);
    this.content.add(t);
    return t;
  }

  private header(x: number, y: number, s: string): void {
    this.text(x, y, s.toUpperCase(), 13, { family: FAMILY_UI, color: BRASS_CSS, bold: true });
  }

  /** Rebuild everything that depends on the town (the town changes at most a few times a day). */
  private refresh(): void {
    const town = getTown(this.registry);
    this.content.removeAll(true);
    if (!town) return;
    const g = this.add.graphics();
    this.content.add(g);
    const clock = this.open.clock;

    // Dateline.
    this.text(PX + PW / 2, PY + 90, `Day ${town.day} · ${formatDate(gameTime(town.day, clock.minute))} · ${formatClock(clock.minute)}`, 16, { italic: true, color: MUTED, align: 'center' });

    this.drawPillars(g, town);
    this.drawRightColumn(g, town);

    // Footer: the last dawn, and the keys.
    const report = this.registry.get(DAWN_REPORT_KEY) as DawnReport | undefined;
    if (report && report.day === town.day) this.text(PX + 44, PY + PH - 38, dawnLine(report), 14, { italic: true, color: MUTED, wrap: 620 });
    this.text(PX + PW - 44, PY + PH - 38, `L or Esc to close${DEV_KEYS ? '  ·  dev ]: +1 hour' : ''}`, 14, { family: FAMILY_UI, color: MUTED, align: 'right' });
  }

  private drawPillars(g: Phaser.GameObjects.Graphics, town: TownState): void {
    this.header(LX, PY + 122, 'The four Pillars');
    const change = todayChange(town);
    const rowH = 100, barX = LX + 66, barW = LW - 66;
    PILLARS.forEach((p, i) => {
      const y = PY + 150 + i * rowH;
      const color = PILLAR_COLOR[p];
      g.fillStyle(color, 1).fillCircle(LX + 26, y + 28, 25);
      g.lineStyle(2, BRASS, 0.8).strokeCircle(LX + 26, y + 28, 25);
      drawPillarIcon(g, p, LX + 26, y + 28, 13, 0xfffaf0, color);
      this.text(barX, y + 2, PILLAR_NAME[p], 24, { family: FAMILY_HEADING });
      this.text(barX, y + 32, PILLAR_MEASURES[p], 14, { italic: true, color: MUTED });
      this.text(LX + LW, y + 2, town.pillars[p].toFixed(1), 26, { family: FAMILY_UI, align: 'right' });
      const a = arrow(change[p]);
      this.text(LX + LW, y + 34, `${a.glyph} today`, 14, { family: FAMILY_UI, color: a.dir > 0 ? UP_CSS : a.dir < 0 ? DOWN_CSS : MUTED, align: 'right' });
      // The bar, 0–100, with quarter ticks and a mark where the day began.
      const by = y + 58, bh = 14;
      g.fillStyle(TRACK, 1).fillRect(barX, by, barW, bh);
      g.fillStyle(color, 1).fillRect(barX, by, (barW * town.pillars[p]) / 100, bh);
      g.fillStyle(INK, 0.18);
      for (const q of [25, 50, 75]) g.fillRect(barX + (barW * q) / 100, by, 1, bh);
      if (Math.abs(change[p]) >= 0.05) g.fillStyle(INK, 0.85).fillRect(barX + (barW * town.dayStart[p]) / 100 - 1, by - 3, 2, bh + 6);
      g.lineStyle(1, INK, 0.55).strokeRect(barX, by, barW, bh);
      const used = COMMUNITY_WORK_WEEKLY_CAP - communityWorkRoom(town, p);
      this.text(barX, by + 19, `Community work this week: +${used.toFixed(1)} of ${COMMUNITY_WORK_WEEKLY_CAP}`, 12, { family: FAMILY_UI, color: MUTED });
    });
  }

  private drawRightColumn(g: Phaser.GameObjects.Graphics, town: TownState): void {
    const a = computeAppeal(town);
    // Appeal.
    this.header(RX, PY + 122, 'Appeal');
    this.text(RX, PY + 142, a.appeal.toFixed(1), 44, { family: FAMILY_UI });
    const wanted = householdsForAppeal(a.appeal, !!town.flags.station_open);
    this.text(RX + 116, PY + 148, a.appeal >= ARRIVAL_APPEAL
      ? `${wanted} household${wanted === 1 ? '' : 's'} a sailing, homes allowing`
      : `Arrivals begin at ${ARRIVAL_APPEAL}`, 15, { italic: true, color: MUTED });
    this.text(RX + 116, PY + 170, nextSailing(town), 15, { italic: true, color: MUTED });
    const by = PY + 202, bw = RW;
    g.fillStyle(TRACK, 1).fillRect(RX, by, bw, 12);
    g.fillStyle(BRASS, 1).fillRect(RX, by, (bw * Math.min(APPEAL_SCALE, a.appeal)) / APPEAL_SCALE, 12);
    g.lineStyle(1, INK, 0.55).strokeRect(RX, by, bw, 12);
    const tx = RX + (bw * ARRIVAL_APPEAL) / APPEAL_SCALE;
    g.fillStyle(INK, 1).fillRect(tx - 1, by - 4, 2, 20);
    this.text(tx, by + 16, `${ARRIVAL_APPEAL}`, 11, { family: FAMILY_UI, color: MUTED, align: 'center' });

    // Youth / Elder split.
    this.text(RX, PY + 236, `Youth ${a.youth.toFixed(1)}`, 16, { family: FAMILY_UI });
    this.text(RX + RW, PY + 236, `Elder ${a.elder.toFixed(1)}`, 16, { family: FAMILY_UI, align: 'right' });
    const sy = PY + 260, yw = Math.round(RW * a.youthShare);
    g.fillStyle(YOUTH, 1).fillRect(RX, sy, yw, 10);
    g.fillStyle(ELDER, 1).fillRect(RX + yw, sy, RW - yw, 10);
    g.lineStyle(1, INK, 0.55).strokeRect(RX, sy, RW, 10);
    this.text(RX, PY + 274, `${Math.round(a.youthShare * 100)}% of arriving households would lean young`, 13, { italic: true, color: MUTED });
    this.text(RX, PY + 296, `Momentum ${signed(a.momentum)}  ·  7-day gain ${signed(a.meanGain7)} a Pillar`, 15, { family: FAMILY_UI });

    // People and homes.
    this.header(RX, PY + 330, 'People and homes');
    const census = this.text(RX, PY + 348, `${town.census}`, 30, { family: FAMILY_UI });
    this.text(census.x + census.width + 8, PY + 360, 'residents', 15, { italic: true, color: MUTED });
    this.text(RX, PY + 388, `Homes: ${town.homes.restored_free} free · ${town.homes.vacant_restorable} to restore · ${town.homes.occupied} lived in`, 15, { family: FAMILY_UI });

    // The Town Fund.
    this.header(RX, PY + 422, 'Town Fund');
    const fund = this.text(RX, PY + 440, coins(town.fund), 30, { family: FAMILY_UI });
    this.text(fund.x + fund.width + 8, PY + 452, 'coins', 15, { italic: true, color: MUTED });
    const upkeep = UPKEEP_RULES.filter(r => town.flags[r.flag]).reduce((sum, r) => sum + r.coins, 0);
    this.text(RX, PY + 480, `Rates ${dailyRates(town)} a day · stalls ${MARKET_DAY_STALL_FEES} on Saturdays · upkeep ${upkeep} a day`, 13, { family: FAMILY_UI, color: MUTED, wrap: RW });

    // The Option Clause, once known and the census is near the line (§6.5).
    const gauge = optionGauge(town);
    if (!gauge.visible) return;
    this.header(RX, PY + 510, 'The Option Clause');
    const gy = PY + 530, gx = (v: number) => RX + (RW * (Math.min(GAUGE_MAX, Math.max(GAUGE_MIN, v)) - GAUGE_MIN)) / (GAUGE_MAX - GAUGE_MIN);
    g.fillStyle(TRACK, 1).fillRect(RX, gy, RW, 12);
    g.fillStyle(town.census < gauge.line ? ELDER : INK, 0.8).fillRect(RX, gy, gx(town.census) - RX, 12);
    g.lineStyle(1, INK, 0.55).strokeRect(RX, gy, RW, 12);
    g.fillStyle(0xb5461f, 1).fillRect(gx(gauge.line) - 1.5, gy - 5, 3, 22);
    this.text(gx(gauge.line), gy - 20, `${gauge.line}`, 11, { family: FAMILY_UI, color: DOWN_CSS, align: 'center' });
    this.text(RX, gy + 18, gauge.exercised
      ? `Exercised on Day ${gauge.exercisedDay}. The Wharf is Vane's.`
      : `Census ${town.census} · dawns under ${gauge.line}: ${gauge.dawnsUnder} of ${gauge.dawnsNeeded}`, 14, { family: FAMILY_UI, color: gauge.dawnsUnder > 0 || gauge.exercised ? DOWN_CSS : INK_CSS });
  }

  // ── Opening and closing ──────────────────────────────────────────────────

  private pauseWorld(paused: boolean): void {
    const host = this.scene.get(this.open.host);
    if (host?.input) {
      host.input.enabled = !paused;
      const keys = host.input.keyboard;
      if (keys) { keys.enabled = !paused; keys.resetKeys(); }
    }
    if (paused) this.open.clock.pause('ledger'); else this.open.clock.resume('ledger');
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 120, onComplete: () => this.scene.stop() });
  }

  private teardown(): void {
    this.closed = true;
    this.input.keyboard?.removeAllListeners('keydown');
    this.pauseWorld(false);
  }
}

/** "Ferry today" / "Next sailing: Fri · Day 4". */
const nextSailing = (town: TownState): string => {
  if (isArrivalDay(town.day, town.flags)) return isFerryDay(town.day, town.flags) ? 'The ferry sails today' : 'A train today';
  for (let d = town.day + 1; d <= town.day + 7; d++) if (isArrivalDay(d, town.flags)) return `Next sailing: ${weekdayOf(d)} · Day ${d}`;
  return '';
};

/** One line on what this morning's dawn decided. */
const dawnLine = (r: DawnReport): string => {
  const n = r.arrivals.households;
  const arrivals: Record<DawnReport['arrivals']['outcome'], string> = {
    arrivals: `${n} household${n === 1 ? '' : 's'} on the boat`,
    capped_by_free_homes: `${n} household${n === 1 ? '' : 's'} on the boat (every free home taken)`,
    capped_at_6: `${n} households on the boat`,
    no_sailing: 'no sailing',
    appeal_below_35: 'the ferry came in empty',
    no_free_homes: 'newcomers asked, but no home was ready'
  };
  const notices = r.departures.notices.length ? ` · ${r.departures.notices.length} Leaving Notice${r.departures.notices.length === 1 ? '' : 's'}` : '';
  return `This morning (${r.date}): ${arrivals[r.arrivals.outcome]} · Fund ${signed(r.fund.books.net, 0)}${notices}`;
};
