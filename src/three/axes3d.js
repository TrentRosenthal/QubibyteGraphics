/**
 * 3D axes, coordinate grids, and plotting helpers. Axes3D maps data
 * coordinates to scene coordinates (c2p) and builds axis lines with cone
 * tips, ticks, and camera-facing tick labels. Plots are added as children in
 * scene coordinates.
 * @module three/axes3d
 */

import { ColorMix } from '../core/node.js';
import { Group3D, Lines3D, Label3D, Mesh3D, Surface3D, Arrow3D } from './object3d.js';
import { cone, makeMesh, gridMesh, translateMesh, levelSets } from './geometry.js';
import * as Q from './quat.js';
import { loadLabelText } from './render.js';
import { AlphaColor } from './materials.js';

function formatTick(v) {
  const r = Math.round(v * 1000) / 1000;
  const s = Math.abs(r) < 1e-9 ? '0' : String(r);
  return s.replace('-', '−');
}

function range(r, fallback) {
  const [a, b, step] = r ?? fallback;
  return { min: a, max: b, step: step ?? Math.max(0.5, niceStep((b - a) / 6)) };
}

function niceStep(x) {
  const e = 10 ** Math.floor(Math.log10(x));
  const m = x / e;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
}

/**
 * Three axes with tips, ticks, tick labels, and optional grids.
 */
export class Axes3D extends Group3D {
  /**
   * @param {Record<string, any>} [opts] x, y, z ranges [min, max, step]; lengths [lx, ly, lz] in scene units (default: the spans); tips (true); ticks (true); tickLabels (true); axisLabels (['x', 'y', 'z'] or false); labelFactory (text to Path); labelSize (0.22); color ('ink'); grid (planes like ['xy']); and node props
   */
  constructor(opts = {}) {
    super([], { type: 'axes3d', ...opts.props });
    this.xr = range(opts.x, [-3, 3, 1]);
    this.yr = range(opts.y, [-3, 3, 1]);
    this.zr = range(opts.z, [-2, 2, 1]);
    const spans = [this.xr.max - this.xr.min, this.yr.max - this.yr.min, this.zr.max - this.zr.min];
    const L = opts.lengths ?? spans;
    this.scaleXYZ = [L[0] / spans[0], L[1] / spans[1], L[2] / spans[2]];
    this.labelFactory = opts.labelFactory ?? null;
    if (!this.labelFactory) loadLabelText();
    const color = opts.color ?? 'ink';
    const axisColor = new ColorMix(color, 'background', 0.3);
    const labelSize = opts.labelSize ?? 0.22;
    const ranges = [this.xr, this.yr, this.zr];
    const names = opts.axisLabels === false ? null : opts.axisLabels ?? ['x', 'y', 'z'];
    const tickDir = [[0, 1, 0], [1, 0, 0], [1, 0, 0]];
    const labelDir = [[0, -1, 0], [-1, 0, 0], [-1, -1, 0]];
    const origin = [0, 0, 0].map((_, i) => Math.max(ranges[i].min, Math.min(ranges[i].max, 0)));
    for (const plane of opts.grid ?? []) this.add(this.gridPlane(plane));
    for (let a = 0; a < 3; a++) {
      const r = ranges[a];
      const p0 = origin.slice();
      const p1 = origin.slice();
      p0[a] = r.min;
      p1[a] = r.max;
      const s0 = this.c2p(...p0);
      const s1 = this.c2p(...p1);
      const tipLen = opts.tipLength ?? 0.24;
      const dir = [s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2]];
      const len = Math.hypot(...dir);
      const u = dir.map((v) => v / len);
      const end = opts.tips === false ? s1 : [s1[0] - u[0] * tipLen * 0.6, s1[1] - u[1] * tipLen * 0.6, s1[2] - u[2] * tipLen * 0.6];
      this.add(new Lines3D([[s0, end]], { color: axisColor, strokeWidth: opts.strokeWidth ?? 2.5, role: 'axis', name: `axis-${'xyz'[a]}` }));
      if (opts.tips !== false) {
        const tip = new Mesh3D(translateMesh(cone(tipLen * 0.3, tipLen, 18), 0, 0, -tipLen / 2), { color: axisColor, material: 'flat', castShadow: false, name: `tip-${'xyz'[a]}` });
        const q = Q.fromUnitVectors([0, 0, 1], u);
        tip.set({ quat: q, position: s1 });
        this.add(tip);
      }
      if (opts.ticks !== false) {
        const tsegs = [];
        const tick = 0.07;
        const td = tickDir[a];
        for (let v = Math.ceil(r.min / r.step) * r.step; v <= r.max - r.step * 0.4 + 1e-9; v += r.step) {
          if (Math.abs(v - origin[a]) < 1e-9) continue;
          const p = origin.slice();
          p[a] = v;
          const c = this.c2p(...p);
          tsegs.push([[c[0] - td[0] * tick, c[1] - td[1] * tick, c[2] - td[2] * tick], [c[0] + td[0] * tick, c[1] + td[1] * tick, c[2] + td[2] * tick]]);
          if (opts.tickLabels !== false) {
            const ld = labelDir[a];
            const off = 0.28;
            this.add(new Label3D(formatTick(v), { position: [c[0] + ld[0] * off, c[1] + ld[1] * off, c[2] + ld[2] * off], size: labelSize, color: 'muted', factory: this.labelFactory }));
          }
        }
        if (tsegs.length) this.add(new Lines3D(tsegs, { color: axisColor, strokeWidth: 2, role: 'tick' }));
      }
      if (names) {
        const q = [s1[0] + u[0] * 0.38, s1[1] + u[1] * 0.38, s1[2] + u[2] * 0.38];
        this.add(new Label3D(names[a], { position: q, size: labelSize * 1.35, color: color, factory: this.labelFactory, name: `label-${'xyz'[a]}` }));
      }
    }
  }

  /**
   * Data coordinates to scene coordinates.
   * @param {number} x @param {number} y @param {number} z
   * @returns {number[]}
   */
  c2p(x, y, z) {
    return [x * this.scaleXYZ[0], y * this.scaleXYZ[1], z * this.scaleXYZ[2]];
  }

  /**
   * Grid lines on a coordinate plane through the origin.
   * @param {'xy'|'yz'|'xz'} plane
   * @param {{opacity?: number, color?: any}} [opts]
   * @returns {Lines3D}
   */
  gridPlane(plane, opts = {}) {
    const ax = { x: 0, y: 1, z: 2 };
    const [a, b] = plane.split('').map((c) => ax[c]);
    const R = [this.xr, this.yr, this.zr];
    const lines = [];
    for (let v = Math.ceil(R[a].min / R[a].step) * R[a].step; v <= R[a].max + 1e-9; v += R[a].step) {
      const p = [0, 0, 0];
      const q = [0, 0, 0];
      p[a] = q[a] = v;
      p[b] = R[b].min;
      q[b] = R[b].max;
      lines.push([this.c2p(...p), this.c2p(...q)]);
    }
    for (let v = Math.ceil(R[b].min / R[b].step) * R[b].step; v <= R[b].max + 1e-9; v += R[b].step) {
      const p = [0, 0, 0];
      const q = [0, 0, 0];
      p[b] = q[b] = v;
      p[a] = R[a].min;
      q[a] = R[a].max;
      lines.push([this.c2p(...p), this.c2p(...q)]);
    }
    return new Lines3D(lines, { color: opts.color ?? 'ink', strokeOpacity: opts.opacity ?? 0.14, strokeWidth: 1.5, role: 'grid', name: `grid-${plane}` });
  }

  /**
   * Plot z = f(x, y) over a domain (data coordinates).
   * @param {(x: number, y: number) => number} f
   * @param {{x?: number[], y?: number[], nx?: number, ny?: number}} [domain]
   * @param {Record<string, any>} [props] Mesh3D props (color, material, ...)
   * @returns {Surface3D}
   */
  plotSurface(f, domain = {}, props = {}) {
    const s = new Surface3D((x, y) => this.c2p(x, y, f(x, y)), { u: domain.x ?? [this.xr.min, this.xr.max], v: domain.y ?? [this.yr.min, this.yr.max], nu: domain.nx ?? 36, nv: domain.ny ?? 36 }, { castShadow: false, ...props });
    this.add(s);
    return s;
  }

  /**
   * Plot a parametric surface (u, v) => [x, y, z] in data coordinates.
   * @param {(u: number, v: number) => number[]} f
   * @param {{u?: number[], v?: number[], nu?: number, nv?: number}} [opts]
   * @param {Record<string, any>} [props]
   * @returns {Surface3D}
   */
  plotParametricSurface(f, opts = {}, props = {}) {
    const s = new Surface3D((u, v) => this.c2p(...f(u, v)), opts, { castShadow: false, ...props });
    this.add(s);
    return s;
  }

  /**
   * Plot a parametric curve t => [x, y, z] in data coordinates.
   * @param {(t: number) => number[]} f
   * @param {number[]} [tRange=[0, 1]]
   * @param {Record<string, any>} [props] color (default 'accent'), strokeWidth, samples
   * @returns {Lines3D}
   */
  plotParametricCurve(f, tRange = [0, 1], props = {}) {
    const n = props.samples ?? 200;
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(this.c2p(...f(tRange[0] + ((tRange[1] - tRange[0]) * i) / n)));
    const l = new Lines3D([pts], { color: 'accent', strokeWidth: 4, ...props });
    this.add(l);
    return l;
  }

  /**
   * Arrows of a vector field sampled on a grid. Arrow lengths are scaled so
   * the longest fits the grid spacing.
   * @param {(x: number, y: number, z: number) => number[]} F
   * @param {{x?: number[], y?: number[], z?: number[]}} [bounds] each [min, max, count]
   * @param {Record<string, any>} [props] color, scale, colorByMagnitude (true)
   * @returns {Group3D}
   */
  plotVectorField(F, bounds = {}, props = {}) {
    const bx = bounds.x ?? [this.xr.min, this.xr.max, 5];
    const by = bounds.y ?? [this.yr.min, this.yr.max, 5];
    const bz = bounds.z ?? [this.zr.min, this.zr.max, 3];
    const samples = [];
    const step = (b) => (b[2] > 1 ? (b[1] - b[0]) / (b[2] - 1) : 0);
    for (let i = 0; i < bx[2]; i++) for (let j = 0; j < by[2]; j++) for (let k = 0; k < bz[2]; k++) {
      const p = [bx[0] + step(bx) * i, by[0] + step(by) * j, bz[0] + step(bz) * k];
      samples.push([p, F(...p)]);
    }
    let maxLen = 0;
    for (const [, v] of samples) maxLen = Math.max(maxLen, Math.hypot(...v));
    const spacing = Math.min(...[bx, by, bz].filter((b) => b[2] > 1).map(step).concat([1]));
    const k = (props.scale ?? 0.85) * (maxLen > 0 ? spacing / maxLen : 1);
    const g = new Group3D([], { name: 'vector-field' });
    for (const [p, v] of samples) {
      const L = Math.hypot(...v);
      if (L * k < 1e-3) continue;
      const a = this.c2p(...p);
      const b = this.c2p(p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k);
      const t = maxLen > 0 ? L / maxLen : 1;
      const color = props.color ?? (props.colorByMagnitude === false ? 'accent' : new ColorMix('muted', 'accent', 0.25 + 0.75 * t));
      g.add(new Arrow3D(a, b, { color, shaftRadius: 0.018, headRadius: 0.055, headLength: Math.min(0.16, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 0.45), material: 'matte' }));
    }
    this.add(g);
    return g;
  }

  /**
   * Streamlines of a vector field integrated with fourth-order Runge-Kutta
   * from seed points (data coordinates), clipped to the axes' box.
   * @param {(x: number, y: number, z: number) => number[]} F
   * @param {number[][]} seeds
   * @param {Record<string, any>} [props] step (0.05), steps (200), both (true: also integrate backward), color, strokeWidth
   * @returns {Lines3D}
   */
  plotStreamlines(F, seeds, props = {}) {
    const h = props.step ?? 0.05;
    const n = props.steps ?? 200;
    const inBox = (p) => p[0] >= this.xr.min && p[0] <= this.xr.max && p[1] >= this.yr.min && p[1] <= this.yr.max && p[2] >= this.zr.min && p[2] <= this.zr.max;
    const lines = [];
    for (const s of seeds) {
      const dirs = props.both === false ? [1] : [1, -1];
      const halves = dirs.map((sg) => {
        const pts = [s.slice()];
        let p = s.slice();
        for (let i = 0; i < n; i++) {
          p = rk4(F, p, h * sg);
          if (!p || !inBox(p)) break;
          pts.push(p);
        }
        return pts;
      });
      const pts = halves.length > 1 ? halves[1].slice(1).reverse().concat(halves[0]) : halves[0];
      if (pts.length > 1) lines.push(pts.map((p) => this.c2p(...p)));
    }
    const { steps: _s, step: _h, both: _b, ...rest } = props;
    const l = new Lines3D(lines, { color: 'accent', strokeWidth: 2.5, ...rest });
    this.add(l);
    return l;
  }

  /**
   * Contour lines of f(x, y) drawn on the surface z = f (or at a fixed z).
   * @param {(x: number, y: number) => number} f
   * @param {number[]} levels
   * @param {{x?: number[], y?: number[], nx?: number, ny?: number, z?: number|'surface'}} [opts]
   * @param {Record<string, any>} [props]
   * @returns {Lines3D}
   */
  plotLevelSets(f, levels, opts = {}, props = {}) {
    const g = levelSets(f, { x: opts.x ?? [this.xr.min, this.xr.max], y: opts.y ?? [this.yr.min, this.yr.max], nx: opts.nx, ny: opts.ny }, levels, { z: opts.z ?? 'surface' });
    const l = new Lines3D(g.polylines.map((pl) => ({ points: pl.points.map((p) => this.c2p(...p)), closed: pl.closed })), { color: 'ink', strokeOpacity: 0.55, strokeWidth: 2, ...props });
    this.add(l);
    return l;
  }

  /**
   * A slice plane through a scalar field, drawn as colored grid cells.
   * @param {(x: number, y: number, z: number) => number} field
   * @param {{axis?: 'x'|'y'|'z', at?: number, n?: number, range?: number[], colors?: any[]}} [opts] colors: low to high color stops (default muted to accent to accent2)
   * @param {Record<string, any>} [props]
   * @returns {Mesh3D}
   */
  slicePlane(field, opts = {}, props = {}) {
    const mesh = this.sliceMesh(field, opts);
    const m = new Mesh3D(mesh, { material: 'flat', castShadow: false, edgeColor: 'ink', ...props });
    this.add(m);
    return m;
  }

  /**
   * Volume rendering of a scalar field as stacked translucent slices whose
   * cell alpha follows the value.
   * @param {(x: number, y: number, z: number) => number} field
   * @param {{axis?: 'x'|'y'|'z', slices?: number, n?: number, range?: number[], opacity?: number, color?: any}} [opts]
   * @returns {Group3D}
   */
  volume(field, opts = {}) {
    const axis = opts.axis ?? 'z';
    const R = { x: this.xr, y: this.yr, z: this.zr }[axis];
    const count = opts.slices ?? 12;
    const g = new Group3D([], { name: 'volume' });
    const vr = opts.range ?? sampleRange(field, this);
    for (let i = 0; i < count; i++) {
      const at = R.min + ((R.max - R.min) * (i + 0.5)) / count;
      const mesh = this.sliceMesh(field, { axis, at, n: opts.n ?? 24, range: vr, alpha: opts.opacity ?? 0.35, colors: [opts.color ?? 'accent', opts.color ?? 'accent'] });
      g.add(new Mesh3D(mesh, { material: { kind: 'flat', shading: 'none', edges: 'none' }, castShadow: false }));
    }
    this.add(g);
    return g;
  }

  /**
   * Mesh of a colored slice (used by slicePlane and volume).
   * @param {(x: number, y: number, z: number) => number} field
   * @param {{axis?: 'x'|'y'|'z', at?: number, n?: number, range?: number[], colors?: any[], alpha?: number}} opts
   * @returns {import('./geometry.js').MeshGeometry}
   */
  sliceMesh(field, opts) {
    const axis = opts.axis ?? 'z';
    const a = { x: 0, y: 1, z: 2 }[axis];
    const b = (a + 1) % 3;
    const c = (a + 2) % 3;
    const R = [this.xr, this.yr, this.zr];
    const n = opts.n ?? 24;
    const at = opts.at ?? 0;
    const vr = opts.range ?? sampleRange(field, this);
    const stops = opts.colors ?? ['muted', 'accent', 'accent2'];
    const point = (u, v) => {
      const p = [0, 0, 0];
      p[a] = at;
      p[b] = R[b].min + (R[b].max - R[b].min) * u;
      p[c] = R[c].min + (R[c].max - R[c].min) * v;
      return p;
    };
    const g = gridMesh(n, n, (u, v) => this.c2p(...point(u, v)), { weldEps: 0 });
    const colors = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const p = point((i + 0.5) / n, (j + 0.5) / n);
      const t = Math.max(0, Math.min(1, (field(...p) - vr[0]) / (vr[1] - vr[0] || 1)));
      const seg = t * (stops.length - 1);
      const k = Math.min(stops.length - 2, Math.floor(seg));
      const col = new ColorMix(stops[k], stops[k + 1], seg - k);
      colors.push(opts.alpha != null ? new AlphaColor(col, opts.alpha * t) : col);
    }
    return makeMesh(g.positions, g.faces, { faceColors: colors });
  }
}

function sampleRange(field, axes) {
  let lo = Infinity;
  let hi = -Infinity;
  const R = [axes.xr, axes.yr, axes.zr];
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) for (let k = 0; k <= 8; k++) {
    const v = field(R[0].min + ((R[0].max - R[0].min) * i) / 8, R[1].min + ((R[1].max - R[1].min) * j) / 8, R[2].min + ((R[2].max - R[2].min) * k) / 8);
    if (Number.isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return [lo, hi];
}

function rk4(F, p, h) {
  const k1 = F(...p);
  const p2 = p.map((v, i) => v + (h / 2) * k1[i]);
  const k2 = F(...p2);
  const p3 = p.map((v, i) => v + (h / 2) * k2[i]);
  const k3 = F(...p3);
  const p4 = p.map((v, i) => v + h * k3[i]);
  const k4 = F(...p4);
  const out = p.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  return out.every(Number.isFinite) ? out : null;
}

/**
 * Integrate one streamline with RK4 (exposed for tests and custom plots).
 * @param {(x: number, y: number, z: number) => number[]} F
 * @param {number[]} seed @param {number} h @param {number} n
 * @returns {number[][]}
 */
export function streamline(F, seed, h, n) {
  const pts = [seed.slice()];
  let p = seed.slice();
  for (let i = 0; i < n; i++) {
    p = rk4(F, p, h);
    if (!p) break;
    pts.push(p);
  }
  return pts;
}

/**
 * Latitude and longitude circles on a sphere.
 * @param {{radius?: number, meridians?: number, parallels?: number, samples?: number}} [opts]
 * @param {Record<string, any>} [props]
 * @returns {Lines3D}
 */
export function sphericalGrid(opts = {}, props = {}) {
  const r = opts.radius ?? 1;
  const nm = opts.meridians ?? 12;
  const np = opts.parallels ?? 5;
  const n = opts.samples ?? 72;
  const lines = [];
  for (let i = 0; i < nm; i++) {
    const ph = (2 * Math.PI * i) / nm;
    const pts = [];
    for (let k = 0; k <= n / 2; k++) {
      const th = (Math.PI * k) / (n / 2);
      pts.push([r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)]);
    }
    lines.push(pts);
  }
  for (let j = 1; j <= np; j++) {
    const th = (Math.PI * j) / (np + 1);
    const pts = [];
    for (let k = 0; k < n; k++) {
      const ph = (2 * Math.PI * k) / n;
      pts.push([r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)]);
    }
    lines.push({ points: pts, closed: true });
  }
  return new Lines3D(lines, { color: 'ink', strokeOpacity: 0.2, strokeWidth: 1.5, role: 'grid', ...props });
}

/**
 * Cylindrical coordinate grid: circles at several radii and heights plus
 * vertical lines.
 * @param {{radius?: number, height?: number, rings?: number, levels?: number, spokes?: number, samples?: number}} [opts]
 * @param {Record<string, any>} [props]
 * @returns {Lines3D}
 */
export function cylindricalGrid(opts = {}, props = {}) {
  const R = opts.radius ?? 1;
  const H = opts.height ?? 2;
  const rings = opts.rings ?? 3;
  const levels = opts.levels ?? 3;
  const spokes = opts.spokes ?? 12;
  const n = opts.samples ?? 72;
  const lines = [];
  for (let l = 0; l < levels; l++) {
    const z = levels > 1 ? -H / 2 + (H * l) / (levels - 1) : 0;
    for (let r = 1; r <= rings; r++) {
      const rr = (R * r) / rings;
      const pts = [];
      for (let k = 0; k < n; k++) pts.push([rr * Math.cos((2 * Math.PI * k) / n), rr * Math.sin((2 * Math.PI * k) / n), z]);
      lines.push({ points: pts, closed: true });
    }
  }
  for (let s = 0; s < spokes; s++) {
    const a = (2 * Math.PI * s) / spokes;
    lines.push([[R * Math.cos(a), R * Math.sin(a), -H / 2], [R * Math.cos(a), R * Math.sin(a), H / 2]]);
    lines.push([[0, 0, -H / 2], [R * Math.cos(a), R * Math.sin(a), -H / 2]]);
  }
  return new Lines3D(lines, { color: 'ink', strokeOpacity: 0.2, strokeWidth: 1.5, role: 'grid', ...props });
}

/**
 * Square grid on a coordinate plane.
 * @param {'xy'|'yz'|'xz'} [plane='xy']
 * @param {{size?: number, step?: number, offset?: number}} [opts]
 * @param {Record<string, any>} [props]
 * @returns {Lines3D}
 */
export function planeGrid(plane = 'xy', opts = {}, props = {}) {
  const size = opts.size ?? 4;
  const step = opts.step ?? 0.5;
  const ax = { x: 0, y: 1, z: 2 };
  const [a, b] = plane.split('').map((c) => ax[c]);
  const c = 3 - a - b;
  const lines = [];
  const n = Math.round(size / step);
  for (let i = 0; i <= n; i++) {
    const v = -size / 2 + i * step;
    const p = [0, 0, 0];
    const q = [0, 0, 0];
    p[c] = q[c] = opts.offset ?? 0;
    p[a] = q[a] = v;
    p[b] = -size / 2;
    q[b] = size / 2;
    lines.push([p, q]);
    const r = [0, 0, 0];
    const s = [0, 0, 0];
    r[c] = s[c] = opts.offset ?? 0;
    r[b] = s[b] = v;
    r[a] = -size / 2;
    s[a] = size / 2;
    lines.push([r, s]);
  }
  return new Lines3D(lines, { color: 'ink', strokeOpacity: 0.14, strokeWidth: 1.5, role: 'grid', ...props });
}
