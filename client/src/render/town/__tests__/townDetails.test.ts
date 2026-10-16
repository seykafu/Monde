// The town fixes' pure parts: lettering (datestones, signs), hedge/wall/fence runs and the lighthouse beam.
import { describe, expect, it } from 'vitest';
import { GLYPH_H, canLetter, letter, setLine, setText } from '../lettering';
import { E, LINE_GEOMETRY, N, S, W, lineMasks, paintLine, type LineKind } from '../lineArt';
import { BEAM_SQUASH, beamHeading, beamHit, beamOnScreen, headingTo } from '../beam';
import { TH, TW } from '../autotile';

describe('lettering', () => {
  it('sets capitals, digits and the signs\' marks, and nothing else', () => {
    expect(canLetter('WELCOME TO MONDE')).toBe(true);
    expect(canLetter('A. MONDE · MAPS & PRINTS')).toBe(true);
    expect(canLetter('^MONDE')).toBe(true);
    expect(canLetter('Monde')).toBe(false);
    expect(canLetter('£5')).toBe(false);
  });

  it('sets a line a pixel apart, five rows tall, twice the size with ^', () => {
    const l = setLine('1850');
    expect(l.h).toBe(GLYPH_H);
    expect(l.w).toBe(4 * 3 + 3);
    expect(l.ink.some(v => v === 1)).toBe(true);
    expect(setLine('1850', 2).w).toBe(l.w * 2);
    const t = setText('WELCOME TO MONDE|^1838');
    expect(t.h).toBe(GLYPH_H + 2 + GLYPH_H * 2);
  });

  it('keeps every year in the OQ-3 list distinct, and never confuses 1846 with 1850', () => {
    const years = ['1838', '1839', '1841', '1842', '1846', '1850', '1862', '1871', '1888', '1903'];
    const masks = years.map(y => Array.from(setLine(y).ink).join(''));
    expect(new Set(masks).size).toBe(years.length);
  });

  it('paints a style: carved letters with a lit lip, a number on an enamel plate', () => {
    const carved = letter('1850', 'carved');
    expect(carved.w).toBe(setLine('1850').w + 2);
    const colours = new Set<string>();
    for (let i = 0; i < carved.rgba.length; i += 4) if (carved.rgba[i + 3]) colours.add(`${carved.rgba[i]},${carved.rgba[i + 1]},${carved.rgba[i + 2]}`);
    expect(colours.size).toBe(2);
    const plate = letter('9', 'plate');
    // The plate fills its box but for the corners.
    let opaque = 0;
    for (let i = 3; i < plate.rgba.length; i += 4) if (plate.rgba[i]) opaque++;
    expect(opaque).toBe(plate.w * plate.h - 4);
  });
});

describe('hedge, wall and fence runs', () => {
  const alpha = (p: ReturnType<typeof paintLine>, x: number, y: number) => p.rgba[((y - p.oy) * p.w + (x - p.ox)) * 4 + 3]!;
  /** Opaque rows of a piece's column, in the cell's own px (y from its ground top). */
  const column = (p: ReturnType<typeof paintLine>, x: number) => {
    const out: number[] = [];
    for (let y = p.oy; y < p.oy + p.h; y++) if (alpha(p, x, y)) out.push(y);
    return out;
  };

  it('masks each cell by the neighbours that continue its run', () => {
    expect(lineMasks([[1, 1], [2, 1], [3, 1]])).toEqual([E, E | W, W]);
    expect(lineMasks([[1, 1], [1, 2], [2, 2]])).toEqual([S, N | E, W]);
    expect(lineMasks([[5, 5]])).toEqual([0]);
  });

  it.each(['hedge', 'wall', 'fence'] as LineKind[])('%s: a run up the screen joins cell to cell, with a face only at its foot', kind => {
    const g = LINE_GEOMETRY[kind], mid = Math.round(TW / 2);
    const through = paintLine(kind, N | S, 3, 4);
    const rows = column(through, mid);
    // The top surface spans the whole cell (raised by the run's height): no gap where cells meet.
    expect(rows[0]).toBeLessThanOrEqual(-g.h);
    expect(rows[rows.length - 1]).toBeGreaterThanOrEqual(TH - 1 - g.h);
    // The middle of the run shows only its raised top (a fence, a post standing on the ground in each cell); its
    // foot has a face down to the ground.
    expect(rows[rows.length - 1]).toBe(kind === 'fence' ? through.foot - 1 : TH - 1 - g.h);
    const foot = paintLine(kind, N, 3, 5);
    expect(Math.max(...column(foot, mid))).toBe(foot.foot - 1);
    expect(column(foot, mid).filter(y => y > foot.foot - 1 - g.h).length).toBeGreaterThanOrEqual(g.h - 1);
    // Away from the run's band the cell is clear.
    expect(column(through, 2)).toEqual([]);
  });

  it.each(['hedge', 'wall', 'fence'] as LineKind[])('%s: a run across the screen fills the cell edge to edge', kind => {
    const p = paintLine(kind, E | W, 7, 2);
    expect(column(p, 0).length).toBeGreaterThan(0);
    expect(column(p, TW - 1).length).toBeGreaterThan(0);
    expect(p.foot).toBeGreaterThan(TH / 2);
  });

  it('is the same every time and differs from cell to cell', () => {
    expect(paintLine('hedge', E | W, 3, 3).rgba).toEqual(paintLine('hedge', E | W, 3, 3).rgba);
    expect(paintLine('hedge', E | W, 3, 3).rgba).not.toEqual(paintLine('hedge', E | W, 4, 3).rgba);
  });
});

describe('the lighthouse beam', () => {
  it('turns once a period and foreshortens north–south', () => {
    expect(beamHeading(0)).toBe(0);
    expect(beamHeading(14 / 4)).toBeCloseTo(Math.PI / 2);
    expect(beamHeading(14)).toBeCloseTo(0);
    expect(beamOnScreen(0).length).toBeCloseTo(1);
    expect(beamOnScreen(Math.PI / 2).length).toBeCloseTo(BEAM_SQUASH);
    expect(beamOnScreen(Math.PI / 2).rotation).toBeCloseTo(Math.PI / 2);
  });

  it('flashes a stone only while the beam is on it', () => {
    const stone = headingTo(100, 75);
    expect(stone).toBeCloseTo(Math.PI / 4);
    expect(beamHit(stone, stone)).toBe(1);
    expect(beamHit(stone + 0.05, stone)).toBeGreaterThan(0);
    expect(beamHit(stone + 0.5, stone)).toBe(0);
    expect(beamHit(0.01, Math.PI * 2 - 0.01)).toBeGreaterThan(0); // across the wrap
  });
});
