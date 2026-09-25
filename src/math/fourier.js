/**
 * Fourier analysis: numeric Fourier series coefficients of any periodic
 * function, exact coefficients for the square, sawtooth and triangle waves,
 * the DFT and FFT, and epicycle data (frequency components of a closed path
 * sorted by amplitude, with the chain of circle centers at any time).
 * @module math/fourier
 */
import { Complex } from './complex.js';
import { gaussKronrod } from './quadrature.js';
import { num, sym, constant, add, mul, pow, fn, sumNode } from './expr.js';
import { simplify } from './simplify.js';
import { toLatex } from './latex.js';
import { compileReal } from './evaluate.js';

/**
 * @typedef {object} FourierSeries
 * @property {number} a0 constant term is a0 / 2
 * @property {number[]} a cosine coefficients a_1..a_N
 * @property {number[]} b sine coefficients b_1..b_N
 * @property {number} period
 * @property {(x: number, terms?: number) => number} evaluate partial sum
 */

/**
 * Numeric Fourier coefficients over one period [start, start + T]:
 * f(x) ~ a0/2 + sum a_n cos(2 pi n x / T) + b_n sin(2 pi n x / T).
 * @param {(x: number) => number} f
 * @param {number} T period
 * @param {number} N number of harmonics
 * @param {{start?: number, breakpoints?: number[]}} [opts] breakpoints: known jumps, integrated separately
 * @returns {FourierSeries}
 */
export function fourierCoefficients(f, T, N, opts = {}) {
  const start = opts.start ?? 0;
  const cuts = [start, ...(opts.breakpoints || []).filter((p) => p > start && p < start + T).sort((p, q) => p - q), start + T];
  const integ = (g) => {
    let s = 0;
    for (let i = 0; i + 1 < cuts.length; i++) s += gaussKronrod(g, cuts[i], cuts[i + 1], { tol: 1e-11 }).value;
    return s;
  };
  const w = (2 * Math.PI) / T;
  const a0 = (2 / T) * integ(f);
  const a = [];
  const b = [];
  for (let n = 1; n <= N; n++) {
    a.push((2 / T) * integ((x) => f(x) * Math.cos(n * w * x)));
    b.push((2 / T) * integ((x) => f(x) * Math.sin(n * w * x)));
  }
  const evaluate = (x, terms = N) => {
    let s = a0 / 2;
    for (let n = 1; n <= Math.min(terms, N); n++) s += a[n - 1] * Math.cos(n * w * x) + b[n - 1] * Math.sin(n * w * x);
    return s;
  };
  return { a0, a, b, period: T, evaluate };
}

/**
 * Exact Fourier series of standard waves with period 2 pi and amplitude A:
 * square (A on (0, pi), -A on (-pi, 0)), sawtooth (A x / pi on (-pi, pi)),
 * triangle (A (1 - 2|x|/pi)).
 * @param {'square'|'sawtooth'|'triangle'} wave
 * @param {number} N number of harmonics
 * @param {{amplitude?: number|string}} [opts]
 * @returns {{terms: {n: number, a: import('./expr.js').Expr, b: import('./expr.js').Expr}[], generalTerm: string, partialSum: import('./expr.js').Expr, latex: string, evaluate: (x: number, terms?: number) => number}}
 */
export function fourierSeriesExact(wave, N, opts = {}) {
  const A = num(opts.amplitude ?? 1);
  const pi = constant('pi');
  const X = sym('x');
  const terms = [];
  for (let n = 1; n <= N; n++) {
    let a = num(0);
    let b = num(0);
    if (wave === 'square') b = n % 2 ? simplify(mul(num(4), A, pow(mul(num(n), pi), num(-1)))) : num(0);
    else if (wave === 'sawtooth') b = simplify(mul(num(2 * (n % 2 ? 1 : -1)), A, pow(mul(num(n), pi), num(-1))));
    else if (wave === 'triangle') a = n % 2 ? simplify(mul(num(8), A, pow(mul(num(n * n), pow(pi, num(2))), num(-1)))) : num(0);
    else throw new RangeError('Unknown wave ' + wave);
    terms.push({ n, a, b });
  }
  const K = sym('n');
  const odd = add(mul(num(2), K), num(-1));
  const coeff = (c) => simplify(mul(num(c), A));
  const general = {
    square: sumNode(mul(coeff(4), fn('sin', mul(odd, X)), pow(mul(odd, pi), num(-1))), 'n', 1, constant('inf')),
    sawtooth: sumNode(mul(coeff(2), pow(num(-1), add(K, num(1))), fn('sin', mul(K, X)), pow(mul(K, pi), num(-1))), 'n', 1, constant('inf')),
    triangle: sumNode(mul(coeff(8), fn('cos', mul(odd, X)), pow(mul(pow(odd, num(2)), pow(pi, num(2))), num(-1))), 'n', 1, constant('inf')),
  }[wave];
  const pieces = [];
  for (const t of terms) {
    if (!(t.a.type === 'num' && t.a.value.isZero())) pieces.push(mul(t.a, fn('cos', mul(num(t.n), X))));
    if (!(t.b.type === 'num' && t.b.value.isZero())) pieces.push(mul(t.b, fn('sin', mul(num(t.n), X))));
  }
  const partialSum = simplify(add(...pieces));
  const numeric = terms.map((t) => ({ n: t.n, a: evalConst(t.a), b: evalConst(t.b) }));
  const evaluate = (x, count = N) => numeric.slice(0, count).reduce((s, t) => s + t.a * Math.cos(t.n * x) + t.b * Math.sin(t.n * x), 0);
  return { terms, generalTerm: toLatex(general), partialSum, latex: toLatex(partialSum), evaluate };
}

function evalConst(e) {
  return compileReal(e, [])();
}

/**
 * Discrete Fourier transform X_k = sum x_n e^(-2 pi i k n / N) (direct O(N^2)).
 * @param {Array<number|Complex>} x
 * @returns {Complex[]}
 */
export function dft(x) {
  const N = x.length;
  const xs = x.map((v) => Complex.from(v));
  const out = [];
  for (let k = 0; k < N; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < N; n++) {
      const ang = (-2 * Math.PI * k * n) / N;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      re += xs[n].re * c - xs[n].im * s;
      im += xs[n].re * s + xs[n].im * c;
    }
    out.push(new Complex(re, im));
  }
  return out;
}

/**
 * Fast Fourier transform (iterative radix-2; other lengths fall back to the
 * direct DFT). Same convention as dft.
 * @param {Array<number|Complex>} x
 * @param {boolean} [inverse=false] compute the inverse transform (scaled by 1/N)
 * @returns {Complex[]}
 */
export function fft(x, inverse = false) {
  const N = x.length;
  if (N === 0) return [];
  if ((N & (N - 1)) !== 0) {
    if (!inverse) return dft(x);
    const conj = dft(x.map((v) => Complex.from(v).conj()));
    return conj.map((v) => v.conj().div(N));
  }
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  x.forEach((v, i) => {
    const c = Complex.from(v);
    re[i] = c.re;
    im[i] = c.im;
  });
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  const out = [];
  for (let i = 0; i < N; i++) out.push(inverse ? new Complex(re[i] / N, im[i] / N) : new Complex(re[i], im[i]));
  return out;
}

/**
 * @typedef {object} Epicycle
 * @property {number} freq signed frequency (turns per period)
 * @property {number} amplitude circle radius
 * @property {number} phase starting angle (radians)
 */

/**
 * Epicycles for a closed path: the path is resampled uniformly, transformed
 * with the DFT, and the components are sorted by amplitude (largest first).
 * `evaluate(t)` gives the chain of circle centers at t in [0, 1); the last
 * point traces the path.
 * @param {{x: number, y: number}[]} points closed path (last point connects to the first)
 * @param {{count?: number, samples?: number}} [opts] count: number of epicycles kept
 * @returns {{components: Epicycle[], evaluate: (t: number) => {x: number, y: number}[]}}
 */
export function epicycles(points, opts = {}) {
  const samples = opts.samples ?? Math.max(points.length, 256);
  // Resample by arc length.
  const seg = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    seg.push({ a, b, start: total, len });
    total += len;
  }
  const zs = [];
  for (let k = 0; k < samples; k++) {
    const s = (total * k) / samples;
    const sg = seg.find((q) => s <= q.start + q.len) || seg[seg.length - 1];
    const u = sg.len > 0 ? (s - sg.start) / sg.len : 0;
    zs.push(new Complex(sg.a.x + u * (sg.b.x - sg.a.x), sg.a.y + u * (sg.b.y - sg.a.y)));
  }
  const X = fft(zs);
  const comps = X.map((c, k) => {
    const freq = k <= samples / 2 ? k : k - samples;
    const v = c.div(samples);
    return { freq, amplitude: v.abs(), phase: Math.atan2(v.im, v.re) };
  });
  comps.sort((p, q) => q.amplitude - p.amplitude || Math.abs(p.freq) - Math.abs(q.freq));
  const components = comps.slice(0, opts.count ?? comps.length);
  const evaluate = (t) => {
    const chain = [{ x: 0, y: 0 }];
    let x = 0;
    let y = 0;
    for (const c of components) {
      const ang = 2 * Math.PI * c.freq * t + c.phase;
      x += c.amplitude * Math.cos(ang);
      y += c.amplitude * Math.sin(ang);
      chain.push({ x, y });
    }
    return chain;
  };
  return { components, evaluate };
}
