// Character sprites in Phaser: a drawn sheet when the art exists, the procedural rig until then.
//
// preloadCharacterSheets(scene) (from a scene's preload) fetches assets/sprites/manifest.json and, for
// every character it lists, that character's sheet (and its meta json when the entry asks for one).
// characterSheet(scene, id, look) then returns a texture whose frames follow the sheet contract
// (render/character/sheet.ts): the drawn sheet if it loaded and its layout checks out, otherwise the
// rig's drawing of `look`, built once per distinct look. CharacterSprite pairs that texture with a
// CharacterAnimator and puts the current frame on an Image (the figure, and its cast shadow).

import Phaser from 'phaser';
import { CharacterAnimator, type AnimInput } from './character/anim';
import { DEFAULT_PLAYER_LOOK, lookHash, lookKey, type CharacterLook, type Look } from './character/look';
import { renderSheet } from './character/rig';
import { PROCEDURAL_LAYOUT, columns, frameFor, layoutFrom, parseManifest, parseMeta, type Facing, type SheetLayout } from './character/sheet';

const MANIFEST_KEY = 'monde.sprites.manifest';
/** Registry key W-07 character creation sets to the player's CharacterLook. */
export const PLAYER_LOOK_KEY = 'monde.playerLook';

const drawnKey = (id: string): string => `sheet:${id}`;
const metaKey = (id: string): string => `sheet-meta:${id}`;
const spritesBase = (): string => `${import.meta.env.BASE_URL}assets/sprites/`;

/** The player's look: what character creation stored in the registry, or the default. */
export function playerLook(registry: Phaser.Data.DataManager): CharacterLook {
  return (registry.get(PLAYER_LOOK_KEY) as CharacterLook | undefined) ?? DEFAULT_PLAYER_LOOK;
}

/**
 * Queue the sprite manifest and the sheets it lists (call from a scene's preload; cheap after the first time).
 * Only characters in the manifest are fetched, so missing art costs no requests and no 404s.
 */
export function preloadCharacterSheets(scene: Phaser.Scene): void {
  if (scene.cache.json.exists(MANIFEST_KEY)) return;
  const base = spritesBase();
  scene.load.json(MANIFEST_KEY, `${base}manifest.json`);
  scene.load.once(`filecomplete-json-${MANIFEST_KEY}`, (_key: string, _type: string, data: unknown) => {
    const problems: string[] = [];
    for (const [id, meta] of parseManifest(data, problems)) {
      if (!scene.textures.exists(drawnKey(id))) scene.load.image(drawnKey(id), `${base}${id}/walk.png`);
      if (meta.json && !scene.cache.json.exists(metaKey(id))) scene.load.json(metaKey(id), `${base}${id}/${id}.json`);
    }
    if (problems.length) console.warn(`[sprites] manifest.json: ${problems.join('; ')}`);
  });
}

export interface CharacterSheet { key: string; layout: SheetLayout; drawn: boolean }

interface SheetData { layout?: SheetLayout | null }

/** The texture to draw character `id` with: its drawn sheet if one loaded and fits its layout, else the rig's drawing of `look`. */
export function characterSheet(scene: Phaser.Scene, id: string, look: Look): CharacterSheet {
  const drawn = drawnKey(id);
  if (scene.textures.exists(drawn)) {
    const layout = drawnLayout(scene, id);
    if (layout) return { key: drawn, layout, drawn: true };
  }
  const key = `char:${lookKey(look)}`;
  if (!scene.textures.exists(key)) {
    const sheet = renderSheet(look, PROCEDURAL_LAYOUT);
    const tex = scene.textures.createCanvas(key, sheet.width, sheet.height);
    if (tex) {
      const ctx = tex.getContext(), img = ctx.createImageData(sheet.width, sheet.height);
      img.data.set(sheet.data);
      ctx.putImageData(img, 0, 0);
      tex.refresh();
      addFrames(tex, PROCEDURAL_LAYOUT);
    }
  }
  return { key, layout: PROCEDURAL_LAYOUT, drawn: false };
}

/** A drawn sheet's layout (worked out, checked and framed once; null if it doesn't fit, so the rig stands in). */
function drawnLayout(scene: Phaser.Scene, id: string): SheetLayout | null {
  const tex = scene.textures.get(drawnKey(id)), data = tex.customData as SheetData;
  if (data.layout !== undefined) return data.layout;
  data.layout = null;
  const problems: string[] = [];
  try {
    const entry = parseManifest(scene.cache.json.get(MANIFEST_KEY), problems).get(id) ?? {};
    const own = entry.json && scene.cache.json.exists(metaKey(id)) ? parseMeta(scene.cache.json.get(metaKey(id)), problems, `${id}.json`) : {};
    const layout = layoutFrom(entry, own);
    const src = tex.getSourceImage() as { width: number; height: number };
    const needW = columns(layout) * layout.frameWidth, needH = layout.rows.length * layout.frameHeight;
    if (src.width < needW || src.height < needH) throw new Error(`walk.png is ${src.width}×${src.height}, the layout needs ${needW}×${needH}`);
    addFrames(tex, layout);
    data.layout = layout;
  } catch (err) {
    console.warn(`[sprites] ${id}: using the procedural rig (${(err as Error).message})`);
  }
  if (problems.length) console.warn(`[sprites] ${id}: ${problems.join('; ')}`);
  return data.layout;
}

/** Number the cells row-major (as Phaser numbers a spritesheet) and keep the pixels hard-edged. */
function addFrames(tex: Phaser.Textures.Texture, layout: SheetLayout): void {
  const cols = columns(layout);
  for (let r = 0; r < layout.rows.length; r++) for (let c = 0; c < cols; c++) {
    tex.add(r * cols + c, 0, c * layout.frameWidth, r * layout.frameHeight, layout.frameWidth, layout.frameHeight);
  }
  tex.setFilter(Phaser.Textures.FilterMode.NEAREST);
}

/** A character's texture plus its animation state; `apply` shows the current frame on an image. */
export class CharacterSprite {
  readonly sheet: CharacterSheet;
  readonly anim: CharacterAnimator;

  constructor(scene: Phaser.Scene, id: string, look: Look, facing: Facing = 'down') {
    this.sheet = characterSheet(scene, id, look);
    this.anim = new CharacterAnimator(this.sheet.layout, lookHash(id), facing);
  }

  /** Advance the animation (intent, distance actually moved, elapsed time). */
  step(input: AnimInput): this {
    this.anim.step(input);
    return this;
  }

  /**
   * Show the current frame: texture, frame, mirroring and the sheet's foot origin. `withScale` also
   * sets the sheet's display scale; a cast shadow passes false (render/sun's castFrom owns its scale).
   */
  apply(image: Phaser.GameObjects.Image, withScale = true): void {
    const { facing, kind, index } = this.anim.frame, L = this.sheet.layout;
    const { frame, flipX } = frameFor(L, facing, kind, index);
    if (image.texture.key !== this.sheet.key) image.setTexture(this.sheet.key, frame);
    else if (String(image.frame.name) !== String(frame)) image.setFrame(frame);
    if (image.flipX !== flipX) image.setFlipX(flipX);
    const originY = L.footY / L.frameHeight;
    if (image.originX !== 0.5 || image.originY !== originY) image.setOrigin(0.5, originY);
    if (withScale && (image.scaleX !== L.scale || image.scaleY !== L.scale)) image.setScale(L.scale);
  }
}
