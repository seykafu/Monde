// Heart feedback for a dialogue turn (GDD §9.11.1–9.11.2 "Feedback"; MVP G-13 client). Pure: no Phaser, no DOM.
//
// After the resident's reply, the name plate's hearts fill or drain, a small ♥ floats up from the portrait (a
// cracked ♥ for a loss), and a new whole heart plays a soft chime. A turn that changes nothing shows nothing.
// The server reports what it applied (TurnRegard); this turns that into the steps the name plate animates through.
import { gainedWholeHeart, heartRow, type HeartRow, type TurnRegard } from '@monde/shared';

/**
 * GDD-GAP: §9.11.2 doesn't time the animation. Each half-heart step shows for 140 ms (a +5 turn, one heart, is two
 * steps), after a 250 ms beat so the eye has left the text.
 */
export const HEART_ANIMATION = { leadMs: 250, stepMs: 140 } as const;

export interface HeartFeedback {
  before: number;
  after: number;
  delta: number;
  kind: 'gain' | 'loss';
  /** The rows the name plate shows in turn, from the row before (first) to the row after (last), no repeats. */
  steps: HeartRow[];
  /** Steps at which a new whole heart fills (each plays the chime). */
  chimes: number[];
  /** What floats up from the portrait. */
  float: 'heart' | 'cracked';
  /** How long the fill or drain takes, after the lead beat. */
  durationMs: number;
}

const sameRow = (a: HeartRow, b: HeartRow): boolean => a.hearts === b.hearts && a.cracked === b.cracked;

/** Every distinct row between two Regard values, in order (half-heart steps; the cracked heart below 0). */
export function heartSteps(before: number, after: number): HeartRow[] {
  const from = Math.round(before), to = Math.round(after), dir = Math.sign(to - from);
  const steps = [heartRow(from)];
  for (let v = from + dir; dir !== 0 && v !== to + dir; v += dir) {
    const row = heartRow(v);
    if (!sameRow(row, steps[steps.length - 1]!)) steps.push(row);
  }
  return steps;
}

/** What one turn's applied Regard shows: null when nothing changed (a 0 turn, a capped one, or no Regard at all). */
export function heartFeedback(regard: TurnRegard | null | undefined): HeartFeedback | null {
  if (!regard || !Number.isFinite(regard.before) || !Number.isFinite(regard.after)) return null;
  const delta = regard.after - regard.before;
  if (delta === 0) return null;
  const steps = heartSteps(regard.before, regard.after);
  const chimes: number[] = [];
  if (delta > 0) {
    for (let i = 1; i < steps.length; i++) if (Math.floor(steps[i]!.hearts) > Math.floor(steps[i - 1]!.hearts)) chimes.push(i);
  }
  return {
    before: regard.before, after: regard.after, delta, kind: delta > 0 ? 'gain' : 'loss', steps, chimes,
    float: delta > 0 ? 'heart' : 'cracked', durationMs: (steps.length - 1) * HEART_ANIMATION.stepMs
  };
}

/** True when a turn fills a new whole heart (the chime), as shared's rule says. */
export const playsChime = (regard: TurnRegard | null | undefined): boolean =>
  !!regard && regard.after > regard.before && gainedWholeHeart(regard.before, regard.after);
