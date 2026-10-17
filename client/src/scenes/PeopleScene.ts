import { openPaper } from "./DawnReportScene";
import { favorBook } from "../friendship/favors";
import { MarkPages } from './MarkPages';
import { marks } from './riddles';
// The People page (GDD §9.11.3 "What the player sees", §18 Journal → People; MVP G-13 client).
//
// A page of the Journal (§16.6: a cloth-bound notebook), opened over ZoneScene with J and closed with J or Esc. The
// clock is held for "journal" while it's open and the zone's input is paused, as the Town Ledger does. The left page
// lists the residents the player has met (a small portrait, name, hearts and Regard tier); the right page shows the
// one chosen: portrait, hearts and tier, birthday when the card has one, the gift likes the player has learned, and
// the ties the player knows (seen together, heard of in a line, or read in the Dawn Report).
import Phaser from 'phaser';
import { PAIR_LABEL_NAMES, regardTier, type PersonaCard, type RomanceStage, type TieSource } from '@monde/shared';
import { FAMILY_BODY, FAMILY_DISPLAY, FAMILY_HEADING, FAMILY_UI, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import type { Clock } from '../sim/clock';
import { livingArrivals } from '@monde/shared';
import { rosterEntry } from '../world/roster';
import { homeName } from '../world/townHomes';
import type { TownState } from '../town/pillars';
import { portraitArtId } from '../dialogue/portraitModel';
import { displayName } from '../sim/residentSim';
import { Portrait } from '../dialogue/portrait';
import { portraitLook } from '../dialogue/portraitModel';
import { knownTiesOf, pairEmote, type KnownTie } from '../friendship/knownTies';
import { metResidents } from '../friendship/state';
import { HeartRowView, emoteTexture } from '../ui/hearts';
import { DIALOGUE_SCENE } from './DialogueScene';
import { FRIENDSHIP_KEY, getFriendship, regardFor, tieMap, townNames } from './friendship';

export const PEOPLE_SCENE = 'People';

export interface PeopleOpen {
  /** The scene underneath: its input is paused while the page is open. */
  host: string;
  clock: Clock;
  tab?: 'People' | 'Marks' | 'Today';
}

/** Open the People page over `host` (no-op if it, the Ledger or the dialogue panel is already up). */
export const openPeople = (host: Phaser.Scene, clock: Clock, tab?: PeopleOpen['tab']): void => {
  // 'TownLedger' is TOWN_LEDGER_SCENE (TownLedgerScene imports this file, so the key is spelled out here).
  if ([PEOPLE_SCENE, 'TownLedger', DIALOGUE_SCENE].some(key => host.scene.isActive(key))) return;
  host.scene.launch(PEOPLE_SCENE, { host: host.scene.key, clock, tab } satisfies PeopleOpen);
};

/** Everyone with a card, the generated residents who have arrived included (G-02, world/roster.ts). */
const CARDS: Pick<ReadonlyMap<string, { card: PersonaCard; index: number }>, 'has' | 'get'> = { has: id => !!rosterEntry(id), get: id => rosterEntry(id) };
/** GDD-GAP: §9.11.3 lists residents the player has met; a newcomer is listed for a week as a new face to go and meet. */
export const NEW_FACE_DAYS = 7;

/** The page's list: new faces first (newest first), then everyone met. */
export function peopleIds(met: readonly string[], town: TownState | undefined, day: number): string[] {
  const arrivals = livingArrivals(town?.people).filter(r => day - r.arrived_day < NEW_FACE_DAYS && !met.includes(r.card.id))
    .sort((a, b) => b.arrived_day - a.arrived_day || a.card.id.localeCompare(b.card.id)).map(r => r.card.id);
  return [...arrivals, ...met.filter(id => CARDS.has(id))];
}
/** The resident's roster colour, as their sprite and dialogue portrait wear it. */
const rosterColour = (index: number): number => Phaser.Display.Color.HSLToColor(((index * 137.508) % 360) / 360, 0.52, 0.56).color;

// Layout (design pixels, 1280×720): a notebook open flat, cloth cover around two paper pages.
const BX = 92, BY = 34, BW = GAME_WIDTH - 184, BH = GAME_HEIGHT - 68;
const SPINE = BX + BW / 2;
const LX = BX + 40, LW = BW / 2 - 70;
const RX = SPINE + 34, RW = BW / 2 - 74;
const LIST_Y = BY + 112, ROW_H = 66, ROWS = 7;
// Cloth, paper, ink and brass (§16.6).
const CLOTH = 0x2c4a44, CLOTH_EDGE = 0x1d332e, CLOTH_STITCH = 0x6f8f7f;
const PAPER = 0xf2e8d0, PAPER_EDGE = 0xe3d4b0;
const INK = 0x2b2219, INK_CSS = '#2b2219', MUTED = '#6f6150', BRASS_CSS = '#8a6a24', BRASS = 0xa67c2e;
const PICKED = 0xe6d6ae;

const TIE_SOURCE_TEXT: Readonly<Record<TieSource, string>> = { seen: 'seen together', heard: 'heard about it', read: 'in the Lantern' };
const ROMANCE_TEXT: Readonly<Record<RomanceStage, string>> = { courting: 'Courting', together: 'Together with', married: 'Married to' };

/** "Close friends with Odile", "Courting Kasimir". */
export const tieText = (t: Pick<KnownTie, 'label' | 'romance' | 'other'>, name: string): string =>
  t.romance ? `${ROMANCE_TEXT[t.romance]} ${name}` : `${PAIR_LABEL_NAMES[t.label]} with ${name}`;

/** GDD-GAP: persona cards have no birthday field yet (§9.11.3 life events); the page shows one if a card gains it. */
const birthdayOf = (card: PersonaCard): string | null => {
  const b = (card as PersonaCard & { birthday?: unknown }).birthday;
  return typeof b === 'number' ? `Day ${b}` : null;
};

let lastPicked: string | null = null;

export class PeopleScene extends Phaser.Scene {
  private open!: PeopleOpen;
  private markPages!: MarkPages;
  private content!: Phaser.GameObjects.Container;
  private portraits: Portrait[] = [];
  private hearts: HeartRowView[] = [];
  private ids: string[] = [];
  private favorsTab = false;
  private favorPage = 0;
  private paperPage = 0;
  private picked = 0;
  private top = 0;
  private openedAt = 0;
  private closed = false;
  private seenKeys = new WeakSet<KeyboardEvent>();

  constructor() { super(PEOPLE_SCENE); }

  init(data: PeopleOpen): void {
    this.open = data;
    this.closed = false;
    this.portraits = [];
    this.hearts = [];
  }

  create(): void {
    this.scene.bringToTop();
    this.pauseWorld(true);
    this.openedAt = performance.now();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x10140f, 0.55).setOrigin(0).setInteractive(); // swallows clicks
    if (this.open.tab) marks(this.registry).tab = this.open.tab;
    this.drawBook();
    this.content = this.add.container(0, 0);
    this.markPages = new MarkPages(this, this.open.clock, this.content, () => this.refresh());
    this.ids = peopleIds(metResidents(getFriendship(this.registry)), this.registry.get('monde.town') as TownState | undefined, this.open.clock.day);
    const keep = lastPicked ? this.ids.indexOf(lastPicked) : -1;
    this.picked = keep >= 0 ? keep : 0;
    this.top = Math.max(0, Math.min(this.picked - ROWS + 1, this.ids.length - ROWS));
    this.refresh();

    const onChange = () => { this.ids = peopleIds(metResidents(getFriendship(this.registry)), this.registry.get('monde.town') as TownState | undefined, this.open.clock.day); this.refresh(); };
    this.registry.events.on(`changedata-${FRIENDSHIP_KEY}`, onChange);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.registry.events.off(`changedata-${FRIENDSHIP_KEY}`, onChange));
    this.input.keyboard!.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.scroll(Math.sign(dy)));

    this.cameras.main.setAlpha(0);
    this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 140 });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.closed || this.seenKeys.has(e)) return;
    this.seenKeys.add(e);
    if (marks(this.registry).tab === 'Marks' && this.markPages.key(e)) return;
    if (e.key === 'Escape') { this.close(); return; }
    // The J that opened the page mustn't close it again.
    if ((e.key === 'j' || e.key === 'J' || e.code === 'KeyJ') && !e.repeat && performance.now() - this.openedAt > 150) { this.close(); return; }
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') this.pick(this.picked + 1);
    else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') this.pick(this.picked - 1);
    else if (e.key === 'PageDown') this.pick(this.picked + ROWS);
    else if (e.key === 'PageUp') this.pick(this.picked - ROWS);
  }

  private pick(i: number): void {
    if (!this.ids.length) return;
    const next = Math.max(0, Math.min(this.ids.length - 1, i));
    if (next === this.picked) return;
    this.picked = next;
    if (next < this.top) this.top = next;
    if (next >= this.top + ROWS) this.top = next - ROWS + 1;
    this.refresh();
  }

  private scroll(step: number): void {
    const top = Math.max(0, Math.min(this.ids.length - ROWS, this.top + step));
    if (top === this.top) return;
    this.top = top;
    this.refresh();
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  /** The notebook: cloth boards with a stitched edge, two pages, a spine and a ribbon. Drawn once. */
  private drawBook(): void {
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.35).fillRoundedRect(BX + 8, BY + 10, BW, BH, 16);
    g.fillStyle(CLOTH, 1).fillRoundedRect(BX - 14, BY - 12, BW + 28, BH + 24, 16);
    g.lineStyle(2, CLOTH_EDGE, 1).strokeRoundedRect(BX - 14, BY - 12, BW + 28, BH + 24, 16);
    g.lineStyle(1, CLOTH_STITCH, 0.7);
    for (let x = BX - 4; x < BX + BW + 4; x += 14) { g.lineBetween(x, BY - 6, x + 7, BY - 6); g.lineBetween(x, BY + BH + 6, x + 7, BY + BH + 6); }
    // Pages, a shade darker toward the spine.
    g.fillGradientStyle(PAPER, PAPER_EDGE, PAPER, PAPER_EDGE, 1).fillRect(BX, BY, BW / 2, BH);
    g.fillGradientStyle(PAPER_EDGE, PAPER, PAPER_EDGE, PAPER, 1).fillRect(SPINE, BY, BW / 2, BH);
    g.fillStyle(INK, 0.12).fillRect(SPINE - 3, BY, 6, BH);
    g.lineStyle(1, INK, 0.25).lineBetween(SPINE, BY, SPINE, BY + BH);
    // A ribbon marker hanging from the top of the right page.
    g.fillStyle(0x9c2f3a, 1).fillRect(SPINE + BW / 2 - 70, BY - 12, 12, 64).fillTriangle(SPINE + BW / 2 - 70, BY + 52, SPINE + BW / 2 - 58, BY + 52, SPINE + BW / 2 - 64, BY + 44);
    this.add.text(LX, BY + 28, 'Journal', { fontFamily: FAMILY_DISPLAY, fontSize: '38px', color: INK_CSS, resolution: RENDER_SCALE });
    (['People', 'Marks', 'Today', 'Favors'] as const).forEach((tab, i) => this.add.text(LX + 120 + i * 100, BY + 74, tab, { fontFamily: FAMILY_UI, fontSize: '17px', color: INK_CSS }).setInteractive({ useHandCursor: true }).on('pointerdown', () => { this.favorsTab = tab === 'Favors'; if (tab !== 'Favors') marks(this.registry).tab = tab; this.refresh(); }));
    this.add.text(LX + 2, BY + 74, 'Pages', { fontFamily: FAMILY_BODY, fontSize: '15px', fontStyle: 'italic', color: MUTED, resolution: RENDER_SCALE });
    g.fillStyle(INK, 1).fillRect(LX, BY + 100, LW, 2).fillRect(LX, BY + 104, LW, 1);
    this.add.text(BX + BW - 30, BY + BH - 30, 'W/S or ↑↓ to choose  ·  J or Esc to close', {
      fontFamily: FAMILY_UI, fontSize: '13px', color: MUTED, resolution: RENDER_SCALE
    }).setOrigin(1, 0.5);
  }

  private text(x: number, y: number, s: string, size: number, opts: { color?: string; family?: string; italic?: boolean; bold?: boolean; wrap?: number; origin?: [number, number] } = {}): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, s, {
      fontFamily: opts.family ?? FAMILY_BODY, fontSize: `${size}px`, color: opts.color ?? INK_CSS,
      fontStyle: [opts.italic ? 'italic' : '', opts.bold ? 'bold' : ''].join(' ').trim() || 'normal',
      resolution: RENDER_SCALE, ...(opts.wrap ? { wordWrap: { width: opts.wrap } } : {})
    }).setOrigin(...(opts.origin ?? [0, 0]));
    this.content.add(t);
    return t;
  }

  private header(x: number, y: number, s: string): void {
    this.text(x, y, s.toUpperCase(), 13, { family: FAMILY_UI, color: BRASS_CSS, bold: true });
  }

  private refresh(): void {
    for (const p of this.portraits) p.destroy();
    for (const h of this.hearts) h.destroy();
    this.portraits = [];
    this.hearts = [];
    this.content.removeAll(true);
    if (this.favorsTab) {
      const all = favorBook(this.registry);
      this.text(LX,LIST_Y,'Favors · open / completed / expired',20);
      all.slice(this.favorPage * 4,this.favorPage * 4 + 4).forEach((f,i) => {
        const y = LIST_Y + 45 + i * 105;
        this.text(LX,y,`${townNames()[f.resident_id] ?? f.resident_id} · ${f.expires_day < this.open.clock.day && ['accepted','proposed'].includes(f.status) ? 'expired' : f.status}`,18);
        this.text(LX,y+25,f.text,15,{ wrap: LW });
        this.text(RX,y,`${f.task.place.replaceAll('_',' ')}
By Day ${f.expires_day} · ${f.task.item ?? f.task.kind}
${f.reward.regard} Regard · ${f.reward.coins} coins`,16,{ wrap: RW });
      });
      if (!all.length) this.text(LX,LIST_Y+60,'No favors yet. Talk to your neighbours.',17);
      this.text(LX,610,'← Earlier',17).setInteractive().on('pointerdown',() => { this.favorPage = Math.max(0,this.favorPage-1); this.refresh(); });
      this.text(RX,610,'Later →',17).setInteractive().on('pointerdown',() => { if ((this.favorPage+1)*4 < all.length) this.favorPage++; this.refresh(); }); return;
    }
    const tab = marks(this.registry).tab;
    if (tab !== 'People') {
      this.markPages.draw(tab);
      if (tab === 'Today') {
        this.text(RX,420,'Papers',24);
        this.text(RX+160,420,'←',22).setInteractive().on('pointerdown',() => { this.paperPage = Math.max(0,this.paperPage-1); this.refresh(); });
        this.text(RX+210,420,'→',22).setInteractive().on('pointerdown',() => { if ((this.paperPage+1)*5 < getFriendship(this.registry).papers.length) this.paperPage++; this.refresh(); });
        [...getFriendship(this.registry).papers].reverse().slice(this.paperPage * 5,this.paperPage * 5 + 5).forEach((paper,i) => this.text(RX,457+i*31,`Day ${paper.day} · ${paper.headline.slice(0,35)}`,15).setInteractive().on('pointerdown',() => openPaper(this,{ paper,clock: this.open.clock,seed: (this.registry.get('monde.press.seed') as number | undefined) ?? (this.registry.get('monde.save.weather') as { seed: number } | undefined)?.seed ?? 0,archive: true })));
      }
      return;
    }
    const g = this.add.graphics();
    this.content.add(g);
    if (!this.ids.length) {
      this.text(LX, LIST_Y + 10, "Nobody yet. Talk to someone (E) and they'll have a page here.", 17, { italic: true, color: MUTED, wrap: LW });
      this.text(RX, BY + 60, 'An empty page.', 17, { italic: true, color: MUTED });
      return;
    }
    this.picked = Math.min(this.picked, this.ids.length - 1);
    lastPicked = this.ids[this.picked] ?? null;
    this.drawList(g);
    this.drawPage(g, this.ids[this.picked]!);
  }

  private drawList(g: Phaser.GameObjects.Graphics): void {
    const shown = this.ids.slice(this.top, this.top + ROWS);
    shown.forEach((id, row) => {
      const i = this.top + row, y = LIST_Y + row * ROW_H;
      const { card, index } = CARDS.get(id)!;
      if (i === this.picked) {
        g.fillStyle(PICKED, 1).fillRoundedRect(LX - 8, y + 2, LW + 16, ROW_H - 4, 8);
        g.lineStyle(1.5, BRASS, 0.9).strokeRoundedRect(LX - 8, y + 2, LW + 16, ROW_H - 4, 8);
      } else if (row > 0) {
        g.fillStyle(INK, 0.12).fillRect(LX, y, LW, 1);
      }
      const p = new Portrait(this, { residentId: portraitArtId(card), look: portraitLook(card, rosterColour(index)), x: LX, y: y + 5, art: true });
      p.root.setScale(0.205);
      p.setExpression('neutral', true);
      this.portraits.push(p);
      const regard = regardFor(this.registry, id);
      const fresh = this.newFace(id);
      this.text(LX + 62, y + 12, displayName(card.name), 20, { family: FAMILY_HEADING });
      this.text(LX + 62, y + 38, fresh ? `New face · off the boat on Day ${fresh.arrived_day}` : regardTier(regard), 13, { family: FAMILY_UI, color: fresh ? BRASS_CSS : MUTED, italic: !!fresh });
      const hearts = new HeartRowView(this, LX + LW - 175, y + ROW_H / 2, 1.5, 1);
      hearts.setRegard(regard);
      this.hearts.push(hearts);
      const hit = this.add.rectangle(LX - 8, y + 2, LW + 16, ROW_H - 4, 0xffffff, 0).setOrigin(0).setInteractive({ useHandCursor: true });
      hit.on('pointerup', () => this.time.delayedCall(0, () => this.pick(i)));
      this.content.add(hit);
    });
    if (this.top > 0) this.text(LX + LW, LIST_Y - 6, '▲ more', 12, { family: FAMILY_UI, color: MUTED, origin: [1, 1] });
    if (this.top + ROWS < this.ids.length) this.text(LX + LW, LIST_Y + ROWS * ROW_H + 4, '▼ more', 12, { family: FAMILY_UI, color: MUTED, origin: [1, 0] });
  }

  private drawPage(g: Phaser.GameObjects.Graphics, id: string): void {
    const { card, index } = CARDS.get(id)!;
    const state = getFriendship(this.registry);
    const bond = state.residents[id];
    const regard = regardFor(this.registry, id);
    // Portrait, with name, trade and hearts beside it.
    const p = new Portrait(this, { residentId: portraitArtId(card), look: portraitLook(card, rosterColour(index)), x: RX, y: BY + 40, art: true });
    p.root.setScale(0.6);
    p.setExpression(regard >= 40 ? 'warm' : regard < 0 ? 'worried' : 'neutral', true);
    this.portraits.push(p);
    const cx = RX + 160;
    this.text(cx, BY + 46, displayName(card.name), 30, { family: FAMILY_HEADING });
    const trade = this.text(cx, BY + 84, card.occupation, 15, { italic: true, color: MUTED, wrap: RW - 160 });
    trade.setMaxLines(2);
    const hy = trade.y + trade.height + 18;
    const hearts = new HeartRowView(this, cx, hy, 2, 1);
    hearts.setRegard(regard);
    this.hearts.push(hearts);
    this.text(cx, hy + 16, regardTier(regard), 17, { family: FAMILY_UI, bold: true });
    const arrived = livingArrivals((this.registry.get('monde.town') as TownState | undefined)?.people).find(r => r.card.id === id);
    const facts = [birthdayOf(card) ? `Birthday: ${birthdayOf(card)}` : null,
      arrived ? `Arrived Day ${arrived.arrived_day} · ${homeName(arrived.card.home)}` : null,
      bond ? `Last spoke ${bond.last_talk_day === this.open.clock.day ? 'today' : `on Day ${bond.last_talk_day}`}` : null].filter(Boolean).join('  ·  ');
    if (facts) this.text(cx, hy + 42, facts, 14, { family: FAMILY_UI, color: MUTED });

    // Gifts they like (§9.11.3): learned from gifts, which are a later task.
    let y = BY + 226;
    g.fillStyle(INK, 0.25).fillRect(RX, y - 12, RW, 1);
    this.header(RX, y, 'Gifts they like');
    const likes = bond?.likes ?? [];
    this.text(RX, y + 22, likes.length ? likes.join(', ') : 'Nothing learned yet. A gift will tell you.', 16, { italic: !likes.length, color: likes.length ? INK_CSS : MUTED, wrap: RW });

    // Known ties.
    y += 76;
    g.fillStyle(INK, 0.25).fillRect(RX, y - 12, RW, 1);
    this.header(RX, y, 'Known ties');
    const pellRegard = state.resident_regard?.[id]?.pell;
    if (pellRegard !== undefined) {
      this.text(RX + 30, y + 26, `Toward Pell: ${regardTier(pellRegard)} · the Wharf sale`, 17);
      y += 30;
    }
    const ties = knownTiesOf(state, id, tieMap(this.registry));
    if (!ties.length) {
      if (pellRegard !== undefined) return;
      this.text(RX, y + 22, 'None you know of yet. Watch who they spend time with.', 16, { italic: true, color: MUTED, wrap: RW });
      return;
    }
    const max = pellRegard === undefined ? 7 : 6;
    ties.slice(0, max).forEach((t, i) => {
      const ry = y + 26 + i * 30;
      const emote = pairEmote(t);
      if (emote) this.content.add(this.add.image(RX + 10, ry + 10, emoteTexture(this, emote.id)).setScale(1.5));
      else g.fillStyle(INK, 0.5).fillCircle(RX + 10, ry + 10, 3);
      const line = this.text(RX + 30, ry, tieText(t, townNames()[t.other] ?? t.other), 17);
      this.text(line.x + line.width + 10, ry + 3, `(${TIE_SOURCE_TEXT[t.how]})`, 13, { family: FAMILY_UI, color: MUTED });
    });
    if (ties.length > max) this.text(RX + 30, y + 26 + max * 30, `and ${ties.length - max} more`, 14, { italic: true, color: MUTED });
  }

  /** A generated resident in their first week whom the player hasn't met (the list's "new face"). */
  private newFace(id: string): { arrived_day: number } | null {
    if (metResidents(getFriendship(this.registry)).includes(id)) return null;
    const r = livingArrivals((this.registry.get('monde.town') as TownState | undefined)?.people).find(a => a.card.id === id);
    return r && this.open.clock.day - r.arrived_day < NEW_FACE_DAYS ? r : null;
  }

  // ── Opening and closing ──────────────────────────────────────────────────

  private pauseWorld(paused: boolean): void {
    const host = this.scene.get(this.open.host);
    if (host?.input) {
      host.input.enabled = !paused;
      const keys = host.input.keyboard;
      if (keys) { keys.enabled = !paused; keys.resetKeys(); }
    }
    if (paused) this.open.clock.pause('journal'); else this.open.clock.resume('journal');
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.tweens.add({ targets: this.cameras.main, alpha: 0, duration: 120, onComplete: () => this.scene.stop() });
  }

  private teardown(): void {
    this.closed = true;
    this.input.keyboard?.removeAllListeners('keydown');
    this.input.removeAllListeners('wheel');
    for (const p of this.portraits) p.destroy();
    for (const h of this.hearts) h.destroy();
    this.portraits = [];
    this.hearts = [];
    this.pauseWorld(false);
  }
}
