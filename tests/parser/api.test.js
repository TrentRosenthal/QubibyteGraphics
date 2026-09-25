import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as qubi from '../../src/qubi/index.js';

const { parse, evaluate, diagnose, QUBI_KEYWORDS, QubiError } = qubi;

test('the public API exports the documented names', () => {
  assert.deepEqual(Object.keys(qubi).sort(), [
    'QUBI_KEYWORDS', 'QubiError', 'SETTINGS_KEYS', 'STDLIB_NAMES', 'diagnose', 'enumerateSweep', 'evaluate', 'formatAngle',
    'parse', 'schedule', 'toQubiSource',
  ]);
});

test('QUBI_KEYWORDS covers control flow, constants, and directives', () => {
  for (const k of ['if', 'elseif', 'elif', 'else', 'LOOP', 'REPEAT', 'LABEL', 'ANNOTATE', 'ENDANN', 'gate', 'fn', 'pi', 'visiblemax', '#settings', '#include']) {
    assert.ok(QUBI_KEYWORDS.includes(k), k);
  }
  assert.ok(!QUBI_KEYWORDS.includes('endif'));
});

test('parse errors carry line and column', () => {
  assert.throws(() => parse('H 0\nX 1\n  CX (0,1)'), (e) => {
    assert.ok(e instanceof QubiError);
    assert.deepEqual([e.line, e.col, e.reason], [3, 3, 'Controlled gates take a bracket register: CX [c,t]']);
    assert.equal(e.message, 'Controlled gates take a bracket register: CX [c,t] at line 3, col 3');
    return true;
  });
  assert.throws(() => parse('H 0 ]'), (e) => e.line === 1 && e.col === 5);
  assert.throws(() => parse('X @'), /Unexpected character '@' at line 1, col 3/);
});

test('parse returns an AST with positions', () => {
  const ast = parse('H 0\nif 1 > 0 {\n  X 1\n}');
  assert.equal(ast.type, 'Program');
  assert.deepEqual(ast.body.map((s) => [s.type, s.pos]), [['Call', { line: 1, col: 1 }], ['If', { line: 2, col: 1 }]]);
  assert.deepEqual(ast.body[1].branches[0].body[0].pos, { line: 3, col: 3 });
});

test('evaluate accepts a parsed AST and rejects other input', () => {
  const ast = parse('H 0');
  assert.equal(evaluate(ast).ops.length, 1);
  assert.throws(() => evaluate(42), /Expected Qubi source text or a Program/);
});

test('diagnose never throws and reports every syntax error with positions', () => {
  const d = diagnose('H 0\nCX (0,1)\nX 1\nMEASURE [0]\n');
  assert.deepEqual(d, [
    { severity: 'error', message: 'Controlled gates take a bracket register: CX [c,t]', line: 2, col: 1 },
    { severity: 'error', message: 'MEASURE takes parentheses, not brackets: MEASURE (0,1)', line: 4, col: 1 },
  ]);
});

test('diagnose reports evaluation errors and warnings', () => {
  assert.deepEqual(diagnose('count = 1\nFOO 0'), [
    { severity: 'warning', message: 'count is a builtin name; prefer another variable name', line: 1, col: 1 },
    { severity: 'error', message: 'Unknown gate or function FOO', line: 2, col: 1 },
  ]);
  assert.deepEqual(diagnose('H 0\nCX [0,1]'), []);
  assert.deepEqual(diagnose('"open'), [{ severity: 'error', message: 'String is not closed: add "', line: 1, col: 1 }]);
});

test('the circuit has every IR field', () => {
  const c = evaluate('H 0');
  assert.deepEqual(Object.keys(c).sort(), ['annotations', 'diagnostics', 'gateDefs', 'labels', 'loops', 'numQubits', 'ops', 'settings', 'sweeps', 'variables', 'visibleQubits']);
});
