/**
 * Linear algebra over exact rationals (and quadratic surds), floating reals,
 * and complex numbers. Operations that have a hand method return the steps
 * as data: every row operation of an elimination, the dot products behind
 * each entry of a product, cofactor expansions, Gram-Schmidt projections,
 * and the normal equations of least squares.
 * @module math/linalg
 */
import { Rational, R0, R1 } from './rational.js';
import { Complex } from './complex.js';
import { F, Surd, toScalar, scalarLatex, scalarToExpr, sqrtRational } from './scalar.js';
import { factorRational, polyRootsNumeric, pDeg } from './poly.js';
import { simplify } from './simplify.js';
import { num, mul, pow } from './expr.js';

/** @typedef {import('./scalar.js').Scalar} Scalar */

/** A dense matrix of scalars. */
export class Matrix {
  /**
   * @param {Scalar[][]} data rows of scalars (not copied)
   */
  constructor(data) {
    if (!data.length || !data[0].length) throw new RangeError('A matrix needs at least one entry');
    const c = data[0].length;
    if (data.some((r) => r.length !== c)) throw new RangeError('All rows must have the same length');
    /** @type {Scalar[][]} */
    this.data = data;
    /** @type {number} */
    this.rows = data.length;
    /** @type {number} */
    this.cols = c;
  }

  /**
   * @param {number} i
   * @param {number} j
   * @returns {Scalar}
   */
  get(i, j) {
    return this.data[i][j];
  }

  /** @returns {Matrix} */
  clone() {
    return new Matrix(this.data.map((r) => r.slice()));
  }

  /** @returns {boolean} true when every entry is exact */
  isExact() {
    return this.data.every((r) => r.every(F.isExact));
  }

  /** @returns {number[][]} entries as floats (NaN for non-real entries) */
  toNumbers() {
    return this.data.map((r) => r.map((x) => F.toNumber(x)));
  }

  /**
   * LaTeX bmatrix; with `augment` a vertical bar is drawn before that column.
   * @param {{augment?: number}} [opts]
   * @returns {string}
   */
  toLatex(opts = {}) {
    const body = this.data.map((r) => r.map(scalarLatex).join(' & ')).join(' \\\\ ');
    if (opts.augment != null) {
      const spec = 'c'.repeat(opts.augment) + '|' + 'c'.repeat(this.cols - opts.augment);
      return '\\left[\\begin{array}{' + spec + '}' + body + '\\end{array}\\right]';
    }
    return '\\begin{bmatrix}' + body + '\\end{bmatrix}';
  }
}

/**
 * Build a matrix from nested arrays. Integers and strings like "2/3" become
 * exact rationals; other numbers stay floating; {re, im} becomes complex.
 * @param {Array<Array<number|string|bigint|Scalar|{re: number, im: number}>>} rows
 * @returns {Matrix}
 */
export function matrix(rows) {
  if (rows instanceof Matrix) return rows;
  return new Matrix(rows.map((r) => r.map(toScalar)));
}

/**
 * Column vector from a list of entries.
 * @param {Array<number|string|Scalar>} entries
 * @returns {Matrix}
 */
export function vector(entries) {
  return matrix(entries.map((e) => [e]));
}

/**
 * Identity matrix.
 * @param {number} n
 * @returns {Matrix}
 */
export function identity(n) {
  const d = [];
  for (let i = 0; i < n; i++) {
    d.push([]);
    for (let j = 0; j < n; j++) d[i].push(i === j ? R1 : R0);
  }
  return new Matrix(d);
}

function zeros(r, c) {
  return new Matrix(Array.from({ length: r }, () => Array.from({ length: c }, () => R0)));
}

function tolFor(M) {
  if (M.isExact()) return 0;
  let m = 0;
  for (const r of M.data) for (const x of r) m = Math.max(m, F.magnitude(x));
  return 1e-10 * Math.max(1, m);
}

/**
 * Sum of two matrices.
 * @param {Matrix} A
 * @param {Matrix} B
 * @returns {Matrix}
 */
export function matAdd(A, B) {
  if (A.rows !== B.rows || A.cols !== B.cols) throw new RangeError('Matrix sizes do not match for addition');
  return new Matrix(A.data.map((r, i) => r.map((x, j) => F.add(x, B.data[i][j]))));
}

/**
 * Difference A - B.
 * @param {Matrix} A
 * @param {Matrix} B
 * @returns {Matrix}
 */
export function matSub(A, B) {
  return matAdd(A, matScale(B, R1.neg()));
}

/**
 * Scalar multiple.
 * @param {Matrix} A
 * @param {Scalar|number} c
 * @returns {Matrix}
 */
export function matScale(A, c) {
  const k = toScalar(c);
  return new Matrix(A.data.map((r) => r.map((x) => F.mul(k, x))));
}

/**
 * Plain matrix product.
 * @param {Matrix} A
 * @param {Matrix} B
 * @returns {Matrix}
 */
export function matMul(A, B) {
  if (A.cols !== B.rows) throw new RangeError('Inner dimensions do not match: ' + A.rows + 'x' + A.cols + ' times ' + B.rows + 'x' + B.cols);
  const out = [];
  for (let i = 0; i < A.rows; i++) {
    const row = [];
    for (let j = 0; j < B.cols; j++) {
      let s = R0;
      for (let k = 0; k < A.cols; k++) s = F.add(s, F.mul(A.data[i][k], B.data[k][j]));
      row.push(s);
    }
    out.push(row);
  }
  return new Matrix(out);
}

/**
 * @typedef {object} ProductEntry
 * @property {number} i
 * @property {number} j
 * @property {{k: number, a: Scalar, b: Scalar, product: Scalar}[]} terms the products a_ik b_kj
 * @property {Scalar} value
 * @property {string} latex e.g. "1 \cdot 5 + 2 \cdot 7 = 19"
 */

/**
 * Matrix product with the dot-product breakdown of every entry, for a
 * walk-through animation.
 * @param {Matrix} A
 * @param {Matrix} B
 * @returns {{result: Matrix, entries: ProductEntry[][]}}
 */
export function multiply(A, B) {
  const result = matMul(A, B);
  const entries = [];
  for (let i = 0; i < A.rows; i++) {
    const row = [];
    for (let j = 0; j < B.cols; j++) {
      const terms = [];
      for (let k = 0; k < A.cols; k++) terms.push({ k, a: A.data[i][k], b: B.data[k][j], product: F.mul(A.data[i][k], B.data[k][j]) });
      const wrap = (x) => {
        const s = scalarLatex(x);
        return /^-|[+-]/.test(s.slice(1)) || s.startsWith('-') ? '(' + s + ')' : s;
      };
      const latex = terms.map((t) => wrap(t.a) + ' \\cdot ' + wrap(t.b)).join(' + ') + ' = ' + scalarLatex(result.data[i][j]);
      row.push({ i, j, terms, value: result.data[i][j], latex });
    }
    entries.push(row);
  }
  return { result, entries };
}

/**
 * Transpose.
 * @param {Matrix} A
 * @returns {Matrix}
 */
export function transpose(A) {
  const out = [];
  for (let j = 0; j < A.cols; j++) out.push(A.data.map((r) => r[j]));
  return new Matrix(out);
}

/**
 * Conjugate transpose.
 * @param {Matrix} A
 * @returns {Matrix}
 */
export function adjoint(A) {
  return new Matrix(transpose(A).data.map((r) => r.map(F.conj)));
}

/**
 * @typedef {object} RowOp
 * @property {'swap'|'scale'|'add'} type
 * @property {number} i target row (0-based)
 * @property {number} [j] other row
 * @property {Scalar} [factor]
 */

/**
 * @typedef {object} MatrixStep
 * @property {RowOp|null} op the row operation (null for the starting matrix)
 * @property {string} rule plain-English name, e.g. "Subtract 3 R1 from R2"
 * @property {Matrix} matrix the matrix after the operation
 * @property {string} latex
 */

function describe(op) {
  const R = (k) => 'R' + (k + 1);
  if (op.type === 'swap') return 'Swap ' + R(op.i) + ' and ' + R(op.j);
  if (op.type === 'scale') return 'Scale ' + R(op.i) + ' by ' + plainScalar(op.factor);
  const f = op.factor;
  const neg = F.magnitude(f) > 0 && isNegativeScalar(f);
  const mag = neg ? F.neg(f) : f;
  const coeff = F.eq(mag, R1) ? '' : plainScalar(mag) + ' ';
  return (neg ? 'Subtract ' : 'Add ') + coeff + R(op.j) + (neg ? ' from ' : ' to ') + R(op.i);
}

function isNegativeScalar(x) {
  if (x instanceof Rational) return x.isNegative();
  if (x instanceof Surd) return x.d > 0n && F.toNumber(x) < 0;
  if (typeof x === 'number') return x < 0;
  return false;
}

function plainScalar(x) {
  if (x instanceof Rational) return x.toString();
  if (typeof x === 'number') return String(Number(x.toPrecision(6)));
  return scalarLatex(x);
}

function applyOp(M, op) {
  const d = M.data;
  if (op.type === 'swap') [d[op.i], d[op.j]] = [d[op.j], d[op.i]];
  else if (op.type === 'scale') d[op.i] = d[op.i].map((x) => F.mul(op.factor, x));
  else d[op.i] = d[op.i].map((x, c) => F.add(x, F.mul(op.factor, d[op.j][c])));
}

/**
 * @typedef {object} RrefResult
 * @property {Matrix} matrix reduced row echelon form
 * @property {number[]} pivots pivot columns
 * @property {number} rank
 * @property {MatrixStep[]} steps every row operation, starting with the input
 */

/**
 * Reduced row echelon form by Gauss-Jordan elimination, recording every row
 * swap, scaling and row addition. Exact matrices use the first non-zero
 * pivot; floating matrices use partial pivoting.
 * @param {Matrix|Array<Array<number|string>>} input
 * @param {{augment?: number, stopAtEchelon?: boolean}} [opts] augment: number of
 *   coefficient columns (pivots are only sought there); stopAtEchelon: stop
 *   at row echelon form (forward elimination only)
 * @returns {RrefResult}
 */
export function rref(input, opts = {}) {
  const M = matrix(input).clone();
  const tol = tolFor(M);
  const exact = M.isExact();
  const limitCols = opts.augment ?? M.cols;
  const steps = [{ op: null, rule: 'Start', matrix: M.clone(), latex: M.toLatex({ augment: opts.augment }) }];
  const record = (op) => {
    applyOp(M, op);
    if (!exact) M.data = M.data.map((r) => r.map((x) => (F.isZero(x, tol) ? 0 : x)));
    steps.push({ op, rule: describe(op), matrix: M.clone(), latex: M.toLatex({ augment: opts.augment }) });
  };
  const pivots = [];
  let r = 0;
  for (let c = 0; c < limitCols && r < M.rows; c++) {
    let p = -1;
    if (exact) {
      for (let i = r; i < M.rows; i++) if (!F.isZero(M.data[i][c])) {
        p = i;
        break;
      }
    } else {
      let best = tol;
      for (let i = r; i < M.rows; i++) {
        const m = F.magnitude(M.data[i][c]);
        if (m > best) {
          best = m;
          p = i;
        }
      }
    }
    if (p < 0) continue;
    if (p !== r) record({ type: 'swap', i: r, j: p });
    if (!opts.stopAtEchelon && !F.eq(M.data[r][c], R1)) record({ type: 'scale', i: r, factor: F.inv(M.data[r][c]) });
    const start = opts.stopAtEchelon ? r + 1 : 0;
    for (let i = start; i < M.rows; i++) {
      if (i === r || F.isZero(M.data[i][c], tol)) continue;
      const factor = F.neg(opts.stopAtEchelon ? F.div(M.data[i][c], M.data[r][c]) : M.data[i][c]);
      record({ type: 'add', i, j: r, factor });
    }
    pivots.push(c);
    r++;
  }
  return { matrix: M, pivots, rank: pivots.length, steps };
}

/**
 * Rank.
 * @param {Matrix|Array<Array<number|string>>} A
 * @returns {number}
 */
export function rank(A) {
  return rref(A).rank;
}

/**
 * Basis of the null space (columns vectors as arrays of scalars).
 * @param {Matrix|Array<Array<number|string>>} A
 * @returns {Scalar[][]}
 */
export function nullSpace(A) {
  const { matrix: R, pivots } = rref(A);
  const n = R.cols;
  const free = [];
  for (let c = 0; c < n; c++) if (!pivots.includes(c)) free.push(c);
  return free.map((f) => {
    const v = new Array(n).fill(R0);
    v[f] = R1;
    pivots.forEach((pc, row) => {
      v[pc] = F.neg(R.data[row][f]);
    });
    return v;
  });
}

/**
 * Basis of the column space: the pivot columns of A.
 * @param {Matrix|Array<Array<number|string>>} A
 * @returns {Scalar[][]}
 */
export function columnSpace(A) {
  const M = matrix(A);
  return rref(M).pivots.map((c) => M.data.map((r) => r[c]));
}

/**
 * @typedef {object} InverseResult
 * @property {boolean} ok
 * @property {Matrix} [inverse]
 * @property {MatrixStep[]} steps row reduction of [A | I]
 * @property {string} [reason]
 */

/**
 * Inverse by Gauss-Jordan elimination on [A | I].
 * @param {Matrix|Array<Array<number|string>>} input
 * @returns {InverseResult}
 */
export function inverse(input) {
  const A = matrix(input);
  if (A.rows !== A.cols) return { ok: false, reason: 'Only square matrices have inverses', steps: [] };
  const n = A.rows;
  const aug = new Matrix(A.data.map((r, i) => [...r, ...identity(n).data[i]]));
  const res = rref(aug, { augment: n });
  if (res.rank < n || res.pivots.some((p, i) => p !== i)) return { ok: false, reason: 'Matrix is singular', steps: res.steps };
  const inv = new Matrix(res.matrix.data.map((r) => r.slice(n)));
  return { ok: true, inverse: inv, steps: res.steps };
}

/**
 * @typedef {object} DeterminantResult
 * @property {Scalar} value
 * @property {'cofactor'|'elimination'} method
 * @property {{latex: string, rule: string, matrix?: Matrix}[]} steps
 */

function minor(A, i, j) {
  return new Matrix(A.data.filter((_, r) => r !== i).map((row) => row.filter((_, c) => c !== j)));
}

function detCofactor(A) {
  if (A.rows === 1) return A.data[0][0];
  if (A.rows === 2) return F.sub(F.mul(A.data[0][0], A.data[1][1]), F.mul(A.data[0][1], A.data[1][0]));
  let s = R0;
  for (let j = 0; j < A.cols; j++) {
    const term = F.mul(A.data[0][j], detCofactor(minor(A, 0, j)));
    s = j % 2 === 0 ? F.add(s, term) : F.sub(s, term);
  }
  return s;
}

function vmatrix(M) {
  return '\\begin{vmatrix}' + M.data.map((r) => r.map(scalarLatex).join(' & ')).join(' \\\\ ') + '\\end{vmatrix}';
}

/**
 * Determinant: cofactor expansion along the first row with steps for n <= 3,
 * elimination (product of pivots, sign flips for swaps) otherwise.
 * @param {Matrix|Array<Array<number|string>>} input
 * @returns {DeterminantResult}
 */
export function determinant(input) {
  const A = matrix(input);
  if (A.rows !== A.cols) throw new RangeError('Determinant needs a square matrix');
  const n = A.rows;
  if (n <= 3) {
    const steps = [{ rule: 'Start', latex: vmatrix(A) }];
    if (n === 2) {
      const [[a, b], [c, d]] = A.data;
      steps.push({ rule: 'ad - bc', latex: scalarLatex(a) + ' \\cdot ' + paren(d) + ' - ' + paren(b) + ' \\cdot ' + paren(c) });
    } else if (n === 3) {
      const parts = A.data[0].map((a, j) => (j === 1 ? '-' : j ? '+' : '') + paren(a) + vmatrix(minor(A, 0, j)));
      steps.push({ rule: 'Cofactor expansion along row 1', latex: parts.join(' ') });
      const vals = A.data[0].map((a, j) => (j === 1 ? '-' : j ? '+' : '') + paren(a) + ' \\cdot ' + paren(detCofactor(minor(A, 0, j))));
      steps.push({ rule: 'Evaluate the 2x2 minors', latex: vals.join(' ') });
    }
    const value = detCofactor(A);
    steps.push({ rule: 'Result', latex: scalarLatex(value) });
    return { value, method: 'cofactor', steps };
  }
  const res = rref(A, { stopAtEchelon: true });
  let sign = R1;
  for (const s of res.steps) if (s.op && s.op.type === 'swap') sign = sign.neg();
  let value = sign;
  for (let i = 0; i < n; i++) value = F.mul(value, res.matrix.data[i][i]);
  if (res.rank < n) value = R0;
  const steps = res.steps.map((s) => ({ rule: s.rule, latex: s.latex, matrix: s.matrix }));
  steps.push({ rule: 'Multiply the diagonal' + (sign.isNegative() ? ' and flip the sign for the odd number of swaps' : ''), latex: scalarLatex(value) });
  return { value, method: 'elimination', steps };
}

function paren(x) {
  const s = scalarLatex(x);
  return s.startsWith('-') || / [+-] /.test(s) ? '\\left(' + s + '\\right)' : s;
}

/**
 * @typedef {object} LinearSolution
 * @property {'unique'|'infinite'|'none'} kind
 * @property {Scalar[]} [solution] the unique solution, or a particular one
 * @property {Scalar[][]} [nullspace] directions of the solution family
 * @property {number[]} [freeVariables] indices of free variables
 * @property {MatrixStep[]} steps
 */

/**
 * Solve A x = b by Gauss-Jordan elimination on [A | b].
 * @param {Matrix|Array<Array<number|string>>} Ain
 * @param {Array<number|string|Scalar>|Matrix} bin
 * @returns {LinearSolution}
 */
export function solveLinear(Ain, bin) {
  const A = matrix(Ain);
  const b = bin instanceof Matrix ? bin.data.map((r) => r[0]) : bin.map(toScalar);
  if (b.length !== A.rows) throw new RangeError('Right-hand side has the wrong length');
  const aug = new Matrix(A.data.map((r, i) => [...r, b[i]]));
  const res = rref(aug, { augment: A.cols });
  const tol = tolFor(aug);
  const R = res.matrix;
  for (let i = res.rank; i < R.rows; i++) {
    if (!F.isZero(R.data[i][A.cols], tol * 10)) return { kind: 'none', steps: res.steps };
  }
  const x = new Array(A.cols).fill(R0);
  res.pivots.forEach((pc, row) => {
    x[pc] = R.data[row][A.cols];
  });
  const free = [];
  for (let c = 0; c < A.cols; c++) if (!res.pivots.includes(c)) free.push(c);
  if (!free.length) return { kind: 'unique', solution: x, steps: res.steps };
  const ns = free.map((f) => {
    const v = new Array(A.cols).fill(R0);
    v[f] = R1;
    res.pivots.forEach((pc, row) => {
      v[pc] = F.neg(R.data[row][f]);
    });
    return v;
  });
  return { kind: 'infinite', solution: x, nullspace: ns, freeVariables: free, steps: res.steps };
}

/**
 * Characteristic polynomial det(lambda I - A) of an exact matrix by the
 * Faddeev-LeVerrier algorithm (coefficients low degree first).
 * @param {Matrix|Array<Array<number|string>>} input
 * @returns {Rational[]}
 */
export function charPoly(input) {
  const A = matrix(input);
  if (A.rows !== A.cols) throw new RangeError('Characteristic polynomial needs a square matrix');
  if (!A.data.every((r) => r.every((x) => x instanceof Rational))) throw new RangeError('charPoly needs rational entries');
  const n = A.rows;
  const coeffs = new Array(n + 1).fill(R0);
  coeffs[n] = R1;
  let Mk = zeros(n, n);
  for (let k = 1; k <= n; k++) {
    const AM = matMul(A, Mk);
    const prev = coeffs[n - k + 1];
    Mk = new Matrix(AM.data.map((r, i) => r.map((x, j) => (i === j ? F.add(x, prev) : x))));
    const AMk = matMul(A, Mk);
    let tr = R0;
    for (let i = 0; i < n; i++) tr = F.add(tr, AMk.data[i][i]);
    coeffs[n - k] = tr.mul(new Rational(-1n, BigInt(k)));
  }
  return coeffs;
}

/**
 * @typedef {object} Eigenpair
 * @property {Scalar} value eigenvalue
 * @property {string} latex
 * @property {number} multiplicity algebraic multiplicity
 * @property {Scalar[][]} vectors basis of the eigenspace
 * @property {boolean} exact
 */

/**
 * Eigenvalues and eigenvectors. Rational matrices use the characteristic
 * polynomial: rational roots and quadratic surds (including complex ones)
 * stay exact and their eigenvectors are exact; other roots are found
 * numerically. Floating matrices use Jacobi rotations when symmetric and the
 * shifted QR algorithm otherwise, with inverse iteration for eigenvectors.
 * @param {Matrix|Array<Array<number|string>>} input
 * @returns {{values: Eigenpair[], exact: boolean, charPoly?: Rational[]}}
 */
export function eigen(input) {
  const A = matrix(input);
  if (A.rows !== A.cols) throw new RangeError('Eigenvalues need a square matrix');
  const rational = A.data.every((r) => r.every((x) => x instanceof Rational));
  if (rational) {
    const cp = charPoly(A);
    const fr = factorRational(cp);
    const out = [];
    for (const { poly, mult } of fr.factors) {
      const deg = pDeg(poly);
      let roots;
      let exact = true;
      if (deg === 1) roots = [poly[0].neg().div(poly[1])];
      else if (deg === 2) {
        const [c, b, a] = poly;
        const disc = b.mul(b).sub(a.mul(c).mul(Rational.from(4)));
        const sq = sqrtRational(disc);
        const twoA = a.mul(Rational.from(2));
        const base = b.neg().div(twoA);
        roots = [F.sub(base, F.div(sq, twoA)), F.add(base, F.div(sq, twoA))];
      } else {
        roots = polyRootsNumeric(poly.map((q) => q.toNumber())).map((z) => (z.im === 0 ? z.re : z));
        exact = false;
      }
      for (const lam of roots) {
        const vectors = exact ? nullSpace(shift(A, lam)) : numericEigenvectors(A, lam, mult);
        out.push({ value: lam, latex: scalarLatex(lam), multiplicity: mult, vectors, exact });
      }
    }
    out.sort((p, q) => F.toComplex(p.value).re - F.toComplex(q.value).re || F.toComplex(p.value).im - F.toComplex(q.value).im);
    return { values: out, exact: out.every((e) => e.exact), charPoly: cp };
  }
  const vals = numericEigenvalues(A);
  const groups = [];
  for (const v of vals) {
    const g = groups.find((q) => q.value.sub(v).abs() < 1e-7 * (1 + v.abs()));
    if (g) g.multiplicity++;
    else groups.push({ value: v, multiplicity: 1 });
  }
  const values = groups.map((g) => {
    const lam = g.value.isReal(1e-10) ? g.value.re : g.value;
    return { value: lam, latex: scalarLatex(lam), multiplicity: g.multiplicity, vectors: numericEigenvectors(A, lam, g.multiplicity), exact: false };
  });
  values.sort((p, q) => F.toComplex(p.value).re - F.toComplex(q.value).re || F.toComplex(p.value).im - F.toComplex(q.value).im);
  return { values, exact: false };
}

function shift(A, lam) {
  return new Matrix(A.data.map((r, i) => r.map((x, j) => (i === j ? F.sub(x, lam) : x))));
}

// Complex dense helpers for numeric algorithms.
function toComplexRows(A) {
  return A.data.map((r) => r.map((x) => F.toComplex(x)));
}

function numericEigenvalues(A) {
  const n = A.rows;
  const real = A.data.every((r) => r.every((x) => !(x instanceof Complex) && !(x instanceof Surd && x.d < 0n)));
  if (real) {
    const M = A.toNumbers();
    let sym = true;
    for (let i = 0; i < n && sym; i++) for (let j = 0; j < i; j++) if (Math.abs(M[i][j] - M[j][i]) > 1e-12 * (1 + Math.abs(M[i][j]))) sym = false;
    if (sym) return jacobiEigen(M).values.map((v) => new Complex(v, 0));
  }
  return qrEigenvalues(toComplexRows(A));
}

/**
 * Jacobi eigenvalue algorithm for a real symmetric matrix.
 * @param {number[][]} S
 * @returns {{values: number[], vectors: number[][]}} vectors[k] is the k-th unit eigenvector
 */
export function jacobiEigen(S) {
  const n = S.length;
  const a = S.map((r) => r.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = a.map((r, i) => i).sort((i, j) => a[i][i] - a[j][j]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => V.map((r) => r[i])) };
}

// Shifted QR on the upper Hessenberg form, in complex arithmetic.
function qrEigenvalues(M) {
  let n = M.length;
  const H = M.map((r) => r.slice());
  // Hessenberg reduction by Householder reflections.
  for (let k = 0; k < n - 2; k++) {
    const x = [];
    for (let i = k + 1; i < n; i++) x.push(H[i][k]);
    const alpha = Math.hypot(...x.map((z) => z.abs()));
    if (alpha < 1e-300) continue;
    const phase = x[0].abs() > 0 ? x[0].div(x[0].abs()) : new Complex(1, 0);
    const v = x.slice();
    v[0] = v[0].add(phase.mul(alpha));
    const vn = Math.hypot(...v.map((z) => z.abs()));
    for (let i = 0; i < v.length; i++) v[i] = v[i].div(vn);
    // H = (I - 2 v v*) H (I - 2 v v*)
    for (let j = 0; j < n; j++) {
      let s = new Complex(0, 0);
      for (let i = 0; i < v.length; i++) s = s.add(v[i].conj().mul(H[k + 1 + i][j]));
      for (let i = 0; i < v.length; i++) H[k + 1 + i][j] = H[k + 1 + i][j].sub(v[i].mul(s).mul(2));
    }
    for (let i = 0; i < n; i++) {
      let s = new Complex(0, 0);
      for (let j = 0; j < v.length; j++) s = s.add(H[i][k + 1 + j].mul(v[j]));
      for (let j = 0; j < v.length; j++) H[i][k + 1 + j] = H[i][k + 1 + j].sub(s.mul(v[j].conj()).mul(2));
    }
  }
  const values = [];
  let iter = 0;
  while (n > 0) {
    if (n === 1) {
      values.push(H[0][0]);
      break;
    }
    // Deflate when the last subdiagonal entry is negligible.
    const sub = H[n - 1][n - 2].abs();
    const scale = H[n - 1][n - 1].abs() + H[n - 2][n - 2].abs();
    if (sub <= 1e-14 * (scale || 1) || iter > 10000) {
      values.push(H[n - 1][n - 1]);
      n--;
      iter = 0;
      continue;
    }
    iter++;
    // Wilkinson shift from the trailing 2x2 block.
    const a = H[n - 2][n - 2];
    const b = H[n - 2][n - 1];
    const c = H[n - 1][n - 2];
    const d = H[n - 1][n - 1];
    const tr = a.add(d);
    const det = a.mul(d).sub(b.mul(c));
    const disc = tr.mul(tr).sub(det.mul(4)).sqrt();
    const l1 = tr.add(disc).div(2);
    const l2 = tr.sub(disc).div(2);
    let mu = l1.sub(d).abs() < l2.sub(d).abs() ? l1 : l2;
    if (iter % 11 === 10) mu = mu.add(new Complex(sub, sub));
    // QR step on the leading n x n block via Givens rotations.
    for (let i = 0; i < n; i++) H[i][i] = H[i][i].sub(mu);
    const rots = [];
    for (let k = 0; k < n - 1; k++) {
      const x = H[k][k];
      const y = H[k + 1][k];
      const r = Math.hypot(x.abs(), y.abs());
      if (r === 0) {
        rots.push(null);
        continue;
      }
      const cs = x.div(r);
      const sn = y.div(r);
      rots.push([cs, sn]);
      for (let j = k; j < n; j++) {
        const t1 = H[k][j];
        const t2 = H[k + 1][j];
        H[k][j] = cs.conj().mul(t1).add(sn.conj().mul(t2));
        H[k + 1][j] = sn.neg().mul(t1).add(cs.mul(t2));
      }
    }
    for (let k = 0; k < n - 1; k++) {
      const rot = rots[k];
      if (!rot) continue;
      const [cs, sn] = rot;
      for (let i = 0; i < Math.min(n, k + 2); i++) {
        const t1 = H[i][k];
        const t2 = H[i][k + 1];
        H[i][k] = t1.mul(cs).add(t2.mul(sn));
        H[i][k + 1] = t1.mul(sn.conj().neg()).add(t2.mul(cs.conj()));
      }
    }
    for (let i = 0; i < n; i++) H[i][i] = H[i][i].add(mu);
  }
  return values;
}

// Complex Gaussian elimination null space with a tolerance.
function complexNullSpace(M, tol) {
  const rows = M.length;
  const cols = M[0].length;
  const A = M.map((r) => r.slice());
  const pivots = [];
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    let p = -1;
    let best = tol;
    for (let i = r; i < rows; i++) if (A[i][c].abs() > best) {
      best = A[i][c].abs();
      p = i;
    }
    if (p < 0) continue;
    [A[r], A[p]] = [A[p], A[r]];
    const inv = new Complex(1, 0).div(A[r][c]);
    A[r] = A[r].map((z) => z.mul(inv));
    for (let i = 0; i < rows; i++) {
      if (i === r) continue;
      const f = A[i][c];
      if (f.abs() === 0) continue;
      A[i] = A[i].map((z, j) => z.sub(f.mul(A[r][j])));
    }
    pivots.push(c);
    r++;
  }
  const out = [];
  for (let f = 0; f < cols; f++) {
    if (pivots.includes(f)) continue;
    const v = new Array(cols).fill(null).map(() => new Complex(0, 0));
    v[f] = new Complex(1, 0);
    pivots.forEach((pc, row) => {
      v[pc] = A[row][f].neg();
    });
    out.push(v);
  }
  return out;
}

function normalizeVector(v) {
  const norm = Math.hypot(...v.map((z) => z.abs()));
  let k = 0;
  for (let i = 0; i < v.length; i++) if (v[i].abs() > v[k].abs()) k = i;
  const phase = v[k].abs() > 0 ? v[k].conj().div(v[k].abs()) : new Complex(1, 0);
  return v.map((z) => z.mul(phase).div(norm));
}

function numericEigenvectors(A, lam, mult) {
  const n = A.rows;
  const L = F.toComplex(lam);
  const M = toComplexRows(A).map((r, i) => r.map((z, j) => (i === j ? z.sub(L) : z)));
  let scale = 0;
  for (const r of M) for (const z of r) scale = Math.max(scale, z.abs());
  let basis = [];
  for (const tol of [1e-10, 1e-8, 1e-6]) {
    basis = complexNullSpace(M, tol * Math.max(1, scale));
    if (basis.length >= 1) break;
  }
  if (!basis.length || (mult === 1 && basis.length > 1)) {
    // Inverse iteration on (A - (lambda + eps) I).
    const eps = 1e-10 * Math.max(1, L.abs());
    const S = M.map((r, i) => r.map((z, j) => (i === j ? z.sub(new Complex(eps, 0)) : z)));
    let v = Array.from({ length: n }, (_, i) => new Complex(1 / Math.sqrt(n) + 0.01 * i, 0));
    for (let it = 0; it < 3; it++) v = normalizeVector(complexSolve(S, v));
    basis = [v];
  }
  const cleaned = basis.map(normalizeVector);
  const real = cleaned.every((v) => v.every((z) => Math.abs(z.im) < 1e-9));
  return cleaned.map((v) => v.map((z) => (real ? z.re : z)));
}

function complexSolve(M, b) {
  const n = M.length;
  const A = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (A[i][c].abs() > A[p][c].abs()) p = i;
    [A[c], A[p]] = [A[p], A[c]];
    if (A[c][c].abs() < 1e-300) A[c][c] = new Complex(1e-300, 0);
    for (let i = c + 1; i < n; i++) {
      const f = A[i][c].div(A[c][c]);
      for (let j = c; j <= n; j++) A[i][j] = A[i][j].sub(f.mul(A[c][j]));
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = A[i][n];
    for (let j = i + 1; j < n; j++) s = s.sub(A[i][j].mul(x[j]));
    x[i] = s.div(A[i][i]);
  }
  return x;
}

/**
 * @typedef {object} Diagonalization
 * @property {boolean} ok
 * @property {Matrix} [P] eigenvectors as columns
 * @property {Matrix} [D] diagonal matrix of eigenvalues
 * @property {Matrix} [Pinv]
 * @property {string} [reason]
 */

/**
 * Diagonalize A = P D P^-1 when A has a full set of eigenvectors.
 * @param {Matrix|Array<Array<number|string>>} input
 * @returns {Diagonalization}
 */
export function diagonalize(input) {
  const A = matrix(input);
  const { values } = eigen(A);
  const cols = [];
  const diag = [];
  for (const e of values) {
    if (e.vectors.length < e.multiplicity) {
      return { ok: false, reason: 'Matrix is not diagonalizable: eigenvalue ' + e.latex + ' has multiplicity ' + e.multiplicity + ' but only ' + e.vectors.length + ' independent eigenvector(s)' };
    }
    for (const v of e.vectors.slice(0, e.multiplicity)) {
      cols.push(v);
      diag.push(e.value);
    }
  }
  const n = A.rows;
  const P = new Matrix(Array.from({ length: n }, (_, i) => cols.map((v) => toScalar(v[i]))));
  const D = new Matrix(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? diag[i] : R0))));
  const inv = inverse(P);
  if (!inv.ok) return { ok: false, reason: 'Eigenvectors are not independent' };
  return { ok: true, P, D, Pinv: inv.inverse };
}

/**
 * Singular value decomposition A = U diag(S) V^T (real matrices, numeric,
 * one-sided Jacobi). Thin form: U is m x k, V is n x k with k = min(m, n).
 * @param {Matrix|Array<Array<number|string>>} input
 * @returns {{U: number[][], S: number[], V: number[][]}}
 */
export function svd(input) {
  const A0 = matrix(input).toNumbers();
  const m = A0.length;
  const n = A0[0].length;
  if (m < n) {
    const t = svd(transpose(matrix(input)));
    return { U: t.V, S: t.S, V: t.U };
  }
  const U = A0.map((r) => r.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 80; sweep++) {
    let rotated = false;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < m; i++) {
          alpha += U[i][p] * U[i][p];
          beta += U[i][q] * U[i][q];
          gamma += U[i][p] * U[i][q];
        }
        if (Math.abs(gamma) <= 1e-15 * Math.sqrt(alpha * beta) || gamma === 0) continue;
        rotated = true;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        for (let i = 0; i < m; i++) {
          const up = U[i][p];
          const uq = U[i][q];
          U[i][p] = c * up - s * uq;
          U[i][q] = s * up + c * uq;
        }
        for (let i = 0; i < n; i++) {
          const vp = V[i][p];
          const vq = V[i][q];
          V[i][p] = c * vp - s * vq;
          V[i][q] = s * vp + c * vq;
        }
      }
    }
    if (!rotated) break;
  }
  const S = [];
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += U[i][j] * U[i][j];
    S.push(Math.sqrt(s));
  }
  const order = S.map((_, i) => i).sort((i, j) => S[j] - S[i]);
  const Uo = [];
  for (let i = 0; i < m; i++) Uo.push(order.map((j) => (S[j] > 1e-300 ? U[i][j] / S[j] : 0)));
  // Complete columns of U for zero singular values with an orthonormal fill.
  order.forEach((j, col) => {
    if (S[j] > 1e-13 * (S[order[0]] || 1)) return;
    const v = new Array(m).fill(0);
    for (let e = 0; e < m; e++) {
      v.fill(0);
      v[e] = 1;
      for (let c2 = 0; c2 < col; c2++) {
        let d = 0;
        for (let i = 0; i < m; i++) d += Uo[i][c2] * v[i];
        for (let i = 0; i < m; i++) v[i] -= d * Uo[i][c2];
      }
      const nv = Math.hypot(...v);
      if (nv > 1e-6) {
        for (let i = 0; i < m; i++) Uo[i][col] = v[i] / nv;
        break;
      }
    }
  });
  return { U: Uo, S: order.map((j) => S[j]), V: V.map((r) => order.map((j) => r[j])) };
}

/**
 * Householder QR (numeric): A = Q R with Q orthogonal m x m, R upper m x n.
 * @param {Matrix|Array<Array<number|string>>} input
 * @returns {{Q: number[][], R: number[][]}}
 */
export function qrHouseholder(input) {
  const R = matrix(input).toNumbers();
  const m = R.length;
  const n = R[0].length;
  const Q = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => (i === j ? 1 : 0)));
  for (let k = 0; k < Math.min(m - 1, n); k++) {
    const x = [];
    for (let i = k; i < m; i++) x.push(R[i][k]);
    const alpha = -Math.sign(x[0] || 1) * Math.hypot(...x);
    const v = x.slice();
    v[0] -= alpha;
    const vn = Math.hypot(...v);
    if (vn < 1e-300) continue;
    for (let i = 0; i < v.length; i++) v[i] /= vn;
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let i = 0; i < v.length; i++) s += v[i] * R[k + i][j];
      for (let i = 0; i < v.length; i++) R[k + i][j] -= 2 * v[i] * s;
    }
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = 0; j < v.length; j++) s += Q[i][k + j] * v[j];
      for (let j = 0; j < v.length; j++) Q[i][k + j] -= 2 * s * v[j];
    }
  }
  for (let i = 0; i < m; i++) for (let j = 0; j < Math.min(i, n); j++) if (Math.abs(R[i][j]) < 1e-14) R[i][j] = 0;
  return { Q, R };
}

function dot(u, v) {
  let s = R0;
  for (let i = 0; i < u.length; i++) s = F.add(s, F.mul(F.conj(u[i]), v[i]));
  return s;
}

/**
 * @typedef {object} GramSchmidtStep
 * @property {number} k index of the vector being orthogonalized
 * @property {{j: number, coefficient: Scalar}[]} projections coefficients (v_k . u_j)/(u_j . u_j)
 * @property {Scalar[]} result the orthogonal vector u_k
 * @property {string} latex u_k = v_k - sum of projections
 */

/**
 * Gram-Schmidt with steps. Exact inputs give exact orthogonal vectors and
 * orthonormal vectors with entries such as sqrt(2)/2.
 * @param {Array<Array<number|string|Scalar>>} vectors
 * @returns {{orthogonal: Scalar[][], orthonormal: Scalar[][], orthonormalLatex: string[], steps: GramSchmidtStep[], dependent: number[]}}
 */
export function gramSchmidt(vectors) {
  const vs = vectors.map((v) => v.map(toScalar));
  const us = [];
  const steps = [];
  const dependent = [];
  const idx = [];
  vs.forEach((v, k) => {
    let u = v.slice();
    const projections = [];
    us.forEach((uj, j) => {
      const c = F.div(dot(uj, v), dot(uj, uj));
      projections.push({ j: idx[j], coefficient: c });
      u = u.map((x, i) => F.sub(x, F.mul(c, uj[i])));
    });
    const vecLatex = (w) => '\\begin{bmatrix}' + w.map(scalarLatex).join(' \\\\ ') + '\\end{bmatrix}';
    const latex = 'u_{' + (k + 1) + '} = ' + vecLatex(v) + projections.map((p) => ' - ' + paren(p.coefficient) + ' u_{' + (p.j + 1) + '}').join('') + ' = ' + vecLatex(u);
    const zero = u.every((x) => F.isZero(x, 1e-12));
    steps.push({ k, projections, result: u, latex });
    if (zero) dependent.push(k);
    else {
      us.push(u);
      idx.push(k);
    }
  });
  const orthonormal = [];
  const orthonormalLatex = [];
  for (const u of us) {
    const nn = dot(u, u);
    let unit;
    if (nn instanceof Rational) {
      const inv = sqrtRational(nn.inv());
      unit = u.map((x) => F.mul(x, inv));
      orthonormalLatex.push('\\begin{bmatrix}' + u.map((x) => scalarLatexExpr(simplify(mul(scalarToExpr(x), pow(num(nn), num('-1/2')))))).join(' \\\\ ') + '\\end{bmatrix}');
    } else {
      const len = Math.sqrt(F.magnitude(nn));
      unit = u.map((x) => F.div(x, len));
      orthonormalLatex.push('\\begin{bmatrix}' + unit.map(scalarLatex).join(' \\\\ ') + '\\end{bmatrix}');
    }
    orthonormal.push(unit);
  }
  return { orthogonal: us, orthonormal, orthonormalLatex, steps, dependent };
}

function scalarLatexExpr(e) {
  return scalarLatex(toScalarFromExpr(e));
}

function toScalarFromExpr(e) {
  // Expressions here are rational multiples of a square root; keep them as surds.
  if (e.type === 'num') return e.value;
  const parts = e.type === 'mul' ? e.args : [e];
  let c = R1;
  let rad = null;
  for (const p of parts) {
    if (p.type === 'num') c = c.mul(p.value);
    else if (p.type === 'pow' && p.args[0].type === 'num' && p.args[1].type === 'num' && p.args[1].value.eq(Rational.from('1/2'))) rad = p.args[0].value;
  }
  return rad ? Surd.make(R0, c, rad.n) : c;
}

/**
 * QR by Gram-Schmidt on the columns of A: returns the steps and numeric Q, R.
 * @param {Matrix|Array<Array<number|string>>} input
 * @returns {{Q: number[][], R: number[][], steps: GramSchmidtStep[]}}
 */
export function qrGramSchmidt(input) {
  const A = matrix(input);
  const cols = transpose(A).data;
  const gs = gramSchmidt(cols);
  if (gs.dependent.length) throw new RangeError('Columns are linearly dependent; use qrHouseholder');
  const Qc = gs.orthonormal.map((v) => v.map((x) => F.toNumber(x)));
  const m = A.rows;
  const n = A.cols;
  const Q = Array.from({ length: m }, (_, i) => Qc.map((col) => col[i]));
  const An = A.toNumbers();
  const R = Array.from({ length: A.cols }, (_, i) => Array.from({ length: n }, (_, j) => {
    if (j < i) return 0;
    let s = 0;
    for (let k = 0; k < m; k++) s += Q[k][i] * An[k][j];
    return s;
  }));
  return { Q, R, steps: gs.steps };
}

/**
 * LU factorization with partial pivoting (largest pivot in each column):
 * P A = L U.
 * @param {Matrix|Array<Array<number|string>>} input
 * @returns {{P: Matrix, L: Matrix, U: Matrix, steps: {rule: string, latex: string}[], singular: boolean}}
 */
export function lu(input) {
  const A = matrix(input);
  if (A.rows !== A.cols) throw new RangeError('LU needs a square matrix');
  const n = A.rows;
  const exact = A.isExact();
  const U = A.clone().data;
  const L = identity(n).data;
  const perm = [...Array(n).keys()];
  const steps = [];
  let singular = false;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (F.magnitude(U[i][c]) > F.magnitude(U[p][c])) p = i;
    if (exact ? F.isZero(U[p][c]) : F.magnitude(U[p][c]) < 1e-300) {
      singular = true;
      continue;
    }
    if (p !== c) {
      [U[p], U[c]] = [U[c], U[p]];
      [perm[p], perm[c]] = [perm[c], perm[p]];
      for (let j = 0; j < c; j++) [L[p][j], L[c][j]] = [L[c][j], L[p][j]];
      steps.push({ rule: 'Swap R' + (c + 1) + ' and R' + (p + 1), latex: new Matrix(U.map((r) => r.slice())).toLatex() });
    }
    for (let i = c + 1; i < n; i++) {
      if (F.isZero(U[i][c])) continue;
      const m = F.div(U[i][c], U[c][c]);
      L[i][c] = m;
      U[i] = U[i].map((x, j) => F.sub(x, F.mul(m, U[c][j])));
      steps.push({ rule: describe({ type: 'add', i, j: c, factor: F.neg(m) }) + ' (multiplier ' + plainScalar(m) + ' stored in L)', latex: new Matrix(U.map((r) => r.slice())).toLatex() });
    }
  }
  const P = new Matrix(perm.map((pi) => Array.from({ length: n }, (_, j) => (j === pi ? R1 : R0))));
  return { P, L: new Matrix(L), U: new Matrix(U), steps, singular };
}

/**
 * Coordinates of v in the basis given by the columns of B (solves B c = v).
 * @param {Array<number|string|Scalar>} v
 * @param {Matrix|Array<Array<number|string>>} B basis vectors as columns
 * @returns {Scalar[]}
 */
export function coordinates(v, B) {
  const sol = solveLinear(B, v);
  if (sol.kind !== 'unique') throw new RangeError('The columns of B are not a basis for the vector');
  return sol.solution;
}

/**
 * Matrix of the linear map A in the basis B: B^-1 A B.
 * @param {Matrix|Array<Array<number|string>>} A
 * @param {Matrix|Array<Array<number|string>>} B basis vectors as columns
 * @returns {Matrix}
 */
export function changeOfBasis(A, B) {
  const inv = inverse(B);
  if (!inv.ok) throw new RangeError('B is not a basis (singular)');
  return matMul(matMul(inv.inverse, matrix(A)), matrix(B));
}

/**
 * Orthogonal projection matrix onto the column space of A:
 * P = A (A^T A)^-1 A^T.
 * @param {Matrix|Array<Array<number|string>>} Ain columns span the subspace
 * @returns {Matrix}
 */
export function projectionMatrix(Ain) {
  const A = matrix(Ain);
  const At = transpose(A);
  const inv = inverse(matMul(At, A));
  if (!inv.ok) throw new RangeError('Columns of A must be linearly independent');
  return matMul(matMul(A, inv.inverse), At);
}

/**
 * Project a vector onto the column space of A.
 * @param {Array<number|string|Scalar>} v
 * @param {Matrix|Array<Array<number|string>>} A
 * @returns {Scalar[]}
 */
export function project(v, A) {
  const P = projectionMatrix(A);
  return matMul(P, vector(v)).data.map((r) => r[0]);
}

/**
 * Least squares solution of A x ~ b by the normal equations
 * A^T A x = A^T b, with steps.
 * @param {Matrix|Array<Array<number|string>>} Ain
 * @param {Array<number|string|Scalar>} b
 * @returns {{x: Scalar[], residual: Scalar[], steps: {rule: string, latex: string}[]}}
 */
export function leastSquares(Ain, b) {
  const A = matrix(Ain);
  const bv = vector(b);
  const At = transpose(A);
  const AtA = matMul(At, A);
  const Atb = matMul(At, bv);
  const steps = [
    { rule: 'Normal equations', latex: 'A^{T}A\\,\\hat{x} = A^{T}b' },
    { rule: 'Compute A^T A', latex: 'A^{T}A = ' + AtA.toLatex() },
    { rule: 'Compute A^T b', latex: 'A^{T}b = ' + Atb.toLatex() },
  ];
  const sol = solveLinear(AtA, Atb.data.map((r) => r[0]));
  if (sol.kind === 'none') throw new RangeError('Normal equations are inconsistent');
  for (const s of sol.steps.slice(1)) steps.push({ rule: s.rule, latex: s.latex });
  const x = sol.solution;
  const fitted = matMul(A, vector(x)).data.map((r) => r[0]);
  const residual = bv.data.map((r, i) => F.sub(r[0], fitted[i]));
  steps.push({ rule: 'Solution', latex: '\\hat{x} = \\begin{bmatrix}' + x.map(scalarLatex).join(' \\\\ ') + '\\end{bmatrix}' });
  return { x, residual, steps };
}

/**
 * Polar decomposition of a real 2x2 matrix A = R S with R a rotation by
 * `angle` and S symmetric. When det A < 0 a reflection F = diag(1, -1) is
 * split off: A = R S F.
 * @param {number[][]} A
 * @returns {{angle: number, S: number[][], reflect: boolean}}
 */
export function polar2D(A) {
  const reflect = A[0][0] * A[1][1] - A[0][1] * A[1][0] < 0;
  const B = reflect ? [[A[0][0], -A[0][1]], [A[1][0], -A[1][1]]] : A;
  const angle = Math.atan2(B[1][0] - B[0][1], B[0][0] + B[1][1]);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const S = [
    [c * B[0][0] + s * B[1][0], c * B[0][1] + s * B[1][1]],
    [-s * B[0][0] + c * B[1][0], -s * B[0][1] + c * B[1][1]],
  ];
  const sym = (S[0][1] + S[1][0]) / 2;
  return { angle, S: [[S[0][0], sym], [sym, S[1][1]]], reflect };
}

/**
 * A point on a smooth path from the identity (t = 0) to the 2x2 matrix A
 * (t = 1). 'linear' interpolates entries; 'polar' rotates by t times the
 * rotation angle of the polar decomposition while stretching linearly,
 * which turns grids instead of shearing them.
 * @param {number[][]|Matrix} Ain
 * @param {number} t in [0, 1]
 * @param {'linear'|'polar'} [method='polar']
 * @returns {number[][]}
 */
export function interpolateMatrix2D(Ain, t, method = 'polar') {
  const A = Ain instanceof Matrix ? Ain.toNumbers() : Ain.map((r) => r.map(Number));
  if (A.length !== 2 || A[0].length !== 2) throw new RangeError('interpolateMatrix2D needs a 2x2 matrix');
  if (method === 'linear') return [[1 - t + t * A[0][0], t * A[0][1]], [t * A[1][0], 1 - t + t * A[1][1]]];
  const { angle, S, reflect } = polar2D(A);
  const c = Math.cos(t * angle);
  const s = Math.sin(t * angle);
  const St = [[1 - t + t * S[0][0], t * S[0][1]], [t * S[1][0], 1 - t + t * S[1][1]]];
  const Ft = reflect ? [[1, 0], [0, 1 - 2 * t]] : [[1, 0], [0, 1]];
  const RS = [
    [c * St[0][0] - s * St[1][0], c * St[0][1] - s * St[1][1]],
    [s * St[0][0] + c * St[1][0], s * St[0][1] + c * St[1][1]],
  ];
  return [
    [RS[0][0] * Ft[0][0] + RS[0][1] * Ft[1][0], RS[0][0] * Ft[0][1] + RS[0][1] * Ft[1][1]],
    [RS[1][0] * Ft[0][0] + RS[1][1] * Ft[1][0], RS[1][0] * Ft[0][1] + RS[1][1] * Ft[1][1]],
  ];
}

