/**
 * Taylor, Maclaurin and Laurent series. Coefficients come from successive
 * derivatives evaluated at the expansion point (limits are used when the
 * formula has a removable singularity there). The general term is reported
 * for recognised functions (exponential, sine, cosine, hyperbolic, log,
 * geometric, arctangent, binomial) and is checked against the computed
 * coefficients before being returned.
 * @module math/series
 */
import { Rational } from './rational.js';
import {
  num, sym, constant, add, mul, pow, fn, eq, deriv, sumNode, listNode, key, substitute, MathError,
} from './expr.js';
import { simplify, splitCoeff } from './simplify.js';
import { ensureExpr, varName } from './parse.js';
import { diff } from './diff.js';
import { limit } from './limits.js';
import { compileReal } from './evaluate.js';
import { makeStep, linkSteps } from './steps.js';
import { toLatex } from './latex.js';
import { polyCoeffs } from './poly.js';
import { toRationalFunction, cancel } from './ratfunc.js';
import { powerSeries } from './powerseries.js';

/** @typedef {import('./expr.js').Expr} Expr */

function valueAt(e, x, a) {
  try {
    const v = simplify(substitute(e, { [x]: a }));
    const nv = compileReal(v, [])();
    if (Number.isFinite(nv) || [...collectSymbols(v)].length) return v;
  } catch (err) {
    if (!(err instanceof MathError)) throw err;
  }
  const l = limit(e, x, a);
  if (l.ok && l.kind === 'finite' && l.exact) return l.value;
  return null;
}

// Cancel common factors of rational functions so removable singularities vanish.
function tidy(f, x) {
  return toRationalFunction(f, x) ? cancel(f, x) : f;
}

function collectSymbols(e) {
  const out = new Set();
  const walkNode = (n) => {
    if (n.type === 'sym') out.add(n.name);
    if (n.args) n.args.forEach(walkNode);
  };
  walkNode(e);
  return out;
}

function factorialR(k) {
  let r = 1n;
  for (let i = 2n; i <= BigInt(k); i++) r *= i;
  return new Rational(r);
}

// Matches c * g(k x) for the table below (a = 0).
function scaledArgument(u, x) {
  if (u.type === 'sym' && u.name === x) return num(1);
  const cs = polyCoeffs(u, x);
  if (cs && cs.length === 2 && cs[0].type === 'num' && cs[0].value.isZero()) return cs[1];
  return null;
}

// General term of the Maclaurin series of f, as a function of the index n.
function maclaurinGeneralTerm(f, x) {
  const X = sym(x);
  const N = sym('n');
  const [c, rest] = splitCoeff(f);
  if (!rest) return null;
  const C = num(c);
  const fact = (e) => pow(fn('factorial', e), num(-1));
  const sign = pow(num(-1), N);
  const odd = add(mul(num(2), N), num(1));
  const even = mul(num(2), N);
  const mk = (body, start) => ({ term: simplify(mul(C, body)), start });
  if (rest.type === 'pow' && rest.args[0].type === 'const' && rest.args[0].name === 'e') {
    const k = scaledArgument(rest.args[1], x);
    if (k) return mk(mul(pow(k, N), pow(X, N), fact(N)), 0);
  }
  if (rest.type === 'fn') {
    const k = scaledArgument(rest.args[0], x);
    if (k) {
      switch (rest.name) {
        case 'sin': return mk(mul(sign, pow(k, odd), pow(X, odd), fact(odd)), 0);
        case 'cos': return mk(mul(sign, pow(k, even), pow(X, even), fact(even)), 0);
        case 'sinh': return mk(mul(pow(k, odd), pow(X, odd), fact(odd)), 0);
        case 'cosh': return mk(mul(pow(k, even), pow(X, even), fact(even)), 0);
        case 'atan': return mk(mul(sign, pow(k, odd), pow(X, odd), pow(odd, num(-1))), 0);
        default: break;
      }
    }
    if (rest.name === 'ln') {
      const k = scaledArgument(simplify(add(rest.args[0], num(-1))), x);
      if (k) return mk(mul(pow(num(-1), add(N, num(1))), pow(k, N), pow(X, N), pow(N, num(-1))), 1);
    }
  }
  if (rest.type === 'pow' && rest.args[1].type === 'num') {
    const r = rest.args[1].value;
    const cs = polyCoeffs(rest.args[0], x);
    if (cs && cs.length === 2 && cs[0].type === 'num' && cs[1].type === 'num' && !cs[0].value.isZero()) {
      const b = cs[0].value;
      if (b.sign() > 0 || r.isInteger()) {
        const k = num(cs[1].value.div(b));
        const scale = simplify(mul(C, pow(num(b), num(r))));
        const body = r.eq(Rational.from(-1))
          ? mul(pow(simplify(mul(num(-1), k)), N), pow(X, N))
          : mul(fn('binom', num(r), N), pow(k, N), pow(X, N));
        return { term: simplify(mul(scale, body)), start: 0 };
      }
    }
  }
  return null;
}

function binomialCoefficient(r, n) {
  let out = new Rational(1n);
  for (let i = 0; i < n; i++) out = out.mul(r.sub(Rational.from(i))).div(Rational.from(i + 1));
  return out;
}

function termValue(term, n) {
  // Evaluate a general term (with binom handled explicitly) at index n.
  const walkNode = (e) => {
    if (e.type === 'fn' && e.name === 'binom') return num(binomialCoefficient(e.args[0].value, n));
    if (e.type === 'sym' && e.name === 'n') return num(n);
    return e.args ? { ...e, args: e.args.map(walkNode) } : e;
  };
  return simplify(walkNode(term));
}

/**
 * @typedef {object} SeriesResult
 * @property {boolean} ok
 * @property {Expr} [polynomial] the truncated series
 * @property {{power: number, coefficient: Expr}[]} [terms]
 * @property {{term: Expr, start: number, latex: string}|null} [generalTerm]
 * @property {string} [latex]
 * @property {import('./steps.js').Step[]} steps
 * @property {string} [reason]
 */

/**
 * Taylor polynomial of order n about a (Maclaurin when a = 0), with steps.
 * @param {Expr|string} expr
 * @param {string|Expr} [variable='x']
 * @param {Expr|string|number} [about=0]
 * @param {number} [order=5]
 * @returns {SeriesResult}
 */
export function taylor(expr, variable = 'x', about = 0, order = 5) {
  const x = varName(variable);
  const a = simplify(ensureExpr(about));
  const f = tidy(simplify(ensureExpr(expr)), x);
  const steps = [makeStep(f, 'Expand ' + (isZeroExpr(a) ? 'as a Maclaurin series' : 'as a Taylor series about ' + toLatex(a)))];
  const X = sym(x);
  const shift = isZeroExpr(a) ? X : add(X, mul(num(-1), a));
  let d = f;
  const values = [];
  const terms = [];
  for (let k = 0; k <= order; k++) {
    if (k > 0) {
      d = diff(d, x);
      steps.push(makeStep(eq(deriv(f, x, k), d), 'Derivative ' + k));
    }
    const v = valueAt(d, x, a);
    if (!v) return seriesFallback(f, x, a, order, steps, shift);
    values.push(eq(sym('c_' + k), v));
    const coeff = simplify(mul(v, pow(num(factorialR(k)), num(-1))));
    if (!isZeroExpr(coeff)) terms.push({ power: k, coefficient: coeff });
  }
  steps.push(makeStep(listNode(values), 'Evaluate each derivative at ' + x + ' = ' + toLatex(a)));
  const raw = add(...terms.map((t) => seriesTerm(t.coefficient, shift, t.power)));
  const poly = simplify(raw);
  steps.push(makeStep(raw, 'Divide by k! and assemble the polynomial'));
  let general = null;
  if (isZeroExpr(a)) {
    const g = maclaurinGeneralTerm(f, x);
    if (g && checkGeneral(g, terms, x, order)) {
      general = { ...g, latex: toLatex(sumNode(g.term, 'n', g.start, constant('inf'))) };
      steps.push(makeStep(sumNode(g.term, 'n', g.start, constant('inf')), 'General term'));
    }
  }
  return { ok: true, polynomial: poly, terms, generalTerm: general, latex: toLatex(raw), steps: linkSteps(steps) };
}

function seriesTerm(c, shift, p) {
  if (p === 0) return c;
  const powPart = p === 1 ? shift : pow(shift, num(p));
  if (c.type === 'num' && c.value.isOne()) return powPart;
  if (c.type === 'num' && c.value.eq(Rational.from(-1))) return mul(num(-1), powPart);
  return mul(c, powPart);
}

// Coefficients by series arithmetic when derivatives cannot be evaluated
// at the point (removable singularities such as x / sin(x)).
function seriesFallback(f, x, a, order, steps, shift) {
  let ps;
  try {
    ps = powerSeries(f, x, a, order);
  } catch (err) {
    if (!(err instanceof MathError)) throw err;
    return { ok: false, reason: 'No Taylor series at this point (' + err.message + ')', steps: linkSteps(steps) };
  }
  if (ps.v < 0) return { ok: false, reason: 'The function has a pole here; use a Laurent series', steps: linkSteps(steps) };
  const terms = [];
  ps.c.forEach((c, i) => {
    if (!isZeroExpr(c)) terms.push({ power: ps.v + i, coefficient: c });
  });
  const raw = add(...terms.map((t) => seriesTerm(t.coefficient, shift, t.power)));
  steps.splice(1);
  steps.push(makeStep(raw, 'Combine the known series of each part', { note: 'Derivatives are undefined at the point, so the series are multiplied and divided term by term' }));
  return { ok: true, polynomial: simplify(raw), terms, generalTerm: null, latex: toLatex(raw), steps: linkSteps(steps) };
}

function isZeroExpr(e) {
  return e.type === 'num' && e.value.isZero();
}

// Compare the general term against the computed coefficients.
function checkGeneral(g, terms, x, order) {
  const want = new Map(terms.map((t) => [t.power, t.coefficient]));
  const got = new Map();
  for (let n = g.start; n <= order + 2; n++) {
    const tv = termValue(g.term, n);
    const cs = polyCoeffs(tv, x);
    if (!cs) return false;
    cs.forEach((c, p) => {
      if (!isZeroExpr(c)) got.set(p, simplify(add(got.get(p) || num(0), c)));
    });
  }
  for (let p = 0; p <= order; p++) {
    const w = want.get(p) || num(0);
    const h = got.get(p) || num(0);
    if (key(simplify(add(w, mul(num(-1), h)))) !== key(num(0))) return false;
  }
  return true;
}

/**
 * @typedef {object} LaurentResult
 * @property {boolean} ok
 * @property {number} [poleOrder] order of the pole (0 for a regular point)
 * @property {{power: number, coefficient: Expr}[]} [terms] powers of (x - a), negative ones first
 * @property {Expr} [principalPart]
 * @property {Expr} [residue] coefficient of (x - a)^(-1)
 * @property {Expr} [series]
 * @property {string} [latex]
 * @property {import('./steps.js').Step[]} steps
 * @property {string} [reason]
 */

/**
 * Laurent series about a pole: finds the pole order m from
 * lim (x - a)^m f, expands (x - a)^m f as a Taylor series and shifts.
 * @param {Expr|string} expr
 * @param {string|Expr} [variable='x']
 * @param {Expr|string|number} [about=0]
 * @param {number} [order=3] highest power of (x - a) to keep
 * @returns {LaurentResult}
 */
export function laurent(expr, variable = 'x', about = 0, order = 3) {
  const x = varName(variable);
  const a = simplify(ensureExpr(about));
  const f = tidy(simplify(ensureExpr(expr)), x);
  const X = sym(x);
  const shift = isZeroExpr(a) ? X : simplify(add(X, mul(num(-1), a)));
  const steps = [makeStep(f, 'Laurent series about ' + x + ' = ' + toLatex(a))];
  let ps;
  try {
    ps = powerSeries(f, x, a, order);
  } catch (err) {
    if (!(err instanceof MathError)) throw err;
    return { ok: false, reason: 'No Laurent expansion with a pole here (' + err.message + ')', steps: linkSteps(steps) };
  }
  const m = Math.max(0, -ps.v);
  const terms = [];
  ps.c.forEach((c, i) => {
    if (!isZeroExpr(c)) terms.push({ power: ps.v + i, coefficient: c });
  });
  if (m > 0) {
    const g = simplify(mul(pow(shift, num(m)), f));
    steps.push(makeStep(g, 'Multiply by (' + toLatex(shift) + ')^{' + m + '} to remove the pole', { note: 'Pole of order ' + m }));
  }
  const piece = (tt) => seriesTerm(tt.coefficient, shift, tt.power);
  const series = add(...terms.map(piece));
  const principal = terms.filter((tt) => tt.power < 0);
  const res = terms.find((tt) => tt.power === -1);
  steps.push(makeStep(series, m > 0 ? 'Expand and divide by (' + toLatex(shift) + ')^{' + m + '}' : 'Expand (no pole: this is the Taylor series)'));
  return {
    ok: true, poleOrder: m, terms, principalPart: principal.length ? simplify(add(...principal.map(piece))) : num(0),
    residue: res ? res.coefficient : num(0), series: simplify(series), latex: toLatex(series), steps: linkSteps(steps),
  };
}
