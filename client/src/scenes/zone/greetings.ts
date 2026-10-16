/**
 * Passing greetings on the board: two residents passing close while walking nod and say a word each (a greeting, then
 * its answer), from content/lines/ambient.yaml by their tie, the time of day and the weather, with no server
 * call. Rules and pacing in greetingRules.ts; bubbles as the exchanges' (speechBubble.ts). Never while a conversation
 * or a scripted scene is over the board.
 */
import type Phaser from 'phaser';
import { pairKey } from '@monde/shared';
import type { Clock } from '../../sim/clock';
import { hashString } from '../../sim/plans';
import { timeBand } from '../../mind/quietMode';
import { Rng } from '../../util/rng';
import { learnSeen, tieMap } from '../friendship';
import { AMBIENT, greetingBeat, type AmbientLibrary } from './ambientLines';
import { COVERING_SCENES, anchorOf, weatherTag, type ChatterActor } from './chatter';
import { GREETING_RULES, GreetingThrottle, passingPairs } from './greetingRules';
import { SpeechBubble } from './speechBubble';

interface Beat { bubble: SpeechBubble; owner: string; name: string; text: string; at: number; until: number; said: boolean; after?: Beat }

export class Greetings {
  private readonly pool: SpeechBubble[];
  private readonly throttle = new GreetingThrottle();
  private beats: Beat[] = [];
  private elapsed = 0;
  private nextCheck = 0;
  private day = 0;
  private readonly recent: string[] = [];
  /** Greetings today (dev readout). */
  count = 0;
  weather: () => string = () => 'sun';

  constructor(private readonly scene: Phaser.Scene, private readonly clock: Clock, private readonly lib: AmbientLibrary = AMBIENT) {
    this.pool = Array.from({ length: 4 }, () => new SpeechBubble(scene));
  }

  get objects(): Phaser.GameObjects.GameObject[] { return this.pool.flatMap(b => b.objects); }
  speaking(id: string): boolean { return this.pool.some(b => b.owner === id && b.showing) || this.beats.some(b => b.owner === id); }
  /** The pair has just talked another way (an exchange): that was their hello. */
  note(a: string, b: string): void { this.throttle.note(a, b, this.clock.minute); }
  state(): { owner: string | null; text: string }[] { return this.pool.map(b => ({ owner: b.owner, text: b.text })); }

  /** Dev: greet now, whatever the pacing. */
  force(a: string, b: string, actors: readonly ChatterActor[]): boolean {
    const x = actors.find(o => o.id === a), y = actors.find(o => o.id === b);
    if (!x || !y || a === b) return false;
    this.start(x, y);
    return true;
  }

  update(dtMs: number, actors: readonly ChatterActor[], player: { x: number; y: number }, view: Phaser.Geom.Rectangle, busy: (id: string) => boolean): void {
    if (this.clock.day !== this.day) { this.throttle.newDay(); this.day = this.clock.day; this.count = 0; }
    this.elapsed += dtMs;
    if (COVERING_SCENES.some(k => this.scene.scene.isActive(k))) {
      this.beats = [];
      for (const b of this.pool) b.hideNow();
      return;
    }
    const byId = new Map(actors.map(a => [a.id, a]));
    this.beats = this.beats.filter(beat => {
      if (!byId.get(beat.owner)?.near) { beat.bubble.hide(); return false; }
      if (!beat.said && this.elapsed >= beat.at) {
        beat.bubble.say(beat.owner, beat.name, beat.text);
        beat.said = true;
        // One at a time, like the exchanges: the greeting gives way to its answer.
        if (beat.after) beat.after.until = Math.min(beat.after.until, this.elapsed);
      }
      if (this.elapsed >= beat.until) { beat.bubble.hide(); return false; }
      return true;
    });
    for (const b of this.pool) {
      const who = b.owner ? byId.get(b.owner) : undefined;
      if (b.showing && !who) b.hide();
      b.update(dtMs, who ? anchorOf(who) : null, view);
    }
    if (this.elapsed < this.nextCheck) return;
    this.nextCheck = this.elapsed + GREETING_RULES.checkMs;
    const spots = actors.map(a => ({ id: a.id, x: a.x, y: a.y, moving: a.moving, visible: a.visible, busy: a.talking || busy(a.id) || this.speaking(a.id) }));
    const pair = this.throttle.pick(passingPairs(spots, player), this.elapsed, this.clock.minute);
    const a = pair && byId.get(pair.a), b = pair && byId.get(pair.b);
    if (a && b) this.start(a, b);
  }

  private start(a: ChatterActor, b: ChatterActor): void {
    const free = this.pool.filter(p => !p.showing && p.owner === null && !this.beats.some(x => x.bubble === p));
    if (free.length < 2) return;
    const minute = this.clock.minute;
    const label = tieMap(this.scene.registry).get(pairKey(a.id, b.id))?.label ?? 'strangers';
    learnSeen(this.scene.registry, [[a.id, b.id]], this.clock.day);
    const rng = new Rng(hashString(`${pairKey(a.id, b.id)}|greet|${this.clock.day}|${Math.floor(minute)}`));
    const [first, second] = greetingBeat(this.lib, { id: a.id, name: a.name, animal: a.animal }, { id: b.id, name: b.name, animal: b.animal },
      { label, band: timeBand(minute), weather: weatherTag(this.weather()) }, () => rng.next(), new Set(this.recent));
    const now = this.elapsed, show = GREETING_RULES.showMs, delay = GREETING_RULES.replyDelayMs;
    const opener: Beat = { bubble: free[0]!, owner: a.id, name: a.name, text: first.text, at: now, until: now + show, said: false };
    this.beats.push(opener,
      { bubble: free[1]!, owner: b.id, name: b.name, text: second.text, at: now + delay, until: now + delay + show, said: false, after: opener });
    this.recent.push(first.text, second.text);
    while (this.recent.length > 16) this.recent.shift();
    this.count++;
  }
}
