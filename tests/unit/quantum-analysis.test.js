import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../src/quantum/analysis.js';
import { StatevectorSimulator } from '../../src/quantum/statevector.js';
import { DensityMatrixSimulator } from '../../src/quantum/density.js';
import { depolarizing } from '../../src/quantum/noise.js';
import * as C from '../../src/quantum/cmatrix.js';
import { gateMatrix } from '../../src/quantum/gates.js';

const g = (name, targets, controls = [], params = []) => ({ kind: 'gate', name, targets, controls, params });
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

function state(n, ops) {
  const s = new StatevectorSimulator(n);
  ops.forEach((op) => s.applyOp(op));
  return s;
}

const bell = () => state(2, [g('H', [0]), g('CX', [1], [0])]);
const ghz = (n) => state(n, [g('H', [0]), ...Array.from({ length: n - 1 }, (_, k) => g('CX', [k + 1], [k]))]);

test('Bloch vectors of the cardinal states and of an entangled qubit', () => {
  const cases = [
    [[], { x: 0, y: 0, z: 1 }],
    [[g('X', [0])], { x: 0, y: 0, z: -1 }],
    [[g('H', [0])], { x: 1, y: 0, z: 0 }],
    [[g('H', [0]), g('S', [0])], { x: 0, y: 1, z: 0 }],
  ];
  for (const [ops, want] of cases) {
    const v = A.blochVector(state(1, ops), 0);
    close(v.x, want.x);
    close(v.y, want.y);
    close(v.z, want.z);
  }
  for (const v of A.blochVectors(ghz(3))) close(Math.hypot(v.x, v.y, v.z), 0);
  const b = A.stateToBloch(state(2, [g('RY', [1], [], [1.2]), g('RZ', [1], [], [0.7])]), 1);
  close(b.theta, 1.2);
  close(b.phi, 0.7);
  close(b.r, 1);
  const mixed = A.blochAngles({ x: 0, y: 0, z: 0 });
  assert.deepEqual(mixed, { theta: 0, phi: 0, r: 0 });
});

test('blochToPreparation writes piradian Qubi source by default', () => {
  const theta = 2 * Math.acos(Math.sqrt(0.8));
  const prep = A.blochToPreparation(theta, 0);
  assert.equal(prep.qubi, 'RY 0 0.295');
  close(prep.ry, theta);
  const s = state(1, prep.ops);
  close(s.probabilities()[0], 0.8);
  const full = A.blochToPreparation(Math.PI / 2, Math.PI / 4, { wire: 2 });
  assert.equal(full.qubi, 'RY 2 0.5\nRZ 2 0.25');
  assert.equal(A.blochToPreparation(Math.PI / 2, 0, { angleUnit: 'degrees' }).qubi, 'RY 0 90deg');
  assert.equal(A.blochToPreparation(1, 0, { angleUnit: 'radians' }).qubi, 'RY 0 1rad');
  const back = A.stateToBloch(state(1, full.ops.map((op) => ({ ...op, targets: [0] }))), 0);
  close(back.theta, Math.PI / 2);
  close(back.phi, Math.PI / 4);
  assert.throws(() => A.blochToPreparation(1, 0, { angleUnit: 'turns' }), /Angle unit/);
});

test('Q-sphere places states by Hamming weight with amplitude and phase', () => {
  const s = state(3, [g('H', [0]), g('H', [1]), g('Z', [1])]);
  const pts = A.qsphere(s);
  assert.deepEqual(pts.map((p) => p.bitstring), ['000', '001', '010', '011']);
  const [p000, p001, p010, p011] = pts;
  close(p000.z, 1);
  close(p011.theta, (2 * Math.PI) / 3);
  close(p001.theta, Math.PI / 3);
  assert.notEqual(p001.phi, p010.phi);
  close(p010.phase, Math.PI);
  close(p001.probability, 0.25);
});

test('Schmidt decomposition: Bell coefficients, product rank 1, and reconstruction', () => {
  const sb = A.schmidtDecomposition(bell(), [0]);
  assert.equal(sb.rank, 2);
  sb.coefficients.forEach((c) => close(c, Math.SQRT1_2));
  const prod = A.schmidtDecomposition(state(3, [g('H', [0]), g('RY', [2], [], [0.4])]), [0, 1]);
  assert.equal(prod.rank, 1);
  const s = state(3, [g('RY', [0], [], [0.9]), g('CX', [1], [0]), g('RY', [2], [], [1.3]), g('CX', [2], [1]), g('T', [2])]);
  const sd = A.schmidtDecomposition(s, [2]);
  const re = new Float64Array(8);
  const im = new Float64Array(8);
  const offA = C.wireOffsets(sd.wiresA);
  const offB = C.wireOffsets(sd.wiresB);
  sd.coefficients.forEach((c, k) => {
    for (let a = 0; a < offA.length; a++) {
      for (let b = 0; b < offB.length; b++) {
        const ar = sd.vectorsA[k].re[a];
        const ai = sd.vectorsA[k].im[a];
        const br = sd.vectorsB[k].re[b];
        const bi = sd.vectorsB[k].im[b];
        re[offA[a] | offB[b]] += c * (ar * br - ai * bi);
        im[offA[a] | offB[b]] += c * (ar * bi + ai * br);
      }
    }
  });
  for (let i = 0; i < 8; i++) {
    close(re[i], s.re[i]);
    close(im[i], s.im[i]);
  }
  close(sd.coefficients.reduce((t, c) => t + c * c, 0), 1);
});

test('concurrence, entanglement entropy and mutual information on textbook states', () => {
  close(A.concurrence(bell()), 1);
  close(A.concurrence(state(2, [g('H', [0]), g('H', [1])])), 0, 1e-7);
  // cos(t)|00> + sin(t)|11> has concurrence sin(2t).
  const t = 0.3;
  close(A.concurrence(state(2, [g('RY', [0], [], [2 * t]), g('CX', [1], [0])])), Math.sin(2 * t), 1e-8);
  // Werner state p|Bell><Bell| + (1-p) I/4 has concurrence max(0, (3p-1)/2).
  const w = DensityMatrixSimulator.fromAmplitudes(bell().amplitudes());
  w.applyKraus(depolarizing(0.4).kraus, [0]);
  close(A.concurrence(w), Math.max(0, (3 * 0.6 - 1) / 2), 1e-8);
  close(A.entanglementEntropy(bell(), [0]), 1);
  close(A.mutualInformation(bell(), 0, 1), 2);
  const g3 = ghz(3);
  close(A.entanglementEntropy(g3, [0, 1]), 1);
  close(A.concurrence(g3, [0, 2]), 0, 1e-8);
  const reduced = A.reducedDensityMatrix(g3, [0, 2]);
  close(reduced.re[0], 0.5);
  close(reduced.re[15], 0.5);
  close(reduced.re[3], 0);
  const mi = A.mutualInformationMatrix(g3);
  close(mi[0][1], 1);
  close(mi[2][0], 1);
  assert.equal(mi[1][1], 0);
  close(A.vonNeumannEntropy(A.densityMatrixOf(g3)), 0);
});

test('fidelity (pure and Uhlmann), trace distance and purity', () => {
  const zero = state(1, []);
  const plus = state(1, [g('H', [0])]);
  close(A.fidelity(zero, plus), 0.5);
  close(A.traceDistance(zero, plus), Math.SQRT1_2);
  const mixed = C.scale(C.identity(2), 0.5);
  close(A.fidelity(plus, mixed), 0.5);
  close(A.fidelity(mixed, plus), 0.5);
  close(A.fidelity(mixed, mixed), 1);
  close(A.fidelity(A.densityMatrixOf(zero), C.fromArray([[0.75, 0], [0, 0.25]])), 0.75);
  // Commuting diagonal states: F = (sum sqrt(p q))^2.
  const p = C.fromArray([[0.9, 0], [0, 0.1]]);
  const q = C.fromArray([[0.4, 0], [0, 0.6]]);
  close(A.fidelity(p, q), (Math.sqrt(0.36) + Math.sqrt(0.06)) ** 2);
  close(A.traceDistance(p, q), 0.5);
  close(A.purity(mixed), 0.5);
  close(A.purity(bell()), 1);
  close(A.purity(A.reducedDensityMatrix(bell(), [1])), 0.5);
  assert.throws(() => A.fidelity(zero, bell()), /different qubit counts/);
});

test('observables: Pauli expectations and variances, matrices, commutators', () => {
  const plus = state(1, [g('H', [0])]);
  close(A.pauliExpectation(plus, 'X'), 1);
  close(A.pauliVariance(plus, 'X'), 0);
  close(A.pauliVariance(plus, 'Z'), 1);
  close(A.pauliExpectation(bell(), '-ZZ'), -1);
  close(A.pauliExpectation(A.densityMatrixOf(bell()), 'YY'), -1);
  close(A.expectationValue(plus, gateMatrix('X'), [0]), 1);
  const zz = C.kron(gateMatrix('Z'), gateMatrix('Z'));
  close(A.expectationValue(bell(), zz, [0, 1]), 1);
  close(A.expectationValue(A.densityMatrixOf(bell()), zz, [1, 0]), 1);
  close(A.observableVariance(plus, gateMatrix('Z'), [0]), 1);
  const comm = A.commutator(gateMatrix('X'), gateMatrix('Y'));
  assert.ok(C.equals(comm, C.scale(gateMatrix('Z'), 0, 2)));
  assert.ok(C.equals(A.anticommutator(gateMatrix('X'), gateMatrix('Y')), C.zeros(2)));
});

test('CHSH: 2 sqrt 2 for a Bell state (optimal and textbook angles), at most 2 for product states', () => {
  const opt = A.chsh(bell());
  close(opt.value, 2 * Math.SQRT2);
  const given = A.chsh(bell(), { angles: { a: 0, a2: Math.PI / 2, b: Math.PI / 4, b2: -Math.PI / 4 } });
  close(given.value, 2 * Math.SQRT2);
  const product = A.chsh(state(2, [g('RY', [0], [], [0.7]), g('RY', [1], [], [1.9])]));
  assert.ok(product.value <= 2 + 1e-9);
  const partial = A.chsh(state(3, [g('RY', [0], [], [0.6]), g('CX', [2], [0])]), { wires: [0, 2] });
  close(partial.value, 2 * Math.sqrt(1 + Math.sin(0.6) ** 2), 1e-8);
});

test('Born rule probabilities and post-measurement states', () => {
  const s = state(2, [g('RY', [0], [], [2 * Math.acos(Math.sqrt(0.3))]), g('CX', [1], [0])]);
  const r = A.bornRule(s, '11', [0, 1]);
  close(r.probability, 0.7);
  close(r.state.re[3], 1);
  const proj0 = C.fromArray([[1, 0], [0, 0]]);
  const rm = A.bornRule(A.densityMatrixOf(s), proj0, [1]);
  close(rm.probability, 0.3);
  close(rm.state.re[0], 1);
  assert.equal(A.bornRule(state(1, []), '1', [0]).state, null);
  assert.throws(() => A.bornRule(s, '1x', [0, 1]), /one 0\/1 per wire/);
});

test('geodesic interpolates on the Bloch sphere without jumps', () => {
  const a = state(1, []);
  const b = state(1, [g('H', [0]), g('S', [0])]);
  const start = A.geodesic(a, b, 0);
  close(start.re[0], 1);
  const end = A.stateToBloch(A.geodesic(a, b, 1), 0);
  close(end.y, 1);
  let prev = 0;
  for (let k = 1; k <= 10; k++) {
    const p = A.stateToBloch(A.geodesic(a, b, k / 10), 0);
    close(p.r, 1);
    close(p.theta, (k / 10) * (Math.PI / 2), 1e-9);
    assert.ok(p.theta >= prev);
    prev = p.theta;
  }
  const same = A.geodesic(a, a, 0.5);
  close(same.re[0], 1);
});

test('describeState accepts every state form and rejects others', () => {
  const s = bell();
  assert.equal(A.describeState(s).pure, true);
  assert.equal(A.describeState(s.amplitudes()).numQubits, 2);
  assert.equal(A.describeState(A.densityMatrixOf(s)).pure, false);
  const col = C.fromArray([[1], [0]]);
  assert.equal(A.describeState(col).pure, true);
  assert.throws(() => A.describeState(42), /Expected a state/);
  assert.throws(() => A.describeState({ re: [1, 0, 0], im: [0, 0, 0] }), /power of two/);
  assert.throws(() => A.qsphere(A.densityMatrixOf(s)), /pure state/);
});
