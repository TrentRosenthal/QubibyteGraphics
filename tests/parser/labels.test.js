import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, rejects } from './helpers/qubi.js';
import { parse } from '../../src/qubi/index.js';

test('LABEL wires "text" records a label at the current op index', () => {
  const c = ev('H 0\nLABEL (0,1) "entangle"\nCX [0,1]');
  assert.deepEqual(c.labels, [{ wires: [0, 1], text: 'entangle', rawText: 'entangle', opIndex: 1 }]);
});

test('strings interpolate {n} and ${expr}', () => {
  const c = ev('n = 3\nLABEL 0 "n={n}, next=${n+1}, bits={0b101}, p={0.123456}"');
  assert.equal(c.labels[0].text, 'n=3, next=4, bits=101, p=0.123');
  assert.equal(c.labels[0].rawText, 'n={n}, next=${n+1}, bits={0b101}, p={0.123456}');
});

test('DecimalPlaces controls interpolated floats', () => {
  assert.equal(ev('#settings DecimalPlaces 1\nLABEL 0 "{0.25 * 3}"').labels[0].text, '0.8');
});

test('escaped braces and quotes stay literal', () => {
  assert.equal(ev('LABEL 0 "a \\{n\\} \\"q\\""').labels[0].text, 'a {n} "q"');
});

test('labels inside loops evaluate per iteration', () => {
  const c = ev('i = 0\nLOOP 2 {\n LABEL i "step {i}"\n X i\n i++\n}');
  assert.deepEqual(c.labels.map((l) => [l.wires, l.text, l.opIndex]), [[[0], 'step 0', 0], [[1], 'step 1', 1]]);
});

test('LABEL needs wires and quoted text', () => {
  assert.throws(() => parse('LABEL "x"'), /LABEL needs wires before the text: LABEL 0 "text"/);
  assert.throws(() => parse('LABEL 0'), /LABEL needs quoted text after the wires/);
  assert.throws(() => parse('LABEL 0 "open'), /String is not closed/);
  assert.throws(() => parse('LABEL 0 "{n"'), /Interpolation is missing its closing \}/);
  assert.throws(() => parse('LABEL 0 "{}"'), /Interpolation needs an expression/);
  rejects('LABEL 0 "{undefinedname}"', /Unknown name undefinedname/);
});

test('ANNOTATE ... ENDANNOTATE "id" records a region with its wires', () => {
  const c = ev('X 3\nANNOTATE\nH 0\nCX [0,2]\nENDANNOTATE "prep"\nZ 1');
  assert.deepEqual(c.annotations, [{ id: 'prep', startOp: 1, endOp: 3, wires: [0, 2] }]);
});

test('ANN and ENDANN are short forms; ids interpolate; regions nest', () => {
  const c = ev('k = 2\nANN\nH 0\nANN\nX 1\nENDANN "inner"\nENDANN "outer{k}"');
  assert.deepEqual(c.annotations.map((a) => [a.id, a.startOp, a.endOp]), [['inner', 1, 2], ['outer2', 0, 2]]);
});

test('ANNOTATE must be closed and ENDANNOTATE must be opened', () => {
  assert.throws(() => parse('ANNOTATE\nH 0'), /ANNOTATE is missing its ENDANNOTATE "id"/);
  assert.throws(() => parse('LOOP 1 {\nANN\nH 0\n}'), /ANNOTATE is missing its ENDANNOTATE/);
  assert.throws(() => parse('H 0\nENDANN "x"'), /ENDANN has no matching ANNOTATE/);
  assert.throws(() => parse('ANNOTATE\nH 0\nENDANNOTATE'), /ENDANNOTATE needs an id: ENDANNOTATE "id"/);
  assert.throws(() => parse('ANNOTATE "id"\nH 0\nENDANN "x"'), /the id goes on ENDANNOTATE "id"/);
});
