import type { Store } from './queue';
export type Choice = 'yes' | 'no' | null;
export function readChoice(store: Store | null): Choice {
  try { const s = store?.getItem('monde.telemetry.choice'); return s === 'yes' || s === 'no' ? s : null; } catch { return null; }
}
export function writeChoice(store: Store | null, yes: boolean): void {
  try { store?.setItem('monde.telemetry.choice', yes ? 'yes' : 'no'); } catch { /* session only */ }
}
/** Claim before showing, including skips. Install-scoped: never ask again after loading an old save. */
export class SurveyGate {
  private seen = new Set<string>();
  constructor(private store: Store | null) {}
  claim(survey: 'day7' | 'spring', optedIn: boolean, day: number): boolean {
    if (!optedIn || (survey === 'day7' ? day !== 7 : day < 26) || this.seen.has(survey)) return false;
    const key = `monde.telemetry.survey.${survey}`;
    try { if (this.store?.getItem(key) === 'shown') return false; } catch { /* session memory */ }
    this.seen.add(survey);
    try { this.store?.setItem(key, 'shown'); } catch { /* session memory */ }
    return true;
  }
}
