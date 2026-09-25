import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  solve, solveLinearSystem, newtonSystem, parse, compileComplex, Complex, laplace, inverseLaplace, solveODELaplace,
  seriesConvergence, epsilonDelta, apart, together, cancel, toLatex, simplify, key, polyRootsNumeric, compileReal,
} from '../../src/math/index.js';

function checkRoots(eqText, count) {
  const r = solve(eqText);
  assert.ok(r.ok, eqText + ': ' + r.reason);
  const e = parse(eqText);
  const lhs = compileComplex(e.type === 'eq' ? e.args[0] : e, ['x']);
  const rhs = compileComplex(e.type === 'eq' ? e.args[1] : parse('0'), ['x']);
  for (const s of r.solutions) {
    const z = Complex.from(s.value);
    const d = lhs(z).sub(rhs(z)).abs();
    assert.ok(d < 1e-7 * (1 + z.abs()), eqText + ' at ' + s.latex + ' residual ' + d);
  }
  if (count !== undefined) assert.equal(r.solutions.length, count, eqText);
  return r;
}

test('linear and quadratic equations with steps', () => {
  const lin = checkRoots('2x + 3 = 11', 1);
  assert.equal(lin.solutions[0].latex, '4');
  assert.deepEqual(lin.steps.map((s) => s.latex), ['2x + 3 = 11', '2x = 8', 'x = 4']);
  assert.equal(checkRoots('3x - 5 = x + 7', 1).solutions[0].latex, '6');
  const q = checkRoots('x^2 - 5x + 6 = 0', 2);
  assert.deepEqual(q.solutions.map((s) => s.latex), ['2', '3']);
  assert.deepEqual(q.steps.map((s) => s.rule), ['Solve for x', 'Identify the coefficients', 'Quadratic formula', 'Evaluate the discriminant', 'Simplify', 'Two real solutions']);
  assert.equal(q.steps[2].latex, 'x = \\frac{-(-5) \\pm \\sqrt{(-5)^{2} - 4 \\cdot 1 \\cdot 6}}{2 \\cdot 1}');
  const c = checkRoots('x^2 + 2x + 5 = 0', 2);
  assert.deepEqual(c.solutions.map((s) => s.latex), ['-1 - 2i', '-1 + 2i']);
  assert.equal(c.steps[c.steps.length - 1].rule, 'Two complex solutions');
  assert.equal(solve('x^2 + 2x + 5 = 0', 'x', { real: true }).solutions.length, 0);
  assert.equal(checkRoots('x^2 - 6x + 9 = 0', 1).solutions[0].multiplicity, 2);
  assert.deepEqual(checkRoots('x^2 = 2').solutions.map((s) => s.latex), ['-\\sqrt{2}', '\\sqrt{2}']);
  const sym = solve('a x^2 + b x + c = 0');
  assert.equal(sym.solutions.length, 2);
  assert.equal(toLatex(sym.solutions[1].expr), '-\\frac{b - \\sqrt{b^{2} - 4ac}}{2a}');
});

test('polynomials by factoring, binomial roots and numeric Aberth roots', () => {
  const cubic = checkRoots('x^3 - 6x^2 + 11x - 6 = 0', 3);
  assert.ok(cubic.steps.some((s) => s.rule === 'Factor'));
  assert.deepEqual(cubic.solutions.map((s) => s.value).sort(), [1, 2, 3]);
  const quartic = checkRoots('x^4 - 5x^2 + 4 = 0', 4);
  assert.deepEqual(quartic.solutions.map((s) => s.value).sort((a, b) => a - b), [-2, -1, 1, 2]);
  const cube = checkRoots('x^3 - 2 = 0', 3);
  assert.equal(cube.solutions[0].latex, '\\sqrt[3]{2}');
  const quintic = checkRoots('x^5 - x - 1 = 0', 5);
  assert.ok(quintic.solutions.every((s) => s.exact === false));
  const real = quintic.solutions.filter((s) => typeof s.value === 'number');
  assert.equal(real.length, 1);
  assert.ok(Math.abs(real[0].value - 1.1673039782614187) < 1e-10);
  const roots = polyRootsNumeric([-6, 11, -6, 1]).map((z) => z.re);
  assert.deepEqual(roots.map((r) => Math.round(r * 1e9) / 1e9), [1, 2, 3]);
});

test('rational, exponential, log, radical and absolute value equations', () => {
  const rat = checkRoots('1/x + 1/(x-1) = 2', 2);
  assert.ok(rat.steps.some((s) => s.rule === 'Multiply both sides by the common denominator'));
  const hole = checkRoots('(x^2-1)/(x-1) = 0', 1);
  assert.equal(hole.solutions[0].latex, '-1');
  assert.equal(checkRoots('2^x = 8', 1).solutions[0].latex, '3');
  assert.equal(checkRoots('e^(2x) = 5', 1).solutions[0].latex, '\\frac{\\ln(5)}{2}');
  assert.equal(checkRoots('ln(x) = 2', 1).solutions[0].latex, 'e^{2}');
  assert.equal(checkRoots('sqrt(x+1) = 3', 1).solutions[0].latex, '8');
  const none = solve('sqrt(x) = -2');
  assert.equal(none.solutions.length, 0);
  assert.equal(none.identity, 'none');
  const sub = checkRoots('e^(2x) - 3e^x + 2 = 0', 2);
  assert.ok(sub.steps.some((s) => /Substitute u = e\^\{x\}/.test(s.rule)));
  assert.deepEqual(checkRoots('ln(x) + ln(x-1) = ln(6)').solutions.map((s) => s.latex), ['3']);
  assert.deepEqual(checkRoots('|x - 3| = 5', 2).solutions.map((s) => s.latex), ['-2', '8']);
  assert.equal(solve('3 = 3').identity, 'all');
  assert.equal(solve('x + 1 = x').identity, 'none');
});

test('trig equations return the general solution', () => {
  const s = solve('sin(x) = 1/2');
  assert.equal(s.parameter, 'k');
  assert.deepEqual(s.general.map(toLatex), ['2\\pi k + \\frac{\\pi}{6}', '2\\pi k + \\frac{5\\pi}{6}']);
  assert.deepEqual(s.solutions.map((x) => x.latex), ['\\frac{\\pi}{6}', '\\frac{5\\pi}{6}']);
  assert.deepEqual(solve('sin(x) = 1').general.map(toLatex), ['2\\pi k + \\frac{\\pi}{2}']);
  assert.deepEqual(solve('tan(x) = 1').general.map(toLatex), ['\\pi k + \\frac{\\pi}{4}']);
  const c = solve('cos(2x) = 0');
  assert.deepEqual(c.general.map(toLatex), ['\\pi k + \\frac{\\pi}{4}', '\\pi k - \\frac{\\pi}{4}']);
  // Every member of each family satisfies the equation.
  const f = compileReal('sin(x) - 1/2', ['x']);
  for (const g of s.general) {
    for (const k of [-2, 0, 3]) {
      const x = compileReal(g, ['k'])(k);
      assert.ok(Math.abs(f(x)) < 1e-12);
    }
  }
  assert.equal(solve('sin(x) = 2').solutions.length, 0);
});

test('numeric fallback for transcendental equations', () => {
  const r = solve('x = cos(x)');
  assert.equal(r.solutions.length, 1);
  assert.equal(r.solutions[0].exact, false);
  assert.ok(Math.abs(r.solutions[0].value - 0.7390851332151607) < 1e-10);
});

test('systems: Gaussian elimination and Newton', () => {
  const s = solveLinearSystem(['x + y + z = 6', '2x - y + z = 3', 'x + 2y - z = 2'], ['x', 'y', 'z']);
  assert.equal(s.kind, 'unique');
  assert.deepEqual(Object.values(s.solution).map(toLatex), ['1', '2', '3']);
  assert.equal(s.steps[0].rule, 'Start');
  assert.ok(s.steps.some((st) => st.rule === 'Subtract 2 R1 from R2'));
  const inf = solveLinearSystem(['x + y = 2', '2x + 2y = 4'], ['x', 'y']);
  assert.equal(inf.kind, 'infinite');
  assert.equal(toLatex(inf.parametric.x), '2 - t_{1}');
  assert.equal(solveLinearSystem(['x + y = 1', 'x + y = 2'], ['x', 'y']).kind, 'none');
  assert.equal(solveLinearSystem(['x y = 1'], ['x', 'y']).ok, false);
  const n = newtonSystem(['x^2 + y^2 = 4', 'x*y = 1'], ['x', 'y'], [2, 0.5]);
  assert.ok(n.ok);
  const [x, y] = n.solution;
  assert.ok(Math.abs(x * x + y * y - 4) < 1e-12 && Math.abs(x * y - 1) < 1e-12);
  assert.ok(n.history.length >= 3 && n.history[n.history.length - 1].residual < 1e-12);
});

test('rational function tools: apart, together, cancel', () => {
  const p = apart('(3x+5)/((x-1)^2 (x+2))');
  assert.deepEqual(p.steps.map((s) => s.rule), ['Start', 'Set up partial fractions', 'Solve for the coefficients', 'Partial fraction decomposition']);
  assert.equal(p.steps[2].latex, 'A = \\frac{1}{9},\\quad B = \\frac{8}{3},\\quad C = -\\frac{1}{9}');
  assert.equal(key(simplify(together(p.result))), key(simplify(parse('(3x+5)/((x-1)^2 (x+2))'))));
  assert.equal(toLatex(apart('(x^3+1)/(x^2-1)').result), 'x + \\frac{1}{x - 1}');
  assert.ok(apart('1/(x^2 - 1)').steps.some((s) => s.rule === 'Factor the denominator'));
  assert.equal(toLatex(cancel('(x^2-4)/(x^2+x-6)')), '\\frac{x + 2}{x + 3}');
  assert.equal(toLatex(together('a/b + c/d')), '\\frac{ad + bc}{bd}');
  assert.equal(apart('sin(x)/x').ok, false);
});

test('Laplace transforms, inverses and an ODE solved by transform', () => {
  const L = (s) => laplace(s).latex;
  assert.equal(L('t^3'), '\\frac{6}{s^{4}}');
  assert.equal(L('e^(2t)'), '\\frac{1}{s - 2}');
  assert.equal(L('sin(3t)'), '\\frac{3}{s^{2} + 9}');
  assert.equal(L('3t^2 + 2e^(-t)'), '\\frac{6}{s^{3}} + \\frac{2}{s + 1}');
  assert.equal(L('t e^(t)'), '\\frac{1}{(s - 1)^{2}}');
  assert.equal(L('t sin(t)'), '\\frac{2s}{(s^{2} + 1)^{2}}');
  assert.ok(laplace('e^(-t) sin(2t)').steps.some((s) => s.rule === 'First shifting theorem'));
  assert.equal(laplace('tan(t)').ok, false);
  const I = (s) => inverseLaplace(s).latex;
  assert.equal(I('1/((s+1)(s+2))'), 'e^{-t} - e^{-2t}');
  assert.equal(I('1/(s^2+2s+5)'), '\\frac{e^{-t}\\sin(2t)}{2}');
  assert.equal(I('2/(s-1)^3'), 't^{2}e^{t}');
  assert.equal(I('(s+1)/(s^2+4)'), '\\cos(2t) + \\frac{\\sin(2t)}{2}');
  // Round trip.
  for (const f of ['e^(3t) - t', 'cos(2t) + 4', 't^2 e^(-t)']) {
    const back = inverseLaplace(laplace(f).result);
    const g = compileReal(parse(f), ['t']);
    const h = compileReal(back.result, ['t']);
    for (const t of [0.3, 1.1, 2.5]) assert.ok(Math.abs(g(t) - h(t)) < 1e-9, f);
  }
  const ode = solveODELaplace('diff(y, t, 2) + 3 diff(y, t) + 2y = 0', { initial: [1, 0] });
  assert.equal(ode.latex, '2e^{-t} - e^{-2t}');
  assert.ok(ode.steps.some((s) => s.rule === 'Take the Laplace transform of both sides'));
  assert.equal(solveODELaplace('diff(y, t) + y = e^(-t)', { initial: [0] }).latex, 'te^{-t}');
});

test('series convergence tests and epsilon-delta', () => {
  const v = (t, start = 1) => seriesConvergence(t, 'n', start);
  assert.equal(v('1/n^2').verdict, 'converges');
  assert.equal(v('1/n').verdict, 'diverges');
  assert.equal(v('1/n!').decidedBy, 'Ratio test');
  assert.equal(v('1/n!').verdict, 'converges');
  assert.equal(v('(-1)^n/n').decidedBy, 'Alternating series test');
  assert.equal(v('n/(n+1)').decidedBy, 'Divergence test');
  assert.equal(v('1/(n ln(n))', 2).verdict, 'diverges');
  assert.equal(v('n^2/2^n').verdict, 'converges');
  const lc = v('1/sqrt(n^3 + 1)').tests.find((t) => t.name === 'Limit comparison test');
  assert.equal(lc.result, 'converges');
  const ps = v('1/2^n').partialSums;
  assert.ok(Math.abs(ps[ps.length - 1].sum - 1) < 1e-8);
  const d = epsilonDelta('2x + 1', 1, 3, 0.1);
  assert.ok(Math.abs(d.delta - 0.0495) < 1e-6);
  assert.ok(d.worst.gap < 0.1);
  const d2 = epsilonDelta((x) => x * x, 2, 4, 0.01);
  assert.ok(d2.delta > 0 && d2.delta < 0.0025);
});
