/**
 * Self-contained seeded random numbers for the math engine: xoshiro128**
 * seeded through splitmix32, with uniform, normal, gamma, beta, binomial and
 * Poisson variates. Separate from the core scene RNG so statistical sampling
 * never shifts the random sequence of a scene.
 * @module math/random
 */
import { gammaQ, lnGamma, betaI } from './special.js';

function splitmix32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

function rotl(x, k) {
  return (x << k) | (x >>> (32 - k));
}

function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded xoshiro128** generator. */
export class SeededRandom {
  /** @param {number|string} [seed=1] */
  constructor(seed = 1) {
    const sm = splitmix32(typeof seed === 'number' ? seed : hashString(String(seed)));
    /** @type {Uint32Array} */
    this.s = new Uint32Array([sm(), sm(), sm(), sm()]);
    if (!this.s.some((v) => v !== 0)) this.s[0] = 1;
    this.spare = null;
  }

  /** @returns {number} uniform 32-bit unsigned integer */
  nextU32() {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** @returns {number} uniform in [0, 1) with 53 random bits */
  next() {
    const hi = this.nextU32() >>> 5;
    const lo = this.nextU32() >>> 6;
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /**
   * Uniform in [a, b).
   * @param {number} a
   * @param {number} b
   * @returns {number}
   */
  uniform(a, b) {
    return a + (b - a) * this.next();
  }

  /**
   * Uniform integer in [a, b] (inclusive).
   * @param {number} a
   * @param {number} b
   * @returns {number}
   */
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  /**
   * Normal variate (Marsaglia polar method).
   * @param {number} [mu=0]
   * @param {number} [sigma=1]
   * @returns {number}
   */
  normal(mu = 0, sigma = 1) {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return mu + sigma * v;
    }
    let u;
    let v;
    let s;
    do {
      u = 2 * this.next() - 1;
      v = 2 * this.next() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * m;
    return mu + sigma * u * m;
  }

  /**
   * Exponential variate with rate lambda.
   * @param {number} [lambda=1]
   * @returns {number}
   */
  exponential(lambda = 1) {
    return -Math.log(1 - this.next()) / lambda;
  }

  /**
   * Gamma variate with shape k and scale theta (Marsaglia-Tsang).
   * @param {number} k
   * @param {number} [theta=1]
   * @returns {number}
   */
  gamma(k, theta = 1) {
    if (k < 1) return this.gamma(k + 1, theta) * Math.pow(this.next(), 1 / k);
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x;
      let v;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.next();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * theta;
    }
  }

  /**
   * Beta variate.
   * @param {number} a
   * @param {number} b
   * @returns {number}
   */
  beta(a, b) {
    const x = this.gamma(a);
    const y = this.gamma(b);
    return x / (x + y);
  }

  /**
   * Poisson variate (Knuth for small means, normal-corrected inversion by
   * search otherwise).
   * @param {number} lambda
   * @returns {number}
   */
  poisson(lambda) {
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= this.next();
      } while (p > L);
      return k - 1;
    }
    // Inversion by sequential search from the mode.
    const u = this.next();
    let k = Math.floor(lambda);
    let cdf = gammaQ(k + 1, lambda);
    let pk = Math.exp(-lambda + k * Math.log(lambda) - lnGamma(k + 1));
    if (u <= cdf) {
      while (k > 0 && u <= cdf - pk) {
        cdf -= pk;
        pk *= k / lambda;
        k--;
      }
      return k;
    }
    while (u > cdf) {
      k++;
      pk *= lambda / k;
      cdf += pk;
    }
    return k;
  }

  /**
   * Binomial variate (Bernoulli trials for small n, inversion from the mode
   * otherwise).
   * @param {number} n
   * @param {number} p
   * @returns {number}
   */
  binomial(n, p) {
    if (n <= 64) {
      let c = 0;
      for (let i = 0; i < n; i++) if (this.next() < p) c++;
      return c;
    }
    if (p <= 0) return 0;
    if (p >= 1) return n;
    // Inversion by sequential search from the mode.
    const u = this.next();
    let k = Math.floor((n + 1) * p);
    if (k > n) k = n;
    let cdf = k >= n ? 1 : betaI(1 - p, n - k, k + 1);
    let pk = Math.exp(lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p));
    const ratio = p / (1 - p);
    if (u <= cdf) {
      while (k > 0 && u <= cdf - pk) {
        cdf -= pk;
        pk *= k / ((n - k + 1) * ratio);
        k--;
      }
      return k;
    }
    while (u > cdf && k < n) {
      pk *= ((n - k) / (k + 1)) * ratio;
      k++;
      cdf += pk;
    }
    return k;
  }

  /**
   * Fisher-Yates shuffle (returns a new array).
   * @template T
   * @param {T[]} arr
   * @returns {T[]}
   */
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

