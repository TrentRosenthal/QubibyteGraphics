import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, opsOf, rejects } from './helpers/qubi.js';
import { parse } from '../../src/qubi/index.js';

const REF_GATE = `gate NAME {
\tname: Display Name
\tlabel: LBL
\tmatrix: [1 0; 0 e**(1i*pi/4)]
\tdesc: ...
\texamples: NAME 0
\tcolor: cyan
\tcategory: Single
\tqubits: 1
}
`;

test('the reference gate definition parses and applies as one matrix op', () => {
  const c = ev(REF_GATE + 'NAME 0');
  const op = c.ops[0];
  assert.deepEqual([op.name, op.targets, op.label, op.color], ['NAME', [0], 'LBL', 'cyan']);
  assert.equal(op.matrix.rows, 2);
  assert.deepEqual(Array.from(op.matrix.re).map((x) => +x.toFixed(12)), [1, 0, 0, +Math.SQRT1_2.toFixed(12)]);
  assert.deepEqual(Array.from(op.matrix.im).map((x) => +x.toFixed(12)), [0, 0, 0, +Math.SQRT1_2.toFixed(12)]);
  const def = c.gateDefs.NAME;
  assert.deepEqual(
    [def.displayName, def.label, def.desc, def.examples, def.color, def.category, def.qubits, def.matrixText],
    ['Display Name', 'LBL', '...', 'NAME 0', 'cyan', 'Single', 1, '[1 0; 0 e**(1i*pi/4)]'],
  );
});

test('a one-qubit matrix gate broadcasts over a parallel list and accepts adjacent parentheses', () => {
  assert.deepEqual(opsOf(REF_GATE + 'NAME (0,2)\nNAME(1)'), ['NAME 0', 'NAME 2', 'NAME 1']);
});

test('multi-qubit matrix gates take a register of exactly their size', () => {
  const src = 'gate SW {\n matrix: [1 0 0 0; 0 0 1 0; 0 1 0 0; 0 0 0 1]\n}\n';
  assert.deepEqual(opsOf(src + 'SW [2,0]'), ['SW 2,0']);
  rejects(src + 'SW 0', /SW acts on 2 qubits: SW \[0,1\]/);
  assert.equal(ev(src + 'SW [0,1]').gateDefs.SW.qubits, 2);
});

test('matrices may span lines', () => {
  const c = ev('gate G {\n matrix: [0 1;\n   1 0]\n}\nG 0');
  assert.deepEqual(Array.from(c.ops[0].matrix.re), [0, 1, 1, 0]);
});

test('sequence gates expand into their sequence with wires relative to the call', () => {
  const src = 'gate PAIR {\n name: Bell pair\n sequence: {\n  H 0\n  CX [0,1]\n }\n qubits: 2\n}\nPAIR [2,3]';
  const c = ev(src);
  assert.deepEqual(c.ops.map((o) => `${o.name} ${o.controls.join(',')}>${o.targets.join(',')}`), ['H >2', 'CX 2>3']);
  assert.ok(c.ops.every((o) => o.group.name === 'PAIR' && o.group.kind === 'gate'));
  assert.equal(c.gateDefs.PAIR.sequenceText, 'H 0\n  CX [0,1]');
});

test('a one-line sequence and a one-qubit sequence broadcast', () => {
  assert.deepEqual(opsOf('gate HX {\n sequence: H 0\n qubits: 1\n}\nHX (0,1)'), ['H 0', 'H 1']);
});

test('without qubits:, a sequence gate takes all given wires; max is its last qubit', () => {
  assert.deepEqual(opsOf('gate ENDS {\n sequence: CX [0,max]\n}\nENDS (1,2,3)'), ['CX 1>3']);
});

test('a sequence that uses a wire past the gate size is an error', () => {
  rejects('gate G {\n sequence: X 2\n qubits: 2\n}\nG [0,1]', /Gate G has 2 qubits; its sequence uses wire 2/);
});

test('matrix and qubits must agree', () => {
  rejects('gate G {\n matrix: [1 0; 0 1]\n qubits: 2\n}\nG [0,1]', /Gate G: qubits is 2 but the matrix is 2x2 \(1 qubit\)/);
});

test('a non-unitary matrix gives a warning', () => {
  const c = ev('gate G {\n matrix: [1 1; 0 1]\n}\nG 0');
  assert.ok(c.diagnostics.some((d) => d.severity === 'warning' && d.message === 'Gate G: the matrix is not unitary'));
});

test('matrices use e**, not exp()', () => {
  rejects('gate G {\n matrix: [1 0; 0 exp(1i*pi/4)]\n}\nG 0', /use e\*\* for exponentials, as in e\*\*\(1i\*pi\/4\), not exp\(\) at line 2, col 18/);
});

test('gate definition shape errors', () => {
  assert.throws(() => parse('gate G {\n label: G\n}'), /Gate G needs matrix: or sequence:/);
  assert.throws(() => parse('gate G {\n matrix: [1 0; 0 1]\n sequence: X 0\n}'), /takes matrix: or sequence:, not both/);
  assert.throws(() => parse('gate G {\n colour: red\n matrix: [1 0; 0 1]\n}'), /Gate G: unknown property colour/);
  assert.throws(() => parse('gate G {\n label: A\n label: B\n matrix: [1 0; 0 1]\n}'), /Gate G: label is given twice/);
  assert.throws(() => parse('gate G {\n just text\n}'), /Gate G: each line is key: value/);
  assert.throws(() => parse('gate G {\n matrix: [1 0; 0 1]\n qubits: two\n}'), /qubits takes a whole number/);
  assert.throws(() => parse('gate G {\n matrix: [1 0; 0 1]'), /Gate G is missing its closing \}/);
  assert.throws(() => parse('gate H {\n matrix: [1 0; 0 1]\n}'), /H is a native gate and cannot be redefined/);
  assert.throws(() => parse('gate G {\n sequence: #settings MaxQubits 3\n}'), /goes at the top level|sequence holds gate statements only/);
  rejects('gate QFT {\n matrix: [1 0; 0 1]\n}\nX 0', /QFT is a standard library name and cannot be redefined/);
  rejects('gate G {\n matrix: [1 0; 0 1]\n}\ngate G {\n matrix: [1 0; 0 1]\n}\nX 0', /Gate G is already defined/);
});

test('comment lines inside a gate body are skipped', () => {
  assert.equal(ev('gate G {\n // identity\n /* still identity */\n matrix: [1 0; 0 1]\n}\nG 0').ops.length, 1);
});

test('function NAME(...) { } and fn NAME(...) { } bind their parameters', () => {
  assert.deepEqual(opsOf('function Pair(a, b) {\n H a\n CX [a, b]\n}\nPair(0, 2)'), ['H 0', 'CX 0>2']);
  assert.deepEqual(opsOf('fn Flip(q) { X q }\nFlip 3'), ['X 3']);
});

test('functions may be used before they are defined', () => {
  assert.deepEqual(opsOf('Later(1)\nfn Later(q) { Z q }'), ['Z 1']);
});

test('arg is the flat list of all arguments and argmax its last index', () => {
  const c = ev('fn Spread() {\n H arg\n n = argmax\n LABEL arg[argmax] "last {n}"\n}\nSpread(0..2)\nSpread(4, 5)');
  assert.deepEqual(c.ops.map((o) => o.targets[0]), [0, 1, 2, 4, 5]);
  assert.deepEqual(c.labels.map((l) => [l.wires, l.text]), [[[2], 'last 2'], [[5], 'last 1']]);
  rejects('X arg', /arg is defined only inside a function/);
});

test('each function call is a group; blackbox and encapsulate set the flag', () => {
  const c = ev('fn Plain(q) { X q }\nblackbox fn Box(q) { H q\n Z q }\nencapsulate function Enc(q) { Y q }\nPlain 0\nBox 1\nEnc 2');
  const groups = c.ops.map((o) => [o.group.name, o.group.kind, o.group.blackbox]);
  assert.deepEqual(groups, [['Plain', 'function', false], ['Box', 'function', true], ['Box', 'function', true], ['Enc', 'function', true]]);
  assert.equal(c.ops[1].group, c.ops[2].group);
  assert.deepEqual(c.ops[1].group.wires, [1]);
  assert.equal(c.ops[1].group.callText, 'Box 1');
});

test('nested calls link groups to their parent', () => {
  const c = ev('fn Inner(q) { X q }\nfn Outer(q) {\n Inner(q)\n Bell(q, q+1)\n}\nOuter(0)');
  const inner = c.ops[0].group;
  assert.deepEqual([inner.name, inner.parent.name], ['Inner', 'Outer']);
  assert.deepEqual(inner.parent.wires, [0, 1]);
  assert.equal(c.ops[1].group.name, 'Bell');
});

test('function errors: missing arguments, runaway recursion, placement, names', () => {
  rejects('fn F(a, b) { X a }\nF(0)', /F expects 2 arguments, got 1/);
  rejects('fn F(a) { X a }\nF(0) 1', /F takes one argument list: F\(a, b\)/);
  rejects('QFT(0..2) 3', /QFT takes one argument list/);
  rejects(REF_GATE + 'NAME(0) 1', /NAME takes its wires once/);
  rejects('fn R(q) { R(q) }\nR(0)', /R nests deeper than 64 calls/);
  assert.throws(() => parse('LOOP 1 {\n fn F(a) { X a }\n}'), /Function definitions go at the top level/);
  assert.throws(() => parse('fn H(a) { X a }'), /H is reserved and cannot name a function/);
  assert.throws(() => parse('fn F(pi) { X 0 }'), /pi is reserved and cannot name a parameter/);
  assert.throws(() => parse('fn F(a, a) { X 0 }'), /Parameter a is listed twice/);
  assert.throws(() => parse('blackbox X'), /Expected function or fn after the modifier/);
  rejects('fn Bell(q) { X q }\nX 0', /Bell is a standard library name/);
});
