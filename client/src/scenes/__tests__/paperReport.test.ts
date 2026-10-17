import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { emptyFriendship, fallbackPress, type Press } from '@monde/shared';
import { Clock } from '../../sim/clock';
import { stampGenerated } from '../../press/report';

// §9.13 on the printed Lantern: each model-written item has a Report control that arms on the first press, withdraws
// the item and records its key on the second, and never closes the paper on the way.
vi.mock('phaser', () => ({ default: { Scene: class {}, Textures: { FilterMode: { NEAREST: 0 } }, Math: { Clamp: (n: number, min: number, max: number) => Math.max(min, Math.min(max, n)) } } }));
const sent: unknown[] = [];
let answer = true;
vi.mock('../../mind/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../mind/api')>()),
  getMind: () => ({ report: async (body: unknown) => { sent.push(body); return answer; } }),
}));
const amended: string[][] = [];
vi.mock('../../save/runtime', () => ({ amendLastSave: async (keys: string[]) => { amended.push(keys); } }));
const { DawnReportScene } = await import('../DawnReportScene');

interface Node { text: string; set: string | null; emit(event: string, ...args: unknown[]): boolean; destroyed: boolean }
function harness() {
  const data = new Map<string, unknown>([['monde.friendship', emptyFriendship()]]);
  const registry = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => { data.set(k, v); return registry; }, has: (k: string) => data.has(k), remove: (k: string) => data.delete(k) };
  const events = new EventEmitter(), keyboard = Object.assign(new EventEmitter(), { resetKeys: vi.fn() });
  const nodes: Node[] = [];
  const display = (_x = 0, _y = 0, text = '') => {
    const e = new EventEmitter();
    const raw: Node & Record<string, unknown> = { text, set: null, destroyed: false, emit: e.emit.bind(e),
      on: (event: string, listener: (...args: unknown[]) => void) => { e.on(event, listener); return object; },
      setText: (t: string) => { raw.set = t; return object; }, getWrappedText: () => [text], destroy: () => { raw.destroyed = true; } };
    nodes.push(raw);
    const object: object = new Proxy(raw, { get: (target, key) => key in target ? Reflect.get(target, key) : () => object });
    return object;
  };
  const host = { input: { enabled: true, keyboard: { enabled: true, resetKeys: vi.fn() } } };
  const input = Object.assign(new EventEmitter(), { keyboard });
  const stop = vi.fn(() => events.emit('shutdown'));
  const raw = { registry, events, input, cameras: { main: { ignore: vi.fn() } },
    add: { text: display, graphics: () => display(), rectangle: () => display() },
    time: { delayedCall: () => ({ remove: vi.fn() }) }, tweens: { killTweensOf: vi.fn(), add: vi.fn() },
    scene: { get: () => host, stop, bringToTop: vi.fn() } };
  return { raw, nodes, stop, keyboard, data };
}
const SERVER: Press = {
  ...fallbackPress(3, [], []), source: 'model', headline: 'BROOMS OUT', dek: 'A broom and a morning.',
  stories: [{ event_id: 'sweep', title: 'Market Row', text: 'The Fellow swept Market Row.' }, { event_id: null, title: 'Desk', text: 'The desk is open.' }],
  letters: [{ from: 'odile', text: 'The broom is by the door.', id: 'letter_odile_2' }],
};
const open = (paper: Press) => {
  const h = harness(), clock = new Clock({ day: 3, minute: 360 });
  const panel = new DawnReportScene(); Object.assign(panel, h.raw);
  panel.init({ host: 'Zone', clock, paper, seed: 1, archive: true }); panel.create();
  const controls = () => h.nodes.filter(n => !n.destroyed && (n.text === 'Report'));
  return { ...h, panel, controls, flush: () => new Promise(resolve => setTimeout(resolve, 0)) };
};
const tap = (n: Node) => { const stopPropagation = vi.fn(); n.emit('pointerup', {}, 0, 0, { stopPropagation }); return stopPropagation; };

it('puts a Report control on the model front, each model story and each reflection letter, never on template copy', () => {
  expect(open(stampGenerated(SERVER, SERVER)).controls()).toHaveLength(4);
  // A template edition's headline and stories are authored; the letter a resident wrote is still theirs.
  expect(open(stampGenerated({ ...SERVER, source: 'template' }, null)).controls()).toHaveLength(1);
  expect(open(stampGenerated({ ...SERVER, source: 'template', letters: [] }, null)).controls()).toHaveLength(0);
});

it('arms, then withdraws a story at once, records it in the save and sends the server copy key', async () => {
  sent.length = 0; amended.length = 0; answer = true;
  const s = open(stampGenerated(SERVER, SERVER));
  const story = s.controls()[1]!;
  expect(tap(story)).toHaveBeenCalledOnce();
  expect(s.stop).not.toHaveBeenCalled();
  expect(sent).toHaveLength(0);
  tap(story);
  expect(s.nodes.find(n => n.text === 'Market Row')!.set).toBe('Withdrawn');
  expect(s.nodes.find(n => n.text === 'The Fellow swept Market Row.')!.set).toContain('withdrawn by the Lantern');
  expect((s.data.get('monde.friendship') as { reported: string[] }).reported).toEqual(['press:3:story:0']);
  expect(amended).toEqual([['press:3:story:0']]);
  expect(sent).toEqual([{ kind: 'press', day: 3, story: 0, event_id: 'sweep', reason: 'Report story' }]);
  expect(story.destroyed).toBe(true);
  await s.flush();
  expect(s.stop).not.toHaveBeenCalled();
});

it('reports from the keyboard, keeps a failed send hidden, and Enter closes once nothing is picked', async () => {
  sent.length = 0; answer = false;
  const s = open(stampGenerated(SERVER, SERVER));
  const toasts = () => s.nodes.filter(n => n.set?.startsWith('Couldn'));
  s.keyboard.emit('keydown-LEFT', { preventDefault: vi.fn() }); // wraps to the last control: the letter
  s.keyboard.emit('keydown-ENTER'); s.keyboard.emit('keydown-ENTER');
  expect(sent).toEqual([{ kind: 'letter', letter_id: 'letter_odile_2', reason: 'Report letter' }]);
  expect(s.nodes.find(n => n.text === 'odile: The broom is by the door.')!.set).toContain('withdrawn');
  await s.flush();
  expect(toasts()).toHaveLength(1);
  expect((s.data.get('monde.friendship') as { reported: string[] }).reported).toEqual(['letter:letter_odile_2']);
  s.keyboard.emit('keydown-ESC'); s.keyboard.emit('keydown-ESC');
  expect(s.stop).toHaveBeenCalledOnce();
});

it('prints a reported item withdrawn when the paper is opened again', () => {
  const h = open(stampGenerated(SERVER, SERVER));
  h.data.set('monde.friendship', { ...emptyFriendship(), reported: ['press:3:front'] });
  const again = new DawnReportScene(); Object.assign(again, h.raw);
  const clock = new Clock({ day: 3, minute: 360 });
  again.init({ host: 'Zone', clock, paper: stampGenerated(SERVER, SERVER), seed: 1, archive: true }); again.create();
  const texts = h.nodes.map(n => n.text);
  expect(texts).toContain('THE LANTERN — MORNING EDITION');
  expect(texts.some(t => t.includes('front-page item was withdrawn'))).toBe(true);
});
