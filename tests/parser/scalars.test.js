import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, rejects } from './helpers/qubi.js';

const val = (expr, pre = '') => ev(`${pre}x = ${expr}`).variables.x;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `expected ${b}, got ${a}`);

test('arithmetic operators and precedence', () => {
  assert.equal(val('2 + 3 * 4'), 14);
  assert.equal(val('(2 + 3) * 4'), 20);
  assert.equal(val('7 - 2 - 1'), 4);
  assert.equal(val('7 / 2'), 3.5);
  assert.equal(val('7 % 3'), 1);
  assert.equal(val('2 ** 3 ** 2'), 512);
  assert.equal(val('-2 ** 2'), -4);
  assert.equal(val('2 ** -1'), 0.5);
});

test('ternary ?: picks a branch', () => {
  assert.equal(val('3 > 2 ? 10 : 20'), 10);
  assert.equal(val('3 < 2 ? 10 : 1 > 0 ? 30 : 40'), 30);
});

test('constants pi, π, e, max, visiblemax', () => {
  close(val('pi'), Math.PI);
  close(val('π'), Math.PI);
  close(val('e'), Math.E);
  const v = ev('#settings MaxQubits 6\n#settings VisibleQubits 4\na = max\nb = visiblemax').variables;
  assert.deepEqual([v.a, v.b], [5, 3]);
});

test('sqrt, round, roundup, rounddown', () => {
  assert.equal(val('sqrt(16)'), 4);
  assert.equal(val('round(2.5)'), 3);
  assert.equal(val('round(-2.5)'), -3);
  assert.equal(val('round(2.4)'), 2);
  assert.equal(val('roundup(2.1)'), 3);
  assert.equal(val('rounddown(2.9)'), 2);
  rejects('x = sqrt(-1)', /sqrt of a negative number/);
});

test('asin, acos, atan return radians', () => {
  close(val('asin(1)'), Math.PI / 2);
  close(val('acos(1)'), 0);
  close(val('atan(1)'), Math.PI / 4);
  rejects('x = asin(2)', /asin takes a number from -1 to 1/);
});

test('len and length count elements, characters, or bits', () => {
  assert.equal(val('len((4,5,6))'), 3);
  assert.equal(val('length("abc")'), 3);
  assert.equal(val('len(0b0101)'), 4);
  assert.equal(val('len([0,2])'), 2);
  rejects('x = len(5)', /len takes a list, string, or bitstring, got int/);
});

test('count: set bits, nonzero list entries, or occurrences of a value', () => {
  assert.equal(val('count(0b1011)'), 3);
  assert.equal(val('count((0, 2, 0, 5))'), 2);
  assert.equal(val('count((1, 2, 1, 1), 1)'), 3);
  assert.equal(val('count("banana", "an")'), 2);
  assert.equal(val('count(0b1011, 0)'), 1);
});

test('tolist converts bitstrings (LSB first), strings, and numbers', () => {
  assert.deepEqual(val('tolist(0b110)'), [0, 1, 1]);
  assert.deepEqual(val('tolist("ab")'), ['a', 'b']);
  assert.deepEqual(val('tolist(4)'), [4]);
  assert.deepEqual(val('tolist([1,3])'), [1, 3]);
});

test('typeof names the value type', () => {
  const cases = {
    '3': 'int', '2.5': 'float', '"s"': 'string', '0b1': 'bitstring', '(1,2)': 'list', '1 > 0': 'boolean', 'H': 'gate',
  };
  for (const [expr, type] of Object.entries(cases)) assert.equal(val(`typeof(${expr})`), type, expr);
});

test('listtype names the element type of a list', () => {
  assert.equal(val('listtype((1,2))'), 'list-int');
  assert.equal(val('listtype((1,2.5))'), 'list-float');
  assert.equal(val('listtype(((1,2),(3,4)))'), 'list-list-int');
  assert.equal(val('listtype((0b1, 0b0))'), 'list-bitstring');
  assert.equal(val('listtype(("a", 1))'), 'list');
  assert.equal(val('listtype(())'), 'list');
  assert.equal(val('listtype(3)'), 'int');
});

test('error("msg") stops evaluation with the message', () => {
  rejects('H 0\nerror("bad input")', /^bad input at line 2, col 1$/);
  rejects('n = 3\nerror("n is {n}")', /^n is 3/);
});

test('casts to every listed type', () => {
  assert.equal(val('(int)3.7'), 3);
  assert.equal(val('(int)-3.7'), -3);
  assert.equal(val('(int)"42"'), 42);
  assert.equal(val('(int)0b101'), 5);
  assert.equal(val('(float)3'), 3);
  assert.equal(val('(number)"2.5"'), 2.5);
  assert.equal(val('(string)5'), '5');
  assert.equal(val('(string)0b01'), '01');
  assert.equal(val('(bitstring)5'), '0b101');
  assert.equal(val('(bitstring)"0110"'), '0b0110');
  assert.deepEqual(val('(list)0b01'), [1, 0]);
  assert.deepEqual(val('(list-int)(1.7, 2.2)'), [1, 2]);
  assert.deepEqual(val('(list-list-int)((1.5, 2), (3, 4.9))'), [[1, 2], [3, 4]]);
  assert.equal(val('(boolean)0'), false);
  assert.equal(val('(boolean)"x"'), true);
  assert.equal(val('(qubit)3'), 3);
  assert.equal(val('(wire)2.9'), 2);
  assert.deepEqual(val('(wirelist)(1, 2)'), [1, 2]);
  assert.deepEqual(val('(wires)[0, 1]'), [0, 1]);
  rejects('x = (int)"abc"', /Cannot cast string to int/);
  rejects('x = (wire)-1', /A wire is a whole number of 0 or more/);
});

test('a parenthesized type name that is not followed by a value is a plain group', () => {
  assert.equal(val('(int) + 1', 'int = 4\n'), 5);
});

test('comparisons and logic words', () => {
  assert.equal(val('3 >= 3 && 2 != 3'), true);
  assert.equal(val('1 < 0 or 2 <= 2'), true);
  assert.equal(val('1 == 1 and not (2 > 3)'), true);
  assert.equal(val('!(1 == 1)'), false);
  assert.equal(val('(1 > 0) ^^ (2 > 0)'), false);
  assert.equal(val('(1 > 0) xor (2 < 0)'), true);
  assert.equal(val('1 > 0 || 1 / 0'), true, 'short-circuit skips the right side');
});

test('strings concatenate with +', () => {
  assert.equal(val('"q" + 3'), 'q3');
});

test('// inside parentheses is floor division', () => {
  assert.equal(val('(7 // 2)'), 3);
  assert.equal(val('(-7 // 2)'), -4);
});

test('division and modulo by zero are errors', () => {
  rejects('x = 1 / 0', /Division by zero/);
  rejects('x = 1 % 0', /Modulo by zero/);
});

test('an unknown name is an error', () => {
  rejects('x = y + 1', /Unknown name y/);
});
