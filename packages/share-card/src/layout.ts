/** Pure geometry helpers. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Lays `count` equal square cells into a grid `width` px wide with `rows` rows (filled
 * row-major, so day 1 is top-left and days read like text). Cells are centered horizontally in `width`.
 */
export function gridLayout(
  count: number,
  width: number,
  rows: number,
  gap: number,
): { cell: number; cols: number; rects: Rect[]; height: number; width: number } {
  const cols = Math.max(1, Math.ceil(count / rows));
  const cell = Math.floor((width - gap * (cols - 1)) / cols);
  const usedWidth = cols * cell + (cols - 1) * gap;
  const offset = Math.floor((width - usedWidth) / 2);
  const rects: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    rects.push({ x: offset + col * (cell + gap), y: row * (cell + gap), w: cell, h: cell });
  }
  return { cell, cols, rects, height: rows * cell + (rows - 1) * gap, width: usedWidth };
}

/** Splits `width` into columns proportional to `weights`, separated by `gap`. */
export function columns(x: number, width: number, weights: readonly number[], gap: number): Rect[] {
  const n = weights.length;
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const free = width - gap * Math.max(0, n - 1);
  let cx = x;
  return weights.map((wt) => {
    const w = (free * wt) / sum;
    const r = { x: cx, y: 0, w, h: 0 };
    cx += w + gap;
    return r;
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
