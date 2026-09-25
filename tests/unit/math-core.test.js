import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Rational, bestRational, bigIntRoot, parse, toLatex, toText, toLatexWithSpans, simplify, expand, key, num, sym, add,
  mul, pow, fn, matchTokens, linkSteps, makeStep, evaluate, compileReal, Complex, substituteValues, symbols, freeOf,
  factor, SeededRandom, isNonNegative, replaceSubtree, MathError, equivalent,
} from '../../src/math/index.js';

const S = (s) => simplify(parse(s));
const L = (s) => toLatex(S(s));

test('rational arithmetic is exact and normalized', () => {
  const a = Rational.from('1/3');
  const b = Rational.from('1/6');
  assert.equal(a.add(b).toString(), '1/2');
  assert.equal(a.mul(b).toString(), '1/18');
  assert.equal(a.div(b).toString(), '2');
  assert.equal(Rational.from('0.125').toString(), '1/8');
  assert.equal(Rational.from('-2.5e-1').toString(), '-1/4');
  assert.equal(new Rational(6n, -4n).toString(), '-3/2');
  assert.equal(Rational.from('7/2').floor(), 3n);
  assert.equal(Rational.from('-7/2').floor(), -4n);
  assert.equal(Rational.from('2/3').pow(-2).toString(), '9/4');
  assert.throws(() => Rational.from(1).div(Rational.from(0)), /Division by zero/);
  const huge = new Rational(10n ** 400n, 3n * 10n ** 399n);
  assert.ok(Math.abs(huge.toNumber() - 10 / 3) < 1e-12);
});

test('bestRational finds continued-fraction approximations', () => {
  assert.equal(bestRational(Math.PI, 1000).toString(), '355/113');
  assert.equal(bestRational(0.75).toString(), '3/4');
  assert.equal(bestRational(-1.5).toString(), '-3/2');
  assert.equal(bigIntRoot(10n ** 30n + 5n, 3), 10n ** 10n);
});

test('plain text parsing handles implicit multiplication, ** and functions', () => {
  assert.equal(L('x^2 + 3x - sin(2x)/4'), 'x^{2} + 3x - \\frac{\\sin(2x)}{4}');
  assert.equal(L('2x**3'), '2x^{3}');
  assert.equal(L('(x+1)(x-1)'), '(x - 1)(x + 1)');
  assert.equal(L('sin 2x'), '\\sin(2x)');
  assert.equal(L('sinx cosx'), '\\cos(x)\\sin(x)');
  assert.equal(L('|x - 1|'), '\\left|x - 1\\right|');
  assert.equal(L('x_1 + theta'), '\\theta + x_{1}');
  assert.equal(L('log(8, 2) + 5!'), '123');
  assert.equal(L('-x^2'), '-x^{2}');
  assert.equal(L('2^3^2'), '512');
  assert.throws(() => parse('x + '), SyntaxError);
  assert.throws(() => parse('x $ 2'), SyntaxError);
});

test('LaTeX parsing covers fractions, roots, operators and Greek letters', () => {
  assert.equal(L('\\frac{a}{b} + \\frac{1}{2}'), '\\frac{a}{b} + \\frac{1}{2}');
  assert.equal(L('\\sqrt[3]{27}'), '3');
  assert.equal(L('\\sqrt{x}'), '\\sqrt{x}');
  assert.equal(L('x^{2} \\cdot 3'), '3x^{2}');
  assert.equal(L('\\left( x + 1 \\right)^2'), '(x + 1)^{2}');
  assert.equal(L('\\sin^{2} x + \\cos^{2} x'), '1');
  assert.equal(L('\\sin^{-1} x'), '\\arcsin(x)');
  assert.equal(L('\\alpha \\beta'), '\\alpha\\beta');
  assert.equal(L('e^{i \\pi}'), '-1');
  assert.equal(L('\\log_{2}(32)'), '5');
  const integ = parse('\\int_0^1 x^2 \\, dx');
  assert.equal(integ.type, 'integral');
  assert.equal(integ.v, 'x');
  assert.equal(toLatex(integ), '\\int_{0}^{1} x^{2} \\, dx');
  const lim = parse('\\lim_{x \\to 0^+} \\frac{\\sin x}{x}');
  assert.equal(lim.type, 'limit');
  assert.equal(lim.dir, '+');
  const d = parse('\\frac{d}{dx} x^2 \\sin x');
  assert.equal(d.type, 'deriv');
  assert.equal(toLatex(d), '\\frac{d}{dx}\\left[x^{2}\\sin(x)\\right]');
  const d2 = parse('\\frac{d^2y}{dx^2}');
  assert.equal(d2.order, 2);
  const s = parse('\\sum_{i=1}^{n} i^2');
  assert.equal(s.type, 'sum');
  assert.equal(s.args[0].args[0].type, 'sym');
  assert.throws(() => parse('\\int x'), /differential/);
});

test('printer conventions: coefficients, signs, fractions and radicals', () => {
  assert.equal(L('-1*x'), '-x');
  assert.equal(L('x/2'), '\\frac{x}{2}');
  assert.equal(L('1/sqrt(2)'), '\\frac{\\sqrt{2}}{2}');
  assert.equal(L('x^(-2)'), '\\frac{1}{x^{2}}');
  assert.equal(L('x^(1/3)'), '\\sqrt[3]{x}');
  assert.equal(L('2 * 3^x'), '2 \\cdot 3^{x}');
  assert.equal(L('1 - x^2'), '1 - x^{2}');
  assert.equal(L('sqrt(-4) - 1'), '-1 + 2i');
  assert.equal(toText(S('x^2 + 3x - sin(2x)/4')), 'x^2 + 3x - sin(2x)/4');
  // Text output parses back to the same expression.
  for (const s of ['x^3 - 2x/3 + 1', 'sqrt(x + 1)/(x - 2)', 'e^(2x) sin(x)', 'ln(abs(x)) - atan(x)^2']) {
    assert.equal(key(S(toText(S(s)))), key(S(s)), s);
  }
});

test('simplification: like terms, powers, radicals and exact trig', () => {
  assert.equal(L('2x + 3x - x'), '4x');
  assert.equal(L('x * x^2 * x^(-1)'), 'x^{2}');
  assert.equal(L('sqrt(12) + sqrt(27)'), '5\\sqrt{3}');
  assert.equal(L('sqrt(2) sqrt(6)'), '2\\sqrt{3}');
  assert.equal(L('8^(2/3)'), '4');
  assert.equal(L('(1/4)^(1/2)'), '\\frac{1}{2}');
  assert.equal(L('sin(pi/6) + cos(pi/3)'), '1');
  assert.equal(L('tan(pi/4) + sin(5pi/4)'), '\\frac{2 - \\sqrt{2}}{2}');
  assert.equal(L('cos(pi/12)'), '\\frac{\\sqrt{2} + \\sqrt{6}}{4}');
  assert.equal(L('asin(sqrt(3)/2) + atan(1)'), '\\frac{7\\pi}{12}');
  assert.equal(L('sin(-x) + sin(x)'), '0');
  assert.equal(L('3 sin(x)^2 + 3 cos(x)^2'), '3');
  assert.equal(L('cosh(x)^2 - sinh(x)^2'), '1');
  assert.equal(L('e^(2 ln(x))'), 'x^{2}');
  assert.equal(L('ln(e^3)'), '3');
  assert.equal(L('i^3'), '-i');
  assert.equal(L('abs(x^2 + 1)'), 'x^{2} + 1');
  assert.equal(L('abs(-3x)'), '3\\left|x\\right|');
  assert.equal(L('sin(x)/cos(x)'), '\\tan(x)');
  assert.equal(L('2(x+1) - 2'), '2x');
  assert.equal(L('(2x + 2)/(x + 1)'), '2');
  assert.throws(() => simplify(parse('1/0')), MathError);
  assert.ok(isNonNegative(S('x^2 + e^x')));
  assert.ok(!isNonNegative(S('x - 1')));
});

test('simplify is idempotent and preserves numeric value', () => {
  const rng = new SeededRandom(5);
  const exprs = ['(x+1)^2 - (x-1)^2', 'sin(x)^2 + x cos(x) - 2/(x+3)', 'e^(x) e^(2x) / e^x', 'sqrt(8x^2)', 'ln(x^2) + x^(3/2) x^(1/2)', '(x^2 - 1)/(x + 1)'];
  for (const s of exprs) {
    const raw = parse(s);
    const once = simplify(raw);
    assert.equal(key(simplify(once)), key(once), s);
    for (let k = 0; k < 5; k++) {
      const x = rng.uniform(0.2, 3);
      const a = compileReal(raw, ['x'])(x);
      const b = compileReal(once, ['x'])(x);
      assert.ok(Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a)), s + ' at ' + x);
    }
  }
});

test('expand multiplies out products and powers', () => {
  assert.equal(toLatex(expand(parse('(x+1)^3'))), 'x^{3} + 3x^{2} + 3x + 1');
  assert.equal(toLatex(expand(parse('(x+y)(x-y)'))), 'x^{2} - y^{2}');
  assert.equal(toLatex(expand(parse('(a+b+c)^2'))), 'a^{2} + 2ab + 2ac + b^{2} + 2bc + c^{2}');
});

test('evaluation: real and complex, with principal branches', () => {
  assert.equal(evaluate('x^2 + 1', { x: 3 }), 10);
  const z = evaluate('sqrt(-4)');
  assert.ok(z instanceof Complex && Math.abs(z.im - 2) < 1e-12);
  assert.ok(Math.abs(evaluate('e^(i pi)') + 1) < 1e-12);
  assert.equal(compileReal('x^(1/3)', ['x'])(-8), -2);
  assert.ok(Number.isNaN(compileReal('sqrt(x)', ['x'])(-1)));
  assert.ok(Math.abs(compileReal('log(x, 2)', ['x'])(8) - 3) < 1e-12);
  assert.throws(() => compileReal('x + y', ['x']), /No value for variable y/);
  assert.equal(key(simplify(substituteValues('x^2 + y', { x: 2, y: 'z' }))), key(S('z + 4')));
  assert.deepEqual([...symbols(parse('\\int_0^a x y \\, dx'))].sort(), ['a', 'y']);
  assert.ok(freeOf(parse('\\sum_{k=1}^{n} k'), 'k'));
});

test('LaTeX spans locate every node and token matching pairs subtrees', () => {
  const e = S('x^2 + 3x');
  const { latex, spans } = toLatexWithSpans(e);
  assert.equal(latex, 'x^{2} + 3x');
  const whole = spans.find((s) => s.id === e.id);
  assert.deepEqual([whole.start, whole.end], [0, latex.length]);
  const first = e.args[0];
  const sp = spans.find((s) => s.id === first.id);
  assert.equal(latex.slice(sp.start, sp.end), 'x^{2}');
  const before = parse('x^2 + 3x');
  const after = add(pow(sym('x'), num(2)), mul(num(3), sym('x')), num(1));
  const m = matchTokens(before, after);
  assert.deepEqual(m.map((x) => x.from).sort(), before.args.map((a) => a.id).sort());
  const steps = linkSteps([makeStep(before, 'a'), makeStep(after, 'b'), makeStep(after, 'Simplify')]);
  assert.equal(steps.length, 2);
  assert.ok(steps[1].matches.length >= 1);
  assert.ok(steps[1].matches.every((x) => typeof x.latex === 'string'));
  assert.equal(key(replaceSubtree(S('sin(x^2) + x^2'), S('x^2'), sym('u'))), key(S('sin(u) + u')));
  assert.equal(toLatex(fn('binom', num(5), sym('k'))), '\\binom{5}{k}');
});

test('factor: over the rationals, reals and complex numbers, and patterns', () => {
  const f = (s, o) => factor(s, o).latex;
  assert.equal(f('x^2 - 5x + 6'), '(x - 3)(x - 2)');
  assert.equal(f('6x^3 + 9x^2'), '3x^{2}(2x + 3)');
  assert.equal(f('x^4 - 1'), '(x - 1)(x + 1)(x^{2} + 1)');
  assert.equal(f('x^4 + 4'), '(x^{2} + 2x + 2)(x^{2} - 2x + 2)');
  assert.equal(f('x^3 - 3x^2 + 3x - 1'), '(x - 1)^{3}');
  assert.equal(f('2x^3 - 3x^2 - 11x + 6'), '(x - 3)(2x - 1)(x + 2)');
  assert.equal(f('x^2 - 2', { extension: 'real' }), '(x + \\sqrt{2})(x - \\sqrt{2})');
  assert.equal(f('x^2 + 1', { extension: 'complex' }), '(x + i)(x - i)');
  assert.equal(f('x^2 - y^2'), '(x - y)(x + y)');
  assert.equal(f('a^3 + 8b^3'), '(a + 2b)(a^{2} - 2ab + 4b^{2})');
  assert.equal(f('4x^2 + 12xy + 9y^2'), '(2x + 3y)^{2}');
  const r = factor('x^3 - 7x + 6');
  assert.ok(r.steps.some((s) => /Rational root/.test(s.rule)));
  // The factored form expands back to the input.
  for (const s of ['x^5 - x', '12x^4 - 3x^2', 'x^6 - 64', '3x^3 + 3']) {
    assert.equal(key(expand(factor(s).result)), key(expand(parse(s))), s);
  }
});

test('equivalence testing: symbolic first, then numeric probes', () => {
  assert.deepEqual(equivalent('(x+1)^2', 'x^2 + 2x + 1'), { equal: true, method: 'symbolic' });
  assert.equal(equivalent('1/x + 1/(x+1)', '(2x+1)/(x^2+x)').method, 'symbolic');
  const trig = equivalent('sin(2x)', '2 sin(x) cos(x)');
  assert.equal(trig.equal, true);
  assert.equal(trig.method, 'numeric');
  assert.ok(trig.points >= 10);
  const no = equivalent('sin(x)^2', 'sin(x^2)');
  assert.equal(no.equal, false);
  assert.ok(no.counterexample.difference > 0);
  assert.equal(equivalent('ln(x y)', 'ln(x) + ln(y)', { real: true }).equal, true);
  assert.equal(equivalent('x + y', 'y + x + 0').method, 'symbolic');
});
