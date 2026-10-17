// The Projects on the board (GDD §6.3, MVP G-03): ZoneScene calls attachProjects() in create() and update() every frame.
//
// - At a Project's site, E does its next thing: hand over materials, work a shift (10 Stamina, an hour), open it when
//   its ceremony is due; at a vacant house it starts a `homes` restoration; in the Town Hall, with Pell in, it asks her
//   to sign. Beside a resident, H asks about the Projects: lend a hand tomorrow, give toward a short Fund, give a
//   material they have, or (Pell) sign the chit. Answers play as a short beat (projects/BeatScene.ts).
// - Volunteers are booked into residents' plans through ResidentSim's plan adjuster (sim/volunteers.ts): they walk to
//   the site at their shift and work there, a hammer going and dust coming up, so the player can watch.
// - Kasimir's chalk plank stands at each site (S04: FUND, PARTS, HANDS) with the Project's three columns.
// - The opening: when it's due and the player is at the site, the lead's lines play over the street, bunting goes up,
//   the faded art swaps to restored at the reveal, confetti, a chime and applause; the next Dawn Report leads with it.
// - Dev (dev builds or ?dev): `window.__projects` gives coins, items and Fund, skips to the next dawn, fills a
//   Project, solves PZ-01 from its known solution, starts an opening, and lists the state.
import Phaser from 'phaser';
import { Inventory, Wallet, type SaveGame } from '@monde/shared';
import { playSfx, sfxCineChime } from '../audio/Sfx';
import { itemById } from '../economy/content';
import { addItem } from '../economy/inventory';
import { getMind, uuid } from '../mind/api';
import { talkContext } from '../mind/context';
import { completePuzzle } from '../puzzles/runtime';
import { puzzles } from '../puzzles/catalog';
import { solution as PZ01_SOLUTION } from '../puzzles/PZ-01';
import { DEPTH, actorDepth } from '../render/depth';
import { DIORAMA_ELEV_STEP, DIORAMA_FOOT_DY, DIORAMA_TILE_H, DIORAMA_TILE_W } from '../render/dioramaConfig';
import type { ObliqueProjection } from '../render/ObliqueProjection';
import type { Clock } from '../sim/clock';
import { formatClock } from '../sim/clock';
import { withShifts } from '../sim/volunteers';
import type { ResidentSim } from '../sim/residentSim';
import type { WeatherNow } from '../sim/weather';
import { liveLine } from '../story/live';
import type { StoryHint } from '../story/hint';
import { homeDirectory } from '../world/homes';
import { homeKey, homeKind, isOccupied } from '../town/occupancy';
import { nearbyPlace, placeName, type Position } from '../world/player';
import { districtOf, type ZoneDef } from '../world/zoneFormat';
import { zones } from '../world/zones';
import { FAMILY_BODY, FAMILY_UI, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import { regardFor } from '../scenes/friendship';
import type { ResidentLayer } from '../scenes/zone/residents';
import { playBeat, PROJECT_BEAT, type BeatStep } from './BeatScene';
import { isPlural } from './press';
import { PROJECTS, PROJECT_CONTENT } from './catalog';
import * as E from './engine';
import {
  PROJECTS_KEY, askForDonation, askForHelp, askForMaterial, capitalize, donateOwnCoins, flagsOf, handOverAt, houseName, isTinkerer,
  lineVars, materialCount, materialNoun, openProject, projectName, projectsDawn, projectsOf, residentName, shiftsFor, signWithPell,
  siteFor, sitePlaceName, startHouse, syncProjects, workAt, worldOf
} from './runtime';
import { fillLine, type ProjectDef } from './schema';
import { inArea, type Site } from './site';

export interface Interaction { label: string; run(): void }

export interface ProjectsAttachOptions {
  zone: ZoneDef;
  clock: Clock;
  residents: ResidentLayer;
  projection: ObliqueProjection;
  position(): Position;
  weather(): WeatherNow;
  toast(text: string): void;
  /** Swap the board's faded/restored art now (ZoneScene: TownBoard.refresh with the current look). */
  refreshBoard(): void;
  /** The zone can't take an interaction (an edge fade). */
  busy(): boolean;
}

export interface ProjectsAttachment {
  /** E at a place: the Project's next thing (with `alternative`, the place's own job, as a choice). */
  interaction(place: string, alternative: Interaction | null): Interaction | null;
  /** H beside a resident: ask about the Projects (null when there's nothing to ask them). */
  ask(residentId: string): Interaction | null;
  /** An opening set for today, as the HUD's Next hint (the story's own hint comes first). */
  hint(): StoryHint | null;
  update(dtMs: number): void;
}

type Registry = Phaser.Data.DataManager;
/** Overlays that hold the world: an opening waits for them. */
const HOLDING = ['Story', 'Dialogue', 'TownLedger', 'People', 'SaveMenu', 'Fellowship', 'Bag', 'Puzzle', 'DawnReport', PROJECT_BEAT];
const query = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
const DEV = import.meta.env.DEV || query.has('dev');
const hhmm = (m: number): string => formatClock(m);

// ── Once per clock: the dawn ────────────────────────────────────────────────

const dawnAttached = new WeakSet<Clock>();
/**
 * The Projects' dawn pass on every dawn of this clock: after the town's (attachTown) and before the Dawn Report
 * (attachDawnSync), so last night's credited hours and this morning's openings are in the paper. Once per clock.
 */
export function attachProjectsClock(registry: Registry, clock: Clock): void {
  if (dawnAttached.has(clock)) return;
  dawnAttached.add(clock);
  if (!registry.has(PROJECTS_KEY)) registry.set(PROJECTS_KEY, projectsOf(registry));
  clock.onDawn(t => { projectsDawn(registry, { day: t.day, minute: t.minute }); });
  // A board solved anywhere (a scene's {puzzle}, a place prompt) is a Project's puzzle step: bring the Projects up to
  // now at once, so the clocktower opens with S07a's chime (not at the next dawn) and an opening is set the same hour.
  const onPuzzles = () => {
    if (registry.get('monde.clock') !== clock) { registry.events.off('changedata-monde.puzzles', onPuzzles); return; }
    syncProjects(registry, { day: clock.day, minute: clock.minute });
  };
  registry.events.on('changedata-monde.puzzles', onPuzzles);
  syncProjects(registry, { day: clock.day, minute: clock.minute });
}

// ── The residents' plans ────────────────────────────────────────────────────

const adjusted = new WeakSet<ResidentSim>();
/** Book the day's site shifts into the residents' plans (once per sim; it reads the registry's state each day). */
export function installShifts(sim: ResidentSim, registry: Registry): void {
  if (adjusted.has(sim)) return;
  adjusted.add(sim);
  sim.setAdjuster({ key: day => shiftsFor(registry, day).key, apply: (plans, day) => withShifts(plans, shiftsFor(registry, day).shifts) });
}

// ── Textures ────────────────────────────────────────────────────────────────

function hammerTexture(scene: Phaser.Scene): string {
  const key = 'project-hammer';
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x7b5534).fillRect(5, 4, 2, 11);
  g.fillStyle(0x4a4f57).fillRect(1, 1, 10, 4);
  g.fillStyle(0x9aa3ad).fillRect(1, 1, 10, 1);
  g.generateTexture(key, 12, 16);
  g.destroy();
  return key;
}

function dotTexture(scene: Phaser.Scene, key: string, color: number, w: number, h: number): string {
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(color).fillRect(0, 0, w, h);
  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}

const CONFETTI = [0xe69f00, 0x56b4e9, 0x009e73, 0xf0e442, 0xcc79a7, 0xd55e00, 0xfff0ce];
const BUNTING = [0xc0504d, 0xe4c77f, 0x5b8fb9, 0xfff0ce, 0x6aa86a];

// ── The attachment ──────────────────────────────────────────────────────────

interface SiteArt { id: string; plank: Phaser.GameObjects.Container; text: Phaser.GameObjects.Text; key: string }
interface Worker { hammer: Phaser.GameObjects.Image; phase: number; nextDust: number }

export function attachProjects(scene: Phaser.Scene, opts: ProjectsAttachOptions): ProjectsAttachment {
  const { zone, clock, residents, projection } = opts;
  const registry = scene.registry;
  // In a room (W-03) the Projects are its district's: E at the site's place inside, the opening in the room. The
  // work areas for room sites are authored in room coordinates.
  const district = districtOf(zone), indoor = !!zone.interior;
  /** A site as this board has it: indoors its work area is the room's place (where the crowd gathers for an opening). */
  const onBoard = (site: Site): Site => {
    if (!indoor) return site;
    const local = site.place.slice(site.place.indexOf('.') + 1);
    const rect = (zone.places.find(p => p.id === local) ?? zone.places[0])?.rect;
    return rect ? { ...site, work: { ...site.work, area: rect } } : site;
  };
  attachProjectsClock(registry, clock);
  installShifts(residents.sim, registry);
  const now = () => ({ day: clock.day, minute: clock.minute });
  const world = () => worldOf(registry, now());
  const ui = scene.cameras.cameras[1];
  const worldOnly = <T extends Phaser.GameObjects.GameObject>(o: T): T => { ui?.ignore(o); return o; };
  const uiOnly = <T extends Phaser.GameObjects.GameObject>(o: T): T => { scene.cameras.main.ignore(o); return o; };

  /** Continuous tile → the world pixel where feet stand (as the residents layer draws them). */
  const feet = (x: number, y: number) => ({
    x: projection.originX + x * DIORAMA_TILE_W,
    y: projection.originY + y * DIORAMA_TILE_H - projection.elevationAt(Math.floor(x), Math.floor(y)) * DIORAMA_ELEV_STEP + DIORAMA_FOOT_DY
  });

  const here = (): { id: string; def: ProjectDef; progress: E.Progress; site: Site }[] =>
    E.begun(PROJECTS, projectsOf(registry)).flatMap(b => {
      const site = siteFor(b.def, b.progress);
      return site && site.zone === district ? [{ ...b, site }] : [];
    });

  // ── Beats ─────────────────────────────────────────────────────────────────

  const beat = (steps: BeatStep[], onClose?: () => void, ceremony = false): void => {
    if (!playBeat(scene, { clock, steps, ceremony, ...(onClose ? { onClose } : {}) })) return;
  };
  const say = (speaker: string, text: string, expr?: string): BeatStep => ({ kind: 'line', speaker, text, ...(expr ? { expr } : {}) });
  const live = (resident: string, brief: string): BeatStep[] => {
    const mind = getMind();
    if (!mind.enabled) return [];
    return [{ kind: 'live', speaker: resident, fetch: async () => {
      const lines = await liveLine(mind, { residentId: resident, brief, context: talkContext({ day: clock.day, minute: clock.minute, state: residents.stateOf(resident), zone, weather: opts.weather() }) }, { conversationId: uuid() });
      return lines[0]?.text ?? null;
    } }];
  };

  /** Pell's sign-off (§6.3 step 2): her line, Sign it / Not yet, or what's short and the player's own coins. */
  const signoffBeat = (id: string): void => {
    const def = E.defOf(PROJECTS, id), p = projectsOf(registry).projects[id];
    if (!def || !p) return;
    const town = registry.get('monde.town') as { fund: number };
    const vars = lineVars(def, p, town);
    const name = projectName(def, p);
    const signed = (): BeatStep[] => {
      const result = signWithPell(registry, now(), id);
      if (!result.ok) return [say('pell', result.line, 'worried')];
      playSfx('stamp_thud');
      opts.toast(`${capitalize(name)} ${isPlural(name) ? 'are' : 'is'} funded: ${def.fund} coins from the Town Fund.`);
      return [say('pell', result.line, 'warm'), ...live('pell', `The Fellow just had you sign the Town Fund chit for ${name}: ${def.fund} coins. One line, in your own words.`)];
    };
    const offer = (): BeatStep[] => {
      const t = registry.get('monde.town') as { fund: number };
      const short = Math.max(0, def.fund - t.fund);
      if (short === 0) return [{ kind: 'choice', choices: [{ label: 'Sign it', run: signed }, { label: 'Not yet', run: () => [say('pell', fillLine(PROJECT_CONTENT.pell.wait, vars))] }] }];
      const wallet = Wallet.parse(registry.get('monde.coins') ?? {}).balance;
      const own = Math.min(wallet, short);
      return [say('pell', fillLine(PROJECT_CONTENT.pell.short, lineVars(def, p, t)), 'worried'), { kind: 'choice', choices: [
        ...(own > 0 ? [{ label: `Put in ${own} of your own coins`, run: (): BeatStep[] => {
          const coins = donateOwnCoins(registry, id);
          playSfx('coin');
          return [say('narrator', `You count ${coins} coins into the Fund tin. Pell writes it down.`), ...offer()];
        } }] : []),
        { label: "I'll raise it", run: () => [say('pell', 'Ask the ones who can spare it, dear. Not the ones who would anyway.')] }
      ] }];
    };
    beat([say('pell', fillLine(def.signoff.line ?? `${capitalize(name)}. ${def.fund} from the Fund.`, vars), 'thinking'), ...offer()]);
  };

  const askHelpBeat = (id: string, resident: string): void => {
    const def = E.defOf(PROJECTS, id);
    if (!def) return;
    const name = projectName(def, projectsOf(registry).projects[id]);
    const answer = askForHelp(registry, now(), id, resident, regardFor(registry, resident));
    const site = siteFor(def, projectsOf(registry).projects[id]);
    const shift = E.shiftOf(def, PROJECT_CONTENT.shift);
    beat([say('narrator', `You ask ${residentName(resident)} if they could lend a hand with ${name}.`),
      say(resident, answer.line, answer.verdict === 'yes' ? 'warm' : 'neutral')], () => {
      if (answer.verdict === 'yes' && site) opts.toast(`${residentName(resident)} will be at ${sitePlaceName(site.place)} tomorrow, ${hhmm(shift.start)}–${hhmm(shift.end)}.`);
    });
  };

  const donationBeat = (id: string, resident: string): void => {
    const def = E.defOf(PROJECTS, id);
    if (!def) return;
    const result = askForDonation(registry, id, resident, regardFor(registry, resident));
    if (result.verdict === 'given') playSfx('coin');
    beat([say('narrator', `You ask ${residentName(resident)} for something toward ${projectName(def, projectsOf(registry).projects[id])}.`),
      say(resident, result.line, result.verdict === 'given' ? 'warm' : 'neutral')], () => {
      if (result.verdict === 'given') opts.toast(`${residentName(resident)} gave ${result.coins} coins to the Town Fund.`);
    });
  };

  const materialBeat = (id: string, resident: string): void => {
    const def = E.defOf(PROJECTS, id);
    if (!def) return;
    const result = askForMaterial(registry, now(), id, resident, regardFor(registry, resident));
    const text = result.verdict === 'given' ? result.line : result.verdict === 'low_regard' ? "I'd want to know who's asking, first." : "There's nothing left of that to give.";
    beat([say(resident, text, result.verdict === 'given' ? 'warm' : 'neutral'),
      ...(result.verdict === 'given' && result.item ? [say('narrator', `${residentName(resident)} gives you ${materialCount(result.item, result.count)}.`)] : [])]);
  };

  // ── The opening ───────────────────────────────────────────────────────────

  let ceremonyOn = false;
  const decorations: Phaser.GameObjects.GameObject[] = [];
  const presentAt = (site: Site): string[] => residents.sim.profiles.map(p => p.id).filter(id => {
    const s = residents.stateOf(id);
    return !!s?.position && s.zone === zone.id && !s.traveling && inArea(onBoard(site).work.area, s.position, 3);
  });

  const bunting = (site: Site): void => {
    const [x0, y0, w, h] = site.work.area;
    // Two strings of pennants: across the back of the site and across the front, where the crowd comes in.
    const strings = [[y0 + 0.2, 64], [y0 + h - 0.4, 54]] as const;
    const g = worldOnly(scene.add.graphics().setDepth(DEPTH.ATMOSPHERE - 0.5));
    const flags = Math.max(7, Math.round(w * 2));
    let sway = 0;
    const draw = () => {
      g.clear();
      for (const [row, lift] of strings) {
        const a = feet(x0 + 0.1, row), b = feet(x0 + w - 0.1, row);
        const sag = 16 + Math.sin(sway) * 2;
        const at = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y - lift + (b.y - a.y) * t + sag * 4 * t * (1 - t) });
        g.lineStyle(1.5, 0x5a4632, 0.9).beginPath();
        for (let i = 0; i <= 24; i++) { const p = at(i / 24); if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); }
        g.strokePath();
        for (let i = 0; i < flags; i++) {
          const t = (i + 0.5) / flags, p = at(t - 0.3 / flags), q = at(t + 0.3 / flags);
          const flutter = Math.sin(sway * 1.7 + i + row) * 2;
          g.fillStyle(BUNTING[i % BUNTING.length]!, 1).fillTriangle(p.x, p.y, q.x, q.y, (p.x + q.x) / 2 + flutter, (p.y + q.y) / 2 + 12);
        }
      }
    };
    draw();
    const timer = scene.time.addEvent({ delay: 60, loop: true, callback: () => { sway += 0.08; draw(); } });
    decorations.push(g);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => timer.remove());
  };

  const confetti = (site: Site): void => {
    const [x0, y0, w, h] = site.work.area;
    const c = feet(x0 + w / 2, y0 + h / 2);
    const keys = CONFETTI.map((color, i) => dotTexture(scene, `confetti-${i}`, color, 5, 7));
    const spread = w * DIORAMA_TILE_W * 0.55, depth = h * DIORAMA_TILE_H * 0.5;
    for (let i = 0; i < 160; i++) {
      const bit = worldOnly(scene.add.image(c.x + Phaser.Math.Between(-spread * 0.4, spread * 0.4), c.y - 30, keys[i % keys.length]!).setDepth(DEPTH.ATMOSPHERE - 0.4));
      bit.setAngle(Math.random() * 360).setScale(0.8 + Math.random() * 0.5);
      // Up in a burst over the site, then a slow tumble down across it.
      scene.tweens.add({
        targets: bit, y: c.y - 120 - Math.random() * 110, x: c.x + Phaser.Math.Between(-spread, spread), duration: 450 + Math.random() * 350, ease: 'Quad.easeOut',
        onComplete: () => scene.tweens.add({
          targets: bit, y: c.y + Phaser.Math.Between(-depth, depth), x: bit.x + Phaser.Math.Between(-40, 40), angle: bit.angle + Phaser.Math.Between(-540, 540),
          scaleY: { from: bit.scaleY, to: bit.scaleY * 0.4 }, yoyo: false, duration: 2600 + Math.random() * 2200, ease: 'Sine.easeIn',
          onComplete: () => scene.tweens.add({ targets: bit, alpha: 0, delay: 3000, duration: 900, onComplete: () => bit.destroy() })
        })
      });
    }
  };

  const startCeremony = (id: string): void => {
    const def = E.defOf(PROJECTS, id), p = projectsOf(registry).projects[id];
    const site = def && p ? siteFor(def, p) : null;
    if (!def || !p || !site || ceremonyOn) return;
    ceremonyOn = true;
    const vars = lineVars(def, p);
    const present = presentAt(site);
    let opened: ReturnType<typeof openProject> | null = null;
    const reveal = () => {
      if (opened) return;
      opened = openProject(registry, now(), id, present);
      opts.refreshBoard();
      confetti(onBoard(site));
      sfxCineChime();
      scene.time.delayedCall(250, () => playSfx('applause_warm'));
      scene.time.delayedCall(900, () => playSfx('cheer_small'));
    };
    bunting(onBoard(site));
    playSfx('murmur');
    const lead = def.leads[0]!;
    const steps: BeatStep[] = [];
    for (const line of def.ceremony.lines) {
      steps.push({ kind: 'line', speaker: line.speaker, text: fillLine(line.text, vars), ...(line.expr ? { expr: line.expr } : {}), ...(line.reveal ? { onShow: reveal } : {}) });
      if (line.reveal) steps.push(...live(lead, `${capitalize(projectName(def, p))} has just opened in front of the crowd at ${sitePlaceName(site.place)}. Say one line to them.`));
    }
    beat(steps, () => {
      ceremonyOn = false;
      reveal();
      const gains = Object.entries(opened?.pillars ?? {}).filter(([, v]) => v).map(([k, v]) => `${capitalize(k)} +${v}`).join(' · ');
      const named = projectName(def, p);
      opts.toast(`${capitalize(named)} ${isPlural(named) ? 'are' : 'is'} open${gains ? ` · ${gains}` : ''}.`);
    }, true);
  };

  // ── E at a place ──────────────────────────────────────────────────────────

  const chooser = (title: string, options: readonly Interaction[]): Interaction => ({
    label: options.length === 1 ? options[0]!.label : `${title} (${options.length} things to do)`,
    run: () => {
      if (options.length === 1) { options[0]!.run(); return; }
      if (clock.paused) return;
      clock.pause('project-choice');
      scene.input.keyboard?.resetKeys();
      const objects: Phaser.GameObjects.GameObject[] = [];
      let done = false;
      const finish = (then?: () => void) => {
        if (done) return;
        done = true;
        scene.input.keyboard?.off('keydown', key);
        objects.forEach(o => o.destroy());
        clock.resume('project-choice');
        then?.();
      };
      const key = (e: KeyboardEvent) => {
        if (e.repeat) return;
        const n = Number(e.key);
        if (n >= 1 && n <= options.length) finish(options[n - 1]!.run);
        else if (e.key === 'Escape') finish();
      };
      const button = (y: number, label: string, run: () => void) => {
        const t = uiOnly(scene.add.text(GAME_WIDTH / 2, y, label, { fontFamily: FAMILY_BODY, fontSize: '21px', color: '#3d4637', backgroundColor: '#f3e7c9', padding: { x: 20, y: 12 }, wordWrap: { width: 720 }, resolution: RENDER_SCALE })
          .setOrigin(0.5, 0).setInteractive({ useHandCursor: true }).on('pointerup', run).setDepth(10000));
        objects.push(t);
      };
      options.forEach((o, i) => button(200 + i * 70, `${i + 1} · ${o.label}`, () => finish(o.run)));
      button(200 + options.length * 70 + 20, 'Esc · Another time', () => finish());
      scene.input.keyboard?.on('keydown', key);
      scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => finish());
    }
  });

  const pellIn = (): boolean => {
    const s = residents.sim.sample('pell', clock.day, clock.minute);
    return !!s && !s.traveling && (s.place === 'old_quarter.town_hall' || s.place === 'old_quarter.mayor_office');
  };

  const awaitingSign = (): string[] => E.begun(PROJECTS, projectsOf(registry)).filter(b => b.progress.funded === null && b.progress.opened === null && b.def.signoff.by !== 'none').map(b => b.id);

  const siteActions = (id: string, def: ProjectDef, p: E.Progress, site: Site): Interaction[] => {
    const w = world();
    const stage = E.stageOf(def, p, w);
    const name = projectName(def, p);
    const out: Interaction[] = [];
    if (stage === 'open') out.push({ label: `${capitalize(name)}: waiting for Pell's signature`, run: () => opts.toast(E.nextStep(def, p, w, stepContext())) });
    if (stage === 'funded' || stage === 'gathering' || stage === 'building') {
      const bag = Inventory.parse(registry.get('monde.inventory') ?? {});
      const short = E.materialsShort(def, p, w);
      const give = short.map(m => ({ ...m, n: Math.min(m.count, bag.slots.reduce((n, s) => n + (s?.item === m.item ? s.count : 0), 0)) })).filter(m => m.n > 0);
      if (give.length) out.push({ label: `Hand over ${give.map(m => materialCount(m.item, m.n)).join(' and ')}`, run: () => {
        const moved = handOverAt(registry, now(), id);
        const total = Object.values(moved).reduce((a, b) => a + b, 0);
        if (!total) return;
        playSfx('crate_scrape');
        const left = E.materialsShort(def, projectsOf(registry).projects[id]!, world());
        opts.toast(left.length ? `Handed over. Still to find: ${left.map(m => materialCount(m.item, m.count)).join(', ')}.` : `That's every material ${name} needs.`);
      } });
      if (p.vh < def.vh) {
        const vh = E.playerShiftVh(worldTinkerer());
        out.push({ label: `Work on ${name} (${E.PLAYER_VH_STAMINA} Stamina · 1 h · +${Math.min(vh, def.vh - p.vh)} VH)`, run: () => workShift(id, def, site) });
      }
      if (!out.length) out.push({ label: `${capitalize(name)}: ${E.nextStep(def, p, w, stepContext())}`, run: () => opts.toast(E.nextStep(def, p, w, stepContext())) });
    }
    if (stage === 'ready') {
      if (E.ceremonyOpen(p, now())) out.push({ label: `Open ${name}`, run: () => startCeremony(id) });
      else out.push({ label: `${capitalize(name)}: ${E.nextStep(def, p, w, stepContext())}`, run: () => opts.toast(E.nextStep(def, p, w, stepContext())) });
    }
    return out;
  };

  const worldTinkerer = (): boolean => isTinkerer(registry);

  const stepContext = (): E.StepContext => {
    const bag = Inventory.parse(registry.get('monde.inventory') ?? {});
    return {
      fund: (registry.get('monde.town') as { fund?: number } | undefined)?.fund ?? 0,
      carried: item => bag.slots.reduce((n, s) => n + (s?.item === item ? s.count : 0), 0),
      count: materialCount, placeName: sitePlaceName, residentName
    };
  };

  let working = false;
  const workShift = (id: string, def: ProjectDef, site: Site): void => {
    if (clock.paused || working) return;
    const co = presentAt(site).filter(r => { const s = residents.stateOf(r); return s?.activity === 'volunteer' || s?.activity === 'work'; });
    const result = workAt(registry, now(), id, co);
    if (!result.ok) {
      const why: Record<E.WorkRefusal, string> = {
        paused: 'The Wharf Projects are paused: Port Vane survey site.', not_funded: 'Nothing starts until Pell signs.', hours_in: 'The hours are all in.', tired: 'A meal or a fresh morning would help.',
        too_late: "Too late for an hour's work tonight.", opened: 'It is already open.'
      };
      opts.toast(why[result.reason]);
      return;
    }
    working = true;
    clock.pause('project-work');
    scene.input.keyboard?.resetKeys();
    opts.toast(`Working on ${projectName(def, projectsOf(registry).projects[id])}…`);
    playSfx('footstep_boards');
    // GDD-GAP: a 900 ms presentation beat (as community work); the hour is charged when it ends.
    scene.time.delayedCall(900, () => {
      clock.advanceMinutes(result.minutes);
      clock.resume('project-work');
      working = false;
      const p = projectsOf(registry).projects[id]!;
      const thanks = result.regard.length ? ` · worked beside ${result.regard.map(residentName).join(', ')}` : '';
      opts.toast(`+${result.vh} VH (${p.vh}/${def.vh}) · +${E.PROJECT_XP_PER_SHIFT} Handiwork XP${thanks}`);
    });
  };

  const homesAt = (place: string): Interaction | null => {
    const def = E.defOf(PROJECTS, E.HOMES);
    const local = place.slice(place.indexOf('.') + 1);
    if (!def || !/^vacant_house_\d+$/.test(local) || clock.day < (def.opens.day ?? 1)) return null;
    const key = homeKey(district, local);
    const flags = flagsOf(registry);
    if (homeKind(key, homeDirectory) !== 'vacant' || isOccupied(key, homeDirectory, { flag: f => flags.has(f) }) || flags.has(`project_${local}_done`)) return null;
    if (projectsOf(registry).projects[E.homesId(key)]) return null;
    const active = E.activeHomes(projectsOf(registry));
    const mats = E.needs(def, world()).map(m => materialCount(m.item, m.count)).join(', ');
    if (active) return { label: `${houseName(key)}: Kasimir is busy with ${houseName(projectsOf(registry).projects[active]!.target!)}`, run: () => opts.toast('One house at a time. Finish the one under way first.') };
    return { label: `Restore ${houseName(key)} (${def.fund} coins, ${mats}, ${def.vh} h)`, run: () => {
      if (!startHouse(registry, now(), key)) return;
      playSfx('page_turn');
      opts.toast(`${houseName(key)} is on the list. Pell signs for the ${def.fund} coins: ask her (H), or at the Town Hall.`);
    } };
  };

  const interaction = (place: string, alternative: Interaction | null): Interaction | null => {
    const options: Interaction[] = [];
    for (const h of here()) if (h.site.place === place && h.progress.opened === null) options.push(...siteActions(h.id, h.def, h.progress, h.site));
    const homes = homesAt(place);
    if (homes) options.push(homes);
    // At the Town Hall's counter or in Pell's office itself (W-03: both are inside the Town Hall).
    if ((place === 'old_quarter.town_hall' || place === 'old_quarter.mayor_office') && pellIn()) for (const id of awaitingSign()) {
      const def = E.defOf(PROJECTS, id)!;
      options.push({ label: `Pell's office: ask her to sign for ${projectName(def, projectsOf(registry).projects[id])} (${def.fund} coins)`, run: () => signoffBeat(id) });
    }
    if (!options.length) return alternative;
    if (alternative) options.push(alternative);
    const first = here().find(h => h.site.place === place);
    return chooser(first ? capitalize(projectName(first.def, first.progress)) : placeName(place.slice(place.indexOf('.') + 1)), options);
  };

  // ── H beside a resident ───────────────────────────────────────────────────

  const ask = (resident: string): Interaction | null => {
    const state = projectsOf(registry), w = world();
    const card = residents.sim.profile(resident);
    if (!card || card.kind === 'animal') return null;
    const options: Interaction[] = [];
    const town = registry.get('monde.town') as { fund: number } | undefined;
    for (const { id, def, progress } of E.begun(PROJECTS, state)) {
      if (progress.opened !== null) continue;
      const name = projectName(def, progress);
      if (resident === 'pell' && progress.funded === null && def.signoff.by !== 'none') options.push({ label: `Ask Pell to sign for ${name} (${def.fund} coins)`, run: () => signoffBeat(id) });
      if (progress.funded === null && town && town.fund < def.fund && !progress.donors.includes(resident) && !E.NEVER_DONATE.has(resident))
        options.push({ label: `Ask ${residentName(resident)} for a donation toward ${name}`, run: () => donationBeat(id, resident) });
      const stage = E.stageOf(def, progress, w);
      if ((stage === 'funded' || stage === 'gathering' || stage === 'building') && E.pledgedVh(state, id) < def.vh && !E.NEVER_VOLUNTEER.has(resident)
        && !state.volunteers.some(v => v.resident === resident && v.day === clock.day + 1))
        options.push({ label: `Ask ${residentName(resident)} to lend a hand with ${name} tomorrow`, run: () => askHelpBeat(id, resident) });
      for (const d of def.donors) if (d.resident === resident && !progress.material_donors.includes(resident) && progress.funded !== null && E.materialsShort(def, progress, w).some(m => m.item === d.item))
        options.push({ label: `Ask ${residentName(resident)} for ${materialNoun(d.item)} for ${name}`, run: () => materialBeat(id, resident) });
    }
    if (!options.length) return null;
    return chooser(`Ask ${residentName(resident)} about the Projects`, options.slice(0, 5));
  };

  // ── The Next hint: an opening set for today ───────────────────────────────

  const hint = (): StoryHint | null => {
    const t = now();
    let best: StoryHint | null = null;
    for (const { def, progress } of E.begun(PROJECTS, projectsOf(registry))) {
      const c = progress.ceremony, site = siteFor(def, progress);
      if (!c || !site || c.day !== t.day || t.minute >= c.minute + E.CEREMONY_WINDOW || progress.opened !== null) continue;
      if (best && best.start <= c.minute) continue;
      const [zoneId = ''] = site.place.split('.');
      const pn = sitePlaceName(site.place), zn = zones[zoneId]?.name ?? zoneId;
      const open = t.minute >= c.minute;
      const where = zoneId === district ? pn : `${pn}, ${zn}`;
      const when = open ? `before ${hhmm(c.minute + E.CEREMONY_WINDOW)}` : `${hhmm(c.minute)}–${hhmm(c.minute + E.CEREMONY_WINDOW)}`;
      const named = projectName(def, progress);
      const reason = `${capitalize(named)} ${isPlural(named) ? 'open' : 'opens'}.`;
      best = { sceneId: `project:${def.id}`, place: site.place, placeName: pn, zoneName: zn, via: null, start: c.minute, end: c.minute + E.CEREMONY_WINDOW, open, summoned: false, reason, where, when, text: `${where}, ${when} — ${reason.replace(/\.$/, '')}` };
    }
    return best;
  };

  // ── On the board: the chalk planks and the volunteers at work ────────────

  const planks = new Map<string, SiteArt>();
  const workers = new Map<string, Worker>();
  const hammerKey = hammerTexture(scene);
  const dustKey = dotTexture(scene, 'project-dust', 0xd9c9a3, 3, 3);
  let lastState: unknown = null, artAt = 0, tapAt = 0;

  const plankText = (def: ProjectDef, p: E.Progress): string => {
    const w = world();
    const parts = E.needs(def, w).map(m => `${p.materials[m.item] ?? 0}/${m.count}`).join(' ');
    return [
      projectName(def, p).toUpperCase(),
      `FUND ${p.funded !== null ? '✓' : '—'}`,
      ...(def.materials.length ? [`PARTS ${parts}`] : []),
      ...(def.vh ? [`HANDS ${p.vh}/${def.vh}`] : []),
      ...(def.puzzle ? [`${def.puzzle === 'PZ-01' ? 'VALVES' : 'PUZZLE'} ${w.puzzleSolved(def.puzzle) ? '✓' : '—'}`] : [])
    ].join('\n');
  };

  const syncArt = (): void => {
    if (indoor) return;
    const state = projectsOf(registry);
    if (state === lastState) return;
    lastState = state;
    const live = new Set<string>();
    for (const h of here()) {
      if (h.progress.opened !== null || h.def.ceremony.scene) continue;
      live.add(h.id);
      let art = planks.get(h.id);
      const text = plankText(h.def, h.progress);
      if (!art) {
        // Beside the site's door, where the player comes to work (else the work area's corner).
        const [zid = '', local = ''] = h.site.place.split('.');
        const door = zones[zid]?.places.find(p => p.id === local)?.door;
        const [x0, y0] = h.site.work.area;
        const at = door ? feet(door[0] + 1.9, door[1] + 0.7) : feet(x0 + 0.1, y0 + 0.4);
        // Kasimir's plank (S04): chalk on a blackboard-green board, propped on two legs.
        const W = 76, H = 66;
        const board = scene.add.graphics();
        board.fillStyle(0x6e4b2c, 1).fillRect(-2, -2, W + 4, H + 4).fillStyle(0x2b3a31, 1).fillRect(0, 0, W, H);
        board.lineStyle(1, 0x8a6a45, 1).strokeRect(-2, -2, W + 4, H + 4);
        board.fillStyle(0x6e4b2c, 1).fillRect(6, H + 2, 4, 10).fillRect(W - 10, H + 2, 4, 10);
        const label = scene.add.text(W / 2, 4, text, { fontFamily: FAMILY_UI, fontSize: '9px', color: '#ecebdf', align: 'center', lineSpacing: 0, resolution: RENDER_SCALE * 2 }).setOrigin(0.5, 0);
        const plank = worldOnly(scene.add.container(at.x - W / 2, at.y - H - 12, [board, label]).setDepth(actorDepth(at.y)).setAngle(-3));
        art = { id: h.id, plank, text: label, key: text };
        planks.set(h.id, art);
      } else if (art.key !== text) { art.text.setText(text); art.key = text; }
    }
    for (const [id, art] of planks) if (!live.has(id)) { art.plank.destroy(); planks.delete(id); }
  };

  /** Who's working at a site on this board now, and where (the executor's position). */
  const atWork = (): { id: string; x: number; y: number; site: Site }[] => {
    const { shifts } = shiftsFor(registry, clock.day);
    if (!shifts.length || indoor) return [];
    const sites = here().filter(h => h.progress.opened === null);
    const out: { id: string; x: number; y: number; site: Site }[] = [];
    for (const s of shifts) {
      if (s.action === 'attend') continue;
      const st = residents.stateOf(s.resident);
      const site = sites.find(h => h.site.work.place === s.place)?.site;
      if (!st?.position || !site || st.zone !== zone.id || st.moving || st.traveling || !st.visible) continue;
      if (st.activity !== 'volunteer' && st.activity !== 'work') continue;
      if (!inArea(site.work.area, st.position, 1)) continue;
      out.push({ id: s.resident, x: st.position.x, y: st.position.y, site });
    }
    return out;
  };

  const animateWorkers = (dtMs: number): void => {
    const busy = atWork();
    const seen = new Set<string>();
    for (const w of busy) {
      seen.add(w.id);
      let worker = workers.get(w.id);
      if (!worker) {
        worker = { hammer: worldOnly(scene.add.image(0, 0, hammerKey).setOrigin(0.5, 0.9)), phase: Math.random() * Math.PI * 2, nextDust: Math.random() * 1200 };
        workers.set(w.id, worker);
      }
      const f = feet(w.x, w.y);
      worker.phase += dtMs * 0.009;
      const swing = Math.sin(worker.phase);
      worker.hammer.setPosition(f.x - 13, f.y - 20).setAngle(-50 + swing * 55).setDepth(actorDepth(f.y) + 1e-4).setVisible(true);
      worker.nextDust -= dtMs;
      if (worker.nextDust <= 0 && !clock.paused) {
        worker.nextDust = 900 + Math.random() * 900;
        for (let i = 0; i < 4; i++) {
          const d = worldOnly(scene.add.image(f.x - 16 + Math.random() * 10, f.y - 2, dustKey).setDepth(actorDepth(f.y) + 2e-4).setAlpha(0.9));
          scene.tweens.add({ targets: d, x: d.x + Phaser.Math.Between(-10, 10), y: d.y - 6 - Math.random() * 8, alpha: 0, duration: 600 + Math.random() * 300, onComplete: () => d.destroy() });
        }
      }
    }
    for (const [id, worker] of workers) if (!seen.has(id)) { worker.hammer.destroy(); workers.delete(id); }
    // A soft tap now and then while the player is near enough to hear it.
    tapAt -= dtMs;
    const p = opts.position();
    if (busy.length && tapAt <= 0 && !clock.paused && busy.some(w => Math.hypot(w.x - p.x, w.y - p.y) < 7)) { tapAt = 1400 + Math.random() * 900; playSfx('clock_tick'); }
  };

  // ── The clock and the flags ───────────────────────────────────────────────

  const sync = () => syncProjects(registry, now());
  const offMinute = clock.onMinute(() => { if (clock.minute % 10 === 0) sync(); });
  const onFlags = () => sync();
  registry.events.on('changedata-monde.story.flags', onFlags);
  registry.events.on('changedata-monde.puzzles', onFlags);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    offMinute();
    registry.events.off('changedata-monde.story.flags', onFlags);
    registry.events.off('changedata-monde.puzzles', onFlags);
    for (const o of decorations) o.destroy();
  });
  sync();
  if (DEV) installDevTools(scene, opts, { startCeremony, sync, signoff: signoffBeat });

  let checkAt = 0;
  return {
    interaction, ask, hint,
    update(dtMs) {
      artAt += dtMs;
      if (artAt > 400) { artAt = 0; syncArt(); }
      animateWorkers(dtMs);
      checkAt += dtMs;
      if (checkAt < 400) return;
      checkAt = 0;
      // An opening that's due starts when the player is at the site and nothing else holds the world.
      if (ceremonyOn || opts.busy() || clock.paused || HOLDING.some(k => scene.scene.isActive(k))) return;
      const t = now(), pos = opts.position();
      const door = nearbyPlace(zone, pos);
      for (const h of here()) {
        if (!E.ceremonyOpen(h.progress, t)) continue;
        const atSite = inArea(onBoard(h.site).work.area, pos, 2) || (door && `${district}.${door.id}` === h.site.place);
        if (atSite) { startCeremony(h.id); return; }
      }
    }
  };
}

// ── Dev tools ───────────────────────────────────────────────────────────────

function installDevTools(scene: Phaser.Scene, opts: ProjectsAttachOptions, hooks: { startCeremony(id: string): void; sync(): unknown; signoff(id: string): void }): void {
  const r = scene.registry, clock = opts.clock;
  const now = () => ({ day: clock.day, minute: clock.minute });
  const tools = {
    state: () => projectsOf(r),
    stages: () => E.begun(PROJECTS, projectsOf(r)).map(b => ({ id: b.id, stage: E.stageOf(b.def, b.progress, worldOf(r, now())), vh: `${b.progress.vh}/${b.def.vh}`, ceremony: b.progress.ceremony })),
    /** Put `n` of an item in the Bag. */
    give(item: string, n = 1) { const it = itemById(item); const bag = it && addItem(Inventory.parse(r.get('monde.inventory') ?? {}), it, n); if (bag) r.set('monde.inventory', bag); return !!bag; },
    coins(n: number) { r.set('monde.coins', { balance: Wallet.parse(r.get('monde.coins') ?? {}).balance + n }); },
    fund(n: number) { const t = r.get('monde.town') as { fund: number }; r.set('monde.town', { ...t, fund: t.fund + n }); },
    /** To the next dawn (as sleeping does, without the walk home). */
    skip() {
      const econ = r.get('monde.economy') as SaveGame['economy'] | undefined;
      if (econ) r.set('monde.economy', { ...econ, stamina: 100, maxStamina: 100, day: clock.day + 1, work: {} });
      clock.startNextDay();
      hooks.sync();
      return now();
    },
    /** Solve a puzzle from its known solution (PZ-01 only: the checker still validates the board). */
    solve(id = 'PZ-01') {
      const p = puzzles[id];
      if (!p || id !== 'PZ-01') return false;
      return completePuzzle(r, clock, id, { ...p.reset(), cells: [...PZ01_SOLUTION] });
    },
    /** Fill a Project's materials and hours (dev only). */
    fill(id: string) {
      const s = projectsOf(r), p = s.projects[id], def = E.defOf(PROJECTS, id);
      if (!p || !def) return false;
      const materials = Object.fromEntries(E.needs(def, worldOf(r, now())).map(m => [m.item, m.count]));
      r.set(PROJECTS_KEY, { ...s, projects: { ...s.projects, [id]: { ...p, materials, vh: def.vh } } });
      hooks.sync();
      return true;
    },
    /** Start an opening now (dev only), wherever the player is. */
    open(id: string) {
      const s = projectsOf(r), p = s.projects[id];
      if (!p) return false;
      r.set(PROJECTS_KEY, { ...s, projects: { ...s.projects, [id]: { ...p, ceremony: { day: clock.day, minute: clock.minute } } } });
      hooks.startCeremony(id);
      return true;
    },
    /** Pell's sign-off conversation for a Project, wherever she is (H beside her, or her office, in play). */
    sign(id: string) { hooks.signoff(id); },
    /** Hand over what the Bag holds, as E does at the site. */
    hand(id: string) { return handOverAt(r, now(), id); },
    /** One shift of the player's, as E does at the site (no co-workers counted). */
    work(id: string) { const out = workAt(r, now(), id, []); if (out.ok) clock.advanceMinutes(out.minutes); return out; },
    /** Ask a resident to lend a hand tomorrow, as H does (their real Regard). */
    ask(id: string, resident: string) { return askForHelp(r, now(), id, resident, regardFor(r, resident)); },
    /** Run the clock forward to a time today ("10:30"), firing every minute on the way. */
    at(hhmm: string) { const [h, m] = hhmm.split(':').map(Number); const to = h! * 60 + m!; if (to > clock.minute) clock.advanceMinutes(to - clock.minute); return now(); },
    /** Walk the player to a Project's site (restarts the zone at its door). */
    go(id: string) {
      const def = E.defOf(PROJECTS, id), site = def && siteFor(def, projectsOf(r).projects[id]);
      if (!site) return false;
      const [zoneId = '', local = ''] = site.place.split('.');
      const door = zones[zoneId]?.places.find(p => p.id === local)?.door;
      const [x, y, , h] = site.work.area;
      scene.scene.restart({ zone: zoneId, arrive: door ?? [x, y + h - 1] });
      return true;
    }
  };
  Object.assign(window as unknown as Record<string, unknown>, { __projects: tools });
}
