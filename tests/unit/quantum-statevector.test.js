import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StatevectorSimulator, createBackend, bitstring } from '../../src/quantum/statevector.js';
import { runCircuit, executeCircuit, outcomeDistribution } from '../../src/quantum/run.js';
import { evaluateCondition } from '../../src/quantum/condition.js';
import { gateMatrix, opActions } from '../../src/quantum/gates.js';
import { createRng } from '../../src/quantum/rng.js';
import { fromArray } from '../../src/quantum/cmatrix.js';
import { blochVector } from '../../src/quantum/analysis.js';
import { refGate, refState, refToRows } from './helpers/quantum-ref.js';

const g = (name, targets, controls = [], params = []) => ({ kind: 'gate', name, targets, controls, params });
const m = (targets, register) => ({ kind: 'measure', name: 'MEASURE', targets, controls: [], params: [], register });
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const circuit = (numQubits, ops, variables = {}) => ({ numQubits, ops, variables });

test('gateMatrix matches the independent reference for every native gate', () => {
  const cases = [
    ['I'], ['H'], ['X'], ['Y'], ['Z'], ['S'], ['SDG'], ['T'], ['TDG'],
    ['RX', [0.7]], ['RY', [-1.3]], ['RZ', [2.1]], ['P', [0.4]], ['U', [0.3, 1.1, -0.6]],
    ['SWAP'], ['ISWAP'], ['SQRTSWAP'],
  ];
  for (const [name, params = []] of cases) {
    const got = gateMatrix(name, params);
    const want = fromArray(refToRows(refGate(name, params)));
    for (let k = 0; k < got.re.length; k++) {
      close(got.re[k], want.re[k]);
      close(got.im[k], want.im[k]);
    }
  }
  assert.ok(gateMatrix('RX').re[0] > 0.7, 'RX defaults to pi/2');
  assert.throws(() => gateMatrix('FOO'), /No matrix for gate "FOO"/);
  assert.throws(() => gateMatrix('U', [1]), /needs 3 angle parameters/);
});

test('opActions expands SWAPSEQ, broadcast, user matrices, and checks controls', () => {
  const seq = opActions(g('SWAPSEQ', [0, 1, 2, 3]));
  assert.deepEqual(seq.map((a) => a.targets), [[0, 3], [1, 2]]);
  assert.equal(opActions(g('H', [0, 1, 2])).length, 3);
  assert.throws(() => opActions(g('CX', [1])), /needs at least one control/);
  assert.throws(() => opActions(g('SWAP', [1])), /acts on 2 target/);
  const user = { ...g('MYGATE', [0]), matrix: gateMatrix('X') };
  assert.equal(opActions(user)[0].matrix, user.matrix);
  assert.deepEqual(opActions({ kind: 'barrier', name: 'barrier', targets: [0], controls: [] }), []);
});

test('Bell and GHZ states, and SWAPSEQ reversal', () => {
  const s = new StatevectorSimulator(3);
  s.applyOp(g('H', [0]));
  s.applyOp(g('CX', [1], [0]));
  s.applyOp(g('CX', [2], [1]));
  const p = s.probabilities();
  close(p[0], 0.5);
  close(p[7], 0.5);
  close(s.expectation('ZZI'), 1);
  close(s.expectation('XXX'), 1);
  close(s.expectation({ 0: 'Z' }), 0);
  const r = new StatevectorSimulator(4);
  r.applyOp(g('X', [0]));
  r.applyOp(g('X', [1]));
  r.applyOp(g('SWAPSEQ', [0, 1, 2, 3]));
  close(r.probabilities()[0b1100], 1);
});

test('statevector agrees with the reference on hand-built ops with multi-controls', () => {
  const ops = [
    g('H', [0]), g('H', [1]), g('RY', [2], [], [0.8]), g('CX', [3], [0, 1]), g('CSWAP', [2, 3], [0]),
    g('RY', [1], [2], [1.1]), g('CP', [3], [0], [0.6]), g('U', [2], [], [1, 2, 3]), g('ISWAP', [0, 2]),
  ];
  const s = new StatevectorSimulator(4);
  ops.forEach((op) => s.applyOp(op));
  const ref = refState(4, ops);
  for (let i = 0; i < 16; i++) {
    close(s.re[i], ref.re[i]);
    close(s.im[i], ref.im[i]);
  }
});

test('single precision tracks double precision closely', () => {
  const ops = [g('H', [0]), g('RX', [1], [], [0.3]), g('CX', [2], [0]), g('T', [2]), g('SQRTSWAP', [1, 2])];
  const d = new StatevectorSimulator(3);
  const f = new StatevectorSimulator(3, { precision: 'single' });
  assert.ok(f.re instanceof Float32Array);
  for (const op of ops) {
    d.applyOp(op);
    f.applyOp(op);
  }
  for (let i = 0; i < 8; i++) close(f.re[i], d.re[i], 1e-6);
  assert.throws(() => new StatevectorSimulator(2, { precision: 'half' }), /precision/);
});

test('measurement collapses, renormalizes, and follows Born statistics', () => {
  const rng = createRng(42);
  let ones = 0;
  const shots = 4000;
  const theta = 2 * Math.acos(Math.sqrt(0.8));
  for (let k = 0; k < shots; k++) {
    const s = new StatevectorSimulator(2);
    s.applyOp(g('RY', [0], [], [theta]));
    s.applyOp(g('CX', [1], [0]));
    const [b0, b1] = s.measure([0, 1], rng);
    assert.equal(b0, b1, 'Bell-like correlation survives measurement');
    close(s.norm(), 1);
    close(s.probabilities()[b0 ? 3 : 0], 1);
    ones += b0;
  }
  // P(1) = 0.2; 4 standard deviations is about 0.025.
  close(ones / shots, 0.2, 0.025);
});

test('sample returns counts without collapsing and is reproducible by seed', () => {
  const s = new StatevectorSimulator(2);
  s.applyOp(g('H', [1]));
  const a = s.sample(1000, createRng(9));
  const b = s.sample(1000, createRng(9));
  assert.deepEqual(a, b);
  assert.deepEqual(Object.keys(a).sort(), ['00', '10']);
  assert.equal(a['00'] + a['10'], 1000);
  close(a['10'] / 1000, 0.5, 0.06);
  close(s.probabilities()[2], 0.5);
  assert.equal(bitstring(2, 3), '010');
});

test('marginalProbabilities orders index bits by the wires given', () => {
  const s = new StatevectorSimulator(3);
  s.applyOp(g('X', [2]));
  const p = s.marginalProbabilities([2, 0]);
  close(p[0b01], 1);
});

test('20 qubits run comfortably with strided kernels', () => {
  const s = new StatevectorSimulator(20);
  const start = Date.now();
  for (let q = 0; q < 20; q++) s.applyOp(g('H', [q]));
  for (let q = 0; q < 19; q++) s.applyOp(g('CZ', [q + 1], [q]));
  s.applyOp(g('RY', [7], [3, 5], [0.4]));
  const elapsed = Date.now() - start;
  close(s.norm(), 1, 1e-9);
  assert.ok(elapsed < 10000, `took ${elapsed} ms`);
});

test('createBackend drives the simulator through applyOp and measure', () => {
  const s = new StatevectorSimulator(2);
  const backend = createBackend(s, createRng(1));
  backend.applyOp(g('X', [1]));
  backend.applyOp(m([0]));
  assert.deepEqual(backend.measure([1, 0]), [1, 0]);
});

test('runCircuit teleports a state with measurements and if ops', () => {
  const prep = [g('RY', [0], [], [1.1]), g('RZ', [0], [], [0.4])];
  const reference = new StatevectorSimulator(1);
  prep.forEach((op) => reference.applyOp(op));
  const want = blochVector(reference, 0);
  const ops = [
    ...prep,
    g('H', [1]), g('CX', [2], [1]),
    g('CX', [1], [0]), g('H', [0]),
    m([0], 'a'), m([1], 'b'),
    { kind: 'if', name: 'if', targets: [], controls: [], params: [], branches: [{ condText: 'b == 1', ops: [g('X', [2])] }], elseOps: [] },
    { kind: 'if', name: 'if', targets: [], controls: [], params: [], branches: [{ condText: 'a', ops: [g('Z', [2])] }] },
  ];
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const steps = [];
    const run = runCircuit(circuit(3, ops), { seed, onStep: (info) => steps.push(info) });
    const got = blochVector(run.state, 2);
    close(got.x, want.x);
    close(got.y, want.y);
    close(got.z, want.z);
    assert.equal(run.record.length, 2);
    assert.equal(run.registers.a, run.record[0].bits[0]);
    const executed = 8 + run.registers.a + run.registers.b;
    assert.equal(steps.length, executed);
    assert.equal(steps.at(-1).registers.b, run.registers.b);
  }
});

test('indexed registers, elseif chains, and a custom condition evaluator', () => {
  const branches = [
    { condText: 'c == 0b11', ops: [g('X', [2])] },
    { condText: 'c[0]', ops: [g('H', [2])] },
  ];
  const ops = [g('X', [0]), g('X', [1]), m([0], 'c[0]'), m([1], 'c[1]'), { kind: 'if', branches, elseOps: [] }];
  const run = runCircuit(circuit(3, ops));
  assert.equal(run.registers.c, 3);
  close(run.state.probabilities()[0b111], 1);
  const seen = [];
  const sim = new StatevectorSimulator(3);
  executeCircuit(sim, circuit(3, ops), {
    evaluateCondition: (text) => {
      seen.push(text);
      return false;
    },
  });
  assert.deepEqual(seen, ['c == 0b11', 'c[0]']);
  close(sim.probabilities()[0b011], 1);
});

test('outcomeDistribution averages over measurement branches exactly', () => {
  // Measure a |+> qubit, then flip qubit 1 when the result is 1: final
  // distribution is 1/2 |00> + 1/2 |11>.
  const ops = [g('H', [0]), m([0], 'r'), { kind: 'if', branches: [{ condText: 'r == 1', ops: [g('X', [1])] }] }];
  const d = outcomeDistribution(circuit(2, ops));
  close(d[0], 0.5);
  close(d[3], 0.5);
  close(d[1] + d[2], 0);
  assert.throws(() => outcomeDistribution(circuit(3, [g('H', [0]), g('H', [1]), g('H', [2]), m([0, 1, 2])]), { maxBranches: 4 }), /measurement branches/);
});

test('evaluateCondition covers Qubi operators', () => {
  const scope = { m: 2, k: 1, flag: true };
  assert.equal(evaluateCondition('m == 2 && k', scope), true);
  assert.equal(evaluateCondition('m == 2 and not k', scope), false);
  assert.equal(evaluateCondition('m[1] xor k', scope), false);
  assert.equal(evaluateCondition('(m | k) == 0b11', scope), true);
  assert.equal(evaluateCondition('m ** 3 == 8 ? flag : 0', scope), true);
  assert.equal(evaluateCondition('(~k & 0x3) == 2', scope), true);
  assert.equal(evaluateCondition('m % 2 != 0 || k >= 1', scope), true);
  assert.throws(() => evaluateCondition('zz == 1', scope), /unknown name "zz"/);
  assert.throws(() => evaluateCondition('m == ', scope), /ends early/);
  assert.throws(() => evaluateCondition('m $ 1', scope), /Cannot read condition/);
});

test('errors name the problem', () => {
  const s = new StatevectorSimulator(2);
  assert.throws(() => s.applyOp(g('H', [2])), /wire 2 is outside/);
  assert.throws(() => s.applyOp(g('CX', [0], [0])), /wire 0 is used twice/);
  assert.throws(() => s.applyOp({ kind: 'if', branches: [] }), /runCircuit/);
  assert.throws(() => s.expectation('XQ'), /Unknown Pauli letter/);
  assert.throws(() => s.setAmplitudes([0, 0, 0, 0]), /zero state/);
  s.setAmplitudes([1, 1, 0, 0]);
  close(s.probabilities()[1], 0.5);
});
