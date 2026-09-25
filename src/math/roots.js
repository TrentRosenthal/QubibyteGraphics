/**
 * Scalar root finding with full iteration histories (for animating each
 * bracket, tangent line or secant): bisection, Newton, secant and Brent.
 * @module math/roots
 */

/**
 * @typedef {object} RootIteration
 * @property {number} x current estimate
 * @property {number} fx f(x)
 * @property {number} [a] bracket left end
 * @property {number} [b] bracket right end
 * @property {number} [slope] derivative used (Newton, secant)
 * @property {string} [method] step type (Brent: 'bisection' | 'secant' | 'inverse quadratic')
 */

/**
 * @typedef {object} RootResult
 * @property {number} root
 * @property {boolean} converged
 * @property {number} iterations
 * @property {RootIteration[]} history
 * @property {string} [reason]
 */

/**
 * Bisection on a sign-changing bracket.
 * @param {(x: number) => number} f
 * @param {number} a
 * @param {number} b
 * @param {{tol?: number, maxIter?: number}} [opts]
 * @returns {RootResult}
 */
export function bisection(f, a, b, opts = {}) {
  const tol = opts.tol ?? 1e-12;
  const maxIter = opts.maxIter ?? 200;
  let fa = f(a);
  const fb = f(b);
  const history = [];
  if (fa === 0) return { root: a, converged: true, iterations: 0, history: [{ x: a, fx: 0, a, b }] };
  if (fb === 0) return { root: b, converged: true, iterations: 0, history: [{ x: b, fx: 0, a, b }] };
  if (fa * fb > 0) return { root: NaN, converged: false, iterations: 0, history, reason: 'f(a) and f(b) have the same sign' };
  for (let i = 1; i <= maxIter; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    history.push({ x: m, fx: fm, a, b });
    if (fm === 0 || (b - a) / 2 < tol * Math.max(1, Math.abs(m))) return { root: m, converged: true, iterations: i, history };
    if (fa * fm < 0) b = m;
    else {
      a = m;
      fa = fm;
    }
  }
  return { root: (a + b) / 2, converged: false, iterations: maxIter, history, reason: 'Iteration limit reached' };
}

/**
 * Newton's method. The derivative defaults to a central difference.
 * @param {(x: number) => number} f
 * @param {number} x0
 * @param {{df?: (x: number) => number, tol?: number, maxIter?: number}} [opts]
 * @returns {RootResult}
 */
export function newton(f, x0, opts = {}) {
  const tol = opts.tol ?? 1e-13;
  const maxIter = opts.maxIter ?? 100;
  const df = opts.df ?? ((x) => {
    const h = 1e-6 * Math.max(1, Math.abs(x));
    return (f(x + h) - f(x - h)) / (2 * h);
  });
  let x = x0;
  const history = [];
  for (let i = 0; i < maxIter; i++) {
    const fx = f(x);
    const slope = df(x);
    history.push({ x, fx, slope });
    if (fx === 0) return { root: x, converged: true, iterations: i, history };
    if (slope === 0 || !Number.isFinite(slope)) return { root: x, converged: false, iterations: i, history, reason: 'Zero derivative' };
    const next = x - fx / slope;
    if (!Number.isFinite(next)) return { root: x, converged: false, iterations: i, history, reason: 'Iteration diverged' };
    if (Math.abs(next - x) <= tol * Math.max(1, Math.abs(next))) {
      history.push({ x: next, fx: f(next), slope: df(next) });
      return { root: next, converged: true, iterations: i + 1, history };
    }
    x = next;
  }
  return { root: x, converged: false, iterations: maxIter, history, reason: 'Iteration limit reached' };
}

/**
 * Secant method.
 * @param {(x: number) => number} f
 * @param {number} x0
 * @param {number} x1
 * @param {{tol?: number, maxIter?: number}} [opts]
 * @returns {RootResult}
 */
export function secant(f, x0, x1, opts = {}) {
  const tol = opts.tol ?? 1e-13;
  const maxIter = opts.maxIter ?? 100;
  let f0 = f(x0);
  let f1 = f(x1);
  const history = [{ x: x0, fx: f0 }];
  for (let i = 0; i < maxIter; i++) {
    const slope = (f1 - f0) / (x1 - x0);
    history.push({ x: x1, fx: f1, slope });
    if (f1 === 0) return { root: x1, converged: true, iterations: i, history };
    if (slope === 0 || !Number.isFinite(slope)) return { root: x1, converged: false, iterations: i, history, reason: 'Flat secant' };
    const x2 = x1 - f1 / slope;
    if (Math.abs(x2 - x1) <= tol * Math.max(1, Math.abs(x2))) {
      history.push({ x: x2, fx: f(x2) });
      return { root: x2, converged: true, iterations: i + 1, history };
    }
    x0 = x1;
    f0 = f1;
    x1 = x2;
    f1 = f(x2);
  }
  return { root: x1, converged: false, iterations: maxIter, history, reason: 'Iteration limit reached' };
}

/**
 * Brent's method: bisection safety with secant and inverse quadratic
 * interpolation speed. Needs a sign-changing bracket.
 * @param {(x: number) => number} f
 * @param {number} a
 * @param {number} b
 * @param {{tol?: number, maxIter?: number}} [opts]
 * @returns {RootResult}
 */
export function brent(f, a, b, opts = {}) {
  const tol = opts.tol ?? 1e-14;
  const maxIter = opts.maxIter ?? 200;
  let fa = f(a);
  let fb = f(b);
  const history = [];
  if (fa * fb > 0) return { root: NaN, converged: false, iterations: 0, history, reason: 'f(a) and f(b) have the same sign' };
  if (Math.abs(fa) < Math.abs(fb)) {
    [a, b] = [b, a];
    [fa, fb] = [fb, fa];
  }
  let c = a;
  let fc = fa;
  let d = b - a;
  let mflag = true;
  for (let i = 1; i <= maxIter; i++) {
    if (fb === 0 || Math.abs(b - a) <= tol * Math.max(1, Math.abs(b))) {
      history.push({ x: b, fx: fb, a: Math.min(a, b), b: Math.max(a, b), method: 'converged' });
      return { root: b, converged: true, iterations: i - 1, history };
    }
    let s;
    let method;
    if (fa !== fc && fb !== fc) {
      s = (a * fb * fc) / ((fa - fb) * (fa - fc)) + (b * fa * fc) / ((fb - fa) * (fb - fc)) + (c * fa * fb) / ((fc - fa) * (fc - fb));
      method = 'inverse quadratic';
    } else {
      s = b - (fb * (b - a)) / (fb - fa);
      method = 'secant';
    }
    const q = (3 * a + b) / 4;
    const outside = !((s > Math.min(q, b) && s < Math.max(q, b)));
    if (outside || (mflag && Math.abs(s - b) >= Math.abs(b - c) / 2) || (!mflag && Math.abs(s - b) >= Math.abs(c - d) / 2)
      || (mflag && Math.abs(b - c) < tol) || (!mflag && Math.abs(c - d) < tol)) {
      s = (a + b) / 2;
      method = 'bisection';
      mflag = true;
    } else mflag = false;
    const fs = f(s);
    history.push({ x: s, fx: fs, a: Math.min(a, b), b: Math.max(a, b), method });
    d = c;
    c = b;
    fc = fb;
    if (fa * fs < 0) {
      b = s;
      fb = fs;
    } else {
      a = s;
      fa = fs;
    }
    if (Math.abs(fa) < Math.abs(fb)) {
      [a, b] = [b, a];
      [fa, fb] = [fb, fa];
    }
  }
  return { root: b, converged: false, iterations: maxIter, history, reason: 'Iteration limit reached' };
}
