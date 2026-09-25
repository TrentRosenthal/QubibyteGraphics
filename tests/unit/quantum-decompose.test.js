import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../src/quantum/decompose.js';
import * as C from '../../src/quantum/cmatrix.js';
import { gateMatrix } from '../../src/quantum/gates.js';
import { stateToBloch } from '../../src/quantum/analysis.js';
import { refUnitary, refToRows, randomOps, lcg } from './helpers/quantum-ref.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

function randomUnitary(n, rnd) {
  const h = C.zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const re = rnd() * 2 - 1;
      const im = i === j ? 0 : rnd() * 2 - 1;
      h.re[i * n + j] = re;
      h.im[i * n + j] = im;
      h.re[j * n + i] = re;
      h.im[j * n + i] = -im;
    }
  }
  const { values, vectors } = C.hermitianEigen(h);
  const d = C.zeros(n);
  values.forEach((v, i) => {
    d.re[i * n + i] = Math.cos(3 * v);
    d.im[i * n + i] = Math.sin(3 * v);
  });
  return C.multiplyAll(vectors, d, C.adjoint(vectors));
}

const withPhase = (m, phase) => C.scale(m, Math.cos(phase), Math.sin(phase));

test('circuitUnitary matches the kron-built reference unitary', () => {
  const rnd = lcg(31);
  for (let trial = 0; trial < 6; trial++) {
    const ops = randomOps(3, 15, rnd);
    const got = D.circuitUnitary({ numQubits: 3, ops });
    const want = C.fromArray(refToRows(refUnitary(3, ops)));
    assert.ok(C.equals(got, want, 1e-10));
  }
  assert.throws(() => D.circuitUnitary({ numQubits: 1, ops: [{ kind: 'measure', name: 'MEASURE', targets: [0] }] }), /op 0 is MEASURE/);
});

test('unitarySteps starts at the identity and ends at the full unitary', () => {
  const ops = [D.gateOp('H', [0]), D.gateOp('CX', [1], [], [0]), D.gateOp('T', [1])];
  const steps = D.unitarySteps({ numQubits: 2, ops });
  assert.equal(steps.length, 4);
  assert.equal(steps[0].opIndex, -1);
  assert.ok(C.equals(steps[0].unitary, C.identity(4)));
  assert.ok(C.equals(steps[3].unitary, D.circuitUnitary({ numQubits: 2, ops })));
  assert.ok(C.equals(steps[1].unitary, C.kron(C.identity(2), gateMatrix('H'))));
});

test('ZYZ, U parameters and every Euler basis reconstruct random unitaries', () => {
  const rnd = lcg(12);
  const bases = ['ZYZ', 'ZXZ', 'XYX', 'XZX', 'YZY', 'YXY'];
  const fixed = [gateMatrix('X'), gateMatrix('H'), gateMatrix('T'), gateMatrix('Y'), C.identity(2)];
  for (let trial = 0; trial < 20; trial++) {
    const u = trial < fixed.length ? fixed[trial] : randomUnitary(2, rnd);
    const z = D.decomposeZYZ(u);
    const rebuilt = C.multiplyAll(gateMatrix('RZ', [z.beta]), gateMatrix('RY', [z.gamma]), gateMatrix('RZ', [z.delta]));
    assert.ok(C.equals(withPhase(rebuilt, z.phase), u, 1e-9));
    const p = D.uGateParams(u);
    assert.ok(C.equals(withPhase(gateMatrix('U', [p.theta, p.phi, p.lambda]), p.phase), u, 1e-9));
    for (const basis of bases) {
      const e = D.eulerDecompose(u, basis, 0);
      const v = D.circuitUnitary({ numQubits: 1, ops: e.ops });
      assert.ok(C.equals(withPhase(v, e.phase), u, 1e-9), basis);
      assert.deepEqual(e.ops.map((o) => o.name), [`R${basis[0]}`, `R${basis[1]}`, `R${basis[0]}`]);
    }
  }
  assert.throws(() => D.eulerDecompose(gateMatrix('H'), 'ZZY'), /Euler basis/);
});

test('two-qubit decomposition uses at most 3 CX and reconstructs exactly', () => {
  const rnd = lcg(99);
  const named = ['SWAP', 'ISWAP', 'SQRTSWAP'].map((n) => gateMatrix(n));
  const local = C.kron(randomUnitary(2, rnd), randomUnitary(2, rnd));
  const cases = [...named, local, C.identity(4), D.circuitUnitary({ numQubits: 2, ops: [D.gateOp('CX', [0], [], [1])] })];
  for (let k = 0; k < 25; k++) cases.push(randomUnitary(4, rnd));
  for (const u of cases) {
    const { ops, phase, cxCount } = D.decomposeTwoQubit(u, [0, 1]);
    assert.ok(cxCount <= 3);
    assert.equal(ops.filter((o) => o.name === 'CX').length, cxCount);
    assert.ok(ops.every((o) => o.name === 'CX' || o.name === 'U'));
    const v = D.circuitUnitary({ numQubits: 2, ops });
    assert.ok(C.equals(withPhase(v, phase), u, 1e-8));
  }
  const placed = D.decomposeTwoQubit(gateMatrix('ISWAP'), [3, 1]);
  const v = D.circuitUnitary({ numQubits: 4, ops: placed.ops });
  const want = D.circuitUnitary({ numQubits: 4, ops: [D.gateOp('ISWAP', [3, 1])] });
  assert.ok(C.equalsUpToPhase(v, want, 1e-8));
  assert.throws(() => D.decomposeTwoQubit(C.fromArray([[1, 1, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])), /unitary/);
});

test('controlled one-qubit gates decompose exactly, including relative phase', () => {
  const rnd = lcg(4);
  for (let trial = 0; trial < 15; trial++) {
    const v = randomUnitary(2, rnd);
    const ops = D.decomposeControlled(v, 0, 1);
    assert.equal(ops.filter((o) => o.name === 'CX').length, 2);
    const got = D.circuitUnitary({ numQubits: 2, ops });
    const want = D.circuitUnitary({ numQubits: 2, ops: [{ kind: 'gate', name: 'CTRL', targets: [1], controls: [0], params: [], matrix: v }] });
    assert.ok(C.equals(got, want, 1e-9));
  }
});

test('unitaryPath gives fractional powers and a continuous Bloch sweep', () => {
  const x = gateMatrix('X');
  const half = D.unitaryPath(x, 0.5);
  assert.ok(C.equals(C.multiply(half, half), x, 1e-10));
  assert.ok(C.equals(D.unitaryPath(x, 0), C.identity(2), 1e-12));
  assert.ok(C.equals(D.unitaryPath(x, 1), x, 1e-10));
  const u = randomUnitary(4, lcg(8));
  const third = D.unitaryPath(u, 1 / 3);
  assert.ok(C.equals(C.multiplyAll(third, third, third), u, 1e-8));
  assert.ok(C.isUnitary(third, 1e-10));
  // H sweeps |0> along a great circle to |+>; theta rises monotonically.
  let prev = -1;
  for (let k = 0; k <= 8; k++) {
    const m = D.unitaryPath(gateMatrix('H'), k / 8);
    const b = stateToBloch({ re: [m.re[0], m.re[2]], im: [m.im[0], m.im[2]] }, 0);
    close(b.r, 1);
    assert.ok(b.theta > prev - 1e-12);
    prev = b.theta;
  }
  close(prev, Math.PI / 2);
});
