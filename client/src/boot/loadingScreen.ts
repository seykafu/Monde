// The loading screen (client/index.html #loading, in the menus' framed green panel and fonts).
//
//   boot   the page shows it before any code arrives (plain HTML and CSS: the desktop app's CSP allows no inline
//          script): the title's heading over a dusk, the panel with a bar that shimmers while the code downloads, and
//          the title's footer with a rotating line. Once a scene's preload starts the bar is real (loadMeter.ts, the
//          code's bytes counted in), and on the first scene's first frame it fades out into the title or the town.
//   zone   a later load (a district or a room the background fetch hasn't reached, boot/textureFetch.ts) that takes
//          longer than a beat: the panel alone over the faded-out board, "On the way to …", gone on the first frame.
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

/** Fade the page's screen out on the game's first frame of a running scene (main.ts; any first scene, tracked or not). */
export function endBootOnFirstFrame(game: Phaser.Game): void {
  const check = () => {
    // The fetch scene runs from the start but draws nothing.
    if (!game.scene.getScenes(true).some(scene => scene.scene.key !== FETCH_SCENE)) return;
    game.events.off(Phaser.Core.Events.POST_RENDER, check);
    // For measuring the first launch (docs/PERF.md): the moment the player first sees the game.
    performance.mark('monde:first-frame');
    const s = screen();
    booting = false;
    if (!s) return;
    draw(s, 1, '');
    fadeOut(s);
    // After the fade it serves later loads in zone mode.
    setTimeout(() => s.root.classList.replace('boot', 'zone'), FADE_MS);
  };
  game.events.on(Phaser.Core.Events.POST_RENDER, check);
}

/**
 * Show a scene's preload on the loading screen: call it first thing in preload, before files are queued. `place` names
 * where the player is going, for the zone-mode heading.
 */
export function trackLoad(scene: Phaser.Scene, place?: string): void {
  const s = screen();
  if (!s) return;
  const load = scene.load, boot = booting;
  const meter = new LoadMeter(boot ? codeBytes(performance.getEntriesByType('resource') as PerformanceResourceTiming[]) : 0);
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
