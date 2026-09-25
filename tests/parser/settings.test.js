import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ev, rejects } from './helpers/qubi.js';
import { SETTINGS_KEYS, parse } from '../../src/qubi/index.js';
import { SETTING_DEFAULTS } from '../../src/qubi/settings.js';

const settingsOf = (src) => ev(src + '\nH 0').settings;

test('SETTINGS_KEYS lists every key of the reference', () => {
  assert.deepEqual([...SETTINGS_KEYS].sort(), [
    'AutoAdjustVisibleQubits', 'AutoRun', 'CodeAngleUnit', 'DecimalPlaces', 'GateParamAngleUnit', 'HideNegligibles',
    'MaxQubits', 'Scheduling', 'ShowConditionalBranches', 'ShowEvaluatedLabels', 'ShowGateParams', 'SortBy', 'SortOrder',
    'StepByStep', 'SymbolicNotation', 'UseOptimizedGates', 'UseOptimizedSweep', 'VisibleQubits', 'Zoom',
  ]);
});

test('every key is stored in circuit.settings, with defaults for unset keys', () => {
  const s = settingsOf('');
  for (const k of SETTINGS_KEYS) assert.ok(k in s, k);
  const { MaxQubits: _m, VisibleQubits: _v, ...rest } = SETTING_DEFAULTS;
  for (const [k, v] of Object.entries(rest)) assert.equal(s[k], v, k);
  assert.equal(s.MaxQubits, 1, 'the resolved qubit count replaces the null default');
});

test('each key accepts its values', () => {
  const src = [
    '#settings Scheduling always', '#settings MaxQubits 5', '#settings VisibleQubits 3', '#settings Zoom 1.5',
    '#settings AutoAdjustVisibleQubits on', '#settings DecimalPlaces 5', '#settings AutoRun false',
    '#settings UseOptimizedGates no', '#settings UseOptimizedSweep 0', '#settings StepByStep yes',
    '#settings ShowGateParams off', '#settings ShowConditionalBranches false', '#settings ShowEvaluatedLabels FALSE',
    '#settings GateParamAngleUnit deg', '#settings CodeAngleUnit radians', '#settings SymbolicNotation true',
    '#settings HideNegligibles false', '#settings SortBy probability', '#settings SortOrder desc',
  ].join('\n');
  assert.deepEqual(settingsOf(src), {
    Scheduling: 'always', MaxQubits: 5, VisibleQubits: 3, Zoom: 1.5, AutoAdjustVisibleQubits: true, DecimalPlaces: 5,
    AutoRun: false, UseOptimizedGates: false, UseOptimizedSweep: false, StepByStep: true, ShowGateParams: false,
    ShowConditionalBranches: false, ShowEvaluatedLabels: false, GateParamAngleUnit: 'degrees', CodeAngleUnit: 'radians',
    SymbolicNotation: true, HideNegligibles: false, SortBy: 'probability', SortOrder: 'descending',
  });
});

test('Scheduling takes every mode and the sameType alias', () => {
  for (const m of ['never', 'same_line', 'same_gate_continuous', 'same_gate', 'always', 'compressed']) {
    assert.equal(settingsOf(`#settings Scheduling ${m}`).Scheduling, m);
  }
  assert.equal(settingsOf('#settings Scheduling sameType').Scheduling, 'same_gate');
});

test('angle unit aliases', () => {
  for (const [raw, unit] of [['degrees', 'degrees'], ['deg', 'degrees'], ['radians', 'radians'], ['rad', 'radians'], ['piradians', 'piradians'], ['pirad', 'piradians']]) {
    assert.equal(settingsOf(`#settings CodeAngleUnit ${raw}`).CodeAngleUnit, unit);
  }
});

test('keys are case-insensitive and later settings win', () => {
  const s = settingsOf('#settings maxqubits 3\n#settings MAXQUBITS 4');
  assert.equal(s.MaxQubits, 4);
});

test('invalid keys and values are errors with positions', () => {
  assert.throws(() => parse('#settings Colour red'), /Unknown setting Colour\. Keys: Scheduling/);
  assert.throws(() => parse('#settings MaxQubits 0'), /MaxQubits takes a whole number from 1 to 1024 at line 1, col 1/);
  assert.throws(() => parse('#settings MaxQubits 2.5'), /MaxQubits takes a whole number/);
  assert.throws(() => parse('#settings Scheduling fast'), /Scheduling takes never, same_line/);
  assert.throws(() => parse('#settings CodeAngleUnit turns'), /CodeAngleUnit takes degrees, radians, or piradians/);
  assert.throws(() => parse('#settings AutoRun maybe'), /AutoRun takes true or false/);
  assert.throws(() => parse('#settings Zoom -1'), /Zoom takes a positive number/);
  assert.throws(() => parse('#settings SortOrder sideways'), /SortOrder takes ascending or descending/);
  assert.throws(() => parse('#settings SortBy size'), /SortBy takes state, probability, amplitude, or phase/);
  assert.throws(() => parse('#settings DecimalPlaces 16'), /DecimalPlaces takes a whole number from 0 to 15/);
  assert.throws(() => parse('#settings MaxQubits'), /#settings MaxQubits needs a value/);
  assert.throws(() => parse('#settings'), /#settings needs a key and a value/);
  assert.throws(() => parse('#pragma x'), /Unknown directive #pragma/);
});

test('#settings goes at the top level', () => {
  assert.throws(() => parse('LOOP 1 {\n#settings MaxQubits 3\n}'), /#settings goes at the top level/);
});

test('a trailing // comment after a setting is ignored', () => {
  assert.equal(settingsOf('#settings Scheduling never // one op per column').Scheduling, 'never');
});

test('MaxQubits and VisibleQubits set the circuit sizes', () => {
  const c = ev('#settings MaxQubits 6\n#settings VisibleQubits 4\nH 0');
  assert.deepEqual([c.numQubits, c.visibleQubits], [6, 4]);
});

test('VisibleQubits alone raises the inferred qubit count', () => {
  const c = ev('#settings VisibleQubits 5\nH 0');
  assert.deepEqual([c.numQubits, c.visibleQubits], [5, 5]);
});

test('VisibleQubits larger than MaxQubits is clamped with a warning', () => {
  const c = ev('#settings MaxQubits 3\n#settings VisibleQubits 5\nH 0');
  assert.equal(c.visibleQubits, 3);
  assert.ok(c.diagnostics.some((d) => /VisibleQubits \(5\) is larger than MaxQubits \(3\)/.test(d.message)));
});

test('AutoAdjustVisibleQubits grows the displayed count but not the visible keyword', () => {
  const src = '#settings MaxQubits 6\n#settings VisibleQubits 2\nX 4\nH visible';
  const off = ev(src);
  const on = ev('#settings AutoAdjustVisibleQubits true\n' + src);
  assert.equal(off.visibleQubits, 2);
  assert.equal(on.visibleQubits, 5);
  assert.deepEqual(on.ops.slice(1).map((o) => o.targets[0]), [0, 1]);
});

test('a wire beyond an explicit MaxQubits is an error', () => {
  rejects('#settings MaxQubits 2\nCX [0,2]', /Wire 2 is out of range: MaxQubits is 2/);
});
