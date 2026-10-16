import type Phaser from 'phaser';
import { COMMUNITY_TASKS, baseSkills, type CommunityTask } from '@monde/shared';
import type { Clock } from '../sim/clock';
import { getFellow, setFellow } from '../fellow/state';
import { getTown } from '../scenes/TownLedgerScene';
import { appendEvent } from '../scenes/events';
import { uuid } from '../mind/api';
import { FAMILY_BODY, GAME_WIDTH } from '../util/constants';
import { economyOf, coinsOf, ECONOMY_KEY, COINS_KEY } from './runtime';
import { awakeMinute, completeWork, sleep } from './rules';
import { openBag } from './BagScene';

/** Registered before saves, so dawn captures the new day's stamina and stipend. */
export function attachEconomyClock(scene: Phaser.Scene, clock: Clock): void {
  const r = scene.registry;
  if (!r.has(ECONOMY_KEY)) r.set(ECONOMY_KEY, { ...economyOf(r), day: clock.day });
  const minute = clock.onMinute(t => { if (t.minute > 1440) r.set(ECONOMY_KEY, awakeMinute(economyOf(r), t.minute)); });
  const dawn = clock.onDawn(t => {
    const state = economyOf(r);
    if (state.day < t.day) r.set(ECONOMY_KEY, { ...sleep(state, t.day - 1, 1560), day: t.day });
  });
  scene.events.once('shutdown', () => { minute(); dawn(); });
}
export interface EconomyAttachment { objects: Phaser.GameObjects.GameObject[]; interaction(place: string): { label: string; run(): void } | null }
export function attachEconomy(scene: Phaser.Scene, clock: Clock, toast: (text: string) => void, home: () => void): EconomyAttachment {
  const r = scene.registry;
  const hud = scene.add.text(GAME_WIDTH - 510, 18, '', { fontFamily: FAMILY_BODY, fontSize: '18px', color: '#fff0ce', backgroundColor: '#28372d', padding: { x: 10, y: 8 } });
  const bar = scene.add.graphics();
  const update = () => { const s = economyOf(r); hud.setText(`Stamina ${Math.ceil(s.stamina)}/${s.maxStamina}\n${coinsOf(r)} coins  ·  I: Bag`);
    bar.clear().fillStyle(0x18291f).fillRect(GAME_WIDTH - 500, 78, 190, 6).fillStyle(0xa6ca89).fillRect(GAME_WIDTH - 500, 78, 190 * s.stamina / s.maxStamina, 6); };
  scene.events.on('update', update); update();
  const payStipend = () => {
    // Stipend is paid by the Town Fund; lack of funds may put it into debt (GDD-GAP: no insolvency rule).
    const town = getTown(r); if (!town) return; r.set('monde.town', { ...town, fund: town.fund - 20 });
    r.set(COINS_KEY, { balance: coinsOf(r) + 20 });
  };
  if (!r.has(COINS_KEY)) payStipend();
  const finishDay = () => {
    r.set(ECONOMY_KEY, sleep(economyOf(r), clock.day, clock.minute));
    payStipend(); home(); clock.startNextDay();
  };
  const passOut = () => { clock.autoRollover = false; clock.pause('pass-out');
    scene.time.delayedCall(0, () => { toast('You wake at home, a little worse for the late night.'); finishDay(); clock.resume('pass-out'); }); };
  const off = clock.on26(passOut);
  if (clock.minute >= 1560) passOut();
  const key = (e: KeyboardEvent) => { if (!e.repeat && e.key.toLowerCase() === 'i' && !clock.paused) openBag(scene, clock); };
  scene.input.keyboard?.on('keydown', key);
  scene.events.once('shutdown', () => { off(); scene.events.off('update', update); scene.input.keyboard?.off('keydown', key); });
  const work = (task: CommunityTask) => {
    if (clock.paused) return;
    const fellow = getFellow(r), town = getTown(r);
    if (!town) return;
    const done = completeWork({ state: economyOf(r), coins: coinsOf(r), town, skills: fellow?.skills ?? baseSkills(), organizer: fellow?.profile?.background === 'organizer', day: clock.day, minute: clock.minute, task, id: uuid() });
    if (!done) { toast(clock.day < task.opens ? `This job opens on Day ${task.opens}.` : 'A meal or a fresh morning would help.'); return; }
    clock.pause('community-work'); scene.input.keyboard?.resetKeys();
    toast(`${task.name}…`);
    // GDD-GAP: 900 ms presentation beat; the task's authored minutes are charged on completion.
    scene.time.delayedCall(900, () => {
      r.set(ECONOMY_KEY, done.state); r.set(COINS_KEY, { balance: done.coins }); r.set('monde.town', done.town);
      if (fellow) setFellow(r, { ...fellow, skills: done.skills });
      appendEvent(r, done.event); clock.advanceMinutes(done.minutes); clock.resume('community-work');
      const applied = done.town.pillars[task.pillar] - town.pillars[task.pillar];
      toast(`${task.name}: +${task.pay} coins · +${task.xp} ${task.skill} XP · ${task.pillar} +${Number(applied.toFixed(3))}`);
    });
  };
  return { objects: [hud, bar], interaction: place => {
    if (place === 'old_quarter.lamplighter_cottage') return { label: 'Sleep until morning', run: () => {
      if (clock.paused) return;
      clock.pause('sleep-prompt');
      const text = scene.add.text(380, 300, 'Turn in for the night?\nEnter: sleep · Esc: stay up', { fontFamily: FAMILY_BODY, fontSize: '26px', color: '#fff0ce', backgroundColor: '#28372d', padding: { x: 24, y: 20 } });
      scene.cameras.main.ignore(text);
      const answer = (e: KeyboardEvent) => { if (e.key !== 'Enter' && e.key !== 'Escape') return; scene.input.keyboard?.off('keydown', answer); text.destroy(); clock.resume('sleep-prompt'); if (e.key === 'Enter') finishDay(); };
      scene.input.keyboard?.resetKeys(); scene.input.keyboard?.on('keydown', answer);
    } };
    if (place === 'market_row.general_store') return { label: 'Browse meals and gifts', run: () => openBag(scene, clock, { shop: true }) };
    const task = COMMUNITY_TASKS.find(t => t.place === place);
    return task ? { label: `${task.name} (${task.stamina} Stamina · ${task.minutes} min · ${task.pay} coins)`, run: () => work(task) } : null;
  } };
}
