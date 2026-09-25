/**
 * In-place strided kernel that applies a small (optionally controlled) matrix
 * to a state vector stored as separate real and imaginary arrays. It never
 * forms the full 2^n x 2^n operator: for each assignment of the untouched
 * qubits it gathers the 2^k amplitudes on the targets, multiplies, and
 * scatters them back. The density matrix simulator reuses it on the
 * vectorized density matrix.
 *
 * @module quantum/kernel
 */

import { wireOffsets } from './cmatrix.js';

/** @typedef {import('../qubi/ir.js').CMatrix} CMatrix */

/**
 * Applies `matrix` to `targets`, conditioned on every wire in `controls`
 * being 1. The matrix need not be unitary (projectors and Kraus operators
 * are fine).
 * @param {Float64Array|Float32Array} re
 * @param {Float64Array|Float32Array} im
 * @param {number} numQubits Length of `re` is 2^numQubits.
 * @param {CMatrix} matrix 2^k x 2^k with k = targets.length.
 * @param {number[]} targets targets[0] is the matrix's least significant qubit.
 * @param {number[]} [controls=[]]
 */
export function applyMatrix(re, im, numQubits, matrix, targets, controls = []) {
  let controlMask = 0;
  for (const c of controls) controlMask |= 1 << c;
  const fixed = [...targets, ...controls].sort((a, b) => a - b);
  const count = 1 << (numQubits - fixed.length);
  const deposit = (j) => {
    let i = j;
    for (const p of fixed) i = ((i >> p) << (p + 1)) | (i & ((1 << p) - 1));
    return i | controlMask;
  };
  const mr = matrix.re;
  const mi = matrix.im;
  if (targets.length === 1) {
    const t = 1 << targets[0];
    const [a, b, c, d] = [mr[0], mr[1], mr[2], mr[3]];
    const [ai, bi, ci, di] = [mi[0], mi[1], mi[2], mi[3]];
    if (controls.length === 0) {
      const dim = 1 << numQubits;
      for (let base = 0; base < dim; base += 2 * t) {
        for (let i0 = base; i0 < base + t; i0++) {
          const i1 = i0 + t;
          const xr = re[i0];
          const xi = im[i0];
          const yr = re[i1];
          const yi = im[i1];
          re[i0] = a * xr - ai * xi + b * yr - bi * yi;
          im[i0] = a * xi + ai * xr + b * yi + bi * yr;
          re[i1] = c * xr - ci * xi + d * yr - di * yi;
          im[i1] = c * xi + ci * xr + d * yi + di * yr;
        }
      }
      return;
    }
    for (let j = 0; j < count; j++) {
      const i0 = deposit(j);
      const i1 = i0 | t;
      const xr = re[i0];
      const xi = im[i0];
      const yr = re[i1];
      const yi = im[i1];
      re[i0] = a * xr - ai * xi + b * yr - bi * yi;
      im[i0] = a * xi + ai * xr + b * yi + bi * yr;
      re[i1] = c * xr - ci * xi + d * yr - di * yi;
      im[i1] = c * xi + ci * xr + d * yi + di * yr;
    }
    return;
  }
  const offsets = wireOffsets(targets);
  const dim = offsets.length;
  const vr = new Float64Array(dim);
  const vi = new Float64Array(dim);
  for (let j = 0; j < count; j++) {
    const base = deposit(j);
    for (let k = 0; k < dim; k++) {
      vr[k] = re[base | offsets[k]];
      vi[k] = im[base | offsets[k]];
    }
    for (let r = 0; r < dim; r++) {
      let sr = 0;
      let si = 0;
      const row = r * dim;
      for (let k = 0; k < dim; k++) {
        const xr = mr[row + k];
        const xi = mi[row + k];
        if (xr === 0 && xi === 0) continue;
        sr += xr * vr[k] - xi * vi[k];
        si += xr * vi[k] + xi * vr[k];
      }
      re[base | offsets[r]] = sr;
      im[base | offsets[r]] = si;
    }
  }
}
