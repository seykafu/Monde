import { puzzleSave } from '../puzzles/runtime';
import { isWorkPuzzle, workBoard, workSolved } from '../puzzles/work';
import { openWorkPuzzle } from '../puzzles/scenes/WorkPuzzleScene';
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
let devWork = import.meta.env.DEV && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('work') : null;
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
  const attempt = (task: CommunityTask) => {
    const fellow = getFellow(r), town = getTown(r);
    if (!town) return null;
    const done = completeWork({ state: economyOf(r), coins: coinsOf(r), town, skills: fellow?.skills ?? baseSkills(), organizer: fellow?.profile?.background === 'organizer', day: clock.day, minute: clock.minute, task, id: uuid() });
    if (!done) { toast(clock.day < task.opens ? `This job opens on Day ${task.opens}.` : 'A meal or a fresh morning would help.'); return null; }
    return { done, fellow, town };
  };
  const settle = (task: CommunityTask, { done, fellow, town }: NonNullable<ReturnType<typeof attempt>>) => {
    r.set(ECONOMY_KEY, done.state); r.set(COINS_KEY, { balance: done.coins }); r.set('monde.town', done.town);
    if (fellow) setFellow(r, { ...fellow, skills: done.skills });
    // GDD-GAP: Duck Duty is not in the server's six-job catalogue yet; record its authored action as a
    // scripted memory (importance 2, the existing sweeping importance), rather than queue an invalid task.
    appendEvent(r, task.id === 'duck_duty' ? { kind:'scripted_memory',id:done.event.id,day:clock.day,minute:Math.floor(clock.minute),
      resident:'bertrand',scene_id:'puzzles',cue_key:done.event.id,place:task.place,text:'The Fellow fed the ducks peas at the pond.',importance:2 } : done.event);
    clock.advanceMinutes(done.minutes);
    const applied = done.town.pillars[task.pillar] - town.pillars[task.pillar];
    toast(`${task.name}: +${task.pay} coins · +${task.xp} ${task.skill} XP · ${task.pillar} +${Number(applied.toFixed(3))}`);
  };
  const work = (task: CommunityTask) => {
    if (clock.paused) return;
    const ready = attempt(task);
    if (!ready) return;
    if (isWorkPuzzle(task.id)) {
      // G-07 (§15.21): the job is the board. It pays as below once the saved board is won within par (checked again
      // here); leaving keeps the board for later and costs nothing. GDD-GAP: beating par gives nothing extra.
      const kind = task.id;
      void openWorkPuzzle(scene, clock, kind).then(solved => {
        if (!solved || !workSolved(r, workBoard(r, kind, clock.day, getFellow(r)?.skills.wits.level ?? 1))) return;
        const now = attempt(task);
        if (now) settle(task, now);
      });
      return;
    }
    clock.pause('community-work'); scene.input.keyboard?.resetKeys();
    toast(`${task.name}…`);
    // GDD-GAP: 900 ms presentation beat; the task's authored minutes are charged on completion.
    scene.time.delayedCall(900, () => { settle(task, ready); clock.resume('community-work'); });
  };
  // Dev (G-07): `?work=mail` or `?work=library` runs that job's place prompt once, as pressing E at its place would (the
  // same checks, board and pay), as soon as nothing holds the clock (the morning paper, a scene).
  const devTask = devWork ? COMMUNITY_TASKS.find(t => t.id === devWork) : undefined;
  if (devTask) {
    const once = () => { if (clock.paused || !devWork) return; devWork = null; scene.events.off('update', once); work(devTask); };
    scene.events.on('update', once); scene.events.once('shutdown', () => scene.events.off('update', once));
  }
  return { objects: [hud, bar], interaction: place => {
    if (place === 'old_quarter.lamplighter_cottage') return { label: 'Sleep until morning', run: () => {
      if (clock.paused) return;
      clock.pause('sleep-prompt');
      const style = { fontFamily: FAMILY_BODY, fontSize: '26px', color: '#fff0ce', backgroundColor: '#28372d', padding: { x: 24, y: 20 } };
      const text = scene.add.text(380, 300, 'Turn in for the night?', style);
      let closed = false;
      const finish = (sleep: boolean) => {
        if (closed) return;
        closed = true;
        scene.input.keyboard?.off('keydown', answer);
        scene.events.off('shutdown', cleanup);
        for (const object of [text, yes, no]) object.destroy();
        clock.resume('sleep-prompt');
        if (sleep) finishDay();
      };
      const cleanup = () => finish(false);
      const answer = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'Escape') finish(e.key === 'Enter'); };
      const yes = scene.add.text(380, 375, 'Enter · Sleep', style).setInteractive({ useHandCursor: true }).on('pointerup', () => finish(true));
      const no = scene.add.text(640, 375, 'Esc · Stay up', style).setInteractive({ useHandCursor: true }).on('pointerup', () => finish(false));
      scene.cameras.main.ignore([text, yes, no]);
      scene.events.once('shutdown', cleanup);
      scene.input.keyboard?.resetKeys(); scene.input.keyboard?.on('keydown', answer);
    } };
    if (place === 'market_row.general_store') return { label: 'Browse meals and gifts', run: () => openBag(scene, clock, { shop: true }) };
    // §8 Duck Duty opens only after the pond deduction. GDD-GAP: use the existing work XP convention.
    const duckDuty: CommunityTask = { id:'duck_duty',name:'Duck Duty',place:'commons.duck_pond',opens:6,stamina:4,minutes:15,pay:0,pillar:'spirit',effect:0.2,skill:'heart',xp:10 };
    const task = place === duckDuty.place && puzzleSave(r).entries['PZ-06']?.solved ? duckDuty : COMMUNITY_TASKS.find(t => t.place === place);
    return task ? { label: `${task.name} (${task.stamina} Stamina · ${task.minutes} min · ${task.pay} coins)`, run: () => work(task) } : null;
  } };
}
