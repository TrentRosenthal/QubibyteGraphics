import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, opsOf, rejects } from './helpers/qubi.js';
import { enumerateSweep, diagnose } from '../../src/qubi/index.js';

test('name=expr assigns and ++ / -- step a number', () => {
  const v = ev('a = 2\nb = a * 3\na++\nb--\nb--').variables;
  assert.deepEqual([v.a, v.b], [3, 4]);
  rejects('z++', /z is not defined; assign it before \+\+/);
  rejects('s = "a"\ns++', /\+\+ needs numbers, got string/);
});

test('constants, keywords, and native gate names cannot be assigned', () => {
  rejects('pi = 3', /Cannot assign to pi: it is a reserved word/);
  rejects('max = 3', /Cannot assign to max/);
  rejects('visible = 1', /Cannot assign to visible/);
  rejects('LOOP = 1', /Cannot assign to LOOP/);
  rejects('H = 1', /Cannot assign to H: it is a native gate/);
});

test('count and listtype work as variable names with a warning', () => {
  const c = ev('count = 2\nlisttype = 3\nX count\nY listtype');
  assert.deepEqual(c.ops.map((o) => o.targets[0]), [2, 3]);
  assert.equal(c.variables.count, 2);
  const warnings = c.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message);
  assert.deepEqual(warnings, ['count is a builtin name; prefer another variable name', 'listtype is a builtin name; prefer another variable name']);
  assert.equal(ev('count = (1, 0, 1)\nn = count(count)').variables.n, 2, 'the builtin still works when shadowed');
  assert.equal(diagnose('count = 1').filter((d) => d.severity === 'warning').length, 1);
});

test('name=<0..5> is a value sweep axis; evaluate uses its first value', () => {
  const c = ev('n=<0..5>\nRX 0 n');
  assert.deepEqual(c.sweeps, [{ key: 'n', name: 'n', kind: 'value', values: [0, 1, 2, 3, 4, 5] }]);
  assert.equal(c.ops[0].params[0], 0);
  const at3 = ev('n=<0..5>\nRX 0 n', { sweepPoint: { n: 3 } });
  assert.ok(Math.abs(at3.ops[0].params[0] - 3 * Math.PI) < 1e-12);
});

test('g=<H,X,Y> is a gate sweep; the variable is used as a gate', () => {
  const points = [...enumerateSweep('g=<H,X,Y>\ng 0')];
  assert.deepEqual(points.map((p) => p.assignment), [{ g: 'H' }, { g: 'X' }, { g: 'Y' }]);
  assert.deepEqual(points.map((p) => p.circuit.ops[0].name), ['H', 'X', 'Y']);
  assert.equal(points[0].circuit.sweeps[0].kind, 'gate');
});

test('a=<0.(0.5).3> sweeps a stepped range', () => {
  const c = ev('a=<0.(0.5).3>\nRY 0 a');
  assert.deepEqual(c.sweeps[0].values, [0, 0.5, 1, 1.5, 2, 2.5, 3]);
});

test('inline <H,X> 0 sweeps the gate of one statement', () => {
  const points = [...enumerateSweep('<H,X> 0')];
  assert.equal(points.length, 2);
  assert.deepEqual(points.map((p) => p.circuit.ops[0].name), ['H', 'X']);
  const axis = points[0].circuit.sweeps[0];
  assert.equal(axis.name, '<inline>');
  assert.equal(axis.key, '<inline>@1:1');
  rejects('<0,1> 0', /A sweep in gate position lists gates/);
});

test('LOOP <0..4> sweeps the iteration count of the loop body', () => {
  const points = [...enumerateSweep('LOOP <0..4> { H 0 }')];
  assert.deepEqual(points.map((p) => p.circuit.ops.length), [0, 1, 2, 3, 4]);
  assert.deepEqual(points.map((p) => p.circuit.loops[0].iterations), [0, 1, 2, 3, 4]);
  assert.equal(points[0].circuit.sweeps[0].name, '<loop>');
  assert.equal(points[2].circuit.loops[0].headerText, 'LOOP <0..4>');
});

test('enumerateSweep walks the cartesian product of all axes', () => {
  const points = [...enumerateSweep('a=<0,1>\ng=<H,X>\nRX 0 a\ng 1')];
  assert.equal(points.length, 4);
  assert.deepEqual(points.map((p) => p.assignment), [
    { a: 0, g: 'H' }, { a: 0, g: 'X' }, { a: 1, g: 'H' }, { a: 1, g: 'X' },
  ]);
  assert.deepEqual(points[3].indices, { a: 1, g: 1 });
  assert.deepEqual(points.map((p) => p.circuit.ops[1].name), ['H', 'X', 'H', 'X']);
});

test('a program without sweeps enumerates one point', () => {
  const points = [...enumerateSweep('H 0')];
  assert.equal(points.length, 1);
  assert.deepEqual(points[0].assignment, {});
});

test('sweepstate is a conventional bitstring sweep name', () => {
  const points = [...enumerateSweep('sweepstate=<0b00..0b11>\nX tolist(sweepstate)[0]')];
  assert.deepEqual(points.map((p) => p.assignment.sweepstate), ['0b00', '0b01', '0b10', '0b11']);
  assert.ok(points.every((p) => p.circuit.ops[0].targets[0] === (p.assignment.sweepstate.endsWith('1') ? 1 : 0)));
});

test('a sweep that only runs in one branch is enumerated there only', () => {
  const points = [...enumerateSweep('a=<0,1>\nif a == 1 {\n b=<2,3>\n X b\n}')];
  assert.deepEqual(points.map((p) => p.assignment), [{ a: 0 }, { a: 1, b: 2 }, { a: 1, b: 3 }]);
});

test('sweep points beyond maxPoints are an error', () => {
  assert.throws(() => [...enumerateSweep('a=<0..9>\nb=<0..9>\nX 0', { maxPoints: 50 })], /more than 50 points/);
});

test('a sweep mixing gates and numbers is rejected', () => {
  rejects('g=<H,1>\nX 0', /A sweep lists values or gates, not both/);
  rejects('g=<>\nX 0', /Sweep needs values/);
});

test('variables inside functions are local; globals stay readable', () => {
  const c = ev('w = 2\nfn F() {\n w = 5\n X w\n}\nF\nY w');
  assert.deepEqual(opsOf('w = 2\nfn F() {\n w = 5\n X w\n}\nF\nY w'), ['X 5', 'Y 2']);
  assert.equal(c.variables.w, 2);
});
