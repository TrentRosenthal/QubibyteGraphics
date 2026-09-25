/**
 * Math explainers from a single expression: derivatives, integrals,
 * equations, and simplifications become a stacked derivation with the rule
 * for each step narrated below; a matrix product is walked entry by entry;
 * an eigen problem is solved on the left while the plane transforms on the
 * right. All steps come from the math engine.
 * @module explainers/derivation
 */

import { Group, PathNode } from '../core/node.js';
import { polyPath } from '../core/path.js';
import { Rect } from '../core/shapes.js';
import { fadeIn, fadeOut, write, create } from '../core/animations.js';
import { Text, Tex, transformMatchingTex } from '../text/nodes.js';
import * as M from '../math/index.js';
import { TransformPlane, applyMatrix } from './linear.js';

/** Frame regions shared by every math explainer, in world units. */
const LAYOUT = {
  title: [-7.3, 3.95],
  top: 2.55,
  bottom: -2.95,
  left: -6.6,
  maxWidth: 12.6,
  gap: 0.34,
  narration: { x: 0, y: -3.85, w: 13.6 },
};

/**
 * LaTeX for an exact rational from the math engine ({n, d} with bigint or
 * string parts) or a plain number.
 * @param {any} r
 * @returns {string}
 */
export function rationalLatex(r) {
  if (typeof r === 'number') return String(+r.toFixed(6));
  if (r && typeof r.latex === 'string') return r.latex;
  if (r && typeof r.toLatex === 'function') return r.toLatex();
  const n = BigInt(r.n);
  const d = BigInt(r.d);
  if (d === 1n) return n.toString();
  const neg = n < 0n;
  return `${neg ? '-' : ''}\\tfrac{${(neg ? -n : n).toString()}}{${d.toString()}}`;
}

function rationalValue(r) {
  if (typeof r === 'number') return r;
  return Number(BigInt(r.n)) / Number(BigInt(r.d));
}

/**
 * A matrix drawn as a grid of TeX entries between hand-built brackets, with
 * access to entries, rows, and columns for highlighting.
 */
export class MatrixView extends Group {
  /**
   * @param {string[][]} rows LaTeX for each entry
   * @param {Record<string, any>} [props] size (0.5), colGap (0.55), rowGap (0.32), color
   */
  constructor(rows, props = {}) {
    super([], { type: 'matrixView' });
    this.size = props.size ?? 0.5;
    this.rows = rows.length;
    this.cols = rows[0].length;
    this.entries = rows.map((r) => r.map((tex) => new Tex(tex, { size: this.size, color: props.color })));
    const colW = Array.from({ length: this.cols }, (_, j) => Math.max(...this.entries.map((r) => r[j].width), this.size * 0.6));
    const rowH = Math.max(...this.entries.flat().map((e) => e.height), this.size * 0.9);
    const colGap = props.colGap ?? this.size * 1.1;
    const rowGap = props.rowGap ?? this.size * 0.64;
    const W = colW.reduce((a, b) => a + b, 0) + colGap * (this.cols - 1);
    const H = rowH * this.rows + rowGap * (this.rows - 1);
    this.cellW = colW;
    this.cellH = rowH;
    this.colX = [];
    let x = -W / 2;
    for (let j = 0; j < this.cols; j++) {
      this.colX.push(x + colW[j] / 2);
      x += colW[j] + colGap;
    }
    this.rowY = Array.from({ length: this.rows }, (_, i) => H / 2 - rowH / 2 - i * (rowH + rowGap));
    this.entries.forEach((r, i) => r.forEach((e, j) => {
      e.moveTo([this.colX[j], this.rowY[i]]);
      this.add(e);
    }));
    const bx = W / 2 + this.size * 0.34;
    const by = H / 2 + this.size * 0.26;
    const lip = this.size * 0.24;
    const bracket = (s) => new PathNode(polyPath([[s * (bx - lip), by], [s * bx, by], [s * bx, -by], [s * (bx - lip), -by]]), { type: 'bracket', stroke: props.color ?? 'ink', strokeWidth: 3, fill: null });
    this.brackets = [bracket(-1), bracket(1)];
    this.add(...this.brackets);
    this.innerW = W;
    this.innerH = H;
  }

  /** @param {number} i @param {number} j @returns {Tex} */
  entry(i, j) {
    return this.entries[i][j];
  }

  /**
   * A rounded highlight rectangle around row i, in this view's parent space.
   * @param {number} i
   * @param {Record<string, any>} [props]
   * @returns {Rect}
   */
  rowBox(i, props = {}) {
    const [cx, cy] = this.toParent(0, this.rowY[i]);
    return this._box(cx, cy, this.innerW + this.size * 0.5, this.cellH + this.size * 0.34, props);
  }

  /**
   * A rounded highlight rectangle around column j, in this view's parent space.
   * @param {number} j
   * @param {Record<string, any>} [props]
   * @returns {Rect}
   */
  colBox(j, props = {}) {
    const [cx, cy] = this.toParent(this.colX[j], 0);
    return this._box(cx, cy, this.cellW[j] + this.size * 0.5, this.innerH + this.size * 0.34, props);
  }

  _box(x, y, w, h, props) {
    const k = this.get('scaleX');
    return new Rect({ x, y, width: w * k, height: h * k, radius: 0.08, stroke: props.color ?? 'accent', strokeWidth: 2.5, fill: props.color ?? 'accent', fillOpacity: 0.12, zIndex: -1 });
  }

  /**
   * Parent-space point of a local point (the view is not rotated).
   * @param {number} x
   * @param {number} y
   * @returns {[number, number]}
   */
  toParent(x, y) {
    const k = this.get('scaleX');
    return [this.get('x') + x * k, this.get('y') + y * k];
  }
}

/**
 * Read a single-expression request.
 * @param {string} input
 * @returns {{kind: string, [key: string]: any}}
 */
export function parseMathRequest(input) {
  const src = input.trim();
  let m = src.match(/^d\/d([a-zA-Z])\s+(.+)$/);
  if (m) return { kind: 'derivative', variable: m[1], expr: m[2] };
  m = src.match(/^(?:\\?int)_\{?([^}\s^]+)\}?\^\{?([^}\s]+)\}?\s+(.+?)\s*,?\s*d([a-zA-Z])$/);
  if (m) return { kind: 'definite', lower: m[1], upper: m[2], expr: m[3], variable: m[4] };
  m = src.match(/^(?:\\?int)\s+(.+?)\s*,?\s*d([a-zA-Z])$/);
  if (m) return { kind: 'integral', expr: m[1], variable: m[2] };
  m = src.match(/^solve\s+(.+?)(?:\s+for\s+([a-zA-Z]))?$/);
  if (m) return { kind: 'solve', equation: m[1], variable: m[2] ?? 'x' };
  m = src.match(/^eigen\s+(\[\[.+\]\])$/);
  if (m) return { kind: 'eigen', matrix: JSON.parse(m[1]) };
  m = src.match(/^(\[\[.+?\]\])\s*\*?\s*(\[\[.+\]\])$/);
  if (m) return { kind: 'product', a: JSON.parse(m[1]), b: JSON.parse(m[2]) };
  m = src.match(/^simplify\s+(.+)$/);
  return { kind: 'simplify', expr: m ? m[1] : src };
}

/**
 * Stepped result for a derivation request, from the math engine.
 * @param {{kind: string, [key: string]: any}} req
 * @returns {{title: string, steps: Array<{latex: string, rule: string, chain: boolean}>}}
 */
export function derivationFor(req) {
  const e = (s) => M.parse(s);
  let r;
  let title;
  let chain = true;
  if (req.kind === 'derivative') {
    r = M.differentiate(e(req.expr), req.variable);
    title = 'Differentiating step by step';
  } else if (req.kind === 'definite') {
    r = M.integrateDefinite(e(req.expr), req.variable, e(req.lower), e(req.upper));
    title = 'A definite integral, step by step';
  } else if (req.kind === 'integral') {
    r = M.integrate(e(req.expr), req.variable);
    title = 'Finding an antiderivative';
  } else if (req.kind === 'solve') {
    r = M.solve(e(req.equation), req.variable);
    title = `Solving for ${req.variable}`;
    chain = false;
  } else {
    r = M.simplify(e(req.expr), { steps: true });
    title = 'Simplifying';
  }
  if (!r || r.ok === false) throw new Error(`The math engine could not do this: ${r && r.reason ? r.reason : req.kind}`);
  const raw = r.steps && r.steps.length ? r.steps : [{ latex: M.toLatex(r.result ?? r), rule: 'Result' }];
  const steps = raw.map((s, i) => ({ latex: s.latex, rule: s.rule ?? '', chain: chain && i > 0 && !/^[a-zA-Z\\]+\s*=|,\\quad/.test(s.latex) }));
  return { title, steps };
}

class Narration {
  constructor(scene) {
    this.scene = scene;
    this.current = null;
  }

  async say(text) {
    if (!text) return;
    const t = new Text(text, { size: 0.3, color: 'muted', maxWidth: LAYOUT.narration.w, align: 'center' });
    t.moveTo([LAYOUT.narration.x, LAYOUT.narration.y]);
    this.scene.caption(text, 1.2 + text.split(/\s+/).length * 0.28);
    const out = this.current ? [fadeOut(this.current, { duration: 0.25 })] : [];
    await this.scene.play(...out, fadeIn(t, { shift: [0, 0.1] }), { duration: 0.4 });
    this.current = t;
  }
}

async function stackedDerivation(scene, title, steps, opts) {
  const heading = new Text(opts.title ?? title, { size: 'heading', weight: 'semibold' });
  heading.moveTo(LAYOUT.title, 'top-left');
  await scene.play(fadeIn(heading), { duration: 0.6 });
  const narration = new Narration(scene);
  const size = opts.size ?? 0.54;
  const lines = [];
  let prev = null;
  let prevBox = null;
  let y = LAYOUT.top;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const tex = new Tex((s.chain ? '= ' : '') + s.latex, { size });
    if (tex.width > LAYOUT.maxWidth) tex.fitTo(LAYOUT.maxWidth, tex.height);
    const indent = s.chain ? 0.6 : 0;
    const top = prev ? y - LAYOUT.gap : y;
    // Place by ink bounds, measured before the line takes part in any animation.
    tex.moveTo([LAYOUT.left + indent, top], 'top-left');
    let b = tex.bounds();
    tex.shift(LAYOUT.left + indent - b.x, top - (b.y + b.h));
    b = { x: LAYOUT.left + indent, y: top - b.h, w: b.w, h: b.h };
    // Scroll when the next line would run into the narration band. The
    // first line (the problem) stays pinned; lines pushed past it fade out
    // and the rest close up beneath it.
    if (b.y < LAYOUT.bottom && lines.length > 1) {
      const pinned = lines[0];
      const regionTop = pinned.__top - pinned.__h - LAYOUT.gap;
      const dy = LAYOUT.bottom - b.y;
      const movable = lines.slice(1);
      const leaving = movable.filter((c) => c.__top + dy > regionTop + 0.05);
      const staying = movable.filter((c) => !leaving.includes(c));
      const firstTop = staying.length ? Math.max(...staying.map((c) => c.__top)) + dy : b.y + b.h + dy;
      const lift = dy + (regionTop - firstTop);
      staying.forEach((c) => {
        c.__top += lift;
        c.__center = [c.__center[0], c.__center[1] + lift];
      });
      tex.shift(0, lift);
      b.y += lift;
      const drop = leaving.map((c) => fadeOut(c, { shift: [0, 0.3] }));
      leaving.forEach((c) => lines.splice(lines.indexOf(c), 1));
      await scene.play(...staying.map((c) => c.animate.shift(0, lift)), ...drop, { duration: 0.6 });
    }
    if (i > 0) await narration.say(s.rule);
    if (!prev) {
      await scene.play(write(tex), { duration: 1.2 });
    } else {
      const ghost = new Tex(prev.source, { size });
      ghost.set('scaleX', prev.get('scaleX'));
      ghost.set('scaleY', prev.get('scaleY'));
      ghost.moveTo(prev.__center);
      const gb = ghost.bounds();
      ghost.shift(prev.__center[0] - (gb.x + gb.w / 2), prev.__center[1] - (gb.y + gb.h / 2));
      scene.add(ghost);
      await scene.play(transformMatchingTex(ghost, tex), { duration: opts.stepDuration ?? 1.2 });
    }
    tex.__top = b.y + b.h;
    tex.__h = b.h;
    tex.__center = [b.x + b.w / 2, b.y + b.h / 2];
    lines.push(tex);
    prev = tex;
    prevBox = b;
    y = b.y;
    await scene.wait(opts.hold ?? 0.5);
  }
  const b = prevBox;
  const box = new Rect({ x: b.x + b.w / 2, y: b.y + b.h / 2, width: b.w + 0.36, height: b.h + 0.26, radius: 0.08, stroke: 'accent2', strokeWidth: 3, fill: null });
  await scene.play(create(box), { duration: 0.7 });
}

async function productWalkthrough(scene, req, opts) {
  const A = M.matrix(req.a);
  const B = M.matrix(req.b);
  const prod = M.multiply(A, B);
  const entries = prod.entries;
  const heading = new Text(opts.title ?? 'Multiplying matrices, entry by entry', { size: 'heading', weight: 'semibold' });
  heading.moveTo(LAYOUT.title, 'top-left');
  const size = opts.size ?? 0.55;
  const lat = (rows) => rows.map((r) => r.map((v) => rationalLatex(v)));
  const va = new MatrixView(lat(req.a.map((r) => r.map((v) => ({ n: v, d: 1 })))), { size });
  const vb = new MatrixView(lat(req.b.map((r) => r.map((v) => ({ n: v, d: 1 })))), { size });
  const vc = new MatrixView(entries.map((r) => r.map((c) => rationalLatex(c.value))), { size, color: 'accent2' });
  const eq = new Tex('=', { size });
  const gap = 0.45;
  const total = va.width + vb.width + eq.width + vc.width + gap * 4;
  let x = -total / 2;
  const place = (n) => {
    n.moveTo([x + n.width / 2, 0.55]);
    x += n.width + gap;
  };
  place(va);
  x += gap * 0.5;
  place(vb);
  place(eq);
  place(vc);
  vc.entries.flat().forEach((e) => e.set('opacity', 0));
  await scene.play(fadeIn(heading), { duration: 0.6 });
  await scene.play(create(va), create(vb), { duration: 1.2 });
  await scene.play(fadeIn(eq), ...vc.brackets.map((b) => create(b)), { duration: 0.7 });
  const narration = new Narration(scene);
  let first = true;
  for (const row of entries) {
    for (const cell of row) {
      const rb = va.rowBox(cell.i, { color: 'accent' });
      const cb = vb.colBox(cell.j, { color: 'accent' });
      const term = new Tex(cell.latex, { size: size * 0.95 });
      term.moveTo([0, -1.75]);
      const fast = !first;
      await scene.play(fadeIn(rb), fadeIn(cb), fadeIn(term, { shift: [0, 0.1] }), { duration: fast ? 0.35 : 0.6 });
      if (first) await narration.say(`Row ${cell.i + 1} of the left matrix meets column ${cell.j + 1} of the right: multiply matching entries and add.`);
      await scene.play(vc.entry(cell.i, cell.j).animate.set('opacity', 1), { duration: fast ? 0.3 : 0.6 });
      await scene.wait(fast ? 0.25 : 0.8);
      await scene.play(fadeOut(rb), fadeOut(cb), fadeOut(term), { duration: fast ? 0.25 : 0.4 });
      first = false;
    }
  }
  await narration.say(`Each entry of the product is one row times one column: ${prod.result.rows * prod.result.cols} dot products in all.`);
}

function polyLatex(coeffs, v) {
  const terms = [];
  for (let k = coeffs.length - 1; k >= 0; k--) {
    const c = rationalValue(coeffs[k]);
    if (Math.abs(c) < 1e-12) continue;
    const mag = Math.abs(c);
    const body = k === 0 ? rationalLatex(coeffs[k]).replace(/^-/, '') : `${mag === 1 ? '' : rationalLatex(coeffs[k]).replace(/^-/, '')}${v}${k > 1 ? `^{${k}}` : ''}`;
    if (!terms.length) terms.push(`${c < 0 ? '-' : ''}${body}`);
    else terms.push(`${c < 0 ? '-' : '+'} ${body}`);
  }
  return terms.join(' ') || '0';
}

async function eigenStory(scene, req, opts) {
  const A = req.matrix;
  const e = M.eigen(M.matrix(A));
  const heading = new Text(opts.title ?? 'Eigenvectors only stretch', { size: 'heading', weight: 'semibold' });
  heading.moveTo(LAYOUT.title, 'top-left');
  const size = opts.size ?? 0.46;
  const mat = `\\begin{bmatrix} ${A.map((r) => r.join(' & ')).join(' \\\\ ')} \\end{bmatrix}`;
  const lines = [
    { tex: `A = ${mat}`, rule: '' },
    { tex: '\\det(A - \\lambda I) = 0', rule: 'An eigenvalue makes A minus lambda times I singular.' },
    { tex: `${polyLatex(e.charPoly, '\\lambda')} = 0`, rule: 'Expand the determinant into the characteristic polynomial.' },
    { tex: e.values.map((v, k) => `\\lambda_{${k + 1}} = ${v.latex}`).join(',\\quad '), rule: 'Its roots are the eigenvalues.' },
    { tex: e.values.map((v, k) => `\\vec v_{${k + 1}} = \\begin{bmatrix} ${v.vectors[0].map(rationalLatex).join(' \\\\ ')} \\end{bmatrix}`).join(',\\quad '), rule: 'Solve (A minus lambda I) v = 0 for each eigenvalue.' },
  ];
  const planeX = 3.7;
  const plane = new TransformPlane({ range: [4, 4], unit: 0.62, clip: true, basis: false, x: planeX, y: -0.55, vectors: e.values.flatMap((v) => {
    const vec = v.vectors[0].map(rationalValue);
    const k = 1 / Math.hypot(...vec);
    return [[vec[0] * k, vec[1] * k, 'accent2']];
  }).concat([[1, 0.2, 'ink']]) });
  const narration = new Narration(scene);
  await scene.play(fadeIn(heading), { duration: 0.6 });
  scene.add(plane);
  await scene.play(fadeIn(plane), { duration: 0.8 });
  let y = LAYOUT.top;
  for (const l of lines) {
    const t = new Tex(l.tex, { size });
    if (t.width > 6.4) t.fitTo(6.4, t.height);
    t.moveTo([LAYOUT.left, y], 'top-left');
    y = t.bounds().y - LAYOUT.gap - 0.1;
    if (l.rule) await narration.say(l.rule);
    await scene.play(write(t), { duration: 1 });
    await scene.wait(0.4);
  }
  await narration.say('Under A, each eigenvector only stretches, by its own lambda.');
  await scene.play(applyMatrix(plane, [A[0][0], A[0][1], A[1][0], A[1][1]]), { duration: 2.6 });
}

/**
 * Build an explainer scene function from one expression.
 *
 *   d/dx x^2 sin(x)
 *   int_0^1 x e^x dx
 *   int x cos(x) dx
 *   solve x^2 - 5x + 6 = 0
 *   [[1,2],[3,4]] * [[5,6],[7,8]]
 *   eigen [[2,1],[1,2]]
 *
 * @param {string} input
 * @param {Record<string, any>} [opts] title, size, stepDuration, hold
 * @returns {(scene: import('../core/scene.js').Scene) => Promise<void>}
 */
export function explainMath(input, opts = {}) {
  const req = parseMathRequest(input);
  return async (scene) => {
    if (req.kind === 'product') await productWalkthrough(scene, req, opts);
    else if (req.kind === 'eigen') await eigenStory(scene, req, opts);
    else {
      const { title, steps } = derivationFor(req);
      await stackedDerivation(scene, title, steps, opts);
    }
    await scene.wait(1.5);
  };
}

