/**
 * Factoring with steps. Univariate polynomials with rational coefficients
 * are factored completely over the rationals (common factor, square-free
 * decomposition, rational root theorem with synthetic division, Kronecker's
 * method for higher-degree factors). Quadratic factors can be split further
 * over the reals or complex numbers. Other expressions use the common
 * factor, difference of squares, sum and difference of cubes, and perfect
 * square patterns. The factored result is kept unsimplified (simplify
 * would multiply it back out).
 * @module math/factor
 */
import { Rational, R1 } from './rational.js';
import { num, sym, add, mul, pow, key, symbols } from './expr.js';
import { simplify, expand, splitCoeff } from './simplify.js';
import { ensureExpr } from './parse.js';
import {
  toPoly, polyToExpr, factorRational, rationalRoots, pDivmod, pPrimitive, pDeg, squareFree,
} from './poly.js';
import { makeStep, linkSteps } from './steps.js';
import { toLatex } from './latex.js';

/** @typedef {import('./expr.js').Expr} Expr */

function isOne(e) {
  return e.type === 'num' && e.value.isOne();
}

function product(parts) {
  const ps = parts.filter((p) => !isOne(p));
  if (!ps.length) return num(1);
  return ps.length === 1 ? ps[0] : mul(...ps);
}

function powerOf(base, k) {
  return k === 1 ? base : pow(base, num(k));
}

// Roots of a x^2 + b x + c as exact expressions.
function quadraticRoots(p) {
  const [c, b, a] = p;
  const disc = b.mul(b).sub(a.mul(c).mul(Rational.from(4)));
  const sq = simplify(pow(num(disc), num('1/2')));
  const twoA = a.mul(Rational.from(2));
  const r1 = simplify(mul(add(num(b.neg()), mul(num(-1), sq)), pow(num(twoA), num(-1))));
  const r2 = simplify(mul(add(num(b.neg()), sq), pow(num(twoA), num(-1))));
  return { disc, roots: [r1, r2] };
}

/**
 * @typedef {object} FactorResult
 * @property {boolean} ok
 * @property {Expr} result factored form (unsimplified product)
 * @property {string} latex
 * @property {{factor: Expr, multiplicity: number}[]} factors
 * @property {boolean} complete false if a search budget ran out
 * @property {import('./steps.js').Step[]} steps
 */

/**
 * Factor an expression.
 * @param {Expr|string} expr
 * @param {{variable?: string, extension?: ('rational'|'real'|'complex')}} [opts]
 * @returns {FactorResult}
 */
export function factor(expr, opts = {}) {
  const e0 = ensureExpr(expr);
  const e = expand(e0);
  const vars = [...symbols(e)];
  const x = opts.variable || (vars.length === 1 ? vars[0] : null);
  const steps = [makeStep(e0, 'Factor')];
  if (key(e) !== key(e0)) steps.push(makeStep(e, 'Expand'));
  if (x && vars.length <= 1) {
    const p = toPoly(e, x);
    if (p && pDeg(p) >= 1) return factorUnivariate(p, x, opts.extension || 'rational', steps);
  }
  const { result, factors } = factorGeneral(e, steps);
  steps.push(makeStep(result, 'Factored form'));
  return { ok: true, result, latex: toLatex(result), factors, complete: true, steps: linkSteps(steps) };
}

function factorUnivariate(p, x, extension, steps) {
  const X = sym(x);
  const { content, prim } = pPrimitive(p);
  let lowPow = 0;
  while (prim[lowPow].isZero()) lowPow++;
  const rest = prim.slice(lowPow);
  const common = product([num(content), lowPow ? powerOf(X, lowPow) : num(1)]);
  if (!isOne(common)) {
    steps.push(makeStep(mul(common, polyToExpr(rest, x)), 'Factor out the greatest common factor'));
  }
  const factors = [];
  if (lowPow) factors.push({ factor: X, multiplicity: lowPow });
  const sf = squareFree(rest);
  if (sf.some((s) => s.mult > 1)) {
    const shown = sf.map(({ poly, mult }) => powerOf(polyToExpr(pPrimitive(poly).prim, x), mult));
    steps.push(makeStep(product([common, ...shown]), 'Square-free factorization', { note: 'gcd(p, p\') reveals the repeated factors' }));
  }
  const roots = rationalRoots(rest);
  if (roots.length && pDeg(rest) > 1) {
    let cur = rest;
    const shown = [];
    for (const r of roots) {
      const lin = pPrimitive([r.neg(), R1]).prim;
      let q = pDivmod(cur, lin);
      let m = 0;
      while (!q.r.length && pDeg(cur) >= 1) {
        cur = q.q;
        m++;
        q = pDivmod(cur, lin);
      }
      shown.push(powerOf(polyToExpr(lin, x), m));
      steps.push(makeStep(product([common, ...shown, pDeg(cur) > 0 ? polyToExpr(pPrimitive(cur).prim, x) : num(1)]), 'Rational root ' + x + ' = ' + r.toString(), {
        note: 'p(' + r.toString() + ') = 0 by the rational root theorem; divide by ' + toLatex(polyToExpr(lin, x)),
      }));
    }
  }
  const fr = factorRational(rest);
  for (const { poly, mult } of fr.factors) {
    if (pDeg(poly) === 2 && extension !== 'rational') {
      const { disc, roots: [r1, r2] } = quadraticRoots(poly);
      if (disc.sign() > 0 || extension === 'complex') {
        const lead = poly[2];
        if (!lead.isOne()) factors.push({ factor: num(lead), multiplicity: mult });
        for (const r of [r1, r2]) factors.push({ factor: simplify(add(X, mul(num(-1), r))), multiplicity: mult });
        continue;
      }
    }
    factors.push({ factor: polyToExpr(poly, x), multiplicity: mult });
  }
  const c = content.mul(fr.content);
  const parts = [];
  if (!c.isOne()) parts.push(num(c));
  const merged = mergeFactors(factors);
  for (const f of merged) parts.push(powerOf(f.factor, f.multiplicity));
  const result = product(parts);
  steps.push(makeStep(result, extension === 'rational' ? 'Irreducible factors over the rationals' : 'Factored over the ' + (extension === 'real' ? 'reals' : 'complex numbers')));
  const final = !c.isOne() ? [{ factor: num(c), multiplicity: 1 }, ...merged] : merged;
  return { ok: true, result, latex: toLatex(result), factors: final, complete: fr.complete, steps: linkSteps(steps) };
}

function mergeFactors(list) {
  const out = [];
  let numeric = new Rational(1n);
  for (const f of list) {
    if (f.factor.type === 'num') {
      numeric = numeric.mul(f.factor.value.pow(f.multiplicity));
      continue;
    }
    const k = key(f.factor);
    const prev = out.find((o) => key(o.factor) === k);
    if (prev) prev.multiplicity += f.multiplicity;
    else out.push({ ...f });
  }
  if (!numeric.isOne()) out.unshift({ factor: num(numeric), multiplicity: 1 });
  return out;
}

// Exact k-th root of a monomial term, or null.
function termRoot(t, k) {
  const [c, rest] = splitCoeff(t);
  if (c.isNegative() && k % 2 === 0) return null;
  const cr = rationalRoot(c, k);
  if (!cr) return null;
  if (!rest) return num(cr);
  const factors = rest.type === 'mul' ? rest.args : [rest];
  const out = [num(cr)];
  for (const f of factors) {
    const base = f.type === 'pow' ? f.args[0] : f;
    const ex = f.type === 'pow' ? f.args[1] : num(1);
    if (ex.type !== 'num' || !ex.value.isInteger()) return null;
    const e = Number(ex.value.n);
    if (e % k !== 0) return null;
    out.push(powerOf(base, e / k));
  }
  return simplify(mul(...out));
}

function rationalRoot(r, k) {
  const root = (n) => {
    const neg = n < 0n;
    let a = neg ? -n : n;
    let lo = 0n;
    let hi = a + 1n;
    while (hi - lo > 1n) {
      const mid = (lo + hi) / 2n;
      if (mid ** BigInt(k) <= a) lo = mid;
      else hi = mid;
    }
    if (lo ** BigInt(k) !== a) return null;
    a = lo;
    return neg ? -a : a;
  };
  const n = root(r.n);
  const d = root(r.d);
  return n === null || d === null ? null : new Rational(n, d);
}

// Pattern-based factoring for expressions that are not univariate
// rational polynomials.
function factorGeneral(e, steps) {
  if (e.type !== 'add') return { result: e, factors: [{ factor: e, multiplicity: 1 }] };
  // Common factor: numeric gcd and shared bases with minimum exponent.
  const terms = e.args;
  const info = terms.map((t) => {
    const [c, rest] = splitCoeff(t);
    const m = new Map();
    for (const f of rest ? (rest.type === 'mul' ? rest.args : [rest]) : []) {
      const base = f.type === 'pow' ? f.args[0] : f;
      const ex = f.type === 'pow' ? f.args[1] : num(1);
      if (ex.type === 'num' && ex.value.isInteger() && ex.value.sign() > 0) m.set(key(base), { base, e: Number(ex.value.n) });
    }
    return { c, m };
  });
  let g = null;
  for (const { c } of info) {
    const a = c.abs();
    g = g ? new Rational(gcdBig(g.n * a.d, a.n * g.d), g.d * a.d) : a;
  }
  if (info[0].c.isNegative()) g = g.neg();
  const shared = [];
  for (const [k, { base, e: ex }] of info[0].m) {
    let minE = ex;
    let everywhere = true;
    for (const it of info.slice(1)) {
      const o = it.m.get(k);
      if (!o) {
        everywhere = false;
        break;
      }
      minE = Math.min(minE, o.e);
    }
    if (everywhere) shared.push(powerOf(base, minE));
  }
  const commonParts = [...(g.isOne() ? [] : [num(g)]), ...shared];
  let inner = e;
  if (commonParts.length) {
    const common = product(commonParts);
    inner = simplify(expand(mul(e, pow(common, num(-1)))));
    steps.push(makeStep(mul(common, inner), 'Factor out the greatest common factor'));
  }
  const pieces = factorPatterns(inner, steps, 0);
  const all = [...commonParts.map((c) => ({ factor: c, multiplicity: 1 })), ...pieces];
  return { result: product(all.map((f) => powerOf(f.factor, f.multiplicity))), factors: all };
}

function gcdBig(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) [a, b] = [b, a % b];
  return a;
}

function factorPatterns(e, steps, depth) {
  const one = [{ factor: e, multiplicity: 1 }];
  if (depth > 6 || e.type !== 'add') return one;
  const t = e.args;
  const recurse = (parts) => parts.flatMap((p) => factorPatterns(simplify(p), steps, depth + 1));
  if (t.length === 2) {
    const [p, q] = t;
    const negQ = simplify(mul(num(-1), q));
    const negP = simplify(mul(num(-1), p));
    // Difference of squares.
    for (const [P, Q] of [[p, negQ], [q, negP]]) {
      const A = termRoot(P, 2);
      const B = termRoot(Q, 2);
      if (A && B) {
        const f1 = simplify(add(A, mul(num(-1), B)));
        const f2 = simplify(add(A, B));
        steps.push(makeStep(mul(f1, f2), 'Difference of squares', { note: 'a^{2} - b^{2} = (a - b)(a + b)' }));
        return recurse([f1, f2]);
      }
    }
    // Sum or difference of cubes.
    const A = termRoot(p, 3);
    const B = termRoot(q, 3);
    if (A && B) {
      const f1 = simplify(add(A, B));
      const f2 = simplify(add(pow(A, num(2)), mul(num(-1), A, B), pow(B, num(2))));
      steps.push(makeStep(mul(f1, f2), 'Sum of cubes', { note: 'a^{3} + b^{3} = (a + b)(a^{2} - ab + b^{2})' }));
      return [...recurse([f1]), { factor: f2, multiplicity: 1 }];
    }
  }
  if (t.length === 3) {
    for (const [i, j, k] of [[0, 2, 1], [0, 1, 2], [1, 2, 0]]) {
      const A = termRoot(t[i], 2);
      const B = termRoot(t[j], 2);
      if (!A || !B) continue;
      const mid = simplify(mul(num(2), A, B));
      if (key(mid) === key(t[k])) {
        const f = simplify(add(A, B));
        steps.push(makeStep(pow(f, num(2)), 'Perfect square trinomial', { note: 'a^{2} + 2ab + b^{2} = (a + b)^{2}' }));
        return [{ factor: f, multiplicity: 2 }];
      }
      if (key(simplify(mul(num(-1), mid))) === key(t[k])) {
        const f = simplify(add(A, mul(num(-1), B)));
        steps.push(makeStep(pow(f, num(2)), 'Perfect square trinomial', { note: 'a^{2} - 2ab + b^{2} = (a - b)^{2}' }));
        return [{ factor: f, multiplicity: 2 }];
      }
    }
  }
  // A polynomial in one of its variables with rational coefficients.
  for (const v of symbols(e)) {
    const p = toPoly(e, v);
    if (p && pDeg(p) >= 2 && [...symbols(e)].length === 1) {
      const fr = factorRational(p);
      if (fr.factors.length > 1 || fr.factors.some((f) => f.mult > 1)) {
        return fr.factors.map((f) => ({ factor: polyToExpr(f.poly, v), multiplicity: f.mult }));
      }
    }
  }
  return one;
}

