/**
 * Laplace transforms with steps (table entries plus linearity, the first
 * shifting theorem, multiplication by t, and the derivative rule for an
 * unknown function), inverse transforms by partial fractions, and solving
 * linear constant-coefficient ODEs with initial conditions.
 * @module math/laplace
 */
import { Rational } from './rational.js';
import {
  num, sym, constant, add, mul, pow, fn, eq, freeOf, withArgs, substitute,
} from './expr.js';
import { simplify } from './simplify.js';
import { ensureExpr, varName } from './parse.js';
import { diff } from './diff.js';
import { polyCoeffs, pDeg } from './poly.js';
import { apart } from './ratfunc.js';
import { makeStep, linkSteps } from './steps.js';
import { toLatex } from './latex.js';

/** @typedef {import('./expr.js').Expr} Expr */

const isZero = (e) => e.type === 'num' && e.value.isZero();

function factorial(n) {
  let r = 1n;
  for (let i = 2n; i <= BigInt(n); i++) r *= i;
  return new Rational(r);
}

// k with arg = k t (zero constant term), or null.
function linearCoeff(u, t) {
  if (u.type === 'sym' && u.name === t) return num(1);
  const cs = polyCoeffs(u, t);
  if (!cs || cs.length !== 2 || !isZero(cs[0])) return null;
  return cs[1];
}

/**
 * One transform rule applied to f (returns the replacement for L{f}).
 * @returns {{out: Expr, rule: string, note?: string}|null}
 */
function laplaceRule(f, t, s, ctx) {
  const S = sym(s);
  const L = (g) => fn('laplace', g);
  if (freeOf(f, t) && !ctx.unknowns.some((y) => !freeOf(f, y))) return { out: mul(f, pow(S, num(-1))), rule: 'Transform of a constant', note: '\\mathcal{L}\\{1\\} = \\frac{1}{s}' };
  if (f.type === 'add') return { out: add(...f.args.map(L)), rule: 'Linearity' };
  if (f.type === 'mul') {
    const cs = f.args.filter((a) => freeOf(a, t) && ctx.unknowns.every((y) => freeOf(a, y)));
    const rest = f.args.filter((a) => !cs.includes(a));
    if (cs.length && rest.length) return { out: mul(simplify(mul(...cs)), L(rest.length === 1 ? rest[0] : mul(...rest))), rule: 'Linearity' };
    const ex = rest.find((a) => a.type === 'pow' && a.args[0].type === 'const' && a.args[0].name === 'e' && linearCoeff(a.args[1], t));
    if (ex && rest.length > 1) {
      const a = linearCoeff(ex.args[1], t);
      const g = simplify(mul(...rest.filter((q) => q !== ex)));
      const G = transform(g, t, s, ctx);
      if (!G) return null;
      return { out: simplify(substitute(G, { [s]: add(S, mul(num(-1), a)) })), rule: 'First shifting theorem', note: '\\mathcal{L}\\{e^{at} f(t)\\} = F(s - a)' };
    }
    const tp = rest.find((q) => (q.type === 'sym' && q.name === t) || (q.type === 'pow' && q.args[0].type === 'sym' && q.args[0].name === t && q.args[1].type === 'num' && q.args[1].value.isInteger() && q.args[1].value.sign() > 0));
    if (tp && rest.length > 1) {
      const n = tp.type === 'sym' ? 1 : Number(tp.args[1].value.n);
      const g = simplify(mul(...rest.filter((q) => q !== tp)));
      const G = transform(g, t, s, ctx);
      if (!G) return null;
      return { out: simplify(mul(num(n % 2 ? -1 : 1), diff(G, s, n))), rule: 'Multiplication by t', note: '\\mathcal{L}\\{t^{n} f(t)\\} = (-1)^{n} F^{(n)}(s)' };
    }
  }
  if (f.type === 'sym' && f.name === t) return { out: pow(S, num(-2)), rule: 'Power rule', note: '\\mathcal{L}\\{t^{n}\\} = \\frac{n!}{s^{n+1}}' };
  if (f.type === 'sym' && ctx.unknowns.includes(f.name)) return { out: sym(f.name.toUpperCase()), rule: 'Transform of the unknown' };
  if (f.type === 'deriv' && f.args[0].type === 'sym' && ctx.unknowns.includes(f.args[0].name) && f.v === t) {
    const y = f.args[0].name;
    const n = f.order;
    const terms = [mul(pow(S, num(n)), sym(y.toUpperCase()))];
    for (let k = 0; k < n; k++) terms.push(mul(num(-1), pow(S, num(n - 1 - k)), sym(y + "'".repeat(k) + '(0)')));
    return { out: add(...terms), rule: 'Derivative rule', note: '\\mathcal{L}\\{y^{(n)}\\} = s^{n} Y - s^{n-1} y(0) - \\dots - y^{(n-1)}(0)' };
  }
  if (f.type === 'pow') {
    const [b, e] = f.args;
    if (b.type === 'sym' && b.name === t && e.type === 'num' && e.value.isInteger() && e.value.sign() > 0) {
      const n = Number(e.value.n);
      return { out: mul(num(factorial(n)), pow(S, num(-(n + 1)))), rule: 'Power rule', note: '\\mathcal{L}\\{t^{n}\\} = \\frac{n!}{s^{n+1}}' };
    }
    if (b.type === 'const' && b.name === 'e') {
      const cs = polyCoeffs(e, t);
      if (cs && cs.length === 2) {
        const out = mul(pow(constant('e'), cs[0]), pow(add(S, mul(num(-1), cs[1])), num(-1)));
        return { out, rule: 'Exponential', note: '\\mathcal{L}\\{e^{at}\\} = \\frac{1}{s - a}' };
      }
    }
  }
  if (f.type === 'fn') {
    const k = linearCoeff(f.args[0], t);
    if (k) {
      const s2 = pow(S, num(2));
      const k2 = pow(k, num(2));
      const table = {
        sin: [mul(k, pow(add(s2, k2), num(-1))), '\\mathcal{L}\\{\\sin bt\\} = \\frac{b}{s^{2} + b^{2}}'],
        cos: [mul(S, pow(add(s2, k2), num(-1))), '\\mathcal{L}\\{\\cos bt\\} = \\frac{s}{s^{2} + b^{2}}'],
        sinh: [mul(k, pow(add(s2, mul(num(-1), k2)), num(-1))), '\\mathcal{L}\\{\\sinh bt\\} = \\frac{b}{s^{2} - b^{2}}'],
        cosh: [mul(S, pow(add(s2, mul(num(-1), k2)), num(-1))), '\\mathcal{L}\\{\\cosh bt\\} = \\frac{s}{s^{2} - b^{2}}'],
      }[f.name];
      if (table) return { out: table[0], rule: 'Table: ' + f.name, note: table[1] };
    }
  }
  return null;
}

// Silent transform (used by the shifting and multiplication rules).
function transform(f, t, s, ctx) {
  const r = laplaceRule(simplify(f), t, s, ctx);
  if (!r) return null;
  const done = resolveAll(r.out, t, s, ctx, null);
  return done ? simplify(done) : null;
}

function findPending(e) {
  if (e.type === 'fn' && e.name === 'laplace') return e;
  if (!e.args) return null;
  for (const a of e.args) {
    const p = findPending(a);
    if (p) return p;
  }
  return null;
}

function replaceNode(e, target, repl) {
  if (e === target) return repl;
  return e.args ? withArgs(e, e.args.map((a) => replaceNode(a, target, repl))) : e;
}

function resolveAll(expr, t, s, ctx, steps) {
  let cur = expr;
  for (let i = 0; i < 200; i++) {
    const p = findPending(cur);
    if (!p) return cur;
    const r = laplaceRule(simplify(p.args[0]), t, s, ctx);
    if (!r) return null;
    cur = replaceNode(cur, p, r.out);
    if (steps) steps.push(makeStep(cur, r.rule, r.note ? { note: r.note } : {}));
  }
  return null;
}

/**
 * Laplace transform with steps.
 * @param {Expr|string} expr function of t
 * @param {string|Expr} [tVar='t']
 * @param {string|Expr} [sVar='s']
 * @param {{unknowns?: string[]}} [opts] unknown functions (y becomes Y, y' uses s Y - y(0))
 * @returns {{ok: boolean, result?: Expr, latex?: string, steps: import('./steps.js').Step[], reason?: string}}
 */
export function laplace(expr, tVar = 't', sVar = 's', opts = {}) {
  const t = varName(tVar);
  const s = varName(sVar);
  const ctx = { unknowns: opts.unknowns || [] };
  const f = ensureExpr(expr);
  const start = fn('laplace', f);
  const steps = [makeStep(start, 'Laplace transform')];
  const raw = resolveAll(start, t, s, ctx, steps);
  if (!raw) return { ok: false, reason: 'No table entry or rule applies', steps: linkSteps(steps) };
  const result = simplify(raw);
  steps.push(makeStep(result, 'Simplify'));
  return { ok: true, result, latex: toLatex(result), steps: linkSteps(steps) };
}

/**
 * Inverse Laplace transform of a rational function of s by partial
 * fractions, with steps.
 * @param {Expr|string} expr
 * @param {string|Expr} [sVar='s']
 * @param {string|Expr} [tVar='t']
 * @returns {{ok: boolean, result?: Expr, latex?: string, steps: import('./steps.js').Step[], reason?: string}}
 */
export function inverseLaplace(expr, sVar = 's', tVar = 't') {
  const s = varName(sVar);
  const t = varName(tVar);
  const F = ensureExpr(expr);
  const T = sym(t);
  const steps = [makeStep(fn('ilaplace', F), 'Inverse Laplace transform')];
  const pf = apart(F, s);
  if (!pf.ok) return { ok: false, reason: 'Only rational functions of s are supported', steps: linkSteps(steps) };
  if (pf.polynomial && !isZero(pf.polynomial)) return { ok: false, reason: 'A polynomial part would need delta functions', steps: linkSteps(steps) };
  const pieces = pf.terms.map((term) => simplify(mul(term.numerator, pow(term.power === 1 ? term.factor : pow(term.factor, num(term.power)), num(-1)))));
  steps.push(makeStep(add(...pieces.map((p) => fn('ilaplace', p))), 'Partial fractions and linearity', { note: toLatex(pf.result) }));
  const parts = [];
  for (const term of pf.terms) {
    const deg = pDeg(term.poly);
    if (deg === 1) {
      const [c0, c1] = term.poly;
      const a = num(c0.neg().div(c1));
      const A = simplify(mul(term.numerator, pow(num(c1.pow(term.power)), num(-1))));
      const k = term.power;
      parts.push(simplify(mul(A, pow(T, num(k - 1)), pow(constant('e'), mul(a, T)), pow(num(factorial(k - 1)), num(-1)))));
    } else if (deg === 2 && term.power === 1) {
      const [q, p, lead] = term.poly;
      const B = term.numPoly[1] ? term.numPoly[1].div(lead) : Rational.from(0);
      const C = term.numPoly[0] ? term.numPoly[0].div(lead) : Rational.from(0);
      const pp = p.div(lead);
      const qq = q.div(lead);
      const w2 = qq.sub(pp.mul(pp).div(Rational.from(4)));
      const shift = num(pp.div(Rational.from(-2)));
      const decay = pow(constant('e'), mul(shift, T));
      if (w2.sign() > 0) {
        const w = simplify(pow(num(w2), num('1/2')));
        const sinCoeff = simplify(mul(num(C.sub(B.mul(pp).div(Rational.from(2)))), pow(w, num(-1))));
        parts.push(simplify(mul(decay, add(mul(num(B), fn('cos', mul(w, T))), mul(sinCoeff, fn('sin', mul(w, T)))))));
      } else {
        const w = simplify(pow(num(w2.neg()), num('1/2')));
        const sinhCoeff = simplify(mul(num(C.sub(B.mul(pp).div(Rational.from(2)))), pow(w, num(-1))));
        parts.push(simplify(mul(decay, add(mul(num(B), fn('cosh', mul(w, T))), mul(sinhCoeff, fn('sinh', mul(w, T)))))));
      }
    } else {
      return { ok: false, reason: 'Repeated irreducible quadratic factors are not supported', steps: linkSteps(steps) };
    }
  }
  const result = simplify(add(...parts));
  steps.push(makeStep(add(...parts), 'Table lookups', { note: '\\mathcal{L}^{-1}\\left\\{\\frac{1}{(s-a)^{k}}\\right\\} = \\frac{t^{k-1} e^{at}}{(k-1)!}' }));
  steps.push(makeStep(result, 'Simplify'));
  return { ok: true, result, latex: toLatex(result), steps: linkSteps(steps) };
}

/**
 * Solve a linear constant-coefficient ODE for y(t) with initial conditions by
 * the Laplace transform: transform, solve for Y(s), substitute the initial
 * values, and invert.
 * @param {Expr|string} equation e.g. "diff(y, t, 2) + 3 diff(y, t) + 2y = e^(-t)"
 * @param {{y?: string, t?: string, initial?: number[]|string[]}} [opts] initial: [y(0), y'(0), ...]
 * @returns {{ok: boolean, result?: Expr, latex?: string, steps: import('./steps.js').Step[], reason?: string}}
 */
export function solveODELaplace(equation, opts = {}) {
  const y = opts.y || 'y';
  const t = opts.t || 't';
  let e = ensureExpr(equation);
  if (e.type !== 'eq') e = eq(e, num(0));
  const steps = [makeStep(e, 'Differential equation')];
  const lhs = laplace(e.args[0], t, 's', { unknowns: [y] });
  const rhs = laplace(e.args[1], t, 's', { unknowns: [y] });
  if (!lhs.ok || !rhs.ok) return { ok: false, reason: 'Could not transform the equation', steps: linkSteps(steps) };
  const transformed = eq(lhs.result, rhs.result);
  steps.push(makeStep(transformed, 'Take the Laplace transform of both sides'));
  const Y = y.toUpperCase();
  const init = {};
  (opts.initial || []).forEach((v, k) => {
    init[y + "'".repeat(k) + '(0)'] = ensureExpr(v);
  });
  const withInit = eq(simplify(substitute(lhs.result, init)), simplify(substitute(rhs.result, init)));
  steps.push(makeStep(withInit, 'Substitute the initial conditions'));
  const diffSides = simplify(add(withInit.args[0], mul(num(-1), withInit.args[1])));
  const cs = polyCoeffs(diffSides, Y);
  if (!cs || cs.length !== 2) return { ok: false, reason: 'The transformed equation is not linear in ' + Y, steps: linkSteps(steps) };
  const Ys = simplify(mul(num(-1), cs[0], pow(cs[1], num(-1))));
  steps.push(makeStep(eq(sym(Y), Ys), 'Solve for ' + Y + '(s)'));
  const inv = inverseLaplace(Ys, 's', t);
  if (!inv.ok) return { ok: false, reason: inv.reason, steps: linkSteps(steps) };
  steps.push(...inv.steps.slice(1));
  steps.push(makeStep(eq(sym(y + '(' + t + ')'), inv.result), 'Solution'));
  return { ok: true, result: inv.result, latex: toLatex(inv.result), steps: linkSteps(steps) };
}

