// Moving water for the town (GDD §16.4: "water (animated, with foam on banks)"). Pure: no Phaser, no DOM.
//
// The water's colour is baked (terrainBake.ts); what moves is a layer of light on top: short crests of
// pale blue with a white glint now and then, drawn once as a seamless RIPPLE_W × RIPPLE_H pattern per style
// and scrolled by TownWater.ts. Rivers carry their crests downstream at a walking pace; the sea's two
// crossing patterns drift slowly and the whole surface rises and falls with the swell; a pond barely
// moves. Each style scrolls as a whole, so the animation costs a few small texture redraws per second, not
// one tween per tile.

import type { Flow, TownTerrain } from '../../world/townTerrain';
import { hash01 } from './autotile';

/** 4 × 4 tiles: water tiles show the cell (x mod 4, y mod 4) of their style's pattern. */
export const RIPPLE_W = 192;
export const RIPPLE_H = 144;

export type WaterStyle = 'sea' | 'shallows' | 'pond' | `river-${Flow}`;

export const waterStyle = (kind: TownTerrain, flow?: Flow): WaterStyle | null =>
  kind === 'sea' ? 'sea' : kind === 'shallows' ? 'shallows' : kind === 'pond' ? 'pond' : kind === 'river' ? `river-${flow ?? 'east'}` : null;

interface StyleArt { crests: number; length: [number, number]; colour: number; alpha: number; glint: number }
const ART: Readonly<Record<'sea' | 'shallows' | 'pond' | 'river', StyleArt>> = {
  sea: { crests: 46, length: [4, 9], colour: 0x9ad8f0, alpha: 200, glint: 0.3 },
  shallows: { crests: 30, length: [3, 7], colour: 0xd4f4f2, alpha: 190, glint: 0.25 },
  pond: { crests: 12, length: [3, 6], colour: 0xa8dcd6, alpha: 150, glint: 0.15 },
  river: { crests: 40, length: [3, 8], colour: 0xa6dcf2, alpha: 210, glint: 0.3 }
};

/** One style's crest pattern (RGBA, RIPPLE_W × RIPPLE_H, seamless). `layer` gives the sea its second set. */
export function ripplePattern(style: WaterStyle, seed: number, layer = 0): Uint8ClampedArray {
  const art = ART[style.startsWith('river') ? 'river' : (style as 'sea' | 'shallows' | 'pond')];
  const out = new Uint8ClampedArray(RIPPLE_W * RIPPLE_H * 4);
  const vertical = style === 'river-north' || style === 'river-south';
  const put = (x: number, y: number, c: number, a: number) => {
    const i = ((((y % RIPPLE_H) + RIPPLE_H) % RIPPLE_H) * RIPPLE_W + (((x % RIPPLE_W) + RIPPLE_W) % RIPPLE_W)) * 4;
    out[i] = (c >> 16) & 0xff; out[i + 1] = (c >> 8) & 0xff; out[i + 2] = c & 0xff; out[i + 3] = a;
  };
  const s = seed * 31 + layer * 977 + style.length * 7;
  for (let n = 0; n < art.crests; n++) {
    const x = Math.floor(hash01(n, 1, s) * RIPPLE_W), y = Math.floor(hash01(n, 2, s) * RIPPLE_H);
    const len = art.length[0] + Math.floor(hash01(n, 3, s) * (art.length[1] - art.length[0] + 1));
    // A crest is a shallow arc: its middle a pixel higher than its ends (on a river running north or south,
    // crests lie across the stream, still horizontal on screen: the ¾ view sees the water's lit faces).
    for (let i = 0; i < len; i++) {
      const lift = i > 0 && i < len - 1 && len > 3 ? 1 : 0;
      put(x + i, y - lift, art.colour, art.alpha);
      if (vertical && i === 0) put(x, y + 1, art.colour, art.alpha >> 1);
    }
    if (hash01(n, 4, s) < art.glint) put(x + (len >> 1), y - 1 - (len > 3 ? 1 : 0), 0xffffff, 255);
  }
  return out;
}

/** Scroll speed of a style, world px per second (x, y). */
export function flowVelocity(style: WaterStyle, layer = 0): [number, number] {
  switch (style) {
    case 'river-east': return [16, 0];
    case 'river-west': return [-16, 0];
    case 'river-north': return [0, -12];
    case 'river-south': return [0, 12];
    case 'sea': return layer === 0 ? [3.5, 1.2] : [-2.5, 0.8];
    case 'shallows': return [2, 1.5];
    case 'pond': return [0.8, 0.3];
  }
}

/** The sea's swell: a slow rise and fall of the crest layer's offset (px) and brightness. */
export function swell(t: number): { dy: number; light: number } {
  return { dy: Math.sin(t * 0.55) * 1.6 + Math.sin(t * 0.21 + 1.3) * 1.1, light: 0.82 + 0.18 * Math.sin(t * 0.55 + 0.6) };
}
