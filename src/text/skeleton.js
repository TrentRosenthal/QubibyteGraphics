/**
 * Stroke order for outline-only glyphs. A filled outline (a KaTeX symbol or a
 * glyph from a user font) has no pen strokes, so we derive a centerline:
 *
 *   1. rasterize the outline with a scanline fill (nonzero by default,
 *      even-odd on request),
 *   2. thin the bitmap to a one-pixel skeleton (Zhang-Suen),
 *   3. trace the skeleton graph into polylines between endpoints and
 *      junctions, prune short spurs and join strokes that meet end to end,
 *   4. orient each stroke the way a pen moves (left to right, top to bottom;
 *      loops counterclockwise from their top), order strokes top to bottom
 *      then left to right, and smooth them with Chaikin corner cutting.
 *
 * Output strokes use the same shape as {@link module:text/hershey}.
 *
 * @module text/skeleton
 */

import { flattenPath, pathBounds } from '../core/path.js';

/**
 * @typedef {import('../core/path.js').Path} Path
 * @typedef {import('./hershey.js').Stroke} Stroke
 */

/**
 * @typedef {Object} Bitmap
 * @property {number} w Width in pixels.
 * @property {number} h Height in pixels.
 * @property {Uint8Array} data Row-major, 1 = inside. Row 0 is the top.
 * @property {number} x0 World x of the left edge of column 0.
 * @property {number} y1 World y of the top edge of row 0.
 * @property {number} px World size of one pixel.
 */

/**
 * Rasterize a path with a scanline fill, sampling pixel centers. The default
 * nonzero rule matches how glyph outlines and KaTeX's SVG shapes are filled
 * (overlapping contours stay solid); `fillRule: 'evenodd'` is available.
 * @param {Path} path
 * @param {{resolution?: number, pad?: number, fillRule?: 'nonzero'|'evenodd'}} [opts] `resolution` is pixels across the larger side of the bounds (default 96).
 * @returns {Bitmap|null} Null for an empty path.
 */
export function rasterizePath(path, opts = {}) {
  const b = pathBounds(path);
  if (!b || (b.w === 0 && b.h === 0)) return null;
  const res = opts.resolution || 96;
  const pad = opts.pad == null ? 2 : opts.pad;
  const evenOdd = opts.fillRule === 'evenodd';
  const px = Math.max(b.w, b.h) / res;
  const w = Math.ceil(b.w / px) + 2 * pad;
  const h = Math.ceil(b.h / px) + 2 * pad;
  const x0 = b.x - pad * px;
  const y1 = b.y + b.h + pad * px;
  const data = new Uint8Array(w * h);
  const edges = [];
  for (const poly of flattenPath(path, px / 4)) {
    const pts = poly.pts;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (a[1] !== c[1]) edges.push(a, c);
    }
  }
  const xs = [];
  for (let row = 0; row < h; row++) {
    const y = y1 - (row + 0.5) * px;
    xs.length = 0;
    for (let e = 0; e < edges.length; e += 2) {
      const a = edges[e];
      const c = edges[e + 1];
      if ((a[1] <= y && c[1] > y) || (c[1] <= y && a[1] > y)) xs.push([a[0] + ((y - a[1]) / (c[1] - a[1])) * (c[0] - a[0]), c[1] > a[1] ? 1 : -1]);
    }
    xs.sort((p, q) => p[0] - q[0]);
    let wind = 0;
    for (let k = 0; k + 1 < xs.length; k++) {
      wind = evenOdd ? wind ^ 1 : wind + xs[k][1];
      if (!wind) continue;
      const c0 = Math.max(0, Math.ceil((xs[k][0] - x0) / px - 0.5));
      const c1 = Math.min(w - 1, Math.floor((xs[k + 1][0] - x0) / px - 0.5));
      for (let col = c0; col <= c1; col++) data[row * w + col] = 1;
    }
  }
  return { w, h, data, x0, y1, px };
}

/**
 * Zhang-Suen thinning, in place.
 * @param {Bitmap} bm
 * @returns {Bitmap}
 */
export function thin(bm) {
  const { w, h, data } = bm;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[y * w + x]);
  let changed = true;
  const del = [];
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!data[y * w + x]) continue;
          const p2 = at(x, y - 1);
          const p3 = at(x + 1, y - 1);
          const p4 = at(x + 1, y);
          const p5 = at(x + 1, y + 1);
          const p6 = at(x, y + 1);
          const p7 = at(x - 1, y + 1);
          const p8 = at(x - 1, y);
          const p9 = at(x - 1, y - 1);
          const n = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (n < 2 || n > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let t = 0;
          for (let i = 0; i < 8; i++) if (!seq[i] && seq[i + 1]) t++;
          if (t !== 1) continue;
          if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
          del.push(y * w + x);
        }
      }
      for (const i of del) data[i] = 0;
      if (del.length) changed = true;
    }
  }
  return bm;
}

const N8 = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];

/** Trace a one-pixel skeleton into pixel polylines, using m-adjacency so staircase corners do not read as junctions. */
function trace(bm) {
  const { w, h, data } = bm;
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] === 1;
  const nbrs = (i) => {
    const x = i % w;
    const y = (i - x) / w;
    const out = [];
    for (const [dx, dy] of N8) {
      if (!on(x + dx, y + dy)) continue;
      if (dx && dy && (on(x + dx, y) || on(x, y + dy))) continue;
      out.push((y + dy) * w + x + dx);
    }
    return out;
  };
  const deg = new Map();
  for (let i = 0; i < data.length; i++) if (data[i]) deg.set(i, nbrs(i).length);
  const isNode = (i) => deg.get(i) !== 2;
  const used = new Set();
  const ek = (a, b) => (a < b ? a * data.length + b : b * data.length + a);
  const lines = [];
  const walk = (start, next) => {
    const line = [start];
    let prev = start;
    let cur = next;
    used.add(ek(prev, cur));
    for (;;) {
      line.push(cur);
      if (isNode(cur) || cur === start) break;
      const nx = nbrs(cur).find((n) => n !== prev && !used.has(ek(cur, n)));
      if (nx === undefined) break;
      used.add(ek(cur, nx));
      prev = cur;
      cur = nx;
    }
    return line;
  };
  const starts = [...deg.keys()].filter(isNode).sort((a, b) => deg.get(a) - deg.get(b));
  for (const s of starts) {
    for (const n of nbrs(s)) if (!used.has(ek(s, n))) lines.push(walk(s, n));
  }
  for (const s of deg.keys()) {
    for (const n of nbrs(s)) if (!used.has(ek(s, n))) lines.push(walk(s, n));
  }
  return lines.map((l) => l.map((i) => [i % w, Math.floor(i / w)]));
}

const key = (p) => p[0] + ',' + p[1];

/** Remove short branches that end in a free endpoint, then join strokes meeting end to end, and at junctions join the two branches that continue most straight. */
function cleanUp(lines, spur) {
  const plen = (l) => {
    let s = 0;
    for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
    return s;
  };
  let ls = lines.filter((l) => l.length > 1);
  for (let iter = 0; iter < 4; iter++) {
    const count = new Map();
    for (const l of ls) for (const p of [l[0], l[l.length - 1]]) count.set(key(p), (count.get(key(p)) || 0) + 1);
    const before = ls.length;
    ls = ls.filter((l) => {
      if (ls.length <= 1) return true;
      const a = count.get(key(l[0]));
      const b = count.get(key(l[l.length - 1]));
      const free = (a === 1) !== (b === 1);
      return !(free && plen(l) < spur);
    });
    if (ls.length === before) break;
  }
  let merged = true;
  while (merged) {
    merged = false;
    const ends = new Map();
    ls.forEach((l, i) => {
      if (key(l[0]) === key(l[l.length - 1])) return;
      for (const p of [l[0], l[l.length - 1]]) {
        const k = key(p);
        if (!ends.has(k)) ends.set(k, []);
        ends.get(k).push(i);
      }
    });
    for (const [k, idx] of ends) {
      if (idx.length < 2 || new Set(idx).size !== idx.length) continue;
      if (idx.length > 2) {
        const dir = (i) => {
          const l = key(ls[i][0]) === k ? ls[i] : ls[i].slice().reverse();
          const q = l[Math.min(l.length - 1, 6)];
          const L = Math.hypot(q[0] - l[0][0], q[1] - l[0][1]) || 1;
          return [(q[0] - l[0][0]) / L, (q[1] - l[0][1]) / L];
        };
        let best = null;
        for (let u = 0; u < idx.length; u++) {
          for (let v = u + 1; v < idx.length; v++) {
            const a = dir(idx[u]);
            const b = dir(idx[v]);
            const dot = a[0] * b[0] + a[1] * b[1];
            if (dot < -0.7 && (!best || dot < best[0])) best = [dot, idx[u], idx[v]];
          }
        }
        if (!best) continue;
        idx.length = 0;
        idx.push(best[1], best[2]);
      }
      let a = ls[idx[0]];
      let b = ls[idx[1]];
      if (key(a[a.length - 1]) !== k) a = a.slice().reverse();
      if (key(b[0]) !== k) b = b.slice().reverse();
      const joined = a.concat(b.slice(1));
      ls = ls.filter((_, i) => i !== idx[0] && i !== idx[1]);
      ls.push(joined);
      merged = true;
      break;
    }
  }
  return ls;
}

/**
 * Thinning eats about half a stroke width off every free end. Walk each free
 * end outward along its direction while the original ink continues, so the
 * pen reaches the tip of the stroke.
 */
function extendEnds(lines, ink, w, h) {
  const count = new Map();
  for (const l of lines) for (const p of [l[0], l[l.length - 1]]) count.set(key(p), (count.get(key(p)) || 0) + 1);
  const inkAt = (x, y) => {
    const cx = Math.round(x);
    const cy = Math.round(y);
    return cx >= 0 && cy >= 0 && cx < w && cy < h && ink[cy * w + cx] === 1;
  };
  const grow = (l) => {
    const end = l[l.length - 1];
    const ref = l[Math.max(0, l.length - 6)];
    let dx = end[0] - ref[0];
    let dy = end[1] - ref[1];
    const L = Math.hypot(dx, dy);
    if (!L) return l;
    dx /= L;
    dy /= L;
    const out = l.slice();
    let x = end[0];
    let y = end[1];
    for (let k = 0; k < 40 && inkAt(x + dx, y + dy); k++) {
      x += dx;
      y += dy;
    }
    if (x !== end[0] || y !== end[1]) out.push([x, y]);
    return out;
  };
  return lines.map((l) => {
    if (key(l[0]) === key(l[l.length - 1])) return l;
    let r = l;
    if (count.get(key(r[r.length - 1])) === 1) r = grow(r);
    if (count.get(key(r[0])) === 1) r = grow(r.slice().reverse()).reverse();
    return r;
  });
}

function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  let idx = 0;
  let dmax = 0;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const L = Math.hypot(bx - ax, by - ay);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = L ? Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
    if (d > dmax) {
      dmax = d;
      idx = i;
    }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}

function chaikin(pts, closed, n) {
  let p = pts;
  for (let it = 0; it < n; it++) {
    if (p.length < 3) return p;
    const out = closed ? [] : [p[0]];
    const m = closed ? p.length - 1 : p.length - 1;
    for (let i = 0; i < m; i++) {
      const a = p[i];
      const b = p[i + 1];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (closed) out.push(out[0]);
    else out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/**
 * Derive pen strokes from a filled outline.
 * @param {Path} path Outline (any units, y up).
 * @param {{resolution?: number, smooth?: number, glyphIndex?: number, fillRule?: 'nonzero'|'evenodd'}} [opts] `resolution` in pixels across the glyph (default 96); `smooth` Chaikin iterations (default 2).
 * @returns {Stroke[]} Strokes in the path's units, in drawing order.
 */
export function skeletonize(path, opts = {}) {
  const bm = rasterizePath(path, opts);
  if (!bm) return [];
  const ink = bm.data.slice();
  thin(bm);
  const res = opts.resolution || 96;
  const lines = extendEnds(cleanUp(trace(bm), Math.max(3, res * 0.08)), ink, bm.w, bm.h);
  if (!lines.length) {
    const b = pathBounds(path);
    const pts = b.w >= b.h ? [[b.x, b.y + b.h / 2], [b.x + b.w, b.y + b.h / 2]] : [[b.x + b.w / 2, b.y + b.h], [b.x + b.w / 2, b.y]];
    return [{ points: pts, glyphIndex: opts.glyphIndex || 0, strokeIndex: 0 }];
  }
  const toWorld = ([cx, cy]) => [bm.x0 + (cx + 0.5) * bm.px, bm.y1 - (cy + 0.5) * bm.px];
  const strokes = lines.map((l) => {
    let pts = simplify(l, 0.6).map(toWorld);
    const closed = key(l[0]) === key(l[l.length - 1]) && l.length > 2;
    if (closed) {
      pts = pts.slice(0, -1);
      let top = 0;
      for (let i = 1; i < pts.length; i++) if (pts[i][1] > pts[top][1] + 1e-9) top = i;
      pts = pts.slice(top).concat(pts.slice(0, top));
      let area = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        area += a[0] * b[1] - b[0] * a[1];
      }
      if (area < 0) pts = [pts[0]].concat(pts.slice(1).reverse());
      pts.push(pts[0]);
    } else {
      const a = pts[0];
      const b = pts[pts.length - 1];
      const flip = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? b[0] < a[0] : b[1] > a[1];
      if (flip) pts.reverse();
    }
    return { pts: chaikin(pts, closed, opts.smooth == null ? 2 : opts.smooth), closed };
  });
  const height = bm.h * bm.px;
  const band = height * 0.3;
  const info = strokes.map((s) => {
    let top = -Infinity;
    let left = Infinity;
    for (const p of s.pts) {
      top = Math.max(top, p[1]);
      left = Math.min(left, p[0]);
    }
    return { s, band: Math.floor((bm.y1 - top) / band), left };
  });
  info.sort((a, b) => a.band - b.band || a.left - b.left);
  const glyphIndex = opts.glyphIndex || 0;
  return info.map((it, strokeIndex) => ({ points: it.s.pts, glyphIndex, strokeIndex }));
}

/**
 * Pen strokes for a list of positioned glyph outlines (from `layoutText` or
 * `texToPaths`), glyph by glyph in order.
 * @param {{path: Path}[]} glyphs
 * @param {{resolution?: number, smooth?: number}} [opts]
 * @returns {Stroke[]}
 */
export function outlineStrokes(glyphs, opts = {}) {
  const out = [];
  glyphs.forEach((g, glyphIndex) => out.push(...skeletonize(g.path, { ...opts, glyphIndex })));
  return out;
}
