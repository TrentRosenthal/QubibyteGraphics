import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, opsOf, rejects } from './helpers/qubi.js';
import { parse } from '../../src/qubi/index.js';
import { makeBackend } from './helpers/refsim.js';

test('LOOP n unrolls and records a LoopInfo', () => {
  const c = ev('X 1\nLOOP 3 { H 0 }\nZ 1');
  assert.deepEqual(c.ops.map((o) => o.name), ['X', 'H', 'H', 'H', 'Z']);
  assert.equal(c.loops.length, 1);
  const l = c.loops[0];
  assert.deepEqual([l.keyword, l.headerText, l.iterations, l.startOp, l.endOp], ['LOOP', 'LOOP 3', 3, 1, 4]);
  assert.deepEqual(l.iterationStarts, [1, 2, 3]);
  assert.deepEqual(c.ops.slice(1, 4).map((o) => [o.loopId, o.iteration]), [[l.id, 0], [l.id, 1], [l.id, 2]]);
});

test('REPEAT is a silent alias of LOOP', () => {
  assert.deepEqual(opsOf('REPEAT 2 { X 0 }'), opsOf('LOOP 2 { X 0 }'));
  assert.equal(ev('REPEAT 2 { X 0 }').loops[0].keyword, 'REPEAT');
});

test('LOOP 0, LOOP max, and LOOP visiblemax', () => {
  assert.equal(ev('LOOP 0 { X 0 }').ops.length, 0);
  assert.equal(ev('#settings MaxQubits 4\nLOOP max { X 0 }').ops.length, 3);
  assert.equal(ev('#settings MaxQubits 4\n#settings VisibleQubits 3\nREPEAT visiblemax { X 0 }').ops.length, 2);
});

test('loop counts must be whole numbers of 0 or more', () => {
  rejects('LOOP -1 { X 0 }', /LOOP count must be a whole number of 0 or more, got -1/);
  rejects('LOOP 1.5 { X 0 }', /LOOP count must be a whole number/);
  rejects('LOOP "a" { X 0 }', /LOOP takes a count or a condition, got string/);
  rejects('LOOP { X 0 }', /LOOP needs a count or condition/);
});

test('while-style LOOP v<3 { v++ }', () => {
  const c = ev('v = 0\nLOOP v<3 {\n X v\n v++\n}');
  assert.deepEqual(c.ops.map((o) => o.targets[0]), [0, 1, 2]);
  assert.equal(c.loops[0].iterations, 3);
  assert.equal(c.variables.v, 3);
  assert.equal(ev('v = 5\nLOOP v<3 { v++ }').loops[0].iterations, 0, 'a false condition runs zero times');
  rejects('v = 0\nLOOP v<3 { X 0 }', /condition is still true after 100000 iterations/);
});

test('nested loops tag ops with the innermost loop', () => {
  const c = ev('LOOP 2 {\n X 0\n LOOP 2 { H 1 }\n}');
  assert.equal(c.ops.length, 6);
  assert.equal(c.loops.length, 3, 'the inner loop is recorded once per outer iteration');
  const [outer, inner] = c.loops;
  assert.deepEqual([c.ops[0].loopId, c.ops[1].loopId], [outer.id, inner.id]);
  assert.deepEqual([outer.startOp, outer.endOp], [0, 6]);
});

test('if / elseif / elif / else if / else', () => {
  const pick = (n) => opsOf(`n = ${n}\nif n == 0 {\n X 0\n} elseif n == 1 {\n X 1\n} elif n == 2 {\n X 2\n} else if n == 3 {\n X 3\n} else {\n X 4\n}`);
  assert.deepEqual([0, 1, 2, 3, 9].map(pick), [['X 0'], ['X 1'], ['X 2'], ['X 3'], ['X 4']]);
});

test('else may start on the next line after }', () => {
  assert.deepEqual(opsOf('if 1 > 2 {\n X 0\n}\nelse {\n X 1\n}'), ['X 1']);
});

test('endif is a parse error with a helpful message', () => {
  assert.throws(() => parse('if 1 > 0 {\n X 0\n}\nendif'), /Qubi has no endif: an if block ends at its closing \}/);
  assert.throws(() => parse('endif'), /Qubi has no endif/);
});

test('else and elseif need a preceding if; elseif needs a condition', () => {
  assert.throws(() => parse('else { X 0 }'), /else needs a preceding if block/);
  assert.throws(() => parse('if 1 > 0 { X 0 } elseif { X 1 }'), /elseif needs a condition/);
  assert.throws(() => parse('if 1 > 0 { X 0 } else { X 1 } elif 1 > 0 { X 2 }'), /elif cannot follow else/);
});

test('an unclosed block is a parse error', () => {
  assert.throws(() => parse('LOOP 2 {\n X 0'), /Block is missing its closing \}/);
  assert.throws(() => parse('X 0\n}'), /Unmatched \}/);
});

test('an if on a measurement result becomes an if op with traced branches', () => {
  const c = ev('H 0\nm = MEASURE 0\nif m == 1 {\n X 1\n} elif m == 0 {\n Z 1\n} else {\n Y 1\n}\nH 1');
  assert.deepEqual(c.ops.map((o) => o.kind), ['gate', 'measure', 'if', 'gate']);
  const ifop = c.ops[2];
  assert.equal(ifop.name, 'if');
  assert.deepEqual(ifop.branches.map((b) => [b.condText, b.ops.map((o) => o.name)]), [['m == 1', ['X']], ['m == 0', ['Z']]]);
  assert.deepEqual(ifop.elseOps.map((o) => o.name), ['Y']);
  assert.deepEqual(ifop.targets, [1]);
  assert.equal(c.ops[1].register, 'm[0]');
  assert.deepEqual(c.variables.m, { unknown: 'm' });
});

test('variables assigned in a traced branch become unknown afterwards', () => {
  const c = ev('m = MEASURE 0\nk = 1\nif m == 1 { k = 2 }\nif k == 2 { X 1 }');
  assert.deepEqual(c.variables.k, { unknown: 'k' });
  assert.equal(c.ops.filter((o) => o.kind === 'if').length, 2);
});

test('ops in a traced branch keep the id of the recorded loop around them', () => {
  const c = ev('m = MEASURE 0\nLOOP 2 {\n if m == 1 {\n  LOOP 2 { X 1 }\n }\n}');
  assert.equal(c.loops.length, 1);
  const inner = c.ops[1].branches[0].ops;
  assert.deepEqual(inner.map((o) => o.loopId), [c.loops[0].id, c.loops[0].id]);
});

test('a known condition after an unknown one ends the traced chain', () => {
  const c = ev('m = MEASURE 0\nif m == 1 { X 1 } elif 1 > 0 { Z 1 } else { Y 1 }');
  const ifop = c.ops[1];
  assert.equal(ifop.branches.length, 1);
  assert.deepEqual(ifop.elseOps.map((o) => o.name), ['Z']);
});

test('error() inside a traced branch is a warning, not a failure', () => {
  const c = ev('m = MEASURE 0\nif m == 1 { error("bad") }');
  assert.ok(c.diagnostics.some((d) => d.severity === 'warning' && /error\("bad"\) is reachable/.test(d.message)));
});

test('loops and wires cannot depend on measurements while tracing', () => {
  rejects('m = MEASURE 0\nLOOP m { X 1 }', /LOOP depends on a measurement result/);
  rejects('m = MEASURE 0\nX m', /Wires cannot depend on a measurement result/);
});

test('execute mode runs the backend and branches on real outcomes', () => {
  for (const [rng, expect] of [[() => 0.99, 'Z'], [() => 0.0, 'X']]) {
    const backend = makeBackend(rng);
    const c = ev('H 0\nm = MEASURE 0\nif m == 1 {\n X 1\n} else {\n Z 1\n}', { mode: 'execute', backend });
    assert.equal(backend.state.n, 2);
    assert.deepEqual(backend.applied.map((o) => o.name), ['H', expect]);
    assert.deepEqual(backend.measured[0].wires, [0]);
    assert.deepEqual(c.ops.map((o) => o.name), ['H', 'MEASURE', expect]);
    assert.equal(c.variables.m, expect === 'X' ? '0b1' : '0b0');
  }
});

test('execute mode: the lowest listed wire is the LSB of a measured register', () => {
  const backend = makeBackend(() => 0.5);
  const c = ev('X 2\nm = MEASURE (2,0)\nif m == 0b10 { H 1 }', { mode: 'execute', backend });
  assert.equal(c.variables.m, '0b10');
  assert.equal(c.ops.at(-1).name, 'H');
  assert.deepEqual(c.ops.filter((o) => o.kind === 'measure').map((o) => [o.targets[0], o.register]), [[2, 'm[1]'], [0, 'm[0]']]);
});

test('execute mode needs a backend', () => {
  rejects('H 0', /Execute mode needs a backend/, { mode: 'execute' });
});
