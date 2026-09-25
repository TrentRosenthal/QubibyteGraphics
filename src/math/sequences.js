/**
 * Infinite series convergence tests (divergence, ratio, root, integral,
 * limit comparison with a p-series, alternating series) with partial sums,
 * and a numeric epsilon-delta helper for limits.
 * @module math/sequences
 */
import { num, sym, add, mul, pow, fn, withArgs, substitute } from './expr.js';
import { simplify } from './simplify.js';
import { ensureExpr, varName } from './parse.js';
import { limit } from './limits.js';
import { integrateDefinite } from './integrate.js';
import { compileReal } from './evaluate.js';
import { toLatex } from './latex.js';
import { bestRational } from './rational.js';

/** @typedef {import('./expr.js').Expr} Expr */

// factorial(B + k) / factorial(B) -> (B + 1)(B + 2)...(B + k) inside products.
function expandFactorialRatios(e) {
  if (e.args) e = withArgs(e, e.args.map(expandFactorialRatios));
  if (e.type !== 'mul') return e;
  const f = e.args.slice();
  for (let i = 0; i < f.length; i++) {
    const fi = f[i];
    if (!(fi.type === 'fn' && fi.name === 'factorial')) continue;
    for (let j = 0; j < f.length; j++) {
      const fj = f[j];
      if (!(fj.type === 'pow' && fj.args[1].type === 'num' && fj.args[1].value.eq(num(-1).value) && fj.args[0].type === 'fn' && fj.args[0].name === 'factorial')) continue;
      const A = fi.args[0];
      const B = fj.args[0].args[0];
      const d = simplify(add(A, mul(num(-1), B)));
      if (d.type !== 'num' || !d.value.isInteger()) continue;
      const k = Number(d.value.n);
      const prod = [];
      if (k >= 0) for (let m = 1; m <= k; m++) prod.push(add(B, num(m)));
      else for (let m = 1; m <= -k; m++) prod.push(pow(add(A, num(m)), num(-1)));
      const rest = f.filter((_, q) => q !== i && q !== j);
      return expandFactorialRatios(simplify(mul(...rest, ...prod)));
    }
  }
  return e;
}

/**
 * @typedef {object} TestResult
 * @property {string} name
 * @property {'converges'|'diverges'|'inconclusive'|'not applicable'} result
 * @property {string} detail
 * @property {string} [latex]
 */

/**
 * Run the standard convergence tests on sum_{n = start}^inf a_n.
 * @param {Expr|string} term a_n
 * @param {string|Expr} [variable='n']
 * @param {number} [start=1]
 * @param {{partialSums?: number}} [opts]
 * @returns {{verdict: 'converges'|'diverges'|'unknown', decidedBy: string|null, tests: TestResult[], partialSums: {n: number, term: number, sum: number}[]}}
 */
export function seriesConvergence(term, variable = 'n', start = 1, opts = {}) {
  const n = varName(variable);
  const a = simplify(ensureExpr(term));
  const N = sym(n);
  const tests = [];
  const g = compileReal(a, [n]);
  const partialSums = [];
  let sum = 0;
  for (let k = start; k < start + (opts.partialSums ?? 30); k++) {
    const v = g(k);
    sum += v;
    partialSums.push({ n: k, term: v, sum });
  }
  // Divergence test.
  const l0 = limit(a, n, 'inf');
  if (l0.ok && (l0.kind === 'infinite' || (l0.kind === 'finite' && Math.abs(l0.numeric) > 1e-12))) {
    tests.push({ name: 'Divergence test', result: 'diverges', detail: 'The terms do not tend to 0', latex: '\\lim_{' + n + ' \\to \\infty} a_{' + n + '} = ' + (l0.latex || String(l0.numeric)) });
  } else if (l0.ok && l0.kind === 'dne') {
    tests.push({ name: 'Divergence test', result: 'diverges', detail: 'The terms have no limit, so they do not tend to 0' });
  } else {
    tests.push({ name: 'Divergence test', result: 'inconclusive', detail: 'The terms tend to 0' });
  }
  // Ratio test.
  const next = substitute(a, { [n]: add(N, num(1)) });
  const ratio = expandFactorialRatios(simplify(fn('abs', mul(next, pow(a, num(-1))))));
  const lr = limit(ratio, n, 'inf');
  if (lr.ok && (lr.kind === 'finite' || lr.kind === 'infinite')) {
    const L = lr.kind === 'infinite' ? Infinity : lr.numeric;
    const res = Math.abs(L - 1) < 1e-12 ? 'inconclusive' : L < 1 ? 'converges' : 'diverges';
    tests.push({ name: 'Ratio test', result: res, detail: 'L = ' + (lr.latex || String(L)), latex: '\\lim_{' + n + ' \\to \\infty} \\left|\\frac{a_{' + n + '+1}}{a_{' + n + '}}\\right| = ' + (lr.latex || String(L)) });
  } else tests.push({ name: 'Ratio test', result: 'inconclusive', detail: 'The ratio limit could not be found' });
  // Root test.
  const root = simplify(pow(fn('abs', a), pow(N, num(-1))));
  const lroot = limit(root, n, 'inf');
  if (lroot.ok && (lroot.kind === 'finite' || lroot.kind === 'infinite')) {
    const L = lroot.kind === 'infinite' ? Infinity : lroot.numeric;
    const res = Math.abs(L - 1) < 1e-9 ? 'inconclusive' : L < 1 ? 'converges' : 'diverges';
    tests.push({ name: 'Root test', result: res, detail: 'L = ' + (lroot.latex || Number(L.toPrecision(8))) });
  } else tests.push({ name: 'Root test', result: 'inconclusive', detail: 'The root limit could not be found' });
  // Alternating series test.
  const sign = (k) => Math.sign(g(k));
  const alternating = partialSums.slice(0, 20).every((p, i, arr) => i === 0 || Math.sign(p.term) === -Math.sign(arr[i - 1].term));
  if (alternating) {
    const mags = partialSums.map((p) => Math.abs(p.term));
    const decreasing = mags.slice(5).every((m, i) => m <= mags[i + 4] + 1e-15);
    const toZero = l0.ok && l0.kind === 'finite' && Math.abs(l0.numeric) < 1e-12;
    tests.push({ name: 'Alternating series test', result: decreasing && toZero ? 'converges' : 'inconclusive', detail: decreasing && toZero ? '|a_n| decreases to 0' : '|a_n| is not eventually decreasing to 0' });
  } else tests.push({ name: 'Alternating series test', result: 'not applicable', detail: 'Terms do not alternate in sign' });
  // Integral test for positive terms.
  const positive = partialSums.every((p) => p.term > 0) && sign(start + 100) > 0;
  if (positive) {
    const x = 'x__';
    const f = substitute(a, { [n]: sym(x) });
    const I = integrateDefinite(f, x, start, 'inf');
    if (I.ok && !I.numericOnly) {
      tests.push({ name: 'Integral test', result: I.converges ? 'converges' : 'diverges', detail: I.converges ? 'The improper integral converges to ' + I.latex : 'The improper integral diverges' });
    } else tests.push({ name: 'Integral test', result: 'inconclusive', detail: 'No closed-form improper integral' });
  } else tests.push({ name: 'Integral test', result: 'not applicable', detail: 'Terms are not all positive' });
  // Limit comparison with a p-series.
  if (positive) {
    const big = 1e6;
    const p0 = -Math.log(g(2 * big) / g(big)) / Math.log(2);
    if (Number.isFinite(p0)) {
      const p = bestRational(p0, 12);
      if (Math.abs(p.toNumber() - p0) < 1e-3) {
        const lc = limit(simplify(mul(a, pow(N, num(p)))), n, 'inf');
        if (lc.ok && lc.kind === 'finite' && lc.numeric > 0) {
          const res = p.cmp(num(1).value) > 0 ? 'converges' : 'diverges';
          tests.push({ name: 'Limit comparison test', result: res, detail: 'Compare with the p-series 1/n^' + p.toString() + ' (limit ' + (lc.latex || lc.numeric) + ')', latex: '\\lim_{' + n + ' \\to \\infty} a_{' + n + '} \\cdot ' + toLatex(pow(N, num(p))) + ' = ' + (lc.latex || lc.numeric) });
        }
      }
    }
  }
  const decisive = tests.find((t) => t.result === 'converges' || t.result === 'diverges');
  return { verdict: decisive ? decisive.result : 'unknown', decidedBy: decisive ? decisive.name : null, tests, partialSums };
}

/**
 * Find a delta for the epsilon-delta definition of lim_{x -> a} f(x) = L:
 * the largest delta (found by bisection over dense samples) with
 * |f(x) - L| < epsilon whenever 0 < |x - a| < delta, reduced by 1% for safety.
 * @param {((x: number) => number)|Expr|string} f
 * @param {number} a
 * @param {number} L
 * @param {number} epsilon
 * @param {{maxDelta?: number, samples?: number}} [opts]
 * @returns {{delta: number, epsilon: number, a: number, L: number, worst: {x: number, gap: number}}}
 */
export function epsilonDelta(f, a, L, epsilon, opts = {}) {
  const g = typeof f === 'function' ? f : compileReal(ensureExpr(f), ['x']);
  const maxDelta = opts.maxDelta ?? 1;
  const samples = opts.samples ?? 4000;
  const ok = (d) => {
    for (let i = 1; i <= samples; i++) {
      const h = d * Math.pow(i / samples, 2);
      for (const x of [a - h, a + h]) {
        const v = g(x);
        if (!Number.isFinite(v) || Math.abs(v - L) >= epsilon) return false;
      }
    }
    return true;
  };
  let lo = 0;
  let hi = maxDelta;
  if (ok(hi)) lo = hi;
  else {
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) lo = mid;
      else hi = mid;
    }
  }
  const delta = lo * 0.99;
  let worst = { x: a, gap: 0 };
  for (let i = 1; i <= 200; i++) {
    for (const x of [a - (delta * i) / 200, a + (delta * i) / 200]) {
      const gap = Math.abs(g(x) - L);
      if (gap > worst.gap) worst = { x, gap };
    }
  }
  return { delta, epsilon, a, L, worst };
}

