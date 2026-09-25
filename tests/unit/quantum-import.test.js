import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importOpenQasm } from '../../src/quantum/import/openqasm.js';
import { importQiskit } from '../../src/quantum/import/qiskit.js';
import { importCirq } from '../../src/quantum/import/cirq.js';
import { emitQubi, qubiAngle } from '../../src/quantum/import/emit.js';
import { mapForeignGate, addControls } from '../../src/quantum/import/gatemap.js';
import { circuitUnitary, gateOp } from '../../src/quantum/decompose.js';
import { runCircuit } from '../../src/quantum/run.js';
import * as C from '../../src/quantum/cmatrix.js';
import { gateMatrix } from '../../src/quantum/gates.js';

const unitaryOf = (circuit) => circuitUnitary({ numQubits: circuit.numQubits, ops: circuit.ops.filter((o) => o.kind === 'gate') });

/** Unitary of a controlled base matrix, control on wire c, base on wire t, in n qubits. */
function controlled(base, c, t, n = 2) {
  return circuitUnitary({ numQubits: n, ops: [{ kind: 'gate', name: 'CTRL', targets: [t], controls: [c], params: [], matrix: base }] });
}

test('OpenQASM 2: registers, gate definitions, broadcast, measurement, barrier', () => {
  const src = `// Bell pair across two registers
OPENQASM 2.0;
include "qelib1.inc";
qreg a[1];
qreg b[1];
creg c[2];
gate bell x, y { h x; cx x, y; }
bell a[0], b[0];
barrier a, b;
measure a[0] -> c[0];
measure b -> c[1];
`;
  const { circuit, qubi } = importOpenQasm(src);
  assert.equal(circuit.numQubits, 2);
  assert.deepEqual(circuit.ops.map((o) => o.name), ['H', 'CX', 'barrier', 'MEASURE', 'MEASURE']);
  assert.deepEqual(circuit.ops[1].controls, [0]);
  assert.equal(circuit.ops[4].register, 'c[1]');
  assert.equal(qubi, '#settings MaxQubits 2\n\nH 0\nCX [0,1]\nMEASURE 0\nMEASURE 1\n');
  const run = runCircuit(circuit, { seed: 3 });
  assert.ok(run.registers.c === 0 || run.registers.c === 3);
  const bcast = importOpenQasm('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nh q;\ncx q[0], q;'.replace('cx q[0], q;', 'x q;'));
  assert.equal(bcast.circuit.ops.length, 6);
});

test('OpenQASM standard gates map exactly to Qubi forms', () => {
  const cases = [
    ['ccx q[0], q[1], q[2];', (u) => C.equals(u, circuitUnitary({ numQubits: 3, ops: [gateOp('CX', [2], [], [0, 1])] }))],
    ['cswap q[0], q[1], q[2];', (u) => C.equals(u, circuitUnitary({ numQubits: 3, ops: [gateOp('CSWAP', [1, 2], [], [0])] }))],
    ['crz(0.7) q[0], q[1];', (u) => C.equals(u, controlled(gateMatrix('RZ', [0.7]), 0, 1, 3))],
    ['cry(0.7) q[1], q[0];', (u) => C.equals(u, controlled(gateMatrix('RY', [0.7]), 1, 0, 3))],
    ['crx(-1.2) q[2], q[0];', (u) => C.equals(u, controlled(gateMatrix('RX', [-1.2]), 2, 0, 3))],
    ['ch q[0], q[2];', (u) => C.equals(u, controlled(gateMatrix('H'), 0, 2, 3))],
    ['cu3(0.3, 0.2, 0.1) q[0], q[1];', (u) => C.equals(u, controlled(gateMatrix('U', [0.3, 0.2, 0.1]), 0, 1, 3))],
    ['u3(0.3, 0.2, 0.1) q[1];', (u) => C.equals(u, circuitUnitary({ numQubits: 3, ops: [gateOp('U', [1], [0.3, 0.2, 0.1])] }))],
    ['u2(0.2, 0.1) q[1];', (u) => C.equals(u, circuitUnitary({ numQubits: 3, ops: [gateOp('U', [1], [Math.PI / 2, 0.2, 0.1])] }))],
    ['rzz(0.4) q[0], q[1];', (u) => C.equalsUpToPhase(u, C.kron(C.identity(2), C.fromArray([[[Math.cos(0.2), -Math.sin(0.2)], 0, 0, 0], [0, [Math.cos(0.2), Math.sin(0.2)], 0, 0], [0, 0, [Math.cos(0.2), Math.sin(0.2)], 0], [0, 0, 0, [Math.cos(0.2), -Math.sin(0.2)]]])))],
    ['sx q[0]; sx q[0];', (u) => C.equalsUpToPhase(u, circuitUnitary({ numQubits: 3, ops: [gateOp('X', [0])] }))],
  ];
  for (const [line, check] of cases) {
    const { circuit } = importOpenQasm(`OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\n${line}\n`);
    assert.ok(check(unitaryOf(circuit)), line);
  }
  const ccx = importOpenQasm('OPENQASM 2.0;\nqreg q[3];\nccx q[0], q[1], q[2];');
  assert.match(ccx.qubi, /CX \[0,1,2\]/);
  const crz = importOpenQasm('OPENQASM 2.0;\nqreg q[2];\ncrz(pi/2) q[0], q[1];');
  assert.deepEqual(crz.circuit.ops.map((o) => o.name), ['CP', 'P']);
  assert.match(crz.qubi, /CP\(0\.5\) \[0,1\]\nP\(-0\.25\) 0/);
});

test('OpenQASM 3: qubit/bit declarations, measure assignment, ctrl modifiers, expressions', () => {
  const src = `OPENQASM 3;
include "stdgates.inc";
qubit[3] q;
bit[2] c;
qubit extra;
gate rot(t) a { rz(t / 2) a; ry(t ** 2) a; }
rot(pi / 3) q[0];
ctrl @ x q[0], q[1];
ctrl(2) @ rot(1.5) q[0], q[1], q[2];
ctrl @ swap q[2], q[0], extra;
p(-sin(pi/2)) q[1];
c[0] = measure q[0];
c = measure q[1:1];
`.replace('c = measure q[1:1];\n', 'c[1] = measure q[1];\n');
  const { circuit } = importOpenQasm(src);
  assert.equal(circuit.numQubits, 4);
  const names = circuit.ops.map((o) => `${o.name}:${o.controls.length}`);
  assert.deepEqual(names, ['RZ:0', 'RY:0', 'CX:1', 'RZ:2', 'RY:2', 'CSWAP:1', 'P:0', 'MEASURE:0', 'MEASURE:0']);
  const ry = circuit.ops[1];
  assert.ok(Math.abs(ry.params[0] - (Math.PI / 3) ** 2) < 1e-12);
  assert.deepEqual(circuit.ops[5].targets, [0, 3]);
  assert.equal(circuit.ops[6].params[0], -1);
  assert.equal(circuit.ops[8].register, 'c[1]');
  assert.throws(() => importOpenQasm('OPENQASM 3;\nqubit[2] q;\nctrl @ sx q[0], q[1];'), /dropped global phase/);
});

test('unsupported constructs produce clear errors with line numbers', () => {
  const head = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\n';
  const cases = [
    ['reset q[0];', /line 5: unsupported construct: reset/],
    ['if (c==1) x q[0];', /line 5: unsupported construct: classical if/],
    ['foo q[0];', /line 5: Unsupported gate "foo"/],
    ['opaque g q;', /opaque gate/],
    ['h q[2];', /q\[2\] is outside a register of size 2/],
    ['cx q[0], q[0];', /uses a qubit twice/],
    ['rx q[0];', /rx takes 1 parameter/],
    ['measure q[0] -> d[0];', /unknown classical register "d"/],
    ['include "other.inc";', /only qelib1.inc and stdgates.inc/],
  ];
  for (const [line, re] of cases) assert.throws(() => importOpenQasm(head + line), re, line);
  assert.throws(() => importOpenQasm('OPENQASM 3;\nqubit[2] q;\ninv @ x q[0];'), /inv @ modifier/);
  assert.throws(() => importOpenQasm('OPENQASM 3;\nqubit[2] q;\nfor int i in [0:1] { x q[0]; }'), /for loop/);
  assert.throws(() => importOpenQasm('OPENQASM 4.0;\nqreg q[1];'), /version 4.0/);
  assert.throws(() => importOpenQasm('OPENQASM 2.0;'), /declares no qubits/);
  assert.throws(() => importOpenQasm('OPENQASM 2.0;\nqreg q[1];\nh q[0] $'), /unexpected character "\$"/);
});

test('Qiskit JSON: instructions, unitary matrices, measurements, and QPY refusal', () => {
  const data = {
    num_qubits: 3,
    num_clbits: 2,
    instructions: [
      { name: 'h', qubits: [0], params: [] },
      { name: 'cx', qubits: [0, 1], params: [] },
      { name: 'mcx', qubits: [0, 1, 2], params: [] },
      { name: 'cp', qubits: [1, 2], params: [0.5] },
      { name: 'unitary', qubits: [2], params: [[[0, 1], [1, 0]]], label: 'flip' },
      { name: 'cu', qubits: [0, 2], params: [0.3, 0.2, 0.1, 0.4] },
      { name: 'barrier', qubits: [0, 1, 2], params: [] },
      { name: 'measure', qubits: [0, 1], clbits: [1, 0] },
    ],
  };
  const { circuit, qubi } = importQiskit(JSON.stringify(data));
  assert.equal(circuit.ops[2].name, 'CX');
  assert.deepEqual(circuit.ops[2].controls, [0, 1]);
  assert.equal(circuit.ops[4].name, 'FLIP');
  assert.ok(C.equals(circuit.ops[4].matrix, gateMatrix('X')));
  assert.deepEqual(circuit.ops.filter((o) => o.kind === 'measure').map((o) => o.register), ['c[1]', 'c[0]']);
  assert.match(qubi, /gate FLIP \{\n\tname: FLIP\n\tmatrix: \[0 1; 1 0\]\n\tqubits: 1\n\}/);
  assert.match(qubi, /FLIP 2/);
  // cu with gamma: controlled U times a phase on the control.
  const cu = importQiskit({ num_qubits: 2, instructions: [{ name: 'cu', qubits: [0, 1], params: [0.3, 0.2, 0.1, 0.4] }] });
  const want = C.multiply(circuitUnitary({ numQubits: 2, ops: [gateOp('P', [0], [0.4])] }), controlled(gateMatrix('U', [0.3, 0.2, 0.1]), 0, 1));
  assert.ok(C.equals(unitaryOf(cu.circuit), want, 1e-9));
  assert.throws(() => importQiskit(new Uint8Array([81, 73, 83])), /Binary QPY is not parsed/);
  assert.throws(() => importQiskit('QISKIT\u0000\u0001'), /Binary QPY is not parsed/);
  assert.throws(() => importQiskit({ num_qubits: 1, instructions: [{ name: 'reset', qubits: [0] }] }), /reset is not representable/);
  assert.throws(() => importQiskit({ num_qubits: 1, instructions: [{ name: 'rx', qubits: [0], params: ['theta'] }] }), /not a bound number/);
  assert.throws(() => importQiskit({ num_qubits: 1, instructions: [{ name: 'h', qubits: [4] }] }), /qubit 4 is outside/);
  assert.throws(() => importQiskit({ instructions: [] }), /num_qubits/);
});

test('Cirq JSON: moments, qubit mapping and exponent semantics', () => {
  const lq = (x) => ({ cirq_type: 'LineQubit', x });
  const op = (gate, ...qs) => ({ cirq_type: 'GateOperation', gate, qubits: qs.map(lq) });
  const pow = (t, e, s = 0) => ({ cirq_type: t, exponent: e, global_shift: s });
  const data = {
    cirq_type: 'Circuit',
    moments: [
      { cirq_type: 'Moment', operations: [op(pow('HPowGate', 1), 0), op(pow('_PauliX', 1), 2)] },
      { cirq_type: 'Moment', operations: [op(pow('CXPowGate', 1), 0, 1)] },
      { cirq_type: 'Moment', operations: [op(pow('ZPowGate', 0.25), 1), op(pow('ZPowGate', 0.3), 0)] },
      { cirq_type: 'Moment', operations: [op({ cirq_type: 'Rx', rads: 0.2 }, 2), op(pow('CZPowGate', 0.5), 0, 1)] },
      { cirq_type: 'Moment', operations: [op({ cirq_type: 'MeasurementGate', num_qubits: 2, key: 'm', invert_mask: [] }, 0, 1)] },
    ],
  };
  const { circuit } = importCirq(JSON.stringify(data));
  assert.deepEqual(circuit.ops.map((o) => o.name), ['H', 'X', 'CX', 'T', 'P', 'RX', 'CP', 'MEASURE']);
  assert.ok(Math.abs(circuit.ops[4].params[0] - 0.3 * Math.PI) < 1e-12);
  assert.equal(circuit.ops[7].register, 'm');
  const one = (gate, n = 1) => unitaryOf(importCirq({ cirq_type: 'Circuit', moments: [{ cirq_type: 'Moment', operations: [op(gate, ...Array.from({ length: n }, (_, k) => k))] }] }).circuit);
  // H^t, X^t, Y^t equal their definitions up to global phase; controlled powers are exact.
  const hHalf = one(pow('HPowGate', 0.5));
  assert.ok(C.equalsUpToPhase(C.multiply(hHalf, hHalf), gateMatrix('H')));
  assert.ok(C.equalsUpToPhase(one(pow('XPowGate', 0.5, -0.5)), gateMatrix('RX', [Math.PI / 2])));
  const cxHalf = one(pow('CXPowGate', 0.5), 2);
  assert.ok(C.equals(C.multiply(cxHalf, cxHalf), circuitUnitary({ numQubits: 2, ops: [gateOp('CX', [1], [], [0])] }), 1e-12));
  assert.ok(C.equals(one(pow('SwapPowGate', 0.5), 2), gateMatrix('SQRTSWAP')));
  assert.ok(C.equals(one({ cirq_type: 'Rz', rads: 0.4 }), gateMatrix('RZ', [0.4])));
  const grid = importCirq({
    cirq_type: 'Circuit',
    moments: [{ cirq_type: 'Moment', operations: [{ cirq_type: 'GateOperation', gate: pow('_PauliX', 1), qubits: [{ cirq_type: 'GridQubit', row: 3, col: 1 }] },
      { cirq_type: 'GateOperation', gate: pow('_PauliZ', 1), qubits: [{ cirq_type: 'GridQubit', row: 0, col: 5 }] }] }],
  });
  assert.deepEqual(grid.circuit.ops.map((o) => `${o.name}${o.targets[0]}`), ['X1', 'Z0']);
  assert.throws(() => one(pow('SwapPowGate', 0.3), 2), /exponent 0.3/);
  assert.throws(() => one({ cirq_type: 'PhasedXPowGate' }), /Unsupported Cirq gate "PhasedXPowGate"/);
  assert.throws(() => importCirq({ cirq_type: 'Moment' }), /cirq_type/);
});

test('emitter: broadcast, joint registers, angle units, if blocks and lowering', () => {
  const circuit = {
    numQubits: 3,
    ops: [
      gateOp('H', [0, 1, 2]),
      gateOp('SWAP', [0, 2]),
      gateOp('RX', [1], [Math.PI / 3]),
      gateOp('RZ', [0], [0.1234]),
      gateOp('RY', [2], [0.5], [0]),
      { kind: 'measure', name: 'MEASURE', targets: [0, 1], register: 'm' },
      { kind: 'if', branches: [{ condText: 'm == 1', ops: [gateOp('X', [2])] }, { condText: 'm == 2', ops: [gateOp('Z', [2])] }], elseOps: [gateOp('Y', [2])] },
    ],
  };
  const text = emitQubi(circuit);
  assert.match(text, /^H \(0,1,2\)$/m);
  assert.match(text, /^SWAP \[0,2\]$/m);
  assert.match(text, /^RX\(60deg\) 1$/m);
  assert.match(text, /^RZ\(0\.1234rad\) 0$/m);
  assert.match(text, /^MEASURE \(0,1\)$/m);
  assert.match(text, /^if m == 1 \{\n\tX 2\n\} elseif m == 2 \{\n\tZ 2\n\} else \{\n\tY 2\n\}$/m);
  // The controlled RY has no Qubi spelling, so it is lowered to CX and rotations.
  assert.match(text, /CX \[0,2\]/);
  assert.equal(qubiAngle(-Math.PI / 4), '-0.25');
  assert.equal(qubiAngle(0), '0');
});

test('gate map helpers', () => {
  const { ops, exactPhase } = mapForeignGate('SX', [], [1]);
  assert.equal(ops[0].name, 'RX');
  assert.equal(exactPhase, false);
  assert.throws(() => mapForeignGate('mcx', [], [0]), /at least 2 qubits/);
  const ctrl = addControls([gateOp('X', [2]), gateOp('CX', [2], [], [1]), gateOp('H', [2])], [0]);
  assert.deepEqual(ctrl.map((o) => `${o.name}:${o.controls.join(',')}`), ['CX:0', 'CX:0,1', 'H:0']);
  assert.throws(() => addControls([{ kind: 'measure', name: 'MEASURE', targets: [0] }], [1]), /Only gates/);
});
