import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  differentiate, diff, implicitDerivative, integrate, integrateDefinite, integrateNumeric, limit, taylor, laurent,
  parse, simplify, toLatex, compileReal, numericDerivative, SeededRandom, key,
} from '../../src/math/index.js';

const rng = new SeededRandom(2024);

function closeAt(f, g, lo, hi, tol = 1e-6, count = 12) {
  let checked = 0;
  for (let i = 0; i < 200 && checked < count; i++) {
    const x = rng.uniform(lo, hi);
    const a = f(x);
    const b = g(x);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    assert.ok(Math.abs(a - b) <= tol * (1 + Math.abs(b)), 'mismatch at x = ' + x + ': ' + a + ' vs ' + b);
    checked++;
  }
  assert.ok(checked >= 3, 'too few valid sample points');
}

const DIFF_CASES = [
  'x^2 + 3x - sin(2x)/4', 'x^2 sin(x)', 'sin(x)/x', 'e^(x^2)', 'ln(cos(x))', 'x^x', 'sqrt(x^2+1)', 'atan(x)', '2^x',
  'log(x, 2)', '(x+1)/(x-1)', 'tan(x)^3', 'asin(x/2)', 'acos(x)', 'sec(x) csc(x)', 'cot(3x)', 'sinh(x) cosh(2x)',
  'tanh(x)', 'abs(x^3 - 1)', 'x^(3/2) ln(x)', 'e^(sin(x)) cos(x^2)', '1/(x^2 + 1)^3', 'sin(cos(tan(x)))', 'x^sin(x)',
];

test('differentiate matches numeric derivatives at random points', () => {
  for (const s of DIFF_CASES) {
    const r = differentiate(s);
    assert.ok(r.ok, s);
    const f = compileReal(parse(s), ['x']);
    const d = compileReal(r.result, ['x']);
    closeAt(d, (x) => numericDerivative(f, x), 0.2, 1.4, 1e-6);
    const plain = compileReal(diff(s), ['x']);
    closeAt(plain, d, 0.2, 1.4, 1e-9);
  }
});

test('derivative steps apply one named rule at a time', () => {
  const r = differentiate('x^2 sin(x)');
  assert.deepEqual(r.steps.map((s) => s.rule), ['Differentiate', 'Product rule', 'Power rule', 'Derivative of sine', 'Simplify']);
  assert.equal(r.steps[1].latex, '\\frac{d}{dx}\\left[x^{2}\\right]\\sin(x) + x^{2}\\frac{d}{dx}\\left[\\sin(x)\\right]');
  assert.equal(r.latex, 'x^{2}\\cos(x) + 2x\\sin(x)');
  // Every step after the first carries token matches with LaTeX slices.
  for (const s of r.steps.slice(1)) {
    assert.ok(s.matches.length > 0);
    for (const m of s.matches) assert.equal(s.spans.some((sp) => sp.id === m.to), true);
  }
  const q = differentiate('(x+1)/(x-1)');
  assert.ok(q.steps.some((s) => s.rule === 'Quotient rule'));
  assert.equal(q.latex, '-\\frac{2}{(x - 1)^{2}}');
  const c = differentiate('sin(x^2)');
  assert.ok(c.steps.some((s) => s.rule === 'Chain rule'));
  assert.equal(differentiate('sin(x)', 'x', { order: 4 }).latex, '\\sin(x)');
  const bad = differentiate('x!');
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /factorial/);
});

test('partial and implicit derivatives', () => {
  const p = differentiate('x^2 y + y^3', 'y', { partial: true });
  assert.equal(p.latex, 'x^{2} + 3y^{2}');
  assert.ok(p.steps[0].latex.startsWith('\\frac{\\partial}{\\partial y}'));
  const circle = implicitDerivative('x^2 + y^2 = 25');
  assert.equal(circle.latex, '-\\frac{x}{y}');
  assert.deepEqual(circle.steps.slice(-2).map((s) => s.rule), ['Collect the dy/dx terms on one side', 'Divide to solve for dy/dx']);
  const folium = implicitDerivative('x^3 + y^3 = 6 x y');
  // Check against dy/dx = -F_x / F_y at a point on the curve (3, 3).
  const val = compileReal(folium.result, ['x', 'y'])(3, 3);
  assert.ok(Math.abs(val - -1) < 1e-12);
});

const INTEGRALS = [
  'x^2', '3x^2 + 2x + 1', '1/x', 'sin(2x)', 'e^(3x+1)', '2x e^(x^2)', 'x e^x', 'x^2 e^x', 'x sin(x)', 'ln(x)', 'x ln(x)',
  'e^x sin(x)', 'e^(2x) cos(3x)', '1/(x^2-1)', '(3x+5)/((x-1)^2 (x+2))', '1/(x^2+1)', '1/(x^2+2x+5)', 'x/(x^2+1)',
  'sin(x)^2', 'sin(x)^3', 'sin(x)^2 cos(x)^2', 'sec(x)^3', 'tan(x)^3', 'sec(x)^4', 'tan(x)', 'sin(x) cos(x)',
  'sin(3x) cos(2x)', 'sqrt(1-x^2)', '1/sqrt(1-x^2)', 'atan(x)', 'x^3 e^(x^2)', 'ln(x)^2', '1/(x ln(x))', 'e^x/(1+e^x)',
  '(x+1)^5', 'x sqrt(x+1)', '1/(x^3 + x)', 'cos(x)^5', 'x^2/(x^2+1)', '1/(1+e^x)', 'asin(x)', '2^x', 'cot(x)',
  'x cos(x^2)', '1/(x^2-2)', 'x^2 sin(x)', '1/sqrt(x^2+4)', 'tan(x)^2', 'cos(x)^4', 'x atan(x)', 'e^(-x) x^3',
  'csc(x)^2', 'sinh(2x)', '(2x+3)/(x^2+3x+7)', 'x^4/(x^2-1)', 'sin(x)^5 cos(x)^2',
];

test('integrate: differentiating the antiderivative gives back the integrand', () => {
  for (const s of INTEGRALS) {
    const r = integrate(s);
    assert.ok(r.ok, s + ': ' + r.reason);
    const back = compileReal(diff(r.result), ['x']);
    const f = compileReal(parse(s), ['x']);
    closeAt(back, f, 0.15, 0.95, 1e-7);
    assert.ok(r.latex.includes('C'));
    assert.equal(r.steps[0].rule, 'Integrate');
    assert.equal(r.steps[r.steps.length - 1].rule, 'Add the constant of integration');
  }
});

test('integration step lists name the methods', () => {
  const rules = (s) => integrate(s).steps.map((x) => x.rule);
  assert.ok(rules('x^2 e^x').filter((r) => r === 'Integration by parts').length === 2);
  assert.ok(rules('2x e^(x^2)').includes('u-substitution'));
  assert.ok(rules('2x e^(x^2)').includes('Substitute back'));
  assert.ok(rules('(3x+5)/((x-1)^2 (x+2))').includes('Partial fraction decomposition'));
  assert.ok(rules('sin(x)^2').includes('Power-reduction identity'));
  assert.ok(rules('sec(x)^3').includes('Reduction formula'));
  assert.ok(rules('e^x sin(x)').includes('Integration by parts twice'));
  assert.ok(rules('cos(3x)').includes('Linear substitution'));
  const parts = integrate('x e^x').steps.find((s) => s.rule === 'Integration by parts');
  assert.match(parts.note, /u = x/);
});

test('non-elementary integrals report failure instead of a fake result', () => {
  for (const s of ['e^(-x^2)', 'sin(x)/x', 'e^x/x', 'sqrt(1 + x^3)']) {
    const r = integrate(s);
    assert.equal(r.ok, false, s);
    assert.equal(r.reason, 'No elementary antiderivative found');
  }
});

test('definite integrals: FTC steps, improper integrals and numeric fallback', () => {
  const a = integrateDefinite('x^2', 'x', 0, 1);
  assert.equal(a.latex, '\\frac{1}{3}');
  assert.ok(a.steps.some((s) => s.rule === 'Evaluate the antiderivative at the limits' && s.latex === '\\left[\\frac{x^{3}}{3}\\right]_{0}^{1}'));
  assert.ok(a.steps.some((s) => s.rule === 'F(b) - F(a)'));
  assert.equal(integrateDefinite('sin(x)', 'x', 0, 'pi').latex, '2');
  assert.equal(integrateDefinite('x e^x', 'x', 0, 1).latex, '1');
  assert.equal(integrateDefinite('1/x^2', 'x', 1, 'inf').latex, '1');
  assert.equal(integrateDefinite('e^(-x)', 'x', 0, Infinity).latex, '1');
  assert.equal(integrateDefinite('1/sqrt(x)', 'x', 0, 1).latex, '2');
  assert.equal(integrateDefinite('1/(1+x^2)', 'x', '-inf', 'inf').latex, '\\pi');
  const div = integrateDefinite('1/x', 'x', 1, 'inf');
  assert.equal(div.converges, false);
  const sing = integrateDefinite('1/x^2', 'x', -1, 1);
  assert.equal(sing.converges, false);
  const gauss = integrateDefinite('e^(-x^2)', 'x', '-inf', 'inf');
  assert.equal(gauss.numericOnly, true);
  assert.ok(Math.abs(gauss.value - Math.sqrt(Math.PI)) < 1e-9);
  assert.match(gauss.reason, /numerically/);
  const si = integrateNumeric('sin(x)/x', 'x', 1e-12, Math.PI);
  assert.ok(Math.abs(si.value - 1.851937051982466) < 1e-9);
  // Exact values agree with quadrature on random polynomial-exponential integrands.
  for (const s of ['x^3 - 2x + 1', 'x cos(x)', 'e^(2x) x', '1/(x^2+4)', 'sqrt(x+1)']) {
    const lo = rng.uniform(0, 1);
    const hi = lo + rng.uniform(0.5, 2);
    const r = integrateDefinite(s, 'x', String(lo), String(hi));
    const q = integrateNumeric(s, 'x', lo, hi);
    assert.ok(Math.abs(r.value - q.value) < 1e-8, s);
  }
});

test('limits: substitution, cancellation, standard limits and L\'Hopital', () => {
  const val = (f, a, d) => limit(f, 'x', a, d);
  assert.equal(val('x^2 + 1', 2).latex, '5');
  assert.equal(val('x^2 + 1', 2).steps[1].rule, 'Direct substitution');
  const cancel = val('(x^2-1)/(x-1)', 1);
  assert.equal(cancel.latex, '2');
  assert.ok(cancel.steps.some((s) => s.rule === 'Factor and cancel'));
  const sinc = val('sin(x)/x', 0);
  assert.equal(sinc.latex, '1');
  assert.ok(sinc.steps.some((s) => s.rule === 'Standard limit'));
  assert.equal(val('sin(3x)/(2x)', 0).latex, '\\frac{3}{2}');
  assert.equal(val('(1-cos(x))/x^2', 0).latex, '\\frac{1}{2}');
  const lh = val('(x - sin(x))/x^3', 0);
  assert.equal(lh.latex, '\\frac{1}{6}');
  assert.ok(lh.steps.some((s) => s.rule === "L'Hopital's rule"));
  assert.equal(val('(3x^2+1)/(2x^2-x)', 'inf').latex, '\\frac{3}{2}');
  assert.equal(val('x^3/(x^2+1)', '-inf').latex, '-\\infty');
  assert.equal(val('(1+1/x)^x', 'inf').latex, 'e');
  assert.equal(val('x e^(-x)', 'inf').latex, '0');
  assert.equal(val('sqrt(x^2+x) - x', 'inf').latex, '\\frac{1}{2}');
  assert.equal(val('x ln(x)', 0, '+').latex, '0');
  assert.equal(val('1/x^2', 0).kind, 'infinite');
  const twoSided = val('1/x', 0);
  assert.equal(twoSided.kind, 'dne');
  assert.equal(val('1/x', 0, '+').latex, '\\infty');
  assert.equal(val('abs(x)/x', 0).kind, 'dne');
  assert.equal(val('sin(1/x)', 0).kind, 'dne');
  assert.equal(val('atan(x)', 'inf').latex, '\\frac{\\pi}{2}');
  assert.equal(val('(2^x - 1)/x', 0).latex, '\\ln(2)');
  assert.equal(limit('(a x^2 - a)/(x-1)', 'x', 1).latex, '2a');
  assert.equal(limit('1/x - 1/sin(x)', 'x', 0).latex, '0');
});

test('Taylor and Maclaurin series with general terms', () => {
  const e = taylor('e^x', 'x', 0, 5);
  assert.equal(e.latex, '1 + x + \\frac{x^{2}}{2} + \\frac{x^{3}}{6} + \\frac{x^{4}}{24} + \\frac{x^{5}}{120}');
  assert.equal(e.generalTerm.latex, '\\sum_{n=0}^{\\infty} \\frac{x^{n}}{n!}');
  assert.equal(taylor('sin(x)', 'x', 0, 7).generalTerm.latex, '\\sum_{n=0}^{\\infty} \\frac{(-1)^{n}x^{2n + 1}}{(2n + 1)!}');
  assert.equal(taylor('1/(1-x)', 'x', 0, 4).generalTerm.latex, '\\sum_{n=0}^{\\infty} x^{n}');
  assert.equal(taylor('ln(1+x)', 'x', 0, 4).generalTerm.start, 1);
  const tan = taylor('tan(x)', 'x', 0, 7);
  assert.equal(tan.latex, 'x + \\frac{x^{3}}{3} + \\frac{2x^{5}}{15} + \\frac{17x^{7}}{315}');
  assert.equal(tan.generalTerm, null);
  assert.equal(taylor('ln(x)', 'x', 1, 3).latex, 'x - 1 - \\frac{(x - 1)^{2}}{2} + \\frac{(x - 1)^{3}}{3}');
  const sinc = taylor('sin(x)/x', 'x', 0, 4);
  assert.equal(key(sinc.polynomial), key(simplify(parse('1 - x^2/6 + x^4/120'))));
  // Coefficients match derivatives computed numerically for a composite function.
  const t = taylor('e^(sin(x))', 'x', 0, 4);
  const f = compileReal(parse('e^(sin(x))'), ['x']);
  const poly = compileReal(t.polynomial, ['x']);
  for (const x of [0.01, -0.02, 0.03]) assert.ok(Math.abs(poly(x) - f(x)) < Math.abs(x) ** 5);
  assert.equal(taylor('1/x', 'x', 0, 3).ok, false);
});

test('Laurent series and residues at poles', () => {
  const a = laurent('e^x/x^2', 'x', 0, 2);
  assert.equal(a.poleOrder, 2);
  assert.equal(toLatex(a.residue), '1');
  assert.equal(a.latex, '\\frac{1}{x^{2}} + \\frac{1}{x} + \\frac{1}{2} + \\frac{x}{6} + \\frac{x^{2}}{24}');
  const b = laurent('1/(x^2-1)', 'x', 1, 1);
  assert.equal(b.poleOrder, 1);
  assert.equal(toLatex(b.residue), '\\frac{1}{2}');
  const c = laurent('1/sin(x)', 'x', 0, 3);
  assert.equal(c.latex, '\\frac{1}{x} + \\frac{x}{6} + \\frac{7x^{3}}{360}');
  assert.equal(laurent('cos(x)/x^3', 'x', 0, 1).residue.value.toString(), '-1/2');
  assert.equal(laurent('e^(1/x)', 'x', 0, 2).ok, false);
});

test('harder integrals: conjugates, repeated quadratics, deep parts, inverse substitutions', () => {
  for (const s of ['1/(1+cos(x))', 'x^3/(x^2+1)^2', '1/(x^2+x+1)^2', 'x^6 e^x sin(x)', 'e^x cos(x)^2', 'cos(ln(x))', 'cot(x)^2', '(x+2)/(x^2+2x+2)^2', '1/(1-sin(x))']) {
    const r = integrate(s);
    assert.ok(r.ok, s + ': ' + r.reason);
    closeAt(compileReal(diff(r.result), ['x']), compileReal(parse(s), ['x']), 0.2, 1.2, 1e-7);
  }
  assert.ok(integrate('1/(1+cos(x))').steps.some((s) => s.rule === 'Multiply by the conjugate'));
  assert.ok(integrate('1/(x^2+x+1)^2').steps.some((s) => s.rule === 'Reduction formula'));
  const sym = integrateDefinite('x^2', 'x', 0, 'a');
  assert.equal(sym.latex, '\\frac{a^{3}}{3}');
  assert.equal(integrateDefinite('k e^(-k x)', 'x', 0, 1).latex, '1 - e^{-k}');
});

test('power series engine handles removable singularities and poles', () => {
  const coeffs = (f, a, n) => {
    const r = laurent(f, 'x', a, n);
    assert.ok(r.ok, f);
    return r;
  };
  assert.equal(coeffs('tanh(x)', 0, 5).latex, 'x - \\frac{x^{3}}{3} + \\frac{2x^{5}}{15}');
  assert.equal(coeffs('sinh(x) cosh(x)', 0, 3).latex, 'x + \\frac{2x^{3}}{3}');
  assert.equal(coeffs('atan(x)/x^2', 0, 1).latex, '\\frac{1}{x} - \\frac{x}{3}');
  assert.equal(coeffs('asin(x)', 0, 5).latex, 'x + \\frac{x^{3}}{6} + \\frac{3x^{5}}{40}');
  assert.equal(coeffs('acos(x)', 0, 3).latex, '\\frac{\\pi}{2} - x - \\frac{x^{3}}{6}');
  assert.equal(coeffs('cot(x)', 0, 3).latex, '\\frac{1}{x} - \\frac{x}{3} - \\frac{x^{3}}{45}');
  assert.equal(coeffs('sec(x)', 0, 4).latex, '1 + \\frac{x^{2}}{2} + \\frac{5x^{4}}{24}');
  assert.equal(coeffs('log(1+x, 10)', 0, 2).latex, '\\frac{x}{\\ln(10)} - \\frac{x^{2}}{2\\ln(10)}');
  assert.equal(coeffs('2^x', 0, 2).latex, '1 + \\ln(2)x + \\frac{\\ln^{2}(2)x^{2}}{2}');
  assert.equal(coeffs('sqrt(4 + x)', 0, 2).latex, '2 + \\frac{x}{4} - \\frac{x^{2}}{64}');
  assert.equal(coeffs('1/(x^2 (1 - x))', 0, 1).latex, '\\frac{1}{x^{2}} + \\frac{1}{x} + 1 + x');
  assert.equal(laurent('sqrt(x)', 'x', 0, 2).ok, false);
  assert.equal(laurent('ln(x)', 'x', 0, 2).ok, false);
  assert.equal(taylor('x/sin(x)', 'x', 0, 4).latex, '1 + \\frac{x^{2}}{6} + \\frac{7x^{4}}{360}');
  const bern = taylor('x/(e^x-1)', 'x', 0, 4);
  assert.equal(bern.latex, '1 - \\frac{x}{2} + \\frac{x^{2}}{12} - \\frac{x^{4}}{720}');
  assert.ok(bern.steps.some((s) => s.rule === 'Combine the known series of each part'));
});
