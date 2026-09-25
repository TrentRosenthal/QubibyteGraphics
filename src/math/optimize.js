/**
 * Minimisation with full trajectories for animation: gradient descent with
 * momentum, the Nelder-Mead simplex method, and golden-section search.
 * @module math/optimize
 */
import { gradientNumeric } from './vectorcalc.js';

/**
 * @typedef {object} DescentResult
 * @property {number[]} x final point
 * @property {number} fx objective value there
 * @property {boolean} converged
 * @property {{x: number[], fx: number, grad: number[]}[]} trajectory every iterate
 */

/**
 * Gradient descent with (heavy-ball) momentum.
 * @param {(...x: number[]) => number} f objective
 * @param {number[]} x0 start
 * @param {{grad?: (...x: number[]) => number[], rate?: number, momentum?: number, maxIter?: number, tol?: number}} [opts]
 * @returns {DescentResult}
 */
export function gradientDescent(f, x0, opts = {}) {
  const rate = opts.rate ?? 0.1;
  const beta = opts.momentum ?? 0;
  const maxIter = opts.maxIter ?? 1000;
  const tol = opts.tol ?? 1e-10;
  const grad = opts.grad ?? ((...p) => gradientNumeric(f, p));
  let x = x0.slice();
  let v = x.map(() => 0);
  const trajectory = [];
  for (let k = 0; k <= maxIter; k++) {
    const g = grad(...x);
    const fx = f(...x);
    trajectory.push({ x: x.slice(), fx, grad: g });
    if (Math.hypot(...g) < tol) return { x, fx, converged: true, trajectory };
    v = v.map((vi, i) => beta * vi - rate * g[i]);
    x = x.map((xi, i) => xi + v[i]);
    if (!x.every(Number.isFinite)) return { x, fx: NaN, converged: false, trajectory };
  }
  return { x, fx: f(...x), converged: false, trajectory };
}

/**
 * @typedef {object} NelderMeadResult
 * @property {number[]} x
 * @property {number} fx
 * @property {boolean} converged
 * @property {{simplex: number[][], values: number[], operation: string}[]} history
 */

/**
 * Nelder-Mead downhill simplex.
 * @param {(...x: number[]) => number} f
 * @param {number[]} x0
 * @param {{step?: number, maxIter?: number, tol?: number}} [opts]
 * @returns {NelderMeadResult}
 */
export function nelderMead(f, x0, opts = {}) {
  const n = x0.length;
  const step = opts.step ?? 0.5;
  const maxIter = opts.maxIter ?? 2000;
  const tol = opts.tol ?? 1e-12;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] += step;
    simplex.push(p);
  }
  let values = simplex.map((p) => f(...p));
  const history = [];
  const sortSimplex = () => {
    const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    simplex = idx.map((i) => simplex[i]);
    values = idx.map((i) => values[i]);
  };
  sortSimplex();
  history.push({ simplex: simplex.map((p) => p.slice()), values: values.slice(), operation: 'start' });
  for (let it = 0; it < maxIter; it++) {
    if (Math.abs(values[n] - values[0]) <= tol * (Math.abs(values[0]) + tol)) {
      let spread = 0;
      for (const p of simplex) spread = Math.max(spread, Math.hypot(...p.map((v, i) => v - simplex[0][i])));
      if (spread < 1e-8) return { x: simplex[0], fx: values[0], converged: true, history };
    }
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
    const along = (t) => centroid.map((c, j) => c + t * (simplex[n][j] - c));
    const xr = along(-1);
    const fr = f(...xr);
    let op;
    if (fr < values[0]) {
      const xe = along(-2);
      const fe = f(...xe);
      if (fe < fr) {
        simplex[n] = xe;
        values[n] = fe;
        op = 'expand';
      } else {
        simplex[n] = xr;
        values[n] = fr;
        op = 'reflect';
      }
    } else if (fr < values[n - 1]) {
      simplex[n] = xr;
      values[n] = fr;
      op = 'reflect';
    } else {
      const outside = fr < values[n];
      const xc = along(outside ? -0.5 : 0.5);
      const fc = f(...xc);
      if (fc < (outside ? fr : values[n])) {
        simplex[n] = xc;
        values[n] = fc;
        op = outside ? 'contract outside' : 'contract inside';
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          values[i] = f(...simplex[i]);
        }
        op = 'shrink';
      }
    }
    sortSimplex();
    history.push({ simplex: simplex.map((p) => p.slice()), values: values.slice(), operation: op });
  }
  return { x: simplex[0], fx: values[0], converged: false, history };
}

/**
 * Golden-section search for a minimum of a unimodal function on [a, b].
 * @param {(x: number) => number} f
 * @param {number} a
 * @param {number} b
 * @param {{tol?: number, maxIter?: number}} [opts]
 * @returns {{x: number, fx: number, history: {a: number, b: number, c: number, d: number}[]}}
 */
export function goldenSection(f, a, b, opts = {}) {
  const tol = opts.tol ?? 1e-10;
  const maxIter = opts.maxIter ?? 200;
  const invphi = (Math.sqrt(5) - 1) / 2;
  let c = b - invphi * (b - a);
  let d = a + invphi * (b - a);
  let fc = f(c);
  let fd = f(d);
  const history = [];
  for (let i = 0; i < maxIter && Math.abs(b - a) > tol * Math.max(1, Math.abs(a) + Math.abs(b)); i++) {
    history.push({ a, b, c, d });
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - invphi * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + invphi * (b - a);
      fd = f(d);
    }
  }
  const x = (a + b) / 2;
  return { x, fx: f(x), history };
}
