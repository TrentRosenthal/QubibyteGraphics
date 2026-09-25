import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matrix, vector, identity, matMul, matAdd, matSub, matScale, multiply, transpose, adjoint, rref, rank, nullSpace, columnSpace,
  inverse, determinant, solveLinear, charPoly, eigen, diagonalize, svd, qrHouseholder, gramSchmidt, qrGramSchmidt, lu,
  coordinates, changeOfBasis, projectionMatrix, project, leastSquares, interpolateMatrix2D, polar2D, jacobiEigen,
  scalarOps as F, Rational, Surd, SeededRandom, Complex, scalarLatex, toScalar,
} from '../../src/math/index.js';

const rng = new SeededRandom(99);

function randomRational(rows, cols, rankTarget) {
  // Product of random integer factors gives a matrix of the requested rank.
  const r = rankTarget ?? Math.min(rows, cols);
  const A = Array.from({ length: rows }, () => Array.from({ length: r }, () => String(rng.int(-4, 4)) + '/' + rng.int(1, 3)));
  const B = Array.from({ length: r }, () => Array.from({ length: cols }, () => rng.int(-3, 3)));
  return matMul(matrix(A), matrix(B));
}

function assertMatrixClose(A, B, tol = 1e-9) {
  const a = A.toNumbers ? A.toNumbers() : A;
  const b = B.toNumbers ? B.toNumbers() : B;
  assert.equal(a.length, b.length);
  a.forEach((row, i) => row.forEach((x, j) => assert.ok(Math.abs(x - b[i][j]) <= tol * (1 + Math.abs(b[i][j])), `entry ${i},${j}: ${x} vs ${b[i][j]}`)));
}

function exactEqual(A, B) {
  return A.data.every((row, i) => row.every((x, j) => F.eq(x, B.data[i][j])));
}

test('construction, arithmetic and the product breakdown', () => {
  const A = matrix([[1, 2], [3, 4]]);
  const B = matrix([[5, 6], [7, 8]]);
  assert.ok(A.isExact());
  assert.equal(matrix([[0.5, 1]]).isExact(), false);
  assert.equal(matrix([['1/2', 1]]).get(0, 0).toString(), '1/2');
  const { result, entries } = multiply(A, B);
  assert.equal(result.toLatex(), '\\begin{bmatrix}19 & 22 \\\\ 43 & 50\\end{bmatrix}');
  assert.equal(entries[0][0].latex, '1 \\cdot 5 + 2 \\cdot 7 = 19');
  assert.deepEqual(entries[1][1].terms.map((t) => t.product.toString()), ['18', '32']);
  assert.ok(exactEqual(matSub(matAdd(A, B), B), A));
  assert.ok(exactEqual(matScale(A, 2), matAdd(A, A)));
  assert.ok(exactEqual(transpose(transpose(A)), A));
  assert.throws(() => matMul(A, matrix([[1, 2, 3]])), /Inner dimensions/);
  const C = matrix([[{ re: 1, im: 2 }, 0], [0, 1]]);
  assert.ok(adjoint(C).get(0, 0).equals(new Complex(1, -2)));
  assert.equal(identity(3).toLatex(), '\\begin{bmatrix}1 & 0 & 0 \\\\ 0 & 1 & 0 \\\\ 0 & 0 & 1\\end{bmatrix}');
});

test('RREF records every row operation and agrees with rank and consistency', () => {
  const r = rref([[1, 2, 3], [4, 5, 6], [7, 8, 10]]);
  assert.equal(r.rank, 3);
  assert.deepEqual(r.steps.slice(0, 4).map((s) => s.rule), ['Start', 'Subtract 4 R1 from R2', 'Subtract 7 R1 from R3', 'Scale R2 by -1/3']);
  assert.ok(exactEqual(r.matrix, identity(3)));
  const swap = rref([[0, 1], [1, 0]]);
  assert.equal(swap.steps[1].rule, 'Swap R1 and R2');
  assert.deepEqual(swap.steps[1].op, { type: 'swap', i: 0, j: 1 });
  for (let trial = 0; trial < 25; trial++) {
    const rows = rng.int(2, 5);
    const cols = rng.int(2, 5);
    const target = rng.int(1, Math.min(rows, cols));
    const A = randomRational(rows, cols, target);
    const res = rref(A);
    assert.equal(res.rank, target);
    // Replaying the recorded operations reproduces the final matrix.
    const M = A.clone();
    for (const s of res.steps.slice(1)) {
      const { op } = s;
      if (op.type === 'swap') [M.data[op.i], M.data[op.j]] = [M.data[op.j], M.data[op.i]];
      else if (op.type === 'scale') M.data[op.i] = M.data[op.i].map((x) => F.mul(op.factor, x));
      else M.data[op.i] = M.data[op.i].map((x, c) => F.add(x, F.mul(op.factor, M.data[op.j][c])));
    }
    assert.ok(exactEqual(M, res.matrix));
    // Pivot columns are 1 with zeros elsewhere; A times each null vector is 0.
    res.pivots.forEach((c, row) => res.matrix.data.forEach((r2, i) => assert.ok(F.eq(r2[c], i === row ? Rational.from(1) : Rational.from(0)))));
    for (const v of nullSpace(A)) assert.ok(matMul(A, vector(v)).data.every((x) => F.isZero(x[0])));
    assert.equal(nullSpace(A).length, cols - target);
    assert.equal(columnSpace(A).length, target);
    // A consistent right side (A times a vector) solves; a random one is detected when rank < rows.
    const x0 = Array.from({ length: cols }, () => rng.int(-3, 3));
    const b = matMul(A, vector(x0)).data.map((q) => q[0]);
    const sol = solveLinear(A, b);
    assert.notEqual(sol.kind, 'none');
    assert.ok(matMul(A, vector(sol.solution)).data.every((q, i) => F.eq(q[0], b[i])));
  }
  assert.equal(rank([[1, 2], [2, 4.000000000001]]), 1);
  assert.equal(rank([[1, 2], [2, 4.001]]), 2);
  assert.equal(solveLinear([[1, 1], [1, 1]], [1, 2]).kind, 'none');
});

test('inverse and determinant with steps', () => {
  const inv = inverse([[1, 2], [3, 4]]);
  assert.equal(inv.inverse.toLatex(), '\\begin{bmatrix}-2 & 1 \\\\ \\frac{3}{2} & -\\frac{1}{2}\\end{bmatrix}');
  assert.equal(inv.steps[0].latex, '\\left[\\begin{array}{cc|cc}1 & 2 & 1 & 0 \\\\ 3 & 4 & 0 & 1\\end{array}\\right]');
  assert.equal(inverse([[1, 2], [2, 4]]).ok, false);
  const d3 = determinant([[1, 2, 3], [4, 5, 6], [7, 8, 10]]);
  assert.equal(d3.value.toString(), '-3');
  assert.equal(d3.method, 'cofactor');
  assert.equal(d3.steps[1].rule, 'Cofactor expansion along row 1');
  assert.equal(determinant([[1, 2], [3, 4]]).steps[1].latex, '1 \\cdot 4 - 2 \\cdot 3');
  for (let t = 0; t < 10; t++) {
    const n = rng.int(2, 5);
    const A = randomRational(n, n);
    const det = determinant(A).value;
    const res = inverse(A);
    if (F.isZero(det)) {
      assert.equal(res.ok, false);
      continue;
    }
    assert.ok(exactEqual(matMul(A, res.inverse), identity(n)));
    // det(A^-1) = 1 / det(A) and det(AB) = det(A) det(B).
    assert.ok(F.eq(F.mul(det, determinant(res.inverse).value), Rational.from(1)));
    const B = randomRational(n, n);
    assert.ok(F.eq(determinant(matMul(A, B)).value, F.mul(det, determinant(B).value)));
  }
  assert.equal(determinant([[2, 0, 0, 0], [0, 3, 0, 0], [0, 0, 4, 0], [1, 0, 0, 5]]).value.toString(), '120');
  assert.equal(determinant([[0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]).value.toString(), '-1');
});

test('eigenvalues: exact rational, surd and complex; numeric QR otherwise', () => {
  const e1 = eigen([[4, 1], [2, 3]]);
  assert.ok(e1.exact);
  assert.deepEqual(e1.values.map((v) => v.latex), ['2', '5']);
  const e2 = eigen([[2, 1], [1, 3]]);
  assert.deepEqual(e2.values.map((v) => v.latex), ['\\frac{5 - \\sqrt{5}}{2}', '\\frac{5 + \\sqrt{5}}{2}']);
  assert.ok(e2.values[0].value instanceof Surd);
  const rot = eigen([[0, -1], [1, 0]]);
  assert.deepEqual(rot.values.map((v) => v.latex), ['-i', 'i']);
  assert.deepEqual(charPoly([[0, -1], [1, 0]]).map(String), ['1', '0', '1']);
  // A v = lambda v for every exact eigenpair, including surds.
  for (const M of [[[2, 1], [1, 3]], [[0, -1], [1, 0]], [[2, 0, 0], [0, 3, 4], [0, 4, 9]], [[1, 2, 0], [0, 1, 0], [0, 0, 2]]]) {
    const A = matrix(M);
    for (const ev of eigen(A).values) {
      for (const v of ev.vectors) {
        const Av = matMul(A, vector(v)).data.map((r) => r[0]);
        v.forEach((x, i) => assert.ok(F.eq(Av[i], F.mul(ev.value, x))));
      }
    }
  }
  // Numeric path: cubic with irrational eigenvalues, and a float matrix.
  for (const M of [[[1, 2, 3], [4, 5, 6], [7, 8, 10]], [[1.5, 2, 0.1], [0.3, 4, 1], [2, -1, 0.5]], [[0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [1, 0, 0, 0]]]) {
    const A = matrix(M);
    const n = M.length;
    const { values } = eigen(A);
    const sum = values.reduce((s, v) => s.add(F.toComplex(v.value).mul(v.multiplicity)), new Complex(0, 0));
    let trace = 0;
    for (let i = 0; i < n; i++) trace += F.toNumber(A.get(i, i));
    assert.ok(Math.abs(sum.re - trace) < 1e-9 && Math.abs(sum.im) < 1e-9);
    for (const ev of values) {
      const lam = F.toComplex(ev.value);
      for (const v of ev.vectors) {
        const vc = v.map((x) => F.toComplex(x));
        for (let i = 0; i < n; i++) {
          let s = new Complex(0, 0);
          for (let j = 0; j < n; j++) s = s.add(F.toComplex(A.get(i, j)).mul(vc[j]));
          assert.ok(s.sub(lam.mul(vc[i])).abs() < 1e-8);
        }
      }
    }
  }
  const sym = jacobiEigen([[2, 1], [1, 2]]);
  assert.ok(Math.abs(sym.values[0] - 1) < 1e-12 && Math.abs(sym.values[1] - 3) < 1e-12);
});

test('diagonalization reconstructs A; defective matrices are reported', () => {
  for (const M of [[[4, 1], [2, 3]], [[2, 1], [1, 3]], [[0, -1], [1, 0]], [[2, 0, 0], [0, 3, 4], [0, 4, 9]]]) {
    const d = diagonalize(M);
    assert.ok(d.ok);
    assert.ok(exactEqual(matMul(matMul(d.P, d.D), d.Pinv), matrix(M)));
  }
  const bad = diagonalize([[1, 1], [0, 1]]);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /not diagonalizable/);
  const num = diagonalize([[1, 2, 3], [4, 5, 6], [7, 8, 10]]);
  assert.ok(num.ok);
  const back = matMul(matMul(num.P, num.D), num.Pinv).data.map((r) => r.map((x) => F.toComplex(x).re));
  assertMatrixClose(back, [[1, 2, 3], [4, 5, 6], [7, 8, 10]], 1e-8);
});

test('SVD, QR and LU reconstruct their input', () => {
  for (let t = 0; t < 8; t++) {
    const m = rng.int(2, 5);
    const n = rng.int(2, 5);
    const A = Array.from({ length: m }, () => Array.from({ length: n }, () => rng.uniform(-3, 3)));
    const { U, S, V } = svd(A);
    const k = Math.min(m, n);
    const rec = A.map((_, i) => A[0].map((__, j) => {
      let s = 0;
      for (let q = 0; q < k; q++) s += U[i][q] * S[q] * V[j][q];
      return s;
    }));
    assertMatrixClose(rec, A, 1e-10);
    for (let q = 1; q < k; q++) assert.ok(S[q] <= S[q - 1]);
    const { Q, R } = qrHouseholder(A);
    const QR = Q.map((row) => A[0].map((_, j) => row.reduce((s, qv, p) => s + qv * R[p][j], 0)));
    assertMatrixClose(QR, A, 1e-10);
    for (let i = 0; i < m; i++) for (let j = 0; j < Math.min(i, n); j++) assert.equal(R[i][j], 0);
  }
  assert.deepEqual(svd([[3, 2, 2], [2, 3, -2]]).S.map((s) => Math.round(s * 1e9) / 1e9), [5, 3]);
  const L = lu([[2, 1, 1], [4, -6, 0], [-2, 7, 2]]);
  assert.ok(exactEqual(matMul(L.P, matrix([[2, 1, 1], [4, -6, 0], [-2, 7, 2]])), matMul(L.L, L.U)));
  assert.equal(L.steps[0].rule, 'Swap R1 and R2');
  const gs = qrGramSchmidt([[1, 1], [1, 0], [0, 1]]);
  const QRg = gs.Q.map((row) => [0, 1].map((j) => row.reduce((s, qv, p) => s + qv * gs.R[p][j], 0)));
  assertMatrixClose(QRg, [[1, 1], [1, 0], [0, 1]], 1e-12);
});

test('Gram-Schmidt steps are exact and orthonormal', () => {
  const gs = gramSchmidt([[1, 1, 0], [1, 0, 1], [0, 1, 1]]);
  assert.equal(gs.steps[1].latex, 'u_{2} = \\begin{bmatrix}1 \\\\ 0 \\\\ 1\\end{bmatrix} - \\frac{1}{2} u_{1} = \\begin{bmatrix}\\frac{1}{2} \\\\ -\\frac{1}{2} \\\\ 1\\end{bmatrix}');
  assert.equal(gs.orthonormalLatex[0], '\\begin{bmatrix}\\frac{\\sqrt{2}}{2} \\\\ \\frac{\\sqrt{2}}{2} \\\\ 0\\end{bmatrix}');
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const d = gs.orthonormal[i].reduce((s, x, k) => F.add(s, F.mul(x, gs.orthonormal[j][k])), Rational.from(0));
      assert.ok(F.eq(d, Rational.from(i === j ? 1 : 0)));
    }
  }
  assert.deepEqual(gramSchmidt([[1, 2], [2, 4]]).dependent, [1]);
});

test('change of basis, projections and least squares', () => {
  const B = [[1, 1], [0, 1]];
  const c = coordinates([3, 2], B);
  assert.deepEqual(c.map(String), ['1', '2']);
  const A = changeOfBasis([[2, 0], [0, 3]], B);
  assert.equal(A.toLatex(), '\\begin{bmatrix}2 & -1 \\\\ 0 & 3\\end{bmatrix}');
  const P = projectionMatrix([[1], [1]]);
  assert.ok(exactEqual(matMul(P, P), P));
  assert.deepEqual(project([2, 0], [[1], [1]]).map(String), ['1', '1']);
  const ls = leastSquares([[1, 0], [1, 1], [1, 2]], [6, 0, 0]);
  assert.deepEqual(ls.x.map(String), ['5', '-3']);
  assert.equal(ls.steps[0].rule, 'Normal equations');
  // The residual is orthogonal to the columns of A.
  const At = transpose(matrix([[1, 0], [1, 1], [1, 2]]));
  assert.ok(matMul(At, vector(ls.residual)).data.every((r) => F.isZero(r[0])));
});

test('2D matrix paths from the identity to A', () => {
  const R = [[0, -1], [1, 0]];
  assertMatrixClose(interpolateMatrix2D(R, 0), [[1, 0], [0, 1]]);
  assertMatrixClose(interpolateMatrix2D(R, 1), R);
  const half = interpolateMatrix2D(R, 0.5);
  assertMatrixClose(half, [[Math.SQRT1_2, -Math.SQRT1_2], [Math.SQRT1_2, Math.SQRT1_2]]);
  assertMatrixClose(interpolateMatrix2D([[1, 1], [0, 1]], 0.5, 'linear'), [[1, 0.5], [0, 1]]);
  for (const M of [[[2, 1], [0.5, 3]], [[1, 2], [3, -1]], [[-1, 0], [0, 2]]]) {
    assertMatrixClose(interpolateMatrix2D(M, 1), M, 1e-12);
    assertMatrixClose(interpolateMatrix2D(M, 0), [[1, 0], [0, 1]], 1e-12);
    const p = polar2D(M);
    assert.ok(Math.abs(p.S[0][1] - p.S[1][0]) < 1e-12);
  }
  assert.equal(polar2D([[1, 2], [3, -1]]).reflect, true);
});

test('scalar tower keeps exactness where possible', () => {
  const s = Surd.make(Rational.from(1), Rational.from(1), 8n);
  assert.equal(scalarLatex(s), '1 + 2\\sqrt{2}');
  const inv = F.inv(s);
  assert.ok(F.eq(F.mul(s, inv), Rational.from(1)));
  assert.equal(F.add(Rational.from('1/2'), 0.25), 0.75);
  assert.ok(F.add(Rational.from(1), new Complex(0, 1)) instanceof Complex);
  assert.equal(toScalar('3/4').toString(), '3/4');
  assert.equal(scalarLatex(1.23456789e-7), '1.23457 \\times 10^{-7}');
});
