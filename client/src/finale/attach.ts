import { surveyAfterReport } from '../scenes/SurveyScene';
// The Spring finale in the world (MVP G-11). ZoneScene calls attachFinale() once per board:
//   - the Bloom Fair: the Commons in fair dress on Days 24–25 (finale/fair.ts: trestles, bunting, barrels, the oil lamps
//     along the sundial path at dusk), the fairgoers booked into Day 25's plans (a ResidentSim plan adjuster, as the
//     Projects book their volunteers), and the `bloom_fair` track on the Commons while the fair is open (the music hold);
//   - the Straw Poll: StoryScene's `strawPoll` presenter (S10c's `{campaign: spring_straw_poll}`) comes here to count it
//     once (finale/take.ts), show the card (scenes/StrawPollScene.ts) and ask the quoted residents for their own words;
//   - the End-of-Spring report: once the morning paper of Day 26 has been read (it prints the poll), the report and then
//     "To be continued" (scenes/SpringReportScene.ts);
//   - dev (`?dev` or a dev build): `window.__finale` (poll, report, fair) and `?spring=<style>` (finale/devPreset.ts).
import Phaser from 'phaser';
import type { SaveGame } from '@monde/shared';
import { getMusic, holdMusic, musicHeld, releaseMusic } from '../audio/Music';
import { ensureDotTexture } from '../render/diorama/Atmosphere';
import { DEPTH, actorDepth } from '../render/depth';
import { DIORAMA_ELEV_STEP, DIORAMA_TILE_H, DIORAMA_TILE_W } from '../render/dioramaConfig';
import type { ObliqueProjection } from '../render/ObliqueProjection';
import type { Clock } from '../sim/clock';
import type { ResidentSim } from '../sim/residentSim';
import { darkness } from '../sim/sunAngle';
import { withShifts, type Shift } from '../sim/volunteers';
import type { StorySession } from '../story/session';
import { flagsOf } from '../projects/runtime';
import { findCard } from '../world/roster';
import type { ZoneDef } from '../world/zoneFormat';
import type { ResidentLayer } from '../scenes/zone/residents';
import { regardFor, townNames } from '../scenes/friendship';
import { getTown } from '../scenes/TownLedgerScene';
import { showStrawPoll } from '../scenes/StrawPollScene';
import { openSpringReport, SPRING_REPORT_SCENE } from '../scenes/SpringReportScene';
import {
  FAIR_DAY, OIL_LAMPS, describeShift, dressingFor, fairAttendees, fairKey, fairMusic, fairPhase, fairShifts, lampsLit,
  type Dressing, type FairPhase
} from './fair';
import { bandOf, voteOutcome, type VoteOutcome } from './poll';
import { quoteBrief } from './quotes';
import { ensureStrawPoll, setQuote } from './take';
import { finaleOf, reportDue } from './state';

type Registry = Phaser.Data.DataManager;
const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const DEV = import.meta.env.DEV || query.has('dev');
/** Overlays the report waits for (and the paper, which comes first). */
const HOLDING = ['Story', 'Dialogue', 'DawnReport', 'TownLedger', 'People', 'SaveMenu', 'Fellowship', 'StrawPoll', SPRING_REPORT_SCENE, 'Scuffle', 'SpringPuzzle', 'Bag', 'ProjectBeat'];
const MUSIC_OWNER = 'bloom_fair';

/** The world seed the client knows (ZoneScene's weather seed: `?seed=`, or the save's). */
export const worldSeedOf = (registry: Pick<Registry, 'get'>): number =>
  (registry.get('monde.save.weather') as SaveGame['weather'] | undefined)?.seed ?? (Number(query.get('seed')) || 1);

const nameOf = (id: string): string => townNames()[id] ?? findCard(id)?.name ?? id;

/**
 * StoryScene's `strawPoll` (S10c): the poll (counted once, then the saved one), its card, and `vote.*` for the script.
 * The quoted residents are asked for their own words while the beans drop; the written lines stand in meanwhile.
 */
export async function openStrawPoll(host: Phaser.Scene, session: StorySession): Promise<VoteOutcome | null> {
  const r = host.registry;
  const finale = ensureStrawPoll(r, id => regardFor(r, id), worldSeedOf(r));
  if (!finale?.poll) return null;
  await showStrawPoll(host, {
    poll: finale.poll, quotes: finale.quotes, name: nameOf,
    ask: async (id, band) => {
      const lines = await session.world?.aiLine(id, quoteBrief(nameOf(id), band)).catch(() => []) ?? [];
      const text = lines.find(l => l.kind === 'say')?.text.trim();
      if (!text || text.length > 220) return null;
      setQuote(r, id, text);
      return text;
    }
  });
  return voteOutcome(finale.poll);
}

// ── The fair's plans ────────────────────────────────────────────────────────

let fairMemo: { day: number; clock: unknown; key: string; shifts: Shift[] } | null = null;
/**
 * Day 25's fairgoers, decided once that day per game (a new or loaded game has a new clock): the band at the first read,
 * S10a's flag if it has played, else Spirit.
 */
function fairPlans(sim: ResidentSim, registry: Registry, day: number): { key: string; shifts: Shift[] } {
  if (day !== FAIR_DAY) return { key: '', shifts: [] };
  const clock = registry.get('monde.clock');
  if (fairMemo?.day === day && fairMemo.clock === clock) return fairMemo;
  const town = getTown(registry);
  const band = bandOf(flagsOf(registry), town?.pillars.spirit ?? 0);
  const seed = worldSeedOf(registry);
  const attendees = fairAttendees(sim.profiles.filter(p => p.kind !== 'animal' || p.id === 'bastien').map(p => p.id), band, seed);
  fairMemo = { day, clock, key: fairKey(band, attendees), shifts: fairShifts(attendees, seed) };
  if (DEV) console.info(`[fair] Day ${day} · ${band} band · ${attendees.length} residents at the fair`);
  return fairMemo;
}
const booked = new WeakSet<ResidentSim>();
function bookFair(sim: ResidentSim, registry: Registry): void {
  if (booked.has(sim)) return;
  booked.add(sim);
  sim.setAdjuster({ key: day => fairPlans(sim, registry, day).key, apply: (plans, day) => withShifts(plans, fairPlans(sim, registry, day).shifts) }, 'festival');
}

// ── The fair's dress ────────────────────────────────────────────────────────

/** The oil lamp on the sundial path: a short post and a glass, drawn once. */
function oilLampTexture(scene: Phaser.Scene): string {
  const key = 'fair-oil-lamp';
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x3b3127).fillRect(5, 10, 2, 16);
  g.fillStyle(0x6e5320).fillRect(2, 24, 8, 3);
  g.fillStyle(0xa67c2e).fillRect(2, 2, 8, 9);
  g.fillStyle(0xffd27a).fillRect(4, 4, 4, 5);
  g.generateTexture(key, 12, 28);
  g.destroy();
  return key;
}

class FairDress {
  private readonly items: { d: Dressing; objs: Phaser.GameObjects.GameObject[] }[] = [];
  private readonly lamps: Phaser.GameObjects.Image[] = [];
  private readonly glows: Phaser.GameObjects.Image[] = [];
  private shown = '';

  constructor(private readonly scene: Phaser.Scene, projection: ObliqueProjection, worldOnly: <T extends Phaser.GameObjects.GameObject>(o: T) => T) {
    const base = (x: number, y: number) => ({ x: (x + 0.5) * DIORAMA_TILE_W, y: y * DIORAMA_TILE_H - projection.elevationAt(x, y) * DIORAMA_ELEV_STEP + DIORAMA_TILE_H / 2 });
    const dot = ensureDotTexture(scene);
    // Every item from the biggest set; refresh() shows the ones the phase and band call for.
    for (const d of dressingFor('fair', 'high')) {
      const key = `town:${d.sprite}`;
      if (!scene.textures.exists(key)) continue;
      const p = base(d.at[0], d.at[1]);
      const overhead = d.sprite === 'bunting';
      const img = worldOnly(scene.add.image(p.x, p.y - (overhead ? 78 : 0), key).setOrigin(0.5, 1).setFlipX(!!d.flip)
        .setDepth(overhead ? DEPTH.UNIT_HUD - 0.5 : actorDepth(p.y) - 1e-6).setVisible(false));
      const objs: Phaser.GameObjects.GameObject[] = [img];
      if (!overhead) {
        const w = Math.min(img.width, 2 * DIORAMA_TILE_W) * 0.8;
        objs.push(worldOnly(scene.add.image(p.x, p.y - 1, dot).setTint(0x000000).setAlpha(0.28).setDisplaySize(w, 8).setDepth(DEPTH.SHADOW - 0.05).setVisible(false)));
      }
      this.items.push({ d, objs });
    }
    const lamp = oilLampTexture(scene);
    for (const [x, y] of OIL_LAMPS) {
      const p = base(x, y);
      this.lamps.push(worldOnly(scene.add.image(p.x, p.y, lamp).setOrigin(0.5, 1).setDepth(actorDepth(p.y) - 1e-6).setVisible(false)));
      // Above the night layer (it has no cut-out for lamps lit after the board was built), under the place labels.
      this.glows.push(worldOnly(scene.add.image(p.x, p.y - 22, dot).setTint(0xffc46b).setBlendMode(Phaser.BlendModes.ADD)
        .setDisplaySize(150, 90).setDepth(DEPTH.DARKNESS + 0.5).setVisible(false)));
    }
  }

  refresh(phase: FairPhase, band: ReturnType<typeof bandOf>, dark: number): void {
    const key = `${phase}:${band}`;
    if (key !== this.shown) {
      this.shown = key;
      const on = new Set(dressingFor(phase, band));
      for (const { d, objs } of this.items) for (const o of objs) (o as Phaser.GameObjects.Image).setVisible(on.has(d));
      for (const l of this.lamps) l.setVisible(lampsLit(phase));
    }
    const glow = lampsLit(phase) ? Math.max(0, Math.min(1, (dark - 0.1) / 0.3)) : 0;
    for (const g of this.glows) g.setVisible(glow > 0.01).setAlpha(0.7 * glow);
  }
}

// ── Attach ──────────────────────────────────────────────────────────────────

export interface FinaleAttachOptions {
  zone: ZoneDef;
  clock: Clock;
  residents: ResidentLayer;
  projection: ObliqueProjection;
  /** True while the zone can't take an overlay (an edge fade under way). */
  busy(): boolean;
}

export function attachFinale(scene: Phaser.Scene, opts: FinaleAttachOptions): void {
  const { zone, clock } = opts;
  const registry = scene.registry;
  bookFair(opts.residents.sim, registry);
  const ui = scene.cameras.cameras[1];
  const worldOnly = <T extends Phaser.GameObjects.GameObject>(o: T): T => { ui?.ignore(o); return o; };
  const dress = zone.id === 'commons' ? new FairDress(scene, opts.projection, worldOnly) : null;
  let held = false;
  const release = () => { if (held) { held = false; releaseMusic(scene, MUSIC_OWNER); } };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, release);

  let at = 0;
  const tick = (time: number) => {
    if (time - at < 400) return;
    at = time;
    const { day, minute } = clock;
    const phase = fairPhase(day, minute);
    if (dress) dress.refresh(phase, bandOf(flagsOf(registry), getTown(registry)?.pillars.spirit ?? 0), darkness(day, minute));
    // The fair's music: held while the fair is open on the Commons. A story scene plays its own cue meanwhile.
    if (fairMusic(zone.id, day, minute)) {
      if (!held) { held = true; holdMusic(scene, MUSIC_OWNER); }
      const music = getMusic(scene);
      if (!scene.scene.isActive('Story') && music.currentTrack !== 'bloom_fair') music.play('bloom_fair');
    } else if (held) {
      release();
      if (!musicHeld(scene)) getMusic(scene).stop(1500);
    }
    // The End-of-Spring report, once the morning's paper (with the poll) has been read.
    if (reportDue(registry, day) && !opts.busy() && !clock.paused && !registry.get('monde.press.pending')
      && !HOLDING.some(key => scene.scene.isActive(key))) {
      ensureStrawPoll(registry, id => regardFor(registry, id), worldSeedOf(registry));
      openSpringReport(scene, clock);
      surveyAfterReport(scene, clock);
    }
  };
  scene.events.on('update', tick);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off('update', tick));
  if (DEV) installDevTools(scene, opts);
}

function installDevTools(scene: Phaser.Scene, opts: FinaleAttachOptions): void {
  const r = scene.registry;
  Object.assign(window as unknown as Record<string, unknown>, {
    __finale: {
      state: () => finaleOf(r),
      /** Count the Straw Poll now (or show the one counted). */
      poll: () => ensureStrawPoll(r, id => regardFor(r, id), worldSeedOf(r))?.poll ?? null,
      /** Open the End-of-Spring report now. */
      report: () => openSpringReport(scene, opts.clock),
      /** Today's fair plans. */
      fair: () => fairPlans(opts.residents.sim, r, opts.clock.day).shifts.map(describeShift)
    }
  });
}
