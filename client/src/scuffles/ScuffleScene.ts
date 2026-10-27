import { ALLIES, askAlly, canInvite } from './allies';
import type { ResidentSim } from '../sim/residentSim';
import { deploymentTiles } from '../combat/scuffle/arena';
import { fighter } from '../combat/scuffle/engine';
import { SUN } from '../render/sun';
import Phaser from 'phaser';
import { FAMILY_BODY, FAMILY_HEADING, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import { TownBoard, preloadTownSprites } from '../render/town/TownBoard';
import { ObliqueProjection } from '../render/ObliqueProjection';
import { DIORAMA_ELEV_STEP, DIORAMA_FOOT_DY, DIORAMA_SLAB_DEPTH, DIORAMA_TILE_H, DIORAMA_TILE_W } from '../render/dioramaConfig';
import { frameArena } from './frame';
import { CharacterSprite, playerLook } from '../render/characterSprite';
import { residentLook, type Look } from '../render/character/look';
import { drawFrame } from '../render/character/rig';
import { SCUFFLE_POSES } from '../render/character/scuffle';
import { type Action, type Fighter, type Outcome, type Supply, same, talkOdds } from '../combat/scuffle/engine';
import { SCUFFLES, TUTORIAL, isScuffleId } from '../combat/scuffle/catalog';
import { isAlive } from '../combat/Unit';
import { type Encounter, prepare, scufflesOf, settle, pressure } from './runtime';
import { flagsOf } from '../projects/runtime';
import { personaCards } from '../world/residents';
import { regardFor } from '../scenes/friendship';
import type { Clock } from '../sim/clock';
import type { TilePos } from '../combat/types';

export const SCUFFLE_SCENE = 'Scuffle';
const BACKDROP = 0x253c37;
/** A fighter's frame height, px (the rig's 32×48; pose() draws the same). */
const FIGURE_H = 48;
/**
 * The left page the arena is framed on (design px): under the title and round lines, above the enemies' intents, left
 * of the panel at x 730. Layout tuning.
 */
const ARENA_PAGE = { x: 12, y: 92, w: 706, h: 398 };
/** Clear above the back row: a fighter standing there. Never closer than a room is drawn (ZoneScene's INDOOR_ZOOM). */
const ARENA_FIT = { maxZoom: 1.5, headroom: FIGURE_H - DIORAMA_TILE_H / 2 - DIORAMA_FOOT_DY, pad: 6 };
interface Open { encounter: Encounter; host: string; clock: Clock; done(outcome: Outcome): void; cancel(): void; witnesses: string[] }
export function openScuffle(host: Phaser.Scene, clock: Clock, id: string, opts: { key?: string; story?: boolean; zone?: string; centre?: TilePos } = {}): Promise<Outcome> {
  if (!isScuffleId(id)) return Promise.reject(new Error(`Scuffle ${id} is outside the Spring MVP.`));
  const key = opts.key ?? `${id}:${clock.day}:${clock.minute}`;
  const previous = scufflesOf(host.registry).results[key]; if (previous) return Promise.resolve(previous.outcome);
  if (host.scene.isActive(SCUFFLE_SCENE)) return Promise.reject(new Error('A Scuffle is already running.'));
  // GDD-GAP: plans have no join enum. Explicit daily offers can prefill the party; otherwise the preparation screen asks through dialogue.
  const willing = (host.registry.get('monde.scuffle.offers') ?? {}) as Record<string, number>;
  const offers = (['augusta', 'kasimir', 'nell'] as const).map(id => ({ id, regard: regardFor(host.registry, id),
    willScuffle: personaCards.find(c => c.id === id)?.will_scuffle !== false, willing: willing[id] === clock.day }));
  const encounter = prepare(host.registry, id, clock, { ...opts, key, offers, regard: id => regardFor(host.registry, id) });
  const residents = host.registry.get('monde.residents') as ResidentSim | undefined;
  const witnesses = residents?.tick(clock.day, clock.minute).filter(r => r.zone === encounter.zone && (r.place === encounter.place || r.visible && r.position && opts.centre && Math.abs(r.position.x - opts.centre.x) + Math.abs(r.position.y - opts.centre.y) <= 8)).map(r => r.id) ?? [];
  if (!host.game.scene.keys[SCUFFLE_SCENE]) host.scene.add(SCUFFLE_SCENE, ScuffleScene, false);
  return new Promise((resolve, reject) => { host.scene.launch(SCUFFLE_SCENE, { encounter, host: host.scene.key, clock, done: resolve, cancel: () => reject(new Error('Scuffle interrupted before an outcome.')), witnesses } satisfies Open); host.scene.bringToTop(SCUFFLE_SCENE); });
}

export class ScuffleScene extends Phaser.Scene {
  private opening!: Open;
  private board!: TownBoard;
  private projection!: ObliqueProjection;
  /** Draws the UI unzoomed over the world camera, which frames the board on the left page. */
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;
  private zoom = 1;
  private ui!: Phaser.GameObjects.Container;
  private overlay!: Phaser.GameObjects.Container;
  private figures = new Map<string, Phaser.GameObjects.Image>();
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private buttons: { text: Phaser.GameObjects.Text; run(): void }[] = [];
  private focus = 0;
  private cursor = { x: 0, y: 0 };
  private mode: 'move' | 'swing' | 'talk' | 'bribe' | 'item' = 'move';
  private item: Supply = 'bun';
  private tutorial = 0;
  private busy = false;
  private resolved = false;
  private preparing = true;
  private asked = new Set<string>();
  private inviteAbort = new AbortController();
  private feedback = '';
  constructor() { super(SCUFFLE_SCENE); }
  init(open: Open): void { this.opening = open; this.figures = new Map(); this.labels = new Map(); this.focus = 0; this.mode = 'move'; this.tutorial = 0; this.busy = false; this.resolved = false; this.feedback = ''; this.preparing = true; this.asked = new Set(); this.inviteAbort = new AbortController(); }
  preload(): void { preloadTownSprites(this, this.opening.encounter.battle.arena); }
  create(): void {
    const host = this.scene.get(this.opening.host), oldInput = host.input.enabled, oldKeys = host.input.keyboard?.enabled;
    host.input.enabled = false; if (host.input.keyboard) { host.input.keyboard.resetKeys(); host.input.keyboard.enabled = false; }
    this.opening.clock.pause('scuffle');
    const arena = this.opening.encounter.battle.arena;
    // The town's diorama grid from world (0, 0), which TownBoard bakes and places its art on: the art, the grid overlay
    // and the fighters share this one projection.
    this.projection = new ObliqueProjection({ originX: 0, originY: 0, tileW: DIORAMA_TILE_W, tileH: DIORAMA_TILE_H, elevStep: DIORAMA_ELEV_STEP,
      slabDepth: DIORAMA_SLAB_DEPTH, gridWidth: arena.width, gridHeight: arena.height, elevationAt: (x, y) => arena.tiles[y * arena.width + x]?.elev ?? 0 });
    // The world camera frames the board on the left page of the 1280×720 design (a top-left pivot, as util/renderScale
    // sets every camera; set here too for RENDER_SCALE 1). Scrolled in whole device pixels, so no art pixel straddles two.
    const bounds = this.projection.bounds(), frame = frameArena(bounds, ARENA_PAGE, ARENA_FIT), camera = this.cameras.main;
    const zoom = RENDER_SCALE * frame.zoom, snap = (v: number) => Math.round(v * zoom) / zoom, page = ARENA_PAGE;
    this.zoom = frame.zoom;
    camera.setOrigin(0, 0).setZoom(zoom).setViewport(page.x * RENDER_SCALE, page.y * RENDER_SCALE, page.w * RENDER_SCALE, page.h * RENDER_SCALE)
      .setScroll(snap(frame.scrollX), snap(frame.scrollY)).setBackgroundColor(BACKDROP);
    this.board = new TownBoard(this, { zone: arena, projection: this.projection, seed: 8, look: { flag: n => flagsOf(this.registry).has(n) },
      focus: { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 } });
    const dark = this.opening.clock.minute >= 1200 ? .75 : 0;
    this.board.applyLight({ sun: { ...SUN, alpha: dark ? 0 : SUN.alpha }, dark, lampLevel: dark });
    // The UI camera ignores the board (TownBoard keeps what it makes later off it too) and everything world() marks.
    const world = this.children.list.slice();
    this.uiCamera = this.cameras.add(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.uiCamera.ignore(world);
    // Round the page, the scene's own backdrop: the town is still drawn under this scene.
    const backdrop = this.add.graphics().fillStyle(BACKDROP).setDepth(19000)
      .fillRect(0, 0, GAME_WIDTH, page.y).fillRect(0, page.y + page.h, GAME_WIDTH, GAME_HEIGHT - page.y - page.h)
      .fillRect(0, page.y, page.x, page.h).fillRect(page.x + page.w, page.y, GAME_WIDTH - page.x - page.w, page.h);
    this.overlay = this.world(this.add.container().setDepth(10000)); this.ui = this.add.container().setDepth(20000);
    camera.ignore([backdrop, this.ui]);
    // A click on the board picks the tile drawn under it, raised ground included (ObliqueProjection.worldToTile).
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.length || this.busy || pointer.x < camera.x || pointer.y < camera.y || pointer.x >= camera.x + camera.width || pointer.y >= camera.y + camera.height) return;
      const at = camera.getWorldPoint(pointer.x, pointer.y), tile = this.projection.worldToTile(at.x, at.y);
      if (!tile) return;
      this.cursor = tile; this.draw(); this.pick(tile);
    });
    this.cursor = { ...this.opening.encounter.battle.current!.state.position };
    this.feedback = SCUFFLES[this.opening.encounter.battle.id].opening;
    this.draw();
    const key = (e: KeyboardEvent) => {
      if (e.repeat || this.busy) return;
      if (['Tab', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
      if (e.key === 'Tab') { this.focus = (this.focus + (e.shiftKey ? -1 : 1) + this.buttons.length) % this.buttons.length; this.highlight(); }
      else if (e.key === 'Enter') this.buttons[this.focus]?.run();
      else if (e.key.startsWith('Arrow')) { this.cursor.x = Phaser.Math.Clamp(this.cursor.x + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0), 0, arena.width - 1); this.cursor.y = Phaser.Math.Clamp(this.cursor.y + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0), 0, arena.height - 1); this.draw(); }
      else if (e.key === ' ') this.pick(this.cursor);
      else if (e.key.toLowerCase() === 'm') { this.mode = 'move'; this.draw(); }
      else if (e.key.toLowerCase() === 'a') { this.mode = 'swing'; this.draw(); }
      else if (e.key.toLowerCase() === 't') { this.mode = 'talk'; this.draw(); }
      else if (e.key.toLowerCase() === 'r') this.take({ kind: 'ready' });
      else if (e.key.toLowerCase() === 'b') this.take({ kind: 'brace' });
      else if (e.key.toLowerCase() === 'e') this.take({ kind: 'end' });
    };
    this.input.keyboard?.on('keydown', key);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inviteAbort.abort();
      this.input.keyboard?.off('keydown', key); this.opening.clock.resume('scuffle');
      host.input.enabled = oldInput; if (host.input.keyboard) host.input.keyboard.enabled = oldKeys ?? true;
      // An external shutdown is cancellation, never an invented win or loss.
      if (!this.resolved) this.opening.cancel();
    });
  }
  update(_time: number, dt: number): void {
    if (!this.board) return;
    // TownBoard fades what stands between the camera and the player's fighter.
    const player = this.opening.encounter.battle.units.find(u => u.id === 'player'), p = this.projection.tileToWorld(player?.state.position ?? this.cursor);
    this.board.update(dt, { x: p.x, y: p.y + DIORAMA_FOOT_DY }, 0);
  }
  /** Drawn by the world camera only. */
  private world<T extends Phaser.GameObjects.GameObject>(obj: T): T { this.uiCamera.ignore(obj); return obj; }
  private text(x: number, y: number, value: string, size = 18): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, value, { fontFamily: FAMILY_BODY, fontSize: `${size}px`, color: '#f3e8ce', wordWrap: { width: 480 } }); this.ui.add(t); return t;
  }
  private button(x: number, y: number, label: string, run: () => void): void {
    const text = this.text(x, y, label, 17).setPadding(7, 5).setBackgroundColor('#40584a').setInteractive({ useHandCursor: true });
    text.on('pointerdown', () => { if (!this.busy) run(); }); this.buttons.push({ text, run });
  }
  private draw(): void {
    this.ui.removeAll(true); this.overlay.removeAll(true); this.buttons = [];
    const b = this.opening.encounter.battle, current = b.current;
    this.text(40, 24, SCUFFLES[b.id].name, 30).setFontFamily(FAMILY_HEADING);
    this.text(40, 65, `Round ${b.initiative.round} · ${current?.faction === 'enemy' ? 'Tollmen / nuisances' : 'Your side'} · ${current?.name ?? ''}`);
    for (let y = 0; y < b.arena.height; y++) for (let x = 0; x < b.arena.width; x++) {
      const p = { x, y }, top = this.projection.topFace(p);
      const movable = current && current.faction !== 'enemy' && b.movesFor(current).some(t => same(t, p));
      const target = b.units.find(u => isAlive(u) && same(u.state.position, p));
      const attack = current && target && target.faction !== current.faction && b.inReach(current, target);
      this.overlay.add(this.add.rectangle(top.x + top.w / 2, top.y + top.h / 2, top.w - 2, top.h - 2, attack ? 0xd18c65 : 0x83bdba, movable || attack ? .22 : .03)
        .setStrokeStyle(same(p, this.cursor) ? 3 : 1, same(p, this.cursor) ? 0xffe7a3 : 0x587569, .7));
    }
    for (const u of b.units) {
      // Feet a little in front of the tile's centre, as the town stands people (DIORAMA_FOOT_DY); nearer rows draw over.
      const centre = this.projection.tileToWorld(u.state.position), p = { x: centre.x, y: centre.y + DIORAMA_FOOT_DY };
      let img = this.figures.get(u.id);
      if (!img) { img = this.world(this.add.image(p.x, p.y, '__WHITE')); const sprite = new CharacterSprite(this, u.id, this.look(u)); sprite.apply(img); this.figures.set(u.id, img); }
      img.setPosition(p.x, p.y).setDepth(11000 + p.y * 1e-3).setVisible(!u.departed).setAlpha(isAlive(u) ? 1 : .65);
      if (!isAlive(u) && !u.departed) this.pose(u, 'winded', 3);
      else if (isAlive(u)) { const sprite = new CharacterSprite(this, u.id, this.look(u)); sprite.apply(img); }
      let label = this.labels.get(u.id); if (!label) { label = this.world(this.add.text(0, 0, '', { fontFamily: FAMILY_BODY, fontSize: '12px', color: '#fff3da', backgroundColor: '#253c37', resolution: RENDER_SCALE * this.zoom }).setOrigin(.5, 0).setDepth(12000)); this.labels.set(u.id, label); }
      label.setPosition(p.x, p.y + 3).setVisible(!u.departed).setText(`${u.name} ${u.state.hp}/${u.stats.hp}\n${u.tool}${u.state.stance !== 'none' ? ` · ${u.state.stance === 'defensive' ? 'brace' : u.state.stance}` : ''}`);
    }
    this.text(730, 24, this.feedback || b.log.slice(-2).join('\n'), 18);
    if (this.preparing) {
      this.text(730, 140, `Before the scuffle · Tollmen ${pressure(this.registry, this.opening.encounter.zone, this.opening.clock)}/3`, 22);
      this.text(730, 185, 'Borrow a tool. Bring up to five supplies from your Bag. Two willing neighbours can join at Regard 40.', 18);
      ALLIES.forEach((id, i) => {
        if (canInvite(this, id) && !this.asked.has(id) && b.units.filter(u => u.faction !== 'enemy').length < 3) this.button(730, 280 + i * 45, `Ask ${id} to join`, () => {
          this.asked.add(id); this.busy = true; this.feedback = `Asking ${id}…`; this.draw();
          void askAlly(this, this.opening.clock, id, this.opening.encounter.place, this.inviteAbort.signal).then(answer => {
            if (!this.scene.isActive()) return;
            this.feedback = answer.line;
            if (answer.willing) { const p = deploymentTiles(b.arena).find(t => !b.occupied(t)); if (p) { b.units.push(fighter(id, p)); b.initiative.reseed(b.units); } }
            this.busy = false; this.draw();
          }).catch(() => { if (this.scene.isActive()) { this.busy = false; this.feedback = 'No answer just now.'; this.draw(); } });
        });
      });
      if (b.id === 'sc_market_saturday' && b.coins >= 20) this.button(730, 515, 'Pay the shop’s toll · 20 coins', () => { b.outcome = 'paid'; this.preparing = false; this.finish(); });
      this.button(730, 460, 'Ready. Let’s begin.', () => { this.preparing = false; this.feedback = ''; this.draw(); });
      this.text(40, 595, b.id === 'sc_bakery_tutorial' ? TUTORIAL[0] : 'Nobody gets hurt. Winded neighbours sit down; raccoons are shooed. You can always leave from a board edge.', 19).setWordWrapWidth(650);
      this.highlight(); return;
    }
    if (b.outcome) { this.text(730, 130, `${b.outcome === 'win' ? 'A little peace.' : b.outcome === 'talk_down' ? 'Words were enough.' : b.outcome === 'flee' ? 'Another day, perhaps.' : 'Only winded.'}\n${SCUFFLES[b.id].ending}`, 24); this.button(730, 275, 'Continue', () => this.finish()); return; }
    if (!current) return;
    this.text(730, 130, `${current.name} · ${current.state.apRemaining}/${current.stats.ap} AP\nGrit ${current.state.hp}/${current.stats.hp} · Muscle ${current.stats.power} · Nerve ${current.nerve}`, 20);
    this.text(730, 206, `Pan > Broom > Umbrella > Pan\n${this.mode === 'talk' ? 'Adjacent · 2 AP · failed words can be tried again' : 'Move / Swing / Ready / Brace / Item · 1 AP'}`, 16);
    const modes = ['move', 'swing', 'talk', 'bribe'] as const;
    modes.forEach((m, i) => this.button(730 + i % 2 * 195, 265 + Math.floor(i / 2) * 40, `${m === this.mode ? '• ' : ''}${m === 'talk' ? 'Talk Down [T]' : m === 'move' ? 'Move [M]' : m === 'swing' ? 'Swing / Ping [A]' : 'Bribe · 20 coins'}`, () => { this.mode = m; this.draw(); }));
    this.button(730, 350, 'Ready [R]', () => this.take({ kind: 'ready' })); this.button(925, 350, 'Brace [B]', () => this.take({ kind: 'brace' }));
    this.button(730, 390, 'End turn [E]', () => this.take({ kind: 'end' })); this.button(925, 390, 'Run from edge', () => this.take({ kind: 'run' }));
    if (current.id === 'player') b.tools.forEach((tool, i) => this.button(730 + i * 125, 435, tool, () => this.take({ kind: 'tool', tool })));
    [...new Set(b.supplies)].forEach((item, i) => this.button(730 + i % 2 * 220, 478 + Math.floor(i / 2) * 35, item.replaceAll('_', ' '), () => {
      if (item === 'augusta_whistle') this.take({ kind: 'item', item }); else { this.item = item; this.mode = 'item'; this.feedback = item === 'marbles' ? 'Choose an empty adjacent tile.' : 'Choose yourself or an adjacent ally.'; this.draw(); }
    }));
    const selected = b.units.find(u => same(u.state.position, this.cursor) && isAlive(u));
    if (selected?.faction === 'enemy') this.text(40, 495, `${selected.name}: ${b.intent(selected).text}\nTalk Down: ${Math.round(talkOdds(b.setup.heart ?? 1, selected.nerve, b.setup.scrapper, selected.quit) * 100)}%`, 17);
    else this.text(40, 495, b.living().filter(u => u.faction === 'enemy').map(u => `${u.name}: ${b.intent(u).text}`).join('\n'), 17);
    if (b.id === 'sc_bakery_tutorial') {
      this.text(40, 595, TUTORIAL[this.tutorial]!, 18).setWordWrapWidth(660);
      this.button(730, 620, 'Next tip', () => { this.tutorial = Math.min(TUTORIAL.length - 1, this.tutorial + 1); this.draw(); });
    }
    this.text(40, 690, 'Mouse: tiles and buttons · Arrows: tile · Space: act · Tab / Enter: buttons', 14).setWordWrapWidth(1100); this.highlight();
  }
  private highlight(): void { this.focus %= Math.max(1, this.buttons.length); this.buttons.forEach((b, i) => b.text.setBackgroundColor(i === this.focus ? '#86683d' : '#40584a')); }
  private pick(p: TilePos): void {
    if (this.busy || this.preparing) return;
    const b = this.opening.encounter.battle, target = b.units.find(u => same(u.state.position, p) && !u.departed);
    if (this.mode === 'move') this.take({ kind: 'move', to: p });
    else if (this.mode === 'item') this.take({ kind: 'item', item: this.item, to: p, target: target?.id });
    else if (target) this.take({ kind: this.mode, target: target.id });
  }
  private look(u: Fighter): Look {
    if (u.id.startsWith('raccoon')) return { kind: 'cat', fur: 0x8b8983, markings: 0x393b39, bib: 0xc9c8bd, eyes: 0x252b25, collar: 0x8b8983 };
    return u.id === 'player' ? playerLook(this.registry) : residentLook(u.id, u.faction === 'enemy' ? 0xaa735c : 0x708866);
  }
  private pose(u: Fighter, state: 'swing' | 'hit' | 'winded', frame: number): void {
    const key = `scuffle:${u.id}:${state}:${frame}`;
    if (!this.textures.exists(key)) {
      const look = this.look(u);
      const pixels = drawFrame(look, u.faction === 'enemy' ? 'left' : 'right', SCUFFLE_POSES[state][frame]!);
      const texture = this.textures.createCanvas(key, 32, 48)!; const ctx = texture.getContext(), data = ctx.createImageData(32, 48); pixels.blit(data.data, 32, 0, 0, u.faction !== 'enemy'); ctx.putImageData(data, 0, 0); texture.refresh();
    }
    this.figures.get(u.id)?.setTexture(key).setOrigin(.5, 1);
  }
  private take(action: Action): void {
    const b = this.opening.encounter.battle, actor = b.current;
    if (this.busy || this.preparing || !actor || actor.faction === 'enemy' || b.outcome) return;
    const before = b.log.length;
    if (!b.act(action)) { this.feedback = 'That needs a different tile, target, or more AP.'; this.draw(); return; }
    this.feedback = b.log.slice(before).join('\n');
    if (b.id === 'sc_bakery_tutorial') this.tutorial = action.kind === 'tool' ? 1 : action.kind === 'move' ? 2 : action.kind === 'talk' ? 3 : this.tutorial;
    if (action.kind === 'swing') {
      this.busy = true;
      for (let frame = 0; frame < 5; frame++) this.time.delayedCall(frame * 90, () => { this.pose(actor, 'swing', frame); if (frame === 2) { const target = b.units.find(u => u.id === action.target); if (target) { this.pose(target, 'hit', 0); const p = this.projection.tileToWorld(target.state.position); const puff = this.world(this.add.circle(p.x, p.y + DIORAMA_FOOT_DY - 14, 14, 0xeee0bb, .7).setDepth(15000)); this.tweens.add({ targets: puff, scale: 2, alpha: 0, duration: 350, onComplete: () => puff.destroy() }); } } });
      this.time.delayedCall(480, () => { this.busy = false; this.afterAction(); });
    } else this.afterAction();
  }
  private afterAction(): void {
    const b = this.opening.encounter.battle;
    if (!b.outcome && b.current && b.current.state.apRemaining === 0) b.act({ kind: 'end' });
    this.draw(); this.enemyStep();
  }
  private enemyStep(): void {
    const b = this.opening.encounter.battle;
    if (b.outcome || b.current?.faction !== 'enemy') return;
    this.busy = true; const intent = b.intent(); this.feedback = `${b.current.name}: ${intent.text}`; this.draw();
    this.time.delayedCall(650, () => { b.act(intent.action); if (!b.outcome && b.current?.state.apRemaining === 0) b.act({ kind: 'end' }); this.busy = false; this.feedback = b.log.slice(-2).join('\n'); this.draw(); this.enemyStep(); });
  }
  private finish(): void {
    if (this.resolved) return;
    const outcome = this.opening.encounter.battle.outcome; if (!outcome) return;
    this.resolved = true;
    const consequence = settle(this.registry, this.opening.encounter, outcome, this.opening.witnesses);
    this.opening.clock.advanceMinutes(consequence.minutes);
    this.opening.done(outcome); this.scene.stop();

  }
}
