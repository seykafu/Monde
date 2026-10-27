// The loading screen (client/index.html #loading, in the menus' framed green panel and fonts).
//
//   boot   the page shows it before any code arrives (plain HTML and CSS: the desktop app's CSP allows no inline
//          script): the title's heading over a dusk, the panel with a bar that shimmers while the code downloads, and
//          the title's footer with a rotating line. Once a scene's preload starts the bar is real (loadMeter.ts, the
//          code's bytes counted in), and on the first scene's first frame it fades out into the title or the town.
//   zone   a later load (a district or a room the background fetch hasn't reached, boot/textureFetch.ts) that takes
//          longer than a beat: the panel alone over the faded-out board, "On the way to …", gone on the first frame.
//          Also a player's wait for the town's code (boot/gameCode.ts: New Game before it has arrived), the bar
//          shimmering since a module's download reports no progress; the load that follows carries on from it.
//
// Fades are the zone fade's 400 ms (GDD §16.4), set in index.html's CSS.
import Phaser from 'phaser';
import { LoadMeter, codeBytes, describeBytes, expectedBytes } from './loadMeter';
import { FETCH_SCENE } from './textureFetch';

/** A load done sooner than this shows nothing (a warm door, a district the fetch already brought). */
const BEAT_MS = 250;
/** index.html's #loading transition. */
const FADE_MS = 400;

interface Screen { root: HTMLElement; label: HTMLElement; bar: HTMLElement; fill: HTMLElement; status: HTMLElement }

let found: Screen | null | undefined;
function screen(): Screen | null {
  if (found !== undefined) return found;
  const root = document.getElementById('loading');
  const part = (name: string) => root?.querySelector<HTMLElement>(`[data-part="${name}"]`) ?? null;
  const [label, bar, fill, status] = ['label', 'bar', 'fill', 'status'].map(part);
  found = root && label && bar && fill && status ? { root, label, bar, fill, status } : null;
  return found;
}

/** The page's own screen is still up (no scene has drawn yet). */
let booting = true;
/** The current zone-mode showing, so a newer load's hide doesn't cut an older one short. */
let showing = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
/** Since when the player has waited on the town's code (showCodeWait), for the next load's bar to count it in. */
let codeWaitSince: number | null = null;

function draw(s: Screen, fraction: number, status: string): void {
  s.root.classList.remove('waiting');
  s.fill.style.transform = `scaleX(${fraction.toFixed(4)})`;
  s.bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  s.status.textContent = status;
}

function fadeOut(s: Screen): void {
  s.root.classList.add('out');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { s.root.hidden = true; }, FADE_MS);
}

/**
 * Fade the page's screen out on the game's first frame of a running scene (main.ts; any first scene, tracked or not).
 * Resolves then.
 */
export function endBootOnFirstFrame(game: Phaser.Game): Promise<void> {
  let firstFrame!: () => void;
  const drawn = new Promise<void>(resolve => { firstFrame = resolve; });
  const check = () => {
    // The fetch scene runs from the start but draws nothing.
    if (!game.scene.getScenes(true).some(scene => scene.scene.key !== FETCH_SCENE)) return;
    game.events.off(Phaser.Core.Events.POST_RENDER, check);
    // For measuring the first launch (docs/PERF.md): the moment the player first sees the game.
    performance.mark('monde:first-frame');
    firstFrame();
    const s = screen();
    booting = false;
    if (!s) return;
    draw(s, 1, '');
    fadeOut(s);
    // After the fade it serves later loads in zone mode.
    setTimeout(() => s.root.classList.replace('boot', 'zone'), FADE_MS);
  };
  game.events.on(Phaser.Core.Events.POST_RENDER, check);
  return drawn;
}

/** The game's code didn't arrive (opening straight into the town): say so instead of shimmering on. */
export function bootFailed(): void {
  const s = screen();
  if (!s || !booting) return;
  s.status.textContent = 'Could not fetch the game. Check the connection and reload.';
}

/**
 * A player waiting on the town's code (boot/gameCode.ts): past a beat, the panel with its bar shimmering. Once the code
 * is in, the scene it opens takes the screen over without a blink (trackLoad, the code's bytes counted as done); if it
 * has nothing to load, the screen fades a beat later.
 */
export function showCodeWait<T>(work: Promise<T>): Promise<T> {
  const s = screen();
  if (!s || booting) return work;
  const since = performance.now();
  let id = 0;
  const timer = setTimeout(() => {
    id = ++showing;
    codeWaitSince = since;
    clearTimeout(hideTimer);
    s.root.classList.remove('boot', 'out');
    s.root.classList.add('zone', 'waiting');
    s.label.textContent = 'On the way to Monde';
    s.status.textContent = 'Fetching the town…';
    s.fill.style.transform = 'scaleX(0)';
    s.root.hidden = false;
  }, BEAT_MS);
  const settled = () => {
    clearTimeout(timer);
    if (id) setTimeout(() => { if (id === showing) { codeWaitSince = null; fadeOut(s); } }, BEAT_MS);
  };
  void work.then(settled, settled);
  return work;
}

/**
 * Show a scene's preload on the loading screen: call it first thing in preload, before files are queued. `place` names
 * where the player is going, for the zone-mode heading.
 */
export function trackLoad(scene: Phaser.Scene, place?: string): void {
  const s = screen();
  if (!s) return;
  const load = scene.load, boot = booting;
  // The code the player has waited for (all of it on the first launch; after a wait for the town's, what came in
  // meanwhile) counts as done bytes up front: on a slow link it is most of the wait.
  const since = boot ? 0 : codeWaitSince;
  codeWaitSince = null;
  const meter = new LoadMeter(since === null ? 0 : codeBytes((performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter(e => e.responseEnd >= since)));
  let shown = boot, started = false, done = false, id = 0;
  const update = () => {
    // Not while preload is still queueing: a part-known list would read as nearly done, and the bar never goes back.
    if (!shown || !started) return;
    const { loaded, total } = meter.bytes();
    draw(s, meter.fraction(), total > 0 ? describeBytes(loaded, total) : '');
  };
  load.on(Phaser.Loader.Events.ADD, (key: string, _type: string, _loader: unknown, file: Phaser.Loader.File) => {
    meter.add(key, expectedBytes(typeof file.url === 'string' ? file.url : key));
    update();
  });
  load.on(Phaser.Loader.Events.FILE_PROGRESS, (file: Phaser.Loader.File) => { meter.progress(file.key, file.bytesLoaded, file.bytesTotal); update(); });
  load.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string) => { meter.complete(key); update(); });
  load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => { meter.complete(file.key); update(); });
  load.once(Phaser.Loader.Events.START, () => {
    started = true;
    update();
    if (boot) return;
    const show = () => {
      if (done || scene.sys.settings.status !== Phaser.Scenes.LOADING) return;
      shown = true;
      id = ++showing;
      clearTimeout(hideTimer);
      s.root.classList.remove('boot', 'out', 'waiting');
      s.root.classList.add('zone');
      s.label.textContent = place ? `On the way to ${place}` : 'Loading';
      s.fill.style.transform = 'scaleX(0)';
      s.root.hidden = false;
      update();
    };
    // Still up from the load before (a New Game's hop to the ferry slip): carry straight on, no blink.
    if (!s.root.hidden && !booting) show();
    else setTimeout(show, BEAT_MS);
  });
  load.once(Phaser.Loader.Events.COMPLETE, () => { done = true; update(); });
  // Gone on the scene's first frame (the town fades in under it).
  scene.events.once(Phaser.Scenes.Events.CREATE, () => {
    done = true;
    if (!shown || boot) return;
    scene.game.events.once(Phaser.Core.Events.POST_RENDER, () => { if (id === showing) fadeOut(s); });
  });
}
