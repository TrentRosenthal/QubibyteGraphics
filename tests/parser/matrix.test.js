import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMatrix, isUnitary } from '../../src/qubi/matrix.js';

const entries = (m) => Array.from(m.re, (re, k) => [Number(re.toFixed(12)), Number(m.im[k].toFixed(12))]);
const S = Number(Math.SQRT1_2.toFixed(12));

test('real matrices with ; rows and space-separated entries', () => {
  const m = parseMatrix('[1 0; 0 1]');
  assert.deepEqual([m.rows, m.cols], [2, 2]);
  assert.deepEqual(entries(m), [[1, 0], [0, 0], [0, 0], [1, 0]]);
});

test('1i is the imaginary unit, e** is the complex exponential', () => {
  assert.deepEqual(entries(parseMatrix('[0 -1i; 1i 0]')), [[0, 0], [0, -1], [0, 1], [0, 0]]);
  assert.deepEqual(entries(parseMatrix('[1 0; 0 e**(1i*pi/4)]'))[3], [S, S]);
  assert.deepEqual(entries(parseMatrix('[1 0; 0 e**(1i*π)]'))[3], [-1, 0]);
});

test('arithmetic, sqrt, unary minus, and powers', () => {
  assert.deepEqual(entries(parseMatrix('[1/sqrt(2) 1/sqrt(2); 1/sqrt(2) -1/sqrt(2)]')), [[S, 0], [S, 0], [S, 0], [-S, 0]]);
  assert.deepEqual(entries(parseMatrix('[(1+1i)/2 (1-1i)/2; (1-1i)/2 (1+1i)/2]'))[0], [0.5, 0.5]);
  assert.deepEqual(entries(parseMatrix('[sqrt(-1) 0; 0 2**2 - 3]'))[0], [0, 1]);
  assert.deepEqual(entries(parseMatrix('[cos(pi) sin(pi/2); 0 1]')).slice(0, 2), [[-1, 0], [1, 0]]);
});

test('a sign with a space before and none after starts a new entry', () => {
  assert.deepEqual(entries(parseMatrix('[1 -1; 1 1]')), [[1, 0], [-1, 0], [1, 0], [1, 0]]);
  assert.throws(() => parseMatrix('[1 - 1; 1 1]'), /rows have different lengths/);
});

test('commas separate entries and new lines separate rows', () => {
  assert.deepEqual(entries(parseMatrix('[0, 1\n 1, 0]')), [[0, 0], [1, 0], [1, 0], [0, 0]]);
});

test('4x4 matrices', () => {
  const m = parseMatrix('[1 0 0 0; 0 0 1 0; 0 1 0 0; 0 0 0 1]');
  assert.equal(m.rows, 4);
  assert.ok(isUnitary(m));
});

test('syntax and shape errors', () => {
  assert.throws(() => parseMatrix('[1 0; 0 exp(1i)]'), /use e\*\* for exponentials/);
  assert.throws(() => parseMatrix('[1 0; 0 e^2]'), /use \*\* for powers/);
  assert.throws(() => parseMatrix('[1 0; 0 i]'), /write the imaginary unit as 1i/);
  assert.throws(() => parseMatrix('[1 0]'), /must be square, got 1x2/);
  assert.throws(() => parseMatrix('[1 0 0; 0 1 0; 0 0 1]'), /size must be a power of two/);
  assert.throws(() => parseMatrix('[1 0; 0]'), /rows have different lengths/);
  assert.throws(() => parseMatrix('[1 0; 0 foo]'), /unknown name foo/);
  assert.throws(() => parseMatrix('[1 0; 0 1'), /missing \]/);
  assert.throws(() => parseMatrix('[]'), /the matrix is empty/);
  assert.throws(() => parseMatrix('[1 0; 0 1/0]'), /division by zero/);
  assert.throws(() => parseMatrix('[1 0; 0 1] 2'), /unexpected text after \]/);
  assert.throws(() => parseMatrix('1 0; 0 1'), /write the matrix in brackets/);
  assert.throws(() => parseMatrix('[1 0; 0 1.2.3]'), /cannot read number 1\.2\.3/);
});

test('errors carry the position of the offending token', () => {
  assert.throws(() => parseMatrix('[1 0; 0 exp(1)]', { line: 4, col: 10 }), (e) => e.line === 4 && e.col === 18);
});

test('isUnitary detects unitary and non-unitary matrices', () => {
  assert.equal(isUnitary(parseMatrix('[0 1; 1 0]')), true);
  assert.equal(isUnitary(parseMatrix('[1 0; 0 e**(1i*0.3)]')), true);
  assert.equal(isUnitary(parseMatrix('[1 1; 0 1]')), false);
  assert.equal(isUnitary(parseMatrix('[2 0; 0 2]')), false);
});
