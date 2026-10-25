// The objective marker (Kasey, 2026-10-24: "an indicator of what to do to progress and where"). ZoneScene attaches it
// once in create(), beside the objective line (quests/hud.ts), and it points where that line says:
//   - a pin stuck in the ground at the place, the door to go in by, or over the person to see, on this board;
//   - when the objective is in another district, the pin stands at the edge toward the next one ("→ Market Row");
//   - when the pin is off screen, an arrow at the screen's edge points to it, with the same label.
// world/wayfinding.ts picks the target. Hidden whenever the objective line is (scenes, dialogue, menus, a door's fade,
// the Journal's O switch), when the objective is anywhere at all, and once the player stands at it.
import type Phaser from 'phaser';
import { reducedMotion } from '../accessibility/runtime';
import type { ObliqueProjection } from '../render/ObliqueProjection';
import { DEPTH } from '../render/depth';
import { DIORAMA_ELEV_STEP, DIORAMA_FOOT_DY, DIORAMA_TILE_H } from '../render/dioramaConfig';
import type { StoryAttachment } from '../scenes/story/attach';
import { FAMILY_BODY, GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from '../util/constants';
import { residentName, sitePlaceName } from '../projects/runtime';
import { townNames } from '../scenes/friendship';
import type { Position } from '../world/player';
import { PERSON_KINDS, edgeArrow, guideTarget, type GuideTarget, type GuideWorld } from '../world/wayfinding';
import { doorLinks, interiors, zones } from '../world/zones';
import type { ZoneDef } from '../world/zoneFormat';
import { HUD_BUTTON_W, hudButtonsBox } from '../scenes/zone/hudButtons';
import { OBJECTIVE_HIDDEN_UNDER } from './hud';
import type { Objectives } from './objective';
import { OBJECTIVE_KEY, objectiveShown } from './state';

export interface QuestMarkerOptions {
  zone: ZoneDef;
  projection: ObliqueProjection;
  /** The player's tile position (centres at k + 0.5). */
  position(): Position;
  /** A resident's tile position on this board, or null when they aren't on it. */
  personAt(id: string): Position | null;
  story: StoryAttachment;
  /** True while the zone can't be walked in (a door's or an edge's fade). */
  busy(): boolean;
  /** The camera's zoom over RENDER_SCALE (1.5 indoors): world pixels to screen pixels. */
  zoom: number;
}

/** The HUD's menu buttons (Bag, Tasks, Journal, Ledger, Map: ZoneScene). */
const HUD_BUTTONS = 5;
/** How often the target is worked out again (real ms); the pin follows a walking person every frame. */
const RETARGET_MS = 250;
/** Within this many tiles of a place, a door or the person, the player is there: no marker. GDD-GAP: art tuning. */
const THERE = 1.2;
/**
 * The screen (design px) and the margin the edge arrow keeps: under the district's name and the controls line, above
 * the menu buttons, and out of the clock's corner with the objective line under it (quests/hud.ts).
 */
const SCREEN = { w: GAME_WIDTH, h: GAME_HEIGHT, x: 46, top: 112, bottom: 76, avoid: [
  { x0: GAME_WIDTH - 300, y0: 0, x1: GAME_WIDTH, y1: 280 },
  // The menu buttons' column, and a margin round it.
  (({ x0, y0, x1, y1 }) => ({ x0: x0 - 30, y0: y0 - 26, x1, y1 }))(hudButtonsBox(HUD_BUTTONS, HUD_BUTTON_W))
] };
const GOLD = 0xe4c77f, INK = 0x28372d;

export const GUIDE_WORLD: GuideWorld = {
  zones, interiors, links: doorLinks,
  zoneName: id => zones[id]?.name ?? id,
  placeName: sitePlaceName,
  personName: id => townNames()[id] ?? residentName(id)
};

export function attachQuestMarker(scene: Phaser.Scene, opts: QuestMarkerOptions): void {
  const registry = scene.registry, cam = scene.cameras.main;
  // ── The pin, in the world ──
  const pin = scene.add.graphics();
  // A map pin, its tip at (0, 0): a round gold head with a dark ring, a short point below.
  pin.fillStyle(0x000000, 0.25).fillEllipse(0, 1, 12, 4);
  pin.fillStyle(INK, 1).fillTriangle(-6, -14, 6, -14, 0, 0).fillCircle(0, -17, 9);
  pin.fillStyle(GOLD, 1).fillTriangle(-4, -14, 4, -14, 0, -2).fillCircle(0, -17, 7);
  pin.fillStyle(INK, 1).fillCircle(0, -17, 2.6);
  const pinLabel = scene.add.text(0, 0, '', { fontFamily: FAMILY_BODY, fontSize: '12px', color: '#ffe7a6', backgroundColor: '#28372dee', padding: { x: 5, y: 2 }, resolution: RENDER_SCALE * opts.zoom })
    .setOrigin(0.5, 1);
  pin.setScale(1.5).setDepth(DEPTH.OVER_DARK + 0.5);
  pinLabel.setDepth(DEPTH.OVER_DARK + 0.6);
  for (const c of scene.cameras.cameras) if (c !== cam) c.ignore([pin, pinLabel]);
  // ── The arrow at the screen's edge, on the HUD ──
  const arrow = scene.add.graphics();
  arrow.fillStyle(INK, 0.9).fillCircle(0, 0, 17).lineStyle(2, GOLD, 0.85).strokeCircle(0, 0, 17);
  arrow.fillStyle(GOLD, 1).fillTriangle(13, 0, -6, -9, -6, 9);
  const arrowLabel = scene.add.text(0, 0, '', { fontFamily: FAMILY_BODY, fontSize: '14px', color: '#ffe7a6', backgroundColor: '#28372dee', padding: { x: 6, y: 3 }, resolution: RENDER_SCALE });
  cam.ignore([arrow, arrowLabel]);
  const all = [pin, pinLabel, arrow, arrowLabel];
  for (const o of all) o.setVisible(false);

  let target: GuideTarget | null = null, at = -Infinity;
  const hide = () => { for (const o of all) o.setVisible(false); };
  const objective = () => (registry.get(OBJECTIVE_KEY) as Objectives | undefined)?.hud ?? null;
  const retarget = () => {
    const o = objective();
    target = o ? guideTarget(GUIDE_WORLD, opts.zone.id, { place: o.place, people: o.people, preferPerson: PERSON_KINDS.includes(o.kind) }, opts.personAt) : null;
  };

  const update = (time: number) => {
    const covered = OBJECTIVE_HIDDEN_UNDER.some(k => scene.scene.isActive(k));
    if (covered || opts.busy() || !objectiveShown()) { hide(); return; }
    if (time - at >= RETARGET_MS) {
      at = time;
      retarget();
      // Standing there with the window open: the scene is about to start (as the objective line hides).
      const hint = opts.story.hint();
      if (hint && hint.open && opts.story.place() === hint.place) target = null;
    }
    if (!target) { hide(); return; }
    // A person walks: follow them between retargets.
    if (target.kind === 'person') {
      const o = objective(), id = o?.people.find(p => opts.personAt(p));
      const p = id ? opts.personAt(id) : null;
      if (p) { target = { ...target, x: p.x, y: p.y }; }
    }
    const me = opts.position();
    if (target.kind !== 'exit' && Math.hypot(me.x - target.x, me.y - target.y) <= THERE) { hide(); return; }
    // The ground under the target, as the player's feet are placed (ZoneScene syncFigure).
    const ground = opts.projection.tileToWorld({ x: target.x - 0.5, y: target.y - 0.5 });
    const wy = target.y * DIORAMA_TILE_H - opts.projection.elevationAt(Math.floor(target.x), Math.floor(target.y)) * DIORAMA_ELEV_STEP + DIORAMA_FOOT_DY;
    const lift = target.kind === 'person' ? 56 : 2;
    const bob = reducedMotion() ? 0 : Math.sin(time / 260) * 3;
    const wx = ground.x, py = wy - lift + bob;
    pin.setPosition(wx, py).setVisible(true);
    if (pinLabel.text !== target.label) pinLabel.setText(target.label);
    pinLabel.setPosition(wx, py - 40).setVisible(true);
    // On screen (design px) or not: the arrow takes over at the edge.
    const scale = cam.zoom / RENDER_SCALE;
    const sx = (wx - cam.scrollX) * scale, sy = (py - 26 - cam.scrollY) * scale;
    const e = edgeArrow(SCREEN, sx, sy);
    if (!e) { arrow.setVisible(false); arrowLabel.setVisible(false); return; }
    const pulse = reducedMotion() ? 1 : 0.8 + 0.2 * Math.sin(time / 300);
    arrow.setPosition(e.x, e.y).setRotation(e.angle).setAlpha(pulse).setVisible(true);
    if (arrowLabel.text !== target.label) arrowLabel.setText(target.label);
    // The label sits on the arrow's inner side, kept on screen.
    const lx = e.x - Math.cos(e.angle) * 26, ly = e.y - Math.sin(e.angle) * 26;
    arrowLabel.setOrigin(Math.cos(e.angle) > 0.3 ? 1 : Math.cos(e.angle) < -0.3 ? 0 : 0.5, Math.sin(e.angle) > 0.3 ? 1 : Math.sin(e.angle) < -0.3 ? 0 : 0.5)
      .setPosition(lx, ly).setVisible(true);
  };
  scene.events.on('update', update);
  scene.events.once('shutdown', () => scene.events.off('update', update));
}
