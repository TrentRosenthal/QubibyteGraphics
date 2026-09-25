/**
 * Linear transformations of the plane, drawn the way 3Blue1Brown does: a
 * faint fixed background grid, a brighter grid carried by the matrix, the
 * basis vectors i-hat and j-hat, and optionally the unit square whose area
 * is the determinant. The matrix entries are tracked, so applying a matrix
 * animates the grid.
 * @module explainers/linear
 */

import { Node } from '../core/node.js';
import { polyPath, transformPath, circlePath, PathBuilder } from '../core/path.js';
import { pushPathItem } from '../core/sampler.js';
import { Animation } from '../core/animations.js';

/**
 * Polar decomposition of a 2x2 matrix A = R S with R a rotation and S
 * symmetric positive semidefinite (reflections fold into S's sign).
 * @param {number[]} m [a, b, c, d] for [[a, b], [c, d]]
 * @returns {{angle: number, S: number[]}}
 */
export function polar2(m) {
  const [a, b, c, d] = m;
  // R is the rotation closest to A: angle of (a + d, c - b).
  const angle = Math.atan2(c - b, a + d);
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  // S = R^T A
  return { angle, S: [cs * a + sn * c, cs * b + sn * d, -sn * a + cs * c, -sn * b + cs * d] };
}

/**
 * Matrix on the path from the identity to A at u in [0, 1]. 'linear'
 * interpolates entries (a straight shear); 'polar' rotates and stretches
 * separately, which reads more naturally for rotations.
 * @param {number[]} A [a, b, c, d]
 * @param {number} u
 * @param {'linear'|'polar'} [mode='linear']
 * @param {number[]} [from=[1,0,0,1]] start matrix
 * @returns {number[]}
 */
export function matrixPath(A, u, mode = 'linear', from = [1, 0, 0, 1]) {
  if (mode === 'linear') return A.map((v, i) => from[i] + (v - from[i]) * u);
  const P0 = polar2(from);
  const P1 = polar2(A);
  let dA = P1.angle - P0.angle;
  while (dA > Math.PI) dA -= 2 * Math.PI;
  while (dA < -Math.PI) dA += 2 * Math.PI;
  const ang = P0.angle + dA * u;
  const S = P0.S.map((v, i) => v + (P1.S[i] - v) * u);
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  return [cs * S[0] - sn * S[2], cs * S[1] - sn * S[3], sn * S[0] + cs * S[2], sn * S[1] + cs * S[3]];
}

/**
 * A plane that a 2x2 matrix acts on.
 */
export class TransformPlane extends Node {
  /**
   * @param {Record<string, any>} [props] range (grid half-extent in data units, default 7 x 4), unit (world units per data unit, default 1), square (show the unit square), basis (show i-hat and j-hat, default true), vectors (extra vectors [[x, y, color], ...]), clip (keep the transformed grid inside the range box)
   */
  constructor(props = {}) {
    super('transformPlane', { stroke: 'accent', ...pick(props) });
    this._define('a', 1);
    this._define('b', 0);
    this._define('c', 0);
    this._define('d', 1);
    this.range = props.range ?? [7, 4];
    this.unit = props.unit ?? 1;
    this.showSquare = props.square ?? false;
    this.showBasis = props.basis ?? true;
    this.vectors = props.vectors ?? [];
    this.mode = props.mode ?? 'linear';
    this.clip = props.clip ?? false;
  }

  /** Current matrix [a, b, c, d]. @returns {number[]} */
  matrix() {
    return [this.get('a'), this.get('b'), this.get('c'), this.get('d')];
  }

  /**
   * World point of data (x, y) under the current matrix.
   * @param {number} x
   * @param {number} y
   * @returns {[number, number]}
   */
  apply(x, y) {
    const [a, b, c, d] = this.matrix();
    const u = this.unit;
    const m = this.worldMatrix();
    const lx = (a * x + b * y) * u;
    const ly = (c * x + d * y) * u;
    return [m[0] * lx + m[2] * ly + m[4], m[1] * lx + m[3] * ly + m[5]];
  }

  geometry() {
    const [W, H] = this.range;
    const u = this.unit;
    return polyPath([[-W * u, -H * u], [W * u, H * u]]);
  }

  resolvedGeometry() {
    return null;
  }

  sampleItems(c) {
    const [W, H] = this.range;
    const u = this.unit;
    const M = this.matrix();
    const draw = this.get('draw');
    const lin = [M[0] * u, M[2] * u, M[1] * u, M[3] * u, 0, 0];
    const th = c.theme;
    const push = (path, stroke, width, alpha, id, extra = {}) => {
      const col = c.color(stroke);
      if (!col) return;
      const k = { ...c, opacity: c.opacity * alpha };
      const node = this;
      pushPathItem(node, draw < 1 ? trim(path, draw) : path, k, { strokeColor: stroke, strokeWidth: width, noFill: !extra.fill, fillColor: extra.fill, meta: { ...node.meta, part: id, solidFill: !!extra.fill } });
    };
    // Background grid stays put.
    const bgGrid = new PathBuilder();
    for (let x = -W; x <= W; x++) bgGrid.moveTo(x * u, -H * u).lineTo(x * u, H * u);
    for (let y = -H; y <= H; y++) bgGrid.moveTo(-W * u, y * u).lineTo(W * u, y * u);
    push(bgGrid.build(), 'grid', th.stroke.grid, 0.8, 'bg');
    // Transformed grid: extend well beyond the range so the edges never
    // show, or clip it to the range box when the plane shares the frame.
    const ext = this.clip ? 12 : 3;
    const box = [-W * u, W * u, -H * u, H * u];
    const segments = (list) => {
      const pb = new PathBuilder();
      for (const [x0, y0, x1, y1] of list) {
        const a = [lin[0] * x0 + lin[2] * y0, lin[1] * x0 + lin[3] * y0];
        const b = [lin[0] * x1 + lin[2] * y1, lin[1] * x1 + lin[3] * y1];
        const seg = this.clip ? clipSegment(a, b, box) : [a, b];
        if (seg) pb.moveTo(seg[0][0], seg[0][1]).lineTo(seg[1][0], seg[1][1]);
      }
      return pb.build();
    };
    const lines = [];
    for (let x = -W * ext; x <= W * ext; x++) lines.push([x, -H * ext, x, H * ext]);
    for (let y = -H * ext; y <= H * ext; y++) lines.push([-W * ext, y, W * ext, y]);
    push(segments(lines), 'accent', 2, 0.45, 'grid');
    const axes = segments([[-W * ext, 0, W * ext, 0]]);
    const axes2 = segments([[0, -H * ext, 0, H * ext]]);
    push(axes, 'ink', 2.6, 0.9, 'axisX');
    push(axes2, 'ink', 2.6, 0.9, 'axisY');
    if (this.showSquare) {
      const sq = transformPath(polyPath([[0, 0], [1, 0], [1, 1], [0, 1]], true), lin);
      pushPathItem(this, sq, { ...c, opacity: c.opacity * Math.min(1, draw * 2) }, { fillColor: 'ink', strokeColor: 'ink', strokeWidth: 2, meta: { ...this.meta, part: 'square', hatch: true } });
      const item = c.items[c.items.length - 1];
      if (item.fill) item.fill = { ...item.fill, a: item.fill.a * 0.12 };
      if (item.stroke) item.stroke = { ...item.stroke, a: item.stroke.a * 0.55 };
    }
    const arrow = (x, y, color, id) => {
      const [px, py] = [lin[0] * x + lin[2] * y, lin[1] * x + lin[3] * y];
      const L = Math.hypot(px, py);
      if (L < 1e-6) return;
      const ux = px / L;
      const uy = py / L;
      const h = Math.min(0.26, L * 0.4);
      const shaft = polyPath([[0, 0], [px - ux * h * 0.8, py - uy * h * 0.8]]);
      push(shaft, color, 5, 1, `${id}shaft`);
      const head = polyPath([[px, py], [px - ux * h - uy * h * 0.55, py - uy * h + ux * h * 0.55], [px - ux * h + uy * h * 0.55, py - uy * h - ux * h * 0.55]], true);
      pushPathItem(this, head, c, { fillColor: color, strokeColor: null, strokeWidth: 0, meta: { ...this.meta, part: `${id}head`, solidFill: true } });
    };
    if (this.showBasis) {
      arrow(1, 0, 'accent', 'i');
      arrow(0, 1, 'accent2', 'j');
    }
    this.vectors.forEach(([x, y, color], i) => arrow(x, y, color ?? 'ink', `v${i}`));
    pushPathItem(this, circlePath(0, 0, 0.06), c, { fillColor: 'ink', strokeColor: null, strokeWidth: 0, meta: { ...this.meta, part: 'origin', solidFill: true } });
  }
}

/**
 * Clip a segment to an axis-aligned box (Liang-Barsky).
 * @param {number[]} a
 * @param {number[]} b
 * @param {number[]} box [xMin, xMax, yMin, yMax]
 * @returns {number[][]|null}
 */
function clipSegment(a, b, box) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - box[0], box[1] - a[0], a[1] - box[2], box[3] - a[1]];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

function trim(path, f) {
  const out = { subpaths: [] };
  const n = Math.max(1, Math.round(path.subpaths.length * f));
  out.subpaths = path.subpaths.slice(0, n);
  return out;
}

function pick(props) {
  const out = {};
  for (const k of ['x', 'y', 'position', 'opacity', 'id', 'name', 'tokens', 'scale']) if (props[k] !== undefined) out[k] = props[k];
  return out;
}

/**
 * Animate a plane to a matrix along a linear or polar path.
 */
export class ApplyMatrix extends Animation {
  /**
   * @param {TransformPlane} plane
   * @param {number[]} A [[a, b], [c, d]] as [a, b, c, d], or nested [[a, b], [c, d]]
   * @param {Record<string, any>} [opts] mode ('linear' | 'polar'), compose (true: apply A after the current matrix)
   */
  constructor(plane, A, opts = {}) {
    super(opts);
    this.plane = plane;
    this.A = Array.isArray(A[0]) ? [A[0][0], A[0][1], A[1][0], A[1][1]] : A;
    this.mode = opts.mode ?? plane.mode;
    this.compose = opts.compose ?? true;
    this.defaultDuration = 2;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const p = this.plane;
    const from = [p._cur.a, p._cur.b, p._cur.c, p._cur.d];
    const [a, b, c, d] = this.A;
    const target = this.compose ? [a * from[0] + b * from[2], a * from[1] + b * from[3], c * from[0] + d * from[2], c * from[1] + d * from[3]] : this.A;
    const at = (u) => matrixPath(target, u, this.mode, from);
    ['a', 'b', 'c', 'd'].forEach((k, i) => p.tween(k, s, e, target[i], this.ease, (u) => at(u)[i]));
    return e;
  }
}

/**
 * @param {TransformPlane} plane
 * @param {number[]|number[][]} A
 * @param {Record<string, any>} [opts]
 * @returns {ApplyMatrix}
 */
export function applyMatrix(plane, A, opts) {
  return new ApplyMatrix(plane, A, opts);
}
