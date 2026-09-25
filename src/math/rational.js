/**
 * Exact rational numbers backed by BigInt. Every symbolic computation in the
 * math engine uses these so that 1/3 + 1/6 is exactly 1/2.
 * @module math/rational
 */

/**
 * Greatest common divisor of two BigInts (always non-negative).
 * @param {bigint} a
 * @param {bigint} b
 * @returns {bigint}
 */
export function bigGcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/**
 * Integer k-th root of a non-negative BigInt, rounded down.
 * @param {bigint} n
 * @param {number} k
 * @returns {bigint}
 */
export function bigIntRoot(n, k) {
  if (n < 0n) throw new RangeError('bigIntRoot needs a non-negative integer');
  if (n < 2n) return n;
  const K = BigInt(k);
  let x = BigInt(Math.floor(Math.pow(Number(n), 1 / k))) + 1n;
  if (x < 1n) x = 1n;
  for (;;) {
    const y = ((K - 1n) * x + n / x ** (K - 1n)) / K;
    if (y >= x) break;
    x = y;
  }
  while (x ** K > n) x -= 1n;
  while ((x + 1n) ** K <= n) x += 1n;
  return x;
}

/**
 * An exact rational number n/d with d > 0 and gcd(n, d) = 1.
 */
export class Rational {
  /**
   * @param {bigint} n numerator
   * @param {bigint} [d=1n] denominator (non-zero)
   */
  constructor(n, d = 1n) {
    if (d === 0n) throw new RangeError('Division by zero');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = bigGcd(n, d);
    /** @type {bigint} */
    this.n = g > 1n ? n / g : n;
    /** @type {bigint} */
    this.d = g > 1n ? d / g : d;
  }

  /**
   * Build a rational from a number, BigInt, decimal string ("0.25", "-3/4",
   * "1e-3") or another Rational. Non-integer numbers are converted exactly
   * from their binary value only when they are dyadic with small exponent;
   * otherwise the shortest decimal representation is used.
   * @param {number|bigint|string|Rational} v
   * @returns {Rational}
   */
  static from(v) {
    if (v instanceof Rational) return v;
    if (typeof v === 'bigint') return new Rational(v, 1n);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new RangeError('Cannot make a rational from ' + v);
      if (Number.isInteger(v)) return new Rational(BigInt(v), 1n);
      return Rational.from(String(v));
    }
    const s = String(v).trim();
    const slash = s.indexOf('/');
    if (slash >= 0) {
      return Rational.from(s.slice(0, slash)).div(Rational.from(s.slice(slash + 1)));
    }
    const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) {
      throw new SyntaxError('Not a number: ' + s);
    }
    const sign = m[1] === '-' ? -1n : 1n;
    const intPart = m[2] || '0';
    const frac = m[3] || '';
    const exp = m[4] ? parseInt(m[4], 10) : 0;
    let n = BigInt(intPart + frac) * sign;
    let d = 10n ** BigInt(frac.length);
    if (exp > 0) n *= 10n ** BigInt(exp);
    else if (exp < 0) d *= 10n ** BigInt(-exp);
    return new Rational(n, d);
  }

  /** @returns {boolean} */
  isZero() {
    return this.n === 0n;
  }

  /** @returns {boolean} */
  isOne() {
    return this.n === 1n && this.d === 1n;
  }

  /** @returns {boolean} */
  isInteger() {
    return this.d === 1n;
  }

  /** @returns {boolean} */
  isNegative() {
    return this.n < 0n;
  }

  /** @returns {number} -1, 0 or 1 */
  sign() {
    return this.n > 0n ? 1 : this.n < 0n ? -1 : 0;
  }

  /**
   * @param {Rational} b
   * @returns {Rational}
   */
  add(b) {
    if (this.d === b.d) return new Rational(this.n + b.n, this.d);
    return new Rational(this.n * b.d + b.n * this.d, this.d * b.d);
  }

  /**
   * @param {Rational} b
   * @returns {Rational}
   */
  sub(b) {
    return this.add(b.neg());
  }

  /**
   * @param {Rational} b
   * @returns {Rational}
   */
  mul(b) {
    return new Rational(this.n * b.n, this.d * b.d);
  }

  /**
   * @param {Rational} b
   * @returns {Rational}
   */
  div(b) {
    if (b.n === 0n) throw new RangeError('Division by zero');
    return new Rational(this.n * b.d, this.d * b.n);
  }

  /** @returns {Rational} */
  neg() {
    return new Rational(-this.n, this.d);
  }

  /** @returns {Rational} */
  inv() {
    if (this.n === 0n) throw new RangeError('Division by zero');
    return new Rational(this.d, this.n);
  }

  /** @returns {Rational} */
  abs() {
    return this.n < 0n ? this.neg() : this;
  }

  /**
   * Integer power.
   * @param {number|bigint} k
   * @returns {Rational}
   */
  pow(k) {
    const e = BigInt(k);
    if (e >= 0n) return new Rational(this.n ** e, this.d ** e);
    if (this.n === 0n) throw new RangeError('Division by zero');
    return new Rational(this.d ** -e, this.n ** -e);
  }

  /**
   * Compare with another rational.
   * @param {Rational} b
   * @returns {number} negative, zero or positive
   */
  cmp(b) {
    const l = this.n * b.d;
    const r = b.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }

  /**
   * @param {Rational} b
   * @returns {boolean}
   */
  eq(b) {
    return this.n === b.n && this.d === b.d;
  }

  /** @returns {bigint} largest integer not above this value */
  floor() {
    const q = this.n / this.d;
    return this.n < 0n && q * this.d !== this.n ? q - 1n : q;
  }

  /** @returns {number} nearest double */
  toNumber() {
    const n = this.n;
    const d = this.d;
    const an = n < 0n ? -n : n;
    if (an < 2n ** 1000n && d < 2n ** 1000n) {
      const v = Number(n) / Number(d);
      if (Number.isFinite(v) && v !== 0) return v;
      if (n === 0n) return 0;
    }
    const scale = an.toString(2).length - d.toString(2).length - 64;
    const q = scale > 0 ? n / (d << BigInt(scale)) : (n << BigInt(-scale)) / d;
    return Number(q) * Math.pow(2, scale);
  }

  /** @returns {string} e.g. "-3/4" or "5" */
  toString() {
    return this.d === 1n ? this.n.toString() : this.n + '/' + this.d;
  }
}

/** The rational 0. */
export const R0 = new Rational(0n);
/** The rational 1. */
export const R1 = new Rational(1n);
/** The rational -1. */
export const RM1 = new Rational(-1n);
/** The rational 1/2. */
export const RHALF = new Rational(1n, 2n);

/**
 * Best rational approximation of a real number with denominator at most
 * maxDen, found from its continued fraction convergents and semiconvergents.
 * @param {number} x
 * @param {number} [maxDen=1000000]
 * @returns {Rational}
 */
export function bestRational(x, maxDen = 1000000) {
  if (!Number.isFinite(x)) throw new RangeError('Cannot approximate ' + x);
  const sign = x < 0 ? -1n : 1n;
  let v = Math.abs(x);
  let p0 = 0n, q0 = 1n, p1 = 1n, q1 = 0n;
  const M = BigInt(maxDen);
  for (let iter = 0; iter < 64; iter++) {
    const a = BigInt(Math.floor(v));
    const p2 = a * p1 + p0;
    const q2 = a * q1 + q0;
    if (q2 > M) {
      const k = (M - q0) / q1;
      const ps = k * p1 + p0;
      const qs = k * q1 + q0;
      const r1 = new Rational(p1, q1);
      if (qs > 0n) {
        const rs = new Rational(ps, qs);
        const target = Math.abs(x);
        if (Math.abs(rs.toNumber() - target) < Math.abs(r1.toNumber() - target)) return sign < 0n ? rs.neg() : rs;
      }
      return sign < 0n ? r1.neg() : r1;
    }
    p0 = p1; q0 = q1; p1 = p2; q1 = q2;
    const frac = v - Math.floor(v);
    if (frac < 1e-15) break;
    v = 1 / frac;
    if (Math.abs(Number(p1) / Number(q1) - Math.abs(x)) <= 1e-16 * Math.abs(x)) break;
  }
  const r = new Rational(p1, q1);
  return sign < 0n ? r.neg() : r;
}
