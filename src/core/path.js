/**
 * Path geometry. Every shape in the engine resolves to a Path: a list of
 * subpaths made of cubic Bezier segments. One representation keeps morphing,
 * draw-on, hand-drawn transforms, and every renderer simple.
 *
 * A subpath stores a flat point array:
 *   [x0, y0,  c1x, c1y, c2x, c2y, x1, y1,  c1x, c1y, c2x, c2y, x2, y2, ...]
 * so its length is 2 + 6k for k segments.
 *
 * @module core/path
 */

/**
 * @typedef {Object} Subpath
 * @property {number[]} points Flat cubic point array, length 2 + 6k.
 * @property {boolean} closed Whether the subpath closes back to its start.
 */

/**
 * @typedef {Object} Path
 * @property {Subpath[]} subpaths
 */

const KAPPA = 0.5522847498307936;

/** @returns {Path} An empty path. */
export function emptyPath() {
  return { subpaths: [] };
}

/**
 * Deep copy of a path.
 * @param {Path} p
 * @returns {Path}
 */
export function clonePath(p) {
  return { subpaths: p.subpaths.map((s) => ({ points: s.points.slice(), closed: s.closed })) };
}

/**
 * Incremental path builder with SVG-like commands.
 */
export class PathBuilder {
  constructor() {
    /** @type {Subpath[]} */
    this.subpaths = [];
    /** @type {Subpath|null} */
    this.cur = null;
    this.x = 0;
    this.y = 0;
  }

  /** @param {number} x @param {number} y @returns {this} */
  moveTo(x, y) {
    this.cur = { points: [x, y], closed: false };
    this.subpaths.push(this.cur);
    this.x = x;
    this.y = y;
    return this;
  }

  /** @param {number} x @param {number} y @returns {this} */
  lineTo(x, y) {
    if (!this.cur) return this.moveTo(x, y);
    const x0 = this.x;
    const y0 = this.y;
    this.cur.points.push(x0 + (x - x0) / 3, y0 + (y - y0) / 3, x0 + (2 * (x - x0)) / 3, y0 + (2 * (y - y0)) / 3, x, y);
    this.x = x;
    this.y = y;
    return this;
  }

  /** Quadratic Bezier to (x, y) with control (cx, cy). @returns {this} */
  quadTo(cx, cy, x, y) {
    if (!this.cur) this.moveTo(this.x, this.y);
    const x0 = this.x;
    const y0 = this.y;
    this.cur.points.push(x0 + (2 / 3) * (cx - x0), y0 + (2 / 3) * (cy - y0), x + (2 / 3) * (cx - x), y + (2 / 3) * (cy - y), x, y);
    this.x = x;
    this.y = y;
    return this;
  }

  /** Cubic Bezier. @returns {this} */
  cubicTo(c1x, c1y, c2x, c2y, x, y) {
    if (!this.cur) this.moveTo(this.x, this.y);
    this.cur.points.push(c1x, c1y, c2x, c2y, x, y);
    this.x = x;
    this.y = y;
    return this;
  }

  /**
   * Circular arc around (cx, cy) from angle a0 to a1 (radians, counterclockwise
   * when a1 > a0). Starts with a lineTo if a subpath is open, else a moveTo.
   * @returns {this}
   */
  arc(cx, cy, r, a0, a1, rx = r) {
    const sweep = a1 - a0;
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const d = sweep / n;
    const k = (4 / 3) * Math.tan(d / 4);
    const sx = cx + rx * Math.cos(a0);
    const sy = cy + r * Math.sin(a0);
    if (this.cur) this.lineTo(sx, sy);
    else this.moveTo(sx, sy);
    for (let i = 0; i < n; i++) {
      const t0 = a0 + i * d;
      const t1 = t0 + d;
      const c0 = Math.cos(t0);
      const s0 = Math.sin(t0);
      const c1 = Math.cos(t1);
      const s1 = Math.sin(t1);
      this.cubicTo(cx + rx * (c0 - k * s0), cy + r * (s0 + k * c0), cx + rx * (c1 + k * s1), cy + r * (s1 - k * c1), cx + rx * c1, cy + r * s1);
    }
    return this;
  }

  /** Close the current subpath. @returns {this} */
  close() {
    if (this.cur) {
      const p = this.cur.points;
      const x0 = p[0];
      const y0 = p[1];
      if (Math.abs(this.x - x0) > 1e-9 || Math.abs(this.y - y0) > 1e-9) this.lineTo(x0, y0);
      this.cur.closed = true;
      this.x = x0;
      this.y = y0;
      this.cur = null;
    }
    return this;
  }

  /** @returns {Path} */
  build() {
    return { subpaths: this.subpaths.filter((s) => s.points.length >= 2) };
  }
}

/**
 * Circle as four cubic arcs, starting at angle 0 and running counterclockwise.
 * @param {number} cx @param {number} cy @param {number} r
 * @returns {Path}
 */
export function circlePath(cx, cy, r) {
  return ellipsePath(cx, cy, r, r);
}

/**
 * @param {number} cx @param {number} cy @param {number} rx @param {number} ry
 * @returns {Path}
 */
export function ellipsePath(cx, cy, rx, ry) {
  const k = KAPPA;
  const pts = [
    cx + rx, cy,
    cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry,
    cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy,
    cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry,
    cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy,
  ];
  return { subpaths: [{ points: pts, closed: true }] };
}

/**
 * Polyline or polygon through points.
 * @param {Array<[number, number]>} pts
 * @param {boolean} [closed=false]
 * @returns {Path}
 */
export function polyPath(pts, closed = false) {
  if (!pts.length) return emptyPath();
  const b = new PathBuilder().moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) b.lineTo(pts[i][0], pts[i][1]);
  if (closed) b.close();
  return b.build();
}

/**
 * Rectangle with optional corner radius, centered on (cx, cy).
 * @returns {Path}
 */
export function rectPath(cx, cy, w, h, radius = 0) {
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const x1 = cx + w / 2;
  const y1 = cy + h / 2;
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r <= 0) return polyPath([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true);
  const b = new PathBuilder();
  b.moveTo(x0 + r, y0);
  b.lineTo(x1 - r, y0);
  b.arc(x1 - r, y0 + r, r, -Math.PI / 2, 0);
  b.lineTo(x1, y1 - r);
  b.arc(x1 - r, y1 - r, r, 0, Math.PI / 2);
  b.lineTo(x0 + r, y1);
  b.arc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI);
  b.lineTo(x0, y0 + r);
  b.arc(x0 + r, y0 + r, r, Math.PI, (3 * Math.PI) / 2);
  b.close();
  return b.build();
}

/**
 * Affine transform of a path. Matrix [a, b, c, d, e, f] maps
 * (x, y) to (a x + c y + e, b x + d y + f), the Canvas2D convention.
 * @param {Path} p
 * @param {number[]} m
 * @returns {Path}
 */
export function transformPath(p, m) {
  const [a, b, c, d, e, f] = m;
  return {
    subpaths: p.subpaths.map((s) => {
      const src = s.points;
      const out = new Array(src.length);
      for (let i = 0; i < src.length; i += 2) {
        const x = src[i];
        const y = src[i + 1];
        out[i] = a * x + c * y + e;
        out[i + 1] = b * x + d * y + f;
      }
      return { points: out, closed: s.closed };
    }),
  };
}

/**
 * Apply an arbitrary point function to every point, anchors and handles alike.
 * @param {Path} p
 * @param {(x: number, y: number) => [number, number]} fn
 * @returns {Path}
 */
export function mapPoints(p, fn) {
  return {
    subpaths: p.subpaths.map((s) => {
      const out = new Array(s.points.length);
      for (let i = 0; i < s.points.length; i += 2) {
        const [x, y] = fn(s.points[i], s.points[i + 1]);
        out[i] = x;
        out[i + 1] = y;
      }
      return { points: out, closed: s.closed };
    }),
  };
}

/**
 * Concatenate the subpaths of several paths.
 * @param {...Path} paths
 * @returns {Path}
 */
export function mergePaths(...paths) {
  return { subpaths: paths.flatMap((p) => p.subpaths.map((s) => ({ points: s.points.slice(), closed: s.closed }))) };
}

function cubicPoint(p, i, t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [a * p[i] + b * p[i + 2] + c * p[i + 4] + d * p[i + 6], a * p[i + 1] + b * p[i + 3] + c * p[i + 5] + d * p[i + 7]];
}

/**
 * Point on segment k of a subpath at parameter t.
 * @param {Subpath} s @param {number} k @param {number} t
 * @returns {[number, number]}
 */
export function segmentPoint(s, k, t) {
  return cubicPoint(s.points, 6 * k, t);
}

/**
 * Tangent (derivative) of segment k at t.
 * @returns {[number, number]}
 */
export function segmentTangent(s, k, t) {
  const p = s.points;
  const i = 6 * k;
  const mt = 1 - t;
  const a = 3 * mt * mt;
  const b = 6 * mt * t;
  const c = 3 * t * t;
  return [
    a * (p[i + 2] - p[i]) + b * (p[i + 4] - p[i + 2]) + c * (p[i + 6] - p[i + 4]),
    a * (p[i + 3] - p[i + 1]) + b * (p[i + 5] - p[i + 3]) + c * (p[i + 7] - p[i + 5]),
  ];
}

/** Number of cubic segments in a subpath. @param {Subpath} s @returns {number} */
export function segmentCount(s) {
  return (s.points.length - 2) / 6;
}

/**
 * Approximate arc length of one cubic segment by Gauss-Legendre quadrature.
 * @returns {number}
 */
export function segmentLength(s, k) {
  const xs = [-0.9061798459, -0.5384693101, 0, 0.5384693101, 0.9061798459];
  const ws = [0.2369268851, 0.4786286705, 0.5688888889, 0.4786286705, 0.2369268851];
  let L = 0;
  for (let j = 0; j < 5; j++) {
    const t = (xs[j] + 1) / 2;
    const [dx, dy] = segmentTangent(s, k, t);
    L += ws[j] * Math.hypot(dx, dy);
  }
  return L / 2;
}

/** @param {Subpath} s @returns {number} */
export function subpathLength(s) {
  let L = 0;
  for (let k = 0; k < segmentCount(s); k++) L += segmentLength(s, k);
  return L;
}

/** @param {Path} p @returns {number} */
export function pathLength(p) {
  return p.subpaths.reduce((acc, s) => acc + subpathLength(s), 0);
}

/**
 * Axis-aligned bounds from anchors and handles (a tight superset).
 * @param {Path} p
 * @returns {{x: number, y: number, w: number, h: number}|null}
 */
export function pathBounds(p) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of p.subpaths) {
    const n = segmentCount(s);
    if (n === 0) {
      x0 = Math.min(x0, s.points[0]);
      x1 = Math.max(x1, s.points[0]);
      y0 = Math.min(y0, s.points[1]);
      y1 = Math.max(y1, s.points[1]);
      continue;
    }
    for (let k = 0; k < n; k++) {
      for (let j = 0; j <= 8; j++) {
        const [x, y] = segmentPoint(s, k, j / 8);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x0 === Infinity) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Split cubic at t (de Casteljau). Returns two flat 8-number arrays.
 * @param {number[]} c flat array of 8 numbers
 * @param {number} t
 * @returns {[number[], number[]]}
 */
export function splitCubic(c, t) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c;
  const ax = x0 + (x1 - x0) * t;
  const ay = y0 + (y1 - y0) * t;
  const bx = x1 + (x2 - x1) * t;
  const by = y1 + (y2 - y1) * t;
  const cx = x2 + (x3 - x2) * t;
  const cy = y2 + (y3 - y2) * t;
  const dx = ax + (bx - ax) * t;
  const dy = ay + (by - ay) * t;
  const ex = bx + (cx - bx) * t;
  const ey = by + (cy - by) * t;
  const fx = dx + (ex - dx) * t;
  const fy = dy + (ey - dy) * t;
  return [
    [x0, y0, ax, ay, dx, dy, fx, fy],
    [fx, fy, ex, ey, cx, cy, x3, y3],
  ];
}

/**
 * Portion of a path between fractions a and b of its total arc length.
 * Used by draw-on animations. Subpaths are traversed in order.
 * @param {Path} p
 * @param {number} a start fraction in [0, 1]
 * @param {number} b end fraction in [0, 1]
 * @returns {Path}
 */
export function partialPath(p, a, b) {
  if (b <= a) return emptyPath();
  if (a <= 0 && b >= 1) return clonePath(p);
  const lens = [];
  let total = 0;
  for (const s of p.subpaths) {
    const segs = [];
    for (let k = 0; k < segmentCount(s); k++) {
      const L = segmentLength(s, k);
      segs.push(L);
      total += L;
    }
    lens.push(segs);
  }
  if (total === 0) return emptyPath();
  const A = a * total;
  const B = b * total;
  const out = [];
  let acc = 0;
  p.subpaths.forEach((s, si) => {
    let cur = null;
    lens[si].forEach((L, k) => {
      const s0 = acc;
      const s1 = acc + L;
      acc = s1;
      if (s1 <= A || s0 >= B || L === 0) return;
      let seg = s.points.slice(6 * k, 6 * k + 8);
      const ta = Math.max(0, (A - s0) / L);
      const tb = Math.min(1, (B - s0) / L);
      if (tb < 1) seg = splitCubic(seg, tb)[0];
      if (ta > 0) seg = splitCubic(seg, ta / tb)[1];
      if (!cur) {
        cur = { points: [seg[0], seg[1]], closed: false };
        out.push(cur);
      }
      cur.points.push(seg[2], seg[3], seg[4], seg[5], seg[6], seg[7]);
    });
    if (cur && a <= 0 && b >= 1 && s.closed) cur.closed = true;
  });
  return { subpaths: out };
}

/**
 * Subdivide a subpath so it has exactly n segments, splitting the longest
 * segments first. Shape is preserved exactly.
 * @param {Subpath} s
 * @param {number} n
 * @returns {Subpath}
 */
export function subdivideTo(s, n) {
  let segs = [];
  const count = segmentCount(s);
  if (count === 0) {
    const [x, y] = s.points;
    const pts = [x, y];
    for (let i = 0; i < n; i++) pts.push(x, y, x, y, x, y);
    return { points: pts, closed: s.closed };
  }
  for (let k = 0; k < count; k++) segs.push({ c: s.points.slice(6 * k, 6 * k + 8), L: segmentLength(s, k) });
  while (segs.length < n) {
    let best = 0;
    for (let i = 1; i < segs.length; i++) if (segs[i].L > segs[best].L) best = i;
    const [l, r] = splitCubic(segs[best].c, 0.5);
    const half = segs[best].L / 2;
    segs = segs.slice(0, best).concat([{ c: l, L: half }, { c: r, L: half }], segs.slice(best + 1));
  }
  const pts = [segs[0].c[0], segs[0].c[1]];
  for (const g of segs) pts.push(g.c[2], g.c[3], g.c[4], g.c[5], g.c[6], g.c[7]);
  return { points: pts, closed: s.closed };
}

function subpathCentroid(s) {
  let x = 0;
  let y = 0;
  const n = s.points.length / 2;
  for (let i = 0; i < s.points.length; i += 2) {
    x += s.points[i];
    y += s.points[i + 1];
  }
  return [x / n, y / n];
}

function signedArea(s) {
  const p = s.points;
  let A = 0;
  for (let i = 0; i + 3 < p.length; i += 2) A += p[i] * p[i + 3] - p[i + 2] * p[i + 1];
  return A / 2;
}

/**
 * Rotate a closed subpath's start anchor so that it begins at the anchor
 * nearest to (tx, ty). Keeps morphs from twisting.
 */
function rotateStart(s, tx, ty) {
  if (!s.closed) return s;
  const n = segmentCount(s);
  if (n < 2) return s;
  let best = 0;
  let bd = Infinity;
  for (let k = 0; k < n; k++) {
    const d = (s.points[6 * k] - tx) ** 2 + (s.points[6 * k + 1] - ty) ** 2;
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  if (best === 0) return s;
  const segs = [];
  for (let k = 0; k < n; k++) segs.push(s.points.slice(6 * k + 2, 6 * k + 8));
  const order = segs.slice(best).concat(segs.slice(0, best));
  const pts = [s.points[6 * best], s.points[6 * best + 1]];
  for (const g of order) pts.push(...g);
  return { points: pts, closed: true };
}

function reverseSubpath(s) {
  const p = s.points;
  const out = [p[p.length - 2], p[p.length - 1]];
  for (let i = p.length - 8; i >= 0; i -= 6) out.push(p[i + 4], p[i + 5], p[i + 2], p[i + 3], p[i], p[i + 1]);
  return { points: out, closed: s.closed };
}

function degenerateAt(x, y, n, closed) {
  const pts = [x, y];
  for (let i = 0; i < n; i++) pts.push(x, y, x, y, x, y);
  return { points: pts, closed };
}

/**
 * Make two paths compatible for interpolation: same subpath count, and each
 * matched pair of subpaths has the same segment count and a consistent
 * winding and start point. Unmatched subpaths are paired with degenerate
 * subpaths at the centroid of their nearest partner, so extra pieces grow
 * out of or shrink into the shape instead of popping.
 * @param {Path} a
 * @param {Path} b
 * @returns {[Path, Path]}
 */
export function alignPaths(a, b) {
  let A = a.subpaths.filter((s) => s.points.length >= 2);
  let B = b.subpaths.filter((s) => s.points.length >= 2);
  if (!A.length && !B.length) return [emptyPath(), emptyPath()];
  if (!A.length) A = [degenerateAt(...pathCenter(b), 1, false)];
  if (!B.length) B = [degenerateAt(...pathCenter(a), 1, false)];

  // Greedy match by centroid distance, larger subpaths first.
  const ca = A.map(subpathCentroid);
  const cb = B.map(subpathCentroid);
  const la = A.map(subpathLength);
  const lb = B.map(subpathLength);
  const pairs = [];
  const usedA = new Set();
  const usedB = new Set();
  const orderA = A.map((_, i) => i).sort((i, j) => la[j] - la[i]);
  const orderB = B.map((_, i) => i).sort((i, j) => lb[j] - lb[i]);
  const m = Math.min(A.length, B.length);
  for (let r = 0; r < m; r++) {
    // Pair the next largest unmatched subpath of A with its nearest free subpath of B.
    const i = orderA.find((x) => !usedA.has(x));
    let best = -1;
    let bd = Infinity;
    for (const j of orderB) {
      if (usedB.has(j)) continue;
      const d = (ca[i][0] - cb[j][0]) ** 2 + (ca[i][1] - cb[j][1]) ** 2;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    usedA.add(i);
    usedB.add(best);
    pairs.push([i, best]);
  }
  for (let i = 0; i < A.length; i++) if (!usedA.has(i)) pairs.push([i, -1]);
  for (let j = 0; j < B.length; j++) if (!usedB.has(j)) pairs.push([-1, j]);
  pairs.sort((p, q) => (p[0] < 0 ? Infinity : p[0]) - (q[0] < 0 ? Infinity : q[0]));

  const outA = [];
  const outB = [];
  for (const [i, j] of pairs) {
    let sa = i >= 0 ? A[i] : null;
    let sb = j >= 0 ? B[j] : null;
    if (!sa) {
      const [x, y] = nearestCentroid(ca, cb[j]);
      sa = degenerateAt(x, y, 1, sb.closed);
    }
    if (!sb) {
      const [x, y] = nearestCentroid(cb, ca[i]);
      sb = degenerateAt(x, y, 1, sa.closed);
    }
    if (sa.closed && sb.closed && segmentCount(sa) > 0 && segmentCount(sb) > 0) {
      if (Math.sign(signedArea(sa)) !== Math.sign(signedArea(sb)) && signedArea(sa) !== 0 && signedArea(sb) !== 0) sb = reverseSubpath(sb);
      sb = rotateStart(sb, sa.points[0], sa.points[1]);
    }
    const n = Math.max(segmentCount(sa), segmentCount(sb), 1);
    outA.push(subdivideTo(sa, n));
    outB.push(subdivideTo(sb, n));
  }
  return [{ subpaths: outA }, { subpaths: outB }];
}

function nearestCentroid(list, target) {
  if (!list.length) return target;
  let best = list[0];
  let bd = Infinity;
  for (const c of list) {
    const d = (c[0] - target[0]) ** 2 + (c[1] - target[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** Center of a path's bounds. @param {Path} p @returns {[number, number]} */
export function pathCenter(p) {
  const b = pathBounds(p);
  if (!b) return [0, 0];
  return [b.x + b.w / 2, b.y + b.h / 2];
}

/**
 * Interpolate between two aligned paths (see alignPaths).
 * @param {Path} a
 * @param {Path} b
 * @param {number} t
 * @returns {Path}
 */
export function lerpAligned(a, b, t) {
  return {
    subpaths: a.subpaths.map((s, i) => {
      const q = b.subpaths[i].points;
      const out = new Array(s.points.length);
      for (let k = 0; k < out.length; k++) out[k] = s.points[k] + (q[k] - s.points[k]) * t;
      return { points: out, closed: t < 0.5 ? s.closed : b.subpaths[i].closed };
    }),
  };
}

/**
 * Sample points along a path at n evenly spaced arc-length positions.
 * @param {Path} p
 * @param {number} n
 * @returns {Array<[number, number]>}
 */
export function samplePath(p, n) {
  const out = [];
  const L = pathLength(p);
  if (L === 0 || n < 2) return out;
  for (let i = 0; i < n; i++) out.push(pointAtFraction(p, i / (n - 1)));
  return out;
}

/**
 * Point at fraction f of the total arc length, and the tangent angle there.
 * @param {Path} p
 * @param {number} f
 * @returns {[number, number, number]} x, y, angle in radians
 */
export function pointAtFraction(p, f) {
  const total = pathLength(p);
  let target = Math.max(0, Math.min(1, f)) * total;
  for (const s of p.subpaths) {
    for (let k = 0; k < segmentCount(s); k++) {
      const L = segmentLength(s, k);
      if (target <= L || (s === p.subpaths[p.subpaths.length - 1] && k === segmentCount(s) - 1)) {
        let t = L > 0 ? Math.min(1, target / L) : 0;
        // Refine t so that arc length matches (two Newton steps).
        for (let it = 0; it < 3 && L > 0; it++) {
          const part = segmentLength({ points: splitCubic(s.points.slice(6 * k, 6 * k + 8), Math.max(1e-6, t))[0] }, 0);
          const [dx, dy] = segmentTangent(s, k, t);
          const sp = Math.hypot(dx, dy);
          if (sp < 1e-9) break;
          t = Math.max(0, Math.min(1, t - (part - target) / sp));
        }
        const [x, y] = segmentPoint(s, k, t);
        const [dx, dy] = segmentTangent(s, k, t);
        return [x, y, Math.atan2(dy, dx)];
      }
      target -= L;
    }
  }
  const last = p.subpaths[p.subpaths.length - 1];
  if (!last) return [0, 0, 0];
  const n = last.points.length;
  return [last.points[n - 2], last.points[n - 1], 0];
}

/**
 * Flatten a path into polylines with the given tolerance.
 * @param {Path} p
 * @param {number} [tol=0.01]
 * @returns {Array<{pts: Array<[number, number]>, closed: boolean}>}
 */
export function flattenPath(p, tol = 0.01) {
  return p.subpaths.map((s) => {
    const pts = [[s.points[0], s.points[1]]];
    for (let k = 0; k < segmentCount(s); k++) {
      const c = s.points.slice(6 * k, 6 * k + 8);
      const dd = Math.hypot(c[2] - c[0], c[3] - c[1]) + Math.hypot(c[4] - c[2], c[5] - c[3]) + Math.hypot(c[6] - c[4], c[7] - c[5]);
      const n = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(dd / tol) / 2)));
      for (let j = 1; j <= n; j++) pts.push(segmentPoint(s, k, j / n));
    }
    return { pts, closed: s.closed };
  });
}

/**
 * Parse an SVG path `d` attribute into a Path. Supports M L H V C S Q T A Z in
 * absolute and relative forms.
 * @param {string} d
 * @returns {Path}
 */
export function parseSVGPath(d) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  const b = new PathBuilder();
  let i = 0;
  let cmd = '';
  let lastC2 = null;
  let lastQ = null;
  let startX = 0;
  let startY = 0;
  const num = () => parseFloat(tokens[i++]);
  const isNum = () => i < tokens.length && !/[A-Za-z]/.test(tokens[i]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) throw new Error(`SVG path: expected a command at token ${i}`);
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? b.x : 0;
    const oy = rel ? b.y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        const x = num() + ox;
        const y = num() + oy;
        b.moveTo(x, y);
        startX = x;
        startY = y;
        cmd = rel ? 'l' : 'L';
        lastC2 = lastQ = null;
        break;
      }
      case 'L':
        b.lineTo(num() + ox, num() + oy);
        lastC2 = lastQ = null;
        break;
      case 'H':
        b.lineTo(num() + ox, b.y);
        lastC2 = lastQ = null;
        break;
      case 'V':
        b.lineTo(b.x, num() + oy);
        lastC2 = lastQ = null;
        break;
      case 'C': {
        const c1x = num() + ox;
        const c1y = num() + oy;
        const c2x = num() + ox;
        const c2y = num() + oy;
        const x = num() + ox;
        const y = num() + oy;
        b.cubicTo(c1x, c1y, c2x, c2y, x, y);
        lastC2 = [c2x, c2y];
        lastQ = null;
        break;
      }
      case 'S': {
        const c1x = lastC2 ? 2 * b.x - lastC2[0] : b.x;
        const c1y = lastC2 ? 2 * b.y - lastC2[1] : b.y;
        const c2x = num() + ox;
        const c2y = num() + oy;
        const x = num() + ox;
        const y = num() + oy;
        b.cubicTo(c1x, c1y, c2x, c2y, x, y);
        lastC2 = [c2x, c2y];
        lastQ = null;
        break;
      }
      case 'Q': {
        const cx = num() + ox;
        const cy = num() + oy;
        const x = num() + ox;
        const y = num() + oy;
        b.quadTo(cx, cy, x, y);
        lastQ = [cx, cy];
        lastC2 = null;
        break;
      }
      case 'T': {
        const cx = lastQ ? 2 * b.x - lastQ[0] : b.x;
        const cy = lastQ ? 2 * b.y - lastQ[1] : b.y;
        const x = num() + ox;
        const y = num() + oy;
        b.quadTo(cx, cy, x, y);
        lastQ = [cx, cy];
        lastC2 = null;
        break;
      }
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num();
        const sweep = num();
        const x = num() + ox;
        const y = num() + oy;
        svgArc(b, b.x, b.y, rx, ry, rot, large, sweep, x, y);
        lastC2 = lastQ = null;
        break;
      }
      case 'Z':
        b.close();
        b.x = startX;
        b.y = startY;
        lastC2 = lastQ = null;
        break;
      default:
        throw new Error(`SVG path: unknown command ${cmd}`);
    }
    if (cmd.toUpperCase() === 'Z') continue;
    if (!isNum() && i < tokens.length && !/[A-Za-z]/.test(tokens[i])) i++;
  }
  return b.build();
}

function svgArc(b, x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (rx === 0 || ry === 0) {
    b.lineTo(x2, y2);
    return;
  }
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const d = dt / n;
  const k = (4 / 3) * Math.tan(d / 4);
  const pt = (t) => {
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy];
  };
  const dp = (t) => {
    const ex = -rx * Math.sin(t);
    const ey = ry * Math.cos(t);
    return [cos * ex - sin * ey, sin * ex + cos * ey];
  };
  for (let i = 0; i < n; i++) {
    const a = t1 + i * d;
    const e = a + d;
    const [ax, ay] = pt(a);
    const [ex, ey] = pt(e);
    const [dax, day] = dp(a);
    const [dex, dey] = dp(e);
    b.cubicTo(ax + k * dax, ay + k * day, ex - k * dex, ey - k * dey, ex, ey);
  }
}

/**
 * Serialize a path to an SVG `d` string.
 * @param {Path} p
 * @param {number} [digits=3]
 * @returns {string}
 */
export function toSVGPath(p, digits = 3) {
  const f = (v) => {
    const s = v.toFixed(digits);
    return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  };
  const parts = [];
  for (const s of p.subpaths) {
    const q = s.points;
    parts.push(`M${f(q[0])} ${f(q[1])}`);
    for (let i = 2; i < q.length; i += 6) parts.push(`C${f(q[i])} ${f(q[i + 1])} ${f(q[i + 2])} ${f(q[i + 3])} ${f(q[i + 4])} ${f(q[i + 5])}`);
    if (s.closed) parts.push('Z');
  }
  return parts.join('');
}

/**
 * Trace a path into a Canvas2D-like context (moveTo, bezierCurveTo, closePath).
 * @param {{moveTo: Function, bezierCurveTo: Function, closePath: Function}} ctx
 * @param {Path} p
 */
export function tracePath(ctx, p) {
  for (const s of p.subpaths) {
    const q = s.points;
    ctx.moveTo(q[0], q[1]);
    for (let i = 2; i < q.length; i += 6) ctx.bezierCurveTo(q[i], q[i + 1], q[i + 2], q[i + 3], q[i + 4], q[i + 5]);
    if (s.closed) ctx.closePath();
  }
}
