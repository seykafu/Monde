/**
 * Residents talking to each other on the board (GDD §9.11.3 "Encounters": "a live NPC↔NPC exchange plays as speech
 * bubbles over their heads. The player can join, and it becomes a three-way VN scene").
 *
 * Owns one visible exchange at a time: picking the pair (chatterRules.ts), asking the server for a live exchange when
 * the player is close and listening or playing an authored one (ambientLines.ts) otherwise, the two speech bubbles
 * (speechBubble.ts), and the join. The resident layer owns movement and facing: while an exchange runs, its pair holds
 * still (residents.ts `advance`) and faces each other.
 */
import type Phaser from 'phaser';
import { pairKey, type ChatLine } from '@monde/shared';
import { getMind } from '../../mind/api';
import type { Clock } from '../../sim/clock';
import { hashString } from '../../sim/plans';
import { timeBand, WEATHER_TAGS, type WeatherTag } from '../../mind/quietMode';
import { Rng } from '../../util/rng';
import { tieMap, learnSeen } from '../friendship';
import {
  CHATTER_RULES, ChatterThrottle, PlayerLinger, chatterChance, chatterContinues, chatterMode, chatterRoll, eligibleChatter,
  type ChatterMode, type ChatterSpot
} from './chatterRules';
import { AMBIENT, animalLine, authoredExchange, type AmbientContext, type AmbientLibrary, type AmbientSpeaker } from './ambientLines';
import type { BubbleAnchor } from './bubbleLayout';
import { SpeechBubble } from './speechBubble';

export interface ChatterJoin { secondary: string; lines: ChatLine[] }

/** A resident as the chatter and the greetings see them this frame. */
export interface ChatterActor extends ChatterSpot {
  /** First name, for the bubble and `{name}`. */
  name: string;
  /** Speaks in narrated actions (Bastien). */
  animal: boolean;
  moving: boolean;
  /** World px: their x, the top of their head, their feet. */
  headX: number;
  headY: number;
  footY: number;
}

interface Active {
  a: string; b: string; day: number; mode: ChatterMode;
  lines: ChatLine[]; index: number; until: number; joined: boolean;
  /** Waiting on the server's lines. */
  pending: boolean;
  /** The server's reason when it answered (ok, cooldown, budget…), or 'authored'. */
  reason: string;
}

/** Scenes over the board that hush it: a conversation, a scripted scene. */
export const COVERING_SCENES: readonly string[] = ['Dialogue', 'Story'];

export const anchorOf = (a: ChatterActor): BubbleAnchor => ({ x: a.headX, headY: a.headY, footY: a.footY });
export const weatherTag = (kind: string): WeatherTag | null => (WEATHER_TAGS as readonly string[]).includes(kind) ? kind as WeatherTag : null;
/** GDD-GAP: a reading pause plus 40 ms a character, at most 7 s a line. */
export const lineMs = (text: string): number => Math.min(7000, 1800 + text.length * 40);

export class Chatter {
  private active: Active | null = null;
  private nextCheck: number = CHATTER_RULES.checkMs;
  private elapsed = 0;
  private abort: AbortController | null = null;
  private readonly bubbles: [SpeechBubble, SpeechBubble];
  private readonly throttle = new ChatterThrottle();
  private readonly linger = new PlayerLinger();
  private lastLive = -Infinity;
  private liveToday = 0;
  private day = 0;
  private readonly recent: string[] = [];
  private names = new Map<string, string>();
  /** Today's exchanges (dev readout): authored, live asked, live answered. */
  readonly count = { authored: 0, live: 0, answered: 0 };
  weather: () => string = () => 'sun';
  /** Told when a pair starts talking (the greetings count it as their hello). */
  onStart?: (a: string, b: string) => void;

  constructor(private readonly scene: Phaser.Scene, private readonly clock: Clock, private readonly lib: AmbientLibrary = AMBIENT) {
    this.bubbles = [new SpeechBubble(scene), new SpeechBubble(scene)];
    scene.events.once('shutdown', () => this.stop());
    const closed = () => this.stop();
    scene.game.events.on('monde:dialogue-closed', closed);
    scene.events.once('shutdown', () => scene.game.events.off('monde:dialogue-closed', closed));
  }

  get objects(): Phaser.GameObjects.GameObject[] { return this.bubbles.flatMap(b => b.objects); }
  partner(id: string): string | null { return this.active?.a === id ? this.active.b : this.active?.b === id ? this.active.a : null; }
  /** A bubble is up over this resident. */
  speaking(id: string): boolean { return this.bubbles.some(b => b.owner === id && b.showing); }

  join(id: string): ChatterJoin | undefined {
    const secondary = this.partner(id);
    if (!secondary || !this.active) return undefined;
    this.active.joined = true;
    for (const b of this.bubbles) b.hideNow();
    return { secondary, lines: this.active.pending ? [] : this.active.lines.slice(0, this.active.index + 1) };
  }

  stop(): void {
    this.abort?.abort(); this.abort = null; this.active = null;
    for (const b of this.bubbles) b.hide();
  }

  /** Dev and tests: start an exchange between two residents now, whatever the rules say. */
  force(a: string, b: string, actors: readonly ChatterActor[], player: { x: number; y: number }, mode?: ChatterMode): boolean {
    const x = actors.find(o => o.id === a), y = actors.find(o => o.id === b);
    if (!x || !y || a === b) return false;
    this.stop();
    this.begin(x, y, player, mode);
    return true;
  }

  /** What's on screen (the dev hook's readout). */
  state(): { a: string; b: string; mode: ChatterMode; reason: string; pending: boolean; index: number; lines: ChatLine[] } | null {
    const s = this.active;
    return s ? { a: s.a, b: s.b, mode: s.mode, reason: s.reason, pending: s.pending, index: s.index, lines: s.lines } : null;
  }
  bubbleState(): { owner: string | null; text: string }[] { return this.bubbles.map(b => ({ owner: b.owner, text: b.text })); }

  update(dtMs: number, actors: readonly ChatterActor[], player: { x: number; y: number }, view: Phaser.Geom.Rectangle): void {
    if (this.clock.day !== this.day) {
      this.stop(); this.throttle.newDay(); this.liveToday = 0; this.day = this.clock.day;
      this.count.authored = this.count.live = this.count.answered = 0;
    }
    this.elapsed += dtMs;
    this.linger.update(dtMs, player);
    if (COVERING_SCENES.some(k => this.scene.scene.isActive(k))) { for (const b of this.bubbles) b.hideNow(); return; }
    const byId = new Map(actors.map(a => [a.id, a]));
    for (const a of actors) this.names.set(a.id, a.name);
    if (this.active) this.run(this.active, byId, player);
    for (const b of this.bubbles) {
      const who = b.owner ? byId.get(b.owner) : undefined;
      if (b.showing && !who) b.hide();
      b.update(dtMs, who ? anchorOf(who) : null, view);
    }
    if (this.active || this.elapsed < this.nextCheck) return;
    this.nextCheck = this.elapsed + CHATTER_RULES.checkMs;
    const ties = tieMap(this.scene.registry);
    const seed = getMind().worldId ?? 'quiet-town';
    const bucket = Math.floor(this.elapsed / CHATTER_RULES.checkMs);
    const minute = this.clock.minute;
    const pairs: [ChatterActor, ChatterActor][] = [];
    for (let i = 0; i < actors.length; i++) for (let j = i + 1; j < actors.length; j++) {
      const a = actors[i]!, b = actors[j]!;
      if (!eligibleChatter(a, b, player) || !this.throttle.allows(a.id, b.id, this.elapsed, minute)) continue;
      if (chatterRoll(seed, this.day, bucket, a.id, b.id) >= chatterChance(ties.get(pairKey(a.id, b.id))?.label)) continue;
      pairs.push([a, b]);
    }
    // At a gathering spot first, then nearest the player.
    const d = ([a, b]: [ChatterActor, ChatterActor]) => Math.hypot((a.x + b.x) / 2 - player.x, (a.y + b.y) / 2 - player.y) - (a.spot && a.spot === b.spot ? 100 : 0);
    const best = pairs.sort((p, q) => d(p) - d(q))[0];
    if (best) this.begin(best[0], best[1], player);
  }

  private run(active: Active, byId: ReadonlyMap<string, ChatterActor>, player: { x: number; y: number }): void {
    if (active.joined) return;
    if (active.day !== this.clock.day || !chatterContinues(byId.get(active.a), byId.get(active.b), player)) { this.stop(); return; }
    if (active.pending) {
      if (!this.bubbles[0].showing) this.bubbles[0].say(active.a, this.names.get(active.a) ?? '', '…');
      return;
    }
    if (this.elapsed < active.until) return;
    active.index++;
    const next = active.lines[active.index];
    if (!next) { this.stop(); return; }
    this.say(active, next);
  }

  private say(active: Active, line: ChatLine): void {
    active.until = this.elapsed + lineMs(line.text);
    const [mine, theirs] = line.speaker === active.a ? this.bubbles : [this.bubbles[1], this.bubbles[0]];
    mine.say(line.speaker, this.names.get(line.speaker) ?? '', line.text);
    theirs.hide();
    this.recent.push(line.text);
    if (this.recent.length > 16) this.recent.shift();
  }

  private play(active: Active, lines: ChatLine[]): void {
    active.lines = lines;
    active.pending = false;
    active.index = 0;
    if (lines[0]) this.say(active, lines[0]);
  }

  private begin(a: ChatterActor, b: ChatterActor, player: { x: number; y: number }, forced?: ChatterMode): void {
    const day = this.clock.day, minute = this.clock.minute;
    const label = tieMap(this.scene.registry).get(pairKey(a.id, b.id))?.label ?? 'strangers';
    learnSeen(this.scene.registry, [[a.id, b.id]], day);
    this.throttle.record(a.id, b.id, this.elapsed, minute);
    this.onStart?.(a.id, b.id);
    const mind = getMind();
    const mode: ChatterMode = a.animal || b.animal ? 'authored' : forced ?? chatterMode({
      online: mind.enabled, lingering: this.linger.lingering, player, a, b, sinceLiveMs: this.elapsed - this.lastLive, liveToday: this.liveToday,
    });
    const ctx: AmbientContext = { label, band: timeBand(minute), weather: weatherTag(this.weather()) };
    const rng = new Rng(hashString(`${pairKey(a.id, b.id)}|${day}|${Math.floor(minute)}`));
    const roll = () => rng.next();
    const sa: AmbientSpeaker = { id: a.id, name: a.name, animal: a.animal }, sb: AmbientSpeaker = { id: b.id, name: b.name, animal: b.animal };
    const authored = () => authoredExchange(this.lib, sa, sb, ctx, roll, new Set(this.recent));
    const next: Active = { a: a.id, b: b.id, day, mode, lines: [], index: 0, until: Infinity, joined: false, pending: mode === 'live', reason: 'authored' };
    this.active = next;
    if (mode === 'authored') { this.count.authored++; this.play(next, authored()); return; }
    this.lastLive = this.elapsed;
    this.liveToday++;
    this.count.live++;
    this.abort = new AbortController();
    void mind.chat({ a: a.id, b: b.id, day, minute: Math.floor(minute), place: a.place, weather: this.weather() }, this.abort.signal).then(reply => {
      if (this.active !== next || next.joined) return;
      next.reason = reply?.reason ?? 'unreachable';
      if (reply && !reply.fallback) {
        this.count.answered++;
        this.play(next, reply.lines.map(l => (l.speaker === a.id ? sa : sb).animal ? { ...l, text: animalLine(this.lib, l.speaker === a.id ? sb : sa, roll) } : l));
      } else {
        // The server's fallback is its four stock lines; the board's own authored ones are richer.
        next.mode = 'authored';
        this.play(next, authored());
      }
    });
  }
}
