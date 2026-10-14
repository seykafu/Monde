import Phaser from 'phaser';
import { Grid } from '../combat/Grid';
import { buildDiorama } from '../render/diorama/Diorama';
import { ObliqueProjection } from '../render/ObliqueProjection';
import { elevationFor } from '../render/elevation';
import { DIORAMA_TILE_W, DIORAMA_TILE_H, DIORAMA_ELEV_STEP, DIORAMA_SLAB_DEPTH, DIORAMA_FOOT_DY, DIORAMA_PERSPECTIVE_K } from '../render/dioramaConfig';
import { BloomPipeline, BLOOM_PIPELINE } from '../render/BloomPipeline';
import { PerspectivePipeline, PERSPECTIVE_PIPELINE } from '../render/PerspectivePipeline';
import { attachPostPipeline } from '../render/postPipelines';
import { SUN, castFrom } from '../render/sun';
import { DEPTH, actorDepth } from '../render/depth';
import { GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE, FAMILY_BODY } from '../util/constants';
import { zones } from '../world/zones';
import type { Point, ZoneDef } from '../world/zoneFormat';
import { movePlayer, nearbyPlace, placeName, type Position } from '../world/player';

export class ZoneScene extends Phaser.Scene {
  private zone!: ZoneDef;
  private position!: Position;
  private projection!: ObliqueProjection;
  private figure!: Phaser.GameObjects.Image;
  private shadow!: Phaser.GameObjects.Image;
  private prompt!: Phaser.GameObjects.Text;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private transitioning = false;
  constructor() { super('Zone'); }

  create(data: { zone?: string; arrive?: Point } = {}): void {
    this.zone = zones[data.zone ?? 'old_quarter']!;
    this.transitioning = false;
    const [x, y] = data.arrive ?? this.zone.spawn;
    this.position = { x: x + 0.5, y: y + 0.5 };
    const grid = new Grid(this.zone);
    const elevation = elevationFor(this.zone);
    this.projection = new ObliqueProjection({ originX: 0, originY: 0,
      gridWidth: this.zone.width, gridHeight: this.zone.height,
      tileW: DIORAMA_TILE_W, tileH: DIORAMA_TILE_H, elevStep: DIORAMA_ELEV_STEP,
      slabDepth: DIORAMA_SLAB_DEPTH, elevationAt: (x, y) => elevation(Math.floor(x), Math.floor(y)) });
    buildDiorama(this, { width: this.zone.width, height: this.zone.height,
      tileAt: p => ({ ...grid.tileAt(p), blocksMovement: !this.zone.walkability[p.y]?.[p.x] }) }, this.projection,
    { footDY: DIORAMA_FOOT_DY, seed: 42, elevationAt: elevation, elevStep: DIORAMA_ELEV_STEP, sun: SUN, rotation: 0, gridOf: (x, y) => ({ x, y }) });
    // Greybox doorstep markers and short labels keep the town navigable.
    for (const place of this.zone.places) {
      const p = this.projection.tileToWorld({ x: place.door[0], y: place.door[1] });
      this.add.rectangle(p.x, p.y, 18, 7, 0xe4c77f).setDepth(DEPTH.GROUND_MARK);
      this.add.text(p.x, p.y - 22, placeName(place.id), { fontFamily: FAMILY_BODY, fontSize: '11px', color: '#fff0ce', backgroundColor: '#343d34' })
        .setOrigin(0.5, 1).setDepth(DEPTH.UNIT_HUD);
    }
    if (!this.textures.exists('town-player')) {
      const g = this.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0x69b8ac).fillRoundedRect(6, 15, 20, 27, 4);
      g.fillStyle(0xf2d5b3).fillCircle(16, 9, 8);
      g.fillStyle(0x384138).fillRect(8, 40, 6, 8).fillRect(18, 40, 6, 8);
      g.generateTexture('town-player', 32, 48); g.destroy();
    }
    this.figure = this.add.image(0, 0, 'town-player').setOrigin(0.5, 1);
    this.shadow = this.add.image(0, 0, 'town-player').setOrigin(0.5, 1).setTintFill(0).setAlpha(SUN.alpha).setDepth(DEPTH.SHADOW);
    this.syncFigure();
    const world = this.children.list.slice();
    const camera = this.cameras.main;
    camera.setOrigin(0, 0).setZoom(RENDER_SCALE);
    const bounds = this.projection.bounds();
    camera.setBounds(bounds.x, bounds.y, bounds.w, bounds.h);
    this.followPlayer();
    const perspective = attachPostPipeline(camera, this.game, PERSPECTIVE_PIPELINE, PerspectivePipeline);
    if (perspective) perspective.k = DIORAMA_PERSPECTIVE_K;
    attachPostPipeline(camera, this.game, BLOOM_PIPELINE, BloomPipeline);
    const ui = this.cameras.add(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ui.ignore(world);
    const title = this.add.text(24, 18, this.zone.name, { fontFamily: FAMILY_BODY, fontSize: '28px', color: '#fff0ce', backgroundColor: '#28372d' });
    const controls = this.add.text(24, 56, 'WASD / arrows: walk  ·  E: interact  ·  East / west road: change district', { fontFamily: FAMILY_BODY, fontSize: '17px', color: '#fff0ce', backgroundColor: '#28372d' });
    this.prompt = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 50, '', { fontFamily: FAMILY_BODY, fontSize: '22px', color: '#fff0ce', backgroundColor: '#28372d', padding: { x: 12, y: 6 } }).setOrigin(0.5);
    camera.ignore([title, controls, this.prompt]);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,E') as Record<string, Phaser.Input.Keyboard.Key>;
    camera.fadeIn(400); // GDD §16.4.
  }

  private syncFigure(): void {
    const p = this.projection.tileToWorld({ x: this.position.x - 0.5, y: this.position.y - 0.5 });
    // Continuous position uses its containing tile's elevation (not the shifted centre coordinate).
    p.y = this.position.y * DIORAMA_TILE_H - this.projection.elevationAt(Math.floor(this.position.x), Math.floor(this.position.y)) * DIORAMA_ELEV_STEP;
    const footY = p.y + DIORAMA_FOOT_DY;
    this.figure.setPosition(p.x, footY).setDepth(actorDepth(footY));
    this.shadow.setPosition(p.x, footY);
    castFrom(this.shadow, this.figure, SUN);
  }
  private followPlayer(): void {
    // Explicit follow uses the patch's top-left zoom pivot and bounds clamp.
    const camera = this.cameras.main;
    camera.setScroll(camera.clampX(this.figure.x - camera.displayWidth / 2), camera.clampY(this.figure.y - camera.displayHeight / 2));
  }
  update(_time: number, delta: number): void {
    if (this.transitioning || !this.keys) return;
    const down = (...names: string[]) => names.some(name => this.keys[name]!.isDown) ? 1 : 0;
    const result = movePlayer(this.zone, this.position, { x: down('D', 'RIGHT') - down('A', 'LEFT'), y: down('S', 'DOWN') - down('W', 'UP') }, delta / 1000);
    this.position = result.position;
    this.syncFigure(); this.followPlayer();
    const place = nearbyPlace(this.zone, this.position);
    this.prompt.setText(place ? `E: ${placeName(place.id)}` : '').setVisible(!!place);
    if (Phaser.Input.Keyboard.JustDown(this.keys.E!) && place) console.log(`${this.zone.id}.${place.id}`);
    if (result.edge) {
      this.transitioning = true;
      const edge = result.edge;
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart({ zone: edge.zone, arrive: edge.arrive }));
      this.cameras.main.fadeOut(400);
    }
  }
}
