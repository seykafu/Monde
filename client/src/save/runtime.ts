import type Phaser from 'phaser';
import { baseSkills, emptyEventLog, migrateSave, type SaveGame } from '@monde/shared';
import { clearFellow, getFellow, setFellow } from '../fellow/state';
import { DEFAULT_PLAYER_NAME, getMind } from '../mind/api';
import { loadQuietState, saveQuietState } from '../mind/prefs';
import { emptyQuietState } from '../mind/quietMode';
import { boards } from '../world/zones';
import { dailyWeather } from '../sim/weather';
import type { Clock } from '../sim/clock';
import type { TownState } from '../town/pillars';
import { collect } from './collect';
import { restore } from './restore';
import { createSaveStorage } from './storage';
import { checkpointSlot, chooseAutosaveSlot } from './slots';
import { quietStorage } from './session';
import { mergeReported } from '../press/report';

export const saveStorage = createSaveStorage();
let capture: (() => ReturnType<typeof collect>) | undefined;
let queue: Promise<unknown> = Promise.resolve();
let dawnSave: SaveGame | undefined;
/** The save this session last wrote or loaded: the one a reload would bring back, so a report amends it (§9.13). */
let lastSave: { slot: string; saved_at: string } | undefined;
export async function finishSaving(): Promise<void> { await queue; }
/** Capture synchronously before networking, serialize writes so simultaneous requests cannot lose a slot. */
export function saveGame(slot: string | null, kind: SaveGame['kind'], label: string): Promise<void> {
  if (!capture) return Promise.reject(new Error('No active game'));
  const save = capture();
  save.kind = kind; save.label = label;
  const work = async () => {
    save.mind = await getMind().createSnapshot(save.clock.day, save.clock.minute, label);
    const target = slot ?? chooseAutosaveSlot(await saveStorage.list());
    await saveStorage.write(target, save);
    lastSave = { slot: target, saved_at: save.saved_at };
    if (kind === 'autosave') dawnSave = save;
    if (kind === 'autosave' && save.clock.day === 70 && save.clock.minute === 360) {
      await saveStorage.write(checkpointSlot('campaign_season'), { ...save, kind: 'checkpoint', label: 'Campaign Season' });
    }
  };
  const result = queue.then(work);
  queue = result.catch(() => undefined);
  return result;
}
/**
 * §9.13: a reported paper item or letter stays withdrawn after a reload too. The dawn autosave (what Continue loads)
 * is written before the morning's paper is read, so the reported keys are merged into the last save written or loaded
 * in place (only that field; the slot must still hold the same save). Every later save carries them anyway.
 */
export function amendLastSave(reported: readonly string[]): Promise<void> {
  const work = async () => {
    const last = lastSave;
    if (!last || !reported.length) return;
    const save = await saveStorage.read(last.slot);
    if (!save || save.saved_at !== last.saved_at || reported.every(k => save.friendship.reported.includes(k))) return;
    await saveStorage.write(last.slot, { ...save, friendship: { ...save.friendship, reported: mergeReported(save.friendship.reported, reported) } });
  };
  const result = queue.then(work);
  queue = result.catch(() => undefined);
  return result;
}
/** Story {checkpoint}: campaign_season always means Day 70 at 06:00, never the later cue time. */
export async function requestCheckpoint(key: string): Promise<void> {
  const slot = checkpointSlot(key);
  if (key !== 'campaign_season') return saveGame(slot, 'checkpoint', key.replaceAll('_', ' '));
  await queue;
  if (await saveStorage.read(slot)) return;
  if (dawnSave?.clock.day === 70 && dawnSave.clock.minute === 360) {
    await saveStorage.write(slot, { ...dawnSave, kind: 'checkpoint', label: 'Campaign Season' });
  }
}
export function resetGame(scene: Phaser.Scene): void {
  for (const key of ['monde.press.pending', 'monde.press.seed', 'monde.save.wakePlayer', 'monde.inventory', 'monde.coins', 'monde.economy', 'monde.riddles', 'monde.puzzles', 'monde.clock', 'monde.town', 'monde.dawnReport', 'monde.residents', 'monde.weatherOverride', 'monde.save.weather', 'monde.story.flags', 'monde.events', 'monde.story.hint', 'monde.story.warned', 'monde.save.playtime', 'monde.save.name', 'monde.friendship', 'monde.dawnTies', 'monde.projects', 'monde.scuffles', 'monde.scuffle.recovery', 'monde.scuffle.offers', 'monde.finale', 'monde.quests', 'monde.quests.objective']) scene.registry.remove(key);
  clearFellow(scene.registry);
  saveQuietState(quietStorage, emptyQuietState());
  capture = undefined; dawnSave = undefined; lastSave = undefined;
}
/** `slot`: where the save came from (a report can then amend it, amendLastSave). */
export async function loadGame(scene: Phaser.Scene, save: SaveGame, slot?: string): Promise<void> {
  const state = restore(save);
  // The districts and the rooms (W-03): a save made indoors restores the player in the room.
  const zone = boards[state.player.zone];
  if (!zone || state.player.x < 0 || state.player.y < 0 || state.player.x >= zone.width || state.player.y >= zone.height) {
    throw new Error('This save refers to an unavailable location');
  }
  await queue;
  await getMind().restoreSnapshot(save.mind);
  scene.scene.stop('Zone');
  resetGame(scene);
  scene.registry.set('monde.puzzles', state.puzzles);
  scene.registry.set('monde.riddles', state.riddles);
  scene.registry.set('monde.scuffles', state.scuffles);
  if (state.projects) scene.registry.set('monde.projects', state.projects);
  if (state.finale) scene.registry.set('monde.finale', state.finale);
  if (state.quests) scene.registry.set('monde.quests', state.quests);
  scene.registry.set('monde.clock', state.clock);
  scene.registry.set('monde.town', state.town);
  scene.registry.set('monde.save.weather', state.weather);
  scene.registry.set('monde.weatherOverride', state.weather.override ?? 'auto');
  scene.registry.set('monde.story.flags', state.story_flags);
  scene.registry.set('monde.events', state.client_events);
  scene.registry.set('monde.save.playtime', state.playtime);
  scene.registry.set('monde.save.name', state.player_name);
  scene.registry.set('monde.inventory', state.inventory);
  scene.registry.set('monde.coins', state.coins);
  scene.registry.set('monde.economy', { ...state.economy, day: state.clock.day });
  setFellow(scene.registry, { ...state.fellow, skills: state.skills });
  // G-13 friendship (scenes/friendship.ts): what the client knew when the game was saved.
  scene.registry.set('monde.friendship', migrateSave(save).friendship);
  if (slot) lastSave = { slot, saved_at: save.saved_at };
  saveQuietState(quietStorage, state.quiet);
  scene.scene.start('Zone', { zone: state.player.zone, savedPlayer: state.player });
}
/** The name the save shows: the signed application's, "Fellow" before it's signed (§11.1), else the device's. */
function saveName(scene: Phaser.Scene): string {
  const named = scene.registry.get('monde.save.name') as string | undefined;
  if (named) return named;
  const fellow = getFellow(scene.registry);
  return fellow && !fellow.profile ? DEFAULT_PLAYER_NAME : getMind().playerName;
}
/** The save's fellow and skills from the registry (fellow/state.ts); none signed yet: no profile, the default look. */
function fellowSection(scene: Phaser.Scene): { fellow: SaveGame['fellow']; skills: SaveGame['skills'] } {
  const fellow = getFellow(scene.registry);
  return { fellow: { profile: fellow?.profile ?? null, look: fellow?.look ?? null }, skills: fellow?.skills ?? baseSkills() };
}
export function attachSaves(scene: Phaser.Scene, clock: Clock, player: () => SaveGame['player'], seed: number, ready: () => boolean = () => true): void {
  let elapsed = (scene.registry.get('monde.save.playtime') as number | undefined) ?? 0;
  const savedWeather = scene.registry.get('monde.save.weather') as SaveGame['weather'] | undefined;
  const take = () => collect({ inventory: scene.registry.get('monde.inventory') as SaveGame['inventory'] | undefined,
    coins: scene.registry.get('monde.coins') as SaveGame['coins'] | undefined, economy: scene.registry.get('monde.economy') as SaveGame['economy'] | undefined, clock, town: scene.registry.get('monde.town') as TownState, player: player(),
    weather: { seed, daily: savedWeather?.daily.day === clock.day ? savedWeather.daily : dailyWeather(seed, clock.day), override: ((scene.registry.get('monde.weatherOverride') === 'auto' ? null : scene.registry.get('monde.weatherOverride')) as SaveGame['weather']['override']) ?? null },
    story_flags: (scene.registry.get('monde.story.flags') as SaveGame['story_flags'] | undefined) ?? {},
    client_events: (scene.registry.get('monde.events') as SaveGame['client_events'] | undefined) ?? emptyEventLog(),
    quiet: loadQuietState(quietStorage), player_name: saveName(scene), playtime: elapsed,
    ...fellowSection(scene),
    puzzles: scene.registry.get('monde.puzzles') as SaveGame['puzzles'] | undefined,
    riddles: scene.registry.get('monde.riddles') as SaveGame['riddles'] | undefined,
    friendship: scene.registry.get('monde.friendship') as SaveGame['friendship'] | undefined,
    scuffles: scene.registry.get('monde.scuffles') as SaveGame['scuffles'] | undefined,
    projects: scene.registry.get('monde.projects') as SaveGame['projects'] | undefined,
    finale: scene.registry.get('monde.finale') as SaveGame['finale'] | undefined,
    quests: scene.registry.get('monde.quests') as SaveGame['quests'] | undefined
  }, 'manual', '');
  capture = take;
  const tick = (_time: number, delta: number) => { elapsed += delta / 1000; player(); };
  scene.events.on('update', tick);
  const off = clock.onDawn(() => {
    // Registered after attachTown: town state is already post-dawn, clock is exactly 06:00.
    void saveGame(null, 'autosave', `Dawn · Day ${clock.day}`).catch(error => console.warn('[save] dawn failed', error));
  });
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.repeat || !ready() || clock.paused || scene.scene.isActive('SaveMenu') || scene.scene.isActive('Dialogue') || scene.scene.isActive('TownLedger')) return;
    scene.scene.launch('SaveMenu');
    scene.scene.pause();
  };
  scene.input.keyboard?.on('keydown', key);
  scene.events.once('shutdown', () => {
    if (scene.registry.get('monde.clock') === clock) scene.registry.set('monde.save.playtime', elapsed);
    scene.events.off('update', tick); scene.input.keyboard?.off('keydown', key); off();
    if (capture === take) capture = undefined;
  });
}
