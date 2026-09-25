/**
 * Collision-aware label placement. Each label has an anchor point; the
 * placer tries positions around it (right, above, left, below, then the
 * diagonals, at growing distances) and keeps the one that overlaps least
 * with the obstacles, the frame edge, and the labels already placed.
 * Greedy, in the order given, so put the most important labels first.
 * @module core/labels
 */

const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function outside(box, frame) {
  if (!frame) return 0;
  const inside = overlap(box, frame);
  return box.w * box.h - inside;
}

/**
 * Place labels next to their anchors without covering each other or the
 * obstacles.
 * @param {Array<{label: import('./node.js').Node, anchor: [number, number]}>} items
 * @param {{obstacles?: Array<import('./node.js').Node|{x: number, y: number, w: number, h: number}>, gap?: number, distances?: number[], frame?: {x: number, y: number, w: number, h: number}|null, preferred?: Array<[number, number]>}} [opts]
 *   gap: space between anchor and label edge (default 0.15); distances: extra steps tried outward (default [0, 0.2, 0.45]); frame: world box labels must stay inside (default the 16 by 9 frame); preferred: directions to try first
 * @returns {Array<{label: any, box: {x: number, y: number, w: number, h: number}, cost: number}>} where each label went, with its leftover overlap (0 when clear)
 */
export function placeLabels(items, opts = {}) {
  const gap = opts.gap ?? 0.15;
  const distances = opts.distances ?? [0, 0.2, 0.45];
  const frame = opts.frame === undefined ? { x: -8, y: -4.5, w: 16, h: 9 } : opts.frame;
  const dirs = [...(opts.preferred ?? []), ...DIRECTIONS];
  const obstacles = (opts.obstacles ?? []).map((o) => (typeof o.bounds === 'function' ? o.bounds() : o)).filter(Boolean);
  const placed = [];
  const out = [];
  for (const { label, anchor } of items) {
    const b = label.bounds();
    if (!b) continue;
    const c = label.center();
    let best = null;
    for (const d of distances) {
      for (const [dx, dy] of dirs) {
        // Offset so the label's near edge (or corner) sits gap + d from the anchor.
        const cx = anchor[0] + dx * (b.w / 2 + gap + d);
        const cy = anchor[1] + dy * (b.h / 2 + gap + d);
        const box = { x: cx - b.w / 2, y: cy - b.h / 2, w: b.w, h: b.h };
        let cost = outside(box, frame) * 4;
        for (const o of obstacles) cost += overlap(box, o);
        for (const p of placed) cost += overlap(box, p) * 2;
        // Small preference for near and earlier candidates keeps ties stable.
        cost += d * 1e-3;
        if (!best || cost < best.cost - 1e-12) best = { box, cost, cx, cy };
      }
      if (best && best.cost < 1e-2) break;
    }
    label.shift(best.cx - c[0], best.cy - c[1]);
    placed.push(best.box);
    out.push({ label, box: best.box, cost: best.cost });
  }
  return out;
}
