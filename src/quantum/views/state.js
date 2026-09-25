/**
 * State visualizations: amplitude bars, probability bars and pie, phase
 * disks, Dirac notation, matrices, Hinton diagrams, entanglement graphs,
 * Schmidt coefficients, and sweep plots. Views hold their data in tracked
 * properties, so a state change animates (bars grow, disks turn).
 * @module quantum/views/state
 */

import { Node, Group, PathNode } from '../../core/node.js';
import { PathBuilder, rectPath, circlePath, polyPath, emptyPath } from '../../core/path.js';
import { Tex } from '../../text/nodes.js';
import { phaseColor, toHex, rgbToOklch } from '../../core/color.js';
import { pushPathItem } from '../../core/sampler.js';
import { describeState } from '../state.js';
import { diracTerms, formatDirac, exactForm } from '../notation.js';
import { concurrence, mutualInformationMatrix, schmidtDecomposition } from '../analysis.js';
import { Axes } from '../../core/coords.js';
import { Animation } from '../../core/animations.js';
import { unitaryPath } from '../decompose.js';
import { gateMatrix } from '../gates.js';

/**
 * Flatten a pure state into [re0, im0, re1, im1, ...].
 * @param {import('../state.js').StateLike} state
 * @returns {number[]}
 */
export function amplitudesOf(state) {
  const d = describeState(state);
  if (!d.pure) throw new Error('This view needs a pure state');
  const out = [];
  for (let i = 0; i < d.re.length; i++) out.push(d.re[i], d.im[i]);
  return out;
}

/**
 * MSB-first bitstring label for basis index i of n qubits.
 * @param {number} i
 * @param {number} n
 * @returns {string}
 */
export function basisLabel(i, n) {
  return i.toString(2).padStart(n, '0');
}

/**
 * Base for views that show 2^n amplitudes held in the tracked `amps` array.
 */
class AmplitudeView extends Group {
  /** @param {string} type @param {number} n @param {import('../state.js').StateLike|null} state @param {Record<string, any>} props */
  constructor(type, n, state, props) {
    super([], { type, ...pick(props) });
    this.n = n;
    this._define('amps', state ? amplitudesOf(state) : initialAmps(n));
  }

  /**
   * Set the displayed state (tweens when used inside `.animate`).
   * @param {import('../state.js').StateLike} state
   * @returns {this}
   */
  setState(state) {
    return this.set('amps', amplitudesOf(state));
  }

  /** @returns {number[]} */
  amps() {
    return this.get('amps');
  }
}

function initialAmps(n) {
  const a = new Array(2 * 2 ** n).fill(0);
  a[0] = 1;
  return a;
}

function pick(props) {
  const out = {};
  for (const k of ['x', 'y', 'position', 'opacity', 'id', 'name', 'tokens', 'scale']) if (props[k] !== undefined) out[k] = props[k];
  return out;
}

/**
 * Amplitude bars over the computational basis. In 'signed' mode real
 * amplitudes draw up or down from a baseline (the Grover picture); in
 * 'phase' mode bar height is |amplitude| and color is the phase; in
 * 'probability' mode height is |amplitude|^2.
 */
export class AmplitudeBars extends AmplitudeView {
  /**
   * @param {number} n qubits
   * @param {import('../state.js').StateLike|null} [state]
   * @param {Record<string, any>} [props] mode ('signed' | 'phase' | 'probability'), width (world, default 8), height (default 3), labels (true), highlight (basis indices drawn in the accent)
   */
  constructor(n, state = null, props = {}) {
    super('amplitudeBars', n, state, props);
    this.mode = props.mode ?? 'signed';
    this.w = props.width ?? 8;
    this.h = props.height ?? 3;
    this.highlight = new Set(props.highlight ?? []);
    const N = 2 ** n;
    this.slot = this.w / N;
    this.barW = this.slot * 0.62;
    this.baseline = new PathNode(polyPath([[-this.w / 2 - 0.1, 0], [this.w / 2 + 0.1, 0]]), { type: 'baseline', stroke: 'muted', strokeWidth: 2 });
    this.add(this.baseline);
    this.bars = [];
    for (let i = 0; i < N; i++) {
      const bar = new AmpBar(this, i);
      this.bars.push(bar);
      this.add(bar);
    }
    this.labels = [];
    if (props.labels ?? true) {
      const size = Math.min(0.3, this.slot * 0.42 / Math.max(1, n * 0.42));
      for (let i = 0; i < N; i++) {
        const t = new Tex(`\\lvert ${basisLabel(i, n)}\\rangle`, { size, color: 'muted' });
        t.moveTo([this.xOf(i), -this.h / 2 - 0.22]);
        this.labels.push(t);
        this.add(t);
      }
    }
    if (this.mode === 'signed') {
      // Baseline sits at the middle so negative amplitudes have room.
      this.baseline.set('y', 0);
    } else {
      this.baseline.set('y', -this.h / 2);
    }
  }

  /**
   * Local x of basis state i.
   * @param {number} i
   * @returns {number}
   */
  xOf(i) {
    return -this.w / 2 + this.slot * (i + 0.5);
  }

  /** Local y of the baseline. @returns {number} */
  baseY() {
    return this.mode === 'signed' ? 0 : -this.h / 2;
  }
}

/**
 * Phase hue on an even OKLCH ring whose zero is the theme accent's hue, so a
 * real positive amplitude always shows in the accent color.
 * @param {number} phase
 * @param {any} c sampler context
 * @returns {string}
 */
export function phaseFill(phase, c) {
  const acc = c.color('accent');
  const { L, C, H } = rgbToOklch(acc);
  return toHex(phaseColor(phase, { L: Math.min(0.8, Math.max(0.55, L)), C: Math.max(0.07, Math.min(0.11, C)), offset: H }));
}

class AmpBar extends Node {
  constructor(owner, i) {
    super('ampBar', { fill: 'accent', stroke: null, meta: { solidFill: false } });
    this.owner = owner;
    this.i = i;
  }

  value() {
    const a = this.owner.amps();
    const re = a[2 * this.i];
    const im = a[2 * this.i + 1];
    return { re, im, mag: Math.hypot(re, im), phase: Math.atan2(im, re) };
  }

  geometry() {
    const o = this.owner;
    const { re, mag } = this.value();
    const H = o.h;
    let top;
    let bottom;
    if (o.mode === 'signed') {
      const v = Math.abs(re) > 1e-12 && Math.abs(mag - Math.abs(re)) < 1e-6 ? re : mag;
      const y = (v * H) / 2;
      top = Math.max(0, y);
      bottom = Math.min(0, y);
    } else if (o.mode === 'probability') {
      top = -H / 2 + mag * mag * H;
      bottom = -H / 2;
    } else {
      top = -H / 2 + mag * H;
      bottom = -H / 2;
    }
    if (top - bottom < 1e-4) return emptyPath();
    return rectPath(o.xOf(this.i), (top + bottom) / 2, o.barW, top - bottom, Math.min(0.04, (top - bottom) / 2));
  }

  sampleItems(c) {
    const o = this.owner;
    const { re, phase } = this.value();
    let fill;
    if (o.highlight.has(this.i)) fill = 'accent2';
    // A real positive amplitude shows in the exact accent rather than its ring approximation.
    else if (o.mode === 'phase' && Math.abs(phase) > 1e-6) fill = phaseFill(phase, c);
    else fill = 'accent';
    // Negative amplitudes keep their color and read as negative by position; a lighter tone separates them.
    const alpha = o.mode === 'signed' && re < -1e-9 && !o.highlight.has(this.i) ? 0.6 : 1;
    pushPathItem(this, this.resolvedGeometry(), { ...c, opacity: c.opacity * alpha }, { fillColor: fill });
  }
}

/**
 * Probabilities as a bar chart with value labels.
 */
export class ProbabilityBars extends AmplitudeBars {
  /** @param {number} n @param {import('../state.js').StateLike|null} [state] @param {Record<string, any>} [props] */
  constructor(n, state = null, props = {}) {
    super(n, state, { ...props, mode: 'probability' });
    this.type = 'probabilityBars';
  }
}

/**
 * Probabilities as a pie (annular sectors), largest first.
 */
export class ProbabilityPie extends AmplitudeView {
  /** @param {number} n @param {import('../state.js').StateLike|null} [state] @param {Record<string, any>} [props] radius (1.6), inner (0.55) */
  constructor(n, state = null, props = {}) {
    super('probabilityPie', n, state, props);
    this.radius = props.radius ?? 1.6;
    this.inner = props.inner ?? 0.55;
    const N = 2 ** n;
    for (let i = 0; i < N; i++) this.add(new PieSlice(this, i));
  }

  /** Start and end angles of slice i (clockwise from the top). @returns {[number, number]} */
  sliceAngles(i) {
    const a = this.amps();
    let acc = 0;
    let total = 0;
    for (let k = 0; k < a.length / 2; k++) total += a[2 * k] ** 2 + a[2 * k + 1] ** 2;
    for (let k = 0; k < i; k++) acc += (a[2 * k] ** 2 + a[2 * k + 1] ** 2) / (total || 1);
    const p = (a[2 * i] ** 2 + a[2 * i + 1] ** 2) / (total || 1);
    return [Math.PI / 2 - 2 * Math.PI * acc, Math.PI / 2 - 2 * Math.PI * (acc + p)];
  }
}

class PieSlice extends Node {
  constructor(owner, i) {
    super('pieSlice', { fill: 'accent', stroke: 'background', strokeWidth: 3, meta: { solidFill: false } });
    this.owner = owner;
    this.i = i;
  }

  geometry() {
    const [a0, a1] = this.owner.sliceAngles(this.i);
    if (Math.abs(a1 - a0) < 1e-6) return emptyPath();
    const { radius: R, inner } = this.owner;
    const b = new PathBuilder();
    b.arc(0, 0, R, a0, a1);
    b.arc(0, 0, R * inner, a1, a0);
    return b.close().build();
  }

  sampleItems(c) {
    const N = 2 ** this.owner.n;
    const shade = 0.35 + 0.65 * (1 - this.i / Math.max(1, N - 1));
    const col = c.color('accent');
    pushPathItem(this, this.resolvedGeometry(), c, { fillColor: col ? { ...col, a: col.a * shade } : 'accent' });
  }
}

/**
 * Phase disks: one circle per basis state, filled in proportion to the
 * probability, with a hand showing the phase.
 */
export class PhaseDisks extends AmplitudeView {
  /** @param {number} n @param {import('../state.js').StateLike|null} [state] @param {Record<string, any>} [props] radius (0.36), gap (0.18), cols */
  constructor(n, state = null, props = {}) {
    super('phaseDisks', n, state, props);
    const N = 2 ** n;
    this.r = props.radius ?? 0.36;
    const gap = props.gap ?? 0.18;
    const cols = props.cols ?? Math.min(N, 8);
    const rows = Math.ceil(N / cols);
    for (let i = 0; i < N; i++) {
      const cx = (i % cols - (cols - 1) / 2) * (2 * this.r + gap);
      const cy = -(Math.floor(i / cols) - (rows - 1) / 2) * (2 * this.r + gap + 0.32);
      this.add(new PhaseDisk(this, i, cx, cy));
      const t = new Tex(`${basisLabel(i, n)}`, { size: 0.2, color: 'muted' });
      t.moveTo([cx, cy - this.r - 0.18]);
      this.add(t);
    }
  }
}

class PhaseDisk extends Node {
  constructor(owner, i, cx, cy) {
    super('phaseDisk', { stroke: 'muted', strokeWidth: 1.8 });
    this.owner = owner;
    this.i = i;
    this.cx = cx;
    this.cy = cy;
  }

  geometry() {
    return circlePath(this.cx, this.cy, this.owner.r);
  }

  sampleItems(c) {
    const a = this.owner.amps();
    const re = a[2 * this.i];
    const im = a[2 * this.i + 1];
    const mag = Math.hypot(re, im);
    const r = this.owner.r;
    pushPathItem(this, this.resolvedGeometry(), c, { fillColor: null });
    if (mag > 1e-6) {
      pushPathItem(this, circlePath(this.cx, this.cy, r * mag), c, { fillColor: 'accent', strokeColor: null, strokeWidth: 0, meta: { solidFill: true } });
      const ph = Math.atan2(im, re);
      pushPathItem(this, polyPath([[this.cx, this.cy], [this.cx + r * Math.cos(ph), this.cy + r * Math.sin(ph)]]), c, { strokeColor: 'ink', strokeWidth: 2.4, fillColor: null });
    }
  }
}

/**
 * Dirac notation typeset from a computed state, honoring SymbolicNotation,
 * HideNegligibles, DecimalPlaces, SortBy, and SortOrder.
 * @param {import('../state.js').StateLike} state
 * @param {Record<string, any>} [opts] symbolic, decimalPlaces, hideNegligibles, sortBy, sortOrder, name ('\\psi'), size, maxTerms
 * @returns {Tex}
 */
export function diracTex(state, opts = {}) {
  return new Tex(diracLatex(state, opts), { size: opts.size ?? 0.55, color: opts.color });
}

/**
 * LaTeX for a state in Dirac notation. When every shown term has the same
 * magnitude it is factored out (1/sqrt(8) times a sum of phases), and long
 * sums wrap onto aligned lines.
 * @param {import('../state.js').StateLike} state
 * @param {Record<string, any>} [opts] symbolic, decimalPlaces, hideNegligibles, sortBy, sortOrder, name, maxTerms (8), perLine (4), factor (true)
 * @returns {string}
 */
export function diracLatex(state, opts = {}) {
  const terms = diracTerms(state, {
    symbolic: opts.symbolic ?? true,
    decimalPlaces: opts.decimalPlaces ?? 3,
    hideNegligibles: opts.hideNegligibles ?? true,
    sortBy: opts.sortBy ?? 'state',
    sortOrder: opts.sortOrder ?? 'ascending',
  });
  const max = opts.maxTerms ?? 8;
  const perLine = opts.perLine ?? 4;
  const shown = terms.slice(0, max);
  const name = opts.name ?? '\\psi';
  const mags = shown.map((t) => Math.hypot(t.re, t.im));
  const same = (opts.factor ?? true) && shown.length > 1 && mags.every((m) => Math.abs(m - mags[0]) < 1e-9);
  let prefix = '';
  let pieces;
  if (same) {
    prefix = exactForm({ re: mags[0], im: 0 }, { decimals: opts.decimalPlaces ?? 3 }).latex;
    pieces = shown.map((t, i) => {
      const ph = exactForm({ re: t.re / mags[0], im: t.im / mags[0] }, { decimals: opts.decimalPlaces ?? 3 }).latex;
      const ket = `\\lvert ${t.label}\\rangle`;
      if (ph === '1') return (i ? '+ ' : '') + ket;
      if (ph === '-1') return `- ${ket}`;
      if (ph.startsWith('-')) return `- ${ph.slice(1)}${ket}`;
      return `${i ? '+ ' : ''}${ph}${ket}`;
    });
  } else {
    pieces = shown.map((t, i) => {
      const one = formatDirac([t], { format: 'latex' });
      return i && !one.startsWith('-') ? `+ ${one}` : one;
    });
  }
  if (terms.length > max) pieces.push('+ \\cdots');
  const lines = [];
  for (let i = 0; i < pieces.length; i += perLine) lines.push(pieces.slice(i, i + perLine).join(' '));
  const head = `\\lvert ${name}\\rangle = `;
  if (lines.length === 1) return same ? `${head}${prefix}\\left(${lines[0]}\\right)` : `${head}${lines[0]}`;
  if (same) return `\\begin{aligned} ${head}${prefix}\\big(& ${lines.join(' \\\\ & ')} \\big) \\end{aligned}`;
  return `\\begin{aligned} ${head}& ${lines.join(' \\\\ & ')} \\end{aligned}`;
}

/**
 * LaTeX for a complex matrix using exact forms where they exist.
 * @param {import('../../qubi/ir.js').CMatrix} M
 * @param {{decimals?: number, bracket?: 'pmatrix'|'bmatrix'}} [opts]
 * @returns {string}
 */
export function matrixLatex(M, opts = {}) {
  const env = opts.bracket ?? 'bmatrix';
  const rows = [];
  for (let i = 0; i < M.rows; i++) {
    const row = [];
    for (let j = 0; j < M.cols; j++) {
      const k = i * M.cols + j;
      row.push(exactForm({ re: M.re[k], im: M.im[k] }, { decimals: opts.decimals ?? 2 }).latex);
    }
    rows.push(row.join(' & '));
  }
  return `\\begin{${env}} ${rows.join(' \\\\ ')} \\end{${env}}`;
}

/**
 * Matrix as typeset math (for gates, unitaries, density matrices).
 * @param {import('../../qubi/ir.js').CMatrix} M
 * @param {Record<string, any>} [opts] decimals, size, prefix (TeX before the matrix, for example 'U =')
 * @returns {Tex}
 */
export function matrixTex(M, opts = {}) {
  const pre = opts.prefix ? `${opts.prefix} ` : '';
  return new Tex(pre + matrixLatex(M, opts), { size: opts.size ?? 0.45, color: opts.color });
}

/**
 * Hinton diagram: squares sized by magnitude; color by sign (real part) or
 * phase. Works for density matrices and unitaries.
 */
export class HintonDiagram extends Group {
  /**
   * @param {import('../../qubi/ir.js').CMatrix} M
   * @param {Record<string, any>} [props] size (world width, default 4), part ('magnitude'|'real'|'imag'|'phase'), grid (true)
   */
  constructor(M, props = {}) {
    super([], { type: 'hinton', ...pick(props) });
    this.M = M;
    const S = props.size ?? 4;
    const cell = S / Math.max(M.rows, M.cols);
    const part = props.part ?? 'magnitude';
    let max = 0;
    for (let k = 0; k < M.re.length; k++) max = Math.max(max, Math.hypot(M.re[k], M.im[k]));
    if (props.grid ?? true) {
      const g = new PathBuilder();
      for (let i = 0; i <= M.rows; i++) g.moveTo(-S / 2, S / 2 - i * cell).lineTo(-S / 2 + M.cols * cell, S / 2 - i * cell);
      for (let j = 0; j <= M.cols; j++) g.moveTo(-S / 2 + j * cell, S / 2).lineTo(-S / 2 + j * cell, S / 2 - M.rows * cell);
      this.add(new PathNode(g.build(), { type: 'hintonGrid', stroke: 'grid', strokeWidth: 1.4 }));
    }
    for (let i = 0; i < M.rows; i++) {
      for (let j = 0; j < M.cols; j++) {
        const k = i * M.cols + j;
        const re = M.re[k];
        const im = M.im[k];
        let v;
        if (part === 'real') v = re;
        else if (part === 'imag') v = im;
        else v = Math.hypot(re, im);
        const mag = Math.abs(v) / (max || 1);
        if (mag < 1e-6) continue;
        const side = cell * 0.9 * Math.sqrt(mag);
        const cx = -S / 2 + (j + 0.5) * cell;
        const cy = S / 2 - (i + 0.5) * cell;
        // Real values show their sign (accent up, accent2 down); complex values show their phase.
        const isReal = Math.abs(im) < 1e-9;
        let fill;
        if (part === 'phase' || (part === 'magnitude' && !isReal)) fill = toHex(phaseColor(Math.atan2(im, re)));
        else fill = (part === 'magnitude' ? re : v) < 0 ? 'accent2' : 'accent';
        this.add(new PathNode(rectPath(cx, cy, side, side, Math.min(0.03, side / 4)), { type: 'hintonCell', fill, stroke: null, meta: { solidFill: true } }));
      }
    }
  }
}

/**
 * Entanglement graph: qubits on a circle, edges weighted by concurrence
 * (two-qubit reduced states) or mutual information.
 */
export class EntanglementGraph extends Group {
  /**
   * @param {import('../state.js').StateLike} state
   * @param {Record<string, any>} [props] measure ('mutual' | 'concurrence'), radius (1.8)
   */
  constructor(state, props = {}) {
    super([], { type: 'entanglementGraph', ...pick(props) });
    const d = describeState(state);
    const n = d.numQubits;
    const R = props.radius ?? 1.8;
    const measure = props.measure ?? 'mutual';
    const pos = Array.from({ length: n }, (_, q) => [R * Math.cos(Math.PI / 2 - (2 * Math.PI * q) / n), R * Math.sin(Math.PI / 2 - (2 * Math.PI * q) / n)]);
    const mi = measure === 'mutual' ? mutualInformationMatrix(state) : null;
    this.weights = [];
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const w = measure === 'mutual' ? mi[a][b] / 2 : concurrence(state, [a, b]);
        this.weights.push({ a, b, w });
        if (w < 1e-3) continue;
        this.add(new PathNode(polyPath([pos[a], pos[b]]), { type: 'entEdge', stroke: 'accent', strokeWidth: 1.5 + 6 * Math.min(1, w), strokeOpacity: 0.25 + 0.75 * Math.min(1, w) }));
      }
    }
    pos.forEach(([x, y], q) => {
      this.add(new PathNode(circlePath(x, y, 0.3), { type: 'entNode', fill: 'surface', stroke: 'ink', strokeWidth: 2.4, meta: { solidFill: true } }));
      const t = new Tex(`q_{${q}}`, { size: 0.3 });
      t.moveTo([x, y]);
      this.add(t);
    });
  }
}

/**
 * Schmidt coefficients of a bipartition as bars with the entropy.
 * @param {import('../state.js').StateLike} state
 * @param {number[]} wiresA
 * @param {Record<string, any>} [props]
 * @returns {Group}
 */
export function schmidtView(state, wiresA, props = {}) {
  const sd = schmidtDecomposition(state, wiresA);
  const coeffs = sd.coefficients ?? sd.values ?? sd;
  const g = new Group([], { type: 'schmidt', ...pick(props) });
  const ax = new Axes({ x: [0, coeffs.length + 1], y: [0, 1], width: props.width ?? 4, height: props.height ?? 2.4, style: 'left-bottom', xTicks: coeffs.map((_, i) => i + 1), yTicks: [0, 0.5, 1], tips: false });
  g.add(ax);
  const chart = ax.bars(coeffs.map((c) => c * c));
  g.axes = ax;
  g.chart = chart;
  g.coefficients = coeffs;
  return g;
}

/**
 * Sweep plot: probability of a target pattern (or the highest state) versus
 * the swept variable.
 * @param {{x: number[], y: number[], labels?: string[]}} series from sweepProbabilities
 * @param {Record<string, any>} [props] width, height, xTitle, yTitle
 * @returns {Axes}
 */
export function sweepPlot(series, props = {}) {
  const xs = series.x;
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const pad = (x1 - x0) * 0.05 || 1;
  const ax = new Axes({ x: [x0 - pad, x1 + pad], y: [0, 1.05], width: props.width ?? 8, height: props.height ?? 4, style: 'left-bottom', tips: false, grid: true, yTicks: [0, 0.25, 0.5, 0.75, 1], xTitle: props.xTitle, yTitle: props.yTitle ?? 'P' });
  const pts = xs.map((x, i) => [x, series.y[i]]);
  ax.line(pts, { color: 'accent' });
  ax.scatter(pts, { radius: 0.055 });
  return ax;
}

/**
 * Animate a view's state through a gate's action along the unitary path,
 * so amplitudes sweep continuously instead of jumping.
 */
export class ApplyGate extends Animation {
  /**
   * @param {AmplitudeView} view
   * @param {import('../../qubi/ir.js').Op} op
   * @param {import('../state.js').StateLike} before state before the gate
   * @param {Record<string, any>} [opts]
   */
  constructor(view, op, before, opts = {}) {
    super(opts);
    this.view = view;
    this.op = op;
    this.before = amplitudesOf(before);
    this.defaultDuration = 1.2;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const n = this.view.n;
    const U = op2full(this.op, n);
    const psi = this.before;
    const at = (u) => applyMatrixVec(unitaryPath(U, u), psi);
    this.view.tween('amps', s, e, at(1), this.ease, (u) => at(u), psi);
    return e;
  }
}

/**
 * Full 2^n unitary of one op (controls included), LSB = qubit 0.
 * @param {import('../../qubi/ir.js').Op} op
 * @param {number} n
 * @returns {import('../../qubi/ir.js').CMatrix}
 */
export function op2full(op, n) {
  const N = 2 ** n;
  const small = op.matrix ?? gateMatrix(op.name, op.params);
  const t = op.targets;
  const ctrl = op.controls;
  const re = new Float64Array(N * N);
  const im = new Float64Array(N * N);
  const k = t.length;
  for (let col = 0; col < N; col++) {
    const active = ctrl.every((c) => (col >> c) & 1);
    if (!active) {
      re[col * N + col] = 1;
      continue;
    }
    let sub = 0;
    for (let j = 0; j < k; j++) sub |= ((col >> t[j]) & 1) << j;
    for (let r = 0; r < 2 ** k; r++) {
      let row = col;
      for (let j = 0; j < k; j++) row = (row & ~(1 << t[j])) | (((r >> j) & 1) << t[j]);
      const idx = r * small.cols + sub;
      re[row * N + col] += small.re[idx];
      im[row * N + col] += small.im[idx];
    }
  }
  return { rows: N, cols: N, re, im };
}

function applyMatrixVec(M, v) {
  const N = M.rows;
  const out = new Array(2 * N).fill(0);
  for (let i = 0; i < N; i++) {
    let sr = 0;
    let si = 0;
    for (let j = 0; j < N; j++) {
      const ar = M.re[i * N + j];
      const ai = M.im[i * N + j];
      sr += ar * v[2 * j] - ai * v[2 * j + 1];
      si += ar * v[2 * j + 1] + ai * v[2 * j];
    }
    out[2 * i] = sr;
    out[2 * i + 1] = si;
  }
  return out;
}
