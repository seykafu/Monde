import { accessibility, setAccessibility } from '../accessibility/runtime';
import { TEXT_SIZES } from '../accessibility/preferences';
import { loadTextSpeed, saveTextSpeed } from '../mind/prefs';
import { TEXT_SPEEDS } from '../mind/reader';
import { browserStorage } from '../mind/api';
import { chooseTelemetry, telemetryChoice } from '../telemetry/runtime';
import Phaser from 'phaser';
import { FAMILY_BODY, GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE } from '../util/constants';
import { finishSaving, loadGame, resetGame, saveGame, saveStorage } from '../save/runtime';
import { IndexedDBSaveStorage } from '../save/storage';
import { formatSummary, MANUAL_SLOTS, sortForMenu, type SaveEntry } from '../save/slots';
import { getMind } from '../mind/api';
import { maskInvite, statusDetail, validInvite } from '../mind/connection';
import { getMusic } from '../audio/Music';

type Choice = { text: string; run?: () => void | Promise<void> };
/** Thin shared presentation for title and pause; persistence lives outside Phaser. */
class SaveMenuBase extends Phaser.Scene {
  private choices: Choice[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
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
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x29392f);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH - 80, GAME_HEIGHT - 50, 0xf2e4c7);
    this.add.text(70, 48, this.pausedGame ? 'A quiet moment' : 'Monde', { fontFamily: FAMILY_BODY, fontSize: '38px', color: '#394a3b' });
    this.message = this.add.text(70, GAME_HEIGHT - 72, '', { fontFamily: FAMILY_BODY, fontSize: '15px', color: '#705740', wordWrap: { width: GAME_WIDTH - 140 } });
    // Whether residents are live (Haiku) or speaking written lines, always in view on the title (§9.14).
    if (!this.pausedGame) {
      const status = this.add.text(GAME_WIDTH - 70, 58, '', { fontFamily: FAMILY_BODY, fontSize: '14px', color: '#705740', align: 'right', wordWrap: { width: 360 } }).setOrigin(1, 0);
      const refresh = () => {
        const s = getMind().status;
        status.setText(`${s === 'online' ? '● Live residents' : s === 'connecting' ? '◌ Joining the town…' : s === 'offline' ? '○ Offline by choice: written lines' : '○ Offline: written lines'}${s === 'no_invite' ? '\nAdd an invite code in Settings' : ''}`)
          .setColor(s === 'online' ? '#3f6b46' : '#92542e');
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
    this.labels.forEach((label, i) => label.setColor(!this.choices[i]?.run ? '#aa9d87' : i === this.focus ? '#92542e' : '#394a3b').setText(`${i === this.focus ? '› ' : '  '}${this.choices[i]!.text}`));
  }
  private show(choices: Choice[], back: () => void): void {
    this.labels.forEach(l => l.destroy());
    this.choices = choices; this.focus = Math.max(0, choices.findIndex(c => c.run)); this.back = back;
    const gap = Math.min(43, (GAME_HEIGHT - 220) / Math.max(1, choices.length));
    this.labels = choices.map((c, i) => {
      const label = this.add.text(70, 112 + i * gap, c.text, { fontFamily: FAMILY_BODY, fontSize: choices.length > 7 ? '16px' : '22px', color: '#394a3b' });
      if (c.run) label.setInteractive({ useHandCursor: true }).on('pointerover', () => { this.focus = i; this.highlight(); }).on('pointerdown', () => this.activate(i));
      return label;
    });
    this.highlight();
  }
  private resume(): void { this.scene.resume('Zone'); this.scene.stop(); }
  private async home(): Promise<void> {
    await finishSaving();
    const entries = sortForMenu(await saveStorage.list());
    if (!this.sys.isActive()) return;
    this.message.setText(saveStorage instanceof IndexedDBSaveStorage && saveStorage.temporary ? 'Temporary saves only — storage is unavailable in this browser session.' : '↑ ↓ to choose · Enter to select · Esc to go back');
    if (this.pausedGame) {
      this.show([
        ...MANUAL_SLOTS.map((slot, i) => ({ text: `Save to slot ${i + 1}`, run: async () => {
          await saveGame(slot, 'manual', `Slot ${i + 1}`);
          this.message.setText(saveStorage instanceof IndexedDBSaveStorage && saveStorage.temporary ? 'Saved (temporary — this browser session only)' : 'Saved');
        } })),
        { text: 'Load', run: async () => this.loadList(sortForMenu(await saveStorage.list())) },
        { text: 'Settings', run: () => this.settings() },
        { text: 'Resume', run: () => this.resume() },
        { text: 'Quit to title', run: () => this.confirm('Quit? Unsaved progress will be lost.', () => { this.scene.stop('Zone'); this.scene.start('Title'); }) }
      ], () => this.resume());
    } else {
      this.show([
        { text: 'Continue', run: entries[0] ? () => loadGame(this, entries[0]!.save, entries[0]!.slot) : undefined },
        // Q-06: the one-time sharing question comes before the first New Game (and on a first visit to Settings).
        { text: 'New Game', run: () => (telemetryChoice() === null ? this.askSharing(() => this.newGame()) : this.newGame()) },
        { text: 'Load', run: async () => this.loadList(sortForMenu(await saveStorage.list())) },
        { text: 'Settings', run: () => this.settings() }
      ], () => undefined);
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
      { text: 'Yes, help improve Monde', run: () => { chooseTelemetry(true); then(); } }], () => { chooseTelemetry(false); then(); });
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
      { text: `Text size: ${prefs.textSize}`, run: () => toggle({ textSize: TEXT_SIZES[(TEXT_SIZES.indexOf(prefs.textSize) + 1) % TEXT_SIZES.length]! }) },
      { text: `Typewriter speed: ${speed}`, run: () => { const focus = this.focus; saveTextSpeed(browserStorage(), TEXT_SPEEDS[(TEXT_SPEEDS.indexOf(speed) + 1) % TEXT_SPEEDS.length]!); this.settings(); this.focus = focus; this.highlight(); } },
      { text: `Colorblind emotes: ${prefs.colorblind ? 'On' : 'Off'}`, run: () => toggle({ colorblind: !prefs.colorblind }) },
      { text: `Reduced motion: ${prefs.motion === 'system' ? 'Follow OS' : prefs.motion === 'on' ? 'On' : 'Off'}`, run: () => toggle({ motion: prefs.motion === 'system' ? 'on' : prefs.motion === 'on' ? 'off' : 'system' }) },
      { text: `Choices only: ${prefs.choicesOnly ? 'On' : 'Off'}`, run: () => toggle({ choicesOnly: !prefs.choicesOnly }) },
      { text: `Offline: ${prefs.offline ? 'On' : 'Off'}`, run: () => { mind.setOffline(!prefs.offline); toggle({ offline: !prefs.offline }); } },
      { text: `Share play events and surveys: ${telemetryChoice() === 'yes' ? 'On' : 'Off'}`, run: () => { chooseTelemetry(telemetryChoice() !== 'yes'); this.settings(); } },
      { text: `Invite code: ${maskInvite(mind.invite)}`, run: () => this.askInvite() },
      ...(mind.invite ? [{ text: 'Clear invite code', run: async () => { await mind.setInvite(null); this.settings(); } }] : []),
      ...(retry ? [{ text: 'Try to reconnect', run: async () => { this.message.setText('Trying the town…'); await mind.reconnect(); this.settings(); } }] : []),
      { text: 'Back', run: () => this.home() }
    ], () => { void this.home().catch(error => this.error(error)); });
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
      background: '#fff8e6', color: '#394a3b', border: '2px solid #92542e', borderRadius: '8px', fontFamily: 'Georgia, serif'
    } satisfies Partial<CSSStyleDeclaration>);
    const place = () => {
      const rect = this.game.canvas.getBoundingClientRect();
      const s = rect.width / GAME_WIDTH;
      Object.assign(input.style, {
        left: `${rect.left + 70 * s}px`, top: `${rect.top + (GAME_HEIGHT - 130) * s}px`, width: `${380 * s}px`, height: `${40 * s}px`, fontSize: `${18 * s}px`
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
    this.show([{ text: 'Cancel', run: no }, { text: 'Confirm', run: yes }], no);
  }
  private loadList(entries: SaveEntry[], page = 0): void {
    // Pagination keeps an unbounded set of named checkpoints keyboard- and mouse-accessible.
    const size = 6;
    const rows = entries.slice(page * size, (page + 1) * size);
    this.message.setText(entries.length ? 'Choose a save to load or delete.' : 'No saves yet.');
    this.show([
      ...rows.map(entry => ({ text: `${entry.save.label} · ${formatSummary(entry.save)}`, run: () => this.detail(entry, entries, page) })),
      ...(page > 0 ? [{ text: 'Previous page', run: () => this.loadList(entries, page - 1) }] : []),
      ...((page + 1) * size < entries.length ? [{ text: 'Next page', run: () => this.loadList(entries, page + 1) }] : []),
      { text: 'Back', run: () => this.home() }
    ], () => { void this.home().catch(error => this.error(error)); });
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
    ], back);
  }
}
export class TitleScene extends SaveMenuBase { constructor() { super('Title'); } }
export class SaveMenuScene extends SaveMenuBase { constructor() { super('SaveMenu'); this.pausedGame = true; } }
