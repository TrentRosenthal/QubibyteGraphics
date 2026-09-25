import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, opsOf, rejects, targetsOf } from './helpers/qubi.js';
import { parse } from '../../src/qubi/index.js';
import { simulate, probOf } from './helpers/refsim.js';
import { makeBackend } from './helpers/refsim.js';

test('trap: LSB is q0 (rightmost bit of kets and 0b literals)', () => {
  assert.equal(probOf(simulate(ev('#settings MaxQubits 3\nX 0')), '001'), 1);
  assert.deepEqual(opsOf('StatePreparation(0b001)'), ['X 0']);
  assert.equal(ev('b = 0b001\nx = b[0]').variables.x, 1);
  const c = ev('X 0\nm = MEASURE (0,1)', { mode: 'execute', backend: makeBackend(() => 0.5) });
  assert.equal(c.variables.m, '0b01');
});

test('trap: CX [c,t] is right, CX (c,t) is rejected', () => {
  assert.deepEqual(opsOf('c = 0\nt = 1\nCX [c,t]'), ['CX 0>1']);
  assert.throws(() => parse('CX (c,t)'), /Controlled gates take a bracket register: CX \[c,t\]/);
  assert.throws(() => parse('CX (0,1)'), /Controlled gates take a bracket register/);
});

test('trap: MEASURE takes parentheses, never brackets', () => {
  assert.doesNotThrow(() => parse('MEASURE ()'));
  assert.equal(ev('MEASURE (0,1)').ops.length, 2);
  assert.throws(() => parse('MEASURE []'), /MEASURE takes parentheses, not brackets: MEASURE \(0,1\)/);
  assert.throws(() => parse('m = MEASURE [0,1]'), /MEASURE takes parentheses, not brackets/);
});

test('trap: A.S.E (stepped) is not A..B', () => {
  const pre = '#settings MaxQubits 5\n';
  assert.deepEqual(targetsOf(pre + 'H 0.2.4'), [0, 2, 4]);
  assert.deepEqual(targetsOf(pre + 'H 0..4'), [0, 1, 2, 3, 4]);
  assert.deepEqual(targetsOf(pre + 'H 1.3.4'), [1, 4]);
});

test('trap: visible, visiblemax, all, and max are four different things', () => {
  const pre = '#settings MaxQubits 6\n#settings VisibleQubits 4\n';
  const all = targetsOf(pre + 'H all');
  const visible = targetsOf(pre + 'H visible');
  const max = targetsOf(pre + 'H max');
  const visiblemax = targetsOf(pre + 'H visiblemax');
  assert.deepEqual(all, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(visible, [0, 1, 2, 3]);
  assert.deepEqual(max, [5]);
  assert.deepEqual(visiblemax, [3]);
  const distinct = new Set([all, visible, max, visiblemax].map((w) => w.join(',')));
  assert.equal(distinct.size, 4);
});

test('trap: typeof is not listtype', () => {
  const v = ev('x = (1, 2, 3)\na = typeof(x)\nb = listtype(x)').variables;
  assert.equal(v.a, 'list');
  assert.equal(v.b, 'list-int');
});

test('trap: len is not count on lists', () => {
  const v = ev('x = (0, 1, 0, 1, 1)\na = len(x)\nb = count(x)\nc = count(x, 0)').variables;
  assert.equal(v.a, 5);
  assert.equal(v.b, 3);
  assert.equal(v.c, 2);
});

test('trap: REPEAT equals LOOP', () => {
  const a = ev('LOOP 3 { H 0 }');
  const b = ev('REPEAT 3 { H 0 }');
  assert.deepEqual(b.ops.map((o) => o.name), a.ops.map((o) => o.name));
  assert.equal(b.loops[0].iterations, a.loops[0].iterations);
});

test('trap: elseif and elif are accepted, endif is rejected', () => {
  assert.deepEqual(opsOf('x = 1\nif x == 0 { X 0 } elseif x == 1 { X 1 } else { X 2 }'), ['X 1']);
  assert.deepEqual(opsOf('x = 2\nif x == 0 { X 0 } elif x == 2 { X 2 }'), ['X 2']);
  assert.throws(() => parse('x = 1\nif x == 1 {\n X 0\n}\nendif'), /Qubi has no endif/);
});

test('trap: PhaseKickback only takes "CX" or "CZ"', () => {
  assert.doesNotThrow(() => ev('PhaseKickback("CX")'));
  assert.doesNotThrow(() => ev('PhaseKickback("CZ")'));
  rejects('PhaseKickback("CY")', /PhaseKickback takes "CX" or "CZ"/);
});

test('trap: bare angles use CodeAngleUnit, default piradians', () => {
  assert.ok(Math.abs(ev('RX 0 1').ops[0].params[0] - Math.PI) < 1e-12);
  assert.ok(Math.abs(ev('#settings CodeAngleUnit radians\nRX 0 1').ops[0].params[0] - 1) < 1e-12);
});

test('trap: matrices use e**, not exp()', () => {
  assert.doesNotThrow(() => ev('gate G {\n matrix: [1 0; 0 e**(1i*pi/4)]\n}\nG 0'));
  rejects('gate G {\n matrix: [1 0; 0 exp(1i*pi/4)]\n}\nG 0', /use e\*\* for exponentials/);
});

test('trap: count and listtype are not reserved but draw a warning', () => {
  const c = ev('count = 1\nlisttype = 2\nX count');
  assert.equal(c.ops[0].targets[0], 1);
  assert.equal(c.diagnostics.filter((d) => d.severity === 'warning').length, 2);
});
