import { expect, it } from 'vitest';
import { baseSkills, emptyRiddles, emptyEventLog, Inventory, Wallet, SavedRiddles, SPRING_RIDDLES } from '@monde/shared';
import { StorySession } from '../../story/session';
import { createTownState } from '../../town/pillars';
import { findMark, marks, submitMark, homeHint } from '../../scenes/riddles';
import { getFellow, setFellow } from '../../fellow/state';
function registry() {
  const data = new Map<string, unknown>();
  return { get: (k: string) => data.get(k), set: (k: string, v: unknown) => data.set(k,v), remove: (k: string) => data.delete(k) };
}
it('applies wallet, Wits and Pillars once and survives a registry/save round-trip', () => {
  const r = registry(); r.set('monde.town', createTownState()); r.set('monde.riddles', emptyRiddles());
  setFellow(r, { profile: null, look: null, skills: baseSkills() });
  const clock = { day: 1, minute: 600 };
  expect(findMark(r, clock, 'T-01')).toBe(true);
  expect(submitMark(r, clock, 'T-01', 'comb')).toBe('solved');
  expect(Wallet.parse(r.get('monde.coins')).balance).toBe(5);
  expect(getFellow(r)!.skills.wits.xp).toBe(10);
  const log = r.get('monde.events') as ReturnType<typeof emptyEventLog>;
  expect(log.outbox).toMatchObject([{ kind: 'scripted_regard', resident: 'tib', delta: 3 }]);
  r.set('monde.riddles', SavedRiddles.parse(JSON.parse(JSON.stringify(marks(r)))));
  expect(submitMark(r, clock, 'T-01', 'comb')).toBe('already');
  expect(Wallet.parse(r.get('monde.coins')).balance).toBe(5);
  expect(findMark(r, clock, 'OQ-1')).toBe(true);
  submitMark(r, clock, 'OQ-1', 'bell');
  expect((r.get('monde.town') as ReturnType<typeof createTownState>).pillars.charm).toBe(26);
});
it('does not spend Stamina away from home', () => {
  const r = registry(); const state = emptyRiddles();
  state.entries['OQ-1'] = { status: 'found', foundAt: 360, hints: 1, attempts: [] };
  r.set('monde.riddles', state); r.set('monde.inventory', Inventory.parse({}));
  expect(homeHint(r, 'OQ-1')).toBe(false);
  expect(r.get('monde.economy')).toBeUndefined();
});
it('sets charter_half when the third Charter fragment is recovered, not before', () => {
  const r = registry(); r.set('monde.town', createTownState()); r.set('monde.riddles', emptyRiddles());
  setFellow(r, { profile: null, look: null, skills: baseSkills() });
  const session = new StorySession({ world: null });
  session.flags.set('project_lighthouse_done'); r.set('monde.story.session', { session });
  const clock = { day: 8, minute: 600 };
  const answers: Record<string, string> = Object.fromEntries(SPRING_RIDDLES.map(m => [m.id, m.accepted[0]!]));
  for (const chain of ['OQ', 'MR', 'WF']) {
    expect(session.flags.has('charter_half')).toBe(false);
    for (let n = 1; n <= 5; n++) {
      const id = `${chain}-${n}`;
      expect(findMark(r, clock, id)).toBe(true);
      expect(submitMark(r, clock, id, answers[id]!)).toBe('solved');
    }
  }
  expect(session.flags.has('charter_half')).toBe(true);
});
