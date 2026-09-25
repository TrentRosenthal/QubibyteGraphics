import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, rejects } from './helpers/qubi.js';

const val = (expr, pre = '') => ev(`${pre}x = ${expr}`).variables.x;

test('0b and 0x literals keep their width', () => {
  assert.equal(val('0b0101'), '0b0101');
  assert.equal(val('len(0b0101)'), 4);
  assert.equal(val('0x1F'), '0b00011111');
  assert.equal(val('(int)0x1F'), 31);
});

test('bitwise & | ^ ~ on bitstrings', () => {
  assert.equal(val('0b1100 & 0b1010'), '0b1000');
  assert.equal(val('0b1100 | 0b1010'), '0b1110');
  assert.equal(val('0b1100 ^ 0b1010'), '0b0110');
  assert.equal(val('~0b1100'), '0b0011');
  assert.equal(val('6 & 3'), 2, 'integers stay integers');
});

test('bitstring lists, ranges, and stepped ranges', () => {
  assert.deepEqual(val('(0b1, 0b0)'), ['0b1', '0b0']);
  assert.deepEqual(val('0b00..0b11'), ['0b00', '0b01', '0b10', '0b11']);
  assert.deepEqual(val('0b00.(0b10).0b11'), ['0b00', '0b10']);
  assert.deepEqual(val('(0b101..0b111)'), ['0b101', '0b110', '0b111']);
});

test('indexing a bitstring reads qubit bits, LSB first', () => {
  const v = ev('b = 0b110\nb0 = b[0]\nb1 = b[1]\nb2 = b[2]\nlow = b[0..1]').variables;
  assert.deepEqual([v.b0, v.b1, v.b2], [0, 1, 1]);
  assert.equal(v.low, '0b10');
});

test('bitstrings compare with integers by value', () => {
  assert.equal(val('0b101 == 5'), true);
  assert.equal(val('0b101 > 4'), true);
});

test('invalid bitstring and hex literals are rejected', () => {
  rejects('x = 0b102', /Bitstring digits are 0 and 1, found '2'/);
  rejects('x = 0x', /Hex literal needs digits/);
  rejects('x = 0xFG', /Invalid hex digit 'G'/);
});

test('classical lists: parenthesized, stepped, len, index, slice', () => {
  const v = ev('p = (0.2, 0.5, 0.8)\nq = (0.2.0.1.0.5)\nn = len(p)\na = p[1]\ns = p[0..1]\nz = p[-1]').variables;
  assert.deepEqual(v.p, [0.2, 0.5, 0.8]);
  assert.deepEqual(v.q, [0.2, 0.3, 0.4, 0.5]);
  assert.equal(v.n, 3);
  assert.equal(v.a, 0.5);
  assert.deepEqual(v.s, [0.2, 0.5]);
  assert.equal(v.z, 0.8);
});

test('lists splice ranges and nest parenthesized lists', () => {
  assert.deepEqual(val('(0..2, 5)'), [0, 1, 2, 5]);
  assert.deepEqual(val('((0, 1), (2, 3))'), [[0, 1], [2, 3]]);
  assert.deepEqual(val('(1, 2) + (3,)'), [1, 2, 3]);
  assert.deepEqual(val('()'), []);
});

test('index out of range is an error', () => {
  rejects('p = (1, 2)\nx = p[2]', /Index 2 is out of range for length 2/);
  rejects('x = 5[0]', /Only lists, strings, and bitstrings can be indexed/);
});

test('an ambiguous dotted chain asks for parentheses', () => {
  rejects('x = 0.5.1.3', /Ambiguous stepped range: wrap the step in parentheses, as in 0\.\(0\.5\)\.3/);
  assert.deepEqual(val('0.(0.5).2'), [0, 0.5, 1, 1.5, 2]);
  rejects('x = q.2', /A stepped range has three parts/, undefined);
});
