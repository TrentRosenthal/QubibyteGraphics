/**
 * Statevector simulator. Amplitudes live in two typed arrays (real and
 * imaginary), Float64Array for double precision or Float32Array for single.
 * Gates are applied in place by the strided kernel, so memory stays at
 * 2^n amplitudes and 20 qubits run comfortably.
 *
 * @module quantum/statevector
 */

import { applyMatrix } from './kernel.js';
import { checkWires, opActions } from './gates.js';
import { parsePauli, pauliPhase } from './pauli.js';
import { createRng } from './rng.js';

/** @typedef {import('../qubi/ir.js').Op} Op */
/** @typedef {import('./rng.js').Rng} Rng */
/** @typedef {import('./pauli.js').PauliSpec} PauliSpec */

/**
 * Amplitude arrays.
 * @typedef {Object} Amplitudes
 * @property {Float64Array} re
 * @property {Float64Array} im
 */

/**
 * Formats a basis index as an MSB-first bitstring (rightmost character is
 * qubit 0).
 * @param {number} index
 * @param {number} width
 * @returns {string}
 */
export function bitstring(index, width) {
  return width === 0 ? '' : index.toString(2).padStart(width, '0');
}

export class StatevectorSimulator {
  /**
   * @param {number} numQubits
   * @param {{precision?: 'double'|'single', seed?: number}} [options]
   */
  constructor(numQubits, { precision = 'double', seed = 1 } = {}) {
    if (!Number.isInteger(numQubits) || numQubits < 0 || numQubits > 30) {
      throw new Error(`A statevector needs 0 to 30 qubits, got ${numQubits}`);
    }
    if (precision !== 'double' && precision !== 'single') {
      throw new Error(`precision must be "double" or "single", got "${precision}"`);
    }
    /** @type {number} */
    this.numQubits = numQubits;
    /** @type {'double'|'single'} */
    this.precision = precision;
    const Arr = precision === 'double' ? Float64Array : Float32Array;
    /** @type {Float64Array|Float32Array} */
    this.re = new Arr(1 << numQubits);
    /** @type {Float64Array|Float32Array} */
    this.im = new Arr(1 << numQubits);
    this.re[0] = 1;
    /** @type {Rng} Used when a method is called without an rng. */
    this.rng = createRng(seed);
  }

  /** Returns the register to |0...0>. */
  reset() {
    this.re.fill(0);
    this.im.fill(0);
    this.re[0] = 1;
  }

  /**
   * Replaces the amplitudes (normalizing them).
   * @param {ArrayLike<number>} re
   * @param {ArrayLike<number>} [im]
   * @returns {this}
   */
  setAmplitudes(re, im) {
    if (re.length !== this.re.length) throw new Error(`Expected ${this.re.length} amplitudes, got ${re.length}`);
    let norm = 0;
    for (let i = 0; i < re.length; i++) norm += re[i] * re[i] + (im ? im[i] * im[i] : 0);
    if (norm === 0) throw new Error('Cannot set a zero state vector');
    const inv = 1 / Math.sqrt(norm);
    for (let i = 0; i < re.length; i++) {
      this.re[i] = re[i] * inv;
      this.im[i] = im ? im[i] * inv : 0;
    }
    return this;
  }

  /** @returns {StatevectorSimulator} Copy with its own amplitudes; it shares this simulator's default rng. */
  clone() {
    const c = new StatevectorSimulator(this.numQubits, { precision: this.precision });
    c.re.set(this.re);
    c.im.set(this.im);
    c.rng = this.rng;
    return c;
  }

  /**
   * Applies one op. Gates and barriers change nothing but the state;
   * measurements collapse and return their bits. `if` ops need classical
   * registers, so run them through `runCircuit`.
   * @param {Op} op
   * @param {Rng} [rng] Randomness for measurements.
   * @returns {number[]|undefined} Measured bits for a measurement op.
   */
  applyOp(op, rng) {
    if (op.kind === 'measure' || op.name === 'MEASURE') return this.measure(op.targets, rng);
    if (op.kind === 'if') throw new Error('An if op needs classical registers; use runCircuit');
    for (const a of opActions(op)) this.applyMatrix(a.matrix, a.targets, a.controls);
    return undefined;
  }

  /**
   * Applies a matrix to target wires with optional controls.
   * @param {import('../qubi/ir.js').CMatrix} matrix
   * @param {number[]} targets
   * @param {number[]} [controls=[]]
   */
  applyMatrix(matrix, targets, controls = []) {
    checkWires([...targets, ...controls], this.numQubits, 'applyMatrix');
    applyMatrix(this.re, this.im, this.numQubits, matrix, targets, controls);
  }

  /**
   * Probability that `wire` reads 1.
   * @param {number} wire
   * @returns {number}
   */
  probabilityOfOne(wire) {
    checkWires([wire], this.numQubits, 'probabilityOfOne');
    const bit = 1 << wire;
    let p = 0;
    for (let i = 0; i < this.re.length; i++) if (i & bit) p += this.re[i] * this.re[i] + this.im[i] * this.im[i];
    return p;
  }

  /**
   * Measures wires in the computational basis, one after another, collapsing
   * and renormalizing the state.
   * @param {number[]} wires
   * @param {Rng} [rng]
   * @returns {number[]} One bit per wire, in the order given.
   */
  measure(wires, rng = this.rng) {
    checkWires(wires, this.numQubits, 'MEASURE');
    return wires.map((w) => {
      const p1 = this.probabilityOfOne(w);
      const outcome = rng() < p1 ? 1 : 0;
      this.project(w, outcome, outcome ? p1 : 1 - p1);
      return outcome;
    });
  }

  /**
   * Projects `wire` onto `outcome` and renormalizes.
   * @param {number} wire
   * @param {0|1} outcome
   * @param {number} [probability] Probability of that outcome, if known.
   */
  project(wire, outcome, probability) {
    const p = probability ?? (outcome ? this.probabilityOfOne(wire) : 1 - this.probabilityOfOne(wire));
    if (p <= 0) throw new Error(`Cannot project wire ${wire} onto ${outcome}: probability is 0`);
    const bit = 1 << wire;
    const inv = 1 / Math.sqrt(p);
    for (let i = 0; i < this.re.length; i++) {
      if (((i & bit) !== 0) === (outcome === 1)) {
        this.re[i] *= inv;
        this.im[i] *= inv;
      } else {
        this.re[i] = 0;
        this.im[i] = 0;
      }
    }
  }

  /** @returns {Float64Array} |amplitude|^2 for every basis index. */
  probabilities() {
    const out = new Float64Array(this.re.length);
    for (let i = 0; i < out.length; i++) out[i] = this.re[i] * this.re[i] + this.im[i] * this.im[i];
    return out;
  }

  /**
   * Marginal distribution over a subset of wires; index bit j is wires[j].
   * @param {number[]} wires
   * @returns {Float64Array}
   */
  marginalProbabilities(wires) {
    checkWires(wires, this.numQubits, 'marginalProbabilities');
    const out = new Float64Array(1 << wires.length);
    for (let i = 0; i < this.re.length; i++) {
      let k = 0;
      for (let j = 0; j < wires.length; j++) k |= ((i >> wires[j]) & 1) << j;
      out[k] += this.re[i] * this.re[i] + this.im[i] * this.im[i];
    }
    return out;
  }

  /** @returns {Amplitudes} Copies of the amplitudes in double precision. */
  amplitudes() {
    return { re: Float64Array.from(this.re), im: Float64Array.from(this.im) };
  }

  /** @returns {number} Squared norm (1 for a normalized state). */
  norm() {
    let s = 0;
    for (let i = 0; i < this.re.length; i++) s += this.re[i] * this.re[i] + this.im[i] * this.im[i];
    return s;
  }

  /**
   * Expectation value of a Pauli observable.
   * @param {PauliSpec} pauli For example "ZZ" (MSB first) or {0: 'X'}.
   * @returns {number}
   */
  expectation(pauli) {
    const p = parsePauli(pauli, this.numQubits);
    let sum = 0;
    for (let i = 0; i < this.re.length; i++) {
      const j = i ^ p.xMask;
      const [fr, fi] = pauliPhase(p, i);
      // conj(psi_j) * phase * psi_i, real part.
      const tr = fr * this.re[i] - fi * this.im[i];
      const ti = fr * this.im[i] + fi * this.re[i];
      sum += this.re[j] * tr + this.im[j] * ti;
    }
    return sum;
  }

  /**
   * Samples measurement outcomes of every qubit without collapsing the state.
   * @param {number} shots
   * @param {Rng} [rng]
   * @returns {Record<string, number>} Counts keyed by MSB-first bitstring.
   */
  sample(shots, rng = this.rng) {
    const probs = this.probabilities();
    const cdf = new Float64Array(probs.length);
    let acc = 0;
    for (let i = 0; i < probs.length; i++) {
      acc += probs[i];
      cdf[i] = acc;
    }
    const counts = {};
    for (let s = 0; s < shots; s++) {
      const r = rng() * acc;
      let lo = 0;
      let hi = cdf.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid] > r) hi = mid;
        else lo = mid + 1;
      }
      const key = bitstring(lo, this.numQubits);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }
}

/**
 * Adapter for the Qubi evaluator's execute mode, which drives a backend
 * through exactly this interface.
 * @param {StatevectorSimulator} sim
 * @param {Rng} [rng]
 * @returns {{applyOp: (op: Op) => void, measure: (wires: number[]) => number[]}}
 */
export function createBackend(sim, rng = sim.rng) {
  return {
    applyOp(op) {
      if (op.kind === 'measure' || op.name === 'MEASURE') sim.measure(op.targets, rng);
      else sim.applyOp(op, rng);
    },
    measure(wires) {
      return sim.measure(wires, rng);
    },
  };
}
