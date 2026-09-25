/**
 * Plane geometry: conic sections from the general quadratic, straightedge
 * and compass construction helpers as pure functions, 2D transformation
 * matrices, and the cyclic and dihedral symmetry groups with Cayley tables.
 * Points are {x, y} objects.
 * @module math/geometry
 */
import { ensureExpr } from './parse.js';
import { polyCoeffs } from './poly.js';
import { simplify } from './simplify.js';
import { num, add, mul } from './expr.js';

/** @typedef {{x: number, y: number}} Point */

const EPS = 1e-12;

function quadraticCoefficients(input) {
  if (input && typeof input === 'object' && 'A' in input) {
    return { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, ...input };
  }
  let e = ensureExpr(input);
  if (e.type === 'eq') e = simplify(add(e.args[0], mul(num(-1), e.args[1])));
  const cx = polyCoeffs(e, 'x');
  if (!cx || cx.length > 3) throw new RangeError('Not a quadratic in x and y');
  const get = (c, k) => (c[k] ? c[k] : null);
  const inY = (c) => {
    if (!c) return [0, 0, 0];
    const cy = polyCoeffs(c, 'y');
    if (!cy || cy.some((q) => q.type !== 'num')) throw new RangeError('Coefficients must be numbers');
    return [0, 1, 2].map((k) => (cy[k] ? cy[k].value.toNumber() : 0));
  };
  const [c0, c1, c2] = [inY(get(cx, 0)), inY(get(cx, 1)), inY(get(cx, 2))];
  return { A: c2[0], B: c1[1], C: c0[2], D: c1[0], E: c0[1], F: c0[0] };
}

function det3(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

function rotate(p, th) {
  return { x: p.x * Math.cos(th) - p.y * Math.sin(th), y: p.x * Math.sin(th) + p.y * Math.cos(th) };
}

/**
 * @typedef {object} Conic
 * @property {'circle'|'ellipse'|'parabola'|'hyperbola'|'degenerate'|'empty'} type
 * @property {{A: number, B: number, C: number, D: number, E: number, F: number}} coefficients
 * @property {number} discriminant B^2 - 4AC
 * @property {Point} [center]
 * @property {number} [angle] rotation of the principal axes (radians)
 * @property {number} [a] semi-major (ellipse) or transverse (hyperbola) semi-axis
 * @property {number} [b] semi-minor or conjugate semi-axis
 * @property {number} [eccentricity]
 * @property {Point[]} [foci]
 * @property {Point[]} [vertices]
 * @property {Point} [vertex] parabola vertex
 * @property {{point: Point, direction: Point}} [directrix] parabola directrix line
 * @property {string} [degenerateKind]
 */

/**
 * Classify the conic A x^2 + B xy + C y^2 + D x + E y + F = 0 and compute
 * its center, axes, foci and eccentricity.
 * @param {string|import('./expr.js').Expr|{A?: number, B?: number, C?: number, D?: number, E?: number, F?: number}} input
 * @returns {Conic}
 */
export function classifyConic(input) {
  const q = quadraticCoefficients(input);
  const { A, B, C, D, E, F } = q;
  const disc = B * B - 4 * A * C;
  const M = [[A, B / 2, D / 2], [B / 2, C, E / 2], [D / 2, E / 2, F]];
  const delta = det3(M);
  const scale = Math.max(1, ...Object.values(q).map(Math.abs));
  const base = { coefficients: q, discriminant: disc };
  const angle = 0.5 * Math.atan2(B, A - C);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Coefficients in the rotated frame (no xy term).
  const Ap = A * c * c + B * c * s + C * s * s;
  const Cp = A * s * s - B * c * s + C * c * c;
  const Dp = D * c + E * s;
  const Ep = -D * s + E * c;
  if (Math.abs(disc) < EPS * scale * scale) {
    if (Math.abs(delta) < EPS * scale ** 3) return { ...base, type: 'degenerate', degenerateKind: 'parallel or coincident lines', angle };
    // Parabola: one of Ap, Cp vanishes.
    const alongY = Math.abs(Cp) < Math.abs(Ap);
    let vertexR;
    let focusR;
    let dirPoint;
    let p;
    if (alongY) {
      // Ap x'^2 + Dp x' + Ep y' + F = 0  =>  y' = -(Ap x'^2 + Dp x' + F) / Ep
      const xv = -Dp / (2 * Ap);
      const yv = -(Ap * xv * xv + Dp * xv + F) / Ep;
      p = -Ep / (4 * Ap);
      vertexR = { x: xv, y: yv };
      focusR = { x: xv, y: yv + p };
      dirPoint = { x: xv, y: yv - p };
    } else {
      const yv = -Ep / (2 * Cp);
      const xv = -(Cp * yv * yv + Ep * yv + F) / Dp;
      p = -Dp / (4 * Cp);
      vertexR = { x: xv, y: yv };
      focusR = { x: xv + p, y: yv };
      dirPoint = { x: xv - p, y: yv };
    }
    const dirDirection = rotate(alongY ? { x: 1, y: 0 } : { x: 0, y: 1 }, angle);
    return {
      ...base, type: 'parabola', angle, eccentricity: 1, vertex: rotate(vertexR, angle), foci: [rotate(focusR, angle)],
      focalLength: Math.abs(p), directrix: { point: rotate(dirPoint, angle), direction: dirDirection },
    };
  }
  const det2 = A * C - (B * B) / 4;
  const center = { x: (B * E - 2 * C * D) / (4 * A * C - B * B), y: (B * D - 2 * A * E) / (4 * A * C - B * B) };
  const Fc = delta / det2;
  if (Math.abs(Fc) < EPS * scale) return { ...base, type: 'degenerate', degenerateKind: disc < 0 ? 'single point' : 'intersecting lines', center, angle };
  let a2 = -Fc / Ap;
  let b2 = -Fc / Cp;
  let theta = angle;
  if (disc < 0) {
    if (a2 < 0 && b2 < 0) return { ...base, type: 'empty', center, angle };
    if (a2 < b2) {
      [a2, b2] = [b2, a2];
      theta += Math.PI / 2;
    }
    const a = Math.sqrt(a2);
    const b = Math.sqrt(b2);
    const ecc = Math.sqrt(Math.max(0, 1 - b2 / a2));
    const u = { x: Math.cos(theta), y: Math.sin(theta) };
    const cf = a * ecc;
    const type = Math.abs(a - b) < 1e-12 * Math.max(1, a) ? 'circle' : 'ellipse';
    return {
      ...base, type, center, angle: theta, a, b, eccentricity: ecc,
      foci: [{ x: center.x - cf * u.x, y: center.y - cf * u.y }, { x: center.x + cf * u.x, y: center.y + cf * u.y }],
      vertices: [{ x: center.x - a * u.x, y: center.y - a * u.y }, { x: center.x + a * u.x, y: center.y + a * u.y }],
    };
  }
  // Hyperbola: the transverse axis is the one with positive a^2.
  if (a2 < 0) {
    [a2, b2] = [b2, a2];
    theta += Math.PI / 2;
  }
  const a = Math.sqrt(a2);
  const b = Math.sqrt(-b2);
  const ecc = Math.sqrt(1 + (b * b) / (a * a));
  const u = { x: Math.cos(theta), y: Math.sin(theta) };
  const cf = a * ecc;
  return {
    ...base, type: 'hyperbola', center, angle: theta, a, b, eccentricity: ecc,
    foci: [{ x: center.x - cf * u.x, y: center.y - cf * u.y }, { x: center.x + cf * u.x, y: center.y + cf * u.y }],
    vertices: [{ x: center.x - a * u.x, y: center.y - a * u.y }, { x: center.x + a * u.x, y: center.y + a * u.y }],
    asymptoteSlopes: [Math.tan(theta + Math.atan(b / a)), Math.tan(theta - Math.atan(b / a))],
  };
}

/**
 * Intersection of line p1p2 with line p3p4, or null when parallel.
 * @param {Point} p1
 * @param {Point} p2
 * @param {Point} p3
 * @param {Point} p4
 * @returns {Point|null}
 */
export function lineLine(p1, p2, p3, p4) {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(d) < EPS) return null;
  const a = p1.x * p2.y - p1.y * p2.x;
  const b = p3.x * p4.y - p3.y * p4.x;
  return { x: (a * (p3.x - p4.x) - (p1.x - p2.x) * b) / d, y: (a * (p3.y - p4.y) - (p1.y - p2.y) * b) / d };
}

/**
 * Intersections of the line through p1, p2 with a circle (0, 1 or 2 points).
 * @param {Point} p1
 * @param {Point} p2
 * @param {Point} center
 * @param {number} r
 * @returns {Point[]}
 */
export function lineCircle(p1, p2, center, r) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const fx = p1.x - center.x;
  const fy = p1.y - center.y;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < -EPS * a * r * r) return [];
  if (Math.abs(disc) <= EPS * a * r * r) {
    const t = -b / (2 * a);
    return [{ x: p1.x + t * dx, y: p1.y + t * dy }];
  }
  const sq = Math.sqrt(disc);
  return [(-b - sq) / (2 * a), (-b + sq) / (2 * a)].map((t) => ({ x: p1.x + t * dx, y: p1.y + t * dy }));
}

/**
 * Intersections of two circles (0, 1 or 2 points; [] for concentric circles).
 * @param {Point} c1
 * @param {number} r1
 * @param {Point} c2
 * @param {number} r2
 * @returns {Point[]}
 */
export function circleCircle(c1, r1, c2, r2) {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS || d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const mx = c1.x + (a * dx) / d;
  const my = c1.y + (a * dy) / d;
  if (h2 <= EPS * r1 * r1) return [{ x: mx, y: my }];
  const h = Math.sqrt(h2);
  return [{ x: mx + (h * dy) / d, y: my - (h * dx) / d }, { x: mx - (h * dy) / d, y: my + (h * dx) / d }];
}

/**
 * Perpendicular bisector of segment ab as a point and unit direction.
 * @param {Point} a
 * @param {Point} b
 * @returns {{point: Point, direction: Point}}
 */
export function perpendicularBisector(a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < EPS) throw new RangeError('The two points coincide');
  return { point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, direction: { x: -(b.y - a.y) / len, y: (b.x - a.x) / len } };
}

/**
 * Bisector of the angle a-vertex-b as the vertex and a unit direction.
 * @param {Point} a
 * @param {Point} vertex
 * @param {Point} b
 * @returns {{point: Point, direction: Point}}
 */
export function angleBisector(a, vertex, b) {
  const u = { x: a.x - vertex.x, y: a.y - vertex.y };
  const v = { x: b.x - vertex.x, y: b.y - vertex.y };
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  if (lu < EPS || lv < EPS) throw new RangeError('Degenerate angle');
  let d = { x: u.x / lu + v.x / lv, y: u.y / lu + v.y / lv };
  let ld = Math.hypot(d.x, d.y);
  if (ld < EPS) {
    d = { x: -u.y / lu, y: u.x / lu };
    ld = 1;
  }
  return { point: { ...vertex }, direction: { x: d.x / ld, y: d.y / ld } };
}

/**
 * 2D rotation matrix.
 * @param {number} theta radians, counterclockwise
 * @returns {number[][]}
 */
export function rotation2D(theta) {
  return [[Math.cos(theta), -Math.sin(theta)], [Math.sin(theta), Math.cos(theta)]];
}

/**
 * 2D scaling matrix.
 * @param {number} sx
 * @param {number} [sy=sx]
 * @returns {number[][]}
 */
export function scaling2D(sx, sy = sx) {
  return [[sx, 0], [0, sy]];
}

/**
 * 2D shear matrix [[1, kx], [ky, 1]].
 * @param {number} kx
 * @param {number} [ky=0]
 * @returns {number[][]}
 */
export function shear2D(kx, ky = 0) {
  return [[1, kx], [ky, 1]];
}

/**
 * Reflection across the line through the origin at angle theta.
 * @param {number} theta
 * @returns {number[][]}
 */
export function reflection2D(theta) {
  return [[Math.cos(2 * theta), Math.sin(2 * theta)], [Math.sin(2 * theta), -Math.cos(2 * theta)]];
}

/**
 * Homogeneous 3x3 matrix for a 2x2 linear part plus a translation.
 * @param {number[][]} [linear=[[1,0],[0,1]]]
 * @param {number} [tx=0]
 * @param {number} [ty=0]
 * @returns {number[][]}
 */
export function affine2D(linear = [[1, 0], [0, 1]], tx = 0, ty = 0) {
  return [[linear[0][0], linear[0][1], tx], [linear[1][0], linear[1][1], ty], [0, 0, 1]];
}

/**
 * Apply a 2x2 or homogeneous 3x3 matrix to points.
 * @param {number[][]} M
 * @param {Point[]} points
 * @returns {Point[]}
 */
export function transformPoints(M, points) {
  const tx = M.length === 3 ? M[0][2] : 0;
  const ty = M.length === 3 ? M[1][2] : 0;
  return points.map((p) => ({ x: M[0][0] * p.x + M[0][1] * p.y + tx, y: M[1][0] * p.x + M[1][1] * p.y + ty }));
}

/**
 * @typedef {object} GroupElement
 * @property {string} name e.g. "e", "r^2", "sr"
 * @property {number[][]} matrix 2x2 orthogonal matrix acting on the plane
 * @property {number[]} permutation image of each vertex of the regular n-gon (vertex j at angle 2 pi j / n)
 */

/**
 * Cyclic group C_n of rotations of a regular n-gon.
 * @param {number} n
 * @returns {GroupElement[]}
 */
export function cyclicGroup(n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    out.push({
      name: k === 0 ? 'e' : k === 1 ? 'r' : 'r^' + k,
      matrix: rotation2D((2 * Math.PI * k) / n),
      permutation: Array.from({ length: n }, (_, j) => (j + k) % n),
    });
  }
  return out;
}

/**
 * Dihedral group D_n (order 2n): rotations r^k and reflections s r^k, where
 * s reflects across the x-axis and s r^k means r^k first, then s.
 * @param {number} n
 * @returns {GroupElement[]}
 */
export function dihedralGroup(n) {
  const rots = cyclicGroup(n);
  const s = [[1, 0], [0, -1]];
  const refl = rots.map((r, k) => ({
    name: k === 0 ? 's' : k === 1 ? 'sr' : 'sr^' + k,
    matrix: [
      [s[0][0] * r.matrix[0][0] + s[0][1] * r.matrix[1][0], s[0][0] * r.matrix[0][1] + s[0][1] * r.matrix[1][1]],
      [s[1][0] * r.matrix[0][0] + s[1][1] * r.matrix[1][0], s[1][0] * r.matrix[0][1] + s[1][1] * r.matrix[1][1]],
    ],
    permutation: Array.from({ length: n }, (_, j) => (((-(j + k)) % n) + n) % n),
  }));
  return [...rots, ...refl];
}

/**
 * Cayley table: entry [i][j] is the index of element i composed with
 * element j (apply j first, then i).
 * @param {GroupElement[]} group
 * @returns {{table: number[][], names: string[][]}}
 */
export function cayleyTable(group) {
  const keyOf = (p) => p.join(',');
  const index = new Map(group.map((g, i) => [keyOf(g.permutation), i]));
  const table = group.map((a) => group.map((b) => {
    const comp = b.permutation.map((v) => a.permutation[v]);
    const k = index.get(keyOf(comp));
    if (k === undefined) throw new RangeError('Elements do not form a group');
    return k;
  }));
  return { table, names: table.map((row) => row.map((k) => group[k].name)) };
}
