// Lit windows for the town at night (GDD §16.4: "glowing windows (occupied homes only)"). Pure: no Phaser,
// no DOM.
//
// The building art has no window layer, so the windows are found in it: small, compact patches of glass
// (dark slate-blue panes, or panes already warm with lamplight) of window size, inside a frame (the ring
// round the patch is clearly lighter than dark glass, or darker than lit glass). Each patch becomes warm
// light, brightest in its middle, and TownBoard lays the result over the building with additive blending
// as the lamps come on. Roofs are glass-coloured too, but they come in large sheets, or in slates with no
// frame round them, and beige stone is warm but not saturated, so the tests throw them out.

export interface WindowMask {
  width: number;
  height: number;
  /** RGBA, the glow to add over the building. */
  rgba: Uint8ClampedArray;
  /** How many window patches were found. */
  windows: number;
}

const lum = (r: number, g: number, b: number): number => (r * 3 + g * 6 + b) / 10;
/** 1: dark slate-blue glass, 2: glass already warm with lamplight, 0: not glass. */
const glassKind = (r: number, g: number, b: number): number => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, l = lum(r, g, b);
  if (b >= r + 8 && b >= g - 6 && l < 150 && l > 18 && sat < 0.62) return 1;
  if (r > 215 && g > 140 && sat > 0.5 && r >= g && g > b) return 2;
  return 0;
};

/** Find the window panes in an RGBA image and paint their glow. */
export function detectWindows(src: Uint8ClampedArray | Uint8Array, width: number, height: number): WindowMask {
  const glass = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (src[o + 3]! > 0) glass[i] = glassKind(src[o]!, src[o + 1]!, src[o + 2]!);
  }
  const lumAt = (p: number) => lum(src[p * 4]!, src[p * 4 + 1]!, src[p * 4 + 2]!);
  const label = new Int32Array(width * height).fill(-1);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const stack: number[] = [];
  let windows = 0;
  for (let start = 0; start < width * height; start++) {
    if (!glass[start] || label[start]! >= 0) continue;
    // Flood the patch.
    const pts: number[] = [];
    stack.push(start); label[start] = start;
    let x0 = width, x1 = -1, y0 = height, y1 = -1;
    while (stack.length) {
      const p = stack.pop()!;
      pts.push(p);
      const x = p % width, y = (p - x) / width;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1]) {
        if (q >= 0 && glass[q] && label[q]! < 0) { label[q] = start; stack.push(q); }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, area = pts.length;
    if (area < 10 || area > 500 || bw < 3 || bh < 4 || bw > 40 || bh > 44 || area / (bw * bh) < 0.5) continue;
    // A pane has a frame: the ring of pixels round it is lighter than dark glass (sash, sill, plaster), or
    // darker than glass already glowing. Slate on a roof sits in more slate, stone in its mortar: no frame.
    let ringSum = 0, ringN = 0, ringLen = 0, paneSum = 0, warm = 0;
    for (let x = x0 - 1; x <= x1 + 1; x++) for (const y of [y0 - 1, y1 + 1]) {
      ringLen++;
      if (x >= 0 && y >= 0 && x < width && y < height && src[(y * width + x) * 4 + 3]! > 0) { ringSum += lumAt(y * width + x); ringN++; }
    }
    for (let y = y0; y <= y1; y++) for (const x of [x0 - 1, x1 + 1]) {
      ringLen++;
      if (x >= 0 && x < width && src[(y * width + x) * 4 + 3]! > 0) { ringSum += lumAt(y * width + x); ringN++; }
    }
    for (const p of pts) { paneSum += lumAt(p); if (glass[p] === 2) warm++; }
    if (ringN < ringLen * 0.8) continue;
    const ring = ringSum / ringN, pane = paneSum / area;
    if (warm * 2 > area ? ring > pane - 28 : ring < pane + 28) continue;
    windows++;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (const p of pts) {
      const x = p % width, y = (p - x) / width;
      const d = Math.min(1, Math.hypot((x - cx) / (bw / 2 + 0.5), (y - cy) / (bh / 2 + 0.5)));
      const o = p * 4;
      // Warm lamplight, paler at the heart of the pane.
      rgba[o] = 255; rgba[o + 1] = Math.round(196 + (1 - d) * 40); rgba[o + 2] = Math.round(96 + (1 - d) * 70); rgba[o + 3] = 255;
    }
  }
  return { width, height, rgba, windows };
}
