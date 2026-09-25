/**
 * Scalars for linear algebra: exact rationals, exact quadratic surds
 * a + b sqrt(d) (d may be negative, which gives exact complex numbers such as
 * Gaussian rationals), floating-point reals and floating-point complex
 * numbers. Arithmetic promotes along Rational -> Surd -> number -> Complex,
 * so a matrix stays exact whenever its entries allow it.
 * @module math/scalar
 */
import { Rational, R0, R1 } from './rational.js';
import { Complex } from './complex.js';
import { num, add, mul, pow, constant } from './expr.js';
import { simplify } from './simplify.js';
import { toLatex } from './latex.js';

/** Exact a + b sqrt(d) with rational a, b and square-free integer d. */
export class Surd {
  /**
   * @param {Rational} a
   * @param {Rational} b
   * @param {bigint} d square-free, not 0 or 1
   */
  constructor(a, b, d) {
    /** @type {Rational} */
    this.a = a;
    /** @type {Rational} */
    this.b = b;
    /** @type {bigint} */
    this.d = d;
  }

  /**
   * Build p + q sqrt(n) for any integer n, extracting square factors.
   * Returns a Rational when the radical part vanishes.
   * @param {Rational} p
   * @param {Rational} q
   * @param {bigint} n
   * @returns {Surd|Rational}
   */
  static make(p, q, n) {
    if (q.isZero() || n === 0n) return p;
    let sign = 1n;
    let m = n;
    if (m < 0n) {
      sign = -1n;
      m = -m;
    }
    let outside = 1n;
    for (let f = 2n; f * f <= m; f++) {
      while (m % (f * f) === 0n) {
        m /= f * f;
        outside *= f;
      }
    }
    const coeff = q.mul(new Rational(outside));
    if (m === 1n && sign === 1n) return p.add(coeff);
    return new Surd(p, coeff, sign * m);
  }
}

/**
 * @typedef {Rational|Surd|number|Complex} Scalar
 */

function level(x) {
  if (x instanceof Rational) return 0;
  if (x instanceof Surd) return 1;
  if (typeof x === 'number') return 2;
  return 3;
}

function toNumber(x) {
  if (x instanceof Rational) return x.toNumber();
  if (x instanceof Surd) {
    if (x.d < 0n) return NaN;
    return x.a.toNumber() + x.b.toNumber() * Math.sqrt(Number(x.d));
  }
  return x;
}

function toComplex(x) {
  if (x instanceof Complex) return x;
  if (x instanceof Surd && x.d < 0n) return new Complex(x.a.toNumber(), x.b.toNumber() * Math.sqrt(Number(-x.d)));
  return new Complex(toNumber(x), 0);
}

function asSurd(x, d) {
  return x instanceof Surd ? x : new Surd(x, R0, d);
}

function surdReduce(a, b, d) {
  return b.isZero() ? a : new Surd(a, b, d);
}

// Bring two scalars to a common representation.
function unify(x, y) {
  const lx = level(x);
  const ly = level(y);
  if (lx === 0 && ly === 0) return ['q', x, y];
  if (lx <= 1 && ly <= 1) {
    const d = x instanceof Surd ? x.d : y.d;
    if ((x instanceof Surd && y instanceof Surd && x.d !== y.d)) return promoteFloat(x, y);
    return ['s', asSurd(x, d), asSurd(y, d)];
  }
  return promoteFloat(x, y);
}

function promoteFloat(x, y) {
  const complex = x instanceof Complex || y instanceof Complex || (x instanceof Surd && x.d < 0n) || (y instanceof Surd && y.d < 0n);
  if (complex) return ['c', toComplex(x), toComplex(y)];
  return ['f', toNumber(x), toNumber(y)];
}

/** Scalar arithmetic that dispatches on the representation. */
export const F = {
  /** @param {Scalar} x @param {Scalar} y @returns {Scalar} */
  add(x, y) {
    const [k, a, b] = unify(x, y);
    if (k === 'q') return a.add(b);
    if (k === 's') return surdReduce(a.a.add(b.a), a.b.add(b.b), a.d);
    if (k === 'f') return a + b;
    return a.add(b);
  },
  /** @param {Scalar} x @param {Scalar} y @returns {Scalar} */
  sub(x, y) {
    return F.add(x, F.neg(y));
  },
  /** @param {Scalar} x @param {Scalar} y @returns {Scalar} */
  mul(x, y) {
    const [k, a, b] = unify(x, y);
    if (k === 'q') return a.mul(b);
    if (k === 's') {
      const d = new Rational(a.d);
      return surdReduce(a.a.mul(b.a).add(a.b.mul(b.b).mul(d)), a.a.mul(b.b).add(a.b.mul(b.a)), a.d);
    }
    if (k === 'f') return a * b;
    return a.mul(b);
  },
  /** @param {Scalar} x @param {Scalar} y @returns {Scalar} */
  div(x, y) {
    return F.mul(x, F.inv(y));
  },
  /** @param {Scalar} x @returns {Scalar} */
  inv(x) {
    if (x instanceof Rational) return x.inv();
    if (x instanceof Surd) {
      const norm = x.a.mul(x.a).sub(x.b.mul(x.b).mul(new Rational(x.d)));
      return surdReduce(x.a.div(norm), x.b.neg().div(norm), x.d);
    }
    if (typeof x === 'number') return 1 / x;
    return new Complex(1, 0).div(x);
  },
  /** @param {Scalar} x @returns {Scalar} */
  neg(x) {
    if (x instanceof Rational) return x.neg();
    if (x instanceof Surd) return new Surd(x.a.neg(), x.b.neg(), x.d);
    if (typeof x === 'number') return -x;
    return x.neg();
  },
  /**
   * @param {Scalar} x
   * @param {number} [tol=0] absolute tolerance for floating values
   * @returns {boolean}
   */
  isZero(x, tol = 0) {
    if (x instanceof Rational) return x.isZero();
    if (x instanceof Surd) return x.a.isZero() && x.b.isZero();
    if (typeof x === 'number') return Math.abs(x) <= tol;
    return x.abs() <= tol;
  },
  /** @param {Scalar} x @returns {number} magnitude, for pivot choice */
  magnitude(x) {
    if (x instanceof Complex) return x.abs();
    if (x instanceof Surd && x.d < 0n) return toComplex(x).abs();
    return Math.abs(toNumber(x));
  },
  /** @param {Scalar} x @returns {boolean} true for Rational and Surd */
  isExact(x) {
    return x instanceof Rational || x instanceof Surd;
  },
  /** @param {Scalar} x @returns {Complex} */
  toComplex,
  /** @param {Scalar} x @returns {number} real value (NaN for non-real exact surds) */
  toNumber(x) {
    if (x instanceof Complex) return x.isReal(1e-12) ? x.re : NaN;
    return toNumber(x);
  },
  /** @param {Scalar} x @returns {Scalar} complex conjugate */
  conj(x) {
    if (x instanceof Complex) return x.conj();
    if (x instanceof Surd && x.d < 0n) return new Surd(x.a, x.b.neg(), x.d);
    return x;
  },
  /** @param {Scalar} x @param {Scalar} y @returns {boolean} exact or 1e-9 relative equality */
  eq(x, y) {
    const d = F.sub(x, y);
    if (F.isExact(d)) return F.isZero(d);
    return F.magnitude(d) <= 1e-9 * (1 + F.magnitude(x) + F.magnitude(y));
  },
};

/**
 * Coerce a JavaScript value to a scalar: integers and numeric strings such as
 * "3/4" become Rationals, other numbers stay floating, {re, im} or [re, im]
 * become Complex.
 * @param {number|string|bigint|Scalar|{re: number, im: number}} v
 * @returns {Scalar}
 */
export function toScalar(v) {
  if (v instanceof Rational || v instanceof Surd || v instanceof Complex) return v;
  if (typeof v === 'bigint') return new Rational(v);
  if (typeof v === 'number') return Number.isInteger(v) ? new Rational(BigInt(v)) : v;
  if (typeof v === 'string') return Rational.from(v);
  if (v && typeof v === 'object') return Complex.from(v);
  throw new TypeError('Cannot use ' + String(v) + ' as a matrix entry');
}

/**
 * Expression form of a scalar (for LaTeX output).
 * @param {Scalar} x
 * @returns {import('./expr.js').Expr}
 */
export function scalarToExpr(x) {
  if (x instanceof Rational) return num(x);
  if (x instanceof Surd) return simplify(add(num(x.a), mul(num(x.b), pow(num(x.d), num('1/2')))));
  if (typeof x === 'number') return num(Rational.from(roundFloat(x)));
  const re = roundFloat(x.re);
  const im = roundFloat(x.im);
  return simplify(add(num(Rational.from(re)), mul(num(Rational.from(im)), constant('i'))));
}

function roundFloat(v) {
  if (!Number.isFinite(v)) return 0;
  if (Math.abs(v) < 1e-12) return 0;
  return Number(v.toPrecision(6));
}

/**
 * LaTeX for a scalar; floats use six significant digits.
 * @param {Scalar} x
 * @returns {string}
 */
export function scalarLatex(x) {
  if (typeof x === 'number') return formatFloat(x);
  if (x instanceof Complex) {
    const re = formatFloat(x.re);
    const imAbs = formatFloat(Math.abs(x.im));
    if (Math.abs(x.im) < 1e-12) return re;
    if (Math.abs(x.re) < 1e-12) return (x.im < 0 ? '-' : '') + imAbs + 'i';
    return re + (x.im < 0 ? ' - ' : ' + ') + imAbs + 'i';
  }
  return toLatex(scalarToExpr(x));
}

function formatFloat(v) {
  if (Math.abs(v) < 1e-12) return '0';
  const s = String(Number(v.toPrecision(6)));
  if (s.includes('e')) {
    const [m, e] = s.split('e');
    return m + ' \\times 10^{' + Number(e) + '}';
  }
  return s;
}

/**
 * Plain square-free part helper: sqrt of a non-negative rational as a scalar
 * (exact when possible).
 * @param {Rational} r
 * @returns {Scalar}
 */
export function sqrtRational(r) {
  return Surd.make(R0, R1.div(new Rational(r.d)), r.n * r.d);
}

