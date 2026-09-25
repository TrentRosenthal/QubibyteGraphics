/**
 * Presentation of values in interchangeable forms so a renderer can morph
 * between them: plain number, fixed decimals, fraction (best rational
 * approximation by continued fractions), radical (a/b + c sqrt(d)/e and
 * rational multiples of pi, which covers values like sqrt(3)/2), scientific
 * notation, symbolic (from an exact expression), and percent.
 * @module math/format
 */
import { Rational, bestRational } from './rational.js';
import { num, add, mul, pow, constant } from './expr.js';
import { simplify } from './simplify.js';
import { toLatex, toText } from './latex.js';
import { ensureExpr } from './parse.js';
import { compileReal } from './evaluate.js';

/** @typedef {import('./expr.js').Expr} Expr */

/**
 * @typedef {object} FormattedValue
 * @property {string} latex
 * @property {string} text
 * @property {boolean} exact false when the form is an approximation of the value
 * @property {Expr} [expr] exact expression when one was recognised
 */

const SQUARE_FREE = [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23, 26, 29, 30, 31];

function toNumber(x) {
  if (typeof x === 'number') return x;
  if (x instanceof Rational) return x.toNumber();
  return compileReal(ensureExpr(x), [])();
}

function trimNumber(v, digits = 10) {
  if (!Number.isFinite(v)) return v > 0 ? '\\infty' : v < 0 ? '-\\infty' : 'NaN';
  return String(Number(v.toPrecision(digits)));
}

/**
 * Recognise x as a/b + (c/e) sqrt(d) or as a rational multiple of pi (with
 * small denominators), checked to 1e-12 relative accuracy.
 * @param {number} x
 * @param {{maxDen?: number}} [opts]
 * @returns {Expr|null}
 */
export function recognizeRadical(x, opts = {}) {
  const maxDen = opts.maxDen ?? 12;
  const tol = 1e-12 * Math.max(1, Math.abs(x));
  const close = (r, target) => Math.abs(r.toNumber() - target) <= tol;
  const r0 = bestRational(x, maxDen * 10);
  if (close(r0, x)) return num(r0);
  const piRatio = bestRational(x / Math.PI, maxDen);
  if (close(piRatio, x / Math.PI) && !piRatio.isZero()) return simplify(mul(num(piRatio), constant('pi')));
  let best = null;
  let bestCost = Infinity;
  for (const d of SQUARE_FREE) {
    const sd = Math.sqrt(d);
    for (let e = 1; e <= maxDen; e++) {
      for (let c = -4 * e; c <= 4 * e; c++) {
        if (c === 0) continue;
        const q = new Rational(BigInt(c), BigInt(e));
        const rest = x - q.toNumber() * sd;
        const p = bestRational(rest, maxDen);
        if (Math.abs(p.toNumber() - rest) > tol) continue;
        const cost = Number(q.d) + Number(p.d) + Math.abs(Number(q.n)) + Math.abs(Number(p.n)) + d / 10;
        if (cost < bestCost) {
          bestCost = cost;
          best = simplify(add(num(p), mul(num(q), pow(num(d), num('1/2')))));
        }
      }
    }
    if (best) break;
  }
  return best;
}

function scientific(v, digits) {
  if (v === 0) return { latex: '0', text: '0' };
  const [m, e] = v.toExponential(digits - 1).split('e');
  const exp = Number(e);
  return { latex: m + ' \\times 10^{' + exp + '}', text: m + 'e' + exp };
}

/**
 * Format a value in the requested form.
 * @param {number|string|Rational|Expr} x a number, a Rational, or an exact expression (strings are parsed)
 * @param {'number'|'decimal'|'fraction'|'radical'|'scientific'|'symbolic'|'percent'} [form='number']
 * @param {{places?: number, digits?: number, tol?: number, maxDen?: number}} [opts]
 * @returns {FormattedValue}
 */
export function formatValue(x, form = 'number', opts = {}) {
  const isExpr = x && typeof x === 'object' && !(x instanceof Rational) && typeof x.type === 'string';
  const exprIn = isExpr ? simplify(x) : typeof x === 'string' ? simplify(ensureExpr(x)) : x instanceof Rational ? num(x) : null;
  const v = exprIn ? toNumber(exprIn) : x;
  switch (form) {
    case 'number': {
      const t = trimNumber(v, opts.digits ?? 10);
      return { latex: t, text: t, exact: exprIn ? exprIn.type === 'num' && Number(t) === v : true };
    }
    case 'decimal': {
      const places = opts.places ?? 2;
      const t = v.toFixed(places);
      return { latex: t, text: t, exact: Number(t) === v };
    }
    case 'fraction': {
      if (exprIn && exprIn.type === 'num') return { latex: toLatex(exprIn), text: toText(exprIn), exact: true, expr: exprIn };
      const tol = opts.tol ?? 1e-9;
      const r = bestRational(v, opts.maxDen ?? 10000);
      const err = Math.abs(r.toNumber() - v);
      if (err <= tol * Math.max(1, Math.abs(v))) {
        const e = num(r);
        return { latex: toLatex(e), text: toText(e), exact: err === 0, expr: e };
      }
      const t = trimNumber(v);
      return { latex: t, text: t, exact: false };
    }
    case 'radical': {
      const e = exprIn && isRadicalForm(exprIn) ? exprIn : recognizeRadical(v, opts);
      if (e) return { latex: toLatex(e), text: toText(e), exact: true, expr: e };
      const t = trimNumber(v);
      return { latex: t, text: t, exact: false };
    }
    case 'scientific': {
      const s = scientific(v, opts.digits ?? 4);
      return { ...s, exact: Number(s.text) === v };
    }
    case 'symbolic': {
      if (exprIn) return { latex: toLatex(exprIn), text: toText(exprIn), exact: true, expr: exprIn };
      const e = recognizeRadical(v, opts);
      if (e) return { latex: toLatex(e), text: toText(e), exact: true, expr: e };
      return formatValue(v, 'fraction', opts);
    }
    case 'percent': {
      const places = opts.places ?? 1;
      const t = (v * 100).toFixed(places);
      return { latex: t + '\\%', text: t + '%', exact: Number(t) === v * 100 };
    }
    default: throw new RangeError('Unknown form ' + form);
  }
}

function isRadicalForm(e) {
  if (e.type === 'num' || e.type === 'const') return true;
  if (e.type === 'pow') return e.args[0].type === 'num' && e.args[1].type === 'num';
  if (e.type === 'mul' || e.type === 'add') return e.args.every(isRadicalForm);
  return false;
}
