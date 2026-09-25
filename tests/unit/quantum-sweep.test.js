import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepProbabilities, parsePattern } from '../../src/quantum/sweep.js';

const g = (name, targets, controls = [], params = []) => ({ kind: 'gate', name, targets, controls, params });
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

function rySweep(values, extra = {}) {
  return values.map((a) => ({
    assignment: { a },
    circuit: { numQubits: 2, ops: [g('RY', [0], [], [a * Math.PI]), g('CX', [1], [0])], variables: { ...extra } },
  }));
}

test('pattern mode: probability of a target bitstring per point, with a plot series', () => {
  const values = [0, 0.25, 0.5, 1];
  const out = sweepProbabilities(rySweep(values), { pattern: '11' });
  assert.equal(out.mode, 'pattern');
  assert.deepEqual(out.axes, ['a']);
  values.forEach((a, i) => close(out.points[i].probability, Math.sin((a * Math.PI) / 2) ** 2));
  assert.deepEqual(out.series.x, values);
  assert.equal(out.points[1].label, 'a=0.25');
});

test('wildcards, short patterns, integer patterns and the sweepstate variable', () => {
  const pts = rySweep([0.5]);
  close(sweepProbabilities(pts, { pattern: '?1' }).points[0].probability, 0.5);
  close(sweepProbabilities(pts, { pattern: '0' }).points[0].probability, 0.5);
  close(sweepProbabilities(pts, { pattern: 'x0' }).points[0].probability, 0.5);
  close(sweepProbabilities(pts, { pattern: 3 }).points[0].probability, 0.5);
  const viaVar = sweepProbabilities(rySweep([1], { sweepstate: '0b11' }));
  close(viaVar.points[0].probability, 1);
  assert.equal(viaVar.points[0].state, '11');
  assert.throws(() => sweepProbabilities(rySweep([1])), /sweepstate/);
  assert.deepEqual(parsePattern('1?0', 3), { mask: 0b101, value: 0b100, text: '1?0' });
  assert.throws(() => parsePattern('102', 3), /only 0, 1, \? and x/);
  assert.throws(() => parsePattern('0101', 3), /longer than 3/);
  assert.throws(() => parsePattern(1.5, 3), /non-negative integer/);
});

test('highest mode reports the most probable state; multi-axis sweeps have no series', () => {
  const points = [];
  for (const a of [0.2, 0.8]) {
    for (const gate of ['X', 'I']) {
      points.push({ assignment: { a, gate }, circuit: { numQubits: 2, ops: [g('RY', [0], [], [a * Math.PI]), g(gate, [1])] } });
    }
  }
  const out = sweepProbabilities(points, { mode: 'highest' });
  assert.equal(out.series, null);
  assert.deepEqual(out.points.map((p) => p.state), ['10', '00', '11', '01']);
  close(out.points[0].probability, Math.cos(0.1 * Math.PI) ** 2);
  assert.throws(() => sweepProbabilities(points, { mode: 'lowest' }), /Sweep mode/);
});

test('mid-circuit measurements are averaged exactly, not sampled', () => {
  const circuit = {
    numQubits: 2,
    ops: [g('H', [0]), { kind: 'measure', name: 'MEASURE', targets: [0], register: 'r' },
      { kind: 'if', branches: [{ condText: 'r', ops: [g('X', [1])] }] }],
  };
  const out = sweepProbabilities([{ assignment: {}, circuit }], { pattern: '11' });
  close(out.points[0].probability, 0.5);
});
