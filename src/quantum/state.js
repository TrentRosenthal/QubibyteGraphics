/**
 * Accepts the different ways a state can be passed to analysis functions
 * and normalizes them.
 *
 * @module quantum/state
 */

import { StatevectorSimulator } from './statevector.js';
import { DensityMatrixSimulator } from './density.js';

/** @typedef {import('../qubi/ir.js').CMatrix} CMatrix */

/**
 * A pure or mixed state in any accepted form: a StatevectorSimulator or
 * `{re, im}` amplitudes (pure), a DensityMatrixSimulator or square CMatrix
 * (mixed), or a 2^n x 1 CMatrix column (pure).
 * @typedef {StatevectorSimulator|DensityMatrixSimulator|CMatrix|{re: ArrayLike<number>, im: ArrayLike<number>}} StateLike
 */

/**
 * Normalizes a state argument.
 * @param {StateLike} state
 * @returns {{pure: true, re: ArrayLike<number>, im: ArrayLike<number>, numQubits: number}|{pure: false, rho: CMatrix, numQubits: number}}
 */
export function describeState(state) {
  let out;
  if (state instanceof StatevectorSimulator) {
    out = { pure: true, re: state.re, im: state.im, numQubits: state.numQubits };
  } else if (state instanceof DensityMatrixSimulator) {
    out = { pure: false, rho: state.densityMatrix(), numQubits: state.numQubits };
  } else if (state && typeof state.rows === 'number') {
    if (state.cols === 1) {
      out = { pure: true, re: state.re, im: state.im, numQubits: Math.round(Math.log2(state.rows)) };
    } else {
      out = { pure: false, rho: state, numQubits: Math.round(Math.log2(state.rows)) };
    }
  } else if (state && state.re && state.im) {
    out = { pure: true, re: state.re, im: state.im, numQubits: Math.round(Math.log2(state.re.length)) };
  } else {
    throw new TypeError('Expected a state: a simulator, {re, im} amplitudes, or a density matrix');
  }
  const dim = out.pure ? out.re.length : out.rho.rows;
  if (dim !== 1 << out.numQubits) throw new Error(`State dimension ${dim} is not a power of two`);
  return out;
}

