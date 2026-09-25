/**
 * Equality testing for expressions: symbolic first (the difference
 * simplifies, expands or combines to zero), then numeric probing at seeded
 * random complex points. The numeric verdict is reported as such, never as
 * a proof. Probes lie in the right half plane (real part 0.1 to 2.1, small
 * imaginary parts unless `real` is set), where principal branches agree with
 * the usual real identities such as ln(x^2) = 2 ln(x).
 * @module math/equality
 */
import { add, mul, num, symbols, key, MathError } from './expr.js';
import { simplify, expand } from './simplify.js';
import { together } from './ratfunc.js';
import { ensureExpr } from './parse.js';
import { compileComplex } from './evaluate.js';
import { SeededRandom } from './random.js';
import { Complex } from './complex.js';

/** @typedef {import('./expr.js').Expr} Expr */

/**
 * @typedef {object} EqualityResult
 * @property {boolean} equal
 * @property {'symbolic'|'numeric'} method how the verdict was reached
 * @property {number} [points] number of numeric probes that were evaluated
 * @property {{point: Record<string, Complex>, difference: number}} [counterexample]
 * @property {string} [reason]
 */

function isZero(e) {
  return e.type === 'num' && e.value.isZero();
}

/**
 * Decide whether two expressions are equal as functions of their symbols.
 * @param {Expr|string} a
 * @param {Expr|string} b
 * @param {{probes?: number, seed?: number, tol?: number, real?: boolean}} [opts] real: probe only real points
 * @returns {EqualityResult}
 */
export function equivalent(a, b, opts = {}) {
  const A = ensureExpr(a);
  const B = ensureExpr(b);
  const diffExpr = add(A, mul(num(-1), B));
  for (const attempt of [simplify, expand, together]) {
    try {
      const d = attempt(diffExpr);
      if (isZero(d)) return { equal: true, method: 'symbolic' };
    } catch (err) {
      if (!(err instanceof MathError)) throw err;
    }
  }
  if (key(simplify(A)) === key(simplify(B))) return { equal: true, method: 'symbolic' };
  const vars = [...new Set([...symbols(A), ...symbols(B)])].sort();
  const fa = compileComplex(A, vars);
  const fb = compileComplex(B, vars);
  const rng = new SeededRandom(opts.seed ?? 12345);
  const tol = opts.tol ?? 1e-9;
  const probes = opts.probes ?? 12;
  let points = 0;
  for (let attemptCount = 0; attemptCount < probes * 5 && points < probes; attemptCount++) {
    const pt = vars.map(() => new Complex(rng.uniform(0.1, 2.1), opts.real ? 0 : rng.uniform(-0.6, 0.6)));
    const va = fa(...pt);
    const vb = fb(...pt);
    if (![va.re, va.im, vb.re, vb.im].every(Number.isFinite)) continue;
    points++;
    const d = va.sub(vb).abs();
    if (d > tol * (1 + va.abs() + vb.abs())) {
      return { equal: false, method: 'numeric', points, counterexample: { point: Object.fromEntries(vars.map((v, i) => [v, pt[i]])), difference: d } };
    }
  }
  if (!points) return { equal: false, method: 'numeric', points: 0, reason: 'Neither expression could be evaluated at the probe points' };
  return { equal: true, method: 'numeric', points };
}
