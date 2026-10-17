import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { fallbackPress } from '@monde/shared';
import { Clock } from '../../sim/clock';
vi.mock('phaser', () => ({ default: { Scene: class {}, Textures: { FilterMode: { NEAREST: 0 } }, Math: { Clamp: (n: number, min: number, max: number) => Math.max(min, Math.min(max, n)) } } }));
const { DawnReportScene } = await import('../../scenes/DawnReportScene');
const { attachEconomy } = await import('../../economy/attach');
const { MarkPages } = await import('../../scenes/MarkPages');
const { marks } = await import('../../scenes/riddles');
const { DialogueScene } = await import('../../scenes/DialogueScene');

function harness() {
  const data = new Map<string, unknown>();
  const registry = { get: (k: string) => data.get(k), set: (k: string, v: unknown) => { data.set(k, v); return registry; }, has: (k: string) => data.has(k), remove: (k: string) => data.delete(k) };
  const events = new EventEmitter(), keyboard = Object.assign(new EventEmitter(), { resetKeys: vi.fn() });
  const nodes: { text: string; emit(event: string): boolean; destroyed: boolean; visible: boolean }[] = [];
  const display = (_x = 0, _y = 0, text = '') => {
    const e = new EventEmitter();
    const raw = { text, width: 100, height: 24, destroyed: false, visible: true, setVisible: (visible: boolean) => { raw.visible = visible; return object; }, on: (event: string, listener: (...args: unknown[]) => void) => { e.on(event, listener); return object; }, emit: e.emit.bind(e), destroy: () => { raw.destroyed = true; } };
    nodes.push(raw);
    const object: object = new Proxy(raw, { get: (target, key) => key in target ? Reflect.get(target, key) : () => object });
    return object;
  };
  const host = { input: { enabled: true, keyboard: { enabled: true, resetKeys: vi.fn() } } };
  const input = Object.assign(new EventEmitter(), { keyboard });
  const stop = vi.fn(() => events.emit('shutdown'));
  const raw = { registry, events, input, cameras: { main: { ignore: vi.fn() } },
    add: { text: display, graphics: () => display(), rectangle: () => display() },
    scene: { get: () => host, stop, bringToTop: vi.fn() } };
  return { raw, scene: raw as unknown as Phaser.Scene, nodes, stop, keyboard, host, display };
}
it('Escape closes the Dawn Report and releases the paper hold', () => {
  const h = harness(), clock = new Clock({ day: 2, minute: 360 });
  const panel = new DawnReportScene(); Object.assign(panel, h.raw);
  panel.init({ host: 'Zone', clock, paper: fallbackPress(2, [], []), seed: 1, archive: true }); panel.create();
  expect(clock.pauseReasons).toContain('paper');
  h.keyboard.emit('keydown-ESC'); expect(h.stop).toHaveBeenCalledOnce();
  expect(clock.pauseReasons).not.toContain('paper'); expect(h.host.input.enabled).toBe(true);
});
it('the sleep prompt supports both mouse choices, cleans up handlers and sleeps only once', () => {
  const h = harness(), clock = new Clock({ day: 2, minute: 1200 });
  const next = vi.spyOn(clock, 'startNextDay'), home = vi.fn();
  const economy = attachEconomy(h.scene, clock, vi.fn(), home);
  economy.interaction('old_quarter.lamplighter_cottage')!.run();
  h.nodes.find(n => n.text === 'Esc · Stay up')!.emit('pointerup');
  expect(clock.paused).toBe(false); expect(home).not.toHaveBeenCalled();
  economy.interaction('old_quarter.lamplighter_cottage')!.run();
  const yes = h.nodes.filter(n => n.text === 'Enter · Sleep').at(-1)!;
  yes.emit('pointerup'); yes.emit('pointerup');
  expect(next).toHaveBeenCalledOnce(); expect(home).toHaveBeenCalledOnce();
  expect(clock.pauseReasons).not.toContain('sleep-prompt');
});
it('a solved Mark page never promises a future nudge', () => {
  const h = harness(), clock = new Clock({ day: 2, minute: 600 });
  const state = marks(h.scene.registry);
  state.selected = 'OQ-1'; state.entries['OQ-1'] = { status: 'solved', foundAt: 2040, hints: 0, attempts: [] };
  new MarkPages(h.scene, clock, { add: vi.fn() } as unknown as Phaser.GameObjects.Container, vi.fn()).draw('Marks');
  expect(h.nodes.some(n => n.text.includes('A nudge will appear'))).toBe(false);
});
it('the Mark topic disappears after use in the same written conversation', () => {
  const h = harness(), clock = new Clock({ day: 2, minute: 600 });
  const state = marks(h.scene.registry); state.selected = 'OQ-1';
  state.entries['OQ-1'] = { status: 'found', foundAt: 1900, hints: 1, attempts: [] };
  const panel = new DialogueScene(); Object.assign(panel, h.raw, { card: { id: 'margo' }, open: { clock }, turn: { choices: [], wrap_up: true }, context: {}, send: vi.fn() });
  const methods = panel as unknown as { showChoices(): void; choose(choice: { id: string; text: string; intent: string }): void; shownReplies: { id: string }[] };
  methods.showChoices(); expect(methods.shownReplies.some(c => c.id === 'mark')).toBe(true);
  methods.choose({ id: 'mark', text: 'About OQ-1…', intent: 'about_riddle' });
  methods.showChoices(); expect(methods.shownReplies.some(c => c.id === 'mark')).toBe(false);
});

it('world name tags and emotes step aside during a Project beat', async () => {
  vi.stubGlobal('window', { location: { search: '' } });
  const { ResidentLayer } = await import('../../scenes/zone/residents');
  const h = harness(); let beat = false;
  const label = h.display(), bubble = h.display();
  const actor = { state: { visible: true, moving: true }, pos: { x: 1, y: 1 }, alpha: 1, profile: { id: 'sable' },
    avatar: { apply: vi.fn() }, sprite: h.display(), shadow: h.display(), label, bubble };
  const context = { projection: { originX: 0, originY: 0, elevationAt: () => 0 },
    scene: { scene: { isActive: () => beat } }, speaking: () => false, chatter: { partner: () => null } };
  const draw = Reflect.get(ResidentLayer.prototype, 'draw') as (a: unknown, p: unknown, pointer: null, dt: number) => void;
  draw.call(context, actor, { x: 1, y: 1 }, null, 16);
  expect(Reflect.get(label, 'visible')).toBe(true);
  beat = true; draw.call(context, actor, { x: 1, y: 1 }, null, 16);
  expect(Reflect.get(label, 'visible')).toBe(false); expect(Reflect.get(bubble, 'visible')).toBe(false);
  vi.unstubAllGlobals();
});

it('Choices only hides free text, retains replies and Bag, and guards the typing shortcut', async () => {
  const { setAccessibility } = await import('../../accessibility/runtime');
  const h = harness(), clock = new Clock({ day: 2, minute: 600 });
  const panel = new DialogueScene();
  Object.assign(panel, h.raw, { card: { id: 'margo' }, open: { clock }, turn: { choices: [{ id: 'a', text: 'Hello there.', intent: 'kind' }], wrap_up: false }, context: {} });
  const methods = panel as unknown as { showChoices(): void; openSay(): void };
  try {
    setAccessibility({ choicesOnly: true }); methods.showChoices();
    expect(h.nodes.some(n => !n.destroyed && n.text === 'Say something…')).toBe(false);
    expect(h.nodes.some(n => !n.destroyed && n.text.includes('Hello there.'))).toBe(true);
    expect(h.nodes.some(n => !n.destroyed && n.text === 'Bag')).toBe(true);
    // No DOM exists in Node: the keyboard path must return before creating an input.
    expect(() => methods.openSay()).not.toThrow();
    setAccessibility({ choicesOnly: false }); methods.showChoices();
    expect(h.nodes.some(n => !n.destroyed && n.text === 'Say something…')).toBe(true);
  } finally { setAccessibility({ choicesOnly: false }); }
});
