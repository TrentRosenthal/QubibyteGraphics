/**
 * Snapping for the visual editor: a moving box snaps its edges and center
 * to other boxes' edges and centers (and the frame's), or else to a grid.
 * Works in world units; the caller converts its pixel threshold.
 * @module editor/ui/snapping
 */

/**
 * @typedef {{x: number, y: number, w: number, h: number}} Box
 * @typedef {{axis: 'x'|'y', at: number, from: number, to: number}} Guide
 */

function lines(b) {
  return {
    x: [b.x, b.x + b.w / 2, b.x + b.w],
    y: [b.y, b.y + b.h / 2, b.y + b.h],
  };
}

/**
 * Snap a moving box.
 * @param {Box} box the box after the raw move
 * @param {Box[]} targets other boxes (include the frame to snap to its edges and center)
 * @param {{threshold: number, grid?: number|null}} opts threshold and grid step in world units
 * @returns {{dx: number, dy: number, guides: Guide[]}}
 */
export function snapBox(box, targets, opts) {
  const me = lines(box);
  const best = { x: null, y: null };
  for (const t of targets) {
    const other = lines(t);
    for (const axis of ['x', 'y']) {
      for (const a of me[axis]) {
        for (const b of other[axis]) {
          const d = b - a;
          if (Math.abs(d) > opts.threshold) continue;
          if (!best[axis] || Math.abs(d) < Math.abs(best[axis].d) - 1e-9) best[axis] = { d, at: b, t };
        }
      }
    }
  }
  let dx = best.x ? best.x.d : 0;
  let dy = best.y ? best.y.d : 0;
  if (opts.grid && !best.x) {
    const cx = box.x + box.w / 2;
    dx = Math.round(cx / opts.grid) * opts.grid - cx;
  }
  if (opts.grid && !best.y) {
    const cy = box.y + box.h / 2;
    dy = Math.round(cy / opts.grid) * opts.grid - cy;
  }
  const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  const guides = [];
  if (best.x) {
    const t = best.x.t;
    guides.push({ axis: 'x', at: best.x.at, from: Math.min(moved.y, t.y), to: Math.max(moved.y + moved.h, t.y + t.h) });
  }
  if (best.y) {
    const t = best.y.t;
    guides.push({ axis: 'y', at: best.y.at, from: Math.min(moved.x, t.x), to: Math.max(moved.x + moved.w, t.x + t.w) });
  }
  return { dx, dy, guides };
}
