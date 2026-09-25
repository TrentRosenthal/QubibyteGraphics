import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  depolarizing, depolarizing2, amplitudeDamping, phaseDamping, bitFlip, phaseFlip,
  ReadoutError, NoiseModel, simulateNoisy, fidelityDecay,
} from '../../src/quantum/noise.js';
import { DensityMatrixSimulator } from '../../src/quantum/density.js';
import { createRng } from '../../src/quantum/rng.js';
import * as C from '../../src/quantum/cmatrix.js';
import { blochVector } from '../../src/quantum/analysis.js';

const g = (name, targets, controls = [], params = []) => ({ kind: 'gate', name, targets, controls, params });
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

function plusState() {
  const dm = new DensityMatrixSimulator(1);
  dm.applyOp(g('RY', [0], [], [1.0]));
  dm.applyOp(g('RZ', [0], [], [0.5]));
  return dm;
}

test('every channel is trace preserving: sum K^dagger K = I', () => {
  const channels = [depolarizing(0.3), depolarizing2(0.2), amplitudeDamping(0.4), phaseDamping(0.7), bitFlip(0.1), phaseFlip(0.9)];
  for (const ch of channels) {
    const dim = 1 << ch.qubits;
    let sum = C.zeros(dim);
    for (const k of ch.kraus) sum = C.add(sum, C.multiply(C.adjoint(k), k));
    assert.ok(C.equals(sum, C.identity(dim), 1e-12), ch.name);
  }
  assert.throws(() => depolarizing(1.5), /between 0 and 1/);
});

test('depolarizing shrinks the Bloch vector by (1 - p) and fixes I/2', () => {
  const dm = plusState();
  const before = blochVector(dm, 0);
  dm.applyKraus(depolarizing(0.25).kraus, [0]);
  const after = blochVector(dm, 0);
  for (const k of ['x', 'y', 'z']) close(after[k], 0.75 * before[k]);
  const mixed = DensityMatrixSimulator.fromMatrix(C.scale(C.identity(2), 0.5));
  mixed.applyKraus(depolarizing(0.6).kraus, [0]);
  assert.ok(C.equals(mixed.densityMatrix(), C.scale(C.identity(2), 0.5)));
  const two = new DensityMatrixSimulator(2);
  two.applyKraus(depolarizing2(1).kraus, [0, 1]);
  assert.ok(C.equals(two.densityMatrix(), C.scale(C.identity(4), 0.25), 1e-12));
});

test('amplitude damping relaxes toward |0>; phase damping keeps populations', () => {
  const dm = plusState();
  const z0 = blochVector(dm, 0).z;
  for (let k = 0; k < 200; k++) dm.applyKraus(amplitudeDamping(0.1).kraus, [0]);
  close(dm.probabilities()[0], 1, 1e-8);
  const one = new DensityMatrixSimulator(1);
  one.applyOp(g('X', [0]));
  one.applyKraus(amplitudeDamping(0.3).kraus, [0]);
  close(one.probabilities()[1], 0.7);
  const ph = plusState();
  const b = blochVector(ph, 0);
  ph.applyKraus(phaseDamping(0.36).kraus, [0]);
  const a = blochVector(ph, 0);
  close(a.z, z0);
  close(a.x, 0.8 * b.x);
  close(a.y, 0.8 * b.y);
});

test('bit flip and phase flip act on the expected Bloch axes', () => {
  const dm = plusState();
  const b = blochVector(dm, 0);
  dm.applyKraus(bitFlip(0.25).kraus, [0]);
  let a = blochVector(dm, 0);
  close(a.x, b.x);
  close(a.z, 0.5 * b.z);
  const pf = plusState();
  pf.applyKraus(phaseFlip(0.5).kraus, [0]);
  a = blochVector(pf, 0);
  close(a.x, 0);
  close(a.z, b.z);
});

test('readout error: confusion on distributions and seeded bit corruption', () => {
  const err = new ReadoutError(0.1, 0.2);
  const noisy = err.apply([1, 0, 0, 0]);
  close(noisy[0], 0.81);
  close(noisy[1], 0.09);
  close(noisy[3], 0.01);
  close(noisy.reduce((s, v) => s + v, 0), 1);
  const rng = createRng(5);
  let flips = 0;
  for (let k = 0; k < 5000; k++) flips += err.corrupt([1], rng)[0] === 0 ? 1 : 0;
  close(flips / 5000, 0.2, 0.03);
});

test('NoiseModel attaches channels by gate name or to all gates', () => {
  const model = new NoiseModel().add(bitFlip(0.1), ['H']).add(depolarizing2(0.1)).add(phaseFlip(0.05));
  const onH = model.channelsAfter(g('H', [3]));
  assert.deepEqual(onH.map((c) => [c.channel.name, c.wires]), [['bitFlip', [3]], ['phaseFlip', [3]]]);
  const onCx = model.channelsAfter(g('CX', [1], [0]));
  assert.deepEqual(onCx.map((c) => [c.channel.name, c.wires]), [['depolarizing2', [0, 1]], ['phaseFlip', [0]], ['phaseFlip', [1]]]);
  assert.deepEqual(model.channelsAfter({ kind: 'measure', name: 'MEASURE', targets: [0] }), []);
  model.setReadout(new ReadoutError(0.01));
  assert.equal(model.readout.p10, 0.01);
});

test('simulateNoisy lowers purity; a noiseless model keeps it', () => {
  const circuit = { numQubits: 2, ops: [g('H', [0]), g('CX', [1], [0])] };
  const clean = simulateNoisy(circuit, new NoiseModel());
  close(clean.state.purity(), 1);
  const noisy = simulateNoisy(circuit, new NoiseModel().add(depolarizing(0.1)));
  assert.ok(noisy.state.purity() < 0.95);
  close(noisy.state.trace(), 1);
});

test('fidelityDecay starts at 1 and decreases with depth', () => {
  const circuit = { numQubits: 2, ops: [g('H', [0]), g('CX', [1], [0]), g('RY', [1], [], [0.3])] };
  const curve = fidelityDecay(circuit, new NoiseModel().add(amplitudeDamping(0.05)).add(depolarizing(0.02)), 6);
  assert.equal(curve.length, 7);
  assert.equal(curve[0].fidelity, 1);
  assert.equal(curve[3].gates, 9);
  for (let k = 1; k < curve.length; k++) assert.ok(curve[k].fidelity < curve[k - 1].fidelity + 1e-12);
  assert.ok(curve[6].fidelity < 0.9);
  const flat = fidelityDecay(circuit, new NoiseModel(), 3);
  for (const p of flat) close(p.fidelity, 1);
  assert.throws(() => fidelityDecay({ numQubits: 1, ops: [{ kind: 'measure', name: 'MEASURE', targets: [0] }] }, new NoiseModel(), 1), /gates only/);
});
