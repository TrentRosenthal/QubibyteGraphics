import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOpenQasm2, toOpenQasm3 } from '../../src/quantum/export/openqasm.js';
import { toQiskitJson } from '../../src/quantum/export/qiskit.js';
import { toCirqJson } from '../../src/quantum/export/cirq.js';
import { piAngle } from '../../src/quantum/export/common.js';
import { importOpenQasm } from '../../src/quantum/import/openqasm.js';
import { importQiskit } from '../../src/quantum/import/qiskit.js';
import { importCirq } from '../../src/quantum/import/cirq.js';
import { lowerOp } from '../../src/quantum/lower.js';
import { circuitUnitary, gateOp } from '../../src/quantum/decompose.js';
import { gateMatrix } from '../../src/quantum/gates.js';
import * as C from '../../src/quantum/cmatrix.js';
import { randomOps, lcg } from './helpers/quantum-ref.js';

const gatesOnly = (c) => ({ numQubits: c.numQubits, ops: c.ops.filter((o) => o.kind === 'gate') });
const measured = (c) => c.ops.filter((o) => o.kind === 'measure').flatMap((o) => o.targets);

const ROUND_TRIPS = [
  ['OpenQASM 2', (c) => importOpenQasm(toOpenQasm2(c)).circuit],
  ['OpenQASM 3', (c) => importOpenQasm(toOpenQasm3(c)).circuit],
  ['Qiskit JSON', (c) => importQiskit(JSON.stringify(toQiskitJson(c))).circuit],
  ['Cirq JSON', (c) => importCirq(JSON.stringify(toCirqJson(c))).circuit],
];

function checkRoundTrip(circuit, label) {
  const u = circuitUnitary(gatesOnly(circuit));
  for (const [format, trip] of ROUND_TRIPS) {
    const back = trip(circuit);
    assert.equal(back.numQubits, circuit.numQubits, `${label} ${format}`);
    assert.ok(C.equalsUpToPhase(circuitUnitary(gatesOnly(back)), u, 1e-8), `${label} ${format}`);
    assert.deepEqual(measured(back), measured(circuit), `${label} ${format} measurements`);
  }
}

test('random circuits over the whole Qubi gate set survive every round trip', () => {
  const rnd = lcg(2024);
  for (let trial = 0; trial < 12; trial++) {
    const ops = randomOps(4, 20, rnd);
    ops.push({ kind: 'measure', name: 'MEASURE', targets: [0, 2], controls: [], params: [] });
    checkRoundTrip({ numQubits: 4, ops }, `trial ${trial}`);
  }
});

test('user matrices, controlled rotations, SWAPSEQ and multi-control gates round-trip', () => {
  const v = C.multiply(gateMatrix('RY', [0.4]), gateMatrix('RZ', [1.3]));
  const two = circuitUnitary({ numQubits: 2, ops: [gateOp('H', [0]), gateOp('CX', [1], [], [0]), gateOp('T', [1]), gateOp('SQRTSWAP', [0, 1])] });
  const ops = [
    { kind: 'gate', name: 'MINE', targets: [1], controls: [], params: [], matrix: v },
    { kind: 'gate', name: 'PAIR', targets: [2, 0], controls: [], params: [], matrix: two },
    gateOp('RY', [3], [0.8], [1]),
    gateOp('U', [2], [0.3, 0.2, 0.1], [0]),
    gateOp('H', [0], [], [3]),
    gateOp('SWAPSEQ', [0, 1, 2, 3]),
    gateOp('CZ', [3], [], [0, 1]),
    gateOp('CY', [2], [], [0, 3]),
    gateOp('CP', [0], [0.9], [1, 2]),
    gateOp('CX', [0], [], [1, 2, 3]),
    gateOp('ISWAP', [1, 3]),
    { kind: 'barrier', name: 'barrier', targets: [0, 1, 2, 3], controls: [], params: [] },
    { kind: 'measure', name: 'MEASURE', targets: [3], controls: [], params: [], register: 'out[1]' },
  ];
  const circuit = { numQubits: 4, ops };
  const u = circuitUnitary(gatesOnly(circuit));
  // Cirq has no gate with three controls, so it is checked on a smaller set below.
  for (const [format, trip] of ROUND_TRIPS.slice(0, 3)) {
    assert.ok(C.equalsUpToPhase(circuitUnitary(gatesOnly(trip(circuit))), u, 1e-8), format);
  }
  checkRoundTrip({ numQubits: 4, ops: ops.filter((o) => !(o.name === 'CX' && o.controls.length === 3)) }, 'cirq subset');
  const q3 = toOpenQasm3(circuit);
  assert.match(q3, /cry\(0\.8\) q\[1\], q\[3\];/);
  assert.match(q3, /ctrl\(2\) @ z q\[0\], q\[1\], q\[3\];/);
  assert.match(q3, /ctrl\(3\) @ x q\[1\], q\[2\], q\[3\], q\[0\];/);
  assert.match(q3, /bit\[2\] out;\n/);
  assert.match(q3, /out\[1\] = measure q\[3\];/);
  const q2 = toOpenQasm2(circuit);
  assert.match(q2, /creg out\[2\];/);
  assert.doesNotMatch(q2, /ctrl/);
  const qj = toQiskitJson(circuit);
  assert.equal(qj.instructions.find((i) => i.name === 'unitary').label, 'MINE');
  assert.deepEqual(qj.instructions.find((i) => i.name === 'measure').clbits, [1]);
});

test('lowering of multiply controlled gates is exact', () => {
  const cases = [
    gateOp('RY', [0], [0.7], [1, 2]),
    gateOp('H', [3], [], [0, 1, 2]),
    gateOp('U', [1], [0.3, 1.2, -0.4], [3, 0, 2]),
    { kind: 'gate', name: 'V', targets: [2], controls: [0, 1], params: [], matrix: gateMatrix('T') },
  ];
  const onlyCx = (op) => op.name === 'CX' || (op.controls.length === 0 && ['RZ', 'RY', 'P', 'U'].includes(op.name));
  for (const op of cases) {
    const lowered = lowerOp(op, onlyCx, 'test');
    assert.ok(lowered.every(onlyCx));
    const want = circuitUnitary({ numQubits: 4, ops: [op] });
    assert.ok(C.equals(circuitUnitary({ numQubits: 4, ops: lowered }), want, 1e-9), op.name);
  }
  assert.throws(() => lowerOp({ kind: 'gate', name: 'BIG', targets: [0, 1, 2], controls: [], params: [], matrix: C.identity(8) }, () => false, 'Fmt'), /Fmt: cannot express 3-qubit gate BIG/);
});

test('exported text uses pi fractions and the right headers', () => {
  const circuit = { numQubits: 2, ops: [gateOp('RX', [0], [Math.PI / 2]), gateOp('P', [1], [-0.75 * Math.PI]), gateOp('CP', [1], [0.123], [0])] };
  const q2 = toOpenQasm2(circuit);
  assert.equal(q2, 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nrx(pi/2) q[0];\nu1(-3*pi/4) q[1];\ncu1(0.123) q[0], q[1];\n');
  assert.match(toOpenQasm3(circuit), /^OPENQASM 3\.0;\ninclude "stdgates\.inc";\nqubit\[2\] q;\n/);
  assert.equal(piAngle(Math.PI), 'pi');
  assert.equal(piAngle(-Math.PI / 3), '-pi/3');
  const cj = toCirqJson(circuit);
  assert.equal(cj.cirq_type, 'Circuit');
  assert.equal(cj.moments.length, 2);
  assert.deepEqual(cj.moments[0].operations.map((o) => o.gate.cirq_type), ['Rx', 'ZPowGate']);
  assert.equal(cj.moments[1].operations[0].gate.exponent, 0.123 / Math.PI);
  assert.throws(() => toOpenQasm2({ numQubits: 1, ops: [{ kind: 'if', branches: [] }] }), /classical if/);
});
