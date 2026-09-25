import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev } from './helpers/qubi.js';
import { formatAngle, toQubiSource, evaluate } from '../../src/qubi/index.js';
import { simulate, probabilities, zeroState, applyOp } from './helpers/refsim.js';

test('formatAngle in piradians shows multiples of π', () => {
  assert.equal(formatAngle(Math.PI / 4), '0.25π');
  assert.equal(formatAngle(Math.PI), 'π');
  assert.equal(formatAngle(-Math.PI), '-π');
  assert.equal(formatAngle(2 * Math.PI), '2π');
  assert.equal(formatAngle(0), '0');
  assert.equal(formatAngle(-1e-12), '0');
  assert.equal(formatAngle(Math.PI / 3, 'pirad'), '0.333π');
  assert.equal(formatAngle(Math.PI / 3, 'piradians', 5), '0.33333π');
});

test('formatAngle in degrees and radians', () => {
  assert.equal(formatAngle(Math.PI / 4, 'degrees'), '45°');
  assert.equal(formatAngle(Math.PI / 3, 'deg', 1), '60°');
  assert.equal(formatAngle(Math.PI / 4, 'radians'), '0.785');
  assert.equal(formatAngle(1, 'rad', 0), '1');
  assert.throws(() => formatAngle(1, 'turns'), /Unknown angle unit turns/);
});

function sameOps(a, b) {
  assert.equal(b.length, a.length, 'op count');
  a.forEach((x, k) => {
    const y = b[k];
    assert.deepEqual([y.kind, y.name, y.targets, y.controls, y.register], [x.kind, x.name, x.targets, x.controls, x.register], `op ${k}`);
    assert.equal(y.params.length, x.params.length);
    x.params.forEach((p, j) => assert.ok(Math.abs(p - y.params[j]) < 1e-12, `op ${k} param ${j}: ${p} vs ${y.params[j]}`));
    if (x.matrix) {
      Array.from(x.matrix.re).forEach((v, j) => assert.ok(Math.abs(v - y.matrix.re[j]) < 1e-12));
      Array.from(x.matrix.im).forEach((v, j) => assert.ok(Math.abs(v - y.matrix.im[j]) < 1e-12));
    }
  });
}

test('round trip: parse(toQubiSource(c)) reproduces the ops', () => {
  const src = [
    '#settings MaxQubits 5', '#settings VisibleQubits 4',
    'gate PH {', ' label: Ph', ' matrix: [1 0; 0 e**(1i*0.3)]', ' color: cyan', '}',
    'gate SW2 {', ' matrix: [1 0 0 0; 0 0 1 0; 0 1 0 0; 0 0 0 1]', '}',
    'I 0', 'H (0..4)', 'X 1', 'Y 2', 'Z 3', 'S 0', 'T 1', 'SDG 2', 'TDG 3',
    'RX 0 0.3', 'RY 1 1.234567rad', 'RZ 2 -0.75', 'P(1/3) 3', 'U(0.1, 0.2, 0.3) 4',
    'CX [0,1]', 'CX [0,1,2]', 'CY [2,3]', 'CZ [3,4]', 'CP(0.125) [0,4]', 'SWAP [1,2]', 'CSWAP [0,1,2]',
    'ISWAP [3,4]', 'SQRTSWAP [0,3]', 'PH 2', 'SW2 [4,1]',
    'LABEL (0,1) "a \\{n\\} \\"b\\""', 'MEASURE 4', 'm = MEASURE (2,0)', 'm = MEASURE (1,3)', 'k = MEASURE 1',
  ].join('\n');
  const c = ev(src);
  const text = toQubiSource(c);
  const back = evaluate(text);
  sameOps(c.ops, back.ops);
  assert.deepEqual([back.numQubits, back.visibleQubits], [5, 4]);
  assert.deepEqual(back.labels.map((l) => [l.wires, l.text, l.opIndex]), c.labels.map((l) => [l.wires, l.text, l.opIndex]));
  assert.equal(back.gateDefs.PH.label, 'Ph');
  assert.equal(back.ops.find((o) => o.name === 'PH').color, 'cyan');
  assert.match(text, /^RX\(0\.3\) 0$/m);
  assert.match(text, /^RY\(1\.234567rad\) 1$/m);
  assert.match(text, /^m = MEASURE \(2,0\)\nm = MEASURE \(1,3\)\nk = MEASURE \(1\)$/m);
  assert.equal(back.labels[0].text, 'a {n} "b"');
});

test('stdlib circuits flatten and keep their exact state', () => {
  for (const src of ['StatePreparation((0b01, 0b10, 0b11), (0.2, 0.3, 0.4))', 'W(0..3)', 'Grover(0b101)', 'QFT(0..3)', 'Shor']) {
    const c = ev(src);
    const back = evaluate(toQubiSource(c));
    const a = probabilities(simulate(c));
    const b = probabilities(simulate(back));
    a.forEach((p, i) => assert.ok(Math.abs(p - b[i]) < 1e-12, `${src} state ${i}`));
    assert.ok(back.ops.every((o) => !o.group), 'the output is flat');
  }
});

test('controlled rotations and phases without a Qubi form become exact equivalents', () => {
  const ops = [
    { kind: 'gate', name: 'H', targets: [0], controls: [], params: [] },
    { kind: 'gate', name: 'H', targets: [1], controls: [], params: [] },
    { kind: 'gate', name: 'RY', targets: [2], controls: [0, 1], params: [0.7] },
    { kind: 'gate', name: 'RX', targets: [0], controls: [2], params: [1.1] },
    { kind: 'gate', name: 'RZ', targets: [1], controls: [0], params: [-0.4] },
    { kind: 'gate', name: 'S', targets: [2], controls: [0], params: [] },
    { kind: 'gate', name: 'H', targets: [2], controls: [1], params: [] },
    { kind: 'gate', name: 'U', targets: [0], controls: [1, 2], params: [0.3, 0.2, 0.1] },
    { kind: 'gate', name: 'ISWAP', targets: [0, 2], controls: [1], params: [] },
    { kind: 'gate', name: 'I', targets: [1], controls: [0], params: [] },
  ];
  const circuit = { numQubits: 3, visibleQubits: 3, ops, labels: [], gateDefs: {} };
  const text = toQubiSource(circuit);
  assert.match(text, /^CP\(0\.5\) \[0,2\]$/m);
  const back = evaluate(text);
  const a = zeroState(3);
  ops.forEach((op) => applyOp(a, op));
  const b = simulate(back);
  for (let i = 0; i < 8; i++) {
    assert.ok(Math.abs(a.re[i] - b.re[i]) < 1e-12 && Math.abs(a.im[i] - b.im[i]) < 1e-12, `amplitude ${i}`);
  }
});

test('if ops have no flat source form', () => {
  assert.throws(() => toQubiSource(ev('m = MEASURE 0\nif m == 1 { X 1 }')), /toQubiSource takes a flat circuit/);
});
