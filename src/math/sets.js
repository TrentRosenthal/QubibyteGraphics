/**
 * Finite set operations and Venn diagram region data for two or three sets.
 * Sets are arrays (duplicates removed, insertion order kept) or Set objects.
 * @module math/sets
 */

const toArr = (s) => [...new Set(s)];

/**
 * @template T
 * @param {Iterable<T>} a
 * @param {Iterable<T>} b
 * @returns {T[]}
 */
export function union(a, b) {
  return toArr([...a, ...b]);
}

/**
 * @template T
 * @param {Iterable<T>} a
 * @param {Iterable<T>} b
 * @returns {T[]}
 */
export function intersection(a, b) {
  const B = new Set(b);
  return toArr(a).filter((x) => B.has(x));
}

/**
 * Elements of a not in b.
 * @template T
 * @param {Iterable<T>} a
 * @param {Iterable<T>} b
 * @returns {T[]}
 */
export function difference(a, b) {
  const B = new Set(b);
  return toArr(a).filter((x) => !B.has(x));
}

/**
 * @template T
 * @param {Iterable<T>} a
 * @param {Iterable<T>} b
 * @returns {T[]}
 */
export function symmetricDifference(a, b) {
  return union(difference(a, b), difference(b, a));
}

/**
 * Complement of a within a universe.
 * @template T
 * @param {Iterable<T>} a
 * @param {Iterable<T>} universe
 * @returns {T[]}
 */
export function complement(a, universe) {
  return difference(universe, a);
}

/**
 * All subsets, ordered by size then by position.
 * @template T
 * @param {Iterable<T>} a
 * @returns {T[][]}
 */
export function powerSet(a) {
  const items = toArr(a);
  if (items.length > 20) throw new RangeError('Power set too large');
  const out = [];
  for (let mask = 0; mask < 1 << items.length; mask++) out.push(items.filter((_, i) => mask & (1 << i)));
  return out.sort((p, q) => p.length - q.length);
}

/**
 * Cartesian product.
 * @template T, U
 * @param {Iterable<T>} a
 * @param {Iterable<U>} b
 * @returns {Array<[T, U]>}
 */
export function cartesianProduct(a, b) {
  const B = toArr(b);
  return toArr(a).flatMap((x) => B.map((y) => [x, y]));
}

/**
 * @typedef {object} VennRegion
 * @property {string} key membership pattern such as "A&!B&C"
 * @property {boolean[]} inSets membership in each set, in input order
 * @property {Array<*>} elements
 */

/**
 * Venn diagram regions for 2 or 3 sets: every membership combination with
 * its elements (the region outside all sets is included when a universe is
 * given).
 * @param {Record<string, Iterable<*>>} sets named sets, 2 or 3 of them
 * @param {Iterable<*>} [universe]
 * @returns {{names: string[], regions: VennRegion[]}}
 */
export function vennRegions(sets, universe) {
  const names = Object.keys(sets);
  if (names.length < 2 || names.length > 3) throw new RangeError('Venn regions need 2 or 3 sets');
  const arrs = names.map((n) => new Set(sets[n]));
  const all = toArr([...(universe || []), ...names.flatMap((n) => [...sets[n]])]);
  const regions = [];
  for (let mask = universe ? 0 : 1; mask < 1 << names.length; mask++) {
    const inSets = names.map((_, i) => !!(mask & (1 << i)));
    const elements = all.filter((x) => arrs.every((s, i) => s.has(x) === inSets[i]));
    const key = names.map((n, i) => (inSets[i] ? n : '!' + n)).join('&');
    regions.push({ key, inSets, elements });
  }
  return { names, regions };
}
