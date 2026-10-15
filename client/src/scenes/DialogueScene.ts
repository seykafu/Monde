// The VN dialogue panel (GDD §9.10 flow, §18 Dialogue; MVP M-05 client, M-11 Quiet Mode).
//
// Launched over ZoneScene when the player presses E beside a resident (`talk-requested`). The zone keeps
// running underneath with its input paused; the clock is held for "dialogue" and the music ducked until the
// panel closes. Layout follows Ravage's StoryScene, adapted: a dimmed, tinted backdrop (zone backdrops are
// art still to come), a placeholder portrait on the left that changes with each line's `expr`, a name plate
// that shimmers softly while a turn is generating (no spinner), and a typewriter body with pages.
//
// Streaming: line_delta text feeds a DialogueReader (mind/reader.ts), which types only what has arrived, so
// nothing on screen is taken back unless the stream itself starts over (a new attempt, or a final turn that
// doesn't continue it); then the body clears and starts again, quietly. If nothing is visible by 2.5 s the
// resident plays the "Hm." thinking beat. The final `turn` brings the choices: 1–3 (keys or click),
// "Say something…" (a DOM text input, ≤ 140 characters), Gift, Leave, and a small "⋯" menu with Report line
// and the text speed. Quiet Mode and server fallback turns look exactly the same (`?dev` adds a tiny marker).
import Phaser from 'phaser';
import { FAMILY_BODY, FAMILY_HEADING, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import { getMusic } from '../audio/Music';
import { playSfx } from '../audio/Sfx';
import { maxLinesFor, paginateBody } from '../ui/fitText';
import type { Clock } from '../sim/clock';
import { hashString } from '../sim/plans';
import type { ResidentState } from '../sim/routineExecutor';
import type { WeatherNow } from '../sim/weather';
import type { ZoneDef } from '../world/zoneFormat';
import { personaCards } from '../world/residents';
import { displayName } from '../sim/residentSim';
import { Rng } from '../util/rng';
import type { ResidentLayer } from './zone/residents';
import { browserStorage, getMind, uuid, type TalkResult } from '../mind/api';
import { talkContext } from '../mind/context';
import { lineLibrary } from '../mind/lineLibrary';
import { loadQuietState, loadTextSpeed, saveQuietState, saveTextSpeed } from '../mind/prefs';
import { firstName, quietContext, quietTurn, QUIET_CHOICES, type QuietState } from '../mind/quietMode';
import { DialogueReader, MS_PER_CHAR, TEXT_SPEEDS, type TextSpeed } from '../mind/reader';
import type { TalkChoice, TalkContext, TalkInput, TalkTurn } from '../mind/types';
import type { PersonaCard } from '@monde/shared';

export const DIALOGUE_SCENE = 'Dialogue';

export interface DialogueOpen {
  /** The scene underneath: its input is paused while the panel is open. */
  host: string;
  clock: Clock;
  residentId: string;
  zone: ZoneDef;
  /** Where the resident is and what they're doing (the routine executor's state). */
  state: ResidentState | null;
  weather: WeatherNow;
}

/**
 * Wire a zone scene for dialogue: open the panel on `talk-requested`, and prewarm residents the player walks
 * near (§9.10 step 1). Undone when the host shuts down.
 */
export function attachDialogue(host: Phaser.Scene, opts: { residents: ResidentLayer; zone: ZoneDef; clock: Clock; weather: () => WeatherNow }): void {
  const off = opts.residents.sim.events.on('talk-requested', e => {
    if (host.scene.isActive(DIALOGUE_SCENE) || !CARDS.has(e.residentId)) return;
    const data: DialogueOpen = {
      host: host.scene.key, clock: opts.clock, residentId: e.residentId, zone: opts.zone,
      state: opts.residents.stateOf(e.residentId), weather: opts.weather()
    };
    host.scene.launch(DIALOGUE_SCENE, data);
  });
  opts.residents.onApproach = id => { if (CARDS.has(id)) getMind().prewarmNear(id, opts.clock.day, opts.clock.minute); };
  host.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { off(); opts.residents.onApproach = undefined; });
}

const CARDS: ReadonlyMap<string, { card: PersonaCard; index: number }> = new Map(personaCards.map((card, index) => [card.id, { card, index }]));
/** {resident:<id>} in Quiet Mode lines: every card's first name (nobody has left town yet). */
const FIRST_NAMES: Readonly<Record<string, string>> = Object.fromEntries(personaCards.map(c => [c.id, firstName(c.name)]));
const DEV_MARK = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev');

// ── Layout (design pixels, 1280×720) ────────────────────────────────────────

const PANEL_X = 100;
const PANEL_W = GAME_WIDTH - 200;
const PANEL_H = 196;
const PANEL_Y = GAME_HEIGHT - 20 - PANEL_H;
const PAD = 30;
const BODY_Y = PANEL_Y + 40;
const BODY_W = PANEL_W - PAD * 2 - 60;
const BODY_FONT = 22;
const BODY_SPACING = 8;
const BODY_MAX_LINES = maxLinesFor(BODY_FONT, BODY_SPACING, PANEL_H - 40 - 30);
const PORTRAIT_W = 230;
const PORTRAIT_H = 270;
const PORTRAIT_X = PANEL_X + 22;
const PORTRAIT_Y = PANEL_Y - PORTRAIT_H + 4;
const PLATE_X = PANEL_X + 18;
const PLATE_Y = PANEL_Y - 20;
const PLATE_H = 38;
const CHOICE_W = 480;
const CHOICE_X = PANEL_X + PANEL_W - CHOICE_W;
const CHOICE_GAP = 8;

// Monde's HUD palette (ZoneScene): deep green panels, cream text, a gold rule.
const INK = 0x1f2a22;
const PLATE = 0x28372d;
const GOLD = 0xe4c77f;
const CREAM = '#fff0ce';
const MUTED = '#cfc4a6';

/** A goodbye the player didn't type: the Leave choice, and what Esc means while choosing. */
const LEAVE: TalkChoice = { ...QUIET_CHOICES.leave };
const THINKING_BEAT = 'Hm.';
const isBareLeave = (c: TalkChoice): boolean => c.intent === 'leave' && c.text.trim().toLowerCase() === 'leave';
/** §9.10 step 4: nothing visible by 2.5 s → the authored thinking beat (the server sends one too). */
const THINKING_MS = 2500;
/** Free text is at most 140 characters (§9.10). */
const SAY_MAX = 140;
/** Voice blips are 45 ms long: no closer together than this, whatever the text speed. */
const BLIP_GAP_MS = 55;

/**
 * GDD-GAP: §17/§18 give residents voice blips but no pitches. Children sit high and elders low: 316 Hz less
 * 1.6 Hz a year (Tib at 11 ≈ 298 Hz, Bertrand at 84 ≈ 182 Hz), floored at 150, with a ±12 Hz offset per
 * resident so two of an age don't sound alike.
 */
export const voiceFrequency = (age: number, id: string): number =>
  Math.max(150, Math.min(320, 316 - 1.6 * age)) + ((hashString(id) % 25) - 12);

// ── Placeholder portrait ────────────────────────────────────────────────────

const SKIN = [0xf2d5b3, 0xe3b48c, 0xc68e64, 0x8d5a3b, 0xf6e1cb, 0xa86f48];
const HAIR = [0x3b2a20, 0x6b4a2b, 0xb7b2a8, 0x1f1a17, 0x9c4a26, 0xd9c28a, 0x50392b];
/** The resident's roster colour, as their sprite wears it (scenes/zone/residents.ts). */
const rosterColour = (index: number): number => Phaser.Display.Color.HSLToColor(((index * 137.508) % 360) / 360, 0.52, 0.56).color;
const shade = (c: number, f: number): number =>
  (Math.min(255, Math.round(((c >> 16) & 0xff) * f)) << 16) | (Math.min(255, Math.round(((c >> 8) & 0xff) * f)) << 8) | Math.min(255, Math.round((c & 0xff) * f));

interface Look { colour: number; skin: number; hair: number; animal: boolean }

/** A bust in the resident's colours with a face for the standard expressions; other expressions read as neutral. */
function drawPortrait(g: Phaser.GameObjects.Graphics, look: Look, expr: string): void {
  const W = PORTRAIT_W, H = PORTRAIT_H, cx = W / 2, cy = H * 0.42;
  g.clear();
  g.fillStyle(shade(look.colour, 0.32), 0.95).fillRoundedRect(0, 0, W, H, 16);
  g.fillStyle(look.colour, 0.22).fillCircle(cx, cy, W * 0.42);
  g.lineStyle(2, GOLD, 0.45).strokeRoundedRect(1, 1, W - 2, H - 2, 16);
  const ink = 0x2a2420;
  const e = expr;
  if (look.animal) {
    const fur = 0x4a4038;
    g.fillStyle(fur).fillEllipse(cx, H * 0.86, W * 0.7, H * 0.4);
    const flat = e === 'angry' || e === 'sad' || e === 'worried';
    g.fillStyle(fur).fillCircle(cx, cy, 62);
    if (flat) g.fillTriangle(cx - 70, cy - 22, cx - 30, cy - 52, cx - 40, cy - 8).fillTriangle(cx + 70, cy - 22, cx + 30, cy - 52, cx + 40, cy - 8);
    else g.fillTriangle(cx - 58, cy - 20, cx - 46, cy - 84, cx - 14, cy - 54).fillTriangle(cx + 58, cy - 20, cx + 46, cy - 84, cx + 14, cy - 54);
    const closed = e === 'warm' || e === 'laugh' || e === 'thinking';
    if (closed) {
      g.lineStyle(4, 0xd8e070).beginPath().arc(cx - 24, cy - 4, 10, Math.PI * 1.1, Math.PI * 1.9).strokePath();
      g.beginPath().arc(cx + 24, cy - 4, 10, Math.PI * 1.1, Math.PI * 1.9).strokePath();
    } else {
      const r = e === 'surprised' ? 12 : 9;
      g.fillStyle(0xd8e070).fillCircle(cx - 24, cy - 6, r).fillCircle(cx + 24, cy - 6, r);
      g.fillStyle(ink).fillEllipse(cx - 24, cy - 6, 4, r * 1.6).fillEllipse(cx + 24, cy - 6, 4, r * 1.6);
    }
    g.fillStyle(0xd88a8a).fillTriangle(cx - 7, cy + 14, cx + 7, cy + 14, cx, cy + 22);
    g.fillStyle(look.colour).fillRect(cx - 40, cy + 52, 80, 8);
    return;
  }
  // Shoulders, neck, head, hair.
  g.fillStyle(look.colour).fillRoundedRect(W * 0.12, H * 0.72, W * 0.76, H * 0.4, 46);
  g.fillStyle(shade(look.colour, 0.7)).fillRect(W * 0.12, H * 0.72 + 30, W * 0.76, 6);
  g.fillStyle(shade(look.skin, 0.85)).fillRect(cx - 17, cy + 40, 34, 40);
  g.fillStyle(look.skin).fillEllipse(cx, cy, 112, 128);
  g.fillStyle(look.hair).fillEllipse(cx, cy - 46, 120, 52).fillRect(cx - 60, cy - 46, 14, 50).fillRect(cx + 46, cy - 46, 14, 50);
  // Brows, eyes, mouth by expression.
  const ex = 24, ey = cy - 4, my = cy + 34;
  g.lineStyle(4, shade(look.hair, 0.8));
  const brow = (dx: number, inner: number, outer: number) => {
    const side = Math.sign(dx);
    g.lineBetween(cx + dx - 12 * side, ey - 18 + outer, cx + dx + 10 * side - side * 22, ey - 18 + inner);
  };
  const browPair = (inner: number, outer: number) => { brow(ex, inner, outer); brow(-ex, inner, outer); };
  switch (e) {
    case 'angry': browPair(6, -4); break;
    case 'sad': case 'worried': browPair(-6, 3); break;
    case 'surprised': browPair(-8, -8); break;
    case 'thinking': brow(-ex, 0, 0); brow(ex, -7, -7); break;
    default: browPair(0, 0);
  }
  if (e === 'laugh') {
    g.lineStyle(4, ink).beginPath().arc(cx - ex, ey + 4, 8, Math.PI * 1.15, Math.PI * 1.85).strokePath();
    g.beginPath().arc(cx + ex, ey + 4, 8, Math.PI * 1.15, Math.PI * 1.85).strokePath();
  } else {
    const r = e === 'surprised' ? 7 : 5, look_ = e === 'thinking' ? { x: 5, y: -4 } : { x: 0, y: 0 };
    g.fillStyle(ink).fillCircle(cx - ex + look_.x, ey + look_.y, r).fillCircle(cx + ex + look_.x, ey + look_.y, r);
  }
  g.lineStyle(4, 0x8a3f3a);
  switch (e) {
    case 'warm': g.beginPath().arc(cx, my - 10, 16, Math.PI * 0.2, Math.PI * 0.8).strokePath(); break;
    case 'laugh': g.fillStyle(0x8a3f3a).slice(cx, my - 6, 18, 0, Math.PI, false).fillPath(); break;
    case 'sad': g.beginPath().arc(cx, my + 12, 15, Math.PI * 1.2, Math.PI * 1.8).strokePath(); break;
    case 'angry': g.lineBetween(cx - 14, my + 2, cx + 14, my - 1); break;
    case 'surprised': g.strokeCircle(cx, my, 7); break;
    case 'worried': g.beginPath().moveTo(cx - 14, my + 2).lineTo(cx - 5, my - 2).lineTo(cx + 4, my + 2).lineTo(cx + 14, my - 2).strokePath(); break;
    case 'thinking': g.lineBetween(cx - 2, my, cx + 14, my - 3); break;
    default: g.lineBetween(cx - 13, my, cx + 13, my);
  }
}

// ── A focusable button ──────────────────────────────────────────────────────

class PanelButton {
  readonly bg: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  readonly hit: Phaser.GameObjects.Rectangle;
  readonly h: number;
  private hovered = false;
  private focused = false;

  constructor(scene: Phaser.Scene, readonly x: number, private y: number, readonly w: number, text: string,
    readonly onClick: () => void, private readonly opts: { center?: boolean; muted?: boolean; size?: number; minH?: number } = {}) {
    const size = opts.size ?? 18;
    this.label = scene.add.text(0, 0, text, {
      fontFamily: FAMILY_BODY, fontSize: `${size}px`, color: opts.muted ? MUTED : CREAM, resolution: RENDER_SCALE,
      wordWrap: { width: w - 28 }, lineSpacing: 2, align: opts.center ? 'center' : 'left'
    }).setDepth(41);
    this.h = Math.max(opts.minH ?? 40, Math.ceil(this.label.height) + 16);
    this.bg = scene.add.graphics().setDepth(40);
    this.hit = scene.add.rectangle(x, y, w, this.h, 0x000000, 0).setOrigin(0).setDepth(42).setInteractive({ useHandCursor: true });
    this.hit.on('pointerover', () => { this.hovered = true; this.redraw(); });
    this.hit.on('pointerout', () => { this.hovered = false; this.redraw(); });
    // Deferred a tick: the click may tear this button down, which mustn't happen inside its own input event.
    this.hit.on('pointerup', () => { playSfx('click'); scene.time.delayedCall(0, this.onClick); });
    this.moveTo(y);
  }

  moveTo(y: number): void {
    this.y = y;
    this.hit.setPosition(this.x, y);
    this.label.setPosition(this.opts.center ? this.x + this.w / 2 : this.x + 14, y + this.h / 2).setOrigin(this.opts.center ? 0.5 : 0, 0.5);
    this.redraw();
  }

  setFocus(on: boolean): void { this.focused = on; this.redraw(); }

  destroy(): void { this.bg.destroy(); this.label.destroy(); this.hit.destroy(); }

  private redraw(): void {
    const lit = this.hovered || this.focused;
    this.bg.clear();
    this.bg.fillStyle(lit ? 0x3a4d40 : PLATE, 0.96).fillRoundedRect(this.x, this.y, this.w, this.h, 9);
    this.bg.lineStyle(lit ? 2 : 1, lit ? 0xffe3a0 : GOLD, lit ? 1 : 0.55).strokeRoundedRect(this.x, this.y, this.w, this.h, 9);
  }
}

// ── The scene ───────────────────────────────────────────────────────────────

export class DialogueScene extends Phaser.Scene {
  private open!: DialogueOpen;
  private card!: PersonaCard;
  private look!: Look;
  private context!: TalkContext;
  private conversationId = '';
  /** Exchanges completed (the next turn's index). */
  private exchange = 0;
  private turn: TalkTurn | null = null;
  private source: 'server' | 'quiet' = 'quiet';
  private generating = false;
  private requestSeq = 0;
  private abort: AbortController | null = null;
  private thinking: string | null = null;
  private thinkTimer?: Phaser.Time.TimerEvent;
  private choicesShown = false;
  private farewell = false;
  private closed = false;
  private speed: TextSpeed = 'normal';
  private quiet!: QuietState;
  private quietLine: string | null = null;
  private reader!: DialogueReader;
  // Presentation.
  private body!: Phaser.GameObjects.Text;
  private echo!: Phaser.GameObjects.Text;
  private more!: Phaser.GameObjects.Text;
  private devMark!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private portrait!: Phaser.GameObjects.Graphics;
  private exprLabel!: Phaser.GameObjects.Text;
  private plateW = 0;
  private shimmer!: Phaser.GameObjects.Graphics;
  private shownBody = '';
  private shownExpr = '';
  /** The last line's expression, held while the next turn streams. */
  private restExpr = 'neutral';
  private paren = false;
  private lastBlip = 0;
  /** Keyboard focus order: numbered replies, Say something…, Leave. */
  private buttons: PanelButton[] = [];
  /** Mouse-only buttons (Gift, until it does something). */
  private extraButtons: PanelButton[] = [];
  private focus = 0;
  private menu: Phaser.GameObjects.GameObject[] = [];
  private say: { input: HTMLInputElement; hint: Phaser.GameObjects.Text } | null = null;

  constructor() { super(DIALOGUE_SCENE); }

  init(data: DialogueOpen): void {
    this.open = data;
    const entry = CARDS.get(data.residentId)!;
    this.card = entry.card;
    const h = hashString(entry.card.id);
    this.look = { colour: rosterColour(entry.index), skin: SKIN[h % SKIN.length]!, hair: HAIR[(h >> 4) % HAIR.length]!, animal: entry.card.kind === 'animal' };
    this.context = talkContext({ day: data.clock.day, minute: data.clock.minute, state: data.state, zone: data.zone, weather: data.weather });
    this.conversationId = uuid();
    this.exchange = 0;
    this.turn = null;
    this.source = 'quiet';
    this.generating = false;
    this.abort = null;
    this.thinking = null;
    this.thinkTimer = undefined;
    this.choicesShown = false;
    this.farewell = false;
    this.closed = false;
    this.speed = loadTextSpeed(browserStorage());
    this.quiet = loadQuietState(browserStorage());
    this.quietLine = null;
    this.shownBody = '';
    this.shownExpr = '';
    this.restExpr = 'neutral';
    this.paren = false;
    this.lastBlip = 0;
    this.buttons = [];
    this.extraButtons = [];
    this.focus = 0;
    this.menu = [];
    this.say = null;
  }

  create(): void {
    this.scene.bringToTop();
    this.pauseWorld(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());

    // Backdrop: the zone dimmed under a soft tint, darker toward the panel.
    const tint = this.look.colour;
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x10140f, 0.42).setOrigin(0);
    const wash = this.add.graphics();
    wash.fillGradientStyle(shade(tint, 0.35), shade(tint, 0.35), 0x0c100d, 0x0c100d, 0.18, 0.18, 0.72, 0.72).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    // Anywhere that isn't a button advances the text.
    this.add.zone(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0).setInteractive().on('pointerdown', () => this.advance());

    // Portrait (left), then the panel over its lower edge.
    this.portrait = this.add.graphics({ x: PORTRAIT_X, y: PORTRAIT_Y });
    this.exprLabel = this.add.text(PORTRAIT_X + PORTRAIT_W - 12, PORTRAIT_Y + 12, '', {
      fontFamily: FAMILY_BODY, fontSize: '13px', fontStyle: 'italic', color: MUTED, resolution: RENDER_SCALE
    }).setOrigin(1, 0);
    this.setExpr('neutral');
    const panel = this.add.graphics();
    panel.fillStyle(INK, 0.95).fillRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 14);
    panel.lineStyle(2, GOLD, 0.6).strokeRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 14);
    panel.lineStyle(1, GOLD, 0.2).strokeRoundedRect(PANEL_X + 5, PANEL_Y + 5, PANEL_W - 10, PANEL_H - 10, 11);

    // Name plate, with its shimmer while a line is generating.
    const name = this.add.text(PLATE_X + 20, PLATE_Y + PLATE_H / 2, displayName(this.card.name), {
      fontFamily: FAMILY_HEADING, fontSize: '23px', color: CREAM, resolution: RENDER_SCALE
    }).setOrigin(0, 0.5).setDepth(11);
    this.plateW = Math.max(PORTRAIT_W + 8, Math.ceil(name.width) + 40);
    const plate = this.add.graphics().setDepth(10);
    plate.fillStyle(PLATE, 1).fillRoundedRect(PLATE_X, PLATE_Y, this.plateW, PLATE_H, 9);
    plate.lineStyle(2, GOLD, 0.85).strokeRoundedRect(PLATE_X, PLATE_Y, this.plateW, PLATE_H, 9);
    this.shimmer = this.add.graphics().setDepth(12).setBlendMode(Phaser.BlendModes.ADD);

    const bodyStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: FAMILY_BODY, fontSize: `${BODY_FONT}px`, color: '#f3ecd9', lineSpacing: BODY_SPACING,
      wordWrap: { width: BODY_W }, resolution: RENDER_SCALE
    };
    this.body = this.add.text(PANEL_X + PAD, BODY_Y, '', bodyStyle);
    const measure = this.add.text(0, 0, '', bodyStyle).setVisible(false);
    this.reader = new DialogueReader(text => paginateBody(measure, text, BODY_MAX_LINES));
    this.echo = this.add.text(PLATE_X + this.plateW + 18, PANEL_Y + 10, '', {
      fontFamily: FAMILY_BODY, fontSize: '15px', fontStyle: 'italic', color: MUTED, resolution: RENDER_SCALE,
      wordWrap: { width: PANEL_X + PANEL_W - 70 - (PLATE_X + this.plateW + 18) }, maxLines: 1
    });
    this.more = this.add.text(PANEL_X + PANEL_W - 22, PANEL_Y + PANEL_H - 12, '', {
      fontFamily: FAMILY_BODY, fontSize: '16px', color: '#e4c77f', resolution: RENDER_SCALE
    }).setOrigin(1, 1);
    this.tweens.add({ targets: this.more, alpha: 0.45, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.devMark = this.add.text(PANEL_X + 14, PANEL_Y + PANEL_H - 8, '', {
      fontFamily: FAMILY_BODY, fontSize: '11px', color: '#8f8a78', resolution: RENDER_SCALE
    }).setOrigin(0, 1).setVisible(DEV_MARK);
    // Small notes ("Thanks. That line has been noted.") along the panel's foot, clear of the choices.
    this.toastText = this.add.text(PANEL_X + PANEL_W / 2, PANEL_Y + PANEL_H - 22, '', {
      fontFamily: FAMILY_BODY, fontSize: '16px', color: CREAM, backgroundColor: '#28372d', padding: { x: 12, y: 6 }, resolution: RENDER_SCALE
    }).setOrigin(0.5).setDepth(60).setAlpha(0);

    // "⋯": Report line and the text speed.
    const dots = this.add.text(PANEL_X + PANEL_W - 22, PANEL_Y + 8, '⋯', {
      fontFamily: FAMILY_BODY, fontSize: '24px', color: '#e4c77f', padding: { x: 8, y: 0 }, resolution: RENDER_SCALE
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    dots.on('pointerup', () => (this.menu.length ? this.closeMenu() : this.openMenu()));

    const keyboard = this.input.keyboard!;
    keyboard.addCapture('SPACE,TAB,UP,DOWN');
    keyboard.on('keydown', (e: KeyboardEvent) => this.onKey(e));

    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 160 });
    void this.send({ kind: 'open' }, null);
  }

  update(time: number, delta: number): void {
    if (this.closed) return;
    const typed = this.reader.tick(delta, MS_PER_CHAR[this.speed]);
    if (typed) this.blip(typed, time);
    const text = this.reader.hasText ? this.reader.visible : this.thinking ?? '';
    if (text !== this.shownBody) {
      this.shownBody = text;
      this.body.setText(text).setFontStyle(this.reader.hasText ? 'normal' : 'italic').setAlpha(this.reader.hasText ? 1 : 0.8);
    }
    // A streamed line has no expression until its turn arrives: keep the last one (or "thinking" during the beat).
    const lineExpr = this.reader.expr();
    if (lineExpr) this.restExpr = lineExpr;
    this.setExpr(lineExpr ?? (this.thinking && !this.reader.hasText ? 'thinking' : this.restExpr));
    const status = this.reader.status();
    if (!this.generating && this.turn && status === 'done' && !this.choicesShown && !this.farewell && !this.say) this.showChoices();
    this.more.setText(status === 'more' ? 'More ▾' : status === 'next' ? '▸' : this.farewell && status === 'done' ? 'Close ▸' : '');
    this.drawShimmer(time);
    if (this.say) this.placeInput(this.say.input);
  }

  // ── Turns ─────────────────────────────────────────────────────────────────

  private async send(input: TalkInput, echo: string | null): Promise<void> {
    const seq = ++this.requestSeq;
    this.generating = true;
    this.turn = null;
    this.thinking = null;
    this.reader.reset();
    this.restartQuietly();
    this.hideChoices();
    this.echo.setText(echo ? `You: ${echo}` : '');
    this.thinkTimer?.remove();
    this.thinkTimer = this.time.delayedCall(THINKING_MS, () => this.onThinking(THINKING_BEAT, seq));
    this.abort?.abort();
    const abort = new AbortController();
    this.abort = abort;
    const turnIndex = this.exchange;
    const fallback = () => this.makeQuietTurn(input, turnIndex);
    const mind = getMind();
    let result: TalkResult | null;
    try {
      result = mind.enabled
        ? await mind.talk(
          { resident_id: this.card.id, conversation_id: this.conversationId, input, context: this.context },
          {
            signal: abort.signal, fallback,
            onLineDelta: d => { if (seq === this.requestSeq && this.reader.delta(d) === 'reset') this.restartQuietly(); },
            onThinking: t => this.onThinking(t, seq),
            onError: e => { if (DEV_MARK) this.devMark.setText(`server fell back: ${e.code}`); }
          })
        : { turn: fallback(), source: 'quiet', reason: 'offline' };
    } catch (error) {
      // Nothing should throw here, but a conversation must never dead-end: say something authored instead.
      console.warn('[dialogue] turn failed; using Quiet Mode', error);
      result = { turn: fallback(), source: 'quiet', reason: 'error' };
    }
    if (this.closed || seq !== this.requestSeq || !result) return;
    this.onTurn(result.turn, result.source, result.reason);
  }

  private onThinking(text: string, seq: number): void {
    if (this.closed || seq !== this.requestSeq || !this.generating || this.reader.hasText || this.thinking) return;
    this.thinking = text || THINKING_BEAT;
    // "Hm." plus a fidget.
    this.tweens.add({ targets: this.portrait, x: { from: PORTRAIT_X - 3, to: PORTRAIT_X + 3 }, duration: 130, yoyo: true, repeat: 1, ease: 'Sine.easeInOut', onComplete: () => this.portrait.setX(PORTRAIT_X) });
  }

  private onTurn(turn: TalkTurn, source: 'server' | 'quiet', reason?: string): void {
    this.generating = false;
    this.thinkTimer?.remove();
    this.source = source;
    this.turn = this.tidy(turn);
    this.exchange = turn.turn_index + 1;
    if (this.reader.finish(this.turn) === 'reset') this.restartQuietly();
    if (DEV_MARK) {
      const what = source === 'quiet' ? `quiet${this.quietLine ? ` · ${this.quietLine}` : ''}${reason ? ` (${reason})` : ''}` : turn.fallback ? 'server fallback' : 'live';
      this.devMark.setText(`${what} · turn ${turn.turn_index}${turn.wrap_up ? ' · wrap-up' : ''}`);
    }
  }

  /**
   * At most three numbered replies, then Leave; after a wrap-up, only Leave (§9.10 step 6). A goodbye the model
   * wrote in its own words ("I'd better get going.") stays among the numbered replies; a bare "Leave" becomes
   * the Leave button, which is always there.
   */
  private tidy(turn: TalkTurn): TalkTurn {
    const replies = turn.wrap_up ? [] : turn.choices.filter(c => !isBareLeave(c)).slice(0, 3);
    return { ...turn, choices: [...replies, turn.choices.find(isBareLeave) ?? LEAVE] };
  }

  private makeQuietTurn(input: TalkInput, turnIndex: number): TalkTurn {
    const { clock, weather, zone } = this.open;
    // GDD-GAP: resident mood and Regard live on the server and aren't mirrored to the client yet (§9.4), and
    // there's no client event log or flag store, so Quiet Mode speaks at an even mood, as a Stranger, with no
    // town event and no flags set.
    const { kind: _kind, ...context } = quietContext({
      kind: 'talk', day: clock.day, minute: clock.minute, weather: weather.kind, zone: zone.id, valence: 0, regard: 0,
      event: null, speaker: { id: this.card.id, name: this.card.name }, player: getMind().playerName, residents: FIRST_NAMES
    });
    const rng = new Rng(hashString(`${this.conversationId}:${turnIndex}`));
    const { turn, pick } = quietTurn({
      lib: lineLibrary, state: this.quiet, rng: () => rng.next(), conversationId: this.conversationId,
      residentId: this.card.id, turnIndex, input, context, narrated: this.card.voice.mode === 'narrated_action'
    });
    this.quietLine = pick?.line.id ?? null;
    saveQuietState(browserStorage(), this.quiet);
    return turn;
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  private advance(): void {
    if (this.closed || this.say) return;
    if (this.menu.length) { this.closeMenu(); return; }
    if (this.choicesShown) return;
    const step = this.reader.advance();
    if (step === 'page' || step === 'line') { playSfx('page_turn'); this.paren = false; }
    else if (step === 'none' && this.farewell && this.reader.status() === 'done') this.close();
  }

  private restartQuietly(): void {
    this.shownBody = '\u0000';
    this.paren = false;
  }

  /** Voice blips for speech (pitch from age); a soft typewriter tick for (narrated action). */
  private blip(typed: string, time: number): void {
    let speech = false, narration = false;
    for (const c of typed) {
      if (c === '(') this.paren = true;
      else if (c === ')') this.paren = false;
      else if (/[\p{L}\p{N}]/u.test(c)) { if (this.paren) narration = true; else speech = true; }
    }
    if (time - this.lastBlip < BLIP_GAP_MS || (!speech && !narration)) return;
    this.lastBlip = time;
    if (speech && this.card.voice.mode !== 'narrated_action') playSfx('voice_blip', { resident: this.card.id, frequency: voiceFrequency(this.card.age, this.card.id) });
    else playSfx('typewriter_tick');
  }

  private setExpr(expr: string): void {
    if (expr === this.shownExpr) return;
    this.shownExpr = expr;
    drawPortrait(this.portrait, this.look, expr);
    this.exprLabel.setText(expr.replace(/_/g, ' '));
  }

  private drawShimmer(time: number): void {
    const g = this.shimmer.clear();
    if (!this.generating) return;
    // A soft band of light sweeping across the plate.
    const span = this.plateW + 120, band = 90;
    const head = PLATE_X - band + ((time % 1500) / 1500) * span;
    for (let i = 0; i < 18; i++) {
      const x0 = head + (i * band) / 18, x1 = x0 + band / 18;
      const a = 0.2 * Math.sin((Math.PI * (i + 0.5)) / 18);
      const l = Math.max(x0, PLATE_X + 3), r = Math.min(x1, PLATE_X + this.plateW - 3);
      if (r > l) g.fillStyle(0xfff3c4, a).fillRect(l, PLATE_Y + 3, r - l, PLATE_H - 6);
    }
  }

  // ── Choices ───────────────────────────────────────────────────────────────

  private showChoices(): void {
    const turn = this.turn!;
    this.choicesShown = true;
    this.hideButtons();
    const replies = turn.choices.filter(c => !isBareLeave(c));
    const rows = replies.map((c, i) => new PanelButton(this, CHOICE_X, 0, CHOICE_W, `${i + 1}   ${c.text}`, () => this.choose(c)));
    const row: PanelButton[] = [];
    let say: PanelButton | null = null;
    if (!turn.wrap_up) {
      say = new PanelButton(this, CHOICE_X, 0, 214, 'Say something…', () => this.openSay(), { center: true, size: 17 });
      // Gift (§18): there's no inventory yet, so it only says so.
      const gift = new PanelButton(this, CHOICE_X + 222, 0, 100, 'Gift', () => this.toast("You've nothing to give yet."), { center: true, muted: true, size: 17 });
      row.push(say, gift);
      this.extraButtons.push(gift);
    }
    const leaveW = turn.wrap_up ? CHOICE_W : CHOICE_W - 330;
    const leave = new PanelButton(this, CHOICE_X + CHOICE_W - leaveW, 0, leaveW, 'Leave', () => this.choose(LEAVE), { center: true, size: 17 });
    row.push(leave);
    // Stack upward from just above the panel: the action row at the bottom, replies above it.
    let y = PANEL_Y - 30 - Math.max(...row.map(b => b.h));
    for (const b of row) b.moveTo(y);
    for (let i = rows.length - 1; i >= 0; i--) { y -= rows[i]!.h + CHOICE_GAP; rows[i]!.moveTo(y); }
    this.buttons = [...rows, ...(say ? [say] : []), leave];
    this.focus = 0;
    this.buttons.forEach((b, i) => b.setFocus(i === 0));
  }

  private hideButtons(): void {
    for (const b of [...this.buttons, ...this.extraButtons]) b.destroy();
    this.buttons = [];
    this.extraButtons = [];
  }

  private hideChoices(): void {
    this.choicesShown = false;
    this.hideButtons();
  }

  private moveFocus(step: number): void {
    if (!this.buttons.length) return;
    this.focus = (this.focus + step + this.buttons.length) % this.buttons.length;
    this.buttons.forEach((b, i) => b.setFocus(i === this.focus));
    playSfx('hover');
  }

  private choose(choice: TalkChoice): void {
    if (this.closed || this.generating) return;
    if (choice.intent === 'leave') { this.leave(isBareLeave(choice) ? null : choice.text); return; }
    void this.send({ kind: 'choice', choice_id: choice.id, text: choice.text, intent: choice.intent }, choice.text);
  }

  /** Leave: after a wrap-up the resident has said goodbye already; otherwise they say one (authored, free). */
  private leave(said: string | null = null): void {
    if (this.turn?.wrap_up || this.farewell) { this.close(); return; }
    const bye = this.makeQuietTurn({ kind: 'choice', choice_id: LEAVE.id, text: LEAVE.text, intent: 'leave' }, this.exchange);
    this.hideChoices();
    this.echo.setText(said ? `You: ${said}` : '');
    this.farewell = true;
    this.turn = bye;
    this.reader.reset();
    this.reader.finish(bye);
    this.restartQuietly();
    if (DEV_MARK) this.devMark.setText(`farewell · quiet${this.quietLine ? ` · ${this.quietLine}` : ''}`);
  }

  // ── Say something… ────────────────────────────────────────────────────────

  private openSay(): void {
    if (this.say || this.generating || !this.choicesShown) return;
    this.hideChoices();
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = SAY_MAX;
    input.placeholder = 'Say something…';
    input.setAttribute('aria-label', `Say something to ${displayName(this.card.name)}`);
    input.autocomplete = 'off';
    input.spellcheck = true;
    Object.assign(input.style, {
      position: 'fixed', zIndex: '10', boxSizing: 'border-box', margin: '0', padding: '0 0.6em', outline: 'none',
      background: 'rgba(31, 42, 34, 0.97)', color: '#fff0ce', border: '2px solid #e4c77f', borderRadius: '8px',
      fontFamily: 'Georgia, "Times New Roman", serif', caretColor: '#e4c77f'
    } satisfies Partial<CSSStyleDeclaration>);
    const hint = this.add.text(CHOICE_X + CHOICE_W, PANEL_Y - 18, '', {
      fontFamily: FAMILY_BODY, fontSize: '14px', color: MUTED, resolution: RENDER_SCALE
    }).setOrigin(1, 1).setDepth(41);
    const count = () => hint.setText(`Enter to say · Esc to cancel · ${input.value.length}/${SAY_MAX}`);
    count();
    // Keys typed here are the input's: Phaser (listening on window) never sees them, so W, A, S, D and E type.
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.submitSay(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); this.closeSay(true); }
    });
    input.addEventListener('keypress', e => e.stopPropagation());
    input.addEventListener('input', count);
    document.body.appendChild(input);
    this.say = { input, hint };
    this.placeInput(input);
    input.focus();
  }

  /** Keep the input over its design rect as the canvas is scaled. */
  private placeInput(input: HTMLInputElement): void {
    const rect = this.game.canvas.getBoundingClientRect();
    const s = rect.width / GAME_WIDTH;
    const x = CHOICE_X, y = PANEL_Y - 30 - 46 - 18, w = CHOICE_W, h = 46;
    input.style.left = `${rect.left + x * s}px`;
    input.style.top = `${rect.top + y * s}px`;
    input.style.width = `${w * s}px`;
    input.style.height = `${h * s}px`;
    input.style.fontSize = `${18 * s}px`;
  }

  private submitSay(raw: string): void {
    const text = raw.replace(/\s+/g, ' ').trim().slice(0, SAY_MAX);
    if (!text || this.generating) return;
    this.closeSay(false);
    void this.send({ kind: 'say', text }, text);
  }

  private closeSay(backToChoices: boolean): void {
    if (!this.say) return;
    this.say.input.remove();
    this.say.hint.destroy();
    this.say = null;
    if (backToChoices && this.turn && !this.closed) this.showChoices();
  }

  // ── The ⋯ menu ────────────────────────────────────────────────────────────

  private openMenu(): void {
    this.closeMenu();
    const x = PANEL_X + PANEL_W - 250, w = 230, rowH = 36;
    const items: [string, () => void][] = [
      ['Report line', () => this.report()],
      [`Text speed: ${this.speed[0]!.toUpperCase()}${this.speed.slice(1)}`, () => this.cycleSpeed()]
    ];
    const y0 = PANEL_Y - 8 - items.length * rowH - 8;
    const bg = this.add.graphics().setDepth(50);
    bg.fillStyle(PLATE, 0.98).fillRoundedRect(x, y0, w, items.length * rowH + 8, 8);
    bg.lineStyle(1, GOLD, 0.7).strokeRoundedRect(x, y0, w, items.length * rowH + 8, 8);
    this.menu.push(bg);
    items.forEach(([label, act], i) => {
      const t = this.add.text(x + 14, y0 + 4 + i * rowH + rowH / 2, label, {
        fontFamily: FAMILY_BODY, fontSize: '16px', color: CREAM, resolution: RENDER_SCALE
      }).setOrigin(0, 0.5).setDepth(51);
      const hit = this.add.rectangle(x, y0 + 4 + i * rowH, w, rowH, 0xffffff, 0).setOrigin(0).setDepth(52).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => hit.setFillStyle(0xffffff, 0.08));
      hit.on('pointerout', () => hit.setFillStyle(0xffffff, 0));
      hit.on('pointerup', () => { playSfx('click'); act(); });
      this.menu.push(t, hit);
    });
  }

  private closeMenu(): void {
    for (const o of this.menu) o.destroy();
    this.menu = [];
  }

  /** Report line (§18): the review queue is M-13; for now the ids go to the console. */
  private report(): void {
    this.closeMenu();
    const turn = this.turn;
    if (!turn) { this.toast('Nothing to report yet.'); return; }
    console.info('[dialogue] report line', {
      conversation_id: turn.conversation_id, resident_id: turn.resident_id, turn_index: turn.turn_index,
      line_index: this.reader.line, text: this.reader.stream.lines[this.reader.line] ?? '', fallback: turn.fallback, source: this.source
    });
    this.toast('Thanks. That line has been noted.');
  }

  private cycleSpeed(): void {
    this.speed = TEXT_SPEEDS[(TEXT_SPEEDS.indexOf(this.speed) + 1) % TEXT_SPEEDS.length]!;
    saveTextSpeed(browserStorage(), this.speed);
    this.openMenu();
  }

  private toast(text: string): void {
    this.tweens.killTweensOf(this.toastText);
    this.toastText.setText(text).setAlpha(1);
    this.tweens.add({ targets: this.toastText, alpha: 0, delay: 1600, duration: 400 });
  }

  // ── Keys ──────────────────────────────────────────────────────────────────

  private onKey(e: KeyboardEvent): void {
    if (this.closed || this.say) return;
    const key = e.key;
    if (key === 'Escape') {
      if (this.menu.length) this.closeMenu();
      else if (!this.generating) this.close(); // Esc closes only when no turn is streaming.
      return;
    }
    if (this.choicesShown) {
      if (/^[1-3]$/.test(key)) {
        const replies = this.turn!.choices.filter(c => !isBareLeave(c));
        const pick = replies[Number(key) - 1];
        if (pick) { playSfx('click'); this.choose(pick); }
        return;
      }
      if (key === 'ArrowDown' || (key === 'Tab' && !e.shiftKey)) { e.preventDefault(); this.moveFocus(1); return; }
      if (key === 'ArrowUp' || (key === 'Tab' && e.shiftKey)) { e.preventDefault(); this.moveFocus(-1); return; }
      if (key === 'Enter' || key === ' ') { e.preventDefault(); const b = this.buttons[this.focus]; if (b) { playSfx('click'); b.onClick(); } return; }
      if ((key === 't' || key === 'T') && !this.turn?.wrap_up) { e.preventDefault(); this.openSay(); return; }
      return;
    }
    if (key === 'Enter' || key === ' ') { e.preventDefault(); this.advance(); }
  }

  // ── Opening and closing ───────────────────────────────────────────────────

  private pauseWorld(paused: boolean): void {
    const host = this.scene.get(this.open.host);
    if (host?.input) {
      host.input.enabled = !paused;
      const keys = host.input.keyboard;
      if (keys) { keys.enabled = !paused; keys.resetKeys(); }
    }
    if (paused) this.open.clock.pause('dialogue'); else this.open.clock.resume('dialogue');
    // Duck the music only if there is some (getMusic would otherwise start a manager just to duck it).
    if (this.game.registry.has('monde:music')) getMusic(this).duck(paused);
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort?.abort();
    this.closeSay(false);
    this.closeMenu();
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 140, onComplete: () => this.scene.stop() });
  }

  /** On shutdown, however it came: give the world back. */
  private teardown(): void {
    this.closed = true;
    this.abort?.abort();
    this.closeSay(false);
    this.input.keyboard?.removeCapture('SPACE,TAB');
    this.pauseWorld(false);
  }
}
