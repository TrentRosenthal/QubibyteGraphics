/**
 * Interpolation: Lagrange form (with basis polynomial values), Newton
 * divided differences (with the full table), natural cubic splines, and
 * Catmull-Rom curves converted to cubic Bezier segments for drawing.
 * Points are {x, y} objects.
 * @module math/interpolate
 */

/** @typedef {{x: number, y: number}} Point */

function checkDistinct(points) {
  const xs = points.map((p) => p.x);
  if (new Set(xs).size !== xs.length) throw new RangeError('Interpolation nodes must have distinct x values');
}

/**
 * Lagrange interpolating polynomial.
 * @param {Point[]} points
 * @returns {{evaluate: (x: number) => number, basis: (x: number) => number[], coefficients: number[]}}
 */
export function lagrange(points) {
  checkDistinct(points);
  const n = points.length;
  const basis = (x) => points.map((pi, i) => {
    let l = 1;
    for (let j = 0; j < n; j++) if (j !== i) l *= (x - points[j].x) / (pi.x - points[j].x);
    return l;
  });
  const evaluate = (x) => basis(x).reduce((s, l, i) => s + l * points[i].y, 0);
  // Monomial coefficients (low degree first) by expanding each basis polynomial.
  const coefficients = new Array(n).fill(0);
  points.forEach((pi, i) => {
    let poly = [1];
    let denom = 1;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const next = new Array(poly.length + 1).fill(0);
      poly.forEach((c, k) => {
        next[k] -= c * points[j].x;
        next[k + 1] += c;
      });
      poly = next;
      denom *= pi.x - points[j].x;
    }
    poly.forEach((c, k) => {
      coefficients[k] += (c * pi.y) / denom;
    });
  });
  return { evaluate, basis, coefficients };
}

/**
 * Newton divided differences.
 * @param {Point[]} points
 * @returns {{table: number[][], coefficients: number[], evaluate: (x: number) => number}}
 */
export function newtonDividedDifferences(points) {
  checkDistinct(points);
  const n = points.length;
  const table = [points.map((p) => p.y)];
  for (let k = 1; k < n; k++) {
    const prev = table[k - 1];
    const row = [];
    for (let i = 0; i < n - k; i++) row.push((prev[i + 1] - prev[i]) / (points[i + k].x - points[i].x));
    table.push(row);
  }
  const coefficients = table.map((row) => row[0]);
  const evaluate = (x) => {
    let acc = coefficients[n - 1];
    for (let k = n - 2; k >= 0; k--) acc = acc * (x - points[k].x) + coefficients[k];
    return acc;
  };
  return { table, coefficients, evaluate };
}

/**
 * Natural cubic spline (second derivative zero at both ends).
 * @param {Point[]} points sorted by x
 * @returns {{segments: {x0: number, x1: number, a: number, b: number, c: number, d: number}[], evaluate: (x: number) => number}}
 */
export function naturalCubicSpline(points) {
  checkDistinct(points);
  const pts = points.slice().sort((p, q) => p.x - q.x);
  const n = pts.length - 1;
  if (n < 1) throw new RangeError('A spline needs at least two points');
  const h = [];
  for (let i = 0; i < n; i++) h.push(pts[i + 1].x - pts[i].x);
  const alpha = new Array(n + 1).fill(0);
  for (let i = 1; i < n; i++) alpha[i] = (3 / h[i]) * (pts[i + 1].y - pts[i].y) - (3 / h[i - 1]) * (pts[i].y - pts[i - 1].y);
  const l = new Array(n + 1).fill(1);
  const mu = new Array(n + 1).fill(0);
  const z = new Array(n + 1).fill(0);
  for (let i = 1; i < n; i++) {
    l[i] = 2 * (pts[i + 1].x - pts[i - 1].x) - h[i - 1] * mu[i - 1];
    mu[i] = h[i] / l[i];
    z[i] = (alpha[i] - h[i - 1] * z[i - 1]) / l[i];
  }
  const c = new Array(n + 1).fill(0);
  const b = new Array(n).fill(0);
  const d = new Array(n).fill(0);
  for (let j = n - 1; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (pts[j + 1].y - pts[j].y) / h[j] - (h[j] * (c[j + 1] + 2 * c[j])) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }
  const segments = [];
  for (let i = 0; i < n; i++) segments.push({ x0: pts[i].x, x1: pts[i + 1].x, a: pts[i].y, b: b[i], c: c[i], d: d[i] });
  const evaluate = (x) => {
    let i = segments.findIndex((s) => x <= s.x1);
    if (i < 0) i = n - 1;
    const s = segments[i];
    const t = x - s.x0;
    return s.a + t * (s.b + t * (s.c + t * s.d));
  };
  return { segments, evaluate };
}

/**
 * Catmull-Rom curve through the points, as cubic Bezier segments
 * {p0, c1, c2, p1}. alpha = 0 uniform, 0.5 centripetal (no cusps), 1 chordal.
 * @param {Point[]} points
 * @param {{alpha?: number, closed?: boolean}} [opts]
 * @returns {{p0: Point, c1: Point, c2: Point, p1: Point}[]}
 */
export function catmullRom(points, opts = {}) {
  const alpha = opts.alpha ?? 0.5;
  const closed = !!opts.closed;
  const n = points.length;
  if (n < 2) return [];
  const get = (i) => {
    if (closed) return points[((i % n) + n) % n];
    if (i < 0) return { x: 2 * points[0].x - points[1].x, y: 2 * points[0].y - points[1].y };
    if (i >= n) return { x: 2 * points[n - 1].x - points[n - 2].x, y: 2 * points[n - 1].y - points[n - 2].y };
    return points[i];
  };
  const out = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const P0 = get(i - 1);
    const P1 = get(i);
    const P2 = get(i + 1);
    const P3 = get(i + 2);
    const dist = (a, b) => Math.max(1e-12, Math.pow(Math.hypot(b.x - a.x, b.y - a.y), alpha));
    const d1 = dist(P0, P1);
    const d2 = dist(P1, P2);
    const d3 = dist(P2, P3);
    // Tangents of the non-uniform Catmull-Rom spline (Yuksel et al.).
    const m1 = {
      x: d2 * ((P1.x - P0.x) / d1 - (P2.x - P0.x) / (d1 + d2)) + (P2.x - P1.x),
      y: d2 * ((P1.y - P0.y) / d1 - (P2.y - P0.y) / (d1 + d2)) + (P2.y - P1.y),
    };
    const m2 = {
      x: d2 * ((P3.x - P2.x) / d3 - (P3.x - P1.x) / (d2 + d3)) + (P2.x - P1.x),
      y: d2 * ((P3.y - P2.y) / d3 - (P3.y - P1.y) / (d2 + d3)) + (P2.y - P1.y),
    };
    out.push({
      p0: { ...P1 },
      c1: { x: P1.x + m1.x / 3, y: P1.y + m1.y / 3 },
      c2: { x: P2.x - m2.x / 3, y: P2.y - m2.y / 3 },
      p1: { ...P2 },
    });
  }
  return out;
}
