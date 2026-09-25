/**
 * Floating-point complex numbers with the elementary functions.
 *
 * Branch cuts (principal values, matching the usual conventions of C99 and
 * most CAS tools):
 * - `log`, `sqrt` and `pow` (z^w = exp(w log z)): cut along the negative real
 *   axis; arg is taken in (-pi, pi], so points on the cut take the value from
 *   the upper half plane.
 * - `asin`, `acos`: cuts on the real axis outside [-1, 1].
 *   asin z = -i log(iz + sqrt(1 - z^2)), acos z = pi/2 - asin z.
 * - `atan`: cuts on the imaginary axis outside [-i, i].
 *   atan z = (i/2) (log(1 - iz) - log(1 + iz)).
 * - The trig and hyperbolic functions and exp are entire (no cuts).
 * @module math/complex
 */

/** Complex number re + i im. */
export class Complex {
  /**
   * @param {number} re
   * @param {number} [im=0]
   */
  constructor(re, im = 0) {
    /** @type {number} */
    this.re = re;
    /** @type {number} */
    this.im = im;
  }

  /**
   * Coerce a number, [re, im] pair, {re, im} object or Complex.
   * @param {number|Complex|number[]|{re: number, im: number}} v
   * @returns {Complex}
   */
  static from(v) {
    if (v instanceof Complex) return v;
    if (typeof v === 'number') return new Complex(v, 0);
    if (Array.isArray(v)) return new Complex(v[0], v[1] || 0);
    if (v && typeof v.re === 'number') return new Complex(v.re, v.im || 0);
    throw new TypeError('Cannot make a complex number from ' + String(v));
  }

  /**
   * Build from polar form r e^(i theta).
   * @param {number} r
   * @param {number} theta
   * @returns {Complex}
   */
  static polar(r, theta) {
    return new Complex(r * Math.cos(theta), r * Math.sin(theta));
  }

  /** @param {Complex|number} b @returns {Complex} */
  add(b) {
    b = Complex.from(b);
    return new Complex(this.re + b.re, this.im + b.im);
  }

  /** @param {Complex|number} b @returns {Complex} */
  sub(b) {
    b = Complex.from(b);
    return new Complex(this.re - b.re, this.im - b.im);
  }

  /** @param {Complex|number} b @returns {Complex} */
  mul(b) {
    b = Complex.from(b);
    return new Complex(this.re * b.re - this.im * b.im, this.re * b.im + this.im * b.re);
  }

  /**
   * Division using Smith's algorithm to avoid overflow.
   * @param {Complex|number} b
   * @returns {Complex}
   */
  div(b) {
    b = Complex.from(b);
    if (b.im === 0) return new Complex(this.re / b.re, this.im / b.re);
    if (Math.abs(b.re) >= Math.abs(b.im)) {
      const r = b.im / b.re;
      const d = b.re + b.im * r;
      return new Complex((this.re + this.im * r) / d, (this.im - this.re * r) / d);
    }
    const r = b.re / b.im;
    const d = b.re * r + b.im;
    return new Complex((this.re * r + this.im) / d, (this.im * r - this.re) / d);
  }

  /** @returns {Complex} */
  neg() {
    return new Complex(-this.re, -this.im);
  }

  /** @returns {Complex} */
  conj() {
    return new Complex(this.re, -this.im);
  }

  /** @returns {number} modulus */
  abs() {
    return Math.hypot(this.re, this.im);
  }

  /** @returns {number} principal argument in (-pi, pi] */
  arg() {
    if (this.im === 0 && this.re < 0) return Math.PI;
    return Math.atan2(this.im, this.re);
  }

  /** @returns {Complex} */
  exp() {
    const m = Math.exp(this.re);
    if (this.im === 0) return new Complex(m, 0);
    return new Complex(m * Math.cos(this.im), m * Math.sin(this.im));
  }

  /** @returns {Complex} principal logarithm */
  log() {
    return new Complex(Math.log(this.abs()), this.arg());
  }

  /** @returns {Complex} principal square root */
  sqrt() {
    const r = this.abs();
    if (r === 0) return new Complex(0, 0);
    const t = Math.sqrt((r + Math.abs(this.re)) / 2);
    if (this.re >= 0) return new Complex(t, this.im / (2 * t));
    return new Complex(Math.abs(this.im) / (2 * t), this.im < 0 ? -t : t);
  }

  /**
   * Principal power exp(w log z). Integer exponents use repeated squaring.
   * @param {Complex|number} w
   * @returns {Complex}
   */
  pow(w) {
    w = Complex.from(w);
    if (w.im === 0 && Number.isInteger(w.re) && Math.abs(w.re) <= 64) {
      let n = Math.abs(w.re);
      let base = this;
      let acc = new Complex(1, 0);
      while (n > 0) {
        if (n & 1) acc = acc.mul(base);
        base = base.mul(base);
        n >>= 1;
      }
      return w.re < 0 ? new Complex(1, 0).div(acc) : acc;
    }
    if (this.re === 0 && this.im === 0) {
      if (w.re > 0) return new Complex(0, 0);
      return new Complex(NaN, NaN);
    }
    return w.mul(this.log()).exp();
  }

  /** @returns {Complex} */
  sin() {
    return new Complex(Math.sin(this.re) * Math.cosh(this.im), Math.cos(this.re) * Math.sinh(this.im));
  }

  /** @returns {Complex} */
  cos() {
    return new Complex(Math.cos(this.re) * Math.cosh(this.im), -Math.sin(this.re) * Math.sinh(this.im));
  }

  /** @returns {Complex} */
  tan() {
    return this.sin().div(this.cos());
  }

  /** @returns {Complex} */
  sec() {
    return new Complex(1, 0).div(this.cos());
  }

  /** @returns {Complex} */
  csc() {
    return new Complex(1, 0).div(this.sin());
  }

  /** @returns {Complex} */
  cot() {
    return this.cos().div(this.sin());
  }

  /** @returns {Complex} */
  sinh() {
    return new Complex(Math.sinh(this.re) * Math.cos(this.im), Math.cosh(this.re) * Math.sin(this.im));
  }

  /** @returns {Complex} */
  cosh() {
    return new Complex(Math.cosh(this.re) * Math.cos(this.im), Math.sinh(this.re) * Math.sin(this.im));
  }

  /** @returns {Complex} */
  tanh() {
    return this.sinh().div(this.cosh());
  }

  /** @returns {Complex} principal arcsine */
  asin() {
    if (this.im === 0 && Math.abs(this.re) <= 1) return new Complex(Math.asin(this.re), 0);
    const iz = new Complex(-this.im, this.re);
    const w = iz.add(new Complex(1, 0).sub(this.mul(this)).sqrt()).log();
    return new Complex(w.im, -w.re);
  }

  /** @returns {Complex} principal arccosine */
  acos() {
    if (this.im === 0 && Math.abs(this.re) <= 1) return new Complex(Math.acos(this.re), 0);
    return new Complex(Math.PI / 2, 0).sub(this.asin());
  }

  /** @returns {Complex} principal arctangent */
  atan() {
    if (this.im === 0) return new Complex(Math.atan(this.re), 0);
    const iz = new Complex(-this.im, this.re);
    const a = new Complex(1, 0).sub(iz).log();
    const b = new Complex(1, 0).add(iz).log();
    const d = a.sub(b);
    return new Complex(-d.im / 2, d.re / 2);
  }

  /**
   * @param {Complex|number} b
   * @param {number} [tol=1e-12]
   * @returns {boolean}
   */
  equals(b, tol = 1e-12) {
    b = Complex.from(b);
    return Math.abs(this.re - b.re) <= tol * (1 + Math.abs(b.re)) && Math.abs(this.im - b.im) <= tol * (1 + Math.abs(b.im));
  }

  /**
   * @param {number} [tol=1e-12]
   * @returns {boolean} true when the imaginary part is negligible
   */
  isReal(tol = 1e-12) {
    return Math.abs(this.im) <= tol * (1 + Math.abs(this.re));
  }

  /** @returns {string} e.g. "1.5 - 2i" */
  toString() {
    const fmt = (x) => String(Number(x.toPrecision(12)));
    if (this.im === 0) return fmt(this.re);
    const imAbs = Math.abs(this.im);
    const imStr = (imAbs === 1 ? '' : fmt(imAbs)) + 'i';
    if (this.re === 0) return (this.im < 0 ? '-' : '') + imStr;
    return fmt(this.re) + (this.im < 0 ? ' - ' : ' + ') + imStr;
  }
}

/**
 * The n-th roots of unity e^(2 pi i k / n), k = 0..n-1.
 * @param {number} n
 * @returns {Complex[]}
 */
export function rootsOfUnity(n) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive integer');
  const out = [];
  for (let k = 0; k < n; k++) out.push(Complex.polar(1, (2 * Math.PI * k) / n));
  return out;
}

/**
 * All n-th roots of a complex number, starting from the principal root.
 * @param {Complex|number} z
 * @param {number} n
 * @returns {Complex[]}
 */
export function nthRoots(z, n) {
  const c = Complex.from(z);
  const r = Math.pow(c.abs(), 1 / n);
  const th = c.arg();
  const out = [];
  for (let k = 0; k < n; k++) out.push(Complex.polar(r, (th + 2 * Math.PI * k) / n));
  return out;
}
