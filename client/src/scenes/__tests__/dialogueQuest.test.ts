// The dialogue panel's quest reply (mind/questTalk.ts): offered once, only with the right person at the right time,
// and the turn's talk context carries the quest report. A thin harness in the manner of qa/__tests__/uiFollowups.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Clock } from '../../sim/clock';
vi.mock('phaser', () => ({ default: { Scene: class {}, Textures: { FilterMode: { NEAREST: 0 } }, Math: { Clamp: (n: number, min: number, max: number) => Math.max(min, Math.min(max, n)) } } }));
const { DialogueScene } = await import('../DialogueScene');
const { personaCards } = await import('../../world/residents');
const { HINT_KEY } = await import('../../story/hint');

const S07A_HINT = {
  sceneId: 's07a_chime_runs', place: 'old_quarter.clocktower', placeName: 'Clocktower', zoneName: 'Old Quarter', via: null,
  start: 960, end: 1065, open: false, summoned: false, reason: 'Bertrand is at the clocktower.', where: 'Clocktower',
  when: '16:00–17:45', text: 'Clocktower, 16:00–17:45 — Bertrand is at the clocktower'
};

interface Choice { id: string; text: string; intent: string }
interface Panel { showChoices(): void; choose(choice: Choice): void; shownReplies: Choice[]; send: ReturnType<typeof vi.fn> }

function panelFor(id: string, opts: { hint?: unknown; open?: Record<string, unknown>; turn?: { choices: Choice[]; wrap_up: boolean }; registry?: Map<string, unknown> } = {}) {
  const data = opts.registry ?? new Map<string, unknown>();
  if (opts.hint !== undefined) data.set(HINT_KEY, opts.hint);
  const registry = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => { data.set(k, v); return registry; }, has: (k: string) => data.has(k), remove: (k: string) => data.delete(k) };
  const display = () => {
    const raw = { text: '', width: 100, height: 24, destroy: () => undefined, on: () => object, setVisible: () => object };
    const object: object = new Proxy(raw, { get: (target, key) => key in target ? Reflect.get(target, key) : () => object });
    return object;
  };
  const card = personaCards.find(c => c.id === id)!;
  const panel = new DialogueScene();
  Object.assign(panel, {
    registry, events: new EventEmitter(), input: Object.assign(new EventEmitter(), { keyboard: new EventEmitter() }),
    add: { text: display, graphics: display, rectangle: display }, cameras: { main: { ignore: vi.fn() } },
    card, open: { clock: new Clock({ day: 14, minute: 900 }), zone: { id: 'old_quarter' }, ...opts.open },
    turn: opts.turn ?? { choices: [{ id: 'a', text: 'Lovely afternoon.', intent: 'kind' }], wrap_up: false },
    context: { day: 14, minute: 900, place: 'old_quarter.clocktower', weather: 'fog' }, send: vi.fn()
  });
  return panel as unknown as Panel;
}
const questChip = (p: Panel) => p.shownReplies.find(c => c.intent === 'about_quest');

describe('the quest reply in the dialogue panel', () => {
  it('offers Bertrand "About the clocktower…" in the S07a window, once a conversation', () => {
    const p = panelFor('bertrand', { hint: S07A_HINT });
    p.showChoices();
    expect(questChip(p)).toEqual({ id: 'quest', text: 'About the clocktower…', intent: 'about_quest' });
    expect(p.shownReplies.filter(c => c.intent === 'about_quest')).toHaveLength(1);
    p.choose(questChip(p)!);
    expect(p.send).toHaveBeenCalledWith({ kind: 'choice', choice_id: 'quest', text: 'About the clocktower…', intent: 'about_quest' }, 'About the clocktower…');
    p.showChoices();
    expect(questChip(p)).toBeUndefined();
  });

  it('offers nothing to someone the objective doesn’t involve, but "What should I be doing?" on a day with nothing waiting', () => {
    const odile = panelFor('odile', { hint: S07A_HINT });
    odile.showChoices();
    expect(questChip(odile)).toBeUndefined();
    const quiet = panelFor('odile', { hint: null });
    quiet.showChoices();
    expect(questChip(quiet)?.text).toBe('What should I be doing?');
  });

  it('offers nothing to an unfinished census card, the cat, in a scripted handoff, after a wrap-up or over a Favor to answer', () => {
    const plain = personaCards.find(c => c.generated_by && !c.curated && c.kind !== 'animal')!;
    for (const p of [
      panelFor(plain.id, { hint: null }),
      panelFor('bastien', { hint: null }),
      panelFor('bertrand', { hint: S07A_HINT, open: { topic: 'The Marks and the minute book.' } }),
      panelFor('bertrand', { hint: S07A_HINT, open: { place: 'old_quarter.clocktower' } }),
      panelFor('bertrand', { hint: S07A_HINT, turn: { choices: [], wrap_up: true } })
    ]) { p.showChoices(); expect(questChip(p)).toBeUndefined(); }
    const book = new Map<string, unknown>([['monde.friendship', { favor_book: [{ id: 'f1', resident_id: 'bertrand', status: 'proposed', expires_day: 20, text: 'Wind the regulator?', task: { kind: 'chore' } }], tiers: {}, ties: { pairs: [] } }]]);
    const asked = panelFor('bertrand', { hint: S07A_HINT, registry: book });
    asked.showChoices();
    expect(questChip(asked)).toBeUndefined();
  });
});

describe('the quest reply beside the resident’s own', () => {
  it('stays at one: a model reply with intent about_quest stands in for it, and picking it uses it up', () => {
    const own = { id: 'b', text: 'Where should I be this afternoon?', intent: 'about_quest' };
    const p = panelFor('bertrand', { hint: S07A_HINT, turn: { choices: [{ id: 'a', text: 'Lovely afternoon.', intent: 'kind' }, own], wrap_up: false } });
    p.showChoices();
    expect(p.shownReplies.filter(c => c.intent === 'about_quest')).toEqual([own]);
    p.choose(own);
    Object.assign(p, { turn: { choices: [{ id: 'a', text: 'Lovely afternoon.', intent: 'kind' }], wrap_up: false } });
    p.showChoices();
    expect(questChip(p)).toBeUndefined();
  });
});
