/**
 * Small seeded random number generator (xoshiro128**, seeded through
 * splitmix32) so measurement sampling is reproducible. Self-contained on
 * purpose: the engine core has its own generator for animation.
 *
 * @module quantum/rng
 */

/**
 * A function returning uniform floats in [0, 1).
 * @typedef {() => number} Rng
 */

/**
 * Creates a seeded generator.
 * @param {number} [seed=1] Any 32-bit integer.
 * @returns {Rng}
 */
export function createRng(seed = 1) {
  let s = seed >>> 0;
  const next32 = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = next32();
  let b = next32();
  let c = next32();
  let d = next32();
  if ((a | b | c | d) === 0) a = 1;
  return () => {
    const result = Math.imul(((Math.imul(b, 5) << 7) | (Math.imul(b, 5) >>> 25)) >>> 0, 9) >>> 0;
    const t = (b << 9) >>> 0;
    c = (c ^ a) >>> 0;
    d = (d ^ b) >>> 0;
    b = (b ^ c) >>> 0;
    a = (a ^ d) >>> 0;
    c = (c ^ t) >>> 0;
    d = ((d << 11) | (d >>> 21)) >>> 0;
    return result / 4294967296;
  };
}
