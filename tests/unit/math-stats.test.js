import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SeededRandom, normal, binomialDistribution, poisson, uniform, exponential, betaDistribution, gammaDist, chiSquared,
  studentT, describe, histogram, cltSampleMeans, betaBinomialUpdate, discreteBayes, polynomialRegression,
  linearRegression, exponentialRegression, logisticRegression, markovChain, gaussKronrod,
} from '../../src/math/index.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * (1 + Math.abs(b));

test('seeded generator is deterministic and uniform', () => {
  const a = new SeededRandom(42);
  const b = new SeededRandom(42);
  const c = new SeededRandom('other');
  const xs = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b.next()));
  assert.notDeepEqual(xs, Array.from({ length: 5 }, () => c.next()));
  const r = new SeededRandom(1);
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) counts[Math.floor(r.next() * 10)]++;
  const chi2 = counts.reduce((s, k) => s + (k - 2000) ** 2 / 2000, 0);
  assert.ok(chi2 < 27.88, 'chi-squared ' + chi2);
  const ints = new Set(Array.from({ length: 200 }, () => r.int(1, 6)));
  assert.deepEqual([...ints].sort(), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(r.shuffle([1, 2, 3, 4]).sort(), [1, 2, 3, 4]);
});

test('continuous distributions: cdf is the integral of the pdf and quantile inverts cdf', () => {
  const dists = [normal(1, 2), uniform(-1, 3), exponential(0.5), betaDistribution(2, 5), gammaDist(2.5, 1.5), chiSquared(4), studentT(5)];
  for (const d of dists) {
    for (const x of [0.3, 0.9, 1.7]) {
      const lo = Number.isFinite(d.support[0]) ? d.support[0] : -60;
      const hiX = Math.min(x, d.support[1]);
      if (hiX <= lo) continue;
      const q = gaussKronrod(d.density, lo, hiX, { tol: 1e-12 });
      assert.ok(near(q.value, d.cdf(hiX), 1e-8), d.name + ' cdf at ' + x);
    }
    for (const p of [0.05, 0.5, 0.9]) assert.ok(near(d.cdf(d.quantile(p)), p, 1e-9), d.name + ' quantile ' + p);
    const total = gaussKronrod(d.density, Number.isFinite(d.support[0]) ? d.support[0] : -Infinity, Number.isFinite(d.support[1]) ? d.support[1] : Infinity, { tol: 1e-11 });
    assert.ok(near(total.value, 1, 1e-7), d.name + ' integrates to 1');
    assert.equal(typeof d.latex, 'string');
  }
  assert.ok(near(normal().quantile(0.975), 1.959963984540054, 1e-12));
  assert.ok(near(studentT(10).quantile(0.975), 2.228138851986273, 1e-9));
  assert.ok(near(chiSquared(3).quantile(0.95), 7.814727903251178, 1e-9));
});

test('discrete distributions: pmf sums to the cdf', () => {
  for (const d of [binomialDistribution(12, 0.35), poisson(3.5)]) {
    let s = 0;
    for (let k = 0; k <= 15; k++) {
      s += d.density(k);
      assert.ok(near(s, d.cdf(k), 1e-12), d.name + ' at ' + k);
    }
    assert.equal(d.density(2.5), 0);
    const m = d.quantile(0.5);
    assert.ok(d.cdf(m) >= 0.5 && d.cdf(m - 1) < 0.5);
  }
  assert.ok(near(binomialDistribution(10, 0.3).density(3), 0.266827932, 1e-8));
  assert.equal(binomialDistribution(5, 0).density(0), 1);
});

test('sampling reproduces means and variances', () => {
  for (const d of [normal(2, 3), exponential(2), binomialDistribution(40, 0.25), binomialDistribution(2000, 0.3), poisson(4), poisson(80), betaDistribution(2, 3), gammaDist(3, 2), uniform(0, 10), studentT(8)]) {
    const xs = d.sample(40000, 11);
    const st = describe(xs);
    const se = Math.sqrt(d.variance / xs.length);
    assert.ok(Math.abs(st.mean - d.mean) < 5 * se, d.name + ' mean ' + st.mean + ' vs ' + d.mean);
    assert.ok(Math.abs(st.variance / d.variance - 1) < 0.06, d.name + ' variance ' + st.variance + ' vs ' + d.variance);
  }
  assert.deepEqual(normal().sample(3, 5), normal().sample(3, 5));
});

test('descriptive statistics and Freedman-Diaconis histograms', () => {
  const s = describe([1, 2, 3, 4, 100]);
  assert.equal(s.mean, 22);
  assert.equal(s.median, 3);
  assert.equal(s.q1, 2);
  assert.equal(s.iqr, 2);
  assert.ok(near(s.variance, 1902.5));
  assert.ok(s.skewness > 1);
  assert.deepEqual(describe([2, 2, 3]).modes, [2]);
  const data = normal(0, 1).sample(1000, 3);
  const h = histogram(data);
  const st = describe(data);
  assert.ok(near(h.binWidth, (2 * st.iqr) / Math.cbrt(1000), 0.2));
  assert.equal(h.bins.reduce((a, b) => a + b.count, 0), 1000);
  assert.ok(near(h.bins.reduce((a, b) => a + b.density * h.binWidth, 0), 1, 1e-12));
  assert.equal(histogram([1, 2, 3], { bins: 3 }).bins.map((b) => b.count).join(), '1,1,1');
  assert.throws(() => describe([]), /No data/);
});

test('central limit theorem sample means', () => {
  const c = cltSampleMeans(exponential(1), 30, 3000, 9);
  const st = describe(c.means);
  assert.ok(Math.abs(st.mean - 1) < 0.02);
  assert.ok(Math.abs(st.sd / c.predicted.sd - 1) < 0.06);
  assert.ok(Math.abs(st.skewness) < 0.6, 'means are much less skewed than the exponential');
  assert.equal(c.normal.name, 'normal');
});

test('Bayesian updates', () => {
  const u = betaBinomialUpdate({ alpha: 1, beta: 1 }, 7, 3);
  assert.equal(u.alpha, 8);
  assert.equal(u.beta, 4);
  assert.ok(near(u.mean, 8 / 12));
  assert.ok(u.credible95[0] < u.mean && u.mean < u.credible95[1]);
  const d = discreteBayes({ fair: 0.5, biased: 0.5 }, { fair: 0.5 ** 5, biased: 0.9 ** 5 });
  assert.ok(near(d.posterior.fair + d.posterior.biased, 1));
  assert.ok(d.posterior.biased > 0.8);
  assert.throws(() => discreteBayes({ a: 1 }, { a: 0 }), /zero probability/);
});

test('regressions recover known models', () => {
  const xs = [0, 1, 2, 3, 4, 5];
  const lin = linearRegression(xs, xs.map((x) => 2 * x + 1));
  assert.ok(near(lin.slope, 2) && near(lin.intercept, 1) && near(lin.r2, 1));
  assert.equal(lin.latex, 'y = 2x + 1');
  const quad = polynomialRegression(xs, xs.map((x) => x * x - 3 * x + 2), 2);
  assert.ok(near(quad.coefficients[2], 1) && near(quad.coefficients[1], -3) && near(quad.coefficients[0], 2));
  const ex = exponentialRegression(xs, xs.map((x) => 3 * Math.exp(0.5 * x)));
  assert.ok(near(ex.a, 3) && near(ex.b, 0.5) && near(ex.r2, 1));
  assert.throws(() => exponentialRegression([1, 2], [1, -1]), /positive/);
  const noisy = linearRegression([1, 2, 3, 4], [2, 4.1, 5.9, 8.2]);
  assert.ok(noisy.r2 > 0.99 && noisy.r2 < 1);
  const rng = new SeededRandom(4);
  const X = [];
  const y = [];
  for (let i = 0; i < 3000; i++) {
    const x = rng.uniform(-4, 4);
    X.push(x);
    y.push(rng.next() < 1 / (1 + Math.exp(-(0.5 + 1.5 * x))) ? 1 : 0);
  }
  const lg = logisticRegression(X, y);
  assert.ok(Math.abs(lg.coefficients[0] - 0.5) < 0.2 && Math.abs(lg.coefficients[1] - 1.5) < 0.2);
  assert.ok(lg.pseudoR2 > 0.3 && lg.pseudoR2 < 1);
  assert.ok(lg.predict(10) > 0.99);
});

test('Markov chains: stationary distribution, evolution and absorption', () => {
  const c = markovChain([['1/2', '1/2'], ['1/4', '3/4']], ['A', 'B']);
  const st = c.stationary();
  assert.deepEqual(st.distribution.map(String), ['1/3', '2/3']);
  const ev = c.evolve([1, 0], 60);
  assert.ok(near(ev.final[0], 1 / 3, 1e-12));
  assert.equal(ev.history.length, 61);
  const walk = markovChain([[1, 0, 0, 0], ['1/2', 0, '1/2', 0], [0, '1/2', 0, '1/2'], [0, 0, 0, 1]]);
  const ab = walk.absorption();
  assert.deepEqual(ab.absorbing, ['S1', 'S4']);
  assert.deepEqual(ab.exact.map((r) => r.map(String)), [['2/3', '1/3'], ['1/3', '2/3']]);
  assert.deepEqual(ab.expectedSteps, [2, 2]);
  assert.throws(() => markovChain([[0.5, 0.4], [0, 1]]), /sum to 1/);
  assert.throws(() => c.absorption(), /no absorbing/);
});
