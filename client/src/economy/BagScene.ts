import Phaser from 'phaser';
import { BAG_SLOTS, type Item } from '@monde/shared';
import type { Clock } from '../sim/clock';
import { FAMILY_BODY, GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE } from '../util/constants';
import { items, itemById } from './content';
import { BAG_KEY, COINS_KEY, bagOf, coinsOf, consume } from './runtime';
import { addItem, removeItem, moveItem } from './inventory';
import { recordSale, stockLeft } from '../projects/runtime';
interface BagOpen { host: string; clock: Clock; gift?: (slot: number, item: Item) => void; share?: (slot: number, item: Item) => void; shop?: boolean }
export function openBag(host: Phaser.Scene, clock: Clock, options: Pick<BagOpen, 'gift' | 'share' | 'shop'> = {}): void {
  if (!host.scene.get('Bag')) host.scene.add('Bag', BagScene, false);
  if (!host.scene.isActive('Bag')) host.scene.launch('Bag', { host: host.scene.key, clock, ...options });
}
export class BagScene extends Phaser.Scene {
  private dataIn!: BagOpen;
  private page!: Phaser.GameObjects.Container;
  private selected = 0;
  private moving: number | null = null;
  constructor() { super('Bag'); }
  init(data: BagOpen): void { this.dataIn = data; this.selected = 0; this.moving = null; }
  create(): void {
    this.dataIn.clock.pause('bag');
    const host = this.scene.get(this.dataIn.host);
    if (host.input.keyboard) { host.input.keyboard.resetKeys(); host.input.keyboard.enabled = false; }
    host.input.enabled = false;
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x101810, 0.8).setOrigin(0).setInteractive();
    this.page = this.add.container(); this.draw();
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.toLowerCase() === 'i') this.scene.stop();
      else if (e.key.startsWith('Arrow')) { const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 6, ArrowUp: -6 }[e.key] ?? 0; const n = this.cells(); this.selected = (this.selected + d + n) % n; this.draw(); }
      else if (e.key === 'Enter') this.use();
    });
    this.events.once('shutdown', () => { host.input.enabled = true; if (host.input.keyboard) { host.input.keyboard.enabled = true; host.input.keyboard.resetKeys(); } this.dataIn.clock.resume('bag'); });
  }
  /** The grid's cells: the Bag's slots, or the store's whole stock. */
  private cells(): number { return this.dataIn.shop ? items.length : BAG_SLOTS; }
  private text(x: number, y: number, text: string, click?: () => void, width = 900): void {
    const t = this.add.text(x, y, text, { fontFamily: FAMILY_BODY, fontSize: '18px', color: '#fff0ce', resolution: RENDER_SCALE, wordWrap: { width }, padding: { x: 6, y: 5 } });
    if (click) t.setInteractive({ useHandCursor: true }).on('pointerup', click).on('pointerover', () => t.setColor('#e4c77f')).on('pointerout', () => t.setColor('#fff0ce'));
    this.page.add(t);
  }
  private draw(): void {
    this.page.removeAll(true);
    this.text(130, 40, `${this.dataIn.gift ? 'Choose a gift' : this.dataIn.shop ? 'The general store' : 'Your bag'}  ·  ${coinsOf(this.registry)} coins`);
    this.text(1000, 40, 'Close ×', () => this.scene.stop());
    const bag = bagOf(this.registry);
    // The shop's fifth row (more than the Bag's 24 slots) pushes the details down a little.
    const cells = this.cells(), extra = cells > BAG_SLOTS, rowH = extra ? 78 : 87, boxH = extra ? 72 : 78, detailY = extra ? 500 : 462;
    const tip = this.add.text(160, detailY - 22, '', { fontFamily: FAMILY_BODY, fontSize: '16px', color: '#fff0ce', backgroundColor: '#1f2a22', padding: { x: 10, y: 8 }, wordWrap: { width: 900 } }).setVisible(false).setDepth(50);
    this.page.add(tip);
    // The shop lists every item the store sells (more than the Bag's 24 slots).
    Array.from({ length: cells }, (_, i) => bag.slots[i] ?? null).forEach((s, i) => {
      const x = 130 + i % 6 * 170, y = 100 + Math.floor(i / 6) * rowH;
      const bg = this.add.rectangle(x, y, 162, boxH, i === this.selected ? 0x526b4d : 0x28372d).setOrigin(0).setStrokeStyle(1, 0xe4c77f).setInteractive();
      bg.on('pointerup', () => { if (this.moving !== null) { this.registry.set(BAG_KEY, moveItem(bagOf(this.registry), this.moving, i, items)); this.moving = null; } this.selected = i; this.draw(); });
      this.page.add(bg);
      const stock = this.dataIn.shop ? items[i] : undefined;
      if (this.dataIn.shop && !stock) return;
      const detail = stock ?? (s && itemById(s.item));
      if (detail) bg.on('pointerover', () => tip.setText(`${detail.description} · ${detail.tags.join(', ')}${detail.stamina ? ` · +${detail.stamina} Stamina` : ''}`).setVisible(true)).on('pointerout', () => tip.setVisible(false));
      // G-03: Dunmore's keeps only a little of some Project materials (content/projects.yaml shop_stock).
      const left = stock ? stockLeft(this.registry, stock.id) : null;
      this.text(x + 4, y + 3, stock ? `${stock.name}\n${stock.price} coins${left === null ? '' : left ? ` · ${left} left` : ' · sold out'}` : s ? `${itemById(s.item)?.name ?? s.item}\n×${s.count}` : '—', undefined, 150);
    });
    const stack = bag.slots[this.selected], item = this.dataIn.shop ? items[this.selected] : stack && itemById(stack.item);
    if (item) {
      this.text(130, detailY, `${item.description}  ${item.stamina ? `Restores ${item.stamina} Stamina.` : ''}\n${item.tags.join(' · ')}`);
      if (!this.dataIn.shop) this.text(130, 535, this.dataIn.gift ? 'Give this gift' : item.stamina ? 'Eat / drink' : '', () => this.use());
      if (this.dataIn.share && item.tags.includes('meal')) this.text(350, 535, 'Share this meal', () => { this.scene.stop(); this.dataIn.share!(this.selected, item); });
      if (!this.dataIn.gift && !this.dataIn.shop) {
        this.text(350, 535, 'Drop one', () => { const next = removeItem(bagOf(this.registry), this.selected); if (next) this.registry.set(BAG_KEY, next); this.draw(); });
        this.text(520, 535, this.moving === null ? 'Move stack' : 'Choose destination…', () => { this.moving = this.selected; this.draw(); });
      }
    }
    this.text(130, 620, 'Arrow keys: choose · Enter: use · I / Esc: close');
    if (this.dataIn.shop && items[this.selected]) {
      // GDD-GAP: general store stocks the MVP catalog at authored provisional prices.
      this.text(130, 580, `Buy ${items[this.selected]!.name} · ${items[this.selected]!.price} coins`, () => this.buy());
    }
  }
  private buy(): void {
    const item = items[this.selected]; if (!item) return;
    const coins = coinsOf(this.registry), bag = addItem(bagOf(this.registry), item);
    const soldOut = stockLeft(this.registry, item.id) === 0;
    if (coins >= item.price && bag && !soldOut) { this.registry.set(COINS_KEY, { balance: coins - item.price }); this.registry.set(BAG_KEY, bag); recordSale(this.registry, item.id); }
    this.draw();
    // GDD-GAP: a sold-out Project material comes back on the next ferry day (Tue/Fri).
    this.text(650, 580, soldOut ? 'Sold out. Nell says more on the next ferry.' : !bag ? 'Your bag is full.' : coins < item.price ? 'A few more coins first.' : 'Tucked into your bag.');
  }
  private use(): void {
    if (this.dataIn.shop) { this.buy(); return; }
    const stack = bagOf(this.registry).slots[this.selected], item = stack && itemById(stack.item); if (!item) return;
    if (this.dataIn.gift) { this.scene.stop(); this.dataIn.gift(this.selected, item); }
    else { consume(this.registry, this.selected, item); this.draw(); }
  }
}
