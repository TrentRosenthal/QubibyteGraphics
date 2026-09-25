/**
 * Coordinate systems: axes, number lines, complex and polar planes. Ranges
 * are tracked properties, so zooming and panning animate, and ticks are
 * re-chosen every frame. A `polar` blend property bends the plane from
 * Cartesian (x, y) to polar (theta = x, r = y) for the unwrap animation.
 * Plots are child nodes whose geometry follows the axes.
 * @module core/coords
 */

import { Node } from './node.js';
import { niceTicks, logTicks, formatTick } from './ticks.js';
import { polyPath, transformPath, partialPath } from './path.js';
import { apply as applyMat, invert } from './matrix.js';
import { hashSeed } from './random.js';
import * as plots from './plots.js';

/**
 * @typedef {Object} LabelGlyphs
 * @property {import('./path.js').Path} path Outline in label units, baseline at y = 0, left edge at x = 0.
 * @property {number} width
 * @property {number} height Ascent above the baseline.
 * @property {number} depth Descent below the baseline.
 */

/** @type {((tex: string, size: number) => LabelGlyphs)|null} */
let labelFactory = null;

/**
 * Install the function that turns a TeX string into glyph outlines. The
 * text module installs one on import; tests and headless tools can install
 * their own.
 * @param {(tex: string, size: number) => LabelGlyphs} fn
 */
export function setLabelFactory(fn) {
  labelFactory = fn;
  labelCache.clear();
}

const labelCache = new Map();

/** @type {((tex: string, size: number) => {strokes: Array<Array<[number, number]>>, width: number, height: number}|null)|null} */
let handLabelFactory = null;

/**
 * Install the function that writes simple labels as pen strokes for board
 * styles. Returns null for labels it cannot write (those stay typeset).
 * @param {(tex: string, size: number) => ({strokes: Array<Array<[number, number]>>, width: number, height: number}|null)} fn
 */
export function setHandLabelFactory(fn) {
  handLabelFactory = fn;
}

/**
 * Glyph outlines for a TeX label, cached.
 * @param {string} tex
 * @param {number} size world units
 * @returns {LabelGlyphs|null}
 */
export function labelGlyphs(tex, size) {
  if (!labelFactory) return null;
  const key = `${size}|${tex}`;
  if (!labelCache.has(key)) {
    if (labelCache.size > 4000) labelCache.clear();
    labelCache.set(key, labelFactory(tex, size));
  }
  return labelCache.get(key);
}

/**
 * @typedef {Object} AxesOptions
 * @property {number[]} [x] [min, max] data range for x (default [-7, 7])
 * @property {number[]} [y] [min, max] data range for y (default [-4, 4])
 * @property {number} [width] world width (default 12)
 * @property {number} [height] world height (default 7)
 * @property {'linear'|'log'} [xScale]
 * @property {'linear'|'log'} [yScale]
 * @property {'cross'|'box'|'left-bottom'|'none'} [style] where the axis lines sit (default 'cross')
 * @property {boolean|'major'|'minor'} [grid] draw gridlines (default false)
 * @property {boolean} [tips] arrow tips on axis ends (default true for 'cross')
 * @property {number|number[]} [xTicks] target tick count or explicit tick values
 * @property {number|number[]} [yTicks]
 * @property {boolean} [xLabels] tick labels on x (default true)
 * @property {boolean} [yLabels] tick labels on y (default true)
 * @property {(v: number, step: number, axis: 'x'|'y') => string} [format] tick label TeX
 * @property {string} [xTitle] TeX title for the x axis
 * @property {string} [yTitle] TeX title for the y axis
 * @property {number} [labelSize] world units (default: theme caption size)
 * @property {boolean} [hideZero] hide the 0 labels at the origin (default true for 'cross')
 * @property {string} [axisColor] token (default 'muted')
 * @property {string} [gridColor] token (default 'grid')
 * @property {string} [labelColor] token (default 'muted')
 * @property {boolean} [labelHalo] draw tick labels above plots on a background halo (default true)
 */

/**
 * Two-dimensional axes.
 */
export class Axes extends Node {
  /** @param {AxesOptions & Record<string, any>} [opts] */
  constructor(opts = {}) {
    super(opts.type ?? 'axes', { ...pickNodeProps(opts) });
    const [x0, x1] = opts.x ?? [-7, 7];
    const [y0, y1] = opts.y ?? [-4, 4];
    this._define('xMin', x0);
    this._define('xMax', x1);
    this._define('yMin', y0);
    this._define('yMax', y1);
    this._define('width', opts.width ?? 12);
    this._define('height', opts.height ?? 7);
    this._define('polar', 0);
    this.xScale = opts.xScale ?? 'linear';
    this.yScale = opts.yScale ?? 'linear';
    this.style = opts.style ?? 'cross';
    this.grid = opts.grid ?? false;
    this.tips = opts.tips ?? this.style === 'cross';
    this.xTicks = opts.xTicks ?? null;
    this.yTicks = opts.yTicks ?? null;
    this.xLabels = opts.xLabels ?? true;
    this.yLabels = opts.yLabels ?? true;
    this.format = opts.format ?? ((v, step) => formatTick(v, step));
    this.xTitle = opts.xTitle ?? null;
    this.yTitle = opts.yTitle ?? null;
    this.labelSize = opts.labelSize ?? null;
    this.hideZero = opts.hideZero ?? this.style === 'cross';
    this.axisColor = opts.axisColor ?? 'muted';
    this.gridColor = opts.gridColor ?? 'grid';
    this.labelColor = opts.labelColor ?? 'muted';
    this.showX = opts.showX ?? true;
    this.showY = opts.showY ?? true;
    this.labelHalo = opts.labelHalo ?? true;
  }

  /** @returns {{xMin: number, xMax: number, yMin: number, yMax: number, width: number, height: number, polar: number}} */
  state() {
    return { xMin: this.get('xMin'), xMax: this.get('xMax'), yMin: this.get('yMin'), yMax: this.get('yMax'), width: this.get('width'), height: this.get('height'), polar: this.get('polar') };
  }

  /** @private */
  _tx(v, s) {
    if (this.xScale === 'log') return (Math.log10(v) - Math.log10(s.xMin)) / (Math.log10(s.xMax) - Math.log10(s.xMin));
    return (v - s.xMin) / (s.xMax - s.xMin);
  }

  /** @private */
  _ty(v, s) {
    if (this.yScale === 'log') return (Math.log10(v) - Math.log10(s.yMin)) / (Math.log10(s.yMax) - Math.log10(s.yMin));
    return (v - s.yMin) / (s.yMax - s.yMin);
  }

  /**
   * Data coordinates to local (axes node) coordinates.
   * @param {number} x
   * @param {number} y
   * @param {ReturnType<Axes['state']>} [s]
   * @returns {[number, number]}
   */
  toLocal(x, y, s = this.state()) {
    const cx = this._tx(x, s) * s.width - s.width / 2;
    const cy = this._ty(y, s) * s.height - s.height / 2;
    if (s.polar <= 0) return [cx, cy];
    const rScale = s.height / 2 / Math.max(Math.abs(s.yMin), Math.abs(s.yMax), 1e-9);
    const r = y * rScale;
    const p = s.polar;
    return [cx + (r * Math.cos(x) - cx) * p, cy + (r * Math.sin(x) - cy) * p];
  }

  /**
   * Data coordinates to world coordinates.
   * @param {number} x
   * @param {number} [y=0]
   * @returns {[number, number]}
   */
  c2p(x, y = 0) {
    const [lx, ly] = this.toLocal(x, y);
    return applyMat(this.worldMatrix(), lx, ly);
  }

  /**
   * World coordinates to data coordinates (Cartesian mode).
   * @param {number} px
   * @param {number} py
   * @returns {[number, number]}
   */
  p2c(px, py) {
    const [lx, ly] = applyMat(invert(this.worldMatrix()), px, py);
    const s = this.state();
    const u = (lx + s.width / 2) / s.width;
    const v = (ly + s.height / 2) / s.height;
    const x = this.xScale === 'log' ? 10 ** (Math.log10(s.xMin) + u * (Math.log10(s.xMax) - Math.log10(s.xMin))) : s.xMin + u * (s.xMax - s.xMin);
    const y = this.yScale === 'log' ? 10 ** (Math.log10(s.yMin) + v * (Math.log10(s.yMax) - Math.log10(s.yMin))) : s.yMin + v * (s.yMax - s.yMin);
    return [x, y];
  }

  /** Local-space bounding rectangle for layout and bounds. */
  geometry() {
    const w = this.get('width');
    const h = this.get('height');
    return { subpaths: [{ points: [-w / 2, -h / 2, -w / 2, -h / 2, w / 2, h / 2, w / 2, h / 2], closed: false }] };
  }

  resolvedGeometry() {
    return null;
  }

  /**
   * Animate-friendly zoom: set the visible data ranges.
   * @param {number[]} x [min, max]
   * @param {number[]} [y] [min, max]
   * @returns {this}
   */
  zoomTo(x, y) {
    this.set({ xMin: x[0], xMax: x[1] });
    if (y) this.set({ yMin: y[0], yMax: y[1] });
    return this;
  }

  /**
   * Pan by a data-space offset.
   * @param {number} dx
   * @param {number} [dy=0]
   * @returns {this}
   */
  pan(dx, dy = 0) {
    return this.set({ xMin: this.get('xMin') + dx, xMax: this.get('xMax') + dx, yMin: this.get('yMin') + dy, yMax: this.get('yMax') + dy });
  }

  /** @private */
  _ticks(axis, s) {
    const log = axis === 'x' ? this.xScale === 'log' : this.yScale === 'log';
    const [a, b] = axis === 'x' ? [s.xMin, s.xMax] : [s.yMin, s.yMax];
    const spec = axis === 'x' ? this.xTicks : this.yTicks;
    if (Array.isArray(spec)) return { ticks: spec.filter((v) => v >= Math.min(a, b) && v <= Math.max(a, b)), step: spec.length > 1 ? Math.abs(spec[1] - spec[0]) : 1, minor: [] };
    if (log) {
      const { major, minor } = logTicks(a, b);
      return { ticks: major, step: 1, minor, log: true };
    }
    const len = axis === 'x' ? s.width : s.height;
    const target = typeof spec === 'number' ? spec : Math.max(2, Math.round(len / 1.1));
    const r = niceTicks(a, b, target, true);
    return { ticks: r.ticks, step: r.step, minor: [] };
  }

  /**
   * Emit grid, axes, ticks, and labels as path items.
   * @param {Object} c sampler context
   */
  sampleItems(c) {
    const s = this.state();
    const theme = c.theme;
    const m = c.matrix;
    const draw = this.get('draw');
    const op = c.opacity;
    const seed = hashSeed(this.id);
    const sw = theme.stroke;
    const push = (path, stroke, width, alpha, meta = {}) => {
      let p = transformPath(path, m);
      if (draw < 1) p = partialPath(p, 0, Math.max(0, draw));
      const col = c.color(stroke);
      if (!col || !p.subpaths.length) return;
      c.items.push({ kind: 'path', id: `${this.id}:${meta.part ?? 'axis'}`, nodeType: 'axes', path: p, fill: null, stroke: { ...col, a: col.a * alpha * op }, strokeWidth: width, lineCap: 'butt', lineJoin: 'round', dash: null, fillRule: 'nonzero', seed: seed + (meta.k ?? 0), meta, draw });
    };
    const pushFill = (path, fill, alpha, meta = {}) => {
      if (draw <= 0) return;
      const col = c.color(fill);
      if (!col) return;
      c.items.push({ kind: 'path', id: `${this.id}:${meta.part ?? 'label'}`, nodeType: 'axesLabel', path: transformPath(path, m), fill: { ...col, a: col.a * alpha * op * Math.min(1, draw * 1.5) }, stroke: null, strokeWidth: 0, lineCap: 'round', lineJoin: 'round', dash: null, fillRule: 'nonzero', seed: seed + (meta.k ?? 0), meta: { glyph: true, ...meta }, draw: 1 });
    };
    const board = !!theme.board && !!handLabelFactory;
    const labelAt = (tex, size, place, meta) => {
      if (board) {
        const h = handLabelFactory(tex, size);
        if (h) {
          const [ox, oy] = place(h.width, h.height, 0);
          const path = { subpaths: h.strokes.map((st) => polyPath(st.map(([x, y]) => [x + ox, y + oy])).subpaths[0]).filter(Boolean) };
          push(path, this.labelColor, 2.6, 1, { ...meta, handwriting: true });
          return;
        }
      }
      const g = labelGlyphs(tex, size);
      if (!g) return;
      const [ox, oy] = place(g.width, g.height, g.depth);
      const glyphPath = transformPath(g.path, [1, 0, 0, 1, ox, oy]);
      // Labels sit above the plots inside the axes, on a halo of background so curves never cut through digits.
      const bg = this.labelHalo ? c.color('background') : null;
      if (bg && draw > 0) {
        c.items.push({ kind: 'path', id: `${this.id}:${meta.part ?? 'label'}:halo`, nodeType: 'axesLabel', path: transformPath(glyphPath, m), fill: null, stroke: { ...bg, a: bg.a * op * Math.min(1, draw * 1.5) }, strokeWidth: 7, lineCap: 'round', lineJoin: 'round', dash: null, fillRule: 'nonzero', seed, meta: { ...meta, halo: true, aboveChildren: true }, draw: 1 });
      }
      pushFill(glyphPath, this.labelColor, 1, { ...meta, aboveChildren: !!bg });
    };
    const curved = s.polar > 0;
    const N = curved ? 72 : 1;
    const hline = (y) => {
      const pts = [];
      for (let i = 0; i <= N; i++) pts.push(this.toLocal(s.xMin + ((s.xMax - s.xMin) * i) / N, y, s));
      return polyPath(pts);
    };
    const vline = (x) => {
      const pts = [];
      for (let i = 0; i <= N; i++) pts.push(this.toLocal(x, s.yMin + ((s.yMax - s.yMin) * i) / N, s));
      return polyPath(pts);
    };
    const tx = this._ticks('x', s);
    const ty = this._ticks('y', s);
    const labelSize = this.labelSize ?? theme.type.scale.caption;
    if (this.grid) {
      let k = 100;
      for (const v of tx.ticks) push(vline(v), this.gridColor, sw.grid, 0.9, { part: 'grid', k: k++ });
      for (const v of ty.ticks) push(hline(v), this.gridColor, sw.grid, 0.9, { part: 'grid', k: k++ });
      if (this.grid === 'minor') {
        const minor = (ticks, step) => {
          const out = [];
          for (let i = 0; i + 1 < ticks.length; i++) for (let j = 1; j < 5; j++) out.push(ticks[i] + (step * j) / 5);
          return out;
        };
        for (const v of tx.log ? tx.minor : minor(tx.ticks, tx.step)) push(vline(v), this.gridColor, sw.grid * 0.7, 0.5, { part: 'grid', k: k++ });
        for (const v of ty.log ? ty.minor : minor(ty.ticks, ty.step)) push(hline(v), this.gridColor, sw.grid * 0.7, 0.5, { part: 'grid', k: k++ });
      }
    }
    if (this.style === 'none') return;
    const xAxisY = this.style === 'cross' && s.yMin <= 0 && s.yMax >= 0 && this.yScale !== 'log' ? 0 : s.yMin;
    const yAxisX = this.style === 'cross' && s.xMin <= 0 && s.xMax >= 0 && this.xScale !== 'log' ? 0 : s.xMin;
    const tick = 0.09;
    const tipL = 0.2;
    const tipW = 0.15;
    if (this.showX) {
      push(hline(xAxisY), this.axisColor, sw.axis, 1, { part: 'xaxis', k: 1 });
      if (this.style === 'box') push(hline(s.yMax), this.axisColor, sw.axis, 1, { part: 'xaxis2', k: 2 });
      tx.ticks.forEach((v, i) => {
        const [lx, ly] = this.toLocal(v, xAxisY, s);
        const dir = this.style === 'cross' ? [-tick, tick] : [-tick, 0];
        push(polyPath([[lx, ly + dir[0]], [lx, ly + dir[1]]]), this.axisColor, sw.axis, 1, { part: 'tick', k: 10 + i });
        if (!this.xLabels || (this.hideZero && v === 0 && this.showY)) return;
        labelAt(this.format(v, tx.log ? v : tx.step, 'x'), labelSize, (w, h) => [lx - w / 2, ly - tick - 0.12 - h], { part: 'xlabel', k: 200 + i });
      });
      if (this.tips && !curved) {
        const [ex, ey] = this.toLocal(s.xMax, xAxisY, s);
        pushFill(polyPath([[ex + tipL * 0.4, ey], [ex - tipL * 0.6, ey + tipW / 2], [ex - tipL * 0.6, ey - tipW / 2]], true), this.axisColor, 1, { part: 'tip', k: 3, glyph: false, solidFill: true });
      }
      if (this.xTitle) {
        const [ex, ey] = this.toLocal(s.xMax, xAxisY, s);
        labelAt(this.xTitle, labelSize * 1.15, (w, h, d) => [this.style === 'cross' ? ex + 0.25 : -w / 2, this.style === 'cross' ? ey - h / 2 + d / 2 : -s.height / 2 - 0.62 - h], { part: 'xtitle', k: 4 });
      }
    }
    if (this.showY) {
      push(vline(yAxisX), this.axisColor, sw.axis, 1, { part: 'yaxis', k: 5 });
      if (this.style === 'box') push(vline(s.xMax), this.axisColor, sw.axis, 1, { part: 'yaxis2', k: 6 });
      ty.ticks.forEach((v, i) => {
        const [lx, ly] = this.toLocal(yAxisX, v, s);
        const dir = this.style === 'cross' ? [-tick, tick] : [-tick, 0];
        push(polyPath([[lx + dir[0], ly], [lx + dir[1], ly]]), this.axisColor, sw.axis, 1, { part: 'tick', k: 50 + i });
        if (!this.yLabels || (this.hideZero && v === 0 && this.showX)) return;
        labelAt(this.format(v, ty.log ? v : ty.step, 'y'), labelSize, (w, h, d) => [lx - tick - 0.14 - w, ly - (h - d) / 2], { part: 'ylabel', k: 300 + i });
      });
      if (this.tips && !curved) {
        const [ex, ey] = this.toLocal(yAxisX, s.yMax, s);
        pushFill(polyPath([[ex, ey + tipL * 0.4], [ex - tipW / 2, ey - tipL * 0.6], [ex + tipW / 2, ey - tipL * 0.6]], true), this.axisColor, 1, { part: 'tip', k: 7, glyph: false, solidFill: true });
      }
      if (this.yTitle) {
        const [ex, ey] = this.toLocal(yAxisX, s.yMax, s);
        labelAt(this.yTitle, labelSize * 1.15, (w) => [this.style === 'cross' ? ex - w / 2 : -s.width / 2 - 0.3 - w, this.style === 'cross' ? ey + 0.3 : s.height / 2 + 0.2], { part: 'ytitle', k: 8 });
      }
    }
  }
}

function pickNodeProps(opts) {
  const out = {};
  for (const k of ['x', 'y']) if (typeof opts[k] === 'number') out[k] = opts[k];
  for (const k of ['position', 'opacity', 'id', 'name', 'tokens', 'meta', 'scale', 'rotation']) if (opts[k] !== undefined) out[k] = opts[k];
  if (Array.isArray(opts.position)) out.position = opts.position;
  return out;
}

/**
 * A number line: an axes object with only the x axis.
 */
export class NumberLine extends Axes {
  /** @param {{range?: number[], length?: number} & AxesOptions} [opts] */
  constructor(opts = {}) {
    super({ type: 'numberLine', x: opts.range ?? [-5, 5], y: [-1, 1], width: opts.length ?? 10, height: 0.001, style: 'cross', showY: false, tips: opts.tips ?? false, hideZero: false, ...opts, xLabels: opts.labels ?? true });
  }

  /**
   * World point for a number.
   * @param {number} v
   * @returns {[number, number]}
   */
  n2p(v) {
    return this.c2p(v, 0);
  }
}

/**
 * The complex plane: axes with imaginary-unit labels on y.
 */
export class ComplexPlane extends Axes {
  /** @param {AxesOptions} [opts] */
  constructor(opts = {}) {
    super({
      type: 'complexPlane',
      grid: true,
      format: (v, step, axis) => {
        const t = formatTick(v, step);
        if (axis === 'x') return t;
        if (t === '1') return 'i';
        if (t === '-1') return '-i';
        return `${t}i`;
      },
      ...opts,
    });
  }

  /**
   * World point of a complex number given as [re, im] or {re, im}.
   * @param {number[]|{re: number, im: number}} z
   * @returns {[number, number]}
   */
  n2p(z) {
    const re = Array.isArray(z) ? z[0] : z.re;
    const im = Array.isArray(z) ? z[1] : z.im;
    return this.c2p(re, im);
  }
}

/**
 * Polar grid: concentric circles and radial lines. Plot into it with
 * `plotPolar(r(theta))`.
 */
export class PolarPlane extends Node {
  /** @param {{radius?: number, rMax?: number, rings?: number, spokes?: number, labels?: boolean} & Record<string, any>} [opts] */
  constructor(opts = {}) {
    super('polarPlane', pickNodeProps(opts));
    this._define('radius', opts.radius ?? 3.5);
    this._define('rMax', opts.rMax ?? 1);
    this.rings = opts.rings ?? 4;
    this.spokes = opts.spokes ?? 12;
    this.labels = opts.labels ?? true;
  }

  /**
   * World point for polar coordinates.
   * @param {number} r
   * @param {number} theta radians
   * @returns {[number, number]}
   */
  pr2p(r, theta) {
    const k = this.get('radius') / this.get('rMax');
    return applyMat(this.worldMatrix(), r * k * Math.cos(theta), r * k * Math.sin(theta));
  }

  /**
   * Local point for Cartesian data (x, y), in units of rMax. Plots added to
   * the plane use this, like they use an Axes.
   * @param {number} x
   * @param {number} y
   * @returns {[number, number]}
   */
  toLocal(x, y) {
    const k = this.get('radius') / this.get('rMax');
    return [x * k, y * k];
  }

  /** State shaped like an Axes state, for plots. @returns {Record<string, number>} */
  state() {
    const r = this.get('rMax');
    return { xMin: -r, xMax: r, yMin: -r, yMax: r, width: 2 * this.get('radius'), height: 2 * this.get('radius'), polar: 0 };
  }

  /**
   * Plot r = f(theta) into this plane.
   * @param {Function|string} r
   * @param {Record<string, any>} [opts] range [t0, t1], samples, color
   * @returns {plots.PolarGraph}
   */
  plotPolar(r, opts = {}) {
    const g = new plots.PolarGraph(r, opts);
    this.add(g);
    return g;
  }

  geometry() {
    const R = this.get('radius');
    return { subpaths: [{ points: [-R, -R, -R, -R, R, R, R, R], closed: false }] };
  }

  resolvedGeometry() {
    return null;
  }

  sampleItems(c) {
    const R = this.get('radius');
    const draw = this.get('draw');
    const m = c.matrix;
    const theme = c.theme;
    const seed = hashSeed(this.id);
    const col = (t, a) => {
      const k = c.color(t);
      return k ? { ...k, a: k.a * a * c.opacity } : null;
    };
    const push = (p, stroke, w, k) => {
      let q = transformPath(p, m);
      if (draw < 1) q = partialPath(q, 0, draw);
      c.items.push({ kind: 'path', id: `${this.id}:${k}`, nodeType: 'polarGrid', path: q, fill: null, stroke, strokeWidth: w, lineCap: 'butt', lineJoin: 'round', dash: null, fillRule: 'nonzero', seed: seed + k, meta: {}, draw });
    };
    for (let i = 1; i <= this.rings; i++) {
      const r = (R * i) / this.rings;
      const pts = [];
      for (let a = 0; a <= 96; a++) pts.push([r * Math.cos((a / 96) * 2 * Math.PI), r * Math.sin((a / 96) * 2 * Math.PI)]);
      push(polyPath(pts), col(i === this.rings ? 'muted' : 'grid', i === this.rings ? 0.8 : 1), theme.stroke.grid, i);
    }
    for (let j = 0; j < this.spokes; j++) {
      const a = (2 * Math.PI * j) / this.spokes;
      push(polyPath([[0, 0], [R * Math.cos(a), R * Math.sin(a)]]), col('grid', 1), theme.stroke.grid, 100 + j);
    }
    if (!this.labels) return;
    const size = theme.type.scale.caption;
    for (let j = 0; j < this.spokes; j++) {
      const a = (2 * Math.PI * j) / this.spokes;
      const tex = angleTex(j, this.spokes);
      const g = labelGlyphs(tex, size);
      if (!g) continue;
      const rr = R + 0.32;
      const ox = rr * Math.cos(a) - g.width / 2;
      const oy = rr * Math.sin(a) - (g.height - g.depth) / 2;
      const fill = col('muted', Math.min(1, draw * 1.5));
      if (!fill) continue;
      c.items.push({ kind: 'path', id: `${this.id}:label${j}`, nodeType: 'axesLabel', path: transformPath(transformPath(g.path, [1, 0, 0, 1, ox, oy]), m), fill, stroke: null, strokeWidth: 0, lineCap: 'round', lineJoin: 'round', dash: null, fillRule: 'nonzero', seed: seed + 200 + j, meta: { glyph: true }, draw: 1 });
    }
  }
}

/**
 * TeX for the angle j * 2 pi / n in lowest terms.
 * @param {number} j
 * @param {number} n
 * @returns {string}
 */
export function angleTex(j, n) {
  if (j === 0) return '0';
  const g = gcd(2 * j, n);
  const num = (2 * j) / g;
  const den = n / g;
  const top = num === 1 ? '\\pi' : `${num}\\pi`;
  return den === 1 ? top : `\\frac{${top}}{${den}}`;
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : Math.abs(a);
}

/**
 * Plot helpers added to Axes. Each creates a plot node, adds it to the
 * axes, and returns it (not yet visible in the scene until played or the
 * axes itself is visible).
 */
Object.assign(Axes.prototype, {
  /**
   * Graph y = f(x).
   * @param {Function|string} f
   * @param {Record<string, any>} [opts]
   */
  plot(f, opts = {}) {
    const g = new plots.FunctionGraph(f, opts);
    this.add(g);
    return g;
  },
  /** @param {Function|string[]} f @param {Record<string, any>} [opts] */
  plotParametric(f, opts = {}) {
    const g = new plots.ParametricCurve(f, opts);
    this.add(g);
    return g;
  },
  /** @param {Function|string} r @param {Record<string, any>} [opts] */
  plotPolar(r, opts = {}) {
    const g = new plots.PolarGraph(r, opts);
    this.add(g);
    return g;
  },
  /** @param {Function|string} F @param {Record<string, any>} [opts] */
  plotImplicit(F, opts = {}) {
    const g = new plots.ImplicitCurve(F, opts);
    this.add(g);
    return g;
  },
  /** @param {Function|string} F @param {Record<string, any>} [opts] */
  contours(F, opts = {}) {
    const g = new plots.Contours(F, opts);
    this.add(g);
    g.build(this);
    return g;
  },
  /** @param {Function|string[]} F @param {Record<string, any>} [opts] */
  vectorField(F, opts = {}) {
    const g = new plots.VectorField(F, opts);
    this.add(g);
    g.build(this);
    return g;
  },
  /** @param {Function|string[]} F @param {Record<string, any>} [opts] */
  streamLines(F, opts = {}) {
    const g = new plots.StreamLines(F, opts);
    this.add(g);
    g.build(this);
    return g;
  },
  /** @param {Function|string} F @param {Record<string, any>} [opts] */
  heatmap(F, opts = {}) {
    const g = new plots.Heatmap(F, opts);
    this.add(g);
    g.build(this);
    return g;
  },
  /** @param {any} graph @param {number[]} range @param {Record<string, any>} [opts] */
  areaUnder(graph, range, opts = {}) {
    const g = new plots.AreaUnder(graph, range, opts);
    this.add(g);
    return g;
  },
  /** @param {any} f @param {number[]} range @param {Record<string, any>} [opts] */
  riemann(f, range, opts = {}) {
    const g = new plots.RiemannRects(f, range, opts);
    this.add(g);
    g.build();
    return g;
  },
  /** @param {any} graph @param {number} x0 @param {Record<string, any>} [opts] */
  tangent(graph, x0, opts = {}) {
    const g = new plots.TangentLine(graph, x0, opts);
    this.add(g);
    return g;
  },
  /** @param {number[]} values @param {Record<string, any>} [opts] */
  bars(values, opts = {}) {
    const g = new plots.BarChart(values, opts);
    this.add(g);
    return g;
  },
  /** @param {number[]} samples @param {Record<string, any>} [opts] */
  histogram(samples, opts = {}) {
    const g = plots.histogram(samples, opts);
    this.add(g);
    return g;
  },
  /** @param {Array<[number, number]>} points @param {Record<string, any>} [opts] */
  scatter(points, opts = {}) {
    const g = new plots.Scatter(points, opts);
    this.add(g);
    return g;
  },
  /** @param {Array<[number, number]>} points @param {Record<string, any>} [opts] */
  line(points, opts = {}) {
    const g = new plots.LineChart(points, opts);
    this.add(g);
    return g;
  },
  /** @param {number} x @param {number} y @param {Record<string, any>} [opts] */
  dot(x, y, opts = {}) {
    const g = new plots.DataDot(x, y, opts);
    this.add(g);
    return g;
  },
  /** @param {Array<[number, number]>} points @param {Record<string, any>} [opts] */
  polyline(points, opts = {}) {
    const g = new plots.DataPolyline(points, opts);
    this.add(g);
    return g;
  },
});
