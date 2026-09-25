/**
 * Combinatorics with exact BigInt counts: factorials, binomial coefficients,
 * permutation and combination generators, Catalan numbers, Stirling numbers
 * of both kinds, and integer partitions (counts and generators).
 * @module math/combinatorics
 */

function toBig(n, name) {
  const b = BigInt(n);
  if (b < 0n) throw new RangeError(name + ' must be non-negative');
  return b;
}

/**
 * n! as a BigInt.
 * @param {number|bigint} n
 * @returns {bigint}
 */
export function factorial(n) {
  const N = toBig(n, 'n');
  let r = 1n;
  for (let i = 2n; i <= N; i++) r *= i;
  return r;
}

/**
 * Binomial coefficient C(n, k) as a BigInt (0 when k is out of range).
 * @param {number|bigint} n
 * @param {number|bigint} k
 * @returns {bigint}
 */
export function binomial(n, k) {
  const N = toBig(n, 'n');
  let K = BigInt(k);
  if (K < 0n || K > N) return 0n;
  if (K > N - K) K = N - K;
  let r = 1n;
  for (let i = 1n; i <= K; i++) r = (r * (N - K + i)) / i;
  return r;
}

/**
 * Number of k-permutations P(n, k) = n! / (n - k)!.
 * @param {number|bigint} n
 * @param {number|bigint} k
 * @returns {bigint}
 */
export function permutationsCount(n, k) {
  const N = toBig(n, 'n');
  const K = BigInt(k);
  if (K < 0n || K > N) return 0n;
  let r = 1n;
  for (let i = 0n; i < K; i++) r *= N - i;
  return r;
}

/**
 * All permutations of the items in lexicographic order of positions.
 * @template T
 * @param {T[]} items
 * @returns {Generator<T[]>}
 */
export function* permutations(items) {
  const n = items.length;
  const idx = [...Array(n).keys()];
  for (;;) {
    yield idx.map((i) => items[i]);
    let i = n - 2;
    while (i >= 0 && idx[i] >= idx[i + 1]) i--;
    if (i < 0) return;
    let j = n - 1;
    while (idx[j] <= idx[i]) j--;
    [idx[i], idx[j]] = [idx[j], idx[i]];
    for (let a = i + 1, b = n - 1; a < b; a++, b--) [idx[a], idx[b]] = [idx[b], idx[a]];
  }
}

/**
 * All k-element combinations, in lexicographic order of positions.
 * @template T
 * @param {T[]} items
 * @param {number} k
 * @returns {Generator<T[]>}
 */
export function* combinations(items, k) {
  const n = items.length;
  if (k < 0 || k > n) return;
  const idx = [...Array(k).keys()];
  for (;;) {
    yield idx.map((i) => items[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

/**
 * Catalan number C_n = binom(2n, n) / (n + 1).
 * @param {number} n
 * @returns {bigint}
 */
export function catalan(n) {
  return binomial(2 * n, n) / BigInt(n + 1);
}

/**
 * Unsigned Stirling number of the first kind c(n, k) (permutations of n with
 * k cycles).
 * @param {number} n
 * @param {number} k
 * @returns {bigint}
 */
export function stirlingFirst(n, k) {
  const row = [1n];
  for (let i = 1; i <= n; i++) {
    const next = new Array(i + 1).fill(0n);
    for (let j = 1; j <= i; j++) next[j] = (row[j - 1] || 0n) + BigInt(i - 1) * (row[j] || 0n);
    row.splice(0, row.length, ...next);
  }
  return k >= 0 && k <= n ? row[k] : 0n;
}

/**
 * Stirling number of the second kind S(n, k) (partitions of n items into k
 * non-empty blocks).
 * @param {number} n
 * @param {number} k
 * @returns {bigint}
 */
export function stirlingSecond(n, k) {
  const row = [1n];
  for (let i = 1; i <= n; i++) {
    const next = new Array(i + 1).fill(0n);
    for (let j = 1; j <= i; j++) next[j] = (row[j - 1] || 0n) + BigInt(j) * (row[j] || 0n);
    row.splice(0, row.length, ...next);
  }
  return k >= 0 && k <= n ? row[k] : 0n;
}

/**
 * Number of integer partitions p(n) (Euler's pentagonal recurrence).
 * @param {number} n
 * @returns {bigint}
 */
export function partitionCount(n) {
  const p = [1n];
  for (let m = 1; m <= n; m++) {
    let s = 0n;
    for (let k = 1; ; k++) {
      const g1 = (k * (3 * k - 1)) / 2;
      const g2 = (k * (3 * k + 1)) / 2;
      if (g1 > m) break;
      const sign = k % 2 === 1 ? 1n : -1n;
      s += sign * p[m - g1];
      if (g2 <= m) s += sign * p[m - g2];
    }
    p.push(s);
  }
  return p[n];
}

/**
 * All partitions of n as non-increasing arrays.
 * @param {number} n
 * @param {number} [max=n] largest allowed part
 * @returns {Generator<number[]>}
 */
export function* partitions(n, max = n) {
  if (n === 0) {
    yield [];
    return;
  }
  for (let first = Math.min(n, max); first >= 1; first--) {
    for (const rest of partitions(n - first, first)) yield [first, ...rest];
  }
}
