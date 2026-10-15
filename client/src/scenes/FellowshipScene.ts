// Character creation as the Fellowship application (GDD §11.1; MVP W-07): Pell's hand-lettered form on a
// clipboard, two pages (Particulars, Likeness), the live sprite pinned beside it walking in place, and a
// signature line with the player's badge. Keyboard and mouse both work throughout.
//
// The fields, their words and the look they make live in fellow/options.ts (pure); this scene only draws
// them and routes input. Signing stores the profile, look and starting skills in the registry
// (fellow/state.ts, so saves include them), sends the profile to monde-mind (fail soft: offline it goes on
// the next connect), then either starts the next scene (New Game) or resolves the story host's promise
// (openFellowshipForm, for S01's {charcreate} cue).

import Phaser from 'phaser';
import { BACKGROUNDS, BUILDS, HAIR_STYLES, HEIGHTS, LOVES, NAME_MAX, NAME_TYPABLE, WHY_MONDE, checkName, type PlayerProfile } from '@monde/shared';
import { FAMILY_BODY, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import { CharacterSprite, badgeTexture } from '../render/characterSprite';
import { CLOTH_COLOURS, EYE_COLOURS, HAIR_COLOURS, SKIN_TONES, type CharacterLook } from '../render/character/look';
import type { Facing } from '../render/character/sheet';
import {
  BACKGROUND_TEXT, BUILD_TEXT, CLOTH_TEXT, CUSTOM_PRONOUN_EXAMPLE, CUSTOM_PRONOUN_GAPS, DEFAULT_CHOICES, EYE_TEXT, FIELD_TEXT,
  FORM_TEXT, HAIR_COLOUR_TEXT, HAIR_STYLE_TEXT, HEIGHT_TEXT, LOVE_TEXT, OUTFITS, PRONOUN_OPTIONS, PRONOUN_TEXT, SKIN_ORDER,
  STARTER_OUTFITS, WHY_TEXT, blankForm, formFrom, lookFromChoices, randomChoices, readForm, type FormProblem, type FormState
} from '../fellow/options';
import { getFellow, setFellow, signedFellow, type Fellow } from '../fellow/state';
import { getMind } from '../mind/api';

export const FELLOWSHIP_SCENE = 'Fellowship';

export interface FellowshipResult { profile: PlayerProfile; look: CharacterLook; fellow: Fellow }

export interface FellowshipData {
  /** New Game: the scene to start once the form is signed. */
  next?: string;
  /** Story cue: the scene to resume once signed (it was paused by openFellowshipForm). */
  resume?: string;
  /**
   * Launched over a scene that waits for this one to shut down (StoryScene's {charcreate}): fill the form in
   * from the registry's fellow and just stop once signed.
   */
  fromStory?: boolean;
  host?: string;
  /** Called with the result once signed (after the registry is updated). */
  onSigned?: (result: FellowshipResult) => void;
  /** Fill the form in from these (opening it a second time). */
  profile?: PlayerProfile | null;
  look?: CharacterLook | null;
}

/**
 * For the story host's {charcreate} cue: pause `host`, show the form over it (filled in with what the player
 * already chose, if anything), and resolve with the signed profile once the player signs.
 */
export function openFellowshipForm(host: Phaser.Scene): Promise<FellowshipResult> {
  return new Promise(resolve => {
    const fellow = getFellow(host.registry);
    const data: FellowshipData = { resume: host.scene.key, profile: fellow?.profile ?? null, look: fellow?.look ?? null, onSigned: resolve };
    host.scene.launch(FELLOWSHIP_SCENE, data);
    host.scene.pause();
  });
}

// ── Look of the page ────────────────────────────────────────────────────────

/** Hand-lettering: Caveat if installed, else the system's handwriting faces. */
const HAND = '"Caveat", "Bradley Hand", "Noteworthy", "Segoe Print", "Chalkboard SE", cursive';
const PRINT = FAMILY_BODY;
const INK = '#26324a', PRINTED = '#5b4a36', FADED = '#a08f75', RED = '#b03a2e', PENCIL = '#7a6d60';
const INK_N = 0x26324a, RED_N = 0xb03a2e;

const PAPER = { x: 56, y: 40, w: 828, h: 654 };
const LABEL_X = 116, CONTROL_X = 330, CONTROL_END = 868;
const CARD = { x: 912, y: 40, w: 332, h: 520 };
const SPRITE = { x: CARD.x + CARD.w / 2, feet: 426, scale: 6 };
const FOOTER_Y = 604;

/** Facings in the order "Turn about" walks through them. */
const TURN: readonly Facing[] = ['down', 'left', 'up', 'right'];
const DIR: Record<Facing, { x: number; y: number }> = { down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
/** The walk-in-place pace, tiles/s (the player's walking speed, so the feet move as they will in town). */
const WALK_SPEED = 4;

/** A line you can put the pencil on. */
interface Field {
  id: string;
  /** The highlighter band behind it. */
  area: { x: number; y: number; w: number; h: number };
  step?: (d: -1 | 1) => void;
  press?: () => void;
  /** Typing goes here. */
  text?: 'name' | 'custom';
}

export class FellowshipScene extends Phaser.Scene {
  private opts: FellowshipData = {};
  private form: FormState = blankForm();
  private page: 0 | 1 = 0;
  private focusId = 'tabs';
  private customBox = 0;
  /** Sign was pressed: show every problem from now on. */
  private tried = false;
  private nameTouched = false;
  private problems: FormProblem[] = [];
  private facing: Facing = 'down';
  private walking = true;
  private done = false;
  /** Something changed: redraw on the next update (never inside an input handler, whose objects it destroys). */
  private dirty = false;
  private avatar: CharacterSprite | null = null;
  private figure!: Phaser.GameObjects.Image;
  private badge!: Phaser.GameObjects.Image;
  private layer: Phaser.GameObjects.GameObject[] = [];
  private fields: Field[] = [];
  private caret: Phaser.GameObjects.Text | null = null;
  private caretMs = 0;
  /** The last input was the mouse (picking "Other…" by click puts the pencil in its first box; by key it stays put). */
  private pointer = false;
  /** Preview textures this form made (dropped once a newer look replaces them). */
  private made = new Set<string>();

  constructor() { super(FELLOWSHIP_SCENE); }

  init(data: FellowshipData = {}): void {
    this.opts = data;
    const overScene = !!(data.resume || data.fromStory || data.host);
    const fellow = overScene ? getFellow(this.registry) : null;
    const profile = data.profile ?? fellow?.profile ?? null, look = data.look ?? fellow?.look ?? null;
    this.form = profile || look ? formFrom(profile, look) : blankForm();
    this.page = 0; this.focusId = 'name'; this.customBox = 0; this.tried = false; this.nameTouched = !!profile;
    this.problems = []; this.facing = 'down'; this.walking = true; this.done = false;
    this.layer = []; this.fields = []; this.caret = null; this.made = new Set(); this.avatar = null; this.dirty = false;
  }

  create(): void {
    this.cameras.main.setZoom(RENDER_SCALE).setOrigin(0, 0);
    this.drawStatic();
    this.figure = this.add.image(SPRITE.x, SPRITE.feet, '__DEFAULT').setDepth(5);
    this.figure.setInteractive({ useHandCursor: true }).on('pointerdown', () => { this.walking = !this.walking; this.focus('turn'); });
    this.badge = this.add.image(560, FOOTER_Y + 36, '__DEFAULT').setScale(2).setDepth(5);
    this.refreshLook();
    this.render();

    const onKey = (event: KeyboardEvent) => this.onKey(event);
    this.input.keyboard?.on('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.input.keyboard?.off('keydown', onKey));
  }

  update(_time: number, delta: number): void {
    if (this.dirty) { this.dirty = false; this.render(); }
    if (!this.avatar) return;
    const dt = Math.min(delta, 100);
    const dir = DIR[this.facing], dist = this.walking ? (WALK_SPEED * dt) / 1000 : 0;
    this.avatar.step({ intent: dir, moved: { x: dir.x * dist, y: dir.y * dist }, dtMs: dt });
    this.avatar.apply(this.figure, false);
    this.figure.setScale(SPRITE.scale);
    this.caretMs += delta;
    this.caret?.setVisible(Math.floor(this.caretMs / 530) % 2 === 0);
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  /** The clipboard, the paper, the header and the likeness card: drawn once. */
  private drawStatic(): void {
    const g = this.add.graphics();
    g.fillStyle(0x23332f, this.opts.next ? 1 : 0.86).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    // Clipboard and its clip.
    g.fillStyle(0x6e4a30).fillRoundedRect(PAPER.x - 18, PAPER.y - 26, PAPER.w + 36, PAPER.h + 40, 10);
    g.lineStyle(2, 0x4d321f).strokeRoundedRect(PAPER.x - 18, PAPER.y - 26, PAPER.w + 36, PAPER.h + 40, 10);
    // The paper: a soft shadow, cream stock, faint rules and a red margin.
    g.fillStyle(0x000000, 0.18).fillRect(PAPER.x + 4, PAPER.y + 5, PAPER.w, PAPER.h);
    g.fillStyle(0xf4e8cc).fillRect(PAPER.x, PAPER.y, PAPER.w, PAPER.h);
    g.lineStyle(1, 0xb9c8cf, 0.45);
    for (let y = PAPER.y + 136; y < PAPER.y + PAPER.h - 8; y += 21) g.lineBetween(PAPER.x + 6, y, PAPER.x + PAPER.w - 6, y);
    g.lineStyle(1, 0xc0504d, 0.35).lineBetween(PAPER.x + 44, PAPER.y + 4, PAPER.x + 44, PAPER.y + PAPER.h - 4);
    g.fillStyle(0x9aa3a8).fillRoundedRect(PAPER.x + PAPER.w / 2 - 70, PAPER.y - 34, 140, 26, 6);
    g.fillStyle(0x6f777c).fillRoundedRect(PAPER.x + PAPER.w / 2 - 46, PAPER.y - 28, 92, 10, 4);
    // The likeness card, pinned.
    g.fillStyle(0x000000, 0.2).fillRect(CARD.x + 4, CARD.y + 5, CARD.w, CARD.h);
    g.fillStyle(0xf7eedb).fillRect(CARD.x, CARD.y, CARD.w, CARD.h);
    g.lineStyle(1, 0xd8c8a4).strokeRect(CARD.x + 8, CARD.y + 8, CARD.w - 16, CARD.h - 16);
    g.fillStyle(0xc0504d).fillCircle(CARD.x + CARD.w / 2, CARD.y + 10, 6);
    g.fillStyle(0xe8a39a).fillCircle(CARD.x + CARD.w / 2 - 2, CARD.y + 8, 2);
    g.fillStyle(0x6b5a40, 0.18).fillEllipse(SPRITE.x, SPRITE.feet + 2, 150, 22);

    this.add.text(PAPER.x + PAPER.w / 2, PAPER.y + 14, FORM_TEXT.office.toUpperCase(), { fontFamily: PRINT, fontSize: '13px', color: PRINTED, letterSpacing: 3 }).setOrigin(0.5, 0);
    this.add.text(PAPER.x + PAPER.w / 2, PAPER.y + 32, FORM_TEXT.title, { fontFamily: HAND, fontSize: '34px', color: INK }).setOrigin(0.5, 0);
    this.add.text(PAPER.x + PAPER.w / 2, PAPER.y + 76, FORM_TEXT.smallPrint, { fontFamily: PRINT, fontSize: '13px', fontStyle: 'italic', color: PENCIL }).setOrigin(0.5, 0);
    this.add.text(CARD.x + CARD.w / 2, CARD.y + 26, 'Likeness', { fontFamily: HAND, fontSize: '30px', color: INK }).setOrigin(0.5, 0);
    this.add.text(CARD.x + CARD.w / 2, CARD.y + 64, FORM_TEXT.likenessNote, { fontFamily: PRINT, fontSize: '12px', fontStyle: 'italic', color: PENCIL, align: 'center', wordWrap: { width: CARD.w - 50 } }).setOrigin(0.5, 0);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 8, this.opts.next ? `${FORM_TEXT.keys} · ${FORM_TEXT.back}` : FORM_TEXT.keys, { fontFamily: PRINT, fontSize: '12px', color: '#c9bfa8' }).setOrigin(0.5, 1);
  }

  /** Everything that changes: the page's rows, the footer, the focus band. Rebuilt on every change. */
  private render(): void {
    for (const o of this.layer) o.destroy();
    this.layer = []; this.fields = []; this.caret = null;
    this.problems = this.visibleProblems();
    this.tabs();
    if (this.page === 0) this.particulars(); else this.likeness();
    this.likenessControls();
    this.footer();
    if (!this.fields.some(f => f.id === this.focusId)) this.focusId = this.fields[0]!.id;
    const f = this.fields.find(x => x.id === this.focusId)!;
    const band = this.add.rectangle(f.area.x, f.area.y, f.area.w, f.area.h, 0xf3d66a, 0.38).setOrigin(0, 0).setDepth(1);
    const mark = this.add.text(f.area.x - 4, f.area.y + f.area.h / 2, '›', { fontFamily: HAND, fontSize: '26px', color: INK }).setOrigin(1, 0.5).setDepth(3);
    this.layer.push(band, mark);
  }

  private text(x: number, y: number, s: string, style: Phaser.Types.GameObjects.Text.TextStyle, depth = 3): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, s, style).setDepth(depth);
    this.layer.push(t);
    return t;
  }
  private clickable<T extends Phaser.GameObjects.GameObject>(o: T, focusId: string, onClick: () => void): T {
    o.setInteractive({ useHandCursor: true });
    o.on('pointerdown', () => { if (this.done) return; this.pointer = true; this.focusId = focusId; onClick(); this.dirty = true; });
    return o;
  }
  private field(f: Field): void { this.fields.push(f); }
  private rowArea(y: number, h: number) { return { x: LABEL_X - 8, y, w: CONTROL_END - LABEL_X + 14, h }; }

  private label(y: number, which: keyof typeof FIELD_TEXT | string, hint = ''): void {
    const t = (FIELD_TEXT as Record<string, { label: string; hint: string }>)[which];
    this.text(LABEL_X, y + 2, t?.label ?? which, { fontFamily: HAND, fontSize: '22px', color: PRINTED });
    const h = hint || t?.hint;
    if (h) this.text(LABEL_X, y + 28, h, { fontFamily: PRINT, fontSize: '11px', fontStyle: 'italic', color: FADED, wordWrap: { width: CONTROL_X - LABEL_X - 12 } });
  }

  private tabs(): void {
    const y = 138;
    FORM_TEXT.pages.forEach((name, i) => {
      const x = i === 0 ? LABEL_X : CONTROL_X, on = this.page === i;
      const t = this.text(x, y, name, { fontFamily: HAND, fontSize: '26px', color: on ? INK : FADED });
      if (on) { const u = this.add.rectangle(x, y + 32, t.width, 2, INK_N).setOrigin(0, 0).setDepth(3); this.layer.push(u); }
      this.clickable(t, 'tabs', () => { this.page = i as 0 | 1; });
    });
    const problemsElsewhere = this.page === 1 && this.problems.length > 0;
    if (problemsElsewhere) this.text(CONTROL_X + 170, y + 8, '← something to fix on page I', { fontFamily: PRINT, fontSize: '13px', color: RED });
    this.field({ id: 'tabs', area: this.rowArea(y - 2, 38), step: d => { this.page = d > 0 ? 1 : 0; }, press: () => { this.page = this.page ? 0 : 1; } });
  }

  // ── Page I: particulars ────────────────────────────────────────────────────

  private particulars(): void {
    const f = this.form;
    // Name.
    let y = 184;
    this.label(y, 'name');
    const nameText = this.text(CONTROL_X + 4, y - 4, f.name || ' ', { fontFamily: HAND, fontSize: '32px', color: INK });
    const line = this.add.rectangle(CONTROL_X, y + 36, 250, 1.5, 0x5b4a36).setOrigin(0, 0).setDepth(2);
    this.layer.push(line);
    this.text(CONTROL_X + 252, y + 22, `${[...f.name].length}/${NAME_MAX}`, { fontFamily: PRINT, fontSize: '11px', color: FADED }).setOrigin(1, 0);
    const hitName = this.add.rectangle(CONTROL_X, y - 6, 252, 46, 0, 0).setOrigin(0, 0).setDepth(4);
    this.layer.push(hitName);
    this.clickable(hitName, 'name', () => undefined);
    if (this.focusId === 'name') this.caret = this.text(CONTROL_X + 6 + (f.name ? nameText.width : 0), y - 4, '|', { fontFamily: HAND, fontSize: '32px', color: INK });
    const nameProblem = this.problems.find(p => p.field === 'name');
    if (nameProblem) this.text(CONTROL_X + 270, y + 4, nameProblem.problem, { fontFamily: PRINT, fontSize: '14px', fontStyle: 'italic', color: RED, wordWrap: { width: CONTROL_END - CONTROL_X - 270 } });
    this.field({ id: 'name', area: this.rowArea(y - 6, 50), text: 'name' });

    // Pronouns, and the custom set's three gaps.
    y = 238;
    this.label(y, 'pronouns');
    this.ticks(y, 'pronouns', PRONOUN_OPTIONS.map(p => PRONOUN_TEXT[p]), PRONOUN_OPTIONS.indexOf(f.pronouns), i => {
      f.pronouns = PRONOUN_OPTIONS[i]!;
      if (f.pronouns === 'custom') { this.customBox = 0; if (this.pointer) this.focusId = 'custom'; }
    });
    if (f.pronouns === 'custom') {
      y = 278;
      let x = CONTROL_X;
      CUSTOM_PRONOUN_GAPS.forEach(([before, after], i) => {
        if (before) { const b = this.text(x, y + 4, before, { fontFamily: PRINT, fontSize: '15px', color: PRINTED }); x += b.width + 6; }
        const box = this.text(x + 2, y - 2, f.custom[i] || CUSTOM_PRONOUN_EXAMPLE[i]!, { fontFamily: HAND, fontSize: '26px', color: f.custom[i] ? INK : '#cdbf9f' });
        const u = this.add.rectangle(x, y + 30, 70, 1.5, 0x5b4a36).setOrigin(0, 0).setDepth(2);
        const hit = this.add.rectangle(x, y - 4, 72, 38, 0, 0).setOrigin(0, 0).setDepth(4);
        this.layer.push(u, hit);
        this.clickable(hit, 'custom', () => { this.customBox = i; });
        if (this.focusId === 'custom' && this.customBox === i) this.caret = this.text(x + 4 + (f.custom[i] ? box.width : 0), y - 2, '|', { fontFamily: HAND, fontSize: '26px', color: INK });
        x += 76;
        if (after) { const a = this.text(x, y + 4, after, { fontFamily: PRINT, fontSize: '15px', color: PRINTED }); x += a.width + 10; }
        if (i < 2) { this.text(x, y + 4, '·', { fontFamily: PRINT, fontSize: '15px', color: FADED }); x += 18; }
      });
      const customProblem = this.problems.find(p => p.field === 'custom');
      if (customProblem) this.text(x + 4, y - 2, customProblem.problem, { fontFamily: PRINT, fontSize: '12px', fontStyle: 'italic', color: RED, wordWrap: { width: Math.max(90, CONTROL_END - x - 4) } });
      this.text(LABEL_X, y + 4, FIELD_TEXT.custom.label, { fontFamily: HAND, fontSize: '20px', color: FADED });
      this.field({ id: 'custom', area: this.rowArea(y - 6, 42), text: 'custom', step: d => { this.customBox = Math.max(0, Math.min(2, this.customBox + d)); } });
    }

    // Background, with its start and perk spelt out.
    y = 322;
    this.label(y, 'background');
    this.ticks(y, 'background', BACKGROUNDS.map(b => BACKGROUND_TEXT[b].name), BACKGROUNDS.indexOf(f.background), i => { f.background = BACKGROUNDS[i]!; });
    const bg = BACKGROUND_TEXT[f.background], wrap = { width: CONTROL_END - CONTROL_X };
    this.text(CONTROL_X, y + 34, bg.who, { fontFamily: HAND, fontSize: '20px', color: INK });
    const start = this.text(CONTROL_X, y + 62, `Start: ${bg.start}`, { fontFamily: PRINT, fontSize: '13px', color: PRINTED, wordWrap: wrap });
    this.text(CONTROL_X, start.y + start.height + 3, `Perk: ${bg.perk}`, { fontFamily: PRINT, fontSize: '13px', color: PRINTED, wordWrap: wrap });

    // Why Monde?
    y = 460;
    this.label(y, 'why');
    this.ticks(y, 'why', WHY_MONDE.map(w => WHY_TEXT[w]), WHY_MONDE.indexOf(f.why), i => { f.why = WHY_MONDE[i]!; });

    // Something you love: all twelve at once, the chosen one ringed.
    y = 500;
    this.label(y, 'loves');
    const at = LOVES.indexOf(f.loves);
    LOVES.forEach((love, i) => {
      const x = CONTROL_X + (i % 4) * 136, ty = y + Math.floor(i / 4) * 27;
      const t = this.text(x + 4, ty, LOVE_TEXT[love], { fontFamily: HAND, fontSize: '20px', color: i === at ? INK : PENCIL });
      if (i === at) this.ring(x, ty + 2, t.width + 8, 24);
      this.clickable(t, 'loves', () => { f.loves = love; });
    });
    this.field({ id: 'loves', area: this.rowArea(y - 4, 88), step: d => { f.loves = LOVES[(at + d + LOVES.length) % LOVES.length]!; } });
  }

  // ── Page II: likeness ─────────────────────────────────────────────────────

  private likeness(): void {
    const c = this.form.look;
    const look = () => this.refreshLook();
    let y = 186;
    this.label(y, 'build');
    this.ticks(y, 'build', BUILDS.map(b => BUILD_TEXT[b]), BUILDS.indexOf(c.build), i => { c.build = BUILDS[i]!; look(); });
    y += 42;
    this.label(y, 'height');
    this.ticks(y, 'height', HEIGHTS.map(h => HEIGHT_TEXT[h]), HEIGHTS.indexOf(c.height), i => { c.height = HEIGHTS[i]!; look(); });
    y += 42;
    this.label(y, 'skin');
    const skinAt = SKIN_ORDER.indexOf(c.skin);
    this.swatches(y, 'skin', SKIN_ORDER.map(i => SKIN_TONES[i]!), skinAt, `Tone ${skinAt + 1} of ${SKIN_ORDER.length}`, i => { c.skin = SKIN_ORDER[i]!; look(); });
    y += 42;
    this.label(y, 'hairStyle');
    this.chooser(y, 'hairStyle', HAIR_STYLE_TEXT[c.hairStyle], d => { c.hairStyle = HAIR_STYLES[(HAIR_STYLES.indexOf(c.hairStyle) + d + HAIR_STYLES.length) % HAIR_STYLES.length]!; look(); });
    y += 42;
    this.label(y, 'hair');
    this.swatches(y, 'hair', HAIR_COLOURS, c.hair, HAIR_COLOUR_TEXT[c.hair]!, i => { c.hair = i; look(); });
    y += 42;
    this.label(y, 'eyes');
    this.swatches(y, 'eyes', EYE_COLOURS, c.eyes, EYE_TEXT[c.eyes]!, i => { c.eyes = i; look(); });
    y += 42;
    this.label(y, 'outfit');
    const outfit = OUTFITS[c.outfit];
    this.chooser(y, 'outfit', outfit.name, d => {
      c.outfit = STARTER_OUTFITS[(STARTER_OUTFITS.indexOf(c.outfit) + d + STARTER_OUTFITS.length) % STARTER_OUTFITS.length]!;
      c.slots = OUTFITS[c.outfit].defaults;
      look();
    });
    for (let s = 0; s < 3; s++) {
      y += s === 0 ? 42 : 38;
      this.text(LABEL_X + 18, y + 4, `${outfit.slots[s]}`, { fontFamily: HAND, fontSize: '21px', color: PENCIL });
      const at = c.slots[s]!;
      this.swatches(y, `slot${s}`, CLOTH_COLOURS, at, CLOTH_TEXT[at]!, i => {
        const slots = [...c.slots] as [number, number, number];
        slots[s] = i; c.slots = slots; look();
      }, 18);
    }
  }

  // ── Controls ──────────────────────────────────────────────────────────────

  /** A row of tick boxes; ← → move the tick. */
  private ticks(y: number, id: string, labels: readonly string[], at: number, pick: (i: number) => void): void {
    // Measure first, then space the boxes out as far as the line allows.
    const texts = labels.map((label, i) => this.text(0, y + 2, label, { fontFamily: PRINT, fontSize: '16px', color: i === at ? INK : PRINTED }));
    const used = texts.reduce((sum, t) => sum + t.width + 24, 0);
    const gap = Math.max(12, Math.min(48, (CONTROL_END - CONTROL_X - used) / Math.max(1, labels.length - 1)));
    let x = CONTROL_X;
    texts.forEach((t, i) => {
      const box = this.add.rectangle(x, y + 8, 16, 16).setOrigin(0, 0).setStrokeStyle(1.5, 0x5b4a36).setDepth(2);
      this.layer.push(box);
      if (i === at) this.text(x - 2, y - 6, '✓', { fontFamily: HAND, fontSize: '30px', color: INK });
      t.setX(x + 24);
      const hit = this.add.rectangle(x - 4, y, t.width + 32, 32, 0, 0).setOrigin(0, 0).setDepth(4);
      this.layer.push(hit);
      this.clickable(hit, id, () => pick(i));
      x += t.width + 24 + gap;
    });
    this.field({ id, area: this.rowArea(y - 4, 40), step: d => pick((at + d + labels.length) % labels.length) });
  }

  /** Colour swatches; the chosen one ringed in pencil, its name after them. */
  private swatches(y: number, id: string, colours: readonly number[], at: number, name: string, pick: (i: number) => void, size = 22): void {
    const gap = size + 5;
    colours.forEach((colour, i) => {
      const x = CONTROL_X + i * gap;
      const sw = this.add.rectangle(x, y + 6, size, size, colour).setOrigin(0, 0).setStrokeStyle(1, 0x5b4a36, 0.6).setDepth(2);
      this.layer.push(sw);
      if (i === at) this.ring(x - 3, y + 3, size + 6, size + 6);
      this.clickable(sw, id, () => pick(i));
    });
    this.text(CONTROL_X + colours.length * gap + 8, y + 6, name, { fontFamily: HAND, fontSize: '21px', color: INK });
    this.field({ id, area: this.rowArea(y - 2, size + 14), step: d => pick((at + d + colours.length) % colours.length) });
  }

  /** ◀ value ▶ for long lists (hair styles, outfits). */
  private chooser(y: number, id: string, value: string, step: (d: -1 | 1) => void): void {
    const left = this.text(CONTROL_X, y - 2, '◀', { fontFamily: PRINT, fontSize: '20px', color: PRINTED });
    const v = this.text(CONTROL_X + 140, y - 2, value, { fontFamily: HAND, fontSize: '26px', color: INK }).setOrigin(0.5, 0);
    const right = this.text(CONTROL_X + 266, y - 2, '▶', { fontFamily: PRINT, fontSize: '20px', color: PRINTED });
    this.clickable(left, id, () => step(-1));
    this.clickable(v, id, () => step(1));
    this.clickable(right, id, () => step(1));
    this.field({ id, area: this.rowArea(y - 4, 38), step });
  }

  /** A pencil ring round the chosen option. */
  private ring(x: number, y: number, w: number, h: number): void {
    const g = this.add.graphics().setDepth(2);
    g.lineStyle(2, INK_N, 0.85).strokeEllipse(x + w / 2, y + h / 2, w + 6, h + 4);
    this.layer.push(g);
  }

  /** Under the likeness: turn about, leave it to chance, rub it out. */
  private likenessControls(): void {
    const cx = CARD.x + CARD.w / 2, y = SPRITE.feet + 30;
    const left = this.text(cx - 110, y, '◀', { fontFamily: PRINT, fontSize: '22px', color: PRINTED }).setOrigin(0.5, 0);
    const label = this.text(cx, y - 2, FORM_TEXT.turn, { fontFamily: HAND, fontSize: '26px', color: INK }).setOrigin(0.5, 0);
    const right = this.text(cx + 110, y, '▶', { fontFamily: PRINT, fontSize: '22px', color: PRINTED }).setOrigin(0.5, 0);
    const turn = (d: -1 | 1) => { this.facing = TURN[(TURN.indexOf(this.facing) + d + TURN.length) % TURN.length]!; };
    this.clickable(left, 'turn', () => turn(-1));
    this.clickable(right, 'turn', () => turn(1));
    this.clickable(label, 'turn', () => { this.walking = !this.walking; });
    this.text(cx, y + 34, this.walking ? '(walking: click to stand)' : '(standing: click to walk)', { fontFamily: PRINT, fontSize: '11px', fontStyle: 'italic', color: FADED }).setOrigin(0.5, 0);
    this.field({ id: 'turn', area: { x: CARD.x + 20, y: y - 6, w: CARD.w - 40, h: 58 }, step: turn, press: () => { this.walking = !this.walking; } });

    const button = (id: string, by: number, words: string, run: () => void) => {
      const bx = CARD.x + 30, bw = CARD.w - 60;
      const tag = this.add.rectangle(bx, by, bw, 40, 0xe9dcbc).setOrigin(0, 0).setStrokeStyle(1.5, 0x8a7558).setDepth(2);
      const hole = this.add.circle(bx + 16, by + 20, 4, 0x23332f).setDepth(3);
      this.layer.push(tag, hole);
      this.text(bx + bw / 2 + 8, by + 6, words, { fontFamily: HAND, fontSize: '24px', color: INK }).setOrigin(0.5, 0);
      this.clickable(tag, id, run);
      this.field({ id, area: { x: bx - 6, y: by - 4, w: bw + 12, h: 48 }, press: run });
    };
    button('random', CARD.y + CARD.h + 18, FORM_TEXT.randomise, () => { this.form.look = randomChoices(); this.refreshLook(); });
    button('reset', CARD.y + CARD.h + 68, FORM_TEXT.reset, () => { this.form.look = { ...DEFAULT_CHOICES }; this.refreshLook(); });
  }

  /** The signature line: "Signed", the name in ink, the badge, and the Sign button. */
  private footer(): void {
    const y = FOOTER_Y;
    this.text(LABEL_X, y + 22, FORM_TEXT.signed, { fontFamily: HAND, fontSize: '24px', color: PRINTED });
    const line = this.add.rectangle(200, y + 58, 310, 1.5, 0x5b4a36).setOrigin(0, 0).setDepth(2);
    this.layer.push(line);
    const checked = checkName(this.form.name), name = checked.ok ? checked.name : '';
    if (name) this.text(212, y + 14, name, { fontFamily: HAND, fontSize: '38px', color: INK }).setAngle(-3);
    const bx = 700, bw = 150;
    const seal = this.add.rectangle(bx, y + 14, bw, 50, RED_N).setOrigin(0, 0).setStrokeStyle(2, 0x7a2219).setDepth(2);
    this.layer.push(seal);
    this.text(bx + bw / 2, y + 22, FORM_TEXT.sign, { fontFamily: HAND, fontSize: '30px', color: '#fbeee0' }).setOrigin(0.5, 0);
    this.clickable(seal, 'sign', () => this.sign());
    if (this.tried && this.problems.length) this.text(bx + bw / 2, y + 68, 'Not yet: see the red ink.', { fontFamily: PRINT, fontSize: '12px', fontStyle: 'italic', color: RED }).setOrigin(0.5, 0);
    this.field({ id: 'sign', area: { x: bx - 8, y: y + 8, w: bw + 16, h: 62 }, press: () => this.sign() });
  }

  // ── The look ──────────────────────────────────────────────────────────────

  /** Re-dress the sprite and the badge from the choices. */
  private refreshLook(): void {
    const look = lookFromChoices(this.form.look);
    const before = new Set(this.textures.getTextureKeys());
    const oldSheet = this.avatar?.sheet.key, oldBadge = this.badge.texture.key;
    // Not "player": the preview always shows the rig's drawing of the choices, even once a drawn player sheet exists.
    this.avatar = new CharacterSprite(this, 'fellowship-preview', look, this.facing);
    if (!before.has(this.avatar.sheet.key)) this.made.add(this.avatar.sheet.key);
    this.avatar.apply(this.figure, false);
    this.figure.setScale(SPRITE.scale);
    const badgeKey = badgeTexture(this, look);
    if (!before.has(badgeKey)) this.made.add(badgeKey);
    this.badge.setTexture(badgeKey);
    for (const old of [oldSheet, oldBadge]) {
      if (old && old !== this.avatar.sheet.key && old !== badgeKey && this.made.has(old)) { this.textures.remove(old); this.made.delete(old); }
    }
  }

  // ── Input ─────────────────────────────────────────────────────────────────

  private focus(id: string): void { this.focusId = id; this.dirty = true; }

  private onKey(e: KeyboardEvent): void {
    if (this.done) return;
    this.pointer = false;
    const f = this.fields.find(x => x.id === this.focusId);
    if (f?.text && this.type(f.text, e)) { this.caretMs = 0; this.dirty = true; return; }
    const move = (d: number) => {
      const i = this.fields.findIndex(x => x.id === this.focusId);
      this.focusId = this.fields[(i + d + this.fields.length) % this.fields.length]!.id;
    };
    switch (e.key) {
      case 'ArrowUp': move(-1); break;
      case 'ArrowDown': move(1); break;
      case 'Tab': e.preventDefault(); move(e.shiftKey ? -1 : 1); break;
      case 'ArrowLeft': f?.step?.(-1); break;
      case 'ArrowRight': f?.step?.(1); break;
      case 'Enter': case ' ': if (f?.press) f.press(); else move(1); break;
      case 'PageUp': this.page = 0; break;
      case 'PageDown': this.page = 1; break;
      case 'Escape':
        if (this.opts.next) { this.done = true; this.scene.start('Title'); }
        return;
      default: return;
    }
    if (this.done) return;
    this.dirty = true;
  }

  /** Typing into the name or a custom pronoun box. True if the key was used. */
  private type(where: 'name' | 'custom', e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const f = this.form;
    if (where === 'name') {
      this.nameTouched = true;
      if (e.key === 'Backspace') { f.name = [...f.name].slice(0, -1).join(''); return true; }
      if (e.key.length === 1 && [...e.key].length === 1 && NAME_TYPABLE.test(e.key)) {
        if ([...f.name].length < NAME_MAX && !(e.key === ' ' && (!f.name || f.name.endsWith(' ')))) f.name += e.key;
        return true;
      }
      if (e.key === 'Enter') { this.focusId = 'pronouns'; return true; }
      return false;
    }
    const box = this.customBox, word = f.custom[box]!;
    if (e.key === 'Backspace') {
      if (word) f.custom[box] = word.slice(0, -1);
      else this.customBox = Math.max(0, box - 1);
      return true;
    }
    if (/^[a-zA-Z]$/.test(e.key)) { if (word.length < 8) f.custom[box] = word + e.key.toLowerCase(); return true; }
    if (e.key === '/' || e.key === ' ' || (e.key === 'Enter' && box < 2)) { this.customBox = Math.min(2, box + 1); return true; }
    return false;
  }

  /** Problems to show: the name's once it's been typed in, and all of them after a try at signing. */
  private visibleProblems(): FormProblem[] {
    const result = readForm(this.form);
    if (result.ok) return [];
    return result.problems.filter(p => this.tried || (p.field === 'name' && this.nameTouched && this.form.name.length > 0) || (p.field === 'custom' && this.form.custom.some(Boolean)));
  }

  // ── Signing ───────────────────────────────────────────────────────────────

  private sign(): void {
    if (this.done) return;
    this.tried = true;
    const result = readForm(this.form);
    if (!result.ok) {
      this.page = 0;
      this.focusId = result.problems[0]!.field;
      return;
    }
    this.done = true;
    const fellow = signedFellow(result.profile, result.look);
    setFellow(this.registry, fellow);
    // Fail soft: offline (or before a world exists) the profile waits and goes on the next connect.
    void getMind().setPlayer(result.profile).catch(() => false);
    this.dirty = true;
    this.stamp(() => this.finish({ profile: result.profile, look: result.look, fellow }));
  }

  /** Pell's RECEIVED stamp lands on the form. */
  private stamp(then: () => void): void {
    const stamp = this.add.text(PAPER.x + PAPER.w - 250, FOOTER_Y - 120, 'RECEIVED\nE. Pell, Mayor', {
      fontFamily: PRINT, fontSize: '26px', fontStyle: 'bold', color: RED, align: 'center', lineSpacing: 2
    }).setOrigin(0.5).setAngle(-9).setAlpha(0).setScale(1.6).setDepth(8);
    const border = this.add.rectangle(stamp.x, stamp.y, stamp.width + 24, stamp.height + 16).setStrokeStyle(3, RED_N).setAngle(-9).setAlpha(0).setScale(1.6).setDepth(8);
    this.tweens.add({ targets: [stamp, border], alpha: 0.85, scale: 1, duration: 180, ease: 'Quad.easeIn' });
    this.time.delayedCall(950, () => this.cameras.main.fadeOut(280, 20, 17, 15));
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, then);
  }

  private finish(result: FellowshipResult): void {
    const { next, resume, onSigned } = this.opts;
    if (next) this.scene.start(next);
    else {
      // Over another scene: hand back (a story host waits for this shutdown; openFellowshipForm resumes its caller).
      if (resume) this.scene.resume(resume);
      this.scene.stop();
    }
    onSigned?.(result);
  }
}
