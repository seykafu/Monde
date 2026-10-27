import { choiceViewport } from '../ui/choiceViewport';
import { textSize, accessibility } from '../accessibility/runtime';
import { telemetry } from '../telemetry/emit';
import { JoinedChatter } from './zone/joinChatter';
import type { ChatterJoin } from './zone/chatter';
import { updateFriendship } from "./friendship";
import { favorBook, chooseFavor, favorProof, finishFavor } from "../friendship/favors";
import { openPeople } from './PeopleScene';
import { SPRING_RIDDLES } from '@monde/shared';
import { getFellow, setFellow } from '../fellow/state';
import { gainXp } from '@monde/shared';
import { containsAnswer, type SavedFriendship } from '@monde/shared';
import { openBag } from '../economy/BagScene';
import { giveGift, shareMeal } from '../economy/runtime';
import { findMark, marks, refreshHints } from './riddles';
import { requestHint, riddle } from '../riddles/engine';
import { quietStorage } from '../save/session';
// The VN dialogue panel (GDD §9.10 flow, §18 Dialogue; MVP M-05 client, M-11 Quiet Mode).
//
// Launched over ZoneScene when the player presses E beside a resident (`talk-requested`). The zone keeps
// running underneath with its input paused; the clock is held for "dialogue" and the music ducked until the
// panel closes. Layout follows Ravage's StoryScene, adapted: a dimmed, tinted backdrop (zone backdrops are
// art still to come), the resident's portrait on the left (dialogue/portrait.ts: their art if the manifest
// lists it, else a procedural cartoon bust) showing one of six expressions per line, a name plate that
// shimmers softly while a turn is generating (no spinner), and a typewriter body with pages.
//
// The player's own words (a reply or "Say something…") show first, under a "You" plate with the resident
// dimmed, before the reply types in, so it reads as an exchange; then they stay as a one-line echo. The Log
// button (or L) opens this conversation so far.
//
// Streaming: line_delta text feeds a DialogueReader (mind/reader.ts), which types only what has arrived, so
// nothing on screen is taken back unless the stream itself starts over (a new attempt, or a final turn that
// doesn't continue it); then the body clears and starts again, quietly. If nothing is visible by 2.5 s the
// resident plays the "Hm." thinking beat. The final `turn` brings the choices: 1–3 (keys or click),
// "Say something…" (a DOM text input, ≤ 140 characters), Gift, Leave, Log, and a small "⋯" menu with Report
// line and the text speed. Quiet Mode turns carry a small "offline · written lines" note under the panel (§9.14);
// a server fallback looks like a live turn (`?dev` adds a tiny marker).
import Phaser from 'phaser';
import { FAMILY_BODY, FAMILY_HEADING, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import { getMusic } from '../audio/Music';
import { playSfx } from '../audio/Sfx';
import { maxLinesFor, paginateBody } from '../ui/fitText';
import type { Clock } from '../sim/clock';
import { hashString } from '../sim/plans';
import type { ResidentState } from '../sim/routineExecutor';
import type { WeatherNow } from '../sim/weather';
import { districtOf, type ZoneDef } from '../world/zoneFormat';
import { personaCards } from '../world/residents';
import { displayName } from '../sim/residentSim';
import { Rng } from '../util/rng';
import type { ResidentLayer } from './zone/residents';
import { browserStorage, getMind, uuid, type TalkResult } from '../mind/api';
import { talkContext } from '../mind/context';
import { offlineMarker } from '../mind/connection';
import { lineLibrary } from '../mind/lineLibrary';
import { scriptedTurn, type ScriptedExchange } from '../mind/scripted';
import { loadQuietState, loadTextSpeed, saveQuietState, saveTextSpeed } from '../mind/prefs';
import { markReply } from '../mind/markReply';
import { MARK_HELPERS, questQuietLine, questReply } from '../mind/questTalk';
import { talkQuest } from '../mind/questSources';
import { firstName, quietContext, quietTurn, QUIET_CHOICES, type QuietState } from '../mind/quietMode';
import { DialogueReader, MS_PER_CHAR, TEXT_SPEEDS, type TextSpeed } from '../mind/reader';
import type { TalkChoice, TalkContext, TalkInput, TalkTurn } from '../mind/types';
import { Portrait, prefetchPortrait } from '../dialogue/portrait';
import { PORTRAIT_H, PORTRAIT_W, portraitArtId, portraitLook, shadeColour, type PortraitLook } from '../dialogue/portraitModel';
import { rosterEntry } from '../world/roster';
import { prewarmRange, prewarmTier } from '../mind/prewarm';
import { Backlog, type LogEntry } from '../dialogue/backlog';
import { HeartRowView, heartTexture } from '../ui/hearts';
import { HEART_ANIMATION, heartFeedback, type HeartFeedback } from '../friendship/hearts';
import { meetResident, recordDialogueTurn, regardFor } from './friendship';
import { callName, isBareLeave, normalizeChoices, type PersonaCard, type TalkQuest } from '@monde/shared';

export const DIALOGUE_SCENE = 'Dialogue';

export interface DialogueOpen {
  /** Join an overheard exchange; both routines remain held until shutdown. */
  chatter?: ChatterJoin;
  /** The scene underneath: its input is paused while the panel is open. */
  host: string;
  clock: Clock;
  residentId: string;
  playerPosition?: { x: number; y: number };
  zone: ZoneDef;
  /** Where the resident is and what they're doing (the routine executor's state). */
  state: ResidentState | null;
  weather: WeatherNow;
  /** A scripted {ai_open} handoff (§13.1): what the conversation is about, sent as the scene's activity (≤ 120). */
  topic?: string;
  /** {ai_open}'s cap: once the resident has answered this many replies, only Leave is offered. */
  turns?: number;
  /** The scene's `zone.place`, when the conversation belongs to a scripted scene. */
  place?: string;
  /** The canned exchange for this {ai_open} cue (content/lines/scripted.yaml): Quiet Mode plays it instead of small talk. */
  scripted?: ScriptedExchange;
}

/** On `game.events` when the panel closes, however it closed: the story resumes a scene on it. */
export const DIALOGUE_CLOSED = 'monde:dialogue-closed';
export interface DialogueClosed { residentId: string; exchanges: number; log: readonly LogEntry[] }

/**
 * Wire a zone scene for dialogue: open the panel on `talk-requested`, and prewarm residents the player walks
 * near (§9.10 step 1). Undone when the host shuts down.
 */
export function attachDialogue(host: Phaser.Scene, opts: { residents: ResidentLayer; zone: ZoneDef; clock: Clock; weather: () => WeatherNow; playerPosition?: () => { x: number; y: number } }): void {
  const off = opts.residents.sim.events.on('talk-requested', e => {
    if (host.scene.isActive(DIALOGUE_SCENE) || !CARDS.has(e.residentId)) return;
    const data: DialogueOpen = {
      host: host.scene.key, clock: opts.clock, residentId: e.residentId, zone: opts.zone,
      state: opts.residents.stateOf(e.residentId), weather: opts.weather(), playerPosition: opts.playerPosition?.()
    };
    data.chatter = opts.residents.chatter.join(e.residentId);
    host.scene.launch(DIALOGUE_SCENE, data);
  });
  opts.residents.chatter.weather = () => opts.weather().kind;
  // Ambient residents (most of the Day-1 census, MVP M-03) prewarm closer and fewer a day (mind/prewarm.ts).
  const tier = (id: string) => prewarmTier(CARDS.get(id)?.card.kind, (host.registry.get('monde.friendship') as SavedFriendship | undefined)?.tiers?.[id]);
  opts.residents.approachRange = id => prewarmRange(tier(id));
  opts.residents.onApproach = id => {
    const card = CARDS.get(id)?.card;
    if (!card) return;
    getMind().prewarmNear(id, opts.clock.day, opts.clock.minute, tier(id));
    // The likely ones' portraits too, so the conversation opens on the art. Not every passer-by's: a sheet is ~6 MB of
    // texture memory that stays, so Ambient residents' load when a conversation opens, as before.
    if (tier(id) !== 'ambient') prefetchPortrait(host, portraitArtId(card));
  };
  host.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { off(); opts.residents.onApproach = undefined; opts.residents.approachRange = undefined; });
}

/** Everyone with a card, the generated residents who have arrived included (G-02, world/roster.ts). */
const CARDS: Pick<ReadonlyMap<string, { card: PersonaCard; index: number }>, 'has' | 'get'> = { has: id => !!rosterEntry(id), get: id => rosterEntry(id) };
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
const BODY_MAX_LINES = () => maxLinesFor(textSize(BODY_FONT), BODY_SPACING, PANEL_H - 40 - 30);
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
/** §9.10 step 4: nothing visible by 2.5 s → the authored thinking beat (the server sends one too). */
const THINKING_MS = 2500;
/** Free text is at most 140 characters (§9.10). */
const SAY_MAX = 140;
/** Voice blips are 45 ms long: no closer together than this, whatever the text speed. */
const BLIP_GAP_MS = 55;
/**
 * GDD-GAP: §18 doesn't time the player's echoed line. It types at 6 ms a character and holds for 500 ms plus
 * 15 ms a character (at most 1.4 s; any key or click skips it), long enough to read as an exchange but under
 * a live turn's usual wait, so it rarely delays the reply.
 */
export const PLAYER_LINE = { msPerChar: 6, holdMs: 500, perCharMs: 15, maxMs: 1400 } as const;
const BODY_COLOUR = '#f3ecd9';
const PLAYER_COLOUR = '#f6dc9c';

/**
 * GDD-GAP: §17/§18 give residents voice blips but no pitches. Children sit high and elders low: 316 Hz less
 * 1.6 Hz a year (Tib at 11 ≈ 298 Hz, Bertrand at 84 ≈ 182 Hz), floored at 150, with a ±12 Hz offset per
 * resident so two of an age don't sound alike.
 */
export const voiceFrequency = (age: number, id: string): number =>
  Math.max(150, Math.min(320, 316 - 1.6 * age)) + ((hashString(id) % 25) - 12);

// ── Portrait colours ────────────────────────────────────────────────────────

/** The resident's roster colour, as their sprite wears it (scenes/zone/residents.ts). */
const rosterColour = (index: number): number => Phaser.Display.Color.HSLToColor(((index * 137.508) % 360) / 360, 0.52, 0.56).color;

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
      fontFamily: FAMILY_BODY, fontSize: `${textSize(size)}px`, color: opts.muted ? MUTED : CREAM, resolution: RENDER_SCALE,
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
  private joined: JoinedChatter | null = null;
  private secondaryPortrait: Portrait | null = null;
  private shownReplies: TalkChoice[] = [];
  private card!: PersonaCard;
  private look!: PortraitLook;
  private context!: TalkContext;
  private conversationId = '';
  private serverConversationId: string | null = null;
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
  /** The scripted exchange's node shown at each turn (by turn index), so a retried turn finds its place again. */
  private scriptedNodes: Record<number, string> = {};
  private reader!: DialogueReader;
  // Presentation.
  private body!: Phaser.GameObjects.Text;
  private echo!: Phaser.GameObjects.Text;
  private more!: Phaser.GameObjects.Text;
  private devMark!: Phaser.GameObjects.Text;
  /** "offline · written lines" under the panel while residents speak from the line library (§9.14). */
  private offlineNote!: Phaser.GameObjects.Text;
  /** The code of this turn's server `error` event, if any (`unavailable`: the server has no model either). */
  private serverError: string | null = null;
  private toastText!: Phaser.GameObjects.Text;
  private portrait!: Portrait;
  private plateW = 0;
  /** The resident's name plate, dimmed while the player speaks; the player's own "You" plate. */
  private residentPlate: Phaser.GameObjects.GameObject[] = [];
  private youPlate!: Phaser.GameObjects.Container;
  /** The player's line on show (null when the resident has the floor), when it started and until when. */
  private playerLine: string | null = null;
  private playerStart = 0;
  private playerUntil = 0;
  /** This conversation so far, for the Log. */
  private log: LogEntry[] = [];
  private backlog: Backlog | null = null;
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
  private scrollChoices: (index: number) => void = () => undefined;
  private menu: Phaser.GameObjects.GameObject[] = [];
  private say: { input: HTMLInputElement; hint: Phaser.GameObjects.Text } | null = null;
  /** The name plate's hearts (§9.11.1), and a turn's Regard feedback waiting for the reply to be read (§9.11.2). */
  private hearts: HeartRowView | null = null;
  private feedback: HeartFeedback | null = null;
  private giftFeedback: HeartFeedback | null = null;

  constructor() { super(DIALOGUE_SCENE); }

  private usedMarks = new Set<string>();
  /** The quest reply ("What should I be doing?") is offered at most once a conversation (mind/questTalk.ts). */
  private usedQuest = false;

  init(data: DialogueOpen): void {
    this.usedMarks.clear();
    this.usedQuest = false;
    this.open = data;
    const other = data.chatter ? CARDS.get(data.chatter.secondary) : undefined;
    this.joined = other && data.chatter ? new JoinedChatter(data.chatter, displayName(other.card.name), displayName(CARDS.get(data.residentId)!.card.name), other.card.voice.mode === 'narrated_action') : null;
    this.secondaryPortrait = null;
    const entry = CARDS.get(data.residentId)!;
    this.card = entry.card;
    this.look = portraitLook(entry.card, rosterColour(entry.index));
    this.context = talkContext({ day: data.clock.day, minute: data.clock.minute, state: data.state, zone: data.zone, weather: data.weather });
    if (data.topic) this.context = { ...this.context, current_activity: data.topic.slice(0, 120) };
    if (data.place) this.context = { ...this.context, place: data.place };
    this.conversationId = uuid();
    this.serverConversationId = null;
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
    this.quiet = loadQuietState(quietStorage);
    this.quietLine = null;
    this.serverError = null;
    this.scriptedNodes = {};
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
    this.residentPlate = [];
    this.playerLine = null;
    this.playerStart = 0;
    this.playerUntil = 0;
    this.log = (data.chatter?.lines ?? []).map(l => ({ who: 'resident', text: `${displayName(CARDS.get(l.speaker)?.card.name ?? l.speaker)}: ${l.text}` }));
    if (this.joined) this.context = { ...this.context, current_activity: `Talking with ${this.joined.name} and the Fellow. ${data.chatter?.lines.at(-1)?.text ?? ''}`.slice(0, 120) };
    this.backlog = null;
    this.hearts = null;
    this.feedback = null;
    this.giftFeedback = null;
  }

  create(): void {
    telemetry({ type: 'conversation_started', day: this.open.clock.day, resident: this.open.residentId });
    this.scene.bringToTop();
    this.pauseWorld(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());

    // Backdrop: the zone dimmed under a soft tint, darker toward the panel.
    const tint = this.look.colour;
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x10140f, 0.42).setOrigin(0);
    const wash = this.add.graphics();
    wash.fillGradientStyle(shadeColour(tint, 0.35), shadeColour(tint, 0.35), 0x0c100d, 0x0c100d, 0.18, 0.18, 0.72, 0.72).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    // Anywhere that isn't a button advances the text.
    this.add.zone(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0).setInteractive().on('pointerdown', () => this.advance());

    // Portrait (left), then the panel over its lower edge.
    this.portrait = new Portrait(this, { residentId: portraitArtId(this.card), look: this.look, x: PORTRAIT_X, y: PORTRAIT_Y, label: true });
    if (this.joined) {
      const other = CARDS.get(this.joined.join.secondary)!;
      this.secondaryPortrait = new Portrait(this, { residentId: portraitArtId(other.card), look: portraitLook(other.card, rosterColour(other.index)),
        x: PORTRAIT_X + PORTRAIT_W + 20, y: PORTRAIT_Y, label: true });
      this.secondaryPortrait.setDimmed(true);
    }
    this.setExpr('neutral');
    const panel = this.add.graphics();
    panel.fillStyle(INK, 0.95).fillRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 14);
    panel.lineStyle(2, GOLD, 0.6).strokeRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 14);
    panel.lineStyle(1, GOLD, 0.2).strokeRoundedRect(PANEL_X + 5, PANEL_Y + 5, PANEL_W - 10, PANEL_H - 10, 11);

    // Name plate, with its shimmer while a line is generating.
    const name = this.add.text(PLATE_X + 20, PLATE_Y + PLATE_H / 2, displayName(this.card.name), {
      fontFamily: FAMILY_HEADING, fontSize: '23px', color: CREAM, resolution: RENDER_SCALE
    }).setOrigin(0, 0.5).setDepth(11);
    // Hearts after the name (§9.11.1): the Regard the client mirrors; they fill or drain after a reply that moved it.
    meetResident(this.registry, this.card.id, this.open.clock.day);
    const heartsX = PLATE_X + 20 + Math.ceil(name.width) + 16;
    this.hearts = new HeartRowView(this, heartsX, PLATE_Y + PLATE_H / 2, 2, 1);
    this.hearts.container.setDepth(11);
    this.hearts.setRegard(regardFor(this.registry, this.card.id));
    this.plateW = Math.max(PORTRAIT_W + 8, heartsX - PLATE_X + this.hearts.width + 16);
    const plate = this.add.graphics().setDepth(10);
    plate.fillStyle(PLATE, 1).fillRoundedRect(PLATE_X, PLATE_Y, this.plateW, PLATE_H, 9);
    plate.lineStyle(2, GOLD, 0.85).strokeRoundedRect(PLATE_X, PLATE_Y, this.plateW, PLATE_H, 9);
    this.shimmer = this.add.graphics().setDepth(12).setBlendMode(Phaser.BlendModes.ADD);
    this.residentPlate = [name, this.hearts.container];
    // The player's plate, on the right, shown while their own line is up.
    const you = this.add.text(0, PLATE_H / 2, 'You', { fontFamily: FAMILY_HEADING, fontSize: '21px', color: '#e9f4ea', resolution: RENDER_SCALE }).setOrigin(0.5);
    const youW = Math.ceil(you.width) + 44;
    const youBg = this.add.graphics();
    youBg.fillStyle(0x2d4a43, 1).fillRoundedRect(-youW / 2, 0, youW, PLATE_H, 9);
    youBg.lineStyle(2, 0x9fd3b6, 0.85).strokeRoundedRect(-youW / 2, 0, youW, PLATE_H, 9);
    this.youPlate = this.add.container(PANEL_X + PANEL_W - 130 - youW / 2, PLATE_Y, [youBg, you]).setDepth(10).setAlpha(0);

    const bodyStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: FAMILY_BODY, fontSize: `${textSize(BODY_FONT)}px`, color: '#f3ecd9', lineSpacing: BODY_SPACING,
      wordWrap: { width: BODY_W }, resolution: RENDER_SCALE
    };
    this.body = this.add.text(PANEL_X + PAD, BODY_Y, '', bodyStyle);
    const measure = this.add.text(0, 0, '', bodyStyle).setVisible(false);
    this.reader = new DialogueReader(text => paginateBody(measure, text, BODY_MAX_LINES()));
    this.echo = this.add.text(PLATE_X + this.plateW + 18, PANEL_Y + 10, '', {
      fontFamily: FAMILY_BODY, fontSize: '15px', fontStyle: 'italic', color: MUTED, resolution: RENDER_SCALE,
      wordWrap: { width: PANEL_X + PANEL_W - 120 - (PLATE_X + this.plateW + 18) }, maxLines: 1
    });
    this.more = this.add.text(PANEL_X + PANEL_W - 22, PANEL_Y + PANEL_H - 12, '', {
      fontFamily: FAMILY_BODY, fontSize: '16px', color: '#e4c77f', resolution: RENDER_SCALE
    }).setOrigin(1, 1);
    this.tweens.add({ targets: this.more, alpha: 0.45, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.devMark = this.add.text(PANEL_X + 14, PANEL_Y + PANEL_H - 8, '', {
      fontFamily: FAMILY_BODY, fontSize: '11px', color: '#8f8a78', resolution: RENDER_SCALE
    }).setOrigin(0, 1).setVisible(DEV_MARK);
    this.offlineNote = this.add.text(PANEL_X + PANEL_W - 22, PANEL_Y + PANEL_H + 3, '', {
      fontFamily: FAMILY_BODY, fontSize: '12px', fontStyle: 'italic', color: MUTED, resolution: RENDER_SCALE
    }).setOrigin(1, 0);
    // Small notes ("Thanks. That line has been noted.") along the panel's foot, clear of the choices.
    this.toastText = this.add.text(PANEL_X + PANEL_W / 2, PANEL_Y + PANEL_H - 22, '', {
      fontFamily: FAMILY_BODY, fontSize: `${textSize(16)}px`, wordWrap: { width: PANEL_W - 48 }, color: CREAM, backgroundColor: '#28372d', padding: { x: 12, y: 6 }, resolution: RENDER_SCALE
    }).setOrigin(0.5).setDepth(60).setAlpha(0);

    // "⋯": Report line and the text speed.
    const dots = this.add.text(PANEL_X + PANEL_W - 22, PANEL_Y + 8, '⋯', {
      fontFamily: FAMILY_BODY, fontSize: '24px', color: '#e4c77f', padding: { x: 8, y: 0 }, resolution: RENDER_SCALE
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    dots.on('pointerup', () => (this.menu.length ? this.closeMenu() : this.openMenu()));
    // Log: this conversation so far (also the L key).
    const logButton = this.add.text(PANEL_X + PANEL_W - 64, PANEL_Y + 13, 'Log', {
      fontFamily: FAMILY_BODY, fontSize: '16px', color: '#e4c77f', padding: { x: 6, y: 2 }, resolution: RENDER_SCALE
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    logButton.on('pointerover', () => logButton.setColor('#fff0ce'));
    logButton.on('pointerout', () => logButton.setColor('#e4c77f'));
    logButton.on('pointerup', () => { playSfx('click'); this.time.delayedCall(0, () => (this.backlog ? this.closeLog() : this.openLog())); });

    const keyboard = this.input.keyboard!;
    keyboard.addCapture('SPACE,TAB,UP,DOWN');
    keyboard.on('keydown', (e: KeyboardEvent) => this.onKey(e));

    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 160 });
    void this.send({ kind: 'open' }, null);
  }

  update(time: number, delta: number): void {
    if (this.closed) return;
    if (this.playerLine !== null) {
      // The player's own line has the floor: the reply waits (it keeps streaming into the reader meanwhile).
      const now = this.time.now;
      if (now < this.playerUntil) {
        const line = this.playerLine;
        const n = this.speed === 'instant' ? line.length : Math.min(line.length, Math.floor((now - this.playerStart) / PLAYER_LINE.msPerChar));
        const text = line.slice(0, n);
        if (text !== this.shownBody) {
          this.shownBody = text;
          this.body.setText(text).setFontStyle('normal').setColor(PLAYER_COLOUR).setAlpha(1);
        }
        this.more.setText('');
        this.drawShimmer(time);
        return;
      }
      this.endPlayerLine();
    }
    const typed = this.reader.tick(delta, MS_PER_CHAR[loadTextSpeed(browserStorage())]);
    if (typed) this.blip(typed, time);
    const text = this.reader.hasText ? this.reader.visible : this.thinking ?? '';
    if (text !== this.shownBody) {
      this.shownBody = text;
      this.body.setText(text).setColor(BODY_COLOUR).setFontStyle(this.reader.hasText ? 'normal' : 'italic').setAlpha(this.reader.hasText ? 1 : 0.8);
    }
    // A streamed line has no expression until its turn arrives: keep the last one (or "thinking" during the beat).
    const lineExpr = this.reader.expr();
    if (lineExpr) this.restExpr = lineExpr;
    this.setExpr(lineExpr ?? (this.thinking && !this.reader.hasText ? 'thinking' : this.restExpr));
    const status = this.reader.status();
    if (this.feedback && !this.generating && status === 'done') this.playFeedback(this.feedback);
    if (!this.generating && this.turn && status === 'done' && !this.choicesShown && !this.farewell && !this.say) this.showChoices();
    this.more.setText(status === 'more' ? 'More ▾' : status === 'next' ? '▸' : this.farewell && status === 'done' ? 'Close ▸' : '');
    this.drawShimmer(time);
    if (this.say) this.placeInput(this.say.input);
  }

  // ── Turns ─────────────────────────────────────────────────────────────────

  private async send(input: TalkInput, echo: string | null): Promise<void> {
    if (input.kind === 'gift' || input.kind === 'meal') this.context = { ...this.context, riddle: null };
    const seq = ++this.requestSeq;
    this.serverError = null;
    this.generating = true;
    this.turn = null;
    this.thinking = null;
    this.reader.reset();
    this.restartQuietly();
    this.hideChoices();
    if (echo) this.speakAsPlayer(echo);
    else this.echo.setText('');
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
          { resident_id: this.card.id, conversation_id: this.conversationId, input, context: { ...this.context, heart_level: getFellow(this.registry)?.skills.heart.level ?? 1, quest: this.quest() } },
          {
            signal: abort.signal, fallback,
            onLineDelta: d => { if (seq === this.requestSeq && this.reader.delta(d) === 'reset') this.restartQuietly(); },
            onThinking: t => this.onThinking(t, seq),
            onError: e => { if (seq === this.requestSeq) this.serverError = e.code; if (DEV_MARK) this.devMark.setText(`server fell back: ${e.code}`); }
          })
        : { turn: fallback(), source: 'quiet', reason: 'offline' };
    } catch (error) {
      // Nothing should throw here, but a conversation must never dead-end: say something authored instead.
      console.warn('[dialogue] turn failed; using Quiet Mode', error);
      result = { turn: fallback(), source: 'quiet', reason: 'error' };
    }
    if (this.closed || seq !== this.requestSeq || !result) return;
    if (input.kind === 'say' || input.kind === 'choice') {
      const fellow = getFellow(this.registry);
      // GDD-GAP: each completed reply earns 5 Heart XP, including Quiet Mode.
      if (fellow) setFellow(this.registry, { ...fellow, skills: gainXp(fellow.skills, 'heart', 5) });
    }
    if (this.joined) {
      const comment = await this.joined.comment(input, this.context, abort.signal);
      if (this.closed || seq !== this.requestSeq) return;
      if (comment) result.turn = { ...result.turn, lines: [...result.turn.lines,
        ...comment.lines.map(l => ({ ...l, text: `${this.joined!.name}: ${l.text}` }))] };
    }
    this.onTurn(result.turn, result.source, result.reason);
  }

  private onThinking(text: string, seq: number): void {
    if (this.closed || seq !== this.requestSeq || !this.generating || this.reader.hasText || this.thinking) return;
    this.thinking = text || THINKING_BEAT;
    // "Hm." plus a fidget.
    this.portrait.fidget();
  }

  private onTurn(turn: TalkTurn, source: 'server' | 'quiet', reason?: string): void {
    this.generating = false;
    this.thinkTimer?.remove();
    this.source = source;
    if (source === 'server') {
      this.conversationId = turn.conversation_id;
      this.serverConversationId = turn.conversation_id;
      if (turn.resumed) {
        this.log = [...(this.open.chatter ? this.log : []), ...(turn.history ?? []), { who: 'resident', text: '(picking up where you left off)' }];
        const touch = this.add.text(PANEL_X + 24, PANEL_Y - 24, '(picking up where you left off)', { fontSize: '14px', color: '#e4c77f' });
        this.time.delayedCall(3500, () => touch.destroy());
      }
    }
    if (turn.favors?.length) updateFriendship(this.registry,s => ({ ...s, favor_book: [...s.favor_book,...turn.favors!.filter(f => !s.favor_book.some(old => old.id === f.id))] }));
    const ask = favorBook(this.registry).find(f => f.resident_id === this.card.id && f.status === 'proposed' && f.expires_day >= this.open.clock.day);
    if (ask && !turn.lines.some(l => l.text.includes(ask.text))) turn = { ...turn,lines: [...turn.lines,{ text: ask.text,expr: 'neutral' }] };
    this.turn = this.tidy(turn);
    for (const line of this.turn.lines) this.log.push({ who: 'resident', text: line.text });
    this.exchange = turn.turn_index + 1;
    // §9.11.2: the server's applied Regard (Quiet Mode turns carry none); shown once the reply has been read.
    recordDialogueTurn(this.registry, this.card.id, this.open.clock.day, turn, source === 'server' && !turn.fallback);
    this.feedback = this.giftFeedback ?? (source === 'server' ? heartFeedback(turn.regard) : null);
    this.giftFeedback = null;
    if (this.reader.finish(this.turn) === 'reset') this.restartQuietly();
    this.offlineNote.setText(offlineMarker(source, reason, this.serverError) ?? '');
    if (DEV_MARK) {
      const what = source === 'quiet' ? `quiet${this.quietLine ? ` · ${this.quietLine}` : ''}${reason ? ` (${reason})` : ''}` : turn.fallback ? 'server fallback' : 'live';
      this.devMark.setText(`${what} · turn ${turn.turn_index}${turn.wrap_up ? ' · wrap-up' : ''}`);
    }
  }

  /**
   * Two or three numbered replies, then Leave; after a wrap-up, only Leave (§9.10 step 6). The replies go
   * through the same guarantee as the server's (shared normalizeChoices): distinct, at most one goodbye, and
   * padded with replies to the last line if a turn came up short. A goodbye the model wrote in its own words
   * ("I'd better get going.") stays among the numbered replies; a bare "Leave" becomes the Leave button,
   * which is always there.
   */
  private tidy(turn: TalkTurn): TalkTurn {
    const leave = turn.choices.find(c => isBareLeave(c)) ?? LEAVE;
    if (turn.wrap_up || (this.open.turns !== undefined && turn.turn_index >= this.open.turns)) return { ...turn, wrap_up: true, choices: [leave] };
    const replies = normalizeChoices(turn.choices, { cue: { text: turn.lines.at(-1)?.text ?? '' }, name: callName(this.card.name), four: (getFellow(this.registry)?.skills.heart.level ?? 1) >= 5 });
    return { ...turn, choices: [...replies, leave] };
  }

  private makeQuietTurn(input: TalkInput, turnIndex: number): TalkTurn {
    const { clock, weather, zone } = this.open;
    // An {ai_open} cue with a written exchange: play it while the conversation is still on its branches (it opened
    // here); once a live turn has come in between, there's nothing to continue and ordinary Quiet Mode takes over.
    if (this.context.riddle) {
      const topic = this.context.riddle, record = riddle(topic.id);
      const text = record?.hints.slice(0, topic.hints_allowed).filter((h): h is string => !!h && !containsAnswer(h, record!.accepted)).at(-1) ?? "I'm stumped. Give it a little time.";
      return { conversation_id: this.conversationId, resident_id: this.card.id, turn_index: turnIndex, lines: [{ text, expr: 'thinking' }], choices: [{ id: 'a', text: 'Thank you.', intent: 'kind' }], wrap_up: false, fallback: true };
    }
    // The quest reply, offline: the Journal's own words (mind/questTalk.ts), not small talk.
    if (input.kind === 'choice' && input.intent === 'about_quest' && this.card.voice.mode !== 'narrated_action') {
      return { conversation_id: this.conversationId, resident_id: this.card.id, turn_index: turnIndex, lines: [{ text: questQuietLine(this.quest()), expr: 'neutral' }], choices: [{ id: 'a', text: 'Thank you.', intent: 'kind' }], wrap_up: false, fallback: true };
    }
    const canned = input.kind !== 'gift' && input.kind !== 'meal' && this.open.scripted && scriptedTurn(this.open.scripted, this.scriptedNodes[turnIndex - 1] ?? null, input, {
      conversationId: this.conversationId, residentId: this.card.id, turnIndex, vars: { name: firstName(this.card.name), player: getMind().playerName }
    });
    if (canned) {
      this.scriptedNodes[turnIndex] = canned.at;
      this.quietLine = `${this.open.scripted!.key}:${canned.at}`;
      return canned.turn;
    }
    // GDD-GAP: resident mood lives on the server and isn't mirrored to the client yet (§9.4), and there's no client
    // event log or flag store, so Quiet Mode speaks at an even mood, with no town event and no flags set. Regard is
    // the client's mirror (scenes/friendship.ts): the last the server reported, or the Background's start.
    const { kind: _kind, ...context } = quietContext({
      kind: 'talk', day: clock.day, minute: clock.minute, weather: weather.kind, zone: districtOf(zone), valence: 0, regard: regardFor(this.registry, this.card.id),
      neverSays: this.card.voice.mode === 'narrated_action' ? [] : this.card.voice.never_says,
      event: null, speaker: { id: this.card.id, name: this.card.name }, player: getMind().playerName, residents: FIRST_NAMES
    });
    const rng = new Rng(hashString(`${this.conversationId}:${turnIndex}`));
    const { turn, pick } = quietTurn({
      lib: lineLibrary, state: this.quiet, rng: () => rng.next(), conversationId: this.conversationId,
      residentId: this.card.id, turnIndex, input, context, narrated: this.card.voice.mode === 'narrated_action'
    });
    this.quietLine = pick?.line.id ?? null;
    saveQuietState(quietStorage, this.quiet);
    return turn;
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  private advance(): void {
    if (this.closed || this.say) return;
    if (this.backlog) { this.closeLog(); return; }
    if (this.menu.length) { this.closeMenu(); return; }
    if (this.playerLine !== null) { this.playerUntil = 0; return; }
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
    // A joined exchange sets the first expression in create(), before the reader exists.
    const secondary = !!this.joined && !!this.reader && (this.reader.stream.lines[this.reader.line] ?? '').startsWith(`${this.joined.name}:`);
    const key = this.joined ? `${secondary}:${expr}` : expr;
    if (key === this.shownExpr) return;
    this.shownExpr = key;
    this.portrait.setDimmed(secondary);
    this.secondaryPortrait?.setDimmed(!secondary);
    if (secondary) this.secondaryPortrait?.setExpression(expr);
    else this.portrait.setExpression(expr);
  }

  // ── The player's line and the Log ─────────────────────────────────────────

  /** The player said something (a reply, free text or a worded goodbye): it takes the floor briefly. */
  private speakAsPlayer(text: string): void {
    this.playerLine = text;
    this.playerStart = this.time.now;
    this.playerUntil = this.time.now + Math.min(PLAYER_LINE.maxMs, PLAYER_LINE.holdMs + PLAYER_LINE.perCharMs * text.length);
    this.log.push({ who: 'player', text });
    this.echo.setText('');
    this.shownBody = '\u0000';
    this.tweens.killTweensOf([this.youPlate, ...this.residentPlate]);
    this.tweens.add({ targets: this.youPlate, alpha: 1, duration: 100 });
    this.tweens.add({ targets: this.residentPlate, alpha: 0.45, duration: 100 });
    this.portrait.setDimmed(true);
  }

  /** The resident has the floor again; the player's words stay as the one-line echo. */
  private endPlayerLine(): void {
    const said = this.playerLine;
    this.playerLine = null;
    this.echo.setText(said ? `You: ${said}` : '');
    this.restartQuietly();
    this.tweens.killTweensOf([this.youPlate, ...this.residentPlate]);
    this.tweens.add({ targets: this.youPlate, alpha: 0, duration: 120 });
    this.tweens.add({ targets: this.residentPlate, alpha: 1, duration: 120 });
    this.portrait.setDimmed(false);
  }

  private openLog(): void {
    if (this.backlog || this.closed || this.say) return;
    this.closeMenu();
    this.backlog = new Backlog(this, { x: PANEL_X, y: 36, w: PANEL_W, h: PANEL_Y - 36 - 24 }, this.log, displayName(this.card.name), () => this.closeLog());
  }

  private closeLog(): void {
    this.backlog?.destroy();
    this.backlog = null;
  }

  /**
   * §9.11.2 feedback, after the reply: the hearts fill or drain half a heart at a time, a small ♥ floats up from
   * the portrait (a cracked one for a loss), and each new whole heart plays the chime.
   */
  private playFeedback(f: HeartFeedback): void {
    this.feedback = null;
    const hearts = this.hearts;
    if (!hearts) return;
    this.floatHeart(f.float, HEART_ANIMATION.leadMs);
    f.steps.forEach((row, i) => {
      if (i === 0) return;
      this.time.delayedCall(HEART_ANIMATION.leadMs + i * HEART_ANIMATION.stepMs, () => {
        if (this.closed) return;
        hearts.set(row, true);
        if (f.chimes.includes(i)) playSfx('heart_chime');
      });
    });
  }

  private floatHeart(kind: HeartFeedback['float'], delay: number): void {
    // From the portrait's right edge at cheek height, rising clear of the frame.
    const x = PORTRAIT_X + PORTRAIT_W + 14, y = PORTRAIT_Y + 112;
    const img = this.add.image(x, y, heartTexture(this, kind === 'heart' ? 'full' : 'cracked')).setScale(0).setAlpha(0).setDepth(30);
    this.tweens.add({ targets: img, delay, alpha: 1, scale: 3, duration: 200, ease: 'Back.easeOut' });
    this.tweens.add({ targets: img, delay: delay + 120, y: y - 64, duration: 1150, ease: 'Sine.easeOut' });
    this.tweens.add({ targets: img, delay: delay + 850, alpha: 0, duration: 420, onComplete: () => img.destroy() });
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
    const favor = favorBook(this.registry).find(f => f.resident_id === this.card.id && f.status === 'proposed' && f.expires_day >= this.open.clock.day);
    if (favor) { replies.splice(0, replies.length,
      { id: `favor_accept:${favor.id}`, text: 'Yes, I can help.', intent: 'kind' },
      { id: `favor_decline:${favor.id}`, text: 'I can’t take that on.', intent: 'kind' }); }
    const ready = favorBook(this.registry).find(f => f.status === 'accepted' && (f.task.kind === 'introduce' && f.resident_id === this.card.id));
    if (ready) replies.push({ id: `favor_finish:${ready.id}`, text: ready.task.kind === 'delivery' ? 'I have a parcel for you.' : 'Let me introduce you.', intent: 'kind' });
    const selected = marks(this.registry).selected;
    if (selected && !this.usedMarks.has(selected) && marks(this.registry).entries[selected]?.status === 'found' && MARK_HELPERS.has(this.card.id)) {
      replies.push(markReply(selected));
    }
    if (this.card.id === 'tib' && SPRING_RIDDLES.some(r => r.chain === 'T' && marks(this.registry).entries[r.id]?.status !== 'solved')) replies.push({ id: 'tib_duel', text: 'A riddle duel?', intent: 'about_riddle' });
    // A key character can point the way: once a conversation, never over a Favor to answer or after a wrap-up.
    const quest = favor || turn.wrap_up || replies.some(c => c.intent === 'about_quest') ? null : questReply(this.card, this.quest(), this.usedQuest);
    if (quest) replies.push(quest);
    this.shownReplies = replies;
    const rows = replies.map((c, i) => new PanelButton(this, CHOICE_X, 0, CHOICE_W, `${i + 1}   ${c.text}`, () => this.choose(c)));
    const row: PanelButton[] = [];
    let say: PanelButton | null = null;
    if (!turn.wrap_up) {
      if (!accessibility().choicesOnly) say = new PanelButton(this, CHOICE_X, 0, 214, 'Say something…', () => this.openSay(), { center: true, size: 17 });
      // Gift values are engine-owned; the next live turn supplies only the reaction line.
      const gift = new PanelButton(this, CHOICE_X + 222, 0, 100, 'Bag', () => this.openGift(), { center: true, size: 17 });
      row.push(...(say ? [say] : []), gift);
      this.extraButtons.push(gift);
    }
    const leaveW = turn.wrap_up ? CHOICE_W : CHOICE_W - 330;
    const leave = new PanelButton(this, CHOICE_X + CHOICE_W - leaveW, 0, leaveW, 'Leave', () => this.choose(LEAVE), { center: true, size: 17 });
    row.push(leave);
    // Stack upward from just above the panel: the action row at the bottom, replies above it.
    let y = PANEL_Y - 30 - Math.max(...row.map(b => b.h));
    for (const b of row) b.moveTo(y);
    for (let i = rows.length - 1; i >= 0; i--) { y -= rows[i]!.h + CHOICE_GAP; rows[i]!.moveTo(y); }
    this.buttons = [...rows, ...(say ? [say] : []), ...this.extraButtons, leave];
    this.scrollChoices = choiceViewport(this, this.buttons, PANEL_Y - 30);
    this.focus = 0;
    this.buttons.forEach((b, i) => b.setFocus(i === 0));
  }

  private openGift(): void {
    openBag(this, this.open.clock, { share: (slot, item) => {
      const shared = shareMeal(this.registry, this.open.clock, this.card, slot, item);
      if (!shared) return;
      this.giftFeedback = heartFeedback(shared.regard);
      void this.send({ kind: 'meal', item: item.id, event_id: shared.eventId, text: `Shall we share ${item.name}?` }, `Shall we share ${item.name}?`);
    }, gift: (slot, item) => {
      const favor = favorBook(this.registry).find(f => f.status === 'accepted' && (f.task.kind === 'delivery' ? f.task.recipient : f.resident_id) === this.card.id && f.task.item === item.id);
      if (favor && finishFavor(this.registry, this.open.clock, favor, favorProof(this.registry, this.open.clock, favor, this.card.id, this.card.home), slot)) { this.toast('Favor completed. Thank you.'); this.showChoices(); return; }
      const given = giveGift(this.registry, this.open.clock, this.card, slot, item);
      if (!given) { this.toast('One gift each day is plenty.'); return; }
      this.giftFeedback = heartFeedback(given.regard);
      void this.send({ kind: 'gift', item: item.id, reaction: given.reaction, event_id: given.eventId, text: `I brought you ${item.name}.` }, `I brought you ${item.name}.`);
    } });
  }

  private hideButtons(): void {
    for (const b of new Set([...this.buttons, ...this.extraButtons])) b.destroy();
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
    this.scrollChoices(this.focus);
    this.buttons.forEach((b, i) => b.setFocus(i === this.focus));
    playSfx('hover');
  }

  private choose(choice: TalkChoice): void {
    if (choice.id.startsWith('favor_')) {
      const [action,id] = choice.id.split(':');
      const f = favorBook(this.registry).find(x => x.id === id);
      if (!f) return;
      const ok = action === 'favor_finish' ? finishFavor(this.registry,this.open.clock,f,favorProof(this.registry,this.open.clock,f,this.card.id,this.card.home,this.open.playerPosition)) : chooseFavor(this.registry,f.id,this.open.clock.day,action === 'favor_accept',this.open.clock.minute);
      this.toast(ok ? action === 'favor_finish' ? 'Favor completed.' : 'Noted in your Journal.' : 'Bring your neighbour closer first.'); this.showChoices(); return;
    }
    if (this.closed || this.generating) return;
    if (choice.id === 'tib_duel') {
      const next = SPRING_RIDDLES.find(r => r.chain === 'T' && marks(this.registry).entries[r.id]?.status !== 'solved');
      if (next) {
        findMark(this.registry, this.open.clock, next.id);
        const host = this.scene.get(this.open.host), clock = this.open.clock;
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => host.time.delayedCall(0, () => openPeople(host, clock, 'Marks')));
        this.close();
      }
      return;
    }
    if (choice.intent === 'leave') { this.leave(isBareLeave(choice) ? null : choice.text); return; }
    if (choice.intent === 'about_riddle') {
      refreshHints(this.registry, this.open.clock);
      const state = marks(this.registry), id = state.selected;
      if (id && state.entries[id]?.status === 'found') {
        this.usedMarks.add(id);
        requestHint(state, id, { kind: 'resident', id: this.card.id, regard: regardFor(this.registry, this.card.id) });
        this.context = { ...this.context, riddle: { id, hints_allowed: state.entries[id]!.hints } };
      }
    } else this.context = { ...this.context, riddle: null };
    // Asked once (the authored reply or one of the resident's own), the quest reply isn't offered again.
    if (choice.intent === 'about_quest') this.usedQuest = true;
    void this.send({ kind: 'choice', choice_id: choice.id, text: choice.text, intent: choice.intent }, choice.text);
  }

  /**
   * What this turn tells the server about the player's objective and this resident's threads (mind/questSources.ts).
   * None in a scripted scene's handoff ({ai_open}), which is its own beat with its own topic.
   */
  private quest(): TalkQuest | null {
    const { topic, place, scripted, zone, clock } = this.open;
    if (topic !== undefined || place !== undefined || scripted || !zone) return null;
    try {
      return talkQuest({
        registry: this.registry, card: this.card, day: clock.day, minute: clock.minute,
        district: districtOf(zone), favors: favorBook(this.registry), marks: marks(this.registry)
      });
    } catch (error) {
      // A conversation never waits on this: the turn goes without the report.
      console.warn('[dialogue] quest report failed; sending none', error);
      return null;
    }
  }

  /** Leave: after a wrap-up the resident has said goodbye already; otherwise they say one (authored, free). */
  private leave(said: string | null = null): void {
    if (this.turn?.wrap_up || this.farewell) { this.close(); return; }
    const bye = this.makeQuietTurn({ kind: 'choice', choice_id: LEAVE.id, text: LEAVE.text, intent: 'leave' }, this.exchange);
    this.hideChoices();
    if (said) this.speakAsPlayer(said);
    else this.echo.setText('');
    this.farewell = true;
    this.turn = bye;
    for (const line of bye.lines) this.log.push({ who: 'resident', text: line.text });
    this.reader.reset();
    this.reader.finish(bye);
    this.restartQuietly();
    if (DEV_MARK) this.devMark.setText(`farewell · quiet${this.quietLine ? ` · ${this.quietLine}` : ''}`);
  }

  // ── Say something… ────────────────────────────────────────────────────────

  private openSay(): void {
    if (accessibility().choicesOnly || this.say || this.generating || !this.choicesShown) return;
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

  /** §9.13: replace the line immediately, then queue the stored turn for review. */
  private report(): void {
    this.closeMenu();
    const turn = this.turn;
    if (!turn || turn.fallback || this.source !== 'server') { this.toast('Nothing to report yet.'); return; }
    this.turn = { ...turn, fallback: true, lines: [{ text: '(Waves the thought away.) Never mind that. Where were we?', expr: 'neutral' }] };
    this.reader.reset();
    this.reader.finish(this.turn);
    void getMind().reportTurn(turn.conversation_id, turn.turn_index).then(saved => {
      // The reported line stays replaced either way (§9.13 "swaps in a fallback immediately").
      if (!this.closed) this.toast(saved ? 'Thanks. That line was sent for review.' : 'Couldn\'t send the report. The line is hidden; try again later.');
    });
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
    if (this.backlog) {
      if (key === 'Escape' || key === 'l' || key === 'L') this.closeLog();
      else if (key === 'ArrowUp') this.backlog.scroll(-1);
      else if (key === 'ArrowDown') this.backlog.scroll(1);
      else if (key === 'PageUp') this.backlog.scroll(-4);
      else if (key === 'PageDown') this.backlog.scroll(4);
      e.preventDefault();
      return;
    }
    if (key === 'l' || key === 'L') { e.preventDefault(); this.openLog(); return; }
    if (key === 'Escape') {
      if (this.menu.length) this.closeMenu();
      else if (!this.generating) this.close(); // Esc closes only when no turn is streaming.
      return;
    }
    if (this.choicesShown) {
      if (/^[1-6]$/.test(key)) {
        const replies = this.shownReplies;
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
    this.closeLog();
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 140, onComplete: () => this.scene.stop() });
  }

  /** On shutdown, however it came: give the world back. */
  private teardown(): void {
    this.joined?.close(this.context);
    if (this.serverConversationId) void getMind().closeTalk(this.card.id, this.serverConversationId, this.context.day, this.context.minute);
    this.closed = true;
    this.abort?.abort();
    this.closeSay(false);
    this.closeLog();
    this.input.keyboard?.removeCapture('SPACE,TAB');
    this.pauseWorld(false);
    this.game.events.emit(DIALOGUE_CLOSED, { residentId: this.card.id, exchanges: this.exchange, log: [...this.log] } satisfies DialogueClosed);
  }
}
