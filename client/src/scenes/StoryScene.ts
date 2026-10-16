import { openPuzzle } from '../puzzles/scenes/PuzzleScene';
// Scripted scenes as a VN (GDD §13.1 cues, §13.3 scenes, §18 Dialogue; MVP G-10).
//
// Launched over ZoneScene by scenes/story/attach.ts when the director has an eligible scene. The zone keeps
// running underneath with its input paused and the clock held for "story" until the scene (and any scene it
// hands over to) ends. It drives the director: next() until a line or a choice, then waits for the player.
//
// It is the dialogue panel's twin (dialogue/panel.ts: same panel, name plate, typewriter, fonts, buttons and
// keys): portraits swap by speaker (dialogue/portrait.ts, art from the manifest or the procedural bust),
// narration has no portrait and is set in italics, and the player's own lines get the "You" plate with no
// portrait (§11.1). Choices are 1–4, ↑↓/Tab and Enter, or a click; Enter, Space or a click reads on; L opens
// the scene's log (dialogue/backlog.ts). Backdrops come from assets/backdrops/manifest.json when it lists the
// id; otherwise a tinted panel names the place (story/backdrop.ts).
//
// It is also the StoryPresenter (story/host.ts): music, backdrop, fade, wait, camera and sound cues, the
// summons confirmation, placeholders for puzzles and Scuffles, the Fellowship form and the {ai_open} handoff
// to DialogueScene (a launch option there and its DIALOGUE_CLOSED event).
import Phaser from 'phaser';
import { isBareLeave, type PersonaCard } from '@monde/shared';
import { getMusic } from '../audio/Music';
import { SFX_KEYS, playSfx, type SfxKey } from '../audio/Sfx';
import { Backlog, type LogEntry } from '../dialogue/backlog';
import {
  BODY_COLOUR, BODY_MAX_LINES, BODY_Y, CHOICE_GAP, CHOICE_W, CHOICE_X, MUTED, NARRATION_COLOUR, NamePlate,
  PAD, PANEL_H, PANEL_W, PANEL_X, PANEL_Y, PLATE_X, PLAYER_COLOUR, PORTRAIT_X, PORTRAIT_Y, PanelButton,
  bodyStyle, drawPanel, rosterColour, youPlate
} from '../dialogue/panel';
import { Portrait } from '../dialogue/portrait';
import { PORTRAIT_W, portraitLook, type PortraitLook } from '../dialogue/portraitModel';
import { browserStorage } from '../mind/api';
import { loadTextSpeed } from '../mind/prefs';
import { MS_PER_CHAR, type TextSpeed } from '../mind/reader';
import { scriptedTurn, type ScriptedExchange } from '../mind/scripted';
import { scriptedLibrary } from '../mind/scriptedLibrary';
import type { TalkInput } from '../mind/types';
import type { Clock } from '../sim/clock';
import { displayName } from '../sim/residentSim';
import {
  BACKDROP_MANIFEST_PATH, MOOD_PALETTE, backdropMood, backdropTextureKey, backdropTitle, backdropUrl, parseBackdropManifest
} from '../story/backdrop';
import { ARRIVAL_STANDIN, clipActivity, plainText, sceneName, type StoryPresenter } from '../story/host';
import type { StoryLine, StoryStep } from '../story/runtime';
import type { StorySession } from '../story/session';
import { paginateBody } from '../ui/fitText';
import { FAMILY_BODY, FAMILY_HEADING, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import { placeName } from '../world/player';
import { personaCards } from '../world/residents';
import { zones } from '../world/zones';
import { DIALOGUE_CLOSED, DIALOGUE_SCENE, voiceFrequency, type DialogueClosed, type DialogueOpen } from './DialogueScene';

export const STORY_SCENE = 'Story';
/** The Fellowship form's scene key (W-07, scenes/FellowshipScene.ts): opened for {charcreate} when registered. */
export const FELLOWSHIP_SCENE = 'Fellowship';

export interface StoryOpen {
  /** The scene underneath (ZoneScene): its input is paused while a scene plays. */
  host: string;
  clock: Clock;
  session: StorySession;
  /** What the dialogue panel needs to open on a resident here, for {ai_open}; null when it can't. */
  dialogueFor(residentId: string): Omit<DialogueOpen, 'host' | 'residentId'> | null;
}

const CARDS: ReadonlyMap<string, { card: PersonaCard; index: number }> = new Map(personaCards.map((card, index) => [card.id, { card, index }]));
/** Sound ids the scripts use under another name in the catalogue (audio/Sfx.ts). */
const SFX_ALIASES: Readonly<Record<string, SfxKey>> = { thin_applause: 'applause_thin' };
/** Voice blips no closer together than this (as the dialogue panel). */
const BLIP_GAP_MS = 55;
const DEV = import.meta.env.DEV || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev'));

let backdropManifest: Promise<ReadonlyMap<string, string>> | null = null;
/** The backdrop manifest, fetched once; missing or broken means no art (never an error). */
const loadBackdropManifest = (): Promise<ReadonlyMap<string, string>> => {
  backdropManifest ??= fetch(`${import.meta.env.BASE_URL}${BACKDROP_MANIFEST_PATH}`, { cache: 'no-cache' })
    .then(res => (res.ok ? res.json() : {})).then(parseBackdropManifest).catch(() => new Map<string, string>());
  return backdropManifest;
};

/** A white disc fading to nothing: the stand-in backdrop's horizon glow (tinted per mood). */
function softDisc(scene: Phaser.Scene): string {
  const key = 'story-soft-disc';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 256, 256);
  if (!tex) return key;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  tex.refresh();
  return key;
}

/** Clear in the middle, dark at the edges. */
function vignetteTexture(scene: Phaser.Scene): string {
  const key = 'story-vignette';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, 320, 180);
  if (!tex) return key;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(160, 90, 40, 160, 90, 190);
  g.addColorStop(0, 'rgba(8,10,9,0)');
  g.addColorStop(1, 'rgba(8,10,9,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 320, 180);
  tex.refresh();
  return key;
}

interface Speaker { id: string; name: string; look: PortraitLook; age: number; narrated: boolean }

/** A cast member: their card, or a stand-in for a speaker without one (the S05 arrival). */
function speakerFor(id: string): Speaker {
  const entry = CARDS.get(id);
  if (entry) {
    return { id, name: displayName(entry.card.name), look: portraitLook(entry.card, rosterColour(entry.index)), age: entry.card.age, narrated: entry.card.voice.mode === 'narrated_action' };
  }
  const name = id === 'arrival' ? ARRIVAL_STANDIN.name : id.split('_').map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  const card = { id, age: 35, pronouns: 'they/them', kind: 'arrival', appearance: '' } as Pick<PersonaCard, 'id' | 'age' | 'pronouns' | 'kind' | 'appearance'>;
  return { id, name, look: portraitLook(card, rosterColour(id.length * 7)), age: 35, narrated: false };
}

export class StoryScene extends Phaser.Scene implements StoryPresenter {
  private open!: StoryOpen;
  private session!: StorySession;
  private closed = false;
  private sceneId: string | null = null;
  private speed: TextSpeed = 'normal';
  // The line on show.
  private line: StoryLine | null = null;
  private pages: string[] = [];
  private page = 0;
  private shown = 0;
  private typing = false;
  private paren = false;
  private lastBlip = 0;
  private speaker: Speaker | null = null;
  private echoLines = 0;
  // Waiting on the player.
  private reading = false;
  private buttons: PanelButton[] = [];
  private focus = 0;
  private answer: ((index: number) => void) | null = null;
  private waitDone: (() => void) | null = null;
  /** A canned {ai_open} line is on show: reading it on resolves this instead of asking the director for more. */
  private lineDone: (() => void) | null = null;
  // Presentation.
  private revealed = false;
  private musicStarted = false;
  private backdropLayer!: Phaser.GameObjects.Container;
  private backdropId = '';
  private panelLayer!: Phaser.GameObjects.Container;
  private portrait: Portrait | null = null;
  private plate!: NamePlate;
  private you!: Phaser.GameObjects.Container;
  private body!: Phaser.GameObjects.Text;
  private measure!: Phaser.GameObjects.Text;
  private echo!: Phaser.GameObjects.Text;
  private more!: Phaser.GameObjects.Text;
  private caption!: Phaser.GameObjects.Text;
  private log: LogEntry[] = [];
  private backlog: Backlog | null = null;
  private thinkingTween: Phaser.Tweens.Tween | null = null;

  constructor() { super(STORY_SCENE); }

  init(data: StoryOpen): void {
    this.open = data;
    this.session = data.session;
    this.closed = false;
    this.sceneId = null;
    this.speed = loadTextSpeed(browserStorage());
    this.line = null; this.pages = []; this.page = 0; this.shown = 0; this.typing = false; this.paren = false; this.lastBlip = 0;
    this.speaker = null; this.echoLines = 0; this.reading = false; this.buttons = []; this.focus = 0;
    this.answer = null; this.waitDone = null; this.lineDone = null; this.revealed = false; this.musicStarted = false; this.backdropId = '';
    this.portrait = null; this.log = []; this.backlog = null; this.thinkingTween = null;
  }

  create(): void {
    this.scene.bringToTop();
    this.pauseWorld(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.session.presenter = this;

    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0c100d, 0.55).setOrigin(0);
    this.backdropLayer = this.add.container(0, 0);
    // Anywhere that isn't a button reads on.
    this.add.zone(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0).setInteractive().on('pointerdown', () => this.advance());

    this.plate = new NamePlate(this, PORTRAIT_W + 8);
    this.you = youPlate(this).setAlpha(0);
    const panel = drawPanel(this.add.graphics());
    this.body = this.add.text(PANEL_X + PAD, BODY_Y, '', bodyStyle());
    this.measure = this.add.text(0, 0, '', bodyStyle()).setVisible(false);
    this.echo = this.add.text(PANEL_X + PAD, PANEL_Y + 10, '', {
      fontFamily: FAMILY_BODY, fontSize: '15px', fontStyle: 'italic', color: MUTED, resolution: RENDER_SCALE, maxLines: 1
    });
    this.more = this.add.text(PANEL_X + PANEL_W - 22, PANEL_Y + PANEL_H - 12, '', {
      fontFamily: FAMILY_BODY, fontSize: '16px', color: '#e4c77f', resolution: RENDER_SCALE
    }).setOrigin(1, 1);
    this.tweens.add({ targets: this.more, alpha: 0.45, duration: 650, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    // Dev builds (or ?dev): which scene is playing, small along the panel's foot.
    this.caption = this.add.text(PANEL_X + 14, PANEL_Y + PANEL_H - 8, '', {
      fontFamily: FAMILY_BODY, fontSize: '11px', color: '#8f8a78', resolution: RENDER_SCALE
    }).setOrigin(0, 1).setVisible(false);
    const logButton = this.add.text(PANEL_X + PANEL_W - 22, PANEL_Y + 13, 'Log', {
      fontFamily: FAMILY_BODY, fontSize: '16px', color: '#e4c77f', padding: { x: 6, y: 2 }, resolution: RENDER_SCALE
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    logButton.on('pointerover', () => logButton.setColor('#fff0ce'));
    logButton.on('pointerout', () => logButton.setColor('#e4c77f'));
    logButton.on('pointerup', () => { playSfx('click'); this.time.delayedCall(0, () => (this.backlog ? this.closeLog() : this.openLog())); });
    this.plate.container.setAlpha(0);
    // The portrait sits under the panel's top edge (depth 5); the panel and its text above it.
    this.panelLayer = this.add.container(0, 0, [panel, this.plate.container, this.you, this.body, this.echo, this.more, this.caption, logButton]).setDepth(10);

    const keyboard = this.input.keyboard!;
    keyboard.addCapture('SPACE,TAB,UP,DOWN');
    keyboard.on('keydown', (e: KeyboardEvent) => this.onKey(e));

    // Nothing shows until the first line, choice or question: a scene that turns out not to start doesn't flash.
    this.cameras.main.setAlpha(0);
    void this.drive();
  }

  update(time: number, delta: number): void {
    if (this.closed || !this.line || !this.typing) return;
    const pageText = this.pages[this.page] ?? '';
    const ms = MS_PER_CHAR[this.speed];
    const before = Math.floor(this.shown);
    this.shown = ms <= 0 ? pageText.length : Math.min(pageText.length, this.shown + delta / ms);
    const n = Math.floor(this.shown);
    if (n !== before) {
      this.body.setText(pageText.slice(0, n));
      this.blip(pageText.slice(before, n), time);
    }
    if (n >= pageText.length) this.typing = false;
    this.updateMore();
  }

  // ── Driving the director ──────────────────────────────────────────────────

  /** Step until a line or a choice needs the player, or the story has nothing more to play. */
  private async drive(first?: () => Promise<StoryStep | null>): Promise<void> {
    const director = this.session.director;
    try {
      let step = first ? await first() : await director.next();
      for (;;) {
        this.session.world?.persist();
        if (this.closed) return;
        this.noteScene();
        if (!step) { this.finish(); return; }
        if (step.kind === 'line') { this.present(step.line); return; }
        if (step.kind === 'choice') { this.offer(step.options); return; }
        step = await director.next();
      }
    } catch (error) {
      console.error('[story] the scene stopped on an error; returning to the world', error);
      this.finish();
    }
  }

  /** A new scene started (or a handoff): its title for the log and the dev caption. */
  private noteScene(): void {
    const id = this.session.active ?? null;
    if (!id || id === this.sceneId) return;
    this.sceneId = id;
    const title = this.session.scene(id)?.title ?? id;
    this.caption.setText(title).setVisible(DEV);
    if (this.log.length) this.log.push({ who: 'narrator', text: `· ${sceneName(title, id)} ·` });
  }

  private reveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 220 });
  }

  // ── Lines ─────────────────────────────────────────────────────────────────

  private present(line: StoryLine): void {
    this.reveal();
    this.stopThinking();
    this.line = line;
    const text = plainText(line.business ? `(${line.business}) ${line.text}` : line.text);
    if (line.kind === 'say' && line.speaker) {
      this.showSpeaker(line.speaker, line.expr);
      this.showYou(false);
      this.body.setColor(BODY_COLOUR).setFontStyle('normal');
      this.log.push({ who: 'resident', name: this.speaker?.name, text });
    } else if (line.kind === 'player') {
      this.portrait?.setDimmed(true);
      this.fadePlate(0.45);
      this.showYou(true);
      this.body.setColor(PLAYER_COLOUR).setFontStyle('normal');
      this.log.push({ who: 'player', text });
    } else {
      this.hideSpeaker();
      this.showYou(false);
      this.body.setColor(NARRATION_COLOUR).setFontStyle('italic');
      this.log.push({ who: 'narrator', text });
    }
    if (this.echoLines > 0 && --this.echoLines === 0) this.echo.setText('');
    this.measure.setFontStyle(this.body.style.fontStyle);
    this.pages = paginateBody(this.measure, text, BODY_MAX_LINES);
    this.page = 0;
    this.startPage();
    this.reading = true;
  }

  private startPage(): void {
    this.shown = 0;
    this.paren = false;
    this.typing = true;
    this.body.setText('');
    this.updateMore();
  }

  private updateMore(): void {
    const show = this.reading && !this.typing && !this.answer;
    this.more.setText(!show ? '' : this.page < this.pages.length - 1 ? 'More ▾' : '▸');
  }

  /** Enter, Space or a click: finish the page, turn it, or read on. */
  private advance(): void {
    if (this.closed) return;
    if (this.backlog) { this.closeLog(); return; }
    if (this.waitDone) { const done = this.waitDone; this.waitDone = null; done(); return; }
    if (!this.reading || this.answer) return;
    if (this.typing) {
      this.shown = (this.pages[this.page] ?? '').length;
      this.body.setText(this.pages[this.page] ?? '');
      this.typing = false;
      this.updateMore();
      return;
    }
    if (this.page < this.pages.length - 1) {
      this.page++;
      playSfx('page_turn');
      this.startPage();
      return;
    }
    playSfx('page_turn');
    this.reading = false;
    this.more.setText('');
    if (this.lineDone) { const done = this.lineDone; this.lineDone = null; done(); return; }
    void this.drive();
  }

  /** Voice blips for speech (pitch from age); a soft typewriter tick for narration and (stage business). */
  private blip(typed: string, time: number): void {
    let speech = false, narration = false;
    for (const c of typed) {
      if (c === '(') this.paren = true;
      else if (c === ')') this.paren = false;
      else if (/[\p{L}\p{N}]/u.test(c)) { if (this.paren) narration = true; else speech = true; }
    }
    if (time - this.lastBlip < BLIP_GAP_MS || (!speech && !narration)) return;
    this.lastBlip = time;
    const kind = this.line?.kind;
    if (kind === 'player') return;
    const s = this.speaker;
    if (speech && kind === 'say' && s && !s.narrated) playSfx('voice_blip', { resident: s.id, frequency: voiceFrequency(s.age, s.id) });
    else playSfx('typewriter_tick');
  }

  // ── Speakers ──────────────────────────────────────────────────────────────

  private showSpeaker(id: string, expr?: string): void {
    if (this.speaker?.id !== id || !this.portrait) {
      const old = this.portrait;
      if (old) this.tweens.add({ targets: old.root, alpha: 0, duration: 140, onComplete: () => old.destroy() });
      this.speaker = speakerFor(id);
      const portrait = new Portrait(this, { residentId: id, look: this.speaker.look, x: PORTRAIT_X, y: PORTRAIT_Y, label: true });
      portrait.root.setDepth(5).setAlpha(0);
      portrait.setExpression(expr ?? 'neutral', true);
      this.tweens.add({ targets: portrait.root, alpha: 1, duration: 160 });
      this.portrait = portrait;
      this.plate.setName(this.speaker.name);
    } else {
      this.portrait.setDimmed(false);
      if (expr) this.portrait.setExpression(expr);
      if (this.portrait.root.alpha < 1) this.tweens.add({ targets: this.portrait.root, alpha: 1, duration: 140 });
    }
    this.fadePlate(1);
  }

  private hideSpeaker(): void {
    if (this.portrait) this.tweens.add({ targets: this.portrait.root, alpha: 0, duration: 140 });
    this.fadePlate(0);
  }

  private fadePlate(alpha: number): void {
    this.tweens.killTweensOf(this.plate.container);
    this.tweens.add({ targets: this.plate.container, alpha, duration: 120 });
  }

  private showYou(on: boolean): void {
    this.tweens.killTweensOf(this.you);
    this.tweens.add({ targets: this.you, alpha: on ? 1 : 0, duration: 110 });
  }

  // ── Choices ───────────────────────────────────────────────────────────────

  /** Buttons above the panel on the right (as the dialogue panel's replies); resolves with the index picked. */
  private ask(options: readonly string[], numbered = true): Promise<number> {
    this.reveal();
    this.hideButtons();
    this.reading = false;
    this.updateMore();
    return new Promise(resolve => {
      this.buttons = options.map((text, i) => new PanelButton(this, CHOICE_X, 0, CHOICE_W, numbered ? `${i + 1}   ${text}` : text, () => this.pick(i)));
      let y = PANEL_Y - 30;
      for (let i = this.buttons.length - 1; i >= 0; i--) { y -= this.buttons[i]!.h + (i === this.buttons.length - 1 ? 0 : CHOICE_GAP); this.buttons[i]!.moveTo(y); }
      this.focus = 0;
      this.buttons.forEach((b, i) => b.setFocus(i === 0));
      this.answer = resolve;
    });
  }

  private pick(index: number): void {
    const resolve = this.answer;
    if (!resolve || this.closed || index < 0 || index >= this.buttons.length) return;
    this.answer = null;
    this.hideButtons();
    resolve(index);
  }

  private hideButtons(): void {
    for (const b of this.buttons) b.destroy();
    this.buttons = [];
  }

  private offer(options: readonly string[]): void {
    void this.ask(options).then(index => {
      this.echoPlayer(options[index] ?? '');
      return this.drive(() => this.session.director.choose(index));
    });
  }

  /** The player's words go in the log and stay as a one-line echo beside the plate, as in the dialogue panel. */
  private echoPlayer(said: string): void {
    this.log.push({ who: 'player', text: said });
    const x = PLATE_X + Math.max(this.plate.width, PORTRAIT_W + 8) + 18;
    this.echo.setPosition(x, PANEL_Y + 10).setWordWrapWidth(PANEL_X + PANEL_W - 120 - x).setText(`You: ${said}`);
    this.echoLines = 2;
  }

  private moveFocus(step: number): void {
    if (!this.buttons.length) return;
    this.focus = (this.focus + step + this.buttons.length) % this.buttons.length;
    this.buttons.forEach((b, i) => b.setFocus(i === this.focus));
    playSfx('hover');
  }

  /** Text shown at once (a question the engine asks), in the narration style. */
  private say(text: string): void {
    this.reveal();
    this.hideSpeaker();
    this.showYou(false);
    this.line = null;
    this.typing = false;
    this.body.setColor(NARRATION_COLOUR).setFontStyle('italic').setText(text);
  }

  // ── StoryPresenter ────────────────────────────────────────────────────────

  backdrop(id: string): void {
    if (id === this.backdropId) return;
    this.backdropId = id;
    this.paintStandIn(id);
    void loadBackdropManifest().then(ids => {
      if (this.closed || this.backdropId !== id || !ids.has(id)) return;
      const key = backdropTextureKey(id);
      const show = () => {
        if (this.closed || this.backdropId !== id || !this.textures.exists(key)) return;
        this.backdropLayer.removeAll(true);
        const img = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, key);
        img.setScale(Math.max(GAME_WIDTH / img.width, GAME_HEIGHT / img.height));
        const shade = this.add.graphics();
        shade.fillGradientStyle(0x0c100d, 0x0c100d, 0x0c100d, 0x0c100d, 0, 0, 0.55, 0.55).fillRect(0, GAME_HEIGHT * 0.45, GAME_WIDTH, GAME_HEIGHT * 0.55);
        this.backdropLayer.add([img, shade]);
      };
      if (this.textures.exists(key)) { show(); return; }
      this.load.image(key, backdropUrl(import.meta.env.BASE_URL, id, ids.get(id)));
      this.load.once(Phaser.Loader.Events.COMPLETE, show);
      this.load.start();
    });
  }

  music(id: string): void {
    this.musicStarted = true;
    getMusic(this).play(id);
  }

  fade(): Promise<void> {
    return new Promise(resolve => {
      const cam = this.cameras.main;
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        cam.once(Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE, () => resolve());
        cam.fadeIn(260, 0, 0, 0);
      });
      cam.fadeOut(260, 0, 0, 0);
    });
  }

  wait(seconds: number): Promise<void> {
    return new Promise(resolve => {
      const done = () => { if (this.waitDone === done) this.waitDone = null; resolve(); };
      this.waitDone = done;
      this.more.setText('');
      this.time.delayedCall(Math.max(0, seconds) * 1000, done);
    });
  }

  cam(effect: string): boolean {
    if (effect !== 'shake') return false;
    this.cameras.main.shake(280, 0.006);
    this.scene.get(this.open.host)?.cameras.main.shake(280, 0.004);
    return true;
  }

  sfx(id: string): boolean {
    const key = (SFX_ALIASES[id] ?? id) as SfxKey;
    if (!(SFX_KEYS as readonly string[]).includes(key)) return false;
    playSfx(key);
    return true;
  }

  thinking(speaker: string): void {
    this.reveal();
    this.showSpeaker(speaker);
    this.showYou(false);
    this.line = null;
    this.typing = false;
    this.body.setColor(BODY_COLOUR).setFontStyle('italic').setText('…');
    this.stopThinking();
    this.thinkingTween = this.tweens.add({ targets: this.body, alpha: 0.4, duration: 520, yoyo: true, repeat: -1 });
  }

  private stopThinking(): void {
    this.thinkingTween?.stop();
    this.thinkingTween = null;
    this.body.setAlpha(1);
  }

  async confirm(text: string, yes: string, no: string): Promise<boolean> {
    this.say(text);
    return (await this.ask([yes, no], false)) === 0;
  }

  async puzzle(id: string): Promise<boolean> {
    this.panelLayer.setVisible(false); this.portrait?.root.setVisible(false); this.listen(false);
    try { return await openPuzzle(this, this.open.clock, id); }
    finally { if (!this.closed) { this.panelLayer.setVisible(true); this.portrait?.root.setVisible(true); this.listen(true); } }
  }

  async placeholder(kind: 'puzzle' | 'scuffle', id: string): Promise<boolean> {
    if (kind === 'puzzle') return this.puzzle(id);
    // GDD-GAP: Scuffles (§7) still use the existing stand-in.
    const what = `Scuffle ${id.replaceAll('_', ' ')}`;
    this.say(`(${what} isn't built yet. How does it go?)`);
    return (await this.ask(['Won', 'Lost'], false)) === 0;
  }

  async charcreate(): Promise<boolean> {
    if (!this.game.scene.keys[FELLOWSHIP_SCENE]) return false;
    await this.handOff(FELLOWSHIP_SCENE, { host: STORY_SCENE, clock: this.open.clock, fromStory: true });
    return true;
  }

  async aiOpen(cue: { resident: string; topic: string; turns: number }, place: string): Promise<readonly StoryLine[]> {
    const exchange = this.exchangeFor(cue);
    // No persona card means no agent to open the dialogue panel on (the S05 newcomer): the written exchange plays here.
    if (exchange && !CARDS.has(cue.resident)) { await this.playExchange(exchange, cue.resident); return []; }
    const setup = CARDS.has(cue.resident) ? this.open.dialogueFor(cue.resident) : null;
    if (!setup) {
      if (DEV) console.warn(`[story] {ai_open: ${cue.resident}}: no resident card or zone to talk in; continuing the script`);
      return [];
    }
    const closed = new Promise<DialogueClosed>(resolve => {
      const on = (e: DialogueClosed) => { if (e.residentId !== cue.resident) return; this.game.events.off(DIALOGUE_CLOSED, on); resolve(e); };
      this.game.events.on(DIALOGUE_CLOSED, on);
    });
    // The dialogue panel plays the written exchange whenever its Quiet Mode path is the one speaking.
    const data: DialogueOpen = {
      ...setup, host: STORY_SCENE, residentId: cue.resident, topic: clipActivity(cue.topic), turns: cue.turns, place,
      ...(exchange ? { scripted: exchange } : {})
    };
    this.panelLayer.setVisible(false);
    this.portrait?.root.setVisible(false);
    this.scene.launch(DIALOGUE_SCENE, data);
    const result = await closed;
    if (this.closed) return [];
    const name = displayName(CARDS.get(cue.resident)!.card.name);
    for (const e of result.log) this.log.push(e.who === 'player' ? e : { ...e, name });
    this.panelLayer.setVisible(true);
    this.portrait?.root.setVisible(true);
    return [];
  }

  /** The written Quiet Mode exchange for this scene's {ai_open} cue (content/lines/scripted.yaml), if its turns still match. */
  private exchangeFor(cue: { resident: string; turns: number }): ScriptedExchange | undefined {
    const exchange = scriptedLibrary.find(this.session.active ?? '', cue.resident);
    if (exchange && exchange.turns !== cue.turns) {
      if (DEV) console.warn(`[story] ${exchange.key}: the exchange has ${exchange.turns} turns but the cue says ${cue.turns}; ignoring it`);
      return undefined;
    }
    return exchange;
  }

  /**
   * A written {ai_open} exchange played in the story panel itself: the resident's lines, then the Fellow's two or
   * three replies as choices, down to the close. For a speaker with no persona card; the director waits meanwhile.
   */
  private async playExchange(exchange: ScriptedExchange, speaker: string): Promise<void> {
    const values = this.session.context().values ?? {};
    const arrival = (values.arrival as { name?: unknown } | undefined)?.name;
    const vars = {
      name: speaker === 'arrival' && typeof arrival === 'string' ? arrival : speakerFor(speaker).name,
      player: typeof values.name === 'string' ? values.name : 'Fellow'
    };
    let at: string | null = null;
    let input: TalkInput = { kind: 'open' };
    for (let turnIndex = 0; !this.closed; turnIndex++) {
      const step = scriptedTurn(exchange, at, input, { conversationId: `story:${exchange.key}`, residentId: speaker, turnIndex, vars });
      if (!step) return;
      at = step.at;
      for (const line of step.turn.lines) {
        await this.sayCanned({ kind: 'say', speaker, text: line.text, expr: line.expr });
        if (this.closed) return;
      }
      const replies = step.turn.choices.filter(c => !isBareLeave(c));
      if (step.turn.wrap_up || !replies.length) return;
      const picked = replies[await this.ask(replies.map(r => r.text))];
      if (!picked || this.closed) return;
      this.echoPlayer(picked.text);
      input = { kind: 'choice', choice_id: picked.id, text: picked.text, intent: picked.intent };
    }
  }

  /** One canned line, read like any other; resolves when the player reads on. */
  private sayCanned(line: StoryLine): Promise<void> {
    return new Promise(resolve => { this.lineDone = resolve; this.present(line); });
  }

  /** Run another scene over this one (its keys aren't ours meanwhile) and wait for it to stop. */
  private handOff(key: string, data: object): Promise<void> {
    this.panelLayer.setVisible(false);
    this.portrait?.root.setVisible(false);
    this.listen(false);
    return new Promise(resolve => {
      this.scene.launch(key, data);
      this.scene.bringToTop(key);
      this.scene.get(key).events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        if (!this.closed) { this.panelLayer.setVisible(true); this.portrait?.root.setVisible(true); this.listen(true); }
        resolve();
      });
    });
  }

  private listen(on: boolean): void {
    this.input.enabled = on;
    const keys = this.input.keyboard;
    if (keys) { keys.enabled = on; keys.resetKeys(); }
  }

  // ── The backdrop stand-in ─────────────────────────────────────────────────

  /** No art yet: a wash in the time of day's colours, a horizon glow, and a plaque naming the place. */
  private paintStandIn(id: string): void {
    this.backdropLayer.removeAll(true);
    const palette = MOOD_PALETTE[backdropMood(id)];
    // The scene's own backdrop names its place; a mid-scene {backdrop} change names itself.
    const header = this.session.header(this.session.active ?? '');
    const [zoneId = '', placeId = ''] = header?.backdrop === id ? header.place.split('.') : [];
    const title = placeId ? placeName(placeId) : backdropTitle(id);
    const zoneName = zones[zoneId]?.name ?? '';
    const sceneTitle = this.session.active ? sceneName(this.session.scene(this.session.active)?.title, this.session.active) : '';

    const wash = this.add.graphics();
    wash.fillGradientStyle(palette.sky, palette.sky, palette.ground, palette.ground, 1).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    // A low sun (or lamp) on the horizon, and the corners drawn in.
    const glow = this.add.image(GAME_WIDTH / 2, 330, softDisc(this)).setDisplaySize(1700, 420).setTint(palette.accent).setAlpha(0.42).setBlendMode(Phaser.BlendModes.ADD);
    const vignette = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, vignetteTexture(this)).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setAlpha(0.55);
    const rule = this.add.graphics();
    rule.fillStyle(0x0c100d, 0.32).fillRoundedRect(GAME_WIDTH / 2 - 330, 34, 660, 128, 16);
    rule.lineStyle(1, palette.accent, 0.45).strokeRoundedRect(GAME_WIDTH / 2 - 330, 34, 660, 128, 16);
    rule.lineStyle(1, palette.accent, 0.6).lineBetween(GAME_WIDTH / 2 - 90, 122, GAME_WIDTH / 2 + 90, 122);
    const accent = `#${palette.accent.toString(16).padStart(6, '0')}`;
    const zoneText = this.add.text(GAME_WIDTH / 2, 56, zoneName.toUpperCase(), {
      fontFamily: FAMILY_HEADING, fontSize: '15px', color: accent, resolution: RENDER_SCALE
    }).setOrigin(0.5, 0).setLetterSpacing(4);
    const placeText = this.add.text(GAME_WIDTH / 2, 76, title, {
      fontFamily: FAMILY_HEADING, fontSize: '38px', color: '#fff0ce', resolution: RENDER_SCALE
    }).setOrigin(0.5, 0);
    const sub = this.add.text(GAME_WIDTH / 2, 130, [palette.label, sceneTitle].filter(Boolean).join('  ·  '), {
      fontFamily: FAMILY_BODY, fontSize: '16px', fontStyle: 'italic', color: '#e9dfc4', resolution: RENDER_SCALE
    }).setOrigin(0.5, 0);
    this.backdropLayer.add([wash, glow, vignette, rule, zoneText, placeText, sub]);
  }

  // ── The log ───────────────────────────────────────────────────────────────

  private openLog(): void {
    if (this.backlog || this.closed) return;
    const title = this.sceneId ? sceneName(this.session.scene(this.sceneId)?.title, this.sceneId) : 'This scene';
    this.backlog = new Backlog(this, { x: PANEL_X, y: 36, w: PANEL_W, h: PANEL_Y - 36 - 24 }, this.log, '', () => this.closeLog(), { title });
  }

  private closeLog(): void {
    this.backlog?.destroy();
    this.backlog = null;
  }

  // ── Keys ──────────────────────────────────────────────────────────────────

  private onKey(e: KeyboardEvent): void {
    if (this.closed) return;
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
    if (this.answer) {
      if (/^[1-9]$/.test(key)) { const i = Number(key) - 1; if (i < this.buttons.length) { playSfx('click'); this.pick(i); } return; }
      if (key === 'ArrowDown' || (key === 'Tab' && !e.shiftKey)) { e.preventDefault(); this.moveFocus(1); return; }
      if (key === 'ArrowUp' || (key === 'Tab' && e.shiftKey)) { e.preventDefault(); this.moveFocus(-1); return; }
      if (key === 'Enter' || key === ' ') { e.preventDefault(); playSfx('click'); this.pick(this.focus); }
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
    if (paused) this.open.clock.pause('story'); else this.open.clock.resume('story');
  }

  /** Nothing more to play: back to the world. */
  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.hideButtons();
    this.closeLog();
    if (this.musicStarted) getMusic(this).stop(1200);
    if (!this.revealed) { this.scene.stop(); return; }
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 200, onComplete: () => this.scene.stop() });
  }

  /** On shutdown, however it came: give the world back. */
  private teardown(): void {
    this.closed = true;
    this.answer = null;
    this.waitDone = null;
    this.lineDone = null;
    this.stopThinking();
    this.closeLog();
    this.portrait?.destroy();
    this.portrait = null;
    this.input.keyboard?.removeCapture('SPACE,TAB,UP,DOWN');
    if (this.session.presenter === this) this.session.presenter = null;
    this.session.settle();
    this.session.world?.persist();
    this.pauseWorld(false);
  }
}
