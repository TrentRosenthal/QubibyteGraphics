/**
 * Plots that live inside an Axes. Each plot is a child node whose geometry
 * is computed in data space and mapped through the axes every frame, so
 * plots follow zooms, pans, and the Cartesian to polar morph.
 * @module core/plots
 */

import { Node, Group } from './node.js';
import { PathBuilder, polyPath, emptyPath, mergePaths, rectPath, circlePath } from './path.js';
import { catmullRomPath } from './shapes.js';

/** @type {((src: string, vars: string[]) => Function)|null} */
let compiler = null;

/**
 * Install the expression compiler used when plots are given strings. The
 * math module installs one on import.
 * @param {(src: string, vars: string[]) => Function} fn
 */
export function setExpressionCompiler(fn) {
  compiler = fn;
}

/**
 * Turn a function or expression string into a JS function of the given variables.
 * @param {Function|string} f
 * @param {string[]} vars
 * @returns {Function}
 */
export function toFunction(f, vars) {
  if (typeof f === 'function') return f;
  if (typeof f === 'string') {
    if (!compiler) throw new Error('Expression strings need the math module: import it (the main entry point does)');
    return compiler(f, vars);
  }
  throw new Error('Expected a function or an expression string');
}

/**
 * Base for plot nodes: finds the owning axes and maps data points.
 */
export class PlotNode extends Node {
  /** @param {string} type @param {Record<string, any>} props */
  constructor(type, props) {
    super(type, props);
  }

  /** @returns {import('./coords.js').Axes} */
  axes() {
    let p = this.parent;
    while (p && typeof p.toLocal !== 'function') p = p.parent;
    if (!p) throw new Error(`${this.type} must be added to an Axes (axes.add(plot) or axes.plot(...))`);
    return p;
  }

  /**
   * Local point for data (x, y) relative to this node's parent (the axes).
   * @param {number} x
   * @param {number} y
   * @param {Object} [s] axes state
   * @returns {[number, number]}
   */
  map(x, y, s) {
    return this.axes().toLocal(x, y, s);
  }
}

/**
 * Adaptive sampling of y = f(x) on [a, b] in local coordinates, breaking
 * the curve at discontinuities and where it leaves the vertical range.
 * @param {(x: number) => number} f
 * @param {number} a
 * @param {number} b
 * @param {(x: number, y: number) => [number, number]} toLocal
 * @param {{yMin: number, yMax: number, tol?: number, maxDepth?: number, initial?: number}} o
 * @returns {Array<Array<[number, number]>>} polylines in local coordinates
 */
export function sampleFunction(f, a, b, toLocal, o) {
  const tol = o.tol ?? 0.004;
  const maxDepth = o.maxDepth ?? 11;
  const n0 = o.initial ?? 48;
  const span = o.yMax - o.yMin;
  const lo = o.yMin - span * 0.5;
  const hi = o.yMax + span * 0.5;
  const ev = (x) => {
    const y = f(x);
    return Number.isFinite(y) ? y : NaN;
  };
  const pts = [];
  const push = (x, y) => pts.push([x, y]);
  const rec = (x0, y0, x1, y1, depth) => {
    const xm = (x0 + x1) / 2;
    const ym = ev(xm);
    if (depth < maxDepth) {
      const bad = Number.isNaN(y0) !== Number.isNaN(y1) || Number.isNaN(ym) !== Number.isNaN(y0);
      let refine = bad;
      if (!refine && !Number.isNaN(ym) && !Number.isNaN(y0) && !Number.isNaN(y1)) {
        const [p0x, p0y] = toLocal(x0, clampY(y0, lo, hi));
        const [p1x, p1y] = toLocal(x1, clampY(y1, lo, hi));
        const [pmx, pmy] = toLocal(xm, clampY(ym, lo, hi));
        const dev = Math.abs((p1x - p0x) * (p0y - pmy) - (p0x - pmx) * (p1y - p0y)) / (Math.hypot(p1x - p0x, p1y - p0y) || 1);
        refine = dev > tol || Math.abs(p1y - p0y) > 0.5;
      }
      if (refine) {
        rec(x0, y0, xm, ym, depth + 1);
        rec(xm, ym, x1, y1, depth + 1);
        return;
      }
    }
    push(x1, y1);
  };
  let px = a;
  let py = ev(a);
  push(px, py);
  for (let i = 1; i <= n0; i++) {
    const x = a + ((b - a) * i) / n0;
    const y = ev(x);
    rec(px, py, x, y, 0);
    px = x;
    py = y;
  }
  // Split into runs of finite, in-range points; break at vertical jumps.
  const lines = [];
  let cur = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (Number.isNaN(y)) {
      if (cur.length > 1) lines.push(cur);
      cur = [];
      continue;
    }
    if (cur.length) {
      const [x0, y0] = pts[i - 1];
      const jump = Math.abs(y - y0) > span * 2 && Math.abs(x - x0) < (b - a) * 1e-3;
      if (jump) {
        if (cur.length > 1) lines.push(cur);
        cur = [];
      }
    }
    cur.push([x, y]);
  }
  if (cur.length > 1) lines.push(cur);
  // Clip each run to the vertical range, interpolating the crossing points.
  const clipped = [];
  for (const line of lines) {
    let run = [];
    for (let i = 0; i < line.length; i++) {
      const [x, y] = line[i];
      const inside = y >= o.yMin && y <= o.yMax;
      if (i > 0) {
        const [xp, yp] = line[i - 1];
        const insideP = yp >= o.yMin && yp <= o.yMax;
        if (inside !== insideP) {
          const edge = (inside ? yp : y) > o.yMax ? o.yMax : o.yMin;
          const t = (edge - yp) / (y - yp);
          const cx = xp + (x - xp) * t;
          run.push([cx, edge]);
          if (!inside) {
            if (run.length > 1) clipped.push(run);
            run = [];
          }
        }
      }
      if (inside) run.push([x, y]);
    }
    if (run.length > 1) clipped.push(run);
  }
  return clipped.map((line) => line.map(([x, y]) => toLocal(x, y)));
}

function clampY(y, lo, hi) {
  return y < lo ? lo : y > hi ? hi : y;
}

/**
 * Graph of y = f(x).
 */
export class FunctionGraph extends PlotNode {
  /**
   * @param {Function|string} f
   * @param {Record<string, any>} [props] range [a, b] (default the axes x range), stroke ('accent'), strokeWidth
   */
  constructor(f, props = {}) {
    super('functionGraph', { stroke: props.color ?? 'accent', strokeWidth: 4.5, ...strip(props, ['range', 'color']) });
    this.f = toFunction(f, ['x']);
    this.source = typeof f === 'string' ? f : null;
    this.range = props.range ?? null;
    this._define('xStart', props.range ? props.range[0] : NaN);
    this._define('xEnd', props.range ? props.range[1] : NaN);
  }

  /** @returns {[number, number]} */
  domain(s) {
    const a = this.get('xStart');
    const b = this.get('xEnd');
    return [Number.isNaN(a) ? s.xMin : Math.max(a, s.xMin), Number.isNaN(b) ? s.xMax : Math.min(b, s.xMax)];
  }

  geometry() {
    const ax = this.axes();
    const s = ax.state();
    const [a, b] = this.domain(s);
    if (!(b > a)) return emptyPath();
    const f = ax.yScale === 'log' ? (x) => this.f(x) : this.f;
    const lines = sampleFunction(f, a, b, (x, y) => ax.toLocal(x, y, s), { yMin: s.yMin, yMax: s.yMax, tol: 0.002 });
    return mergePaths(...lines.map((l) => (l.length > 3 ? catmullRomPath(l, false) : polyPath(l))));
  }

  /**
   * World point on the graph at x.
   * @param {number} x
   * @returns {[number, number]}
   */
  pointAt(x) {
    return this.axes().c2p(x, this.f(x));
  }
}

/**
 * Parametric curve (x(t), y(t)) in data space.
 */
export class ParametricCurve extends PlotNode {
  /**
   * @param {Function|string[]} f (t) => [x, y], or two expression strings in t
   * @param {Record<string, any>} [props] range [t0, t1] (default [0, 2 pi]), samples (default 400)
   */
  constructor(f, props = {}) {
    super('parametricCurve', { stroke: props.color ?? 'accent', strokeWidth: 4.5, ...strip(props, ['range', 'color', 'samples']) });
    if (Array.isArray(f)) {
      const fx = toFunction(f[0], ['t']);
      const fy = toFunction(f[1], ['t']);
      this.f = (t) => [fx(t), fy(t)];
    } else this.f = f;
    this.range = props.range ?? [0, 2 * Math.PI];
    this.samples = props.samples ?? 400;
  }

  geometry() {
    const ax = this.axes();
    const s = ax.state();
    const [t0, t1] = this.range;
    const pts = [];
    for (let i = 0; i <= this.samples; i++) {
      const [x, y] = this.f(t0 + ((t1 - t0) * i) / this.samples);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push(ax.toLocal(x, y, s));
    }
    return catmullRomPath(pts, false, 0.5);
  }
}

/**
 * Polar graph r = f(theta) drawn into Cartesian axes.
 */
export class PolarGraph extends ParametricCurve {
  /** @param {Function|string} f @param {Record<string, any>} [props] */
  constructor(f, props = {}) {
    const r = toFunction(f, ['theta', 't']);
    super((t) => [r(t) * Math.cos(t), r(t) * Math.sin(t)], props);
    this.type = 'polarGraph';
  }
}

/**
 * Marching squares: contour polylines of F(x, y) = level over a grid.
 * @param {(x: number, y: number) => number} F
 * @param {number[]} xr [x0, x1]
 * @param {number[]} yr [y0, y1]
 * @param {number} nx cells in x
 * @param {number} ny cells in y
 * @param {number} [level=0]
 * @returns {Array<Array<[number, number]>>} polylines in data space
 */
export function marchingSquares(F, xr, yr, nx, ny, level = 0) {
  const [x0, x1] = xr;
  const [y0, y1] = yr;
  const dx = (x1 - x0) / nx;
  const dy = (y1 - y0) / ny;
  const v = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const z = F(x0 + i * dx, y0 + j * dy) - level;
    v[j * (nx + 1) + i] = Number.isFinite(z) ? z : NaN;
  }
  const at = (i, j) => v[j * (nx + 1) + i];
  const segs = [];
  const interp = (xa, ya, va, xb, yb, vb) => {
    // Canonical vertex order so both cells sharing an edge compute the identical point.
    if (xa > xb || (xa === xb && ya > yb)) return interp(xb, yb, vb, xa, ya, va);
    const t = va / (va - vb);
    return [xa + (xb - xa) * t, ya + (yb - ya) * t];
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      if ([a, b, c, d].some(Number.isNaN)) continue;
      const xa = x0 + i * dx;
      const ya = y0 + j * dy;
      const xb = xa + dx;
      const yb = ya + dy;
      const idx = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const eB = () => interp(xa, ya, a, xb, ya, b);
      const eR = () => interp(xb, ya, b, xb, yb, c);
      const eT = () => interp(xb, yb, c, xa, yb, d);
      const eL = () => interp(xa, yb, d, xa, ya, a);
      const center = (a + b + c + d) / 4;
      switch (idx) {
        case 1: case 14: segs.push([eL(), eB()]); break;
        case 2: case 13: segs.push([eB(), eR()]); break;
        case 3: case 12: segs.push([eL(), eR()]); break;
        case 4: case 11: segs.push([eR(), eT()]); break;
        case 6: case 9: segs.push([eB(), eT()]); break;
        case 7: case 8: segs.push([eL(), eT()]); break;
        case 5:
          if (center > 0) segs.push([eL(), eT()], [eB(), eR()]);
          else segs.push([eL(), eB()], [eR(), eT()]);
          break;
        case 10:
          if (center > 0) segs.push([eL(), eB()], [eR(), eT()]);
          else segs.push([eL(), eT()], [eB(), eR()]);
          break;
        default:
      }
    }
  }
  return joinSegments(segs, Math.min(dx, dy) * 1e-7);
}

/**
 * Join unordered segments into polylines by matching endpoints.
 * @param {Array<[[number, number], [number, number]]>} segs
 * @param {number} eps
 * @returns {Array<Array<[number, number]>>}
 */
export function joinSegments(segs, eps) {
  const key = (p) => `${Math.round(p[0] / eps)},${Math.round(p[1] / eps)}`;
  const byEnd = new Map();
  segs.forEach((s, i) => {
    for (const e of [0, 1]) {
      const k = key(s[e]);
      if (!byEnd.has(k)) byEnd.set(k, []);
      byEnd.get(k).push([i, e]);
    }
  });
  const used = new Uint8Array(segs.length);
  const lines = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [segs[i][0], segs[i][1]];
    for (const dir of [1, -1]) {
      for (;;) {
        const end = dir === 1 ? line[line.length - 1] : line[0];
        const cands = byEnd.get(key(end)) || [];
        const next = cands.find(([j]) => !used[j]);
        if (!next) break;
        const [j, e] = next;
        used[j] = 1;
        const other = segs[j][1 - e];
        if (dir === 1) line.push(other);
        else line.unshift(other);
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Implicit curve F(x, y) = 0 traced with marching squares.
 */
export class ImplicitCurve extends PlotNode {
  /**
   * @param {Function|string} F (x, y) => number, or an expression in x and y (an equation "lhs = rhs" also works)
   * @param {Record<string, any>} [props] resolution (cells across, default 160), level (0)
   */
  constructor(F, props = {}) {
    super('implicitCurve', { stroke: props.color ?? 'accent', strokeWidth: 4.5, ...strip(props, ['color', 'resolution', 'level']) });
    if (typeof F === 'string' && F.includes('=') && !/[<>!]=|==/.test(F)) {
      const [l, r] = F.split('=');
      const fl = toFunction(l, ['x', 'y']);
      const fr = toFunction(r, ['x', 'y']);
      this.F = (x, y) => fl(x, y) - fr(x, y);
    } else this.F = toFunction(F, ['x', 'y']);
    this.resolution = props.resolution ?? 160;
    this.level = props.level ?? 0;
    this.cache = null;
  }

  geometry() {
    const ax = this.axes();
    const s = ax.state();
    const key = `${s.xMin},${s.xMax},${s.yMin},${s.yMax},${s.width},${s.height},${s.polar}`;
    if (this.cache && this.cache.key === key) return this.cache.path;
    const nx = this.resolution;
    const ny = Math.max(8, Math.round((nx * s.height) / s.width));
    const lines = marchingSquares(this.F, [s.xMin, s.xMax], [s.yMin, s.yMax], nx, ny, this.level);
    const path = mergePaths(...lines.map((l) => polyPath(l.map(([x, y]) => ax.toLocal(x, y, s)), dist(l[0], l[l.length - 1]) < 1e-9)));
    this.cache = { key, path };
    return path;
  }
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Contour lines of a scalar field at several levels.
 */
export class Contours extends Group {
  /**
   * @param {Function|string} F
   * @param {Record<string, any>} [props] levels (array or count, default 9), resolution, color ('muted'), highlight (a level drawn in the accent)
   */
  constructor(F, props = {}) {
    super([], { type: 'contours' });
    this.F = toFunction(F, ['x', 'y']);
    this.levelsSpec = props.levels ?? 9;
    this.resolution = props.resolution ?? 120;
    this.color = props.color ?? 'muted';
    this.highlight = props.highlight ?? null;
    this.built = false;
    this.props = props;
  }

  /** @private */
  _attach(scene) {
    super._attach(scene);
  }

  /**
   * Create one ImplicitCurve per level. Called by `axes.contours()` once the node is in the axes.
   * @param {import('./coords.js').Axes} ax
   */
  build(ax) {
    const s = ax.state();
    let levels = this.levelsSpec;
    if (typeof levels === 'number') {
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = 0; j <= 40; j++) for (let i = 0; i <= 40; i++) {
        const z = this.F(s.xMin + ((s.xMax - s.xMin) * i) / 40, s.yMin + ((s.yMax - s.yMin) * j) / 40);
        if (Number.isFinite(z)) {
          lo = Math.min(lo, z);
          hi = Math.max(hi, z);
        }
      }
      const n = levels;
      levels = Array.from({ length: n }, (_, k) => lo + ((hi - lo) * (k + 1)) / (n + 1));
    }
    this.levels = levels;
    levels.forEach((lv, k) => {
      const hl = this.highlight != null && Math.abs(lv - this.highlight) < 1e-12;
      const c = new ImplicitCurve(this.F, { level: lv, resolution: this.resolution, color: hl ? 'accent' : this.color, strokeWidth: hl ? 4 : 2.5, strokeOpacity: hl ? 1 : 0.35 + (0.55 * (k + 1)) / levels.length });
      this.add(c);
    });
    this.built = true;
  }
}

/**
 * Arrows of a 2D vector field on a grid, scaled to fit their cell and
 * colored by magnitude from muted to accent.
 */
export class VectorField extends Group {
  /**
   * @param {Function|string[]} F (x, y) => [u, v], or two expressions in x and y
   * @param {Record<string, any>} [props] step (data units between arrows, default 1), scale (arrow length factor), color, colorByMagnitude (true)
   */
  constructor(F, props = {}) {
    super([], { type: 'vectorField' });
    if (Array.isArray(F)) {
      const fu = toFunction(F[0], ['x', 'y']);
      const fv = toFunction(F[1], ['x', 'y']);
      this.F = (x, y) => [fu(x, y), fv(x, y)];
    } else this.F = F;
    this.step = props.step ?? 1;
    this.lengthScale = props.scale ?? 0.8;
    this.color = props.color ?? 'accent';
    this.byMagnitude = props.colorByMagnitude ?? true;
  }

  /**
   * Create the arrow nodes. Called by `axes.vectorField()`.
   * @param {import('./coords.js').Axes} ax
   */
  build(ax) {
    const s = ax.state();
    const pts = [];
    let maxM = 0;
    for (let x = Math.ceil(s.xMin / this.step) * this.step; x <= s.xMax + 1e-9; x += this.step) {
      for (let y = Math.ceil(s.yMin / this.step) * this.step; y <= s.yMax + 1e-9; y += this.step) {
        const [u, v] = this.F(x, y);
        const m = Math.hypot(u, v);
        if (Number.isFinite(m)) {
          pts.push([x, y, u, v, m]);
          maxM = Math.max(maxM, m);
        }
      }
    }
    for (const [x, y, u, v, m] of pts) {
      if (m < 1e-12) continue;
      const k = (this.step * this.lengthScale) / (maxM || 1);
      const arrow = new FieldArrow(x, y, u * k, v * k, { stroke: this.color, strokeOpacity: this.byMagnitude ? 0.35 + 0.65 * (m / maxM) : 1 });
      this.add(arrow);
    }
  }
}

class FieldArrow extends PlotNode {
  constructor(x, y, u, v, props) {
    super('fieldArrow', { strokeWidth: 2.5, fill: null, ...props });
    this.d = [x, y, u, v];
  }

  geometry() {
    const ax = this.axes();
    const s = ax.state();
    const [x, y, u, v] = this.d;
    const [ax0, ay0] = ax.toLocal(x - u / 2, y - v / 2, s);
    const [ax1, ay1] = ax.toLocal(x + u / 2, y + v / 2, s);
    const L = Math.hypot(ax1 - ax0, ay1 - ay0);
    if (L < 1e-9) return emptyPath();
    const ux = (ax1 - ax0) / L;
    const uy = (ay1 - ay0) / L;
    const h = Math.min(0.12, L * 0.35);
    const b = new PathBuilder().moveTo(ax0, ay0).lineTo(ax1, ay1);
    b.moveTo(ax1 - ux * h - uy * h * 0.55, ay1 - uy * h + ux * h * 0.55).lineTo(ax1, ay1).lineTo(ax1 - ux * h + uy * h * 0.55, ay1 - uy * h - ux * h * 0.55);
    return b.build();
  }
}

/**
 * Integrate a streamline of a 2D field with RK4.
 * @param {(x: number, y: number) => [number, number]} F
 * @param {[number, number]} p0
 * @param {{h?: number, steps?: number, bounds: number[], normalize?: boolean}} o bounds [xMin, xMax, yMin, yMax]
 * @returns {Array<[number, number]>}
 */
export function streamline(F, p0, o) {
  const h = o.h ?? 0.03;
  const steps = o.steps ?? 400;
  const [x0, x1, y0, y1] = o.bounds;
  const f = (x, y) => {
    const [u, v] = F(x, y);
    if (!o.normalize) return [u, v];
    const m = Math.hypot(u, v) || 1;
    return [u / m, v / m];
  };
  const pts = [p0];
  let [x, y] = p0;
  for (let i = 0; i < steps; i++) {
    const [k1x, k1y] = f(x, y);
    const [k2x, k2y] = f(x + (h / 2) * k1x, y + (h / 2) * k1y);
    const [k3x, k3y] = f(x + (h / 2) * k2x, y + (h / 2) * k2y);
    const [k4x, k4y] = f(x + h * k3x, y + h * k3y);
    const nx = x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    const ny = y + (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx < x0 || nx > x1 || ny < y0 || ny > y1) break;
    if (Math.hypot(nx - x, ny - y) < 1e-6) break;
    x = nx;
    y = ny;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Streamlines of a 2D field from a grid of seeds. Animate flow with
 * `flow(streamlines)`, which moves a bright window along each line.
 */
export class StreamLines extends Group {
  /**
   * @param {Function|string[]} F
   * @param {Record<string, any>} [props] density (seeds per unit, default 0.8), length (steps, 160), color
   */
  constructor(F, props = {}) {
    super([], { type: 'streamLines' });
    if (Array.isArray(F)) {
      const fu = toFunction(F[0], ['x', 'y']);
      const fv = toFunction(F[1], ['x', 'y']);
      this.F = (x, y) => [fu(x, y), fv(x, y)];
    } else this.F = F;
    this.density = props.density ?? 0.8;
    this.length = props.length ?? 160;
    this.color = props.color ?? 'accent';
    this.seedJitter = props.jitter ?? 0.35;
  }

  /**
   * Integrate streamlines. Called by `axes.streamLines()`.
   * @param {import('./coords.js').Axes} ax
   */
  build(ax) {
    const s = ax.state();
    const step = 1 / this.density;
    let k = 0;
    for (let x = s.xMin + step / 2; x < s.xMax; x += step) {
      for (let y = s.yMin + step / 2; y < s.yMax; y += step) {
        const jx = (hash01(k * 2 + 1) - 0.5) * step * this.seedJitter;
        const jy = (hash01(k * 2 + 2) - 0.5) * step * this.seedJitter;
        k++;
        const pts = streamline(this.F, [x + jx, y + jy], { h: step / 20, steps: this.length, bounds: [s.xMin, s.xMax, s.yMin, s.yMax], normalize: true });
        if (pts.length < 4) continue;
        const line = new DataPolyline(pts, { stroke: this.color, strokeWidth: 2.5, strokeOpacity: 0.85 });
        this.add(line);
      }
    }
  }
}

function hash01(n) {
  let h = Math.imul(n | 0, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

/**
 * A polyline given in data coordinates.
 */
export class DataPolyline extends PlotNode {
  /** @param {Array<[number, number]>} points @param {Record<string, any>} [props] smooth (Catmull-Rom, default true), closed */
  constructor(points, props = {}) {
    super(props.type ?? 'dataPolyline', { stroke: 'accent', ...strip(props, ['smooth', 'closed', 'type']) });
    this.points = points;
    this.smooth = props.smooth ?? true;
    this.closed = !!props.closed;
  }

  geometry() {
    const ax = this.axes();
    const s = ax.state();
    const pts = this.points.map(([x, y]) => ax.toLocal(x, y, s));
    return this.smooth ? catmullRomPath(pts, this.closed) : polyPath(pts, this.closed);
  }
}

/**
 * Filled area between a graph and a baseline (or a second graph) over [a, b].
 */
export class AreaUnder extends PlotNode {
  /**
   * @param {FunctionGraph|Function} graph
   * @param {number[]} range [a, b]
   * @param {Record<string, any>} [props] baseline (number or function, default 0), fill ('accent'), fillOpacity (0.3)
   */
  constructor(graph, range, props = {}) {
    super('areaUnder', { fill: props.color ?? 'accent', fillOpacity: 0.28, stroke: null, ...strip(props, ['baseline', 'color']) });
    this.f = typeof graph === 'function' ? graph : graph.f;
    this._define('a', range[0]);
    this._define('b', range[1]);
    const base = props.baseline ?? 0;
    this.g = typeof base === 'function' ? base : () => base;
  }

  geometry() {
    const ax = this.axes();
    const s = ax.state();
    const a = this.get('a');
    const b = this.get('b');
    if (!(b > a)) return emptyPath();
    const n = 160;
    const top = [];
    const bottom = [];
    for (let i = 0; i <= n; i++) {
      const x = a + ((b - a) * i) / n;
      top.push(ax.toLocal(x, clampY(this.f(x), s.yMin, s.yMax), s));
      bottom.push(ax.toLocal(x, clampY(this.g(x), s.yMin, s.yMax), s));
    }
    return polyPath(top.concat(bottom.reverse()), true);
  }
}

/**
 * Riemann sum rectangles for f over [a, b] with n pieces.
 */
export class RiemannRects extends Group {
  /**
   * @param {Function} f
   * @param {number[]} range
   * @param {Record<string, any>} [props] n (8), method ('left'|'right'|'midpoint'|'trapezoid'), fill ('accent'), fillOpacity (0.45), stroke ('accent')
   */
  constructor(f, range, props = {}) {
    super([], { type: 'riemann' });
    this.f = typeof f === 'function' ? f : f.f;
    this.range = range;
    this.n = props.n ?? 8;
    this.method = props.method ?? 'left';
    this.style = { fill: props.color ?? 'accent', fillOpacity: props.fillOpacity ?? 0.45, stroke: props.stroke ?? props.color ?? 'accent', strokeWidth: 2 };
  }

  /** Sum approximated by the rectangles. @returns {number} */
  sum() {
    const [a, b] = this.range;
    const dx = (b - a) / this.n;
    let S = 0;
    for (let i = 0; i < this.n; i++) S += this.height(a + i * dx, a + (i + 1) * dx) * dx;
    return S;
  }

  /** @private */
  height(x0, x1) {
    if (this.method === 'right') return this.f(x1);
    if (this.method === 'midpoint') return this.f((x0 + x1) / 2);
    if (this.method === 'trapezoid') return (this.f(x0) + this.f(x1)) / 2;
    return this.f(x0);
  }

  /**
   * Create the rectangle nodes. Called by `axes.riemann()`.
   */
  build() {
    const [a, b] = this.range;
    const dx = (b - a) / this.n;
    for (let i = 0; i < this.n; i++) {
      const x0 = a + i * dx;
      const x1 = x0 + dx;
      const pts = this.method === 'trapezoid'
        ? [[x0, 0], [x1, 0], [x1, this.f(x1)], [x0, this.f(x0)]]
        : [[x0, 0], [x1, 0], [x1, this.height(x0, x1)], [x0, this.height(x0, x1)]];
      this.add(new DataPolyline(pts, { type: 'riemannRect', smooth: false, closed: true, ...this.style, meta: { solidFill: false } }));
    }
  }
}

/**
 * Tangent line to a function graph at x0, spanning a data length.
 */
export class TangentLine extends PlotNode {
  /**
   * @param {FunctionGraph|Function} graph
   * @param {number} x0
   * @param {Record<string, any>} [props] length (data units along x, default 3), h (derivative step)
   */
  constructor(graph, x0, props = {}) {
    super('tangentLine', { stroke: props.color ?? 'accent2', strokeWidth: 3.5, ...strip(props, ['length', 'color', 'h']) });
    this.f = typeof graph === 'function' ? graph : graph.f;
    this._define('x0', x0);
    this.length = props.length ?? 3;
    this.h = props.h ?? 1e-5;
  }

  /** Slope at the current x0. @returns {number} */
  slope() {
    const x = this.get('x0');
    return (this.f(x + this.h) - this.f(x - this.h)) / (2 * this.h);
  }

  geometry() {
    const ax = this.axes();
    const s = ax.state();
    const x = this.get('x0');
    const y = this.f(x);
    const m = this.slope();
    const half = this.length / 2 / Math.sqrt(1 + m * m);
    return polyPath([ax.toLocal(x - half, y - m * half, s), ax.toLocal(x + half, y + m * half, s)]);
  }
}

/**
 * Filled rectangles for bar charts and histograms, in data space.
 */
export class BarChart extends Group {
  /**
   * @param {number[]} values
   * @param {Record<string, any>} [props] x (positions, default 0..n-1), width (0.7 of spacing), color ('accent'), colors (per bar), baseline (0)
   */
  constructor(values, props = {}) {
    super([], { type: 'barChart' });
    this.values = values;
    this.xs = props.x ?? values.map((_, i) => i + 1);
    this.barWidth = props.width ?? 0.7;
    this.colors = props.colors ?? null;
    this.color = props.color ?? 'accent';
    this.baseline = props.baseline ?? 0;
    this.radius = props.radius ?? 0.04;
    values.forEach((v, i) => {
      this.add(new Bar(this.xs[i], this.baseline, v, this.barWidth, { fill: this.colors ? this.colors[i] : this.color, stroke: null, radius: this.radius, index: i }));
    });
  }

  /**
   * The bar nodes.
   * @returns {Bar[]}
   */
  bars() {
    return /** @type {Bar[]} */ (this.children);
  }
}

/**
 * One bar with an animatable value.
 */
export class Bar extends PlotNode {
  /** @param {number} x @param {number} base @param {number} value @param {number} width @param {Record<string, any>} [props] radius, index */
  constructor(x, base, value, width, props = {}) {
    super('bar', { meta: { solidFill: false }, ...strip(props, ['radius', 'index']) });
    this._define('value', value);
    this._define('barX', x);
    this.base = base;
    this.barWidth = width;
    this.radius = props.radius ?? 0;
    this.index = props.index ?? 0;
  }

  /** @returns {number} */
  get value() {
    return this.get('value');
  }

  set value(v) {
    this.set('value', v);
  }

  geometry() {
    const ax = this.axes();
    const s = ax.state();
    const x = this.get('barX');
    const v = this.get('value');
    const [lx0, ly0] = ax.toLocal(x - this.barWidth / 2, Math.max(s.yMin, Math.min(this.base, v)), s);
    const [lx1, ly1] = ax.toLocal(x + this.barWidth / 2, Math.min(s.yMax, Math.max(this.base, v)), s);
    const w = lx1 - lx0;
    const h = ly1 - ly0;
    if (w <= 0 || h <= 1e-6) return emptyPath();
    return rectPath((lx0 + lx1) / 2, (ly0 + ly1) / 2, w, h, Math.min(this.radius, h / 2));
  }
}

/**
 * Histogram of samples with automatic bins (Freedman-Diaconis).
 * @param {number[]} samples
 * @param {Record<string, any>} [props] bins (number or edges), normalize (density)
 * @returns {BarChart}
 */
export function histogram(samples, props = {}) {
  const sorted = samples.slice().sort((a, b) => a - b);
  const n = sorted.length;
  let edges = props.bins;
  if (!Array.isArray(edges)) {
    const q = (p) => sorted[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))];
    const iqr = q(0.75) - q(0.25);
    const width = typeof edges === 'number' ? (sorted[n - 1] - sorted[0]) / edges : 2 * iqr * Math.cbrt(1 / Math.max(1, n)) || 1;
    const count = Math.max(1, Math.ceil((sorted[n - 1] - sorted[0]) / width));
    edges = Array.from({ length: count + 1 }, (_, i) => sorted[0] + i * width);
  }
  const counts = new Array(edges.length - 1).fill(0);
  for (const v of samples) {
    let k = edges.findIndex((e, i) => i < edges.length - 1 && v >= e && v < edges[i + 1]);
    if (k < 0 && v === edges[edges.length - 1]) k = edges.length - 2;
    if (k >= 0) counts[k]++;
  }
  const w = edges[1] - edges[0];
  const values = props.normalize ? counts.map((c) => c / (n * w)) : counts;
  const xs = edges.slice(0, -1).map((e, i) => (e + edges[i + 1]) / 2);
  const chart = new BarChart(values, { x: xs, width: w * 0.94, radius: 0, ...props });
  chart.edges = edges;
  chart.counts = counts;
  return chart;
}

/**
 * Scatter points in data space.
 */
export class Scatter extends Group {
  /** @param {Array<[number, number]>} points @param {Record<string, any>} [props] radius (0.06), color ('accent') */
  constructor(points, props = {}) {
    super([], { type: 'scatter' });
    for (const [x, y] of points) this.add(new DataDot(x, y, { fill: props.color ?? 'accent', radius: props.radius ?? 0.06, opacity: props.opacity ?? 1 }));
  }
}

/**
 * A dot at a data position (animatable dataX, dataY).
 */
export class DataDot extends PlotNode {
  /** @param {number} x @param {number} y @param {Record<string, any>} [props] radius */
  constructor(x, y, props = {}) {
    super('dataDot', { stroke: null, fill: 'accent', meta: { solidFill: true }, ...strip(props, ['radius']) });
    this._define('dataX', x);
    this._define('dataY', y);
    this._define('radius', props.radius ?? 0.06);
  }

  geometry() {
    const ax = this.axes();
    const [lx, ly] = ax.toLocal(this.get('dataX'), this.get('dataY'));
    return circlePath(lx, ly, this.get('radius'));
  }
}

/**
 * Line chart through data points, optionally stepped or filled to a baseline.
 */
export class LineChart extends PlotNode {
  /** @param {Array<[number, number]>} points @param {Record<string, any>} [props] step ('none'|'pre'|'post'|'mid'), area (fill to baseline), baseline (0) */
  constructor(points, props = {}) {
    super('lineChart', { stroke: props.color ?? 'accent', strokeWidth: 3.5, ...(props.area ? { fill: props.color ?? 'accent', fillOpacity: 0.22 } : {}), ...strip(props, ['step', 'area', 'baseline', 'color']) });
    this.points = points;
    this.stepMode = props.step ?? 'none';
    this.area = !!props.area;
    this.baseline = props.baseline ?? 0;
  }

  geometry() {
    const ax = this.axes();
    const s = ax.state();
    let pts = this.points;
    if (this.stepMode !== 'none') pts = stepped(pts, this.stepMode);
    const local = pts.map(([x, y]) => ax.toLocal(x, y, s));
    if (!this.area) return polyPath(local);
    const first = ax.toLocal(pts[0][0], this.baseline, s);
    const last = ax.toLocal(pts[pts.length - 1][0], this.baseline, s);
    return polyPath([first, ...local, last], true);
  }
}

function stepped(pts, mode) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (i === 0) {
      out.push([x, y]);
      continue;
    }
    const [xp, yp] = pts[i - 1];
    if (mode === 'post') out.push([x, yp], [x, y]);
    else if (mode === 'pre') out.push([xp, y], [x, y]);
    else {
      const xm = (xp + x) / 2;
      out.push([xm, yp], [xm, y], [x, y]);
    }
  }
  return out;
}

/**
 * Heatmap of a scalar field as a grid of filled cells colored along a
 * perceptual ramp from background to accent (or a diverging ramp).
 */
export class Heatmap extends Group {
  /**
   * @param {Function|string} F
   * @param {Record<string, any>} [props] cells (across, default 48), ramp: 'sequential' | 'diverging', range [lo, hi]
   */
  constructor(F, props = {}) {
    super([], { type: 'heatmap' });
    this.F = toFunction(F, ['x', 'y']);
    this.cells = props.cells ?? 48;
    this.ramp = props.ramp ?? 'sequential';
    this.valueRange = props.range ?? null;
  }

  /**
   * Create cell nodes. Called by `axes.heatmap()`.
   * @param {import('./coords.js').Axes} ax
   */
  build(ax) {
    const s = ax.state();
    const nx = this.cells;
    const ny = Math.max(4, Math.round((nx * s.height) / s.width));
    const dx = (s.xMax - s.xMin) / nx;
    const dy = (s.yMax - s.yMin) / ny;
    const vals = [];
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = this.F(s.xMin + (i + 0.5) * dx, s.yMin + (j + 0.5) * dy);
      vals.push(v);
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    if (this.valueRange) [lo, hi] = this.valueRange;
    const mag = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = vals[j * nx + i];
      if (!Number.isFinite(v)) continue;
      let color;
      let alpha;
      if (this.ramp === 'diverging') {
        color = v >= 0 ? 'accent' : 'accent2';
        alpha = Math.min(1, Math.abs(v) / mag);
      } else {
        color = 'accent';
        alpha = hi > lo ? (v - lo) / (hi - lo) : 0.5;
      }
      const x0 = s.xMin + i * dx;
      const y0 = s.yMin + j * dy;
      this.add(new DataPolyline([[x0, y0], [x0 + dx, y0], [x0 + dx, y0 + dy], [x0, y0 + dy]], { type: 'heatCell', smooth: false, closed: true, stroke: null, fill: color, fillOpacity: 0.08 + 0.88 * alpha, meta: { solidFill: true } }));
    }
  }
}

function strip(props, keys) {
  const out = {};
  for (const [k, v] of Object.entries(props)) if (!keys.includes(k)) out[k] = v;
  return out;
}
