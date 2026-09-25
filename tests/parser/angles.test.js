import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, rejects } from './helpers/qubi.js';
import { simulate, probOf } from './helpers/refsim.js';

const angle = (src) => ev(src).ops[0].params[0];
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg ?? ''} expected ${b}, got ${a}`);

test('RX(0.5) q and RX q 0.5 are the same gate', () => {
  const a = ev('q = 1\nRX(0.5) q').ops[0];
  const b = ev('q = 1\nRX q 0.5').ops[0];
  assert.deepEqual([a.name, a.targets, a.params], [b.name, b.targets, b.params]);
  assert.deepEqual(a.paramText, ['0.5']);
});

test('bare angles default to piradians', () => {
  close(angle('RX 0 0.5'), Math.PI / 2);
  close(angle('RY(1) 0'), Math.PI);
  close(angle('RZ 0 -0.25'), -Math.PI / 4, 'a negative trailing angle');
});

test('deg, rad, and pirad suffixes', () => {
  close(angle('RX(45deg) 0'), Math.PI / 4);
  close(angle('RX 0 1.5rad'), 1.5);
  close(angle('RX 0 0.25pirad'), Math.PI / 4);
  close(angle('RX((pi/4)rad) 0'), Math.PI / 4);
  close(angle('RX(90deg + 0.5) 0'), Math.PI, 'suffixed values mix with bare ones in CodeAngleUnit');
});

test('pi and π are the constant 3.14159..., read in CodeAngleUnit like any number', () => {
  close(angle('#settings CodeAngleUnit radians\nRX(pi/2) 0'), Math.PI / 2);
  close(angle('#settings CodeAngleUnit radians\nRX(π) 0'), Math.PI);
  close(angle('RX(pi) 0'), Math.PI * Math.PI, 'bare pi in piradians is pi*pi radians');
});

test('omitting the angle on RX, RY, RZ, P (and CP) means pi/2', () => {
  for (const g of ['RX', 'RY', 'RZ', 'P']) close(angle(`${g} 0`), Math.PI / 2, g);
  close(angle('CP [0,1]'), Math.PI / 2, 'CP');
  assert.equal(ev('RX 0').ops[0].paramText, undefined);
});

test('CodeAngleUnit degrees and radians change bare angles', () => {
  close(angle('#settings CodeAngleUnit degrees\nRX 0 90'), Math.PI / 2);
  close(angle('#settings CodeAngleUnit deg\nRX 0 180'), Math.PI);
  close(angle('#settings CodeAngleUnit radians\nRX 0 1'), 1);
  close(angle('#settings CodeAngleUnit rad\nRX 0 45deg'), Math.PI / 4);
});

test('GateParamAngleUnit is for display and does not change IR angles', () => {
  close(angle('#settings GateParamAngleUnit degrees\nRX 0 0.5'), Math.PI / 2);
});

test('the reference example RY 0 0.295 gives P(|0>) close to 80%', () => {
  const s = simulate(ev('RY 0 0.295'));
  assert.ok(Math.abs(probOf(s, '0') - 0.8) < 1e-3);
});

test('asin/acos/atan return radians, so the rad suffix gives exact rotations', () => {
  const s = simulate(ev('RY((2*acos(sqrt(0.8)))rad) 0'));
  assert.ok(Math.abs(probOf(s, '0') - 0.8) < 1e-12);
});

test('trig arguments use CodeAngleUnit', () => {
  const v = ev('a = sin(0.5)\nb = cos(1)\nc = tan(0.25)').variables;
  close(v.a, 1);
  close(v.b, -1);
  close(v.c, 1);
  close(ev('#settings CodeAngleUnit degrees\nx = sin(90)').variables.x, 1);
});

test('angles must be known numbers', () => {
  rejects('RX 0 "a"', /RX angles are numbers, got string/);
  rejects('m = MEASURE 0\nRX 1 m', /RX angle depends on a measurement result/);
});
