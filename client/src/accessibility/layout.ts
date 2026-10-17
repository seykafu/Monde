// GDD-GAP: §18 does not prescribe enlarged notebook layout. Preserve row order with a 6px reading gap.
export function reflowRows(rows: readonly { y: number; height: number }[]): number[] {
  let bottom = -Infinity, previous = -Infinity, placed = 0;
  return rows.map(row => {
    if (row.y !== previous) placed = Math.max(row.y, bottom + 6);
    previous = row.y;
    bottom = Math.max(bottom, placed + row.height);
    return placed;
  });
}
export function focusScroll(scroll: number, y: number, height: number, top: number, bottom: number, limit: number): number {
  return Math.max(0, Math.min(limit, y < scroll + top ? y - top : y + height > scroll + bottom ? y + height - bottom : scroll));
}
