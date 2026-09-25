/**
 * Probability and statistics: distributions (normal, binomial, Poisson,
 * uniform, exponential, beta, gamma, chi-squared, Student t) with density or
 * mass, cdf, quantile, moments and seeded sampling; central limit theorem
 * sampling data; Bayesian updates; regression (linear, polynomial,
 * exponential, logistic) with R^2; Freedman-Diaconis histograms; and
 * descriptive statistics.
 * @module math/stats
 */
import { SeededRandom } from './random.js';
import { lnGamma, erfc, gammaP, gammaQ, betaI } from './special.js';
import { qrHouseholder } from './linalg.js';

/**
 * @typedef {object} Distribution
 * @property {string} name
 * @property {boolean} discrete
 * @property {Record<string, number>} params
 * @property {(x: number) => number} density pdf for continuous, pmf for discrete
 * @property {(x: number) => number} cdf
 * @property {(p: number) => number} quantile
 * @property {number} mean
 * @property {number} variance
 * @property {[number, number]} support
 * @property {string} latex density formula
 * @property {(count: number, seed?: number|string|SeededRandom) => number[]} sample
 */

function rngOf(seed) {
  return seed instanceof SeededRandom ? seed : new SeededRandom(seed ?? 1);
}

function continuousQuantile(cdf, p, lo, hi, guess) {
  if (p <= 0) return lo;
  if (p >= 1) return hi;
  let a = Number.isFinite(lo) ? lo : Math.min(-1, guess - 10);
  let b = Number.isFinite(hi) ? hi : Math.max(1, guess + 10);
  while (!Number.isFinite(lo) && cdf(a) > p) a = a * 2 - 1;
  while (!Number.isFinite(hi) && cdf(b) < p) b = b * 2 + 1;
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    if (cdf(m) < p) a = m;
    else b = m;
    if (b - a < 1e-14 * Math.max(1, Math.abs(m))) break;
  }
  return (a + b) / 2;
}

function discreteQuantile(cdf, p, start) {
  let k = start;
  while (cdf(k) < p - 1e-15) k++;
  while (k > start && cdf(k - 1) >= p - 1e-15) k--;
  return k;
}

/**
 * Normal distribution.
 * @param {number} [mu=0]
 * @param {number} [sigma=1]
 * @returns {Distribution}
 */
export function normal(mu = 0, sigma = 1) {
  if (!(sigma > 0)) throw new RangeError('sigma must be positive');
  const cdf = (x) => 0.5 * erfc(-(x - mu) / (sigma * Math.SQRT2));
  return {
    name: 'normal', discrete: false, params: { mu, sigma },
    density: (x) => Math.exp(-0.5 * ((x - mu) / sigma) ** 2) / (sigma * Math.sqrt(2 * Math.PI)),
    cdf,
    quantile: (p) => mu + sigma * standardNormalQuantile(p),
    mean: mu, variance: sigma * sigma, support: [-Infinity, Infinity],
    latex: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^{2}}{2\\sigma^{2}}}',
    sample: (count, seed) => {
      const r = rngOf(seed);
      return Array.from({ length: count }, () => r.normal(mu, sigma));
    },
  };
}

// Acklam's rational approximation refined by one Halley step.
function standardNormalQuantile(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  let x;
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p > 1 - 0.02425) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const e = 0.5 * erfc(-x / Math.SQRT2) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

function lnChoose(n, k) {
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
}

/**
 * Binomial distribution.
 * @param {number} n trials
 * @param {number} p success probability
 * @returns {Distribution}
 */
export function binomial(n, p) {
  const pmf = (k) => {
    if (!Number.isInteger(k) || k < 0 || k > n) return 0;
    if (p === 0) return k === 0 ? 1 : 0;
    if (p === 1) return k === n ? 1 : 0;
    return Math.exp(lnChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
  };
  const cdf = (x) => {
    const k = Math.floor(x);
    if (k < 0) return 0;
    if (k >= n) return 1;
    return betaI(1 - p, n - k, k + 1);
  };
  return {
    name: 'binomial', discrete: true, params: { n, p }, density: pmf, cdf,
    quantile: (q) => discreteQuantile(cdf, q, 0),
    mean: n * p, variance: n * p * (1 - p), support: [0, n],
    latex: 'P(X = k) = \\binom{n}{k} p^{k} (1-p)^{n-k}',
    sample: (count, seed) => {
      const r = rngOf(seed);
      return Array.from({ length: count }, () => r.binomial(n, p));
    },
  };
}

/**
 * Poisson distribution.
 * @param {number} lambda
 * @returns {Distribution}
 */
export function poisson(lambda) {
  const pmf = (k) => (Number.isInteger(k) && k >= 0 ? Math.exp(-lambda + k * Math.log(lambda) - lnGamma(k + 1)) : 0);
  const cdf = (x) => (x < 0 ? 0 : gammaQ(Math.floor(x) + 1, lambda));
  return {
    name: 'poisson', discrete: true, params: { lambda }, density: pmf, cdf,
    quantile: (q) => discreteQuantile(cdf, q, 0),
    mean: lambda, variance: lambda, support: [0, Infinity],
    latex: 'P(X = k) = \\frac{\\lambda^{k} e^{-\\lambda}}{k!}',
    sample: (count, seed) => {
      const r = rngOf(seed);
      return Array.from({ length: count }, () => r.poisson(lambda));
    },
  };
}

/**
 * Continuous uniform distribution on [a, b].
 * @param {number} [a=0]
 * @param {number} [b=1]
 * @returns {Distribution}
 */
export function uniform(a = 0, b = 1) {
  return {
    name: 'uniform', discrete: false, params: { a, b },
    density: (x) => (x >= a && x <= b ? 1 / (b - a) : 0),
    cdf: (x) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)),
    quantile: (p) => a + p * (b - a),
    mean: (a + b) / 2, variance: ((b - a) ** 2) / 12, support: [a, b],
    latex: 'f(x) = \\frac{1}{b - a}',
    sample: (count, seed) => {
      const r = rngOf(seed);
      return Array.from({ length: count }, () => r.uniform(a, b));
    },
  };
}

/**
 * Exponential distribution with rate lambda.
 * @param {number} [lambda=1]
 * @returns {Distribution}
 */
export function exponential(lambda = 1) {
  return {
    name: 'exponential', discrete: false, params: { lambda },
    density: (x) => (x < 0 ? 0 : lambda * Math.exp(-lambda * x)),
    cdf: (x) => (x < 0 ? 0 : -Math.expm1(-lambda * x)),
    quantile: (p) => -Math.log1p(-p) / lambda,
    mean: 1 / lambda, variance: 1 / (lambda * lambda), support: [0, Infinity],
    latex: 'f(x) = \\lambda e^{-\\lambda x}',
    sample: (count, seed) => {
      const r = rngOf(seed);
      return Array.from({ length: count }, () => r.exponential(lambda));
    },
  };
}

/**
 * Beta distribution.
 * @param {number} a
 * @param {number} b
 * @returns {Distribution}
 */
export function beta(a, b) {
  const lnB = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const cdf = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : betaI(x, a, b));
  return {
    name: 'beta', discrete: false, params: { a, b },
    density: (x) => (x < 0 || x > 1 ? 0 : Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - lnB)),
    cdf,
    quantile: (p) => continuousQuantile(cdf, p, 0, 1, a / (a + b)),
    mean: a / (a + b), variance: (a * b) / ((a + b) ** 2 * (a + b + 1)), support: [0, 1],
    latex: 'f(x) = \\frac{x^{\\alpha-1}(1-x)^{\\beta-1}}{B(\\alpha, \\beta)}',
    sample: (count, seed) => {
      const r = rngOf(seed);
      return Array.from({ length: count }, () => r.beta(a, b));
    },
  };
}

/**
 * Gamma distribution with shape k and scale theta.
 * @param {number} k
 * @param {number} [theta=1]
 * @returns {Distribution}
 */
export function gammaDist(k, theta = 1) {
  const cdf = (x) => (x <= 0 ? 0 : gammaP(k, x / theta));
  return {
    name: 'gamma', discrete: false, params: { k, theta },
    density: (x) => (x < 0 ? 0 : x === 0 ? (k === 1 ? 1 / theta : k < 1 ? Infinity : 0) : Math.exp((k - 1) * Math.log(x) - x / theta - lnGamma(k) - k * Math.log(theta))),
    cdf,
    quantile: (p) => continuousQuantile(cdf, p, 0, Infinity, k * theta),
    mean: k * theta, variance: k * theta * theta, support: [0, Infinity],
    latex: 'f(x) = \\frac{x^{k-1} e^{-x/\\theta}}{\\Gamma(k)\\theta^{k}}',
    sample: (count, seed) => {
      const r = rngOf(seed);
      return Array.from({ length: count }, () => r.gamma(k, theta));
    },
  };
}

/**
 * Chi-squared distribution with k degrees of freedom.
 * @param {number} k
 * @returns {Distribution}
 */
export function chiSquared(k) {
  const g = gammaDist(k / 2, 2);
  return { ...g, name: 'chi-squared', params: { k }, latex: 'f(x) = \\frac{x^{k/2-1} e^{-x/2}}{2^{k/2}\\Gamma(k/2)}' };
}

/**
 * Student t distribution with nu degrees of freedom.
 * @param {number} nu
 * @returns {Distribution}
 */
export function studentT(nu) {
  const lnC = lnGamma((nu + 1) / 2) - lnGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI);
  const cdf = (t) => {
    const x = nu / (nu + t * t);
    const tail = 0.5 * betaI(x, nu / 2, 0.5);
    return t >= 0 ? 1 - tail : tail;
  };
  return {
    name: 'student-t', discrete: false, params: { nu },
    density: (t) => Math.exp(lnC - ((nu + 1) / 2) * Math.log(1 + (t * t) / nu)),
    cdf,
    quantile: (p) => continuousQuantile(cdf, p, -Infinity, Infinity, 0),
    mean: nu > 1 ? 0 : NaN, variance: nu > 2 ? nu / (nu - 2) : nu > 1 ? Infinity : NaN, support: [-Infinity, Infinity],
    latex: 'f(t) = \\frac{\\Gamma(\\frac{\\nu+1}{2})}{\\sqrt{\\nu\\pi}\\,\\Gamma(\\frac{\\nu}{2})}\\left(1 + \\frac{t^{2}}{\\nu}\\right)^{-\\frac{\\nu+1}{2}}',
    sample: (count, seed) => {
      const r = rngOf(seed);
      return Array.from({ length: count }, () => r.normal() / Math.sqrt(r.gamma(nu / 2, 2) / nu));
    },
  };
}

/**
 * Descriptive statistics (quartiles by linear interpolation between order
 * statistics; variance and sd are sample versions with n - 1).
 * @param {number[]} data
 * @returns {{n: number, mean: number, median: number, modes: number[], variance: number, populationVariance: number, sd: number, min: number, max: number, range: number, q1: number, q3: number, iqr: number, skewness: number, kurtosis: number}}
 */
export function describe(data) {
  const n = data.length;
  if (!n) throw new RangeError('No data');
  const xs = data.slice().sort((a, b) => a - b);
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const q = (p) => {
    const h = (n - 1) * p;
    const lo = Math.floor(h);
    return xs[lo] + (h - lo) * ((xs[Math.min(lo + 1, n - 1)]) - xs[lo]);
  };
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const x of xs) {
    const d = x - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  const popVar = m2 / n;
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) || 0) + 1);
  const top = Math.max(...counts.values());
  return {
    n, mean, median: q(0.5), modes: [...counts.entries()].filter(([, c]) => c === top).map(([x]) => x),
    variance: n > 1 ? m2 / (n - 1) : 0, populationVariance: popVar, sd: n > 1 ? Math.sqrt(m2 / (n - 1)) : 0,
    min: xs[0], max: xs[n - 1], range: xs[n - 1] - xs[0], q1: q(0.25), q3: q(0.75), iqr: q(0.75) - q(0.25),
    skewness: popVar > 0 ? (m3 / n) / popVar ** 1.5 : 0, kurtosis: popVar > 0 ? (m4 / n) / (popVar * popVar) - 3 : 0,
  };
}

/**
 * Histogram with Freedman-Diaconis bin width 2 IQR n^(-1/3) (or a fixed bin count).
 * @param {number[]} data
 * @param {{bins?: number|'fd', range?: [number, number]}} [opts]
 * @returns {{binWidth: number, bins: {x0: number, x1: number, count: number, density: number}[]}}
 */
export function histogram(data, opts = {}) {
  const d = describe(data);
  const lo = opts.range ? opts.range[0] : d.min;
  const hi = opts.range ? opts.range[1] : d.max;
  let count;
  if (typeof opts.bins === 'number') count = opts.bins;
  else {
    const width = (2 * d.iqr) / Math.cbrt(d.n);
    count = width > 0 ? Math.max(1, Math.ceil((hi - lo) / width)) : 1;
  }
  const binWidth = (hi - lo) / count || 1;
  const bins = Array.from({ length: count }, (_, i) => ({ x0: lo + i * binWidth, x1: lo + (i + 1) * binWidth, count: 0, density: 0 }));
  for (const x of data) {
    if (x < lo || x > hi) continue;
    let i = Math.floor((x - lo) / binWidth);
    if (i >= count) i = count - 1;
    bins[i].count++;
  }
  for (const b of bins) b.density = b.count / (data.length * binWidth);
  return { binWidth, bins };
}

/**
 * Central limit theorem demo data: means of `trials` samples of size
 * `sampleSize` from a distribution, with the predicted normal approximation.
 * @param {Distribution} dist
 * @param {number} sampleSize
 * @param {number} trials
 * @param {number|string} [seed=1]
 * @returns {{means: number[], histogram: ReturnType<typeof histogram>, predicted: {mean: number, sd: number}, normal: Distribution}}
 */
export function cltSampleMeans(dist, sampleSize, trials, seed = 1) {
  const r = new SeededRandom(seed);
  const means = [];
  for (let t = 0; t < trials; t++) {
    const s = dist.sample(sampleSize, r);
    means.push(s.reduce((a, b) => a + b, 0) / sampleSize);
  }
  const sd = Math.sqrt(dist.variance / sampleSize);
  return { means, histogram: histogram(means), predicted: { mean: dist.mean, sd }, normal: normal(dist.mean, sd) };
}

/**
 * Conjugate Beta-Binomial update.
 * @param {{alpha: number, beta: number}} prior
 * @param {number} successes
 * @param {number} failures
 * @returns {{prior: Distribution, posterior: Distribution, alpha: number, beta: number, mean: number, credible95: [number, number]}}
 */
export function betaBinomialUpdate(prior, successes, failures) {
  const a = prior.alpha + successes;
  const b = prior.beta + failures;
  const post = beta(a, b);
  return { prior: beta(prior.alpha, prior.beta), posterior: post, alpha: a, beta: b, mean: post.mean, credible95: [post.quantile(0.025), post.quantile(0.975)] };
}

/**
 * Discrete Bayes rule over named hypotheses.
 * @param {Record<string, number>} priors P(H)
 * @param {Record<string, number>} likelihoods P(data | H)
 * @returns {{posterior: Record<string, number>, evidence: number, joint: Record<string, number>}}
 */
export function discreteBayes(priors, likelihoods) {
  const joint = {};
  let evidence = 0;
  for (const h of Object.keys(priors)) {
    joint[h] = priors[h] * (likelihoods[h] ?? 0);
    evidence += joint[h];
  }
  if (!(evidence > 0)) throw new RangeError('The data has zero probability under every hypothesis');
  const posterior = {};
  for (const h of Object.keys(joint)) posterior[h] = joint[h] / evidence;
  return { posterior, evidence, joint };
}

function rSquared(ys, predicted) {
  const mean = ys.reduce((s, y) => s + y, 0) / ys.length;
  let ssRes = 0;
  let ssTot = 0;
  ys.forEach((y, i) => {
    ssRes += (y - predicted[i]) ** 2;
    ssTot += (y - mean) ** 2;
  });
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}

/**
 * Least-squares polynomial fit via Householder QR.
 * @param {number[]} xs
 * @param {number[]} ys
 * @param {number} degree
 * @returns {{coefficients: number[], r2: number, predict: (x: number) => number, latex: string}}
 */
export function polynomialRegression(xs, ys, degree) {
  const m = xs.length;
  if (m <= degree) throw new RangeError('Need more points than the degree');
  const A = xs.map((x) => Array.from({ length: degree + 1 }, (_, k) => x ** k));
  const { Q, R } = qrHouseholder(A);
  const qtb = [];
  for (let k = 0; k <= degree; k++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += Q[i][k] * ys[i];
    qtb.push(s);
  }
  const c = new Array(degree + 1).fill(0);
  for (let k = degree; k >= 0; k--) {
    let s = qtb[k];
    for (let j = k + 1; j <= degree; j++) s -= R[k][j] * c[j];
    c[k] = s / R[k][k];
  }
  const predict = (x) => c.reduceRight((acc, ck) => acc * x + ck, 0);
  const fmt = (v) => String(Number(v.toPrecision(6)));
  const latex = 'y = ' + c.map((ck, k) => ({ ck, k })).reverse().filter(({ ck }) => Math.abs(ck) > 1e-12)
    .map(({ ck, k }, i) => (i === 0 ? (ck < 0 ? '-' : '') : ck < 0 ? ' - ' : ' + ') + fmt(Math.abs(ck)) + (k === 0 ? '' : k === 1 ? 'x' : 'x^{' + k + '}')).join('');
  return { coefficients: c, r2: rSquared(ys, xs.map(predict)), predict, latex };
}

/**
 * Simple linear regression y = a + b x.
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {{slope: number, intercept: number, r2: number, predict: (x: number) => number, latex: string}}
 */
export function linearRegression(xs, ys) {
  const p = polynomialRegression(xs, ys, 1);
  return { slope: p.coefficients[1], intercept: p.coefficients[0], r2: p.r2, predict: p.predict, latex: p.latex };
}

/**
 * Exponential fit y = a e^(b x) by linear regression on ln y (all y > 0);
 * R^2 is reported on the original scale.
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {{a: number, b: number, r2: number, predict: (x: number) => number, latex: string}}
 */
export function exponentialRegression(xs, ys) {
  if (ys.some((y) => !(y > 0))) throw new RangeError('Exponential regression needs positive y values');
  const l = linearRegression(xs, ys.map(Math.log));
  const a = Math.exp(l.intercept);
  const b = l.slope;
  const predict = (x) => a * Math.exp(b * x);
  return { a, b, r2: rSquared(ys, xs.map(predict)), predict, latex: 'y = ' + Number(a.toPrecision(6)) + 'e^{' + Number(b.toPrecision(6)) + 'x}' };
}

/**
 * Logistic regression P(y = 1 | x) = 1 / (1 + e^-(b0 + b.x)) by Newton's
 * method (iteratively reweighted least squares). Reports McFadden's pseudo R^2.
 * @param {Array<number|number[]>} X features (numbers or feature vectors)
 * @param {number[]} y labels 0 or 1
 * @param {{maxIter?: number}} [opts]
 * @returns {{coefficients: number[], pseudoR2: number, iterations: number, predict: (x: number|number[]) => number}}
 */
export function logisticRegression(X, y, opts = {}) {
  const rows = X.map((x) => [1, ...(Array.isArray(x) ? x : [x])]);
  const p = rows[0].length;
  let w = new Array(p).fill(0);
  const sigma = (z) => 1 / (1 + Math.exp(-z));
  let it = 0;
  for (; it < (opts.maxIter ?? 50); it++) {
    const g = new Array(p).fill(0);
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    rows.forEach((r, i) => {
      const mu = sigma(r.reduce((s, v, j) => s + v * w[j], 0));
      const wt = Math.max(mu * (1 - mu), 1e-12);
      for (let j = 0; j < p; j++) {
        g[j] += (y[i] - mu) * r[j];
        for (let k = 0; k < p; k++) H[j][k] += wt * r[j] * r[k];
      }
    });
    for (let j = 0; j < p; j++) H[j][j] += 1e-10;
    const step = solveSmall(H, g);
    w = w.map((v, j) => v + step[j]);
    if (Math.hypot(...step) < 1e-10) break;
  }
  const ll = (weights) => rows.reduce((s, r, i) => {
    const mu = Math.min(1 - 1e-15, Math.max(1e-15, sigma(r.reduce((a, v, j) => a + v * weights[j], 0))));
    return s + (y[i] ? Math.log(mu) : Math.log(1 - mu));
  }, 0);
  const pbar = y.reduce((s, v) => s + v, 0) / y.length;
  const ll0 = y.reduce((s, v) => s + (v ? Math.log(pbar) : Math.log(1 - pbar)), 0);
  const predict = (x) => sigma([1, ...(Array.isArray(x) ? x : [x])].reduce((s, v, j) => s + v * w[j], 0));
  return { coefficients: w, pseudoR2: ll0 === 0 ? 1 : 1 - ll(w) / ll0, iterations: it + 1, predict };
}

function solveSmall(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let pv = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[pv][c])) pv = i;
    [M[c], M[pv]] = [M[pv], M[c]];
    for (let i = c + 1; i < n; i++) {
      const f = M[i][c] / M[c][c];
      for (let j = c; j <= n; j++) M[i][j] -= f * M[c][j];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}
