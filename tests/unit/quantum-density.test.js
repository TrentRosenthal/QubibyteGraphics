import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DensityMatrixSimulator, vonNeumannEntropy } from '../../src/quantum/density.js';
import { StatevectorSimulator } from '../../src/quantum/statevector.js';
import { executeCircuit } from '../../src/quantum/run.js';
import { createRng } from '../../src/quantum/rng.js';
import * as C from '../../src/quantum/cmatrix.js';
import { gateMatrix } from '../../src/quantum/gates.js';
import { randomOps, lcg } from './helpers/quantum-ref.js';

const g = (name, targets, controls = [], params = []) => ({ kind: 'gate', name, targets, controls, params });
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('density matrix evolution equals |psi><psi| of the statevector', () => {
  const rnd = lcg(21);
  for (let trial = 0; trial < 10; trial++) {
    const ops = randomOps(4, 25, rnd);
    const sv = new StatevectorSimulator(4);
    const dm = new DensityMatrixSimulator(4);
    for (const op of ops) {
      sv.applyOp(op);
      dm.applyOp(op);
    }
    const want = DensityMatrixSimulator.fromAmplitudes(sv.amplitudes());
    assert.ok(C.equals(dm.densityMatrix(), want.densityMatrix(), 1e-9));
    close(dm.purity(), 1);
    close(dm.trace(), 1);
    close(dm.expectation('ZXYI'), sv.expectation('ZXYI'));
  }
});

test('measurement collapses and renormalizes; dephase keeps the ensemble', () => {
  const dm = new DensityMatrixSimulator(2);
  dm.applyOp(g('H', [0]));
  dm.applyOp(g('CX', [1], [0]));
  const copy = dm.clone();
  const [b0, b1] = dm.measure([0, 1], createRng(3));
  assert.equal(b0, b1);
  close(dm.probabilities()[b0 ? 3 : 0], 1);
  close(dm.purity(), 1);
  copy.dephase([0]);
  close(copy.purity(), 0.5);
  close(copy.probabilities()[3], 0.5);
  close(copy.entropy(), 1);
});

test('partial trace, purity and entropy of a Bell pair', () => {
  const dm = new DensityMatrixSimulator(3);
  dm.applyOp(g('H', [0]));
  dm.applyOp(g('CX', [2], [0]));
  const red = dm.partialTrace([0]);
  assert.ok(C.equals(red, C.scale(C.identity(2), 0.5)));
  close(dm.entropy([0]), 1);
  close(dm.entropy([1]), 0);
  close(dm.entropy([0, 2]), 0);
  close(vonNeumannEntropy(C.scale(C.identity(4), 0.25)), 2);
  close(vonNeumannEntropy(C.scale(C.identity(4), 0.25), Math.E), Math.log(4));
});

test('Kraus channel application: a full bit flip equals X; completely dephasing kills coherences', () => {
  const dm = new DensityMatrixSimulator(1);
  dm.applyKraus([gateMatrix('X')], [0]);
  close(dm.probabilities()[1], 1);
  const plus = new DensityMatrixSimulator(1);
  plus.applyOp(g('H', [0]));
  const half = Math.SQRT1_2;
  plus.applyKraus([C.scale(gateMatrix('I'), half), C.scale(gateMatrix('Z'), half)], [0]);
  close(plus.re[1], 0);
  close(plus.trace(), 1);
});

test('executeCircuit runs if ops on the density simulator', () => {
  const dm = new DensityMatrixSimulator(2);
  const ops = [g('X', [0]), { kind: 'measure', name: 'MEASURE', targets: [0], controls: [], params: [], register: 'r' },
    { kind: 'if', branches: [{ condText: 'r', ops: [g('X', [1])] }] }];
  const out = executeCircuit(dm, { numQubits: 2, ops });
  assert.equal(out.registers.r, 1);
  close(dm.probabilities()[3], 1);
});

test('constructors validate input', () => {
  assert.throws(() => new DensityMatrixSimulator(14), /0 to 13 qubits/);
  assert.throws(() => DensityMatrixSimulator.fromMatrix(C.zeros(3)), /2\^n x 2\^n/);
  const rho = DensityMatrixSimulator.fromMatrix(C.scale(C.identity(2), 0.5));
  close(rho.purity(), 0.5);
  close(rho.probabilityOfOne(0), 0.5);
  assert.throws(() => rho.applyOp({ kind: 'if', branches: [] }), /executeCircuit/);
});
