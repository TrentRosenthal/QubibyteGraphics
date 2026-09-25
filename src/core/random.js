/**
 * Seeded random numbers. Every random choice in the engine goes through this
 * module so that a scene rendered twice with the same seed is identical.
 * @module core/random
 */

/**
 * Hash a string or number into a 32-bit seed (FNV-1a).
 * @param {string|number} value
 * @returns {number}
 */
export function hashSeed(value) {
  const s = String(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function splitmix32(a) {
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

/**
 * xoshiro128** generator.
 */
export class Random {
  /** @param {string|number} [seed=1] */
  constructor(seed = 1) {
    const sm = splitmix32(typeof seed === 'number' ? seed >>> 0 : hashSeed(seed));
    this.s = new Uint32Array([sm(), sm(), sm(), sm()]);
  }

  /** @returns {number} Uniform integer in [0, 2^32). */
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

  /** @returns {number} Uniform float in [0, 1). */
  next() {
    return this.nextU32() / 4294967296;
  }

  /** Uniform float in [a, b). @param {number} a @param {number} b @returns {number} */
  range(a, b) {
    return a + (b - a) * this.next();
  }

  /** Uniform integer in [a, b]. @param {number} a @param {number} b @returns {number} */
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  /** Standard normal sample (Box-Muller). @returns {number} */
  normal(mean = 0, sd = 1) {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Pick one element. @template T @param {T[]} arr @returns {T} */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Derive an independent generator keyed by a label. @param {string|number} label @returns {Random} */
  fork(label) {
    return new Random((this.nextU32() ^ hashSeed(label)) >>> 0);
  }
}

function rotl(x, k) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * Smooth deterministic 1D value noise in [-1, 1], used for hand-drawn jitter.
 * @param {number} x
 * @param {number} seed
 * @returns {number}
 */
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const a = lattice(i, seed);
  const b = lattice(i + 1, seed);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

function lattice(i, seed) {
  let h = Math.imul(i ^ Math.imul(seed, 0x27d4eb2d), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/**
 * Smooth 2D value noise in [-1, 1].
 * @param {number} x @param {number} y @param {number} [seed=0]
 * @returns {number}
 */
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const v = (i, j) => lattice(i + Math.imul(j, 57721), seed);
  const a = v(xi, yi);
  const b = v(xi + 1, yi);
  const c = v(xi, yi + 1);
  const d = v(xi + 1, yi + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
