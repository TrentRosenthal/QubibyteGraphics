/**
 * Equation solving with steps: linear equations, quadratics through the
 * quadratic formula, polynomials by factoring (numeric Aberth roots for
 * factors without closed forms), rational equations (with extraneous root
 * checks), equations where the unknown appears once (inverted operation by
 * operation, with general solutions for trig equations), substitutions such
 * as u = e^x, condensed logarithms, systems of linear equations by Gaussian
 * elimination, and nonlinear systems by Newton's method.
 * @module math/solve
 */
import { Rational } from './rational.js';
import {
  num, sym, constant, add, mul, pow, fn, eq, listNode, freeOf, key, symbols, substitute, replaceSubtree, walk, withArgs,
  size, MathError,
} from './expr.js';
import { simplify, expand, isNegativeTerm } from './simplify.js';
import { ensureExpr, varName } from './parse.js';
import { polyCoeffs, toPoly, factorRational, polyRootsNumeric, polyToExpr, pDeg } from './poly.js';
import { together } from './ratfunc.js';
import { compileComplex, compileReal } from './evaluate.js';
import { makeStep, linkSteps } from './steps.js';
import { toLatex } from './latex.js';
import { Complex } from './complex.js';
import { diff } from './diff.js';
import { solveLinear } from './linalg.js';
import { scalarToExpr } from './scalar.js';
import { brent } from './roots.js';

/** @typedef {import('./expr.js').Expr} Expr */

const isZero = (e) => e.type === 'num' && e.value.isZero();
const neg = (e) => mul(num(-1), e);
const sub = (a, b) => add(a, neg(b));
const quo = (a, b) => mul(a, pow(b, num(-1)));

/**
 * @typedef {object} Solution
 * @property {Expr|null} expr exact value (null for numeric-only roots)
 * @property {number|Complex} value numeric value
 * @property {boolean} exact
 * @property {string} latex
 * @property {number} [multiplicity]
 */

/**
 * @typedef {object} SolveResult
 * @property {boolean} ok
 * @property {Solution[]} solutions particular solutions (k = 0 for periodic families)
 * @property {Expr[]} [general] general solutions containing the integer parameter
 * @property {string} [parameter] name of the integer parameter (k)
 * @property {'all'|'none'|null} [identity] set when every value (or no value) satisfies the equation
 * @property {import('./steps.js').Step[]} steps
 * @property {string} [reason]
 */

function numericValue(e) {
  const f = compileComplex(e, []);
  const v = f();
  return v.isReal(1e-12) ? v.re : v;
}

function mkSolution(expr, multiplicity) {
  let value;
  try {
    value = numericValue(substitute(expr, { k: num(0) }));
  } catch {
    value = NaN;
  }
  return { expr, value, exact: true, latex: toLatex(expr), multiplicity };
}

function numericSolution(z) {
  const v = z instanceof Complex && z.isReal(1e-10) ? z.re : z;
  const text = typeof v === 'number' ? String(Number(v.toPrecision(10))) : v.toString();
  return { expr: null, value: v, exact: false, latex: '\\approx ' + text.replace(/i$/, 'i') };
}

function isParametric(e, x) {
  return [...symbols(e)].some((s) => s !== x && s !== 'k');
}

// Keep solutions that satisfy f = 0 numerically (complex evaluation).
function verified(sol, f, x) {
  if (!sol.exact) return true;
  if (isParametric(sol.expr, x) || isParametric(f, x)) return true;
  try {
    for (const kv of [0, 1]) {
      const at = simplify(substitute(sol.expr, { k: num(kv) }));
      const g = compileComplex(f, [x]);
      const r = g(compileComplex(at, [])());
      const scale = 1 + compileComplex(at, [])().abs();
      if (!(r.abs() <= 1e-7 * scale)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Solve one equation for one unknown.
 * @param {Expr|string} equation an equation or an expression equal to zero
 * @param {string|Expr} [variable='x']
 * @param {{real?: boolean}} [opts] real: keep only real solutions
 * @returns {SolveResult}
 */
export function solve(equation, variable = 'x', opts = {}) {
  const x = varName(variable);
  let e = ensureExpr(equation);
  if (e.type !== 'eq') e = eq(e, num(0));
  const steps = [makeStep(e, 'Solve for ' + x)];
  const f = simplify(sub(e.args[0], e.args[1]));
  let res;
  try {
    res = solveCore(e, f, x, steps);
  } catch (err) {
    if (!(err instanceof MathError)) throw err;
    res = { ok: false, solutions: [], reason: err.message };
  }
  const kept = [];
  const dropped = [];
  for (const s of res.solutions) {
    if (verified(s, f, x)) kept.push(s);
    else dropped.push(s);
  }
  if (dropped.length) steps.push(makeStep(listNode(kept.map((s) => eq(sym(x), s.expr || num(0)))), 'Check for extraneous solutions', { note: 'Rejected: ' + dropped.map((s) => s.latex).join(', ') }));
  let solutions = dedupe(kept);
  if (opts.real) solutions = solutions.filter((s) => typeof s.value === 'number');
  return { ...res, solutions, steps: linkSteps(steps) };
}

function dedupe(list) {
  const out = [];
  for (const s of list) {
    const same = out.find((o) => (o.exact && s.exact && key(o.expr) === key(s.expr)) || closeValues(o.value, s.value));
    if (same) same.multiplicity = (same.multiplicity || 1) + (s.multiplicity || 1) - 1;
    else out.push(s);
  }
  return out;
}

function closeValues(a, b) {
  const ca = Complex.from(a);
  const cb = Complex.from(b);
  if (!Number.isFinite(ca.re) || !Number.isFinite(cb.re)) return false;
  return ca.sub(cb).abs() <= 1e-9 * (1 + ca.abs());
}

function solveCore(e, f, x, steps) {
  if (freeOf(f, x)) {
    if (isZero(f)) return { ok: true, solutions: [], identity: 'all', reason: 'Every value of ' + x + ' satisfies the equation' };
    return { ok: true, solutions: [], identity: 'none', reason: 'The equation has no solution' };
  }
  const cs = polyCoeffs(f, x);
  if (cs && cs.length >= 2) return solvePolynomial(e, cs, x, steps);
  if (hasVariableDenominator(f, x)) {
    const t = together(f);
    const { N, D } = numerDenom(t);
    if (!freeOf(D, x)) {
      steps.push(makeStep(eq(N, num(0)), 'Multiply both sides by the common denominator', { note: 'Denominator: ' + toLatex(D) }));
      const inner = solveCore(eq(N, num(0)), simplify(N), x, steps);
      const good = inner.solutions.filter((s) => {
        if (!s.exact) return true;
        try {
          const dv = compileComplex(D, [x])(compileComplex(substitute(s.expr, { k: num(0) }), [])());
          return dv.abs() > 1e-10;
        } catch {
          return false;
        }
      });
      if (good.length !== inner.solutions.length) {
        steps.push(makeStep(listNode(good.map((s) => eq(sym(x), s.expr || num(0)))), 'Discard values that make a denominator zero'));
      }
      return { ...inner, solutions: good };
    }
  }
  const iso = tryIsolation(e, f, x, steps);
  if (iso) return iso;
  const subst = trySubstitution(f, x, steps);
  if (subst) return subst;
  const logs = tryCondenseLogs(f, x, steps);
  if (logs) return logs;
  return numericFallback(f, x, steps);
}

function hasVariableDenominator(f, x) {
  let found = false;
  walk(f, (n) => {
    if (n.type === 'pow' && n.args[1].type === 'num' && n.args[1].value.isNegative() && !freeOf(n.args[0], x)) found = true;
  });
  return found;
}

function numerDenom(t) {
  const factors = t.type === 'mul' ? t.args : [t];
  const N = [];
  const D = [];
  for (const g of factors) {
    if (g.type === 'pow' && g.args[1].type === 'num' && g.args[1].value.isNegative()) D.push(pow(g.args[0], num(g.args[1].value.neg())));
    else N.push(g);
  }
  return { N: simplify(mul(...N)), D: simplify(mul(...D)) };
}

function solvePolynomial(e, cs, x, steps) {
  const X = sym(x);
  const deg = cs.length - 1;
  const std = simplify(add(...cs.map((c, k) => (k === 0 ? c : mul(c, k === 1 ? X : pow(X, num(k)))))));
  if (deg === 1) {
    const [b, a] = cs;
    const target = simplify(neg(b));
    if (!(e.args[1].type === 'num' && key(simplify(e.args[0])) === key(std))) {
      steps.push(makeStep(eq(simplify(mul(a, X)), target), isZero(b) ? 'Collect the ' + x + ' terms' : 'Move the constant terms to the right side'));
    } else if (!isZero(b)) {
      steps.push(makeStep(eq(simplify(mul(a, X)), target), (isNegativeTerm(b) ? 'Add ' + toLatex(simplify(neg(b))) : 'Subtract ' + toLatex(b)) + ' on both sides'));
    }
    const sol = simplify(quo(target, a));
    if (!(a.type === 'num' && a.value.isOne())) steps.push(makeStep(eq(X, sol), 'Divide both sides by ' + toLatex(a)));
    return { ok: true, solutions: [mkSolution(sol, 1)] };
  }
  if (deg === 2) return quadratic(cs, x, steps, std);
  const p = cs.every((c) => c.type === 'num') ? toPoly(std, x) : null;
  if (!p) return { ok: false, solutions: [], reason: 'Polynomial of degree ' + deg + ' with symbolic coefficients' };
  const fr = factorRational(p);
  const parts = fr.factors.map(({ poly, mult }) => ({ e: polyToExpr(poly, x), poly, mult }));
  const factored = mul(...(fr.content.isOne() ? [] : [num(fr.content)]), ...parts.map((q) => (q.mult === 1 ? q.e : pow(q.e, num(q.mult)))));
  steps.push(makeStep(eq(std, num(0)), 'Write in standard form'));
  if (parts.length > 1 || parts[0].mult > 1) {
    steps.push(makeStep(eq(factored, num(0)), 'Factor'));
    steps.push(makeStep(listNode(parts.map((q) => eq(q.e, num(0)))), 'Set each factor equal to zero'));
  }
  const sols = [];
  for (const q of parts) {
    const d = pDeg(q.poly);
    if (d === 1) sols.push(mkSolution(num(q.poly[0].neg().div(q.poly[1])), q.mult));
    else if (d === 2) {
      const [c, b, a] = q.poly;
      for (const r of quadRoots(num(a), num(b), num(c))) sols.push(mkSolution(r, q.mult));
    } else if (isBinomial(q.poly)) {
      const roots = binomialRoots(q.poly);
      for (const r of roots) sols.push(mkSolution(r, q.mult));
      steps.push(makeStep(eq(pow(sym(x), num(d)), num(q.poly[0].neg().div(q.poly[d]))), 'Take n-th roots', { note: 'The ' + d + ' roots are r e^{2\\pi i k/' + d + '}' }));
    } else {
      const roots = polyRootsNumeric(q.poly.map((r) => r.toNumber()));
      for (const z of roots) sols.push({ ...numericSolution(z), multiplicity: q.mult });
      steps.push(makeStep(eq(q.e, num(0)), 'Solve numerically (Aberth method)', { note: 'No rational roots; degree ' + d + ' factor has no simpler closed form here' }));
    }
  }
  const exactOnes = sols.filter((s) => s.exact);
  if (exactOnes.length) steps.push(makeStep(listNode(exactOnes.map((s) => eq(X, s.expr))), 'Solutions'));
  return { ok: true, solutions: sols };
}

function isBinomial(p) {
  return p.slice(1, -1).every((c) => c.isZero()) && !p[0].isZero();
}

// Roots of a x^n + b = 0: x = r * (cos t + i sin t) with exact trig where known.
function binomialRoots(p) {
  const n = p.length - 1;
  const c = p[0].neg().div(p[n]);
  const r = simplify(pow(num(c.abs()), num(new Rational(1n, BigInt(n)))));
  const out = [];
  for (let k = 0; k < n; k++) {
    const angle = simplify(mul(num(new Rational(BigInt(c.sign() > 0 ? 2 * k : 2 * k + 1), BigInt(n))), constant('pi')));
    const unit = simplify(add(fn('cos', angle), mul(constant('i'), fn('sin', angle))));
    out.push(simplify(mul(r, unit)));
  }
  return out;
}

function quadRoots(a, b, c) {
  const disc = simplify(sub(pow(b, num(2)), mul(num(4), a, c)));
  const sq = simplify(pow(disc, num('1/2')));
  const den = simplify(mul(num(2), a));
  return [simplify(quo(sub(neg(b), sq), den)), simplify(quo(add(neg(b), sq), den))];
}

function quadratic(cs, x, steps, std) {
  const [c, b, a] = cs;
  const X = sym(x);
  steps.push(makeStep(eq(std, num(0)), 'Write in standard form'));
  steps.push(makeStep(listNode([eq(sym('a'), a), eq(sym('b'), b), eq(sym('c'), c)]), 'Identify the coefficients'));
  const wrap = (v) => v;
  const formula = eq(X, quo(fn('pm', neg(wrap(b)), pow(sub(pow(wrap(b), num(2)), mul(num(4), wrap(a), wrap(c))), num('1/2'))), mul(num(2), wrap(a))));
  steps.push(makeStep(formula, 'Quadratic formula', { note: 'x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}' }));
  const disc = simplify(sub(pow(b, num(2)), mul(num(4), a, c)));
  steps.push(makeStep(eq(sym('Delta'), disc), 'Evaluate the discriminant', { note: '\\Delta = b^{2} - 4ac' }));
  const sq = simplify(pow(disc, num('1/2')));
  steps.push(makeStep(eq(X, quo(fn('pm', simplify(neg(b)), sq), simplify(mul(num(2), a)))), 'Simplify'));
  const roots = quadRoots(a, b, c);
  let rule = 'Two solutions';
  let dv;
  try {
    dv = compileReal(disc, [])();
  } catch {
    dv = NaN;
  }
  if (isZero(disc)) rule = 'One repeated solution';
  else if (dv > 0) rule = 'Two real solutions';
  else if (dv < 0) rule = 'Two complex solutions';
  if (isZero(disc)) {
    steps.push(makeStep(eq(X, roots[0]), rule));
    return { ok: true, solutions: [mkSolution(roots[0], 2)] };
  }
  steps.push(makeStep(listNode(roots.map((r) => eq(X, r))), rule));
  return { ok: true, solutions: roots.map((r) => mkSolution(r, 1)) };
}

// Count occurrences of x in the tree.
function occurrences(e, x) {
  let n = 0;
  walk(e, (m) => {
    if (m.type === 'sym' && m.name === x) n++;
  });
  return n;
}

function tryIsolation(e, f, x, steps) {
  let lhs;
  let rhs;
  const [L, R] = e.args.map(simplify);
  if (occurrences(L, x) === 1 && freeOf(R, x)) [lhs, rhs] = [L, R];
  else if (occurrences(R, x) === 1 && freeOf(L, x)) [lhs, rhs] = [R, L];
  else if (occurrences(f, x) === 1) [lhs, rhs] = [f, num(0)];
  else return null;
  let branches = [{ lhs, rhs }];
  let periodic = false;
  for (let iter = 0; iter < 40; iter++) {
    if (branches.every((b) => b.lhs.type === 'sym' && b.lhs.name === x)) break;
    const next = [];
    let rule = null;
    let note;
    for (const b of branches) {
      if (b.lhs.type === 'sym' && b.lhs.name === x) {
        next.push(b);
        continue;
      }
      const r = invert(b.lhs, b.rhs, x);
      if (!r) return null;
      rule = rule || r.rule;
      note = note || r.note;
      if (r.periodic) periodic = true;
      for (const nb of r.branches) next.push({ lhs: nb.lhs, rhs: simplify(nb.rhs) });
    }
    branches = next;
    if (!branches.length) {
      steps.push(makeStep(e, rule || 'No solution', { note: 'No real value satisfies this equation' }));
      return { ok: true, solutions: [], identity: 'none', reason: 'No real solution' };
    }
    const shown = branches.length === 1 ? eq(branches[0].lhs, branches[0].rhs) : listNode(branches.map((b) => eq(b.lhs, b.rhs)));
    steps.push(makeStep(shown, rule, note ? { note } : {}));
  }
  const general = branches.map((b) => b.rhs);
  const sols = general.map((g) => mkSolution(simplify(substitute(g, { k: num(0) })), 1));
  if (periodic) {
    steps.push(makeStep(listNode(general.map((g) => eq(sym(x), g))), 'General solution', { note: 'k is any integer' }));
    return { ok: true, solutions: sols, general, parameter: 'k' };
  }
  return { ok: true, solutions: general.map((g) => mkSolution(g, 1)) };
}

function nonNegativeOrUnknown(r) {
  try {
    const v = compileReal(r, [])();
    return Number.isNaN(v) ? true : v >= -1e-15;
  } catch {
    return true;
  }
}

function inUnitRange(r) {
  try {
    const v = compileReal(r, [])();
    return Number.isNaN(v) ? true : Math.abs(v) <= 1 + 1e-15;
  } catch {
    return true;
  }
}

// One inversion step: returns the new equation(s) or null.
function invert(lhs, rhs, x) {
  const K = sym('k');
  const pi = constant('pi');
  switch (lhs.type) {
    case 'add': {
      const free = lhs.args.filter((t) => freeOf(t, x));
      const rest = lhs.args.filter((t) => !freeOf(t, x));
      const fs = simplify(add(...free));
      const rule = isNegativeTerm(fs) ? 'Add ' + toLatex(simplify(neg(fs))) + ' to both sides' : 'Subtract ' + toLatex(fs) + ' from both sides';
      return { rule, branches: [{ lhs: rest.length === 1 ? rest[0] : add(...rest), rhs: sub(rhs, fs) }] };
    }
    case 'mul': {
      const free = lhs.args.filter((t) => freeOf(t, x));
      const rest = lhs.args.filter((t) => !freeOf(t, x));
      const c = simplify(mul(...free));
      const rule = c.type === 'num' && c.value.eq(Rational.from(-1)) ? 'Multiply both sides by -1' : 'Divide both sides by ' + toLatex(c);
      return { rule, branches: [{ lhs: rest.length === 1 ? rest[0] : mul(...rest), rhs: quo(rhs, c) }] };
    }
    case 'pow': {
      const [b, ex] = lhs.args;
      if (freeOf(ex, x)) {
        if (ex.type === 'num') {
          const r = ex.value;
          if (r.eq(Rational.from(-1))) return { rule: 'Take reciprocals of both sides', branches: [{ lhs: b, rhs: pow(rhs, num(-1)) }] };
          if (r.isNegative()) return { rule: 'Take reciprocals of both sides', branches: [{ lhs: pow(b, num(r.neg())), rhs: pow(rhs, num(-1)) }] };
          if (r.isInteger() && r.n % 2n === 0n) {
            if (!nonNegativeOrUnknown(rhs)) return { rule: 'An even power is never negative', branches: [] };
            const root = pow(rhs, num(r.inv()));
            return { rule: 'Take the ' + (r.n === 2n ? 'square' : r.n + 'th') + ' root of both sides', branches: [{ lhs: b, rhs: neg(root) }, { lhs: b, rhs: root }] };
          }
          if (r.isInteger()) {
            const v = safeReal(rhs);
            const root = v < 0 ? neg(pow(neg(rhs), num(r.inv()))) : pow(rhs, num(r.inv()));
            return { rule: 'Take the ' + (r.n === 3n ? 'cube' : r.n + 'th') + ' root of both sides', branches: [{ lhs: b, rhs: root }] };
          }
          if (r.n === 1n && r.d === 2n && !nonNegativeOrUnknown(rhs)) return { rule: 'A square root is never negative', branches: [] };
          return { rule: 'Raise both sides to the power ' + r.inv().toString(), branches: [{ lhs: b, rhs: pow(rhs, num(r.inv())) }] };
        }
        return null;
      }
      if (freeOf(b, x)) {
        const v = safeReal(rhs);
        if (v <= 0) return { rule: 'An exponential is always positive', branches: [] };
        const isE = b.type === 'const' && b.name === 'e';
        return {
          rule: isE ? 'Take the natural logarithm of both sides' : 'Take the base ' + toLatex(b) + ' logarithm of both sides',
          branches: [{ lhs: ex, rhs: isE ? fn('ln', rhs) : fn('log', rhs, b) }],
        };
      }
      return null;
    }
    case 'fn': {
      const u = lhs.args[0];
      switch (lhs.name) {
        case 'ln': return { rule: 'Exponentiate both sides', branches: [{ lhs: u, rhs: pow(constant('e'), rhs) }] };
        case 'log': return { rule: 'Rewrite in exponential form', branches: [{ lhs: u, rhs: pow(lhs.args[1] || num(10), rhs) }] };
        case 'exp': return { rule: 'Take the natural logarithm of both sides', branches: [{ lhs: u, rhs: fn('ln', rhs) }] };
        case 'sqrt': return nonNegativeOrUnknown(rhs) ? { rule: 'Square both sides', branches: [{ lhs: u, rhs: pow(rhs, num(2)) }] } : { rule: 'A square root is never negative', branches: [] };
        case 'abs': return nonNegativeOrUnknown(rhs)
          ? { rule: 'Split the absolute value', branches: [{ lhs: u, rhs: neg(rhs) }, { lhs: u, rhs }] }
          : { rule: 'An absolute value is never negative', branches: [] };
        case 'sin': {
          if (!inUnitRange(rhs)) return { rule: 'Sine never exceeds 1 in size', branches: [] };
          const a = simplify(fn('asin', rhs));
          const b1 = add(a, mul(num(2), pi, K));
          const b2 = add(sub(pi, a), mul(num(2), pi, K));
          const same = key(simplify(b1)) === key(simplify(b2));
          return { rule: 'General solution of sine', periodic: true, note: '\\sin u = c \\Rightarrow u = \\arcsin c + 2\\pi k \\text{ or } u = \\pi - \\arcsin c + 2\\pi k', branches: same ? [{ lhs: u, rhs: b1 }] : [{ lhs: u, rhs: b1 }, { lhs: u, rhs: b2 }] };
        }
        case 'cos': {
          if (!inUnitRange(rhs)) return { rule: 'Cosine never exceeds 1 in size', branches: [] };
          const a = simplify(fn('acos', rhs));
          const b1 = add(a, mul(num(2), pi, K));
          const b2 = add(neg(a), mul(num(2), pi, K));
          const same = key(simplify(b1)) === key(simplify(b2)) || key(simplify(sub(b1, b2))) === key(simplify(mul(num(2), pi)));
          return { rule: 'General solution of cosine', periodic: true, note: '\\cos u = c \\Rightarrow u = \\pm\\arccos c + 2\\pi k', branches: same ? [{ lhs: u, rhs: b1 }] : [{ lhs: u, rhs: b1 }, { lhs: u, rhs: b2 }] };
        }
        case 'tan': return { rule: 'General solution of tangent', periodic: true, note: '\\tan u = c \\Rightarrow u = \\arctan c + \\pi k', branches: [{ lhs: u, rhs: add(fn('atan', rhs), mul(pi, K)) }] };
        case 'cot': return { rule: 'Rewrite with tangent', branches: [{ lhs: fn('tan', u), rhs: pow(rhs, num(-1)) }] };
        case 'sec': return { rule: 'Rewrite with cosine', branches: [{ lhs: fn('cos', u), rhs: pow(rhs, num(-1)) }] };
        case 'csc': return { rule: 'Rewrite with sine', branches: [{ lhs: fn('sin', u), rhs: pow(rhs, num(-1)) }] };
        case 'asin': return { rule: 'Take the sine of both sides', branches: [{ lhs: u, rhs: fn('sin', rhs) }] };
        case 'acos': return { rule: 'Take the cosine of both sides', branches: [{ lhs: u, rhs: fn('cos', rhs) }] };
        case 'atan': return { rule: 'Take the tangent of both sides', branches: [{ lhs: u, rhs: fn('tan', rhs) }] };
        case 'sinh': return { rule: 'Inverse hyperbolic sine', branches: [{ lhs: u, rhs: fn('ln', add(rhs, pow(add(pow(rhs, num(2)), num(1)), num('1/2')))) }] };
        case 'cosh': {
          const v = fn('ln', add(rhs, pow(sub(pow(rhs, num(2)), num(1)), num('1/2'))));
          return { rule: 'Inverse hyperbolic cosine', branches: [{ lhs: u, rhs: neg(v) }, { lhs: u, rhs: v }] };
        }
        case 'tanh': return { rule: 'Inverse hyperbolic tangent', branches: [{ lhs: u, rhs: mul(num('1/2'), fn('ln', quo(add(num(1), rhs), sub(num(1), rhs)))) }] };
        default: return null;
      }
    }
    default: return null;
  }
}

function safeReal(e) {
  try {
    return compileReal(e, [])();
  } catch {
    return NaN;
  }
}

function trySubstitution(f, x, steps) {
  const cands = new Map();
  walk(f, (n) => {
    if (n === f || freeOf(n, x) || n.type === 'sym' || n.type === 'num') return;
    if (n.type === 'pow' || n.type === 'fn') cands.set(key(n), n);
  });
  const list = [...cands.values()].sort((a, b) => size(a) - size(b));
  for (const g of list) {
    const U = sym('u');
    let h = simplify(replaceSubtree(f, g, U));
    if (!freeOf(h, x) && g.type === 'pow' && g.args[0].type === 'const') {
      // e^(2x) = (e^x)^2.
      h = simplify(replaceExpPowers(f, g, U, x));
    }
    if (!freeOf(h, x) && g.type === 'pow' && g.args[0].type === 'sym' && g.args[0].name === x && g.args[1].type === 'num') {
      // u = x^r, so x = u^(1/r): sqrt(x) + x = 6 becomes u + u^2 = 6.
      h = simplify(mergePowersOf(simplify(substitute(h, { [x]: pow(U, num(g.args[1].value.inv())) })), 'u'));
    }
    if (!freeOf(h, x)) continue;
    const cs = polyCoeffs(h, 'u');
    if (!cs || cs.length < 3) continue;
    steps.push(makeStep(eq(h, num(0)), 'Substitute u = ' + toLatex(g)));
    const inner = solveCore(eq(h, num(0)), h, 'u', steps);
    const out = [];
    const general = [];
    let periodic = false;
    for (const s of inner.solutions) {
      if (!s.exact) continue;
      const back = solve(eq(g, s.expr), x);
      steps.push(makeStep(eq(g, s.expr), 'Substitute back and solve'));
      for (const b of back.solutions) out.push(b);
      if (back.general) {
        periodic = true;
        general.push(...back.general);
      }
    }
    if (!out.length && !inner.solutions.length) continue;
    return periodic ? { ok: true, solutions: out, general, parameter: 'k' } : { ok: true, solutions: out };
  }
  return null;
}

// (u^a)^b -> u^(ab) for the substitution variable (candidates are checked
// against the original equation afterwards, so branch issues cannot leak).
function mergePowersOf(e, name) {
  const walkNode = (n) => {
    const m = n.args ? withArgs(n, n.args.map(walkNode)) : n;
    if (m.type === 'pow' && m.args[0].type === 'pow' && m.args[0].args[0].type === 'sym' && m.args[0].args[0].name === name
      && m.args[1].type === 'num' && m.args[0].args[1].type === 'num') {
      return pow(m.args[0].args[0], num(m.args[0].args[1].value.mul(m.args[1].value)));
    }
    return m;
  };
  return walkNode(e);
}

function replaceExpPowers(f, g, U, x) {
  const base = g.args[0];
  const exp0 = simplify(g.args[1]);
  const walkNode = (n) => {
    if (n.type === 'pow' && key(n.args[0]) === key(base) && !freeOf(n.args[1], x)) {
      const ratio = simplify(quo(n.args[1], exp0));
      if (ratio.type === 'num' && ratio.value.isInteger()) return pow(U, ratio);
    }
    return n.args ? withArgs(n, n.args.map(walkNode)) : n;
  };
  return walkNode(f);
}

function tryCondenseLogs(f, x, steps) {
  if (f.type !== 'add') return null;
  const logs = [];
  const rest = [];
  for (const t of f.args) {
    const factors = t.type === 'mul' ? t.args : [t];
    const lnF = factors.find((q) => q.type === 'fn' && q.name === 'ln' && !freeOf(q, x));
    const others = factors.filter((q) => q !== lnF);
    if (lnF && others.every((q) => q.type === 'num')) logs.push({ arg: lnF.args[0], c: simplify(mul(...others)) });
    else if (freeOf(t, x)) rest.push(t);
    else return null;
  }
  if (logs.length < 2) return null;
  const inside = simplify(mul(...logs.map((l) => pow(l.arg, l.c))));
  const rhs = simplify(neg(add(...rest)));
  steps.push(makeStep(eq(fn('ln', inside), rhs), 'Combine the logarithms', { note: '\\ln a + \\ln b = \\ln(ab)' }));
  const inner = solve(eq(inside, pow(constant('e'), rhs)), x);
  steps.push(...inner.steps.slice(1));
  const good = inner.solutions.filter((s) => logs.every((l) => {
    if (!s.exact) return true;
    try {
      const v = compileReal(substitute(l.arg, { [x]: s.expr }), [])();
      return v > 0;
    } catch {
      return false;
    }
  }));
  return { ok: true, solutions: good };
}

function numericFallback(f, x, steps) {
  let g;
  try {
    g = compileReal(f, [x]);
  } catch {
    return { ok: false, solutions: [], reason: 'Cannot solve symbolically or evaluate numerically' };
  }
  const roots = [];
  const N = 4000;
  const a = -50;
  const b = 50;
  let prevX = a;
  let prevY = g(a);
  for (let i = 1; i <= N; i++) {
    const xi = a + ((b - a) * i) / N;
    const yi = g(xi);
    if (Number.isFinite(prevY) && Number.isFinite(yi)) {
      if (prevY === 0) roots.push(prevX);
      else if (prevY * yi < 0) {
        const r = brent(g, prevX, xi);
        if (r.converged && Math.abs(g(r.root)) < 1e-6 * (1 + Math.abs(prevY) + Math.abs(yi))) roots.push(r.root);
      }
    }
    prevX = xi;
    prevY = yi;
  }
  const uniq = [];
  for (const r of roots) if (!uniq.some((u) => Math.abs(u - r) < 1e-9)) uniq.push(r);
  if (!uniq.length) return { ok: false, solutions: [], reason: 'No exact method applies and no real root was found in [-50, 50]' };
  steps.push(makeStep(eq(f, num(0)), 'Solve numerically', { note: 'Sign changes on [-50, 50] refined by Brent\'s method' }));
  return { ok: true, solutions: uniq.map((r) => numericSolution(r)), reason: 'Solutions found numerically' };
}

/**
 * @typedef {object} SystemResult
 * @property {boolean} ok
 * @property {'unique'|'infinite'|'none'} [kind]
 * @property {Record<string, Expr>} [solution] values (particular solution when infinite)
 * @property {Record<string, Expr>} [parametric] solution in terms of free parameters t_1, t_2, ...
 * @property {import('./linalg.js').MatrixStep[]} steps
 * @property {string} [reason]
 */

/**
 * Solve a system of linear equations by Gaussian elimination on the
 * augmented matrix, with every row operation as a step.
 * @param {Array<Expr|string>} equations
 * @param {string[]} vars
 * @returns {SystemResult}
 */
export function solveLinearSystem(equations, vars) {
  const rows = [];
  const rhs = [];
  for (const q of equations) {
    let e = ensureExpr(q);
    if (e.type !== 'eq') e = eq(e, num(0));
    const f = expand(sub(e.args[0], e.args[1]));
    const row = [];
    let rest = f;
    for (const v of vars) {
      const cs = polyCoeffs(f, v);
      if (!cs || cs.length > 2) return { ok: false, reason: 'Equation is not linear in ' + v, steps: [] };
      const c = cs[1] || num(0);
      if (!vars.every((w) => freeOf(c, w))) return { ok: false, reason: 'Equation has a product of unknowns', steps: [] };
      if (c.type !== 'num') return { ok: false, reason: 'Coefficients must be numbers', steps: [] };
      row.push(c.value);
      rest = simplify(sub(rest, mul(c, sym(v))));
    }
    if (rest.type !== 'num') return { ok: false, reason: 'Constant terms must be numbers', steps: [] };
    rows.push(row);
    rhs.push(rest.value.neg());
  }
  const res = solveLinear(rows, rhs);
  if (res.kind === 'none') return { ok: true, kind: 'none', steps: res.steps, reason: 'The system is inconsistent' };
  const solution = {};
  vars.forEach((v, i) => {
    solution[v] = scalarToExpr(res.solution[i]);
  });
  if (res.kind === 'unique') return { ok: true, kind: 'unique', solution, steps: res.steps };
  const params = res.freeVariables.map((_, i) => sym('t_' + (i + 1)));
  const parametric = {};
  vars.forEach((v, i) => {
    parametric[v] = simplify(add(scalarToExpr(res.solution[i]), ...res.nullspace.map((ns, j) => mul(scalarToExpr(ns[i]), params[j]))));
  });
  return { ok: true, kind: 'infinite', solution, parametric, steps: res.steps };
}

/**
 * Newton's method for a nonlinear system F(v) = 0 with the Jacobian built
 * symbolically. Returns the iteration history for animation.
 * @param {Array<Expr|string>} equations
 * @param {string[]} vars
 * @param {number[]} guess
 * @param {{tol?: number, maxIter?: number}} [opts]
 * @returns {{ok: boolean, solution: number[], iterations: number, history: {x: number[], residual: number}[], reason?: string}}
 */
export function newtonSystem(equations, vars, guess, opts = {}) {
  const tol = opts.tol ?? 1e-12;
  const maxIter = opts.maxIter ?? 50;
  const Fs = equations.map((q) => {
    let e = ensureExpr(q);
    if (e.type !== 'eq') e = eq(e, num(0));
    return simplify(sub(e.args[0], e.args[1]));
  });
  const Fc = Fs.map((f) => compileReal(f, vars));
  const Jc = Fs.map((f) => vars.map((v) => compileReal(diff(f, v), vars)));
  let xk = guess.slice();
  const history = [];
  for (let it = 0; it <= maxIter; it++) {
    const Fv = Fc.map((g) => g(...xk));
    const res = Math.hypot(...Fv);
    history.push({ x: xk.slice(), residual: res });
    if (res < tol) return { ok: true, solution: xk, iterations: it, history };
    const J = Jc.map((row) => row.map((g) => g(...xk)));
    const step = gaussSolve(J, Fv.map((v) => -v));
    if (!step) return { ok: false, solution: xk, iterations: it, history, reason: 'Singular Jacobian' };
    xk = xk.map((v, i) => v + step[i]);
    if (!xk.every(Number.isFinite)) return { ok: false, solution: xk, iterations: it, history, reason: 'Iteration diverged' };
  }
  return { ok: false, solution: xk, iterations: maxIter, history, reason: 'Did not converge' };
}

function gaussSolve(A, b) {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let i = c + 1; i < n; i++) {
      const f = M[i][c] / M[c][c];
      for (let j = c; j <= n; j++) M[i][j] -= f * M[c][j];
    }
  }
  const out = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * out[j];
    out[i] = s / M[i][i];
  }
  return out;
}
