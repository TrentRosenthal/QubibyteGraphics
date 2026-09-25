/**
 * Runtime value types of the Qubi evaluator that have no direct JavaScript
 * equivalent. Numbers, strings, booleans, and lists (arrays) are plain
 * JavaScript values.
 *
 * @module qubi/values
 */

/** Largest bitstring width that fits exactly in a JavaScript number. */
export const MAX_BITS = 53;

/**
 * A bitstring value. Bit q is qubit q (LSB = q0), so the rightmost digit of
 * `0b110` is bit 0.
 */
export class Bits {
  /**
   * @param {number} value Non-negative integer below 2**width.
   * @param {number} width Number of bits, at least 1.
   */
  constructor(value, width) {
    this.value = value;
    this.width = Math.max(1, width);
  }

  /**
   * Bit q of the value.
   * @param {number} q
   * @returns {number} 0 or 1
   */
  bit(q) {
    return Math.floor(this.value / 2 ** q) % 2;
  }

  /**
   * Binary digits, most significant first, without a prefix.
   * @returns {string}
   */
  digits() {
    return this.value.toString(2).padStart(this.width, '0');
  }

  /**
   * Qubi literal form, for example `0b0110`.
   * @returns {string}
   */
  toString() {
    return '0b' + this.digits();
  }
}

/** A reference to a gate by name, produced by gate sweeps such as `<H,X>`. */
export class GateRef {
  /** @param {string} name */
  constructor(name) {
    this.name = name;
  }

  /** @returns {string} */
  toString() {
    return this.name;
  }
}

/** A joint register written with brackets, `[c,t]`. */
export class RegisterVal {
  /** @param {number[]} wires */
  constructor(wires) {
    this.wires = wires;
  }

  /** @returns {string} */
  toString() {
    return '[' + this.wires.join(',') + ']';
  }
}

/**
 * A value that is not known while tracing, such as a measurement result.
 * Any operation on an Unknown yields an Unknown.
 */
export class Unknown {
  /**
   * @param {string} text Source-like description, for example `m[0] == 1`.
   * @param {string|null} [type] Qubi type name when it is known, for example 'bitstring' for a measurement.
   */
  constructor(text, type = null) {
    this.text = text;
    this.type = type;
  }

  /** @returns {string} */
  toString() {
    return this.text;
  }
}
