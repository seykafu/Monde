import { SPRING_RIDDLES, normalizeRiddleAnswer, type SavedRiddles, type RiddleDefinition } from '@monde/shared';
export interface MarkSite { id: string; zone: string; at: readonly [number, number] }
export const riddle = (id: string): RiddleDefinition | undefined => SPRING_RIDDLES.find(r => r.id === id);
export interface RiddleContext { day: number; minute: number; flags: ReadonlySet<string>; openDistricts: ReadonlySet<string> }
export const gameMinute = (c: Pick<RiddleContext, 'day' | 'minute'>): number => (c.day - 1) * 1440 + c.minute;
export function available(state: SavedRiddles, id: string, c: RiddleContext): boolean {
  const r = riddle(id);
  return !!r && c.day >= r.startDay && (r.chain === 'T' || c.openDistricts.has(r.district)) && r.prerequisites.every(f => c.flags.has(f)) && (!r.previous || state.entries[r.previous]?.status === 'solved');
}
export function readMark(state: SavedRiddles, id: string, c: RiddleContext): boolean {
  if (!available(state, id, c)) return false;
  state.entries[id] ??= { status: 'found', foundAt: gameMinute(c), hints: 0, attempts: [] };
  state.selected = id; return true;
}
/** Conservative typo list: unrestricted distance-one accepts valid wrong words (scale → stale).
 * GDD-GAP: §14.1 gives distance ≤1 but no dictionary. Only reviewed nonword typos are fuzzy-accepted.
 */
const TYPOS: Readonly<Record<string, string>> = { libary: 'library', librarry: 'library', sundiall: 'sundial', lighthous: 'lighthouse', keyston: 'keystone', kettlle: 'kettle', bandstan: 'bandstand', weathervan: 'weathervane', greenhous: 'greenhouse', clemenc: 'clemence' };
export function matchesAnswer(text: string, accepted: readonly string[]): boolean {
  const normalized = normalizeRiddleAnswer(text);
  return accepted.some(a => { const answer = normalizeRiddleAnswer(a); return normalized === answer || (answer.replace(/[^a-z]/g, '').length >= 5 && TYPOS[normalized] === answer); });
}
export function tickHints(state: SavedRiddles, now: number): void {
  for (const [id, e] of Object.entries(state.entries)) if (e.status === 'found' && e.hints === 0 && now - e.foundAt >= 60 && riddle(id)?.hints[0]) e.hints = 1;
}
export type HintSource = { kind: 'resident'; id: string; regard: number } | { kind: 'home'; spendStamina: (n: number) => boolean } | { kind: 'notebook'; consumePage: (chain: string) => boolean };
export function requestHint(state: SavedRiddles, id: string, source: HintSource): boolean {
  const e = state.entries[id], r = riddle(id);
  if (!e || !r || e.status === 'solved' || e.hints < 1 || e.hints >= 3 || !r.hints[e.hints]) return false;
  const next = e.hints + 1;
  const ok = source.kind === 'resident' ? ['margo', 'bertrand', 'tib'].includes(source.id) && (next === 2 || source.regard >= 40)
    : source.kind === 'home' ? next === 2 && source.spendStamina(10) : next === 3 && source.consumePage(r.chain);
  if (ok) e.hints = next;
  return ok;
}
export interface RewardHooks { apply: (id: string, rewards: RiddleDefinition['rewards'] & { xp: number; fragment: string | null }) => void }
export function answerMark(state: SavedRiddles, id: string, text: string, method: 'named' | 'found', c: RiddleContext, hooks: RewardHooks): 'locked' | 'wrong' | 'solved' | 'already' {
  const e = state.entries[id], r = riddle(id);
  if (!e || !r || !available(state, id, c)) return 'locked';
  if (e.status === 'solved') return 'already';
  if (method === 'named') e.attempts.push(text.slice(0, 120));
  if (method === 'named' && !matchesAnswer(text, r.accepted)) return 'wrong';
  hooks.apply(id, { ...r.rewards, xp: method === 'found' ? r.rewards.foundXp : r.rewards.namedXp, fragment: r.fragment });
  e.status = 'solved'; e.method = method;
  if (method === 'named') state.pinned.push(id);
  return 'solved';
}
