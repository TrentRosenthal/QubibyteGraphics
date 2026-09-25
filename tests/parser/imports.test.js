import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parse, diagnose } from '../../src/qubi/index.js';

const files = (map) => (path) => {
  if (!(path in map)) throw new Error('no such file');
  return map[path];
};

test('#import and #include inline another file through resolveImport', () => {
  const resolveImport = files({ 'prep.qubi': 'H 0\nX 1', 'more.qubi': 'Z 2' });
  const c = evaluate('#import prep.qubi\n#include more.qubi\nCX [0,1]', { resolveImport });
  assert.deepEqual(c.ops.map((o) => o.name), ['H', 'X', 'Z', 'CX']);
  const ast = parse('#include more.qubi', { resolveImport });
  assert.deepEqual([ast.body[0].type, ast.body[0].keyword, ast.body[0].path], ['Import', 'include', 'more.qubi']);
});

test('imported definitions and settings apply to the importing file', () => {
  const resolveImport = files({
    'lib.qubi': '#settings MaxQubits 4\ngate SQ {\n matrix: [0 1; 1 0]\n}\nfn Pair(a) {\n H a\n CX [a, a+1]\n}',
  });
  const c = evaluate('#import lib.qubi\nPair(1)\nSQ 3', { resolveImport });
  assert.equal(c.numQubits, 4);
  assert.deepEqual(c.ops.map((o) => o.name), ['H', 'CX', 'SQ']);
});

test('nested imports resolve and positions name the file', () => {
  const resolveImport = files({ 'a.qubi': '#import b.qubi', 'b.qubi': 'H 0\nFOO 1' });
  assert.throws(() => evaluate('#import a.qubi', { resolveImport }), (e) => {
    assert.equal(e.file, 'b.qubi');
    assert.equal(e.line, 2);
    assert.match(e.message, /Unknown gate or function FOO at b\.qubi line 2, col 1/);
    return true;
  });
});

test('import cycles are detected', () => {
  const resolveImport = files({ 'a.qubi': '#import b.qubi', 'b.qubi': '#import a.qubi' });
  assert.throws(() => parse('#import a.qubi', { resolveImport }), /Import cycle: a\.qubi -> b\.qubi -> a\.qubi/);
  assert.throws(() => parse('#import self.qubi', { resolveImport: files({ 'self.qubi': '#include self.qubi' }) }), /Import cycle/);
});

test('import nesting of 20 is allowed and 21 is rejected', () => {
  const chain = (n) => {
    const map = {};
    for (let k = 1; k <= n; k++) map[`f${k}.qubi`] = k < n ? `#import f${k + 1}.qubi` : 'X 0';
    return files(map);
  };
  assert.equal(evaluate('#import f1.qubi', { resolveImport: chain(20) }).ops.length, 1);
  assert.throws(() => parse('#import f1.qubi', { resolveImport: chain(21) }), /#import nesting is deeper than 20/);
});

test('a diamond (the same file imported twice, no cycle) is allowed', () => {
  const resolveImport = files({ 'a.qubi': '#import c.qubi', 'b.qubi': '#import c.qubi', 'c.qubi': 'X 0' });
  assert.equal(evaluate('#import a.qubi\n#import b.qubi', { resolveImport }).ops.length, 2);
});

test('missing resolver, unreadable files, and missing paths are errors', () => {
  assert.throws(() => parse('#import x.qubi'), /Cannot read x\.qubi: pass a resolveImport option to parse/);
  assert.throws(() => parse('#import x.qubi', { resolveImport: files({}) }), /Cannot read x\.qubi: no such file/);
  assert.throws(() => parse('#import x.qubi', { resolveImport: () => 42 }), /resolveImport returned no text/);
  assert.throws(() => parse('#import'), /#import needs a file, for example #import lib\.qubi/);
  assert.throws(() => parse('LOOP 1 {\n#include x.qubi\n}'), /#include goes at the top level/);
});

test('diagnose reports errors inside imported files', () => {
  const resolveImport = files({ 'bad.qubi': 'CX (0,1)' });
  const d = diagnose('#import bad.qubi', { resolveImport });
  assert.deepEqual(d, [{ severity: 'error', message: 'Controlled gates take a bracket register: CX [c,t]', line: 1, col: 1, file: 'bad.qubi' }]);
});
