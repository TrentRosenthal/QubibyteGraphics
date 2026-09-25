/**
 * Special functions for numerics and statistics: gamma, log-gamma, beta,
 * error function, regularized incomplete gamma and beta functions, and the
 * complete elliptic integral of the first kind.
 * @module math/special
 */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/**
 * Natural log of |Gamma(x)| (Lanczos approximation, about 15 digits).
 * @param {number} x
 * @returns {number}
 */
export function lnGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Gamma function. Exact for small positive integers.
 * @param {number} x
 * @returns {number}
 */
export function gamma(x) {
  if (Number.isInteger(x)) {
    if (x <= 0) return NaN;
    if (x <= 171) {
      let r = 1;
      for (let i = 2; i < x; i++) r *= i;
      return r;
    }
    return Infinity;
  }
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  if (x > 171.6) return Infinity;
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

/**
 * Beta function B(a, b).
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function beta(a, b) {
  return Math.exp(lnGamma(a) + lnGamma(b) - lnGamma(a + b));
}

/**
 * Error function (relative accuracy about 1e-15 via series and continued fraction).
 * @param {number} x
 * @returns {number}
 */
export function erf(x) {
  if (x < 0) return -erf(-x);
  if (x < 2.5) {
    // Maclaurin series.
    let sum = x;
    let term = x;
    const x2 = x * x;
    for (let n = 1; n < 200; n++) {
      term *= -x2 / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return (2 / Math.sqrt(Math.PI)) * sum;
  }
  return 1 - erfc(x);
}

/**
 * Complementary error function 1 - erf(x), accurate in the tails.
 * @param {number} x
 * @returns {number}
 */
export function erfc(x) {
  if (x < 2.5) return 1 - erf(x);
  // Continued fraction (Lentz) for large x.
  const tiny = 1e-300;
  let f = tiny;
  let C = f;
  let D = 0;
  for (let n = 0; n < 500; n++) {
    const an = n === 0 ? 1 : n / 2;
    const bn = n === 0 ? x : x;
    D = bn + an * D;
    if (Math.abs(D) < tiny) D = tiny;
    C = bn + an / C;
    if (Math.abs(C) < tiny) C = tiny;
    D = 1 / D;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return (Math.exp(-x * x) / Math.sqrt(Math.PI)) * f;
}

/**
 * Regularized lower incomplete gamma P(a, x).
 * @param {number} a
 * @param {number} x
 * @returns {number}
 */
export function gammaP(a, x) {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    let ap = a;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  return 1 - gammaQ(a, x);
}

/**
 * Regularized upper incomplete gamma Q(a, x) = 1 - P(a, x).
 * @param {number} a
 * @param {number} x
 * @returns {number}
 */
export function gammaQ(a, x) {
  if (x < a + 1) return 1 - gammaP(a, x);
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

function betaContinuedFraction(a, b, x) {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}

/**
 * Regularized incomplete beta I_x(a, b).
 * @param {number} x in [0, 1]
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function betaI(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a;
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/**
 * Complete elliptic integral of the first kind K(k) with modulus k, via the
 * arithmetic-geometric mean: K = pi / (2 AGM(1, sqrt(1 - k^2))).
 * @param {number} k modulus, |k| < 1
 * @returns {number}
 */
export function ellipticK(k) {
  let a = 1;
  let b = Math.sqrt(1 - k * k);
  for (let i = 0; i < 60 && Math.abs(a - b) > 1e-16 * a; i++) {
    const an = (a + b) / 2;
    b = Math.sqrt(a * b);
    a = an;
  }
  return Math.PI / (2 * a);
}
