import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, opsOf, rejects, targetsOf } from './helpers/qubi.js';

const M6V4 = '#settings MaxQubits 6\n#settings VisibleQubits 4\n';

test('single wire N and an expression wire', () => {
  assert.deepEqual(opsOf('H 3'), ['H 3']);
  assert.deepEqual(opsOf('q = 1\nX q+1'), ['X 2']);
});

test('all, visible, max, visiblemax resolve against the settings', () => {
  assert.deepEqual(targetsOf(M6V4 + 'H all'), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(targetsOf(M6V4 + 'H visible'), [0, 1, 2, 3]);
  assert.deepEqual(targetsOf(M6V4 + 'H max'), [5]);
  assert.deepEqual(targetsOf(M6V4 + 'H visiblemax'), [3]);
});

test('A..B ranges are inclusive and may descend', () => {
  assert.deepEqual(targetsOf('X (0..2)'), [0, 1, 2]);
  assert.deepEqual(targetsOf('X 1..3'), [1, 2, 3]);
  assert.deepEqual(targetsOf('X 3..1'), [3, 2, 1]);
});

test('A..max and A..visiblemax', () => {
  assert.deepEqual(targetsOf(M6V4 + 'H 2..max'), [2, 3, 4, 5]);
  assert.deepEqual(targetsOf(M6V4 + 'H 1..visiblemax'), [1, 2, 3]);
});

test('stepped A.S.E with literal, negative, and variable steps', () => {
  assert.deepEqual(targetsOf('#settings MaxQubits 8\nH 1.3.7'), [1, 4, 7]);
  assert.deepEqual(targetsOf('#settings MaxQubits 8\nH 6.-2.0'), [6, 4, 2, 0]);
  assert.deepEqual(targetsOf('#settings MaxQubits 8\ns = 3\nH 0.s.7'), [0, 3, 6]);
  assert.deepEqual(targetsOf('#settings MaxQubits 8\ns = -3\nH 7.s.0'), [7, 4, 1]);
});

test('A.S.max and A.S.visiblemax give even and odd wires', () => {
  assert.deepEqual(targetsOf(M6V4 + 'H (0.2.max)'), [0, 2, 4]);
  assert.deepEqual(targetsOf(M6V4 + 'H 1.2.max'), [1, 3, 5]);
  assert.deepEqual(targetsOf(M6V4 + 'H 0.2.visiblemax'), [0, 2]);
  assert.deepEqual(targetsOf(M6V4 + 'H 1.2.visiblemax'), [1, 3]);
});

test('parallel lists hold wires, ranges, and expressions', () => {
  assert.deepEqual(targetsOf(M6V4 + 'H (0, visiblemax, sqrt(4))'), [0, 3, 2]);
  assert.deepEqual(targetsOf('X (0..1, 4, 2+3)'), [0, 1, 4, 5]);
  assert.deepEqual(targetsOf('X (1,2,4)'), [1, 2, 4]);
});

test('bracket joint registers feed controlled gates', () => {
  assert.deepEqual(opsOf('CX [0,1]'), ['CX 0>1']);
  assert.deepEqual(opsOf('CX [0..1, 3]'), ['CX 0,1>3']);
  assert.deepEqual(opsOf('r = [2,0]\nCZ r'), ['CZ 2>0']);
});

test('wires out of range, repeated, fractional, or bitstrings are rejected', () => {
  rejects('#settings MaxQubits 3\nX 3', /Wire 3 is out of range: MaxQubits is 3/);
  rejects('H (0,0)', /lists wire 0 twice/);
  rejects('CX [1,1]', /CX lists wire 1 twice/);
  rejects('H 1.5', /Wires are whole numbers of 0 or more, got 1\.5/);
  rejects('H -1', /Wires are whole numbers of 0 or more, got -1/);
  rejects('H 0b101', /got bitstring 0b101/);
  rejects('H "a"', /got string/);
});

test('a stepped range with step 0 is rejected', () => {
  rejects('H 0.0.3', /step of a stepped range cannot be 0/);
});

test('without MaxQubits the count is the highest wire + 1', () => {
  assert.equal(ev('X 10').numQubits, 11);
  assert.equal(ev('H 0\nCX [0,2]').numQubits, 3);
});

test('without MaxQubits, max and all use a default of 8 qubits', () => {
  const c = ev('H all');
  assert.equal(c.numQubits, 8);
  assert.equal(c.ops.length, 8);
  assert.deepEqual(targetsOf('X max'), [7]);
});

test('an explicit wire beyond the default grows all and max', () => {
  const c = ev('X 10\nH all\nZ max');
  assert.equal(c.numQubits, 11);
  assert.equal(c.ops.filter((o) => o.name === 'H').length, 11);
  assert.deepEqual(c.ops.at(-1).targets, [10]);
});
