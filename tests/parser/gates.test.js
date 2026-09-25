import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, opsOf, rejects } from './helpers/qubi.js';
import { GATE_INFO } from '../../src/qubi/ir.js';

const HALF = Math.PI / 2;

test('every single-qubit native gate applies and broadcasts over a list', () => {
  for (const g of ['I', 'H', 'X', 'Y', 'Z', 'S', 'T', 'SDG', 'TDG']) {
    const c = ev(`${g} (0,2)`);
    assert.deepEqual(c.ops.map((o) => [o.kind, o.name, o.targets, o.controls, o.params]), [
      ['gate', g, [0], [], []],
      ['gate', g, [2], [], []],
    ], g);
  }
});

test('rotation gates take one angle and U takes three', () => {
  assert.deepEqual(opsOf('RX(0.5) 0\nRY(0.25) 1\nRZ(1) 2\nP(0.5) 0'), [
    `RX(${+(HALF).toFixed(6)}) 0`, `RY(${+(Math.PI / 4).toFixed(6)}) 1`, `RZ(${+Math.PI.toFixed(6)}) 2`, `P(${+HALF.toFixed(6)}) 0`,
  ]);
  const u = ev('U(0.5, 0.25, 1) 0').ops[0];
  assert.deepEqual(u.params.map((p) => +p.toFixed(9)), [HALF, Math.PI / 4, Math.PI].map((p) => +p.toFixed(9)));
  assert.deepEqual(u.paramText, ['0.5', '0.25', '1']);
});

test('controlled gates: CX CY CZ CP CSWAP with bracket registers', () => {
  assert.deepEqual(opsOf('CX [0,1]\nCY [1,0]\nCZ [0,2]\nCSWAP [0,1,2]'), ['CX 0>1', 'CY 1>0', 'CZ 0>2', 'CSWAP 0>1,2']);
  const cp = ev('CP(0.25) [0,1]').ops[0];
  assert.deepEqual([cp.controls, cp.targets], [[0], [1]]);
  assert.ok(Math.abs(cp.params[0] - Math.PI / 4) < 1e-12);
});

test('multi-control stays one op: CX [c1,c2,t] has controls [c1,c2]', () => {
  const op = ev('CX [0,1,2]').ops[0];
  assert.deepEqual([op.name, op.controls, op.targets], ['CX', [0, 1], [2]]);
  const sw = ev('CSWAP [0,1,2,3]').ops[0];
  assert.deepEqual([sw.controls, sw.targets], [[0, 1], [2, 3]]);
});

test('SWAP, ISWAP, SQRTSWAP take two wires in brackets or parentheses', () => {
  assert.deepEqual(opsOf('SWAP [0,1]\nISWAP (1,2)\nSQRTSWAP [2,0]'), ['SWAP 0,1', 'ISWAP 1,2', 'SQRTSWAP 2,0']);
  rejects('SWAP (0,1,2)', /SWAP takes two wires: SWAP \[a,b\]/);
  rejects('ISWAP 0', /ISWAP takes two wires/);
});

test('SWAPSEQ reverses a wire list with swaps grouped under SWAPSEQ', () => {
  const c = ev('SWAPSEQ (0..4)');
  assert.deepEqual(c.ops.map((o) => o.targets), [[0, 4], [1, 3]]);
  assert.ok(c.ops.every((o) => o.name === 'SWAP' && o.group.name === 'SWAPSEQ'));
  assert.deepEqual(ev('SWAPSEQ [3,1,0,2]').ops.map((o) => o.targets), [[3, 2], [1, 0]]);
});

test('MEASURE takes a wire, a parenthesized list, visible, or visiblemax', () => {
  const pre = '#settings MaxQubits 5\n#settings VisibleQubits 3\n';
  assert.deepEqual(ev(pre + 'MEASURE 0').ops.map((o) => [o.kind, o.targets[0]]), [['measure', 0]]);
  assert.deepEqual(ev(pre + 'MEASURE (0,1)').ops.map((o) => o.targets[0]), [0, 1]);
  assert.deepEqual(ev(pre + 'MEASURE visible').ops.map((o) => o.targets[0]), [0, 1, 2]);
  assert.deepEqual(ev(pre + 'MEASURE visiblemax').ops.map((o) => o.targets[0]), [2]);
});

test('MEASURE rejects brackets, empty lists, and angles', () => {
  rejects('MEASURE [0,1]', /MEASURE takes parentheses, not brackets: MEASURE \(0,1\)/);
  rejects('MEASURE ()', /MEASURE needs at least one wire/);
  rejects('MEASURE 0 0.5', /MEASURE takes no angle/);
});

test('controlled gates reject parallel lists and single wires', () => {
  rejects('CX (0,1)', /Controlled gates take a bracket register: CX \[c,t\]/);
  rejects('CZ 0', /Controlled gates take a bracket register: CZ \[c,t\]/);
  rejects('q = (0,1)\nCX q', /Controlled gates take a bracket register: CX \[c,t\]/);
  rejects('CX [0]', /CX needs at least 2 wires/);
  rejects('CSWAP [0,1]', /CSWAP needs at least 3 wires/);
});

test('single-qubit gates reject bracket registers', () => {
  rejects('H [0,1]', /H takes wires, not a bracket register; use H \(0,1\)/);
});

test('angle count and presence are checked', () => {
  rejects('U 0', /U takes 3 angles/);
  rejects('U(0.5) 0', /U takes 3 angles/);
  rejects('RX(0.5, 0.2) 0', /RX takes 1 angle/);
  rejects('H(0.5) 0', /H takes no angle/);
  rejects('H 0 0.5', /H takes no angle/);
  rejects('RX(0.5) 0 0.25', /RX has two angle lists/);
});

test('a gate without wires is an error', () => {
  rejects('H', /H needs wires, for example H 0/);
  rejects('CX', /CX needs wires, for example CX \[0,1\]/);
});

test('unknown gate names are errors, never silent no-ops', () => {
  rejects('FOO 0', /Unknown gate or function FOO/);
  rejects('h 0', /Unknown gate h\. Gate names are case-sensitive: H/);
  rejects('QTF(0..2)', /Did you mean QFT\?/);
  rejects('x = 2\nx 0', /x is a variable, not a gate/);
});

test('every native gate name in the IR is accepted by the evaluator', () => {
  const forms = {
    CX: 'CX [0,1]', CY: 'CY [0,1]', CZ: 'CZ [0,1]', CP: 'CP [0,1]', CSWAP: 'CSWAP [0,1,2]',
    SWAP: 'SWAP [0,1]', ISWAP: 'ISWAP [0,1]', SQRTSWAP: 'SQRTSWAP [0,1]', SWAPSEQ: 'SWAPSEQ (0..2)',
    U: 'U(1, 0, 0) 0', MEASURE: 'MEASURE 0',
  };
  for (const name of Object.keys(GATE_INFO)) {
    const src = forms[name] ?? `${name} 0`;
    const c = ev(src);
    assert.ok(c.ops.length > 0, name);
  }
});

test('gate ops carry source positions', () => {
  const c = ev('H 0\n  X 1');
  assert.deepEqual(c.ops[1].pos, { line: 2, col: 3 });
});
