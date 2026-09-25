import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev } from './helpers/qubi.js';
import { schedule } from '../../src/qubi/index.js';

const cols = (src, mode) => schedule(ev(src), { mode }).columns;

test('never: one op per column', () => {
  assert.deepEqual(cols('H 0\nH 1\nX 2', 'never'), [[0], [1], [2]]);
});

test('same_line: consecutive ops on disjoint spans share the current column only', () => {
  assert.deepEqual(cols('H 0\nH 2\nX 0\nX 1', 'same_line'), [[0, 1], [2, 3]]);
  assert.deepEqual(cols('H 0\nX 1\nCX [0,2]\nH 1', 'same_line'), [[0, 1], [2], [3]]);
  assert.deepEqual(cols('X 0\nY 1\nZ 0\nH 3', 'same_line'), [[0, 1], [2, 3]], 'H 3 does not move back into the closed column');
});

test('same_gate_continuous: a column holds consecutive ops of one gate name', () => {
  assert.deepEqual(cols('H 0\nH 1\nX 2\nX 3', 'same_gate_continuous'), [[0, 1], [2, 3]]);
  assert.deepEqual(cols('H 0\nH 1\nX 2\nX 3', 'same_line'), [[0, 1, 2, 3]]);
});

test('same_gate (and sameType) lets non-consecutive ops of one name share a column', () => {
  assert.deepEqual(cols('H 0\nX 1\nH 2', 'same_gate'), [[0, 2], [1]]);
  assert.deepEqual(cols('H 0\nX 1\nH 2', 'sameType'), [[0, 2], [1]]);
  assert.deepEqual(cols('H 0\nX 1\nH 1', 'same_gate'), [[0], [1], [2]], 'H 1 must stay after X 1');
  assert.equal(schedule(ev('H 0'), { mode: 'sameType' }).mode, 'same_gate');
});

test('always: as-soon-as-possible packing on disjoint spans', () => {
  assert.deepEqual(cols('H 0\nX 1\nCX [0,2]\nH 3\nZ 1', 'always'), [[0, 1, 3], [2], [4]]);
});

test('a controlled gate occupies the full span between its lowest and highest wire', () => {
  assert.deepEqual(cols('CX [0,2]\nX 1', 'always'), [[0], [1]]);
  assert.deepEqual(cols('CX [0,2]\nX 3', 'always'), [[0, 1]]);
});

test('loop brackets: iterations stay in their own columns except in compressed mode', () => {
  const src = 'i = 0\nLOOP 3 {\n H i\n i++\n}';
  const always = schedule(ev(src), { mode: 'always' });
  assert.deepEqual(always.columns, [[0], [1], [2]]);
  assert.deepEqual(always.loops.map((l) => [l.startCol, l.endCol, l.iterationCols]), [[0, 3, [0, 1, 2]]]);
  const compressed = schedule(ev(src), { mode: 'compressed' });
  assert.deepEqual(compressed.columns, [[0, 1, 2]]);
  assert.deepEqual(compressed.loops.map((l) => [l.startCol, l.endCol, l.iterationCols]), [[0, 1, [0, 0, 0]]]);
});

test('compressed keeps iteration boundaries when wire sets overlap', () => {
  assert.deepEqual(cols('LOOP 2 { H 0 }', 'compressed'), [[0], [1]]);
  assert.deepEqual(cols('i = 0\nLOOP 4 {\n X i % 2\n i++\n}', 'compressed'), [[0, 1], [2, 3]]);
});

test('ops never cross loop starts and ends', () => {
  const s = schedule(ev('H 0\nLOOP 1 { X 1 }\nZ 2'), { mode: 'always' });
  assert.deepEqual(s.columns, [[0], [1], [2]]);
  assert.deepEqual([s.loops[0].startCol, s.loops[0].endCol], [1, 2]);
});

test('an empty loop has an empty column span', () => {
  const s = schedule(ev('H 0\nLOOP 0 { X 1 }\nZ 0'), { mode: 'always' });
  assert.deepEqual([s.loops[0].startCol, s.loops[0].endCol], [1, 1]);
});

test('annotation spans are boundaries and come back in column coordinates', () => {
  const s = schedule(ev('H 0\nANN\nX 1\nENDANN "a"\nZ 2'), { mode: 'always' });
  assert.deepEqual(s.columns, [[0], [1], [2]]);
  assert.deepEqual(s.annotations, [{ id: 'a', startCol: 1, endCol: 2, wires: [1] }]);
});

test('group spans cover stdlib calls; labels map to columns', () => {
  const s = schedule(ev('Bell(0,1)\nX 3\nLABEL 2 "here"\nZ 2'), { mode: 'always' });
  assert.deepEqual(s.columns, [[0, 2, 3], [1]]);
  assert.deepEqual(s.groups.map((g) => [g.name, g.startCol, g.endCol, g.wires, g.blackbox]), [['Bell', 0, 2, [0, 1], false]]);
  assert.deepEqual(s.labelColumns, [0]);
  assert.deepEqual(s.opColumn, [0, 1, 0, 0]);
});

test('if ops span every wire of their branches', () => {
  const s = schedule(ev('m = MEASURE 0\nif m == 1 { CX [1,3] }\nH 2'), { mode: 'always' });
  assert.deepEqual(s.columns, [[0, 1], [2]]);
});

test('the mode defaults to the Scheduling setting, and unknown modes throw', () => {
  const c = ev('#settings Scheduling never\nH 0\nH 1');
  assert.deepEqual(schedule(c).columns, [[0], [1]]);
  assert.equal(schedule(ev('H 0')).mode, 'same_line');
  assert.throws(() => schedule(c, { mode: 'sideways' }), /Unknown scheduling mode sideways/);
});
