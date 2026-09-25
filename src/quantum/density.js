/**
 * Density matrix simulator for mixed states and noisy channels.
 *
 * The 2^n x 2^n matrix rho is stored row-major, which is the same memory as
 * a 2n-qubit vector whose low n bits are the column index and high n bits
 * the row index. Left-multiplying by U acts on the row qubits (shifted by n);
 * right-multiplying by U^dagger is conj(U) on the column qubits. Both are
 * the statevector kernel, so no 4^n x 4^n superoperator is ever formed.
 *
 * @module quantum/density
 */

import { applyMatrix } from './kernel.js';
import { checkWires, opActions } from './gates.js';
import { conjugate, hermitianEigen, partialTrace as ptrace } from './cmatrix.js';
import { parsePauli, pauliPhase } from './pauli.js';
import { createRng } from './rng.js';

/** @typedef {import('../qubi/ir.js').Op} Op */
/** @typedef {import('../qubi/ir.js').CMatrix} CMatrix */
/** @typedef {import('./rng.js').Rng} Rng */

/**
 * Von Neumann entropy -Tr(rho log rho) of a density matrix.
 * @param {CMatrix} rho
 * @param {number} [base=2] Logarithm base (2 gives bits).
 * @returns {number}
 */
export function vonNeumannEntropy(rho, base = 2) {
  const { values } = hermitianEigen(rho);
  let s = 0;
  for (const v of values) if (v > 1e-15) s -= v * Math.log(v);
  return s / Math.log(base);
}

export class DensityMatrixSimulator {
  /**
   * Starts in |0...0><0...0|.
   * @param {number} numQubits At most 13 (a 2^13 x 2^13 matrix is 1 GiB).
   * @param {{seed?: number}} [options]
   */
  constructor(numQubits, { seed = 1 } = {}) {
    if (!Number.isInteger(numQubits) || numQubits < 0 || numQubits > 13) {
      throw new Error(`A density matrix needs 0 to 13 qubits, got ${numQubits}`);
    }
    /** @type {number} */
    this.numQubits = numQubits;
    /** @type {number} */
    this.dim = 1 << numQubits;
    /** @type {Float64Array} */
    this.re = new Float64Array(this.dim * this.dim);
    /** @type {Float64Array} */
    this.im = new Float64Array(this.dim * this.dim);
    this.re[0] = 1;
    /** @type {Rng} */
    this.rng = createRng(seed);
  }

  /**
   * Builds the pure state |psi><psi| from amplitudes.
   * @param {{re: ArrayLike<number>, im: ArrayLike<number>}} amps
   * @returns {DensityMatrixSimulator}
   */
  static fromAmplitudes(amps) {
    const n = Math.round(Math.log2(amps.re.length));
    const sim = new DensityMatrixSimulator(n);
    const d = sim.dim;
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        sim.re[i * d + j] = amps.re[i] * amps.re[j] + amps.im[i] * amps.im[j];
        sim.im[i * d + j] = amps.im[i] * amps.re[j] - amps.re[i] * amps.im[j];
      }
    }
    return sim;
  }

  /**
   * Wraps an existing density matrix (copied).
   * @param {CMatrix} rho
   * @returns {DensityMatrixSimulator}
   */
  static fromMatrix(rho) {
    const n = Math.round(Math.log2(rho.rows));
    if (rho.rows !== 1 << n || rho.cols !== rho.rows) throw new Error('A density matrix must be 2^n x 2^n');
    const sim = new DensityMatrixSimulator(n);
    sim.re.set(rho.re);
    sim.im.set(rho.im);
    return sim;
  }

  /** @returns {DensityMatrixSimulator} Copy with its own matrix; it shares the default rng. */
  clone() {
    const c = new DensityMatrixSimulator(this.numQubits);
    c.re.set(this.re);
    c.im.set(this.im);
    c.rng = this.rng;
    return c;
  }

  /** @returns {CMatrix} Copy of rho. */
  densityMatrix() {
    return { rows: this.dim, cols: this.dim, re: Float64Array.from(this.re), im: Float64Array.from(this.im) };
  }

  /**
   * rho -> K rho K^dagger for one operator, in place.
   * @param {CMatrix} k
   * @param {number[]} targets
   * @param {number[]} controls
   */
  conjugateBy(k, targets, controls = []) {
    const n = this.numQubits;
    applyMatrix(this.re, this.im, 2 * n, k, targets.map((t) => t + n), controls.map((c) => c + n));
    applyMatrix(this.re, this.im, 2 * n, conjugate(k), targets, controls);
  }

  /**
   * Applies a gate op (unitary conjugation); measurement ops collapse.
   * @param {Op} op
   * @param {Rng} [rng]
   * @returns {number[]|undefined} Bits for a measurement op.
   */
  applyOp(op, rng) {
    if (op.kind === 'measure' || op.name === 'MEASURE') return this.measure(op.targets, rng);
    if (op.kind === 'if') throw new Error('An if op needs classical registers; use executeCircuit');
    for (const a of opActions(op)) {
      checkWires([...a.targets, ...a.controls], this.numQubits, op.name);
      this.conjugateBy(a.matrix, a.targets, a.controls);
    }
    return undefined;
  }

  /**
   * Applies a quantum channel given by Kraus operators: rho -> sum K rho K^dagger.
   * @param {CMatrix[]} kraus Operators on `targets` (targets[0] least significant).
   * @param {number[]} targets
   */
  applyKraus(kraus, targets) {
    checkWires(targets, this.numQubits, 'applyKraus');
    const accRe = new Float64Array(this.re.length);
    const accIm = new Float64Array(this.im.length);
    const baseRe = Float64Array.from(this.re);
    const baseIm = Float64Array.from(this.im);
    for (const k of kraus) {
      this.re.set(baseRe);
      this.im.set(baseIm);
      this.conjugateBy(k, targets);
      for (let i = 0; i < accRe.length; i++) {
        accRe[i] += this.re[i];
        accIm[i] += this.im[i];
      }
    }
    this.re.set(accRe);
    this.im.set(accIm);
  }

  /** @returns {Float64Array} Diagonal of rho: basis-state probabilities. */
  probabilities() {
    const out = new Float64Array(this.dim);
    for (let i = 0; i < this.dim; i++) out[i] = this.re[i * this.dim + i];
    return out;
  }

  /**
   * @param {number} wire
   * @returns {number} Probability that `wire` reads 1.
   */
  probabilityOfOne(wire) {
    const bit = 1 << wire;
    let p = 0;
    for (let i = 0; i < this.dim; i++) if (i & bit) p += this.re[i * this.dim + i];
    return p;
  }

  /**
   * Measures wires one after another, collapsing rho to the observed outcome.
   * @param {number[]} wires
   * @param {Rng} [rng]
   * @returns {number[]}
   */
  measure(wires, rng = this.rng) {
    checkWires(wires, this.numQubits, 'MEASURE');
    return wires.map((w) => {
      const p1 = this.probabilityOfOne(w);
      const outcome = rng() < p1 ? 1 : 0;
      const p = outcome ? p1 : 1 - p1;
      const bit = 1 << w;
      const keep = (i) => ((i & bit) !== 0) === (outcome === 1);
      for (let i = 0; i < this.dim; i++) {
        for (let j = 0; j < this.dim; j++) {
          const k = i * this.dim + j;
          if (keep(i) && keep(j)) {
            this.re[k] /= p;
            this.im[k] /= p;
          } else {
            this.re[k] = 0;
            this.im[k] = 0;
          }
        }
      }
      return outcome;
    });
  }

  /**
   * Non-selective measurement: removes coherences between different values
   * of the wires, keeping the ensemble over outcomes.
   * @param {number[]} wires
   */
  dephase(wires) {
    checkWires(wires, this.numQubits, 'dephase');
    let mask = 0;
    for (const w of wires) mask |= 1 << w;
    for (let i = 0; i < this.dim; i++) {
      for (let j = 0; j < this.dim; j++) {
        if ((i & mask) !== (j & mask)) {
          this.re[i * this.dim + j] = 0;
          this.im[i * this.dim + j] = 0;
        }
      }
    }
  }

  /**
   * Reduced density matrix on `keep` (keep[0] is its least significant qubit).
   * @param {number[]} keep
   * @returns {CMatrix}
   */
  partialTrace(keep) {
    checkWires(keep, this.numQubits, 'partialTrace');
    return ptrace(this.densityMatrix(), this.numQubits, keep);
  }

  /** @returns {number} Tr(rho^2), 1 for a pure state and 1/2^n when maximally mixed. */
  purity() {
    let s = 0;
    for (let k = 0; k < this.re.length; k++) s += this.re[k] * this.re[k] + this.im[k] * this.im[k];
    return s;
  }

  /** @returns {number} Tr(rho), 1 for a valid state. */
  trace() {
    let s = 0;
    for (let i = 0; i < this.dim; i++) s += this.re[i * this.dim + i];
    return s;
  }

  /**
   * Von Neumann entropy in bits of the whole state, or of the reduced state
   * on `wires`.
   * @param {number[]} [wires]
   * @returns {number}
   */
  entropy(wires) {
    return vonNeumannEntropy(wires ? this.partialTrace(wires) : this.densityMatrix());
  }

  /**
   * Tr(rho P) for a Pauli observable.
   * @param {import('./pauli.js').PauliSpec} pauli
   * @returns {number}
   */
  expectation(pauli) {
    const p = parsePauli(pauli, this.numQubits);
    let s = 0;
    for (let i = 0; i < this.dim; i++) {
      const k = i * this.dim + (i ^ p.xMask);
      const [fr, fi] = pauliPhase(p, i);
      s += this.re[k] * fr - this.im[k] * fi;
    }
    return s;
  }
}
