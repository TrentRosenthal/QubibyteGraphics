/**
 * Pauli strings as bit masks. A Pauli string is written like a basis ket,
 * most significant qubit first, so the rightmost character acts on qubit 0:
 * `"XZ"` is Z on qubit 0 and X on qubit 1. A string shorter than the register
 * is padded with I on the high qubits. An object `{2: 'X', 0: 'Z'}` keyed by
 * wire is accepted too.
 *
 * @module quantum/pauli
 */

/**
 * A Pauli observable: an MSB-first string of I/X/Y/Z, or a map from wire to
 * letter. A leading `+` or `-` sign is allowed on strings.
 * @typedef {string|Record<number, string>} PauliSpec
 */

/**
 * @typedef {Object} PauliMasks
 * @property {number} xMask Qubits carrying X or Y (bit flip).
 * @property {number} zMask Qubits carrying Z or Y (phase flip).
 * @property {number} yCount Number of Y factors.
 * @property {number} sign +1 or -1.
 */

/**
 * Parses a Pauli specification into masks.
 * @param {PauliSpec} spec
 * @param {number} numQubits
 * @returns {PauliMasks}
 */
export function parsePauli(spec, numQubits) {
  let xMask = 0;
  let zMask = 0;
  let yCount = 0;
  let sign = 1;
  const put = (wire, letter) => {
    if (!Number.isInteger(wire) || wire < 0 || wire >= numQubits) {
      throw new Error(`Pauli factor on wire ${wire} is outside a ${numQubits}-qubit register`);
    }
    switch (letter) {
      case 'I': break;
      case 'X': xMask |= 1 << wire; break;
      case 'Z': zMask |= 1 << wire; break;
      case 'Y': xMask |= 1 << wire; zMask |= 1 << wire; yCount++; break;
      default: throw new Error(`Unknown Pauli letter "${letter}" (use I, X, Y, Z)`);
    }
  };
  if (typeof spec === 'string') {
    let s = spec.trim().toUpperCase();
    if (s.startsWith('-')) sign = -1;
    if (s.startsWith('-') || s.startsWith('+')) s = s.slice(1);
    if (s.length > numQubits) throw new Error(`Pauli string "${spec}" is longer than ${numQubits} qubits`);
    for (let k = 0; k < s.length; k++) put(s.length - 1 - k, s[k]);
  } else if (spec && typeof spec === 'object') {
    for (const [wire, letter] of Object.entries(spec)) put(Number(wire), String(letter).toUpperCase());
  } else {
    throw new TypeError('A Pauli observable is a string like "XZ" or an object like {0: "Z"}');
  }
  return { xMask, zMask, yCount, sign };
}

/**
 * Number of set bits in a 32-bit integer.
 * @param {number} v
 * @returns {number}
 */
export function popcount(v) {
  let x = v >>> 0;
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

/**
 * Phase picked up by basis state |i> under the Pauli: P|i> = phase |i ^ xMask>.
 * Returns [re, im] of phase = sign * i^yCount * (-1)^popcount(i & zMask).
 * @param {PauliMasks} p
 * @param {number} i
 * @returns {[number, number]}
 */
export function pauliPhase(p, i) {
  const s = (popcount(i & p.zMask) & 1 ? -1 : 1) * p.sign;
  switch (p.yCount & 3) {
    case 0: return [s, 0];
    case 1: return [0, s];
    case 2: return [-s, 0];
    default: return [0, -s];
  }
}
