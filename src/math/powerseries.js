/**
 * Truncated power series with exact expression coefficients, used for
 * Taylor and Laurent expansions where differentiating and substituting
 * would hit a removable singularity or a pole. A series is
 * t^v (c0 + c1 t + c2 t^2 + ...) known exactly up to absolute power `prec`,
 * where t = x - a.
 * @module math/powerseries
 */
import { Rational } from './rational.js';
import { num, add, mul, pow, fn, constant, freeOf, MathError } from './expr.js';
import { simplify } from './simplify.js';

/** @typedef {import('./expr.js').Expr} Expr */

/**
 * @typedef {object} PSeries
 * @property {number} v valuation (power of t of the first coefficient)
 * @property {Expr[]} c coefficients
 * @property {number} prec terms up to t^prec are exact
 */

const isZ = (e) => e.type === 'num' && e.value.isZero();
const S = (e) => simplify(e);

function normalize(s) {
  let { v, c } = s;
  let i = 0;
  while (i < c.length && isZ(c[i])) i++;
  c = c.slice(i);
  v += i;
  const keep = Math.max(0, s.prec - v + 1);
  return { v, c: c.slice(0, keep), prec: s.prec };
}

function coeffAt(s, p) {
  const i = p - s.v;
  return i >= 0 && i < s.c.length ? s.c[i] : num(0);
}

function sConst(e, prec) {
  return normalize({ v: 0, c: [S(e)], prec });
}

function sAdd(a, b) {
  const prec = Math.min(a.prec, b.prec);
  const v = Math.min(a.v, b.v);
  const c = [];
  for (let p = v; p <= prec; p++) c.push(S(add(coeffAt(a, p), coeffAt(b, p))));
  return normalize({ v, c, prec });
}

function sScale(a, k) {
  return normalize({ v: a.v, c: a.c.map((x) => S(mul(k, x))), prec: a.prec });
}

function sMul(a, b) {
  if (!a.c.length) return { v: a.v + b.v, c: [], prec: Math.min(a.prec + b.v, b.prec + a.v) };
  if (!b.c.length) return { v: a.v + b.v, c: [], prec: Math.min(a.prec + b.v, b.prec + a.v) };
  const prec = Math.min(a.prec + b.v, b.prec + a.v);
  const v = a.v + b.v;
  const c = [];
  for (let p = v; p <= prec; p++) {
    const terms = [];
    for (let i = 0; i < a.c.length; i++) {
      const j = p - v - i;
      if (j >= 0 && j < b.c.length) terms.push(mul(a.c[i], b.c[j]));
    }
    c.push(S(add(...terms)));
  }
  return normalize({ v, c, prec });
}

function sInv(a) {
  if (!a.c.length) throw new MathError('Series division by zero');
  const rel = a.prec - a.v;
  const c0inv = S(pow(a.c[0], num(-1)));
  const out = [c0inv];
  for (let k = 1; k <= rel; k++) {
    const terms = [];
    for (let i = 1; i <= k && i < a.c.length; i++) terms.push(mul(a.c[i], out[k - i]));
    out.push(S(mul(num(-1), c0inv, add(...terms))));
  }
  return normalize({ v: -a.v, c: out, prec: -a.v + rel });
}

function sPowInt(a, n) {
  if (n === 0) return sConst(num(1), a.prec - a.v);
  let base = n < 0 ? sInv(a) : a;
  let k = Math.abs(n);
  let acc = null;
  while (k > 0) {
    if (k & 1) acc = acc ? sMul(acc, base) : base;
    k >>= 1;
    if (k) base = sMul(base, base);
  }
  return acc;
}

// Apply sum_k coef(k) r^k where r has positive valuation.
function compose(r, coef, prec) {
  let acc = sConst(coef(0), prec);
  let power = sConst(num(1), prec);
  for (let k = 1; k <= prec; k++) {
    power = sMul(power, r);
    if (power.v > prec) break;
    const ck = coef(k);
    if (!isZ(ck)) acc = sAdd(acc, sScale(power, ck));
  }
  return acc;
}

function factorial(k) {
  let r = 1n;
  for (let i = 2n; i <= BigInt(k); i++) r *= i;
  return new Rational(r);
}

// Split s (valuation 0) into its constant term and the rest.
function splitConst(s) {
  if (s.v < 0) throw new MathError('Function of a series with a pole');
  const c0 = s.v === 0 && s.c.length ? s.c[0] : num(0);
  const rest = sAdd(s, sConst(S(mul(num(-1), c0)), s.prec));
  return [c0, rest];
}

function sExp(s) {
  const [c0, r] = splitConst(s);
  const e = compose(r, (k) => num(factorial(k).inv()), s.prec);
  return sScale(e, S(pow(constant('e'), c0)));
}

function sinCosOf(r, prec) {
  const sinR = compose(r, (k) => (k % 2 === 1 ? num(factorial(k).inv().mul(Rational.from(k % 4 === 1 ? 1 : -1))) : num(0)), prec);
  const cosR = compose(r, (k) => (k % 2 === 0 ? num(factorial(k).inv().mul(Rational.from(k % 4 === 0 ? 1 : -1))) : num(0)), prec);
  return [sinR, cosR];
}

function sSinCos(s, which) {
  const [c0, r] = splitConst(s);
  const [sr, cr] = sinCosOf(r, s.prec);
  const sc = S(fn('sin', c0));
  const cc = S(fn('cos', c0));
  if (which === 'sin') return sAdd(sScale(cr, sc), sScale(sr, cc));
  return sAdd(sScale(cr, cc), sScale(sr, S(mul(num(-1), sc))));
}

function sLn(s) {
  const [c0, r] = splitConst(s);
  if (isZ(c0)) throw new MathError('Logarithmic singularity');
  const q = sScale(r, S(pow(c0, num(-1))));
  const l = compose(q, (k) => (k === 0 ? num(0) : num(new Rational(k % 2 === 1 ? 1n : -1n, BigInt(k)))), s.prec);
  return sAdd(l, sConst(S(fn('ln', c0)), s.prec));
}

function sPowRational(s, r) {
  if (r.isInteger()) return sPowInt(s, Number(r.n));
  const vr = new Rational(BigInt(s.v)).mul(r);
  if (!vr.isInteger()) throw new MathError('Branch point: fractional power of a series with odd valuation');
  const c0 = s.c[0];
  const unit = sScale({ v: 0, c: s.c, prec: s.prec - s.v }, S(pow(c0, num(-1))));
  const [, rest] = splitConst(unit);
  const binom = (k) => {
    let out = new Rational(1n);
    for (let i = 0; i < k; i++) out = out.mul(r.sub(Rational.from(i))).div(Rational.from(i + 1));
    return num(out);
  };
  const b = compose(rest, binom, unit.prec);
  const scaled = sScale(b, S(pow(c0, num(r))));
  const vi = Number(vr.n);
  return normalize({ v: scaled.v + vi, c: scaled.c, prec: scaled.prec + vi });
}

function sDeriv(s) {
  const c = s.c.map((ci, i) => S(mul(num(s.v + i), ci)));
  return normalize({ v: s.v - 1, c, prec: s.prec - 1 });
}

function sIntegrate(s, c0) {
  if (!isZ(coeffAt(s, -1))) throw new MathError('Series integral produces a logarithm');
  if (s.v < -1) throw new MathError('Series integral of a pole');
  const c = [c0];
  for (let p = 1; p <= s.prec + 1; p++) c.push(S(mul(coeffAt(s, p - 1), num(new Rational(1n, BigInt(p))))));
  return normalize({ v: 0, c, prec: s.prec + 1 });
}

function viaDerivative(s, name) {
  const [c0] = splitConst(s);
  const ds = sDeriv(s);
  let inner;
  if (name === 'atan') inner = sInv(sAdd(sConst(num(1), s.prec), sMul(s, s)));
  else {
    const q = sAdd(sConst(num(1), s.prec), sScale(sMul(s, s), num(-1)));
    inner = sPowRational(q, Rational.from('-1/2'));
    if (name === 'acos') inner = sScale(inner, num(-1));
  }
  return sIntegrate(sMul(ds, inner), S(fn(name, c0)));
}

/**
 * Power series of expr in t = x - a, exact through t^order (terms of
 * negative power included for poles).
 * @param {Expr} expr simplified expression
 * @param {string} x
 * @param {Expr} a expansion point
 * @param {number} order
 * @returns {PSeries}
 */
export function powerSeries(expr, x, a, order) {
  for (let margin = 4; margin <= 24; margin += 10) {
    const prec = order + margin;
    const s = build(expr, x, a, prec);
    if (s.prec >= order) return { ...s, c: s.c.slice(0, Math.max(0, order - s.v + 1)), prec: order };
  }
  throw new MathError('Series lost too much precision');
}

function build(e, x, a, prec) {
  if (freeOf(e, x)) return sConst(e, prec);
  switch (e.type) {
    case 'sym': return normalize({ v: 0, c: [a, num(1)], prec });
    case 'add': return e.args.map((t) => build(t, x, a, prec)).reduce(sAdd);
    case 'mul': return e.args.map((t) => build(t, x, a, prec)).reduce(sMul);
    case 'pow': {
      const [b, ex] = e.args;
      if (ex.type === 'num') return sPowRational(build(b, x, a, prec), ex.value);
      if (b.type === 'const' && b.name === 'e') return sExp(build(ex, x, a, prec));
      return sExp(build(S(mul(ex, fn('ln', b))), x, a, prec));
    }
    case 'fn': {
      const inner = () => build(e.args[0], x, a, prec);
      switch (e.name) {
        case 'sin': case 'cos': return sSinCos(inner(), e.name);
        case 'tan': return sMul(sSinCos(inner(), 'sin'), sInv(sSinCos(inner(), 'cos')));
        case 'sec': return sInv(sSinCos(inner(), 'cos'));
        case 'csc': return sInv(sSinCos(inner(), 'sin'));
        case 'cot': return sMul(sSinCos(inner(), 'cos'), sInv(sSinCos(inner(), 'sin')));
        case 'exp': return sExp(inner());
        case 'ln': return sLn(inner());
        case 'log': return sScale(sLn(inner()), S(pow(fn('ln', e.args[1] || num(10)), num(-1))));
        case 'sinh': case 'cosh': {
          const p = sExp(inner());
          const m = sExp(sScale(inner(), num(-1)));
          return sScale(sAdd(p, e.name === 'sinh' ? sScale(m, num(-1)) : m), num('1/2'));
        }
        case 'tanh': {
          const p = sExp(inner());
          const m = sExp(sScale(inner(), num(-1)));
          return sMul(sAdd(p, sScale(m, num(-1))), sInv(sAdd(p, m)));
        }
        case 'sqrt': return sPowRational(inner(), Rational.from('1/2'));
        case 'atan': case 'asin': case 'acos': return viaDerivative(inner(), e.name);
        default: throw new MathError('No series for ' + e.name);
      }
    }
    default: throw new MathError('No series for a ' + e.type + ' node');
  }
}

