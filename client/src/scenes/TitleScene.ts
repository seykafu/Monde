import { accessibility, setAccessibility } from '../accessibility/runtime';
import { TEXT_SIZES, scaledText } from '../accessibility/preferences';
import { loadTextSpeed, saveTextSpeed } from '../mind/prefs';
import { TEXT_SPEEDS } from '../mind/reader';
import { browserStorage } from '../mind/api';
import { chooseTelemetry, telemetryChoice } from '../telemetry/runtime';
import Phaser from 'phaser';
import { FAMILY_BODY, FAMILY_DISPLAY, GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE } from '../util/constants';
import { finishSaving, loadGame, resetGame, saveGame, saveStorage } from '../save/runtime';
import { IndexedDBSaveStorage } from '../save/storage';
import { formatSummary, MANUAL_SLOTS, sortForMenu, type SaveEntry } from '../save/slots';
import { getMind } from '../mind/api';
import { maskInvite, statusDetail, validInvite } from '../mind/connection';
import { getMusic } from '../audio/Music';

import { menuLayout, menuEllipsis, menuTextResolution, type MenuMode } from '../ui/menuLayout';

type Choice = { text: string; value?: string; group?: string; detail?: string; run?: () => void | Promise<void> };
/** Thin shared presentation for title and pause; persistence lives outside Phaser. */
class SaveMenuBase extends Phaser.Scene {
  private choices: Choice[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private content!: Phaser.GameObjects.Container;
  private frame!: Phaser.GameObjects.Graphics;
  private status?: Phaser.GameObjects.Text;
  private heading!: Phaser.GameObjects.Text;
  private buttons: { bg: Phaser.GameObjects.Graphics; box: { x: number; y: number; w: number; h: number } }[] = [];
  private text(x: number, y: number, value: string, size: number, color = '#fff0ce', family = FAMILY_BODY): Phaser.GameObjects.Text {
    return this.add.text(Math.round(x), Math.round(y), value, {
      fontFamily: family, fontSize: `${scaledText(size, accessibility().textSize)}px`, color,
      resolution: menuTextResolution(RENDER_SCALE, window.devicePixelRatio)
    });
  }
  private fit(label: Phaser.GameObjects.Text, width: number): void {
    const original = label.text;
    label.setText(original.split('\n').map(line => menuEllipsis(line, width, value => {
      label.setText(value);
      return label.width;
    })).join('\n'));
  }
  preload(): void {
    if (!this.pausedGame && !this.textures.exists('menu:harbour')) {
      this.load.image('menu:harbour', `${import.meta.env.BASE_URL}assets/backdrops/bg_harbor_steps_dusk.jpg`);
    }
  }
  private focus = 0;
  private busy = false;
  private message!: Phaser.GameObjects.Text;
  private back: () => void = () => undefined;
  /** Settings' invite-code field (a DOM input over the canvas), while it's open. */
  private inviteInput: { input: HTMLInputElement; place: () => void } | null = null;
  protected pausedGame = false;
  constructor(key: string) { super(key); }
  create(): void {
    this.busy = false;
    // The title plays the town's song (docs/AUDIO.md); the pause menu keeps whatever the town was playing.
    if (!this.pausedGame) getMusic(this).play('main_theme');
    this.cameras.main.setZoom(RENDER_SCALE).setOrigin(0, 0);
    this.cameras.main.roundPixels = true;
    if (this.pausedGame) {
      this.add.rectangle(640, 360, 1280, 720, 0x101c18, 0.72);
    } else {
      this.add.rectangle(640, 360, 1280, 720, 0x1f2a22);
      if (this.textures.exists('menu:harbour')) {
        const art = this.add.image(640, 360, 'menu:harbour');
        art.setScale(Math.max(GAME_WIDTH / art.width, GAME_HEIGHT / art.height));
      }
      const shade = this.add.graphics();
      for (let x = 0; x < GAME_WIDTH; x += 4) {
        shade.fillStyle(0x101c18, 0.88 * (1 - x / GAME_WIDTH) ** 2 + 0.12).fillRect(x, 0, 4, GAME_HEIGHT);
      }
    }
    this.heading = this.text(84, 42, '', 42, '#ffe3a0', FAMILY_DISPLAY);
    this.frame = this.add.graphics();
    this.content = this.add.container(0, 0);
    this.message = this.text(84, 612, '', 15, '#fff0ce');
    this.message.setWordWrapWidth(1112);
    const footer = this.add.graphics();
    footer.fillStyle(0x1f2a22, 0.95).fillRoundedRect(64, 604, 1152, 104, 8);
    this.message.setDepth(2);
    // Whether residents are live (Haiku) or speaking written lines, always in view on the title (§9.14).
    if (!this.pausedGame) {
      const status = this.text(1196, 40, '', 14, '#fff0ce').setOrigin(1, 0).setWordWrapWidth(430).setAlign('right');
      this.status = status;
      const refresh = () => {
        const s = getMind().status;
        status.setText(`${s === 'online' ? '● Live residents' : s === 'connecting' ? '◌ Joining the town…' : s === 'offline' ? '○ Offline by choice: written lines' : '○ Offline: written lines'}${s === 'no_invite' ? '\nAdd an invite code in Settings' : ''}`)
          .setColor(s === 'online' ? '#bde0bf' : '#f2d997');
      };
      refresh();
      const timer = this.time.addEvent({ delay: 1000, loop: true, callback: refresh });
      this.events.once('shutdown', () => timer.remove());
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || this.busy || this.inviteInput) return;
      if (event.key === 'Escape') this.back();
      else if (event.key === 'Enter') this.activate(this.focus);
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        for (let i = 0; i < this.choices.length; i++) {
          this.focus = (this.focus + step + this.choices.length) % this.choices.length;
          if (this.choices[this.focus]?.run) break;
        }
        this.highlight();
      }
    };
    this.input.keyboard?.on('keydown', onKey);
    this.events.once('shutdown', () => { this.input.keyboard?.off('keydown', onKey); this.closeInvite(); });
    void this.home().catch(error => this.error(error));
  }
  private error(error: unknown): void { this.message.setText(`Could not complete that: ${error instanceof Error ? error.message : String(error)}`); }
  private activate(index: number): void {
    const action = this.choices[index]?.run;
    if (!action || this.busy) return;
    this.busy = true;
    void Promise.resolve().then(action).catch(error => this.error(error)).finally(() => { this.busy = false; });
  }
  private highlight(): void {
    this.labels.forEach((label, i) => {
      const enabled = !!this.choices[i]?.run, selected = enabled && i === this.focus;
      label.setColor(!enabled ? '#9b9f90' : selected ? '#ffe3a0' : '#fff0ce');
      const { bg, box: b } = this.buttons[i]!;
      bg.clear().fillStyle(selected ? 0x3a4d40 : 0x28372d, 1).fillRoundedRect(b.x, b.y, b.w, b.h, 7);
      bg.lineStyle(selected ? 2 : 1, 0xe4c77f, selected ? 1 : enabled ? 0.4 : 0.15).strokeRoundedRect(b.x, b.y, b.w, b.h, 7);
      if (selected) bg.fillStyle(0xe4c77f).fillTriangle(b.x + 10, b.y + 14, b.x + 16, b.y + 20, b.x + 10, b.y + 26);
    });
  }
  private show(choices: Choice[], back: () => void, mode: MenuMode = 'list', title = 'A quiet moment'): void {
    this.content.removeAll(true);
    this.buttons = [];
    this.choices = choices; this.focus = Math.max(0, choices.findIndex(c => c.run)); this.back = back;
    this.heading.setText(title).setFontSize(scaledText(mode === 'home' ? 96 : 42, accessibility().textSize));
    this.status?.setFontSize(scaledText(14, accessibility().textSize));
    this.message.setFontSize(scaledText(15, accessibility().textSize));
    const layout = menuLayout(choices, accessibility().textSize, mode);
    const { x, y, width, height } = layout;
    this.frame.clear().fillStyle(0x1f2a22, 0.97).fillRoundedRect(x, y, width, height, 12);
    this.frame.lineStyle(2, 0xe4c77f, 0.8).strokeRoundedRect(x, y, width, height, 12);
    this.frame.lineStyle(1, 0xe4c77f, 0.25).strokeRoundedRect(x + 6, y + 6, width - 12, height - 12, 8);
    // A stitched cloth edge and a ruled gutter echo the Journal and Lantern's printed pages.
    for (let sy = y + 18; sy < y + height - 14; sy += 12) {
      this.frame.fillStyle(0xe4c77f, 0.2).fillRect(x + 10, sy, 1, 5);
    }
    if (mode === 'settings') this.frame.lineStyle(1, 0xe4c77f, 0.25).lineBetween(640, y + 20, 640, y + height - 20);
    this.labels = choices.map((c, i) => {
      const b = layout.rows[i]!;
      if (b.heading) this.content.add(this.text(b.x, b.y - 29, c.group!.toUpperCase(), 14, '#e4c77f'));
      const bg = this.add.graphics();
      this.content.add(bg);
      this.buttons.push({ bg, box: b });
      const label = this.text(b.x + 26, b.y + 9, c.text, 18);
      this.content.add(label);
      this.fit(label, b.w - 52);
      if (c.value !== undefined) {
        const value = this.text(0, b.y + 10, c.value, 16, '#ffe3a0');
        this.fit(value, 170);
        const pillW = Math.ceil(value.width) + 24;
        const pillX = b.x + b.w - pillW - 10;
        this.content.add(this.add.graphics().fillStyle(0x15251e).fillRoundedRect(pillX, b.y + 5, pillW, b.h - 10, 6));
        this.fit(label, pillX - b.x - 38);
        value.setPosition(pillX + 12, b.y + 10);
        this.content.add(value);
      }
      if (c.detail) {
        const detail = this.text(b.x + 26, b.y + layout.font + 13, c.detail, 14, '#cfc4a6');
        this.fit(detail, b.w - 52);
        this.content.add(detail);
      }
      const hit = this.add.rectangle(b.x, b.y, b.w, b.h, 0, 0).setOrigin(0);
      this.content.add(hit);
      if (c.run) hit.setInteractive({ useHandCursor: true }).on('pointerover', () => { this.focus = i; this.highlight(); }).on('pointerdown', () => this.activate(i));
      return label;
    });
    this.highlight();
  }
  private saveDescription(entry: SaveEntry): string {
    const s = entry.save.summary;
    const time = `${Math.floor(s.time / 60) % 24}:${String(Math.floor(s.time % 60)).padStart(2, '0')}`;
    return `Day ${s.day} · ${entry.save.clock.season} · ${s.zone.replace(/_interior$/, '').replaceAll('_', ' ')} · ${time}\nSaved ${new Date(entry.save.saved_at).toLocaleString()}`;
  }
  private resume(): void { this.scene.resume('Zone'); this.scene.stop(); }
  private async home(): Promise<void> {
    await finishSaving();
    const entries = sortForMenu(await saveStorage.list());
    if (!this.sys.isActive()) return;
    this.message.setText(saveStorage instanceof IndexedDBSaveStorage && saveStorage.temporary ? 'Temporary saves only — storage is unavailable in this browser session.' : '↑ ↓ to choose · Enter to select · Esc to go back');
    if (this.pausedGame) {
      this.show([
        ...MANUAL_SLOTS.map((slot, i) => ({ text: `Save to slot ${i + 1}`, detail: entries.find(e => e.slot === slot) ? this.saveDescription(entries.find(e => e.slot === slot)!) : 'Empty slot', run: async () => {
          await saveGame(slot, 'manual', `Slot ${i + 1}`);
          await this.home();
          this.message.setText(saveStorage instanceof IndexedDBSaveStorage && saveStorage.temporary ? 'Saved (temporary — this browser session only)' : 'Saved');
        } })),
        { text: 'Load', run: async () => this.loadList(sortForMenu(await saveStorage.list())) },
        { text: 'Settings', run: () => this.settings() },
        { text: 'Resume', run: () => this.resume() },
        { text: 'Quit to title', run: () => this.confirm('Quit? Unsaved progress will be lost.', () => { this.scene.stop('Zone'); this.scene.start('Title'); }) }
      ], () => this.resume(), 'pause', 'A quiet moment');
    } else {
      this.show([
        { text: 'Continue', run: entries[0] ? () => loadGame(this, entries[0]!.save, entries[0]!.slot) : undefined },
        // Q-06: the one-time sharing question comes before the first New Game (and on a first visit to Settings).
        { text: 'New Game', run: () => (telemetryChoice() === null ? this.askSharing(() => this.newGame()) : this.newGame()) },
        { text: 'Load', run: async () => this.loadList(sortForMenu(await saveStorage.list())) },
        { text: 'Settings', run: () => this.settings() }
      ], () => undefined, 'home', 'Monde');
    }
  }
  /**
   * Settings: the town's mind (GDD §9.14). Online residents speak for themselves; without an invite code (or a
   * reachable server) they speak written lines. The desktop app passes `--invite=`; here it can be typed instead.
   */
  /** Q-06: off unless the player says yes; Esc keeps it off. Asked once per install. */
  private askSharing(then: () => void): void {
    this.message.setText('Share play events and optional surveys? They carry a random ID for this install, never your name, invite code or dialogue. Only the optional survey note sends typed text. Nothing is sent in Offline mode. Change this in Settings anytime.');
    this.show([{ text: 'Keep sharing off', run: () => { chooseTelemetry(false); then(); } },
      { text: 'Yes, help improve Monde', run: () => { chooseTelemetry(true); then(); } }], () => { chooseTelemetry(false); then(); }, 'list', 'Make yourself at home');
  }
  private settings(): void {
    if (telemetryChoice() === null) { this.askSharing(() => this.settings()); return; }
    const mind = getMind();
    this.message.setText(statusDetail(mind.status));
    const retry = mind.status === 'unreachable' || mind.status === 'connecting';
    const prefs = accessibility();
    const toggle = (patch: Parameters<typeof setAccessibility>[0]) => { const focus = this.focus; setAccessibility(patch); this.settings(); this.focus = focus; this.highlight(); };
    const speed = loadTextSpeed(browserStorage());
    this.show([
      { text: 'Text size', group: 'Text & reading', value: `${prefs.textSize}`, run: () => toggle({ textSize: TEXT_SIZES[(TEXT_SIZES.indexOf(prefs.textSize) + 1) % TEXT_SIZES.length]! }) },
      { text: 'Typewriter speed', group: 'Text & reading', value: `${speed}`, run: () => { const focus = this.focus; saveTextSpeed(browserStorage(), TEXT_SPEEDS[(TEXT_SPEEDS.indexOf(speed) + 1) % TEXT_SPEEDS.length]!); this.settings(); this.focus = focus; this.highlight(); } },
      { text: 'Colorblind emotes', group: 'Accessibility', value: `${prefs.colorblind ? 'On' : 'Off'}`, run: () => toggle({ colorblind: !prefs.colorblind }) },
      { text: 'Reduced motion', group: 'Accessibility', value: `${prefs.motion === 'system' ? 'Follow OS' : prefs.motion === 'on' ? 'On' : 'Off'}`, run: () => toggle({ motion: prefs.motion === 'system' ? 'on' : prefs.motion === 'on' ? 'off' : 'system' }) },
      { text: 'Choices only', group: 'Accessibility', value: `${prefs.choicesOnly ? 'On' : 'Off'}`, run: () => toggle({ choicesOnly: !prefs.choicesOnly }) },
      { text: 'Offline', group: 'Connection & sharing', value: `${prefs.offline ? 'On' : 'Off'}`, run: () => { mind.setOffline(!prefs.offline); toggle({ offline: !prefs.offline }); } },
      { text: 'Play events & surveys', group: 'Connection & sharing', value: `${telemetryChoice() === 'yes' ? 'On' : 'Off'}`, run: () => { chooseTelemetry(telemetryChoice() !== 'yes'); this.settings(); } },
      { text: 'Invite code', group: 'Connection & sharing', value: `${maskInvite(mind.invite)}`, run: () => this.askInvite() },
      ...(mind.invite ? [{ text: 'Clear invite code', group: 'Connection & sharing', run: async () => { await mind.setInvite(null); this.settings(); } }] : []),
      ...(retry ? [{ text: 'Try to reconnect', group: 'Connection & sharing', run: async () => { this.message.setText('Trying the town…'); await mind.reconnect(); this.settings(); } }] : []),
      { text: 'Back', run: () => this.home() }
    ], () => { void this.home().catch(error => this.error(error)); }, 'settings', 'Settings');
  }

  private askInvite(): void {
    this.closeInvite();
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 64;
    input.placeholder = 'Invite code';
    input.setAttribute('aria-label', 'Invite code');
    input.autocomplete = 'off';
    input.spellcheck = false;
    Object.assign(input.style, {
      position: 'fixed', zIndex: '10', boxSizing: 'border-box', margin: '0', padding: '0 0.6em', outline: 'none',
      background: '#1f2a22', color: '#fff0ce', border: '2px solid #e4c77f', borderRadius: '8px', fontFamily: 'Georgia, serif'
    } satisfies Partial<CSSStyleDeclaration>);
    const place = () => {
      const rect = this.game.canvas.getBoundingClientRect();
      const s = rect.width / GAME_WIDTH;
      Object.assign(input.style, {
        left: `${rect.left + 70 * s}px`, top: `${rect.top + (GAME_HEIGHT - 176) * s}px`, width: `${380 * s}px`, height: `${40 * s}px`, fontSize: `${scaledText(18, accessibility().textSize) * s}px`
      });
    };
    place();
    window.addEventListener('resize', place);
    this.inviteInput = { input, place };
    this.message.setText('Type the invite code, then Enter · Esc to cancel');
    // Keys typed here are the input's: the menu's own keys (Enter, Esc, arrows) must not fire underneath.
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.closeInvite(); this.settings(); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const code = input.value.trim();
      if (!validInvite(code)) { this.message.setText('Invite codes are letters, numbers, - and _ (up to 64).'); return; }
      this.closeInvite();
      this.message.setText('Joining the town…');
      void getMind().setInvite(code).then(status => {
        if (!this.sys.isActive()) return;
        this.settings();
        this.message.setText(status === 'online' ? 'Joined. Residents will speak for themselves.'
          : status === 'no_invite' ? "That invite code wasn't accepted. Residents will speak written lines." : statusDetail(status));
      });
    });
    document.body.appendChild(input);
    input.focus();
  }

  private closeInvite(): void {
    if (!this.inviteInput) return;
    window.removeEventListener('resize', this.inviteInput.place);
    this.inviteInput.input.remove();
    this.inviteInput = null;
  }

  /**
   * New Game: straight to the ferry slip at 09:50 (scenes/story/attach.ts), where S01a plays and Pell hands over the
   * Fellowship application at its {charcreate} cue (GDD §11.1).
   */
  private newGame(): void { resetGame(this); this.scene.start('Zone'); }
  private confirm(text: string, yes: () => void | Promise<void>, no: () => void = () => { void this.home().catch(error => this.error(error)); }): void {
    this.message.setText(text);
    this.show([{ text: 'Cancel', run: no }, { text: 'Confirm', run: yes }], no, 'list', 'One more thing');
  }
  private loadList(entries: SaveEntry[], page = 0): void {
    // Pagination keeps an unbounded set of named checkpoints keyboard- and mouse-accessible.
    const size = 3;
    const rows = entries.slice(page * size, (page + 1) * size);
    this.message.setText(entries.length ? 'Choose a save to load or delete.' : 'No saves yet.');
    this.show([
      ...rows.map(entry => ({ text: entry.save.label, detail: this.saveDescription(entry), run: () => this.detail(entry, entries, page) })),
      ...(page > 0 ? [{ text: 'Previous page', run: () => this.loadList(entries, page - 1) }] : []),
      ...((page + 1) * size < entries.length ? [{ text: 'Next page', run: () => this.loadList(entries, page + 1) }] : []),
      { text: 'Back', run: () => this.home() }
    ], () => { void this.home().catch(error => this.error(error)); }, 'list', 'Saved days');
  }
  private detail(entry: SaveEntry, entries: SaveEntry[], page: number): void {
    const back = () => this.loadList(entries, page);
    this.message.setText(formatSummary(entry.save));
    this.show([
      { text: `Load ${entry.save.label}`, run: () => loadGame(this, entry.save, entry.slot) },
      { text: 'Delete', run: () => this.confirm(`Delete ${entry.save.label}? This cannot be undone.`, async () => {
        await saveStorage.delete(entry.slot); this.loadList(sortForMenu(await saveStorage.list()));
      }, back) },
      { text: 'Back', run: back }
    ], back, 'list', 'Saved day');
  }
}
export class TitleScene extends SaveMenuBase { constructor() { super('Title'); } }
export class SaveMenuScene extends SaveMenuBase { constructor() { super('SaveMenu'); this.pausedGame = true; } }
