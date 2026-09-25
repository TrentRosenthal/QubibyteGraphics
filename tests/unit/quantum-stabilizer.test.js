import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StabilizerSimulator, isClifford } from '../../src/quantum/stabilizer.js';
import { StatevectorSimulator } from '../../src/quantum/statevector.js';
import { executeCircuit } from '../../src/quantum/run.js';
import { createRng } from '../../src/quantum/rng.js';
import { randomOps, lcg } from './helpers/quantum-ref.js';

const g = (name, targets, controls = [], params = []) => ({ kind: 'gate', name, targets, controls, params });
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('random Clifford circuits: every stabilizer generator has expectation +1 or -1 matching its sign', () => {
  const rnd = lcg(77);
  for (let trial = 0; trial < 40; trial++) {
    const n = 1 + Math.floor(rnd() * 5);
    const ops = randomOps(n, 30, rnd, { clifford: true });
    assert.ok(isClifford({ ops }));
    const tab = new StabilizerSimulator(n);
    const sv = new StatevectorSimulator(n);
    for (const op of ops) {
      tab.applyOp(op);
      sv.applyOp(op);
    }
    for (const s of tab.stabilizers()) {
      close(sv.expectation(s.slice(1)), s[0] === '-' ? -1 : 1);
    }
  }
});

test('deterministic measurement outcomes agree with the statevector', () => {
  const rnd = lcg(9);
  for (let trial = 0; trial < 30; trial++) {
    const n = 2 + Math.floor(rnd() * 3);
    const ops = randomOps(n, 20, rnd, { clifford: true });
    const tab = new StabilizerSimulator(n);
    const sv = new StatevectorSimulator(n);
    for (const op of ops) {
      tab.applyOp(op);
      sv.applyOp(op);
    }
    for (let q = 0; q < n; q++) {
      const p1 = sv.probabilityOfOne(q);
      const deterministic = p1 < 1e-9 || p1 > 1 - 1e-9;
      assert.equal(tab.isDeterministic(q), deterministic);
      if (deterministic) {
        const clone = new StabilizerSimulator(n);
        ops.forEach((op) => clone.applyOp(op));
        assert.equal(clone.measureQubit(q), p1 > 0.5 ? 1 : 0);
      }
    }
  }
});

test('random outcomes are fair and collapse consistently', () => {
  const rng = createRng(4);
  let ones = 0;
  for (let k = 0; k < 2000; k++) {
    const t = new StabilizerSimulator(3);
    t.applyOp(g('H', [0]));
    t.applyOp(g('CX', [1], [0]));
    t.applyOp(g('CX', [2], [1]));
    const bits = t.measure([1, 0, 2], rng);
    assert.ok(bits.every((b) => b === bits[0]));
    assert.equal(t.measureQubit(0, rng), bits[0]);
    ones += bits[0];
  }
  close(ones / 2000, 0.5, 0.05);
});

test('handles 1200 qubits: GHZ measures all equal, phases are tracked', () => {
  const n = 1200;
  const t = new StabilizerSimulator(n);
  t.applyOp(g('H', [0]));
  for (let q = 1; q < n; q++) t.applyOp(g('CX', [q], [q - 1]));
  const bits = t.measure(Array.from({ length: n }, (_, q) => q), createRng(2));
  assert.ok(bits.every((b) => b === bits[0]));
  const z = new StabilizerSimulator(40);
  z.applyOp(g('H', [33]));
  z.applyOp(g('S', [33]));
  z.applyOp(g('S', [33]));
  z.applyOp(g('H', [33]));
  assert.equal(z.measureQubit(33), 1);
  assert.equal(z.stabilizers()[33][0], '-');
});

test('SWAP, CY, SDG and Y match the statevector on a fixed circuit', () => {
  const ops = [g('H', [0]), g('SDG', [0]), g('CY', [2], [0]), g('SWAP', [0, 1]), g('Y', [1]), g('CZ', [0], [1]), g('I', [2])];
  const t = new StabilizerSimulator(3);
  const sv = new StatevectorSimulator(3);
  ops.forEach((op) => {
    t.applyOp(op);
    sv.applyOp(op);
  });
  for (const s of t.stabilizers()) close(sv.expectation(s.slice(1)), s[0] === '-' ? -1 : 1);
});

test('isClifford rejects non-Clifford gates and executeCircuit branches on the tableau', () => {
  assert.equal(isClifford({ ops: [g('T', [0])] }), false);
  assert.equal(isClifford({ ops: [g('CX', [2], [0, 1])] }), false);
  assert.equal(isClifford({ ops: [g('RZ', [0], [], [1])] }), false);
  assert.equal(isClifford({ ops: [{ ...g('X', [0]), matrix: {} }] }), false);
  const branchy = { kind: 'if', branches: [{ condText: 'r', ops: [g('X', [1])] }], elseOps: [g('T', [1])] };
  assert.equal(isClifford({ ops: [branchy] }), false);
  assert.throws(() => new StabilizerSimulator(1).applyOp(g('T', [0])), /Clifford gates only/);
  const t = new StabilizerSimulator(2);
  const ops = [g('X', [0]), { kind: 'measure', name: 'MEASURE', targets: [0], register: 'r' },
    { kind: 'if', branches: [{ condText: 'r', ops: [g('X', [1])] }] }];
  executeCircuit(t, { numQubits: 2, ops });
  assert.equal(t.measureQubit(1), 1);
});
