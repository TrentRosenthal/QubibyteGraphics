import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exactForm, diracTerms, formatDirac, diracOptionsFromSettings } from '../../src/quantum/notation.js';
import { StatevectorSimulator } from '../../src/quantum/statevector.js';
import { densityMatrixOf } from '../../src/quantum/analysis.js';

const g = (name, targets, controls = [], params = []) => ({ kind: 'gate', name, targets, controls, params });
const polar = (r, t) => ({ re: r * Math.cos(t), im: r * Math.sin(t) });

test('exactForm recognizes common closed forms', () => {
  const cases = [
    [0, '0', '0'],
    [1, '1', '1'],
    [-1, '-1', '-1'],
    [0.5, '1/2', '\\frac{1}{2}'],
    [Math.SQRT1_2, '1/√2', '\\frac{1}{\\sqrt{2}}'],
    [-Math.SQRT1_2, '-1/√2', '-\\frac{1}{\\sqrt{2}}'],
    [Math.sqrt(3) / 2, '√3/2', '\\frac{\\sqrt{3}}{2}'],
    [1 / Math.sqrt(3), '1/√3', '\\frac{1}{\\sqrt{3}}'],
    [Math.sqrt(2 / 3), '√(2/3)', '\\sqrt{\\frac{2}{3}}'],
    [0.25, '1/4', '\\frac{1}{4}'],
    [1 / Math.sqrt(8), '1/√8', '\\frac{1}{\\sqrt{8}}'],
    [0.75, '3/4', '\\frac{3}{4}'],
    [{ re: 0, im: 0.5 }, 'i/2', '\\frac{i}{2}'],
    [{ re: 0, im: -1 }, '-i', '-i'],
    [polar(Math.SQRT1_2, Math.PI / 4), 'e^(iπ/4)/√2', '\\frac{e^{i\\pi/4}}{\\sqrt{2}}'],
    [polar(0.5, (-3 * Math.PI) / 4), 'e^(-3iπ/4)/2', '\\frac{e^{-3i\\pi/4}}{2}'],
    [polar(1, Math.PI / 3), 'e^(iπ/3)', 'e^{i\\pi/3}'],
    [{ re: 0, im: Math.sqrt(3) / 2 }, 'i√3/2', '\\frac{i\\sqrt{3}}{2}'],
  ];
  for (const [z, plain, latex] of cases) {
    const f = exactForm(z);
    assert.equal(f.exact, true, plain);
    assert.equal(f.plain, plain);
    assert.equal(f.latex, latex);
  }
  const odd = exactForm({ re: 0.123456, im: -0.3 });
  assert.equal(odd.exact, false);
  assert.equal(odd.plain, '(0.123-0.3i)');
});

test('diracTerms: MSB-first labels, negligibles, decimals and symbolic form', () => {
  const s = new StatevectorSimulator(2);
  s.applyOp(g('H', [0]));
  s.applyOp(g('CX', [1], [0]));
  s.applyOp(g('RY', [1], [], [0.001]));
  const shown = diracTerms(s);
  assert.deepEqual(shown.map((t) => t.label), ['00', '11']);
  assert.equal(shown[0].coefficient.plain, '0.707');
  const all = diracTerms(s, { hideNegligibles: false });
  assert.equal(all.length, 4);
  const one = new StatevectorSimulator(3);
  one.applyOp(g('X', [0]));
  assert.equal(diracTerms(one)[0].label, '001');
  const sym = diracTerms(new StatevectorSimulator(1).setAmplitudes([1, -1]), { symbolic: true });
  assert.equal(formatDirac(sym), '1/√2|0⟩ - 1/√2|1⟩');
  assert.equal(formatDirac(sym, { format: 'latex' }), '\\frac{1}{\\sqrt{2}}|0\\rangle - \\frac{1}{\\sqrt{2}}|1\\rangle');
  assert.equal(formatDirac(diracTerms(one)), '|001⟩');
  assert.equal(formatDirac([]), '0');
  const four = diracTerms(new StatevectorSimulator(1).setAmplitudes([0.6, 0.8]), { decimalPlaces: 1 });
  assert.deepEqual(four.map((t) => t.coefficient.plain), ['0.6', '0.8']);
  assert.throws(() => diracTerms(densityMatrixOf(s)), /pure state/);
});

test('SortBy and SortOrder semantics', () => {
  const s = new StatevectorSimulator(2).setAmplitudes([0.1, -0.7, 0.5, 0.3], [0, 0, 0, 0.4]);
  const labels = (opts) => diracTerms(s, opts).map((t) => t.label);
  assert.deepEqual(labels({}), ['00', '01', '10', '11']);
  assert.deepEqual(labels({ sortOrder: 'descending' }), ['11', '10', '01', '00']);
  assert.deepEqual(labels({ sortBy: 'probability', sortOrder: 'descending' }), ['01', '10', '11', '00']);
  assert.deepEqual(labels({ sortBy: 'amplitude' }), ['01', '00', '11', '10']);
  assert.deepEqual(labels({ sortBy: 'phase' }), ['00', '10', '11', '01']);
  assert.throws(() => labels({ sortBy: 'size' }), /SortBy/);
  assert.throws(() => labels({ sortOrder: 'up' }), /SortOrder/);
});

test('diracOptionsFromSettings reads #settings values', () => {
  const opts = diracOptionsFromSettings({ SymbolicNotation: 'on', HideNegligibles: 'false', DecimalPlaces: '5', SortBy: 'Probability', sortorder: 'Descending' });
  assert.deepEqual(opts, { decimalPlaces: 5, hideNegligibles: false, symbolic: true, sortBy: 'probability', sortOrder: 'descending' });
  assert.deepEqual(diracOptionsFromSettings({}), { decimalPlaces: 3, hideNegligibles: true, symbolic: false, sortBy: 'state', sortOrder: 'ascending' });
  assert.throws(() => diracOptionsFromSettings({ SymbolicNotation: 'maybe' }), /true or false/);
});
