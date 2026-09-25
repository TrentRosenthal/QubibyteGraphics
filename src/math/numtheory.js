/**
 * Number theory with BigInt: sieve of Eratosthenes, factorization (trial
 * division plus Pollard's rho with Miller-Rabin), gcd and lcm, the extended
 * Euclidean algorithm with its table of steps, modular exponentiation and
 * inverses, the Chinese remainder theorem, continued fractions with
 * convergents, and Euler's totient.
 * @module math/numtheory
 */
import { Rational } from './rational.js';

const big = (v) => (typeof v === 'bigint' ? v : BigInt(v));
const abs = (v) => (v < 0n ? -v : v);

/**
 * Primes up to n (sieve of Eratosthenes).
 * @param {number} n
 * @returns {number[]}
 */
export function sieve(n) {
  const out = [];
  if (n < 2) return out;
  const mark = new Uint8Array(n + 1);
  for (let i = 2; i <= n; i++) {
    if (mark[i]) continue;
    out.push(i);
    for (let j = i * i; j <= n; j += i) mark[j] = 1;
  }
  return out;
}

/**
 * Greatest common divisor.
 * @param {number|bigint} a
 * @param {number|bigint} b
 * @returns {bigint}
 */
export function gcd(a, b) {
  let x = abs(big(a));
  let y = abs(big(b));
  while (y) [x, y] = [y, x % y];
  return x;
}

/**
 * Least common multiple.
 * @param {number|bigint} a
 * @param {number|bigint} b
 * @returns {bigint}
 */
export function lcm(a, b) {
  const A = big(a);
  const B = big(b);
  if (A === 0n || B === 0n) return 0n;
  return abs((A / gcd(A, B)) * B);
}

/**
 * Extended Euclidean algorithm: g = gcd(a, b) = a x + b y, with every
 * division step (a = q b + r) and the running Bezout coefficients.
 * @param {number|bigint} a
 * @param {number|bigint} b
 * @returns {{g: bigint, x: bigint, y: bigint, steps: {a: bigint, b: bigint, q: bigint, r: bigint, s: bigint, t: bigint}[]}}
 */
export function extendedGcd(a, b) {
  let [r0, r1] = [big(a), big(b)];
  let [s0, s1] = [1n, 0n];
  let [t0, t1] = [0n, 1n];
  const steps = [];
  while (r1 !== 0n) {
    const q = r0 / r1;
    const r = r0 - q * r1;
    steps.push({ a: r0, b: r1, q, r, s: s0 - q * s1, t: t0 - q * t1 });
    [r0, r1] = [r1, r];
    [s0, s1] = [s1, s0 - q * s1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  if (r0 < 0n) {
    r0 = -r0;
    s0 = -s0;
    t0 = -t0;
  }
  return { g: r0, x: s0, y: t0, steps };
}

/**
 * Modular exponentiation b^e mod m (e >= 0).
 * @param {number|bigint} b
 * @param {number|bigint} e
 * @param {number|bigint} m
 * @returns {bigint}
 */
export function modPow(b, e, m) {
  let B = ((big(b) % big(m)) + big(m)) % big(m);
  let E = big(e);
  const M = big(m);
  if (E < 0n) throw new RangeError('Negative exponent: use modInverse first');
  let r = 1n % M;
  while (E > 0n) {
    if (E & 1n) r = (r * B) % M;
    B = (B * B) % M;
    E >>= 1n;
  }
  return r;
}

/**
 * Modular inverse of a mod m, or throws when gcd(a, m) != 1.
 * @param {number|bigint} a
 * @param {number|bigint} m
 * @returns {bigint}
 */
export function modInverse(a, m) {
  const { g, x } = extendedGcd(big(a), big(m));
  if (g !== 1n) throw new RangeError(String(a) + ' has no inverse modulo ' + String(m));
  const M = big(m);
  return ((x % M) + M) % M;
}

/**
 * Chinese remainder theorem for x = r_i (mod m_i) with pairwise coprime or
 * compatible moduli.
 * @param {Array<number|bigint>} residues
 * @param {Array<number|bigint>} moduli
 * @returns {{x: bigint, modulus: bigint}}
 */
export function crt(residues, moduli) {
  let x = 0n;
  let M = 1n;
  for (let i = 0; i < residues.length; i++) {
    const r = big(residues[i]);
    const m = big(moduli[i]);
    const g = gcd(M, m);
    if ((r - x) % g !== 0n) throw new RangeError('The congruences are inconsistent');
    const mg = m / g;
    const k = (((r - x) / g) % mg) * modInverse((M / g) % mg, mg);
    x = x + M * (((k % mg) + mg) % mg);
    M = M * mg;
    x = ((x % M) + M) % M;
  }
  return { x, modulus: M };
}

/**
 * Miller-Rabin primality test (deterministic for n < 3.3e24 with these bases).
 * @param {number|bigint} n
 * @returns {boolean}
 */
export function isPrime(n) {
  const N = big(n);
  if (N < 2n) return false;
  for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n]) {
    if (N === p) return true;
    if (N % p === 0n) return false;
  }
  let d = N - 1n;
  let s = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    s++;
  }
  for (const a of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n]) {
    let x = modPow(a, d, N);
    if (x === 1n || x === N - 1n) continue;
    let composite = true;
    for (let i = 1; i < s; i++) {
      x = (x * x) % N;
      if (x === N - 1n) {
        composite = false;
        break;
      }
    }
    if (composite) return false;
  }
  return true;
}

function pollardRho(n) {
  if (n % 2n === 0n) return 2n;
  for (let c = 1n; c < 100n; c++) {
    let x = 2n;
    let y = 2n;
    let d = 1n;
    const f = (v) => (v * v + c) % n;
    while (d === 1n) {
      x = f(x);
      y = f(f(y));
      d = gcd(x > y ? x - y : y - x, n);
    }
    if (d !== n) return d;
  }
  return n;
}

/**
 * Prime factorization as [{prime, exponent}] in increasing order.
 * @param {number|bigint} n
 * @returns {{prime: bigint, exponent: number}[]}
 */
export function factorize(n) {
  let N = abs(big(n));
  if (N < 2n) return [];
  const counts = new Map();
  const add = (p) => counts.set(p, (counts.get(p) || 0) + 1);
  for (let p = 2n; p < 1000n && p * p <= N; p++) {
    while (N % p === 0n) {
      add(p);
      N /= p;
    }
  }
  const stack = N > 1n ? [N] : [];
  while (stack.length) {
    const m = stack.pop();
    if (m === 1n) continue;
    if (isPrime(m)) {
      add(m);
      continue;
    }
    const d = pollardRho(m);
    stack.push(d, m / d);
  }
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([prime, exponent]) => ({ prime, exponent }));
}

/**
 * Euler's totient phi(n).
 * @param {number|bigint} n
 * @returns {bigint}
 */
export function totient(n) {
  let r = big(n);
  for (const { prime } of factorize(n)) r = (r / prime) * (prime - 1n);
  return r;
}

/**
 * Continued fraction expansion of a rational (exact) or a real number
 * (up to `terms` partial quotients), with its convergents.
 * @param {number|string|Rational} x
 * @param {number} [terms=20]
 * @returns {{quotients: bigint[], convergents: Rational[]}}
 */
export function continuedFraction(x, terms = 20) {
  const quotients = [];
  if (typeof x === 'number' && !Number.isInteger(x)) {
    let v = x;
    for (let i = 0; i < terms; i++) {
      const a = Math.floor(v);
      quotients.push(BigInt(a));
      const frac = v - a;
      if (Math.abs(frac) < 1e-12) break;
      v = 1 / frac;
      if (!Number.isFinite(v) || Math.abs(v) > 1e15) break;
    }
  } else {
    let r = Rational.from(x);
    for (let i = 0; i < terms; i++) {
      const a = r.floor();
      quotients.push(a);
      const frac = r.sub(new Rational(a));
      if (frac.isZero()) break;
      r = frac.inv();
    }
  }
  const convergents = [];
  let [p0, p1] = [1n, quotients[0]];
  let [q0, q1] = [0n, 1n];
  convergents.push(new Rational(p1, q1));
  for (let i = 1; i < quotients.length; i++) {
    const a = quotients[i];
    [p0, p1] = [p1, a * p1 + p0];
    [q0, q1] = [q1, a * q1 + q0];
    convergents.push(new Rational(p1, q1));
  }
  return { quotients, convergents };
}
