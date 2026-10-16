import type Phaser from 'phaser';
import { ambientExchange, pairKey, type ChatLine } from '@monde/shared';
import { getMind } from '../../mind/api';
import type { Clock } from '../../sim/clock';
import { tieMap, learnSeen } from '../friendship';
import { chatterChance, chatterRoll, eligibleChatter, CHATTER_RULES, type ChatterSpot } from './chatterRules';
import { personaCards } from '../../world/residents';

export interface ChatterJoin { secondary: string; lines: ChatLine[] }
export interface ChatterActor extends ChatterSpot { screenX: number; screenY: number }
interface Active { a: string; b: string; day: number; lines: ChatLine[]; index: number; until: number; joined: boolean }

/** Owns a single visible exchange and its cancellation; the layer owns movement and facing. */
export class Chatter {
  private active: Active | null = null;
  private nextCheck: number = CHATTER_RULES.checkMs;
  private elapsed = 0;
  private abort: AbortController | null = null;
  private readonly bubble: Phaser.GameObjects.Text;
  private readonly seen = new Set<string>();
  private day = 0;
  weather = () => 'clear';
  constructor(private readonly scene: Phaser.Scene, private readonly clock: Clock) {
    this.bubble = scene.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '13px', color: '#392d29',
      backgroundColor: '#fff0ce', padding: { x: 8, y: 6 }, wordWrap: { width: 200 }, align: 'left' })
      .setOrigin(0.5, 1).setDepth(100000).setVisible(false);
    scene.events.once('shutdown', () => this.stop());
    const closed = () => this.stop();
    scene.game.events.on('monde:dialogue-closed', closed);
    scene.events.once('shutdown', () => scene.game.events.off('monde:dialogue-closed', closed));
  }
  partner(id: string): string | null { return this.active?.a === id ? this.active.b : this.active?.b === id ? this.active.a : null; }
  join(id: string): ChatterJoin | undefined {
    const secondary = this.partner(id);
    if (!secondary || !this.active) return undefined;
    this.active.joined = true;
    this.bubble.setVisible(false);
    return { secondary, lines: this.active.lines.slice(0, this.active.index + 1) };
  }
  stop(): void { this.abort?.abort(); this.abort = null; this.active = null; this.bubble.setVisible(false); }
  update(dt: number, actors: ChatterActor[], player: { x: number; y: number }): void {
    if (this.clock.day !== this.day) { this.stop(); this.seen.clear(); this.day = this.clock.day; }
    if (this.scene.scene.isActive('Dialogue')) return;
    this.elapsed += dt;
    const active = this.active;
    if (active) {
      if (active.day !== this.clock.day || [active.a, active.b].some(id => !actors.some(a => a.id === id && a.visible))) { this.stop(); return; }
      if (!active.lines.length) return;
      if (this.elapsed >= active.until) {
        active.index++;
        const next = active.lines[active.index];
        if (!next) { this.stop(); return; }
        active.until = this.elapsed + this.duration(next);
      }
      const line = active.lines[active.index]!;
      const speaker = actors.find(a => a.id === line.speaker)!;
      this.bubble.setText(line.text).setPosition(speaker.screenX, speaker.screenY - 70).setVisible(true);
      return;
    }
    if (this.elapsed < this.nextCheck) return;
    this.nextCheck = this.elapsed + CHATTER_RULES.checkMs;
    const ties = tieMap(this.scene.registry);
    const seed = getMind().worldId ?? 'quiet-town';
    for (let i = 0; i < actors.length; i++) for (const b of actors.slice(i + 1)) {
      const a = actors[i]!, key = pairKey(a.id, b.id);
      if (this.seen.has(key) || !eligibleChatter(a, b, player)) continue;
      const label = ties.get(key)?.label;
      if (chatterRoll(seed, this.day, Math.floor(this.elapsed / CHATTER_RULES.checkMs), a.id, b.id) >= chatterChance(label)) continue;
      this.seen.add(key);
      learnSeen(this.scene.registry, [[a.id, b.id]], this.day);
      this.nextCheck = this.elapsed + CHATTER_RULES.gapMs;
      const next: Active = { a: a.id, b: b.id, day: this.day, lines: [], index: 0, until: Infinity, joined: false };
      this.active = next;
      this.abort = new AbortController();
      const mean = label === 'close_friends' ? 75 : label === 'friends' ? 45 : label === 'rivals' || label === 'enemies' ? -30 : 0;
      void getMind().chat({ a: a.id, b: b.id, day: this.day, minute: Math.floor(this.clock.minute), place: a.place, weather: this.weather() }, this.abort.signal).then(reply => {
        if (this.active !== next || next.joined) return;
        next.lines = reply?.lines ?? ambientExchange(a.id, b.id, mean);
        for (const line of next.lines) if (personaCards.find(c => c.id === line.speaker)?.voice.mode === 'narrated_action') line.text = '(pauses nearby)';
        next.until = this.elapsed + this.duration(next.lines[0]!);
      });
      return;
    }
  }
  // GDD-GAP: short reading pause plus 40 ms/character, bounded at 7 s.
  private duration(line: ChatLine): number { return Math.min(7000, 1800 + line.text.length * 40); }
}
