import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  quantity, convert, parseUnit, describeDimension, dimensionFormula, assertDimension, DimensionError, Quantity, sigFigs,
  decimalPlaces, roundSig, sigFigArithmetic, suvat, springOscillator, pendulum, keplerOrbit, nBody, interference,
  doubleSlit, standingWave, formatValue, recognizeRadical, parse, toLatex, Rational, numericDerivative,
} from '../../src/math/index.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * (1 + Math.abs(b));

test('unit parsing, conversion and dimensional analysis', () => {
  assert.ok(near(convert(100, 'km/h', 'm/s'), 27.77777777777778));
  assert.ok(near(convert(1, 'kW h', 'J'), 3.6e6));
  assert.ok(near(convert(25, 'degC', 'degF'), 77));
  assert.ok(near(convert(300, 'K', 'degC'), 26.85));
  assert.ok(near(convert(1, 'atm', 'kPa'), 101.325));
  assert.ok(near(convert(1, 'mi', 'km'), 1.609344));
  assert.ok(near(convert(2, 'mm^2', 'm^2'), 2e-6));
  assert.ok(near(convert(1, 'eV', 'J'), 1.602176634e-19, 1e-15));
  assert.deepEqual(parseUnit('kg*m/s^2').dim, parseUnit('N').dim);
  assert.deepEqual(parseUnit('J/(mol K)').dim, [2, 1, -2, 0, -1, -1, 0]);
  assert.deepEqual(parseUnit('V').dim, parseUnit('W/A').dim);
  assert.deepEqual(parseUnit('ohm').dim, parseUnit('V/A').dim);
  assert.deepEqual(parseUnit('Ω').dim, parseUnit('ohm').dim);
  assert.deepEqual(parseUnit('Hz').dim, parseUnit('1/s').dim);
  assert.deepEqual(parseUnit('C').dim, parseUnit('A s').dim);
  assert.deepEqual(parseUnit('Pa').dim, parseUnit('N/m2').dim);
  assert.equal(dimensionFormula(parseUnit('N').dim), 'M L T^-2');
  assert.equal(describeDimension(parseUnit('m/s').dim), 'length / time');
  const F = quantity(2, 'kg').mul(quantity(9.81, 'm/s^2'));
  assert.equal(F.unit, 'N');
  assert.ok(near(F.value, 19.62));
  assert.equal(F.toLatex(), '19.62\\,\\mathrm{N}');
  const E = F.mul(quantity(3, 'm'));
  assert.equal(E.unit, 'J');
  assert.ok(near(E.to('kJ').value, 0.05886));
  assert.ok(near(quantity(1, 'm').add(quantity(20, 'cm')).value, 1.2));
  assert.ok(near(quantity(2, 'm').pow(2).si, 4));
  assert.throws(() => quantity(1, 'm').add(quantity(1, 's')), (e) => e instanceof DimensionError && /length and time/.test(e.message));
  assert.throws(() => quantity(1, 'm/s').to('kg'), /Cannot convert m\/s \(length \/ time\) to kg \(mass\)/);
  assert.throws(() => parseUnit('furlong'), /Unknown unit/);
  assert.throws(() => assertDimension(quantity(3, 'J'), 'N'), /Expected/);
  assert.ok(new Quantity(5, [0, 0, 0, 0, 0, 0, 0]).toString().startsWith('5'));
});

test('significant figures', () => {
  assert.deepEqual(['0.00450', '1200', '1200.', '3.0e5', '100.0', '0.0', '7'].map(sigFigs), [3, 2, 4, 2, 4, 1, 1]);
  assert.deepEqual(['12.30', '5', '1.2e-2'].map(decimalPlaces), [2, 0, 3]);
  assert.equal(roundSig(123456, 3), '1.23e+5');
  assert.equal(roundSig(0.0012345, 2), '0.0012');
  assert.equal(roundSig(2.5, 3), '2.50');
  const m = sigFigArithmetic('*', ['2.5', '3.42']);
  assert.equal(m.text, '8.6');
  assert.equal(m.sigFigs, 2);
  const a = sigFigArithmetic('+', ['12.11', '18.0', '1.013']);
  assert.equal(a.text, '31.1');
  assert.match(a.rule, /decimal places/);
  assert.equal(sigFigArithmetic('/', ['10.0', '3']).text, '3');
});

test('suvat solves any three knowns and names the equations', () => {
  const r = suvat({ u: 0, a: 9.8, s: 20 });
  assert.ok(near(r.values.t, Math.sqrt(40 / 9.8)));
  assert.ok(near(r.values.v, Math.sqrt(2 * 9.8 * 20)));
  assert.equal(r.steps[0].latex, 's = ut + \\frac{1}{2}at^{2}');
  const b = suvat({ u: 10, v: 0, t: 2 });
  assert.deepEqual([b.values.a, b.values.s], [-5, 10]);
  const c = suvat({ u: 5, a: -2, s: 4 });
  // Two times reach s = 4 (going up, then coming back); the earlier is chosen.
  assert.ok(near(c.values.t, 1));
  assert.ok(c.steps.some((s) => s.alternatives.length === 1));
  // All five equations hold for the result.
  for (const k of [{ s: 10, u: 1, t: 2 }, { v: 3, a: 1, t: 4 }, { s: 6, v: 4, a: 1 }]) {
    const { s, u, v, a, t } = suvat(k).values;
    assert.ok(near(v, u + a * t) && near(s, u * t + 0.5 * a * t * t) && near(v * v, u * u + 2 * a * s));
  }
  assert.throws(() => suvat({ u: 1, v: 2 }), /three/);
});

test('springs satisfy their differential equation', () => {
  for (const p of [{ m: 1, k: 4, c: 1 }, { m: 2, k: 2, c: 4 }, { m: 1, k: 1, c: 5 }, { m: 1, k: 4, c: 0.5, F0: 1, omega: 1.5 }, { m: 1, k: 4, c: 0, F0: 1, omega: 2 }]) {
    const s = springOscillator({ x0: 1, v0: 0.5, ...p });
    const m = p.m;
    const force = (t) => (p.F0 ? p.F0 * Math.cos(p.omega * t) : 0);
    for (const t of [0.4, 1.3, 2.9]) {
      const v = numericDerivative(s.x, t);
      const acc = numericDerivative(s.x, t, { order: 2 });
      assert.ok(Math.abs(m * acc + p.c * v + p.k * s.x(t) - force(t)) < 1e-5, s.regime + ' at ' + t);
    }
    assert.ok(near(s.x(0), 1, 1e-12));
    assert.ok(near(numericDerivative(s.x, 0), 0.5, 1e-7));
  }
  assert.equal(springOscillator({ k: 4, c: 1 }).regime, 'underdamped');
  assert.equal(springOscillator({ m: 2, k: 2, c: 4 }).regime, 'critically damped');
  assert.equal(springOscillator({ k: 1, c: 5 }).regime, 'overdamped');
  assert.equal(springOscillator({ k: 1 }).sample(1, 4).length, 5);
});

test('pendulum: small-angle and nonlinear agree for small swings; exact period', () => {
  const small = pendulum({ L: 1, theta0: 0.05, steps: 2000 });
  const i = 700;
  assert.ok(Math.abs(small.nonlinear.theta[i] - small.smallAngle.theta(small.nonlinear.t[i])) < 1e-4);
  const big = pendulum({ L: 2, g: 9.81, theta0: 2.5, tEnd: 20, steps: 20000 });
  // Find the first return to the starting angle (a full period).
  const th = big.nonlinear.theta;
  let crossings = 0;
  let period = 0;
  let firstCross = 0;
  for (let k = 1; k < th.length; k++) {
    if (th[k - 1] < 0 && th[k] >= 0) {
      crossings++;
      if (crossings === 2) {
        period = big.nonlinear.t[k] - firstCross;
        break;
      }
      firstCross = big.nonlinear.t[k];
    }
  }
  assert.ok(near(period, big.exactPeriod, 1e-3));
  assert.ok(big.exactPeriod > big.smallAngle.period);
  assert.equal(big.latex, '\\ddot{\\theta} = -\\frac{g}{L}\\sin\\theta');
});

test('Kepler orbits and n-body leapfrog', () => {
  const o = keplerOrbit({ mu: 1, r: [1, 0], v: [0, 1.2] });
  assert.equal(o.type, 'ellipse');
  assert.ok(near(o.e, 0.44, 1e-12) && near(o.a, 1 / (2 - 1.44), 1e-12));
  const p0 = o.positionAt(0);
  const p1 = o.positionAt(o.period);
  assert.ok(near(p0.x, 1) && Math.abs(p0.y) < 1e-12 && near(p1.x, 1, 1e-9));
  // Conservation of energy along the analytic orbit.
  for (const t of [0.7, 3.1, 9.4]) {
    const q = o.positionAt(t);
    const h = 1e-6;
    const q2 = o.positionAt(t + h);
    const q1 = o.positionAt(t - h);
    const v2 = ((q2.x - q1.x) / (2 * h)) ** 2 + ((q2.y - q1.y) / (2 * h)) ** 2;
    assert.ok(near(v2 / 2 - 1 / Math.hypot(q.x, q.y), o.energy, 1e-6));
  }
  assert.equal(o.path(10).length, 11);
  const hyp = keplerOrbit({ mu: 1, r: [1, 0], v: [0, 2] });
  assert.equal(hyp.type, 'hyperbola');
  const hq = hyp.positionAt(1);
  assert.ok(Number.isFinite(hq.x) && Math.hypot(hq.x, hq.y) > 1);
  const nb = nBody({ masses: [1, 1e-3], positions: [[0, 0], [1, 0]], velocities: [[0, 0], [0, 1]], dt: 0.01, steps: 2000, frameEvery: 100 });
  const E0 = nb.energy[0];
  assert.ok(nb.energy.every((e) => Math.abs(e - E0) < 1e-5 * Math.abs(E0)));
  assert.equal(nb.frames.length, 21);
});

test('waves and interference', () => {
  const pat = interference({ sources: [{ x: -0.2, y: 0 }, { x: 0.2, y: 0 }], wavelength: 0.1, nx: 41, ny: 41 });
  // On the perpendicular bisector the waves arrive in phase: intensity 2 A^2.
  const center = pat.intensity[0 * 41 + 20];
  assert.ok(near(center, 2, 1e-9));
  assert.equal(pat.displacement.length, 41 * 41);
  const ds = doubleSlit({ d: 1e-4, wavelength: 5e-7 });
  assert.equal(ds.intensity(0), 1);
  const firstMin = Math.asin(5e-7 / (2 * 1e-4));
  assert.ok(near(ds.minima[0], firstMin));
  assert.ok(ds.intensity(firstMin) < 1e-20);
  const wide = doubleSlit({ d: 1e-4, a: 2e-5, wavelength: 5e-7 });
  assert.ok(wide.intensity(0.004) < ds.intensity(0.004) + 1e-12);
  assert.match(ds.latex, /cos/);
  const sw = standingWave({ L: 2, n: 3, speed: 4 });
  assert.ok(Math.abs(sw.y(2 / 3, 0.37)) < 1e-12);
  assert.ok(near(sw.omega, (3 * Math.PI * 4) / 2));
});

test('formatValue gives interchangeable forms', () => {
  const f = (x, form, o) => formatValue(x, form, o);
  assert.deepEqual([f(0.75, 'fraction').latex, f(0.75, 'fraction').exact], ['\\frac{3}{4}', true]);
  assert.equal(f(Math.PI, 'fraction').exact, false);
  assert.equal(f(Math.PI, 'fraction', { tol: 1e-6, maxDen: 1000 }).latex, '\\frac{355}{113}');
  assert.equal(f(Math.sqrt(3) / 2, 'radical').latex, '\\frac{\\sqrt{3}}{2}');
  assert.equal(f(1 / 3 + Math.sqrt(2) / 5, 'radical').latex, '\\frac{5 + 3\\sqrt{2}}{15}');
  assert.equal(f(Math.PI / 3, 'radical').latex, '\\frac{\\pi}{3}');
  assert.equal(f(Math.E, 'radical').exact, false);
  assert.equal(f(0.1234, 'percent').latex, '12.3\\%');
  assert.equal(f(123456, 'scientific', { digits: 3 }).latex, '1.23 \\times 10^{5}');
  assert.equal(f(2 / 3, 'decimal', { places: 3 }).text, '0.667');
  assert.equal(f('sqrt(8)', 'symbolic').latex, '2\\sqrt{2}');
  assert.equal(f(parse('1/2 + sqrt(5)/2'), 'number').latex, '1.618033989');
  assert.equal(f((1 + Math.sqrt(5)) / 2, 'symbolic').latex, '\\frac{1 + \\sqrt{5}}{2}');
  assert.equal(f(Rational.from('5/8'), 'decimal', { places: 3 }).latex, '0.625');
  assert.equal(toLatex(recognizeRadical(-Math.sqrt(2) / 2)), '-\\frac{\\sqrt{2}}{2}');
  assert.equal(recognizeRadical(Math.log(2)), null);
  assert.throws(() => formatValue(1, 'roman'), /Unknown form/);
});
