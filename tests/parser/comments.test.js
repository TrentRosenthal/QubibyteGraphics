import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opsOf, ev } from './helpers/qubi.js';
import { parse } from '../../src/qubi/index.js';

test('// line comments', () => {
  assert.deepEqual(opsOf('// setup\nH 0 // put 0 in superposition\nX 1'), ['H 0', 'X 1']);
});

test('/* */ block comments, inline and across lines', () => {
  assert.deepEqual(opsOf('H /* wire */ 0\n/* a\nlonger\nnote */\nX 1'), ['H 0', 'X 1']);
  assert.deepEqual(opsOf('H 0 /* two\nlines */ X 1'), ['H 0', 'X 1'], 'a multi-line comment ends the statement');
  assert.throws(() => parse('H 0 /* open'), /Block comment is not closed: add \*\//);
});

test('// inside () or [] on the same line is not a comment', () => {
  assert.equal(ev('x = (9 // 2)').variables.x, 4);
  assert.deepEqual(opsOf('CX [0, 4 // 2]'), ['CX 0>2']);
  assert.throws(() => parse('X (0, // not a comment\n 1)'), /Expected a value/);
});

test('// after the brackets close, or on a later line of a bracket, is a comment', () => {
  assert.deepEqual(opsOf('X (1) // comment (with parens)'), ['X 1']);
  assert.deepEqual(opsOf('X (0,\n 1, // second\n 2)'), ['X 0', 'X 1', 'X 2']);
});

test('# inside an open parenthesis is not a directive', () => {
  assert.throws(() => parse('X (0,\n#settings MaxQubits 2\n1)'), /Directives such as #settings start a line/);
});

test('comment-only and blank sources are empty programs', () => {
  assert.deepEqual(parse('// nothing\n\n/* here */\n').body, []);
  assert.equal(ev('').ops.length, 0);
});
