import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/quantum/cmatrix.js';
import { lcg } from './helpers/quantum-ref.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

function randomMatrix(rows, cols, rnd) {
  const m = C.zeros(rows, cols);
  for (let k = 0; k < rows * cols; k++) {
    m.re[k] = rnd() * 2 - 1;
    m.im[k] = rnd() * 2 - 1;
  }
  return m;
}

function randomHermitian(n, rnd) {
  const a = randomMatrix(n, n, rnd);
  return C.scale(C.add(a, C.adjoint(a)), 0.5);
}

function diag(values) {
  const n = values.length;
  const d = C.zeros(n);
  values.forEach((v, i) => {
    d.re[i * n + i] = v;
  });
  return d;
}

test('multiply, add, scale, adjoint and kron on known values', () => {
  const x = C.fromArray([[0, 1], [1, 0]]);
  const y = C.fromArray([[0, [0, -1]], [[0, 1], 0]]);
  const z = C.fromArray([[1, 0], [0, -1]]);
  // XY = iZ
  assert.ok(C.equals(C.multiply(x, y), C.scale(z, 0, 1)));
  assert.ok(C.equals(C.adjoint(y), y));
  assert.ok(C.equals(C.add(x, C.scale(x, -1)), C.zeros(2)));
  const k = C.kron(z, x);
  assert.deepEqual(Array.from(k.re, (v) => v + 0), [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0, -1, 0]);
  const t = C.trace(C.kron(z, z));
  assert.equal(t.re, 0);
  assert.deepEqual(C.toArray(C.fromArray([[[1, 2]]])), [[[1, 2]]]);
  assert.throws(() => C.multiply(C.zeros(2, 3), C.zeros(2, 3)), /Cannot multiply/);
});

test('hermitianEigen reconstructs random Hermitian matrices with unitary vectors', () => {
  const rnd = lcg(3);
  for (const n of [1, 2, 3, 5, 8]) {
    const h = randomHermitian(n, rnd);
    const { values, vectors } = C.hermitianEigen(h);
    assert.ok(C.isUnitary(vectors, 1e-10));
    const rebuilt = C.multiplyAll(vectors, diag(Array.from(values)), C.adjoint(vectors));
    assert.ok(C.equals(rebuilt, h, 1e-10));
    for (let i = 1; i < n; i++) assert.ok(values[i] >= values[i - 1]);
  }
});

test('sqrtPsd squares back and hermitianFunction applies to eigenvalues', () => {
  const rnd = lcg(5);
  const a = randomMatrix(4, 4, rnd);
  const psd = C.multiply(a, C.adjoint(a));
  const s = C.sqrtPsd(psd);
  assert.ok(C.equals(C.multiply(s, s), psd, 1e-9));
  assert.ok(C.isHermitian(s));
  const inv = C.hermitianFunction(psd, (x) => 1 / x);
  assert.ok(C.equals(C.multiply(inv, psd), C.identity(4), 1e-8));
});

test('svd reconstructs tall, wide and rank-deficient matrices', () => {
  const rnd = lcg(11);
  for (const [r, c] of [[4, 4], [5, 3], [2, 6], [1, 4]]) {
    const a = randomMatrix(r, c, rnd);
    const { u, s, v } = C.svd(a);
    const k = s.length;
    assert.equal(k, Math.min(r, c));
    const rebuilt = C.multiplyAll(u, diag(Array.from(s)), C.adjoint(v));
    assert.ok(C.equals(rebuilt, a, 1e-10), `${r}x${c}`);
    assert.ok(C.equals(C.multiply(C.adjoint(v), v), C.identity(k), 1e-10));
    for (let i = 1; i < k; i++) assert.ok(s[i] <= s[i - 1]);
  }
  const outer = C.kron(C.fromArray([[1], [[0, 2]]]), C.fromArray([[1, 3]]));
  const { s } = C.svd(outer);
  close(s[0], Math.sqrt(5) * Math.sqrt(10));
  close(s[1], 0);
});

test('determinant matches the product of eigenvalues and detects singular matrices', () => {
  const rnd = lcg(7);
  const h = randomHermitian(4, rnd);
  const { values } = C.hermitianEigen(h);
  const d = C.determinant(h);
  close(d.re, values.reduce((p, v) => p * v, 1));
  close(d.im, 0);
  const det = C.determinant(C.fromArray([[1, 2], [3, [0, 4]]]));
  assert.deepEqual([det.re, det.im], [-6, 4]);
  assert.deepEqual(C.determinant(C.fromArray([[1, 2], [2, 4]])), { re: 0, im: 0 });
});

test('unitaryEigen diagonalizes unitaries including degenerate spectra', () => {
  const swap = C.fromArray([[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]);
  const { values, vectors } = C.unitaryEigen(swap);
  const d = C.zeros(4);
  for (let i = 0; i < 4; i++) {
    d.re[i * 5] = values.re[i];
    d.im[i * 5] = values.im[i];
  }
  assert.ok(C.equals(C.multiplyAll(vectors, d, C.adjoint(vectors)), swap, 1e-10));
  const sorted = Array.from(values.re).map((x) => Math.round(x)).sort();
  assert.deepEqual(sorted, [-1, 1, 1, 1]);
});

test('partialTrace of a Bell state is maximally mixed; keep order sets qubit order', () => {
  const bell = C.zeros(4);
  for (const i of [0, 3]) for (const j of [0, 3]) bell.re[i * 4 + j] = 0.5;
  assert.ok(C.equals(C.partialTrace(bell, 2, [0]), C.scale(C.identity(2), 0.5)));
  // |01> (qubit 0 set): keeping [1, 0] swaps the order so the result is |10>.
  const rho = C.zeros(4);
  rho.re[1 * 4 + 1] = 1;
  const swapped = C.partialTrace(rho, 2, [1, 0]);
  assert.equal(swapped.re[2 * 4 + 2], 1);
});

test('equalsUpToPhase ignores global phase only', () => {
  const h = C.fromArray([[1, 1], [1, -1]]);
  const phased = C.scale(h, Math.cos(0.7), Math.sin(0.7));
  assert.ok(C.equalsUpToPhase(h, phased));
  assert.ok(!C.equals(h, phased));
  assert.ok(!C.equalsUpToPhase(h, C.fromArray([[1, 1], [1, 1]])));
  assert.ok(C.isUnitary(C.scale(h, Math.SQRT1_2)));
  assert.ok(!C.isUnitary(h));
  assert.equal(C.frobeniusNorm(h), 2);
  assert.deepEqual(C.get(phased, 0, 0), { re: Math.cos(0.7), im: Math.sin(0.7) });
  assert.deepEqual(C.toComplex([1, 2]), { re: 1, im: 2 });
  assert.throws(() => C.toComplex('x'), /Not a complex number/);
});

test('transpose, conjugate and wireOffsets', () => {
  const m = C.fromArray([[1, [0, 2]], [3, 4]]);
  assert.deepEqual(C.toArray(C.transpose(m)), [[[1, 0], [3, 0]], [[0, 2], [4, 0]]]);
  assert.equal(C.conjugate(m).im[1], -2);
  assert.deepEqual(Array.from(C.wireOffsets([2, 0])), [0, 4, 1, 5]);
  assert.ok(C.equals(C.clone(m), m));
  assert.ok(C.equals(C.subtract(m, m), C.zeros(2)));
});
