import Phaser from "phaser";
import { Grid } from "../combat/Grid";
import type { MapDef, ObstacleKind } from "../combat/types";
import { buildDiorama } from "../render/diorama/Diorama";
import { ObliqueProjection } from "../render/ObliqueProjection";
import { elevationFor } from "../render/elevation";
import { normalizeRotation, toGrid, toView, viewSize, type ViewRotation } from "../render/ViewRotation";
import { DIORAMA_TILE_W, DIORAMA_TILE_H, DIORAMA_ELEV_STEP, DIORAMA_SLAB_DEPTH,
  DIORAMA_FOOT_DY, DIORAMA_PERSPECTIVE_K } from "../render/dioramaConfig";
import { BloomPipeline, BLOOM_PIPELINE } from "../render/BloomPipeline";
import { PerspectivePipeline, PERSPECTIVE_PIPELINE } from "../render/PerspectivePipeline";
import { attachPostPipeline } from "../render/postPipelines";
import { SUN, castFrom } from "../render/sun";
import { DEPTH, actorDepth } from "../render/depth";
import { GAME_WIDTH, GAME_HEIGHT, RENDER_SCALE, FAMILY_BODY } from "../util/constants";
import { installAudioUnlock } from "../audio/Sfx";
import { makePanel } from "../ui/Panel";
import { Button } from "../ui/Button";
import { paginateBody } from "../ui/fitText";
import { speakBlip } from "../ui/voice";

// Visual fixture only: these placements and colours are not Monde gameplay rules.
const makeDemoMap = (): MapDef => {
  const obstacles: Record<string, ObstacleKind> = {
    "2,2": "tree", "11,2": "rock", "3,6": "hay", "10,6": "torch"
  };
  return {
    id: "diorama-demo", name: "Spring in Monde", width: 14, height: 10,
    startPositions: { player: [], enemy: [] },
    tiles: Array.from({ length: 140 }, (_, i) => {
      const x = i % 14, y = Math.floor(i / 14);
      if (x === 9 && y === 0) return { terrain: "wall", elev: 2 };
      if (x >= 10 && y >= 7) return { terrain: "water" };
      return { terrain: x === 6 || x === 7 || y === 4 ? "cobblestone" : "grass",
        obstacle: obstacles[`${x},${y}`] ?? "none" };
    })
  };
};

export class DioramaDemoScene extends Phaser.Scene {
  constructor() { super("DioramaDemo"); }

  create(data: { rotation?: ViewRotation; zoom?: number }): void {
    const rotation = data.rotation ?? 0;
    let zoom = data.zoom ?? 1;
    const map = makeDemoMap();
    const grid = new Grid(map);
    const { w, h } = viewSize(map.width, map.height, rotation);
    const elevationAt = elevationFor(map, rotation);
    const projection = new ObliqueProjection({
      originX: (GAME_WIDTH - w * DIORAMA_TILE_W) / 2,
      originY: 300 - h * DIORAMA_TILE_H / 2,
      gridWidth: w, gridHeight: h,
      tileW: DIORAMA_TILE_W, tileH: DIORAMA_TILE_H,
      elevStep: DIORAMA_ELEV_STEP, slabDepth: DIORAMA_SLAB_DEPTH, elevationAt
    });
    buildDiorama(this, {
      width: w, height: h,
      tileAt: p => grid.tileAt(toGrid(p, map.width, map.height, rotation))
    }, projection, {
      footDY: DIORAMA_FOOT_DY, seed: 42, elevationAt,
      elevStep: DIORAMA_ELEV_STEP, sun: SUN, rotation,
      gridOf: (x, y) => toGrid({ x, y }, map.width, map.height, rotation)
    });
    // Self-contained, foot-anchored placeholder billboards with matching sun shadows.
    const figures = [
      { x: 4, y: 3, color: 0xd88d69 }, { x: 7, y: 5, color: 0x7cbba2 },
      { x: 8, y: 2, color: 0xc9b271 }, { x: 5, y: 7, color: 0x93a6d2 }
    ];
    for (const [i, figure] of figures.entries()) {
      const key = `demo-resident-${i}`;
      if (!this.textures.exists(key)) {
        const g = this.make.graphics({ x: 0, y: 0 });
        g.fillStyle(figure.color).fillRoundedRect(6, 15, 20, 27, 4);
        g.fillStyle(0xf2d5b3).fillCircle(16, 9, 8);
        g.fillStyle(0x384138).fillRect(8, 40, 6, 8).fillRect(18, 40, 6, 8);
        g.generateTexture(key, 32, 48);
        g.destroy();
      }
      const p = projection.tileToWorld(toView(figure, map.width, map.height, rotation));
      const footY = p.y + DIORAMA_FOOT_DY;
      const img = this.add.image(p.x, footY, key).setOrigin(0.5, 1).setDepth(actorDepth(footY));
      const shadow = this.add.image(p.x, footY, key).setOrigin(0.5, 1)
        .setTintFill(0x000000).setAlpha(SUN.alpha).setDepth(DEPTH.SHADOW);
      castFrom(shadow, img, SUN);
    }
    const world = this.children.list.slice();
    const camera = this.cameras.main;
    camera.setOrigin(0, 0);
    const applyZoom = () => {
      camera.setZoom(RENDER_SCALE * zoom);
      camera.setScroll(GAME_WIDTH / 2 * (1 - 1 / zoom), 300 * (1 - 1 / zoom));
    };
    applyZoom();
    const perspective = attachPostPipeline(camera, this.game, PERSPECTIVE_PIPELINE, PerspectivePipeline);
    if (perspective) perspective.k = DIORAMA_PERSPECTIVE_K;
    attachPostPipeline(camera, this.game, BLOOM_PIPELINE, BloomPipeline);
    const uiCamera = this.cameras.add(0, 0, GAME_WIDTH, GAME_HEIGHT);
    uiCamera.ignore(world);
    this.add.text(40, 25, "Monde · Diorama study", { fontFamily: FAMILY_BODY, fontSize: "30px", color: "#f3e3c3" });
    this.add.text(40, 65, "Q / E: rotate    •    Wheel: zoom    •    Next: dialogue / sound", {
      fontFamily: FAMILY_BODY, fontSize: "18px", color: "#c4d0bb"
    });
    makePanel(this, 160, 590, 960, 110);
    const body = this.add.text(185, 607, "", {
      fontFamily: FAMILY_BODY, fontSize: "21px", color: "#f3e3c3", wordWrap: { width: 710 }
    });
    const pages = paginateBody(body,
      "Welcome to Monde. The road winds past the old wall, and the water catches the afternoon light. " +
      "Four neighbours have stopped to enjoy the quiet. Turn the board to see the raised stone and the shadows beneath their feet. " +
      "By the bank, little ribbons of foam gather at the water’s edge. There is time to linger here.", 2);
    let page = 0, count = 0;
    const timer = this.time.addEvent({ delay: 32, loop: true, callback: () => {
      const line = pages[page]!;
      if (count >= line.length) return;
      count++;
      body.setText(line.slice(0, count));
      if (count % 2 === 0 && /\p{L}/u.test(line[count - 1]!)) speakBlip();
    } });
    new Button(this, { x: 930, y: 622, w: 160, h: 48, label: "Next", onClick: () => {
      if (count < pages[page]!.length) { count = pages[page]!.length; body.setText(pages[page]!); }
      else { page = (page + 1) % pages.length; count = 0; body.setText(""); }
    } });
    camera.ignore(this.children.list.filter(obj => !world.includes(obj)));
    installAudioUnlock(this);
    const rotateLeft = () => this.scene.restart({ rotation: normalizeRotation(rotation - 1), zoom });
    const rotateRight = () => this.scene.restart({ rotation: normalizeRotation(rotation + 1), zoom });
    const wheel = (_pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      zoom = Phaser.Math.Clamp(zoom - dy * 0.001, 0.75, 1.4);
      applyZoom();
    };
    this.input.keyboard?.on("keydown-Q", rotateLeft);
    this.input.keyboard?.on("keydown-E", rotateRight);
    this.input.on("wheel", wheel);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off("keydown-Q", rotateLeft);
      this.input.keyboard?.off("keydown-E", rotateRight);
      this.input.off("wheel", wheel);
      timer.remove();
    });
  }
}
