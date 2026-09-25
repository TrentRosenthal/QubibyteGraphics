/**
 * Dense complex linear algebra on CMatrix values (see `qubi/ir.js`): a
 * row-major matrix with separate Float64Array real and imaginary parts.
 *
 * Everything here is written for the small matrices the quantum layer needs
 * (gate matrices, reduced density matrices, unitaries of a few qubits). The
 * statevector simulator never builds full 2^n x 2^n matrices; it uses the
 * strided kernel in `kernel.js`.
 *
 * @module quantum/cmatrix
 */

/** @typedef {import('../qubi/ir.js').CMatrix} CMatrix */

/**
 * @typedef {Object} Complex
 * @property {number} re
 * @property {number} im
 */

/**
 * A matrix entry as accepted by {@link fromArray}: a real number, a
 * `[re, im]` pair, or a `{re, im}` object.
 * @typedef {number|[number, number]|Complex} ComplexLike
 */

/**
 * Zero matrix.
 * @param {number} rows
 * @param {number} [cols=rows]
 * @returns {CMatrix}
 */
export function zeros(rows, cols = rows) {
  return { rows, cols, re: new Float64Array(rows * cols), im: new Float64Array(rows * cols) };
}

/**
 * Identity matrix.
 * @param {number} n
 * @returns {CMatrix}
 */
export function identity(n) {
  const m = zeros(n, n);
  for (let i = 0; i < n; i++) m.re[i * n + i] = 1;
  return m;
}

/**
 * Normalizes a complex-like value to `{re, im}`.
 * @param {ComplexLike} v
 * @returns {Complex}
 */
export function toComplex(v) {
  if (typeof v === 'number') return { re: v, im: 0 };
  if (Array.isArray(v)) return { re: v[0], im: v[1] ?? 0 };
  if (v && typeof v.re === 'number') return { re: v.re, im: v.im ?? 0 };
  throw new TypeError(`Not a complex number: ${JSON.stringify(v)}`);
}

/**
 * Builds a matrix from nested row arrays.
 * @param {ComplexLike[][]} rows
 * @returns {CMatrix}
 */
export function fromArray(rows) {
  const r = rows.length;
  const c = r ? rows[0].length : 0;
  const m = zeros(r, c);
  for (let i = 0; i < r; i++) {
    if (rows[i].length !== c) throw new Error(`Row ${i} has ${rows[i].length} entries, expected ${c}`);
    for (let j = 0; j < c; j++) {
      const z = toComplex(rows[i][j]);
      m.re[i * c + j] = z.re;
      m.im[i * c + j] = z.im;
    }
  }
  return m;
}

/**
 * Converts a matrix to nested `[re, im]` rows (for JSON and display).
 * @param {CMatrix} m
 * @returns {Array<Array<[number, number]>>}
 */
export function toArray(m) {
  const out = [];
  for (let i = 0; i < m.rows; i++) {
    const row = [];
    for (let j = 0; j < m.cols; j++) row.push([m.re[i * m.cols + j], m.im[i * m.cols + j]]);
    out.push(row);
  }
  return out;
}

/**
 * Deep copy.
 * @param {CMatrix} m
 * @returns {CMatrix}
 */
export function clone(m) {
  return { rows: m.rows, cols: m.cols, re: Float64Array.from(m.re), im: Float64Array.from(m.im) };
}

/**
 * Entry (r, c).
 * @param {CMatrix} m
 * @param {number} r
 * @param {number} c
 * @returns {Complex}
 */
export function get(m, r, c) {
  const k = r * m.cols + c;
  return { re: m.re[k], im: m.im[k] };
}

/**
 * Matrix product a * b.
 * @param {CMatrix} a
 * @param {CMatrix} b
 * @returns {CMatrix}
 */
export function multiply(a, b) {
  if (a.cols !== b.rows) throw new Error(`Cannot multiply ${a.rows}x${a.cols} by ${b.rows}x${b.cols}`);
  const n = a.rows;
  const m = b.cols;
  const p = a.cols;
  const out = zeros(n, m);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < p; k++) {
      const ar = a.re[i * p + k];
      const ai = a.im[i * p + k];
      if (ar === 0 && ai === 0) continue;
      for (let j = 0; j < m; j++) {
        const br = b.re[k * m + j];
        const bi = b.im[k * m + j];
        out.re[i * m + j] += ar * br - ai * bi;
        out.im[i * m + j] += ar * bi + ai * br;
      }
    }
  }
  return out;
}

/**
 * Product of several matrices, left to right.
 * @param {...CMatrix} ms
 * @returns {CMatrix}
 */
export function multiplyAll(...ms) {
  return ms.reduce((acc, m) => multiply(acc, m));
}

function sameShape(a, b, what) {
  if (a.rows !== b.rows || a.cols !== b.cols) {
    throw new Error(`Cannot ${what} ${a.rows}x${a.cols} and ${b.rows}x${b.cols}`);
  }
}

/**
 * Sum a + b.
 * @param {CMatrix} a
 * @param {CMatrix} b
 * @returns {CMatrix}
 */
export function add(a, b) {
  sameShape(a, b, 'add');
  const out = zeros(a.rows, a.cols);
  for (let k = 0; k < a.re.length; k++) {
    out.re[k] = a.re[k] + b.re[k];
    out.im[k] = a.im[k] + b.im[k];
  }
  return out;
}

/**
 * Difference a - b.
 * @param {CMatrix} a
 * @param {CMatrix} b
 * @returns {CMatrix}
 */
export function subtract(a, b) {
  sameShape(a, b, 'subtract');
  const out = zeros(a.rows, a.cols);
  for (let k = 0; k < a.re.length; k++) {
    out.re[k] = a.re[k] - b.re[k];
    out.im[k] = a.im[k] - b.im[k];
  }
  return out;
}

/**
 * Scalar multiple (sRe + i sIm) * m.
 * @param {CMatrix} m
 * @param {number} sRe
 * @param {number} [sIm=0]
 * @returns {CMatrix}
 */
export function scale(m, sRe, sIm = 0) {
  const out = zeros(m.rows, m.cols);
  for (let k = 0; k < m.re.length; k++) {
    out.re[k] = m.re[k] * sRe - m.im[k] * sIm;
    out.im[k] = m.re[k] * sIm + m.im[k] * sRe;
  }
  return out;
}

/**
 * Conjugate transpose.
 * @param {CMatrix} m
 * @returns {CMatrix}
 */
export function adjoint(m) {
  const out = zeros(m.cols, m.rows);
  for (let i = 0; i < m.rows; i++) {
    for (let j = 0; j < m.cols; j++) {
      out.re[j * m.rows + i] = m.re[i * m.cols + j];
      out.im[j * m.rows + i] = -m.im[i * m.cols + j];
    }
  }
  return out;
}

/**
 * Transpose (no conjugation).
 * @param {CMatrix} m
 * @returns {CMatrix}
 */
export function transpose(m) {
  const out = zeros(m.cols, m.rows);
  for (let i = 0; i < m.rows; i++) {
    for (let j = 0; j < m.cols; j++) {
      out.re[j * m.rows + i] = m.re[i * m.cols + j];
      out.im[j * m.rows + i] = m.im[i * m.cols + j];
    }
  }
  return out;
}

/**
 * Entrywise complex conjugate.
 * @param {CMatrix} m
 * @returns {CMatrix}
 */
export function conjugate(m) {
  const out = clone(m);
  for (let k = 0; k < out.im.length; k++) out.im[k] = -out.im[k];
  return out;
}

/**
 * Kronecker product a (x) b. With the LSB-first qubit convention, `kron(a, b)`
 * puts `b` on the lower-numbered qubits and `a` on the higher ones.
 * @param {CMatrix} a
 * @param {CMatrix} b
 * @returns {CMatrix}
 */
export function kron(a, b) {
  const rows = a.rows * b.rows;
  const cols = a.cols * b.cols;
  const out = zeros(rows, cols);
  for (let i = 0; i < a.rows; i++) {
    for (let j = 0; j < a.cols; j++) {
      const ar = a.re[i * a.cols + j];
      const ai = a.im[i * a.cols + j];
      if (ar === 0 && ai === 0) continue;
      for (let k = 0; k < b.rows; k++) {
        for (let l = 0; l < b.cols; l++) {
          const br = b.re[k * b.cols + l];
          const bi = b.im[k * b.cols + l];
          const idx = (i * b.rows + k) * cols + (j * b.cols + l);
          out.re[idx] = ar * br - ai * bi;
          out.im[idx] = ar * bi + ai * br;
        }
      }
    }
  }
  return out;
}

/**
 * Trace.
 * @param {CMatrix} m
 * @returns {Complex}
 */
export function trace(m) {
  let re = 0;
  let im = 0;
  const n = Math.min(m.rows, m.cols);
  for (let i = 0; i < n; i++) {
    re += m.re[i * m.cols + i];
    im += m.im[i * m.cols + i];
  }
  return { re, im };
}

/**
 * Frobenius norm.
 * @param {CMatrix} m
 * @returns {number}
 */
export function frobeniusNorm(m) {
  let s = 0;
  for (let k = 0; k < m.re.length; k++) s += m.re[k] * m.re[k] + m.im[k] * m.im[k];
  return Math.sqrt(s);
}

/**
 * Basis index offsets for a list of wires: entry j is the full-register index
 * whose bits on `wires` spell j (wires[0] as the least significant bit).
 * @param {number[]} wires
 * @returns {Int32Array}
 */
export function wireOffsets(wires) {
  const dim = 1 << wires.length;
  const out = new Int32Array(dim);
  for (let j = 0; j < dim; j++) {
    let idx = 0;
    for (let b = 0; b < wires.length; b++) if ((j >> b) & 1) idx |= 1 << wires[b];
    out[j] = idx;
  }
  return out;
}

/**
 * Partial trace of a density matrix over every qubit not in `keep`.
 * The result's qubit j is `keep[j]` (so keep[0] is its least significant bit).
 * @param {CMatrix} rho 2^n x 2^n density matrix.
 * @param {number} numQubits n
 * @param {number[]} keep Wires to keep.
 * @returns {CMatrix}
 */
export function partialTrace(rho, numQubits, keep) {
  const dim = 1 << numQubits;
  if (rho.rows !== dim || rho.cols !== dim) throw new Error(`Expected a ${dim}x${dim} density matrix`);
  const traced = [];
  for (let q = 0; q < numQubits; q++) if (!keep.includes(q)) traced.push(q);
  const keepOff = wireOffsets(keep);
  const envOff = wireOffsets(traced);
  const k = keepOff.length;
  const out = zeros(k, k);
  for (let e = 0; e < envOff.length; e++) {
    const base = envOff[e];
    for (let i = 0; i < k; i++) {
      const row = (base | keepOff[i]) * dim;
      for (let j = 0; j < k; j++) {
        const idx = row + (base | keepOff[j]);
        out.re[i * k + j] += rho.re[idx];
        out.im[i * k + j] += rho.im[idx];
      }
    }
  }
  return out;
}

/**
 * Eigen-decomposition of a Hermitian matrix by the complex cyclic Jacobi
 * method. Each rotation first removes the phase of the pivot entry, then
 * applies a real Givens rotation, so vectors stay exactly unitary.
 * @param {CMatrix} a Hermitian matrix (only its Hermitian part is used).
 * @returns {{values: Float64Array, vectors: CMatrix}} Eigenvalues ascending;
 *   column k of `vectors` is the eigenvector for `values[k]`.
 */
export function hermitianEigen(a) {
  const n = a.rows;
  if (a.cols !== n) throw new Error('hermitianEigen needs a square matrix');
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      re[i * n + j] = 0.5 * (a.re[i * n + j] + a.re[j * n + i]);
      im[i * n + j] = 0.5 * (a.im[i * n + j] - a.im[j * n + i]);
    }
  }
  const v = identity(n);
  const vr = v.re;
  const vi = v.im;
  let total = 0;
  for (let k = 0; k < n * n; k++) total += re[k] * re[k] + im[k] * im[k];
  const threshold = 1e-30 * total + 1e-300;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) off += re[p * n + q] ** 2 + im[p * n + q] ** 2;
    }
    if (off <= threshold) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const cr = re[p * n + q];
        const ci = im[p * n + q];
        const mag = Math.hypot(cr, ci);
        if (mag < 1e-300) continue;
        const theta = 0.5 * Math.atan2(2 * mag, re[p * n + p] - re[q * n + q]);
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        // e = exp(-i phi) where the pivot is |a_pq| exp(i phi).
        const er = cr / mag;
        const ei = -ci / mag;
        // Block of the rotation V: [[c, -s], [e s, e c]].
        for (let k = 0; k < n; k++) {
          const pr = re[k * n + p];
          const pi = im[k * n + p];
          const qr = re[k * n + q];
          const qi = im[k * n + q];
          const eqr = er * qr - ei * qi;
          const eqi = er * qi + ei * qr;
          re[k * n + p] = c * pr + s * eqr;
          im[k * n + p] = c * pi + s * eqi;
          re[k * n + q] = -s * pr + c * eqr;
          im[k * n + q] = -s * pi + c * eqi;
        }
        for (let k = 0; k < n; k++) {
          const pr = re[p * n + k];
          const pi = im[p * n + k];
          const qr = re[q * n + k];
          const qi = im[q * n + k];
          // conj(e) * a_qk
          const eqr = er * qr + ei * qi;
          const eqi = er * qi - ei * qr;
          re[p * n + k] = c * pr + s * eqr;
          im[p * n + k] = c * pi + s * eqi;
          re[q * n + k] = -s * pr + c * eqr;
          im[q * n + k] = -s * pi + c * eqi;
        }
        re[p * n + q] = 0;
        im[p * n + q] = 0;
        re[q * n + p] = 0;
        im[q * n + p] = 0;
        im[p * n + p] = 0;
        im[q * n + q] = 0;
        for (let k = 0; k < n; k++) {
          const pr = vr[k * n + p];
          const pi = vi[k * n + p];
          const qr = vr[k * n + q];
          const qi = vi[k * n + q];
          const eqr = er * qr - ei * qi;
          const eqi = er * qi + ei * qr;
          vr[k * n + p] = c * pr + s * eqr;
          vi[k * n + p] = c * pi + s * eqi;
          vr[k * n + q] = -s * pr + c * eqr;
          vi[k * n + q] = -s * pi + c * eqi;
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => re[x * n + x] - re[y * n + y]);
  const values = new Float64Array(n);
  const vectors = zeros(n, n);
  order.forEach((src, dst) => {
    values[dst] = re[src * n + src];
    for (let k = 0; k < n; k++) {
      vectors.re[k * n + dst] = vr[k * n + src];
      vectors.im[k * n + dst] = vi[k * n + src];
    }
  });
  return { values, vectors };
}

/**
 * Applies a real function to the eigenvalues of a Hermitian matrix:
 * V diag(f(lambda)) V^dagger.
 * @param {CMatrix} a Hermitian matrix.
 * @param {(x: number) => number} f
 * @returns {CMatrix}
 */
export function hermitianFunction(a, f) {
  const { values, vectors } = hermitianEigen(a);
  const n = a.rows;
  const out = zeros(n, n);
  for (let k = 0; k < n; k++) {
    const fk = f(values[k]);
    if (fk === 0) continue;
    for (let i = 0; i < n; i++) {
      const air = vectors.re[i * n + k];
      const aii = vectors.im[i * n + k];
      for (let j = 0; j < n; j++) {
        const bjr = vectors.re[j * n + k];
        const bji = vectors.im[j * n + k];
        out.re[i * n + j] += fk * (air * bjr + aii * bji);
        out.im[i * n + j] += fk * (aii * bjr - air * bji);
      }
    }
  }
  return out;
}

/**
 * Principal square root of a positive semidefinite Hermitian matrix.
 * Tiny negative eigenvalues from rounding are clamped to zero.
 * @param {CMatrix} a
 * @returns {CMatrix}
 */
export function sqrtPsd(a) {
  return hermitianFunction(a, (x) => Math.sqrt(Math.max(0, x)));
}

const EIGEN_MIX = [0.5772156649015329, 1.4142135623730951, 0.3183098861837907, 2.718281828459045];

/**
 * Eigen-decomposition of a unitary (or any normal) matrix. The Hermitian and
 * anti-Hermitian parts commute, so a generic real combination of them is a
 * Hermitian matrix with the same eigenvectors.
 * @param {CMatrix} u
 * @returns {{values: {re: Float64Array, im: Float64Array}, vectors: CMatrix}}
 */
export function unitaryEigen(u) {
  const n = u.rows;
  const ud = adjoint(u);
  let best = null;
  for (const alpha of EIGEN_MIX) {
    const h = zeros(n, n);
    for (let k = 0; k < n * n; k++) {
      const dr = u.re[k] - ud.re[k];
      const di = u.im[k] - ud.im[k];
      h.re[k] = 0.5 * (u.re[k] + ud.re[k]) + alpha * 0.5 * di;
      h.im[k] = 0.5 * (u.im[k] + ud.im[k]) - alpha * 0.5 * dr;
    }
    const { vectors } = hermitianEigen(h);
    const d = multiply(adjoint(vectors), multiply(u, vectors));
    const values = { re: new Float64Array(n), im: new Float64Array(n) };
    let offNorm = 0;
    for (let i = 0; i < n; i++) {
      values.re[i] = d.re[i * n + i];
      values.im[i] = d.im[i * n + i];
      for (let j = 0; j < n; j++) if (i !== j) offNorm += d.re[i * n + j] ** 2 + d.im[i * n + j] ** 2;
    }
    if (!best || offNorm < best.offNorm) best = { values, vectors, offNorm };
    if (offNorm < 1e-20 * n) break;
  }
  return { values: best.values, vectors: best.vectors };
}

/**
 * Singular value decomposition a = u diag(s) v^dagger by one-sided (Hestenes)
 * Jacobi rotations on the columns. Singular values are sorted descending.
 * For an m x n input, `u` is m x k, `v` is n x k with k = min(m, n). Columns
 * of `u` whose singular value is zero are left as zero vectors.
 * @param {CMatrix} a
 * @returns {{u: CMatrix, s: Float64Array, v: CMatrix}}
 */
export function svd(a) {
  if (a.rows < a.cols) {
    const t = svd(adjoint(a));
    return { u: t.v, s: t.s, v: t.u };
  }
  const m = a.rows;
  const n = a.cols;
  const w = clone(a);
  const v = identity(n);
  const col = (mat, rows, cols, j) => {
    let s = 0;
    for (let k = 0; k < rows; k++) s += mat.re[k * cols + j] ** 2 + mat.im[k * cols + j] ** 2;
    return s;
  };
  // Scales column q of mat by conj(e), then rotates columns p and q:
  // p' = c p - s q, q' = s p + c q.
  const rotate = (mat, rows, cols, p, q, c, s, er, ei) => {
    for (let k = 0; k < rows; k++) {
      const pr = mat.re[k * cols + p];
      const pi = mat.im[k * cols + p];
      const qr0 = mat.re[k * cols + q];
      const qi0 = mat.im[k * cols + q];
      const qr = qr0 * er + qi0 * ei;
      const qi = qi0 * er - qr0 * ei;
      mat.re[k * cols + p] = c * pr - s * qr;
      mat.im[k * cols + p] = c * pi - s * qi;
      mat.re[k * cols + q] = s * pr + c * qr;
      mat.im[k * cols + q] = s * pi + c * qi;
    }
  };
  for (let sweep = 0; sweep < 100; sweep++) {
    let rotated = false;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const alpha = col(w, m, n, p);
        const beta = col(w, m, n, q);
        let gr = 0;
        let gi = 0;
        for (let k = 0; k < m; k++) {
          const pr = w.re[k * n + p];
          const pi = w.im[k * n + p];
          const qr = w.re[k * n + q];
          const qi = w.im[k * n + q];
          gr += pr * qr + pi * qi;
          gi += pr * qi - pi * qr;
        }
        const g = Math.hypot(gr, gi);
        if (g <= 1e-15 * Math.sqrt(alpha * beta) || g < 1e-300) continue;
        rotated = true;
        const zeta = (beta - alpha) / (2 * g);
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        rotate(w, m, n, p, q, c, s, gr / g, gi / g);
        rotate(v, n, n, p, q, c, s, gr / g, gi / g);
      }
    }
    if (!rotated) break;
  }
  const norms = Array.from({ length: n }, (_, j) => Math.sqrt(col(w, m, n, j)));
  const order = norms.map((_, j) => j).sort((x, y) => norms[y] - norms[x]);
  const s = new Float64Array(n);
  const u = zeros(m, n);
  const vOut = zeros(n, n);
  const tiny = (norms[order[0]] || 0) * 1e-14 + 1e-300;
  order.forEach((src, dst) => {
    s[dst] = norms[src];
    const inv = norms[src] > tiny ? 1 / norms[src] : 0;
    for (let k = 0; k < m; k++) {
      u.re[k * n + dst] = w.re[k * n + src] * inv;
      u.im[k * n + dst] = w.im[k * n + src] * inv;
    }
    for (let k = 0; k < n; k++) {
      vOut.re[k * n + dst] = v.re[k * n + src];
      vOut.im[k * n + dst] = v.im[k * n + src];
    }
  });
  return { u, s, v: vOut };
}

/**
 * Determinant by LU decomposition with partial pivoting.
 * @param {CMatrix} a Square matrix.
 * @returns {Complex}
 */
export function determinant(a) {
  const n = a.rows;
  if (a.cols !== n) throw new Error('determinant needs a square matrix');
  const re = Float64Array.from(a.re);
  const im = Float64Array.from(a.im);
  let dr = 1;
  let di = 0;
  for (let k = 0; k < n; k++) {
    let piv = k;
    let best = -1;
    for (let i = k; i < n; i++) {
      const mag = Math.hypot(re[i * n + k], im[i * n + k]);
      if (mag > best) {
        best = mag;
        piv = i;
      }
    }
    if (best === 0) return { re: 0, im: 0 };
    if (piv !== k) {
      for (let j = 0; j < n; j++) {
        [re[k * n + j], re[piv * n + j]] = [re[piv * n + j], re[k * n + j]];
        [im[k * n + j], im[piv * n + j]] = [im[piv * n + j], im[k * n + j]];
      }
      dr = -dr;
      di = -di;
    }
    const pr = re[k * n + k];
    const pi = im[k * n + k];
    [dr, di] = [dr * pr - di * pi, dr * pi + di * pr];
    const den = pr * pr + pi * pi;
    for (let i = k + 1; i < n; i++) {
      const xr = re[i * n + k];
      const xi = im[i * n + k];
      const fr = (xr * pr + xi * pi) / den;
      const fi = (xi * pr - xr * pi) / den;
      for (let j = k; j < n; j++) {
        const yr = re[k * n + j];
        const yi = im[k * n + j];
        re[i * n + j] -= fr * yr - fi * yi;
        im[i * n + j] -= fr * yi + fi * yr;
      }
    }
  }
  return { re: dr, im: di };
}

/**
 * Entrywise equality within an absolute tolerance.
 * @param {CMatrix} a
 * @param {CMatrix} b
 * @param {number} [tol=1e-9]
 * @returns {boolean}
 */
export function equals(a, b, tol = 1e-9) {
  if (a.rows !== b.rows || a.cols !== b.cols) return false;
  for (let k = 0; k < a.re.length; k++) {
    if (Math.abs(a.re[k] - b.re[k]) > tol || Math.abs(a.im[k] - b.im[k]) > tol) return false;
  }
  return true;
}

/**
 * Equality up to a global phase: true when b = e^{i phi} a for some phi.
 * @param {CMatrix} a
 * @param {CMatrix} b
 * @param {number} [tol=1e-9]
 * @returns {boolean}
 */
export function equalsUpToPhase(a, b, tol = 1e-9) {
  if (a.rows !== b.rows || a.cols !== b.cols) return false;
  let k0 = 0;
  let best = -1;
  for (let k = 0; k < a.re.length; k++) {
    const mag = Math.hypot(a.re[k], a.im[k]);
    if (mag > best) {
      best = mag;
      k0 = k;
    }
  }
  if (best < tol) return equals(a, b, tol);
  // phase = b[k0] / a[k0], normalized to unit modulus.
  const ar = a.re[k0];
  const ai = a.im[k0];
  let pr = (b.re[k0] * ar + b.im[k0] * ai) / (best * best);
  let pi = (b.im[k0] * ar - b.re[k0] * ai) / (best * best);
  const pm = Math.hypot(pr, pi);
  if (pm < 1e-12) return false;
  pr /= pm;
  pi /= pm;
  return equals(scale(a, pr, pi), b, tol);
}

/**
 * True when m^dagger m = I within tolerance.
 * @param {CMatrix} m
 * @param {number} [tol=1e-9]
 * @returns {boolean}
 */
export function isUnitary(m, tol = 1e-9) {
  if (m.rows !== m.cols) return false;
  return equals(multiply(adjoint(m), m), identity(m.rows), tol);
}

/**
 * True when m = m^dagger within tolerance.
 * @param {CMatrix} m
 * @param {number} [tol=1e-9]
 * @returns {boolean}
 */
export function isHermitian(m, tol = 1e-9) {
  return m.rows === m.cols && equals(m, adjoint(m), tol);
}
