import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bisection, newton, secant, brent, gradientDescent, nelderMead, goldenSection, euler, midpoint, rk4, rk45, heat1D, wave1D,
  wave2D, lagrange, newtonDividedDifferences, naturalCubicSpline, catmullRom, gaussKronrod, riemannSum, numericDerivative,
  fourierCoefficients, fourierSeriesExact, dft, fft, epicycles, Complex, SeededRandom, lnGamma, gammaFunction,
  betaFunction, erf, erfc, gammaP, gammaQ, betaI, ellipticK, toLatex,
} from '../../src/math/index.js';

const near = (a, b, tol = 1e-10) => Math.abs(a - b) <= tol * (1 + Math.abs(b));
const rng = new SeededRandom(3);

test('root finders converge and keep their histories', () => {
  const f = (x) => x * x - 2;
  const b = bisection(f, 0, 2);
  assert.ok(b.converged && near(b.root, Math.SQRT2, 1e-11));
  assert.ok(b.history.every((h) => h.a <= h.x && h.x <= h.b));
  assert.ok(b.history[1].b - b.history[1].a < b.history[0].b - b.history[0].a);
  const n = newton(f, 1, { df: (x) => 2 * x });
  assert.ok(n.converged && near(n.root, Math.SQRT2, 1e-14) && n.iterations < 8);
  assert.ok(n.history.every((h) => typeof h.slope === 'number'));
  const s = secant(f, 1, 2);
  assert.ok(s.converged && near(s.root, Math.SQRT2, 1e-12));
  const br = brent(Math.cos, 1, 2);
  assert.ok(br.converged && near(br.root, Math.PI / 2, 1e-13));
  assert.ok(br.history.some((h) => h.method !== 'bisection'));
  assert.equal(bisection(f, 2, 3).converged, false);
  assert.equal(newton((x) => x * x + 1, 0, { df: (x) => 2 * x }).converged, false);
  const hard = brent((x) => x * x * x - 2 * x - 5, 2, 3);
  assert.ok(near(hard.root, 2.0945514815423265, 1e-13));
});

test('optimizers return trajectories that reach the minimum', () => {
  const f = (x, y) => (x - 1) ** 2 + 10 * (y + 2) ** 2;
  const gd = gradientDescent(f, [0, 0], { rate: 0.04, momentum: 0.5, maxIter: 2000 });
  assert.ok(gd.converged);
  assert.ok(near(gd.x[0], 1, 1e-6) && near(gd.x[1], -2, 1e-6));
  assert.ok(gd.trajectory[0].fx > gd.trajectory[gd.trajectory.length - 1].fx);
  const rosen = (x, y) => (1 - x) ** 2 + 100 * (y - x * x) ** 2;
  const nm = nelderMead(rosen, [-1.2, 1]);
  assert.ok(nm.converged && near(nm.x[0], 1, 1e-4) && near(nm.x[1], 1, 1e-4));
  assert.ok(nm.history.some((h) => h.operation === 'expand') && nm.history.some((h) => h.operation.startsWith('contract')));
  const gs = goldenSection((x) => (x - 0.3) ** 2 + 1, -2, 2);
  assert.ok(near(gs.x, 0.3, 1e-8));
  assert.ok(gs.history.length > 10);
});

test('ODE solvers: order of accuracy and adaptivity', () => {
  const f = (t, y) => -2 * t * y;
  const exact = Math.exp(-1);
  const errs = [euler, midpoint, rk4].map((m) => Math.abs(m(f, 1, 0, 1, 20).y[20][0] - exact));
  assert.ok(errs[0] > errs[1] && errs[1] > errs[2]);
  // RK4 error falls roughly 16-fold when the step halves.
  const e1 = Math.abs(rk4(f, 1, 0, 1, 10).y[10][0] - exact);
  const e2 = Math.abs(rk4(f, 1, 0, 1, 20).y[20][0] - exact);
  assert.ok(e1 / e2 > 12 && e1 / e2 < 20);
  const osc = rk45((t, y) => [y[1], -y[0]], [1, 0], 0, 10, { rtol: 1e-10, atol: 1e-12 });
  const last = osc.y[osc.y.length - 1];
  assert.ok(near(last[0], Math.cos(10), 1e-8) && near(last[1], -Math.sin(10), 1e-8));
  assert.equal(osc.t[osc.t.length - 1], 10);
  const stiffish = rk45((t, y) => -50 * (y - Math.cos(t)), 0, 0, 1);
  assert.ok(stiffish.t.length > 10);
});

test('PDE solvers: heat decay, wave periodicity and 2D wave', () => {
  const h = heat1D({ u0: (x) => Math.sin(Math.PI * x), nx: 41, alpha: 1, dt: 0.0005, steps: 200, frameEvery: 50, left: 0, right: 0 });
  const t = h.frames[h.frames.length - 1].t;
  const mid = h.frames[h.frames.length - 1].u[20];
  assert.ok(near(mid, Math.exp(-Math.PI * Math.PI * t), 2e-3));
  const ex = heat1D({ u0: (x) => Math.sin(Math.PI * x), nx: 41, method: 'explicit', steps: 100, left: 0, right: 0 });
  assert.ok(ex.frames.length > 2);
  assert.throws(() => heat1D({ u0: () => 0, nx: 41, dt: 0.01, method: 'explicit' }), /unstable/);
  const neu = heat1D({ u0: (x) => x, nx: 21, boundary: 'neumann', steps: 4000, frameEvery: 4000 });
  const final = neu.frames[neu.frames.length - 1].u;
  assert.ok(Math.max(...final) - Math.min(...final) < 1e-3, 'insulated rod equilibrates');
  // A standing wave returns to its start after one period 2L/c.
  const nx = 101;
  const dx = 1 / (nx - 1);
  const w = wave1D({ u0: (x) => Math.sin(Math.PI * x), nx, c: 1, dt: dx / 2, steps: 400, frameEvery: 400 });
  const back = w.frames[w.frames.length - 1].u;
  assert.ok(Math.abs(back[50] - 1) < 5e-3);
  assert.throws(() => wave1D({ u0: () => 0, dt: 1 }), /Courant/);
  const w2 = wave2D({ u0: (x, y) => Math.sin(Math.PI * x) * Math.sin(Math.PI * y), nx: 21, ny: 21, steps: 20, frameEvery: 10 });
  assert.equal(w2.frames.length, 3);
  assert.ok(w2.frames[1].u.length === 21 * 21);
  assert.ok(w2.latex.includes('nabla'));
});

test('interpolation: Lagrange, Newton, splines and Catmull-Rom', () => {
  const pts = [{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }, { x: 4, y: 5 }];
  const lg = lagrange(pts);
  const nd = newtonDividedDifferences(pts);
  for (const p of pts) assert.ok(near(lg.evaluate(p.x), p.y) && near(nd.evaluate(p.x), p.y));
  for (let k = 0; k < 5; k++) {
    const x = rng.uniform(0, 4);
    assert.ok(near(lg.evaluate(x), nd.evaluate(x), 1e-9));
    assert.ok(near(lg.coefficients.reduceRight((a, c) => a * x + c, 0), lg.evaluate(x), 1e-9));
    assert.ok(near(lg.basis(x).reduce((a, b) => a + b, 0), 1));
  }
  assert.equal(nd.table.length, 4);
  const sp = naturalCubicSpline(pts);
  for (const p of pts) assert.ok(near(sp.evaluate(p.x), p.y));
  // Natural end condition: second derivative zero at both ends.
  assert.ok(Math.abs(sp.segments[0].c) < 1e-12);
  const lastSeg = sp.segments[sp.segments.length - 1];
  const h = lastSeg.x1 - lastSeg.x0;
  assert.ok(Math.abs(2 * lastSeg.c + 6 * lastSeg.d * h) < 1e-10);
  // C1 continuity at interior knots.
  for (let i = 0; i + 1 < sp.segments.length; i++) {
    const s = sp.segments[i];
    const hh = s.x1 - s.x0;
    assert.ok(near(s.b + 2 * s.c * hh + 3 * s.d * hh * hh, sp.segments[i + 1].b, 1e-9));
  }
  const cr = catmullRom(pts);
  assert.equal(cr.length, 3);
  cr.forEach((seg, i) => {
    assert.deepEqual(seg.p0, pts[i]);
    assert.deepEqual(seg.p1, pts[i + 1]);
  });
  const uniform = catmullRom([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], { alpha: 0 });
  assert.ok(near(uniform[0].c1.x, 1 / 3) && near(uniform[0].c2.x, 2 / 3));
  assert.equal(catmullRom(pts, { closed: true }).length, 4);
  assert.throws(() => lagrange([{ x: 1, y: 1 }, { x: 1, y: 2 }]), /distinct/);
});

test('quadrature, Riemann sums and numeric derivatives', () => {
  assert.ok(near(gaussKronrod(Math.sin, 0, Math.PI).value, 2, 1e-13));
  assert.ok(near(gaussKronrod((x) => Math.exp(-x * x), -Infinity, Infinity).value, Math.sqrt(Math.PI), 1e-10));
  assert.ok(near(gaussKronrod((x) => 1 / Math.sqrt(x), 0, 1).value, 2, 1e-7));
  assert.ok(near(gaussKronrod((x) => 1 / (x * x), 1, Infinity).value, 1, 1e-10));
  assert.ok(near(gaussKronrod((x) => x, 1, 0).value, -0.5));
  const f = (x) => x * x;
  const left = riemannSum(f, 0, 1, 4, 'left');
  assert.ok(near(left.value, 0.21875));
  assert.equal(left.shapes.length, 4);
  assert.deepEqual([left.shapes[1].x0, left.shapes[1].x1, left.shapes[1].height], [0.25, 0.5, 0.0625]);
  assert.ok(near(riemannSum(f, 0, 1, 4, 'right').value, 0.46875));
  assert.ok(near(riemannSum(f, 0, 1, 4, 'midpoint').value, 0.328125));
  assert.ok(near(riemannSum(f, 0, 1, 4, 'trapezoid').value, 0.34375));
  const simp = riemannSum((x) => x ** 3, 0, 2, 4, 'simpson');
  assert.ok(near(simp.value, 4));
  assert.equal(simp.shapes[0].curve.length, 17);
  assert.throws(() => riemannSum(f, 0, 1, 3, 'simpson'), /even/);
  assert.ok(near(numericDerivative(Math.exp, 1), Math.E, 1e-10));
  assert.ok(near(numericDerivative(Math.sin, 0.5, { order: 2 }), -Math.sin(0.5), 1e-7));
});

test('Fourier series: numeric coefficients match exact square wave', () => {
  const square = (x) => (x > 0 && x < Math.PI ? 1 : x < 0 && x > -Math.PI ? -1 : 0);
  const num = fourierCoefficients(square, 2 * Math.PI, 7, { start: -Math.PI, breakpoints: [0] });
  const ex = fourierSeriesExact('square', 7);
  ex.terms.forEach((t, i) => {
    const b = ex.evaluate(Math.PI / 2, 7);
    assert.ok(Number.isFinite(b));
    assert.ok(near(num.b[i], t.n % 2 ? 4 / (Math.PI * t.n) : 0, 1e-9));
    assert.ok(Math.abs(num.a[i]) < 1e-9);
  });
  assert.equal(toLatex(ex.terms[0].b), '\\frac{4}{\\pi}');
  assert.equal(ex.generalTerm, '\\sum_{n=1}^{\\infty} \\frac{4\\sin((2n - 1)x)}{(2n - 1)\\pi}');
  const tri = fourierSeriesExact('triangle', 5);
  assert.ok(near(tri.evaluate(0, 5), 8 / Math.PI ** 2 * (1 + 1 / 9 + 1 / 25)));
  const saw = fourierSeriesExact('sawtooth', 50);
  assert.ok(Math.abs(saw.evaluate(1, 50) - 1 / Math.PI) < 0.02);
  const smooth = fourierCoefficients((x) => 1 + Math.cos(2 * x) + 3 * Math.sin(x), 2 * Math.PI, 3);
  assert.ok(near(smooth.a0, 2) && near(smooth.a[1], 1) && near(smooth.b[0], 3));
  assert.ok(near(smooth.evaluate(0.7), 1 + Math.cos(1.4) + 3 * Math.sin(0.7), 1e-9));
});

test('DFT and FFT agree and invert', () => {
  for (const n of [8, 12]) {
    const x = Array.from({ length: n }, () => new Complex(rng.uniform(-1, 1), rng.uniform(-1, 1)));
    const a = dft(x);
    const b = fft(x);
    a.forEach((v, i) => assert.ok(v.equals(b[i], 1e-10)));
    const back = fft(b, true);
    back.forEach((v, i) => assert.ok(v.equals(x[i], 1e-10)));
  }
  const spike = fft([0, 1, 0, 0]);
  assert.ok(spike[1].equals(new Complex(0, -1), 1e-14));
});

test('epicycles reproduce a closed path', () => {
  const pts = [];
  for (let k = 0; k < 64; k++) {
    const t = (2 * Math.PI * k) / 64;
    pts.push({ x: Math.cos(t) + 0.3 * Math.cos(3 * t), y: Math.sin(t) + 0.3 * Math.sin(3 * t) });
  }
  const ep = epicycles(pts, { samples: 256 });
  assert.ok(ep.components[0].amplitude >= ep.components[1].amplitude);
  assert.equal(Math.abs(ep.components[0].freq), 1);
  const chain = ep.evaluate(0);
  const tip = chain[chain.length - 1];
  assert.ok(Math.hypot(tip.x - pts[0].x, tip.y - pts[0].y) < 0.02);
  const few = epicycles(pts, { samples: 256, count: 4 });
  assert.equal(few.components.length, 4);
  assert.equal(few.evaluate(0.25).length, 5);
});

test('special functions against known values', () => {
  assert.ok(near(gammaFunction(5), 24));
  assert.ok(near(gammaFunction(0.5), Math.sqrt(Math.PI), 1e-13));
  assert.ok(near(lnGamma(100), 359.1342053695754, 1e-12));
  assert.ok(near(betaFunction(2, 3), 1 / 12, 1e-13));
  assert.ok(near(erf(1), 0.8427007929497149, 1e-14));
  assert.ok(near(erfc(3), 2.209049699858544e-5, 1e-12));
  assert.ok(near(erf(-0.5), -0.5204998778130465, 1e-14));
  assert.ok(near(gammaP(2, 1) + gammaQ(2, 1), 1));
  assert.ok(near(gammaP(1, 2), 1 - Math.exp(-2), 1e-14));
  assert.ok(near(betaI(0.3, 2, 3), 0.3483, 1e-12));
  assert.ok(near(ellipticK(0), Math.PI / 2));
  assert.ok(near(ellipticK(Math.SQRT1_2), 1.854074677301372, 1e-13));
});
