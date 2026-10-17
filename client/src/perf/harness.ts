import type { ZoneScene } from '../scenes/ZoneScene';
import type { ResidentLayer } from '../scenes/zone/residents';
import type { ZoneDef } from '../world/zoneFormat';
import { boards, zones, interiors } from '../world/zones';
import { frameStatistics } from './statistics';
import { crowdRoutes, sampleCrowdRoute } from './placement';
import { personaCards, rosterParseMs } from '../world/residents';

const query = new URLSearchParams(location.search);
const report = {
  version: 1, createdAt: new Date().toISOString(), userAgent: navigator.userAgent,
  viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
  targets: { fps: 60, visibleResidents: 60, zoneLoadMs: 1500, memoryBytes: 1_500_000_000 },
  /** The resident roster read at boot (MVP M-03: 212 cards once the census is written), and how long it took. */
  roster: { cards: personaCards.length, parseMs: Math.round(rosterParseMs * 10) / 10 },
  zoneLoads: [] as { zone: string; kind: string; ms: number; boundary: string }[],
  captures: [] as Capture[],
};
function heap() {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return memory ? { usedBytes: memory.usedJSHeapSize, totalBytes: memory.totalJSHeapSize, limitBytes: memory.jsHeapSizeLimit } : null;
}
type Capture = ReturnType<typeof frameStatistics> & {
  zone: string; requestedMs: number; wallMs: number; crowd: number; minVisibleCrowd: number;
  valid: boolean; invalidReasons: string[]; heapStart: ReturnType<typeof heap>; heapEnd: ReturnType<typeof heap>;
};
let current: { scene: ZoneScene; zone: ZoneDef; spawn: (count: number) => void; count: () => number; visible: () => number } | undefined;
let capturing = false, touring = false, autoStarted = false;
const publish = () => console.log('[perf] ' + JSON.stringify(report));

/** Measure actual render intervals, never Phaser's smoothed/clamped simulation delta. */
function capture(durationMs = 20_000): Promise<Capture> {
  if (!current) return Promise.reject(new Error('Enter a zone first'));
  if (capturing) return Promise.reject(new Error('A capture is already running'));
  if (!Number.isFinite(durationMs) || durationMs < 100 || durationMs > 300_000) return Promise.reject(new RangeError('Capture duration: 100–300000 ms'));
  capturing = true;
  const host = current, frames: number[] = [], reasons = new Set<string>();
  const started = performance.now(), heapStart = heap();
  let previous: number | undefined, minVisible = host.count();
  if (document.hidden) reasons.add('document hidden');
  return new Promise(resolve => {
    const hidden = () => { if (document.hidden) reasons.add('document hidden'); };
    const shutdown = () => { reasons.add('zone changed'); finish(); };
    const finish = () => {
      clearTimeout(timeout);
      host.scene.game.events.off('postrender', frame);
      host.scene.events.off('shutdown', shutdown);
      document.removeEventListener('visibilitychange', hidden);
      if (!frames.length) reasons.add('no rendered frame intervals');
      if (minVisible < host.count()) reasons.add('crowd left camera view');
      const result: Capture = {
        ...frameStatistics(frames), zone: host.zone.id, requestedMs: durationMs, wallMs: performance.now() - started,
        crowd: host.count(), minVisibleCrowd: minVisible, valid: !reasons.size, invalidReasons: [...reasons], heapStart, heapEnd: heap(),
      };
      report.captures.push(result); capturing = false; publish(); resolve(result);
    };
    const frame = () => {
      const now = performance.now();
      minVisible = Math.min(minVisible, host.visible());
      if (previous !== undefined && now > previous) frames.push(now - previous);
      previous = now;
      if (now - started >= durationMs) finish();
    };
    const timeout = setTimeout(() => { reasons.add('render timeout'); finish(); }, durationMs + 5000);
    document.addEventListener('visibilitychange', hidden);
    host.scene.events.once('shutdown', shutdown);
    host.scene.game.events.on('postrender', frame);
  });
}

/** A warm-up before sampling avoids counting actor texture creation as steady-state rendering. */
const warmup = () => new Promise<void>(resolve => setTimeout(resolve, 1500));
async function tour(count = 60, durationMs = 20_000) {
  if (touring || capturing) throw new Error('A tour or capture is already running');
  if (!current) throw new Error('Enter a zone first');
  touring = true;
  try {
    for (const id of [...Object.keys(zones), Object.keys(interiors)[0]!]) {
      const scene = current!.scene;
      await new Promise<void>((resolve, reject) => {
        const done = (zone: string) => { if (zone === id) { clearTimeout(timeout); scene.game.events.off('perf.ready', done); resolve(); } };
        const timeout = setTimeout(() => { scene.game.events.off('perf.ready', done); reject(new Error(`Zone ${id} did not render within 15 s`)); }, 15_000);
        scene.game.events.on('perf.ready', done);
        scene.transitionTo(id);
      });
      current!.spawn(count);
      await warmup();
      await capture(durationMs);
    }
    return report;
  } finally { touring = false; }
}

export function attachPerf(scene: ZoneScene, residents: ResidentLayer, zone: ZoneDef, createStarted: number, firstFrame: Promise<number>): void {
  let crowd: ReturnType<ResidentLayer['perfActors']> | undefined;
  let count = 0, visible = 0, elapsed = 0, stopped = false;
  let routes: ReturnType<typeof crowdRoutes> = [];
  const spawn = (wanted: number) => {
    if (capturing) throw new Error('Wait for the current capture before changing crowd size');
    // Validate placement before allocating sprites, and leave the prior crowd intact on failure.
    const probe = residents.perfActors(0);
    const next = crowdRoutes(zone.walkability, wanted, probe.visible);
    crowd?.destroy();
    crowd = residents.perfActors(wanted); routes = next; count = wanted; visible = 0; elapsed = 0;
  };
  const update = (_time: number, dt: number) => {
    if (!crowd || !count) return;
    elapsed += dt;
    visible = crowd.draw(routes.map((route, index) => {
      const { at, dir } = sampleCrowdRoute(route, elapsed, index);
      return { id: `perf-${index}`, zone: zone.id, position: at, tile: [Math.floor(at.x), Math.floor(at.y)],
        activity: 'walk', place: 'perf', traveling: null, visible: true, moving: true, facing: dir,
        block: 0, path: null, target: null };
    }), dt);
  };
  current = { scene, zone, spawn, count: () => count, visible: () => visible };
  Object.assign(window, {
    __perfReport: report,
    __perf: {
      capture,
      spawn: (n: number) => current!.spawn(n),
      zone: (id: string) => { if (!boards[id]) throw new Error(`Unknown zone: ${id}`); current!.scene.transitionTo(id); },
      zones: Object.keys(boards), tour, print: publish,
    },
  });
  const firstRender = (renderedAt: number) => {
    if (stopped) return;
    const transition = scene.registry.get('perf.transition') as { zone: string; started: number } | undefined;
    const matched = transition?.zone === zone.id;
    report.zoneLoads.push({ zone: zone.id, kind: zone.interior ? 'interior' : 'district',
      ms: renderedAt - (matched ? transition.started : createStarted),
      boundary: matched ? 'transition-to-first-render' : 'create-to-first-render (initial entry; excludes preload)',
    });
    scene.registry.remove('perf.transition');
    publish();
    scene.game.events.emit('perf.ready', zone.id);
    if (query.has('crowd') && !touring) spawn(Number(query.get('crowd')));
    if (!autoStarted && query.has('crowd')) {
      autoStarted = true;
      void warmup().then(() => { if (!stopped && !touring && !capturing) return capture(); }).catch(error => console.error('[perf]', error));
    }
  };
  scene.events.on('postupdate', update);
  void firstFrame.then(firstRender).catch(error => console.error('[perf]', error));
  scene.events.once('shutdown', () => {
    stopped = true;
    scene.events.off('postupdate', update);
    // Phaser destroys scene objects; just drop our references.
    crowd = undefined;
    if (current?.scene === scene) current = undefined;
  });
}
