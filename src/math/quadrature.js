/**
 * Numeric integration and differentiation: adaptive Gauss-Kronrod (7/15)
 * quadrature with infinite-interval transforms, Riemann sums with the
 * geometry of each rectangle, trapezoid or parabola, and Richardson
 * extrapolated finite differences.
 * @module math/quadrature
 */

const XGK = [
  0.9914553711208126, 0.9491079123427585, 0.8648644233597691,
  0.7415311855993945, 0.5860872354676911, 0.4058451513773972,
  0.20778495500789848, 0,
];
const WGK = [
  0.022935322010529224, 0.06309209262997856, 0.10479001032225019,
  0.14065325971552592, 0.1690047266392679, 0.19035057806478542,
  0.20443294007529889, 0.20948214108472782,
];
const WG = [0.1294849661688697, 0.27970539148927664, 0.3818300505051189, 0.4179591836734694];

function gk15(f, a, b) {
  const c = (a + b) / 2;
  const h = (b - a) / 2;
  const fc = f(c);
  let kron = fc * WGK[7];
  let gauss = fc * WG[3];
  for (let j = 0; j < 7; j++) {
    const dx = h * XGK[j];
    const f1 = f(c - dx);
    const f2 = f(c + dx);
    kron += WGK[j] * (f1 + f2);
    if (j % 2 === 1) gauss += WG[(j - 1) / 2] * (f1 + f2);
  }
  return { value: kron * h, error: Math.abs((kron - gauss) * h) };
}

/**
 * @typedef {object} QuadratureResult
 * @property {number} value
 * @property {number} error estimated absolute error
 * @property {boolean} ok false when the tolerance was not reached or the
 *   integrand produced non-finite values
 * @property {number} evaluations number of integrand evaluations
 * @property {{a: number, b: number, value: number}[]} intervals final subintervals
 * @property {string} method
 */

/**
 * Adaptive Gauss-Kronrod quadrature. Infinite limits are handled by the
 * substitutions x = a + t/(1-t), x = b - (1-t)/t and x = t/(1-t^2).
 * @param {(x: number) => number} f
 * @param {number} a lower limit (may be -Infinity)
 * @param {number} b upper limit (may be Infinity)
 * @param {{tol?: number, maxIntervals?: number}} [opts]
 * @returns {QuadratureResult}
 */
export function gaussKronrod(f, a, b, opts = {}) {
  if (a === b) return { value: 0, error: 0, ok: true, evaluations: 0, intervals: [], method: 'Gauss-Kronrod 7/15' };
  if (a > b) {
    const r = gaussKronrod(f, b, a, opts);
    return { ...r, value: -r.value };
  }
  let g = f;
  let lo = a;
  let hi = b;
  if (!Number.isFinite(a) && !Number.isFinite(b)) {
    g = (t) => {
      const d = 1 - t * t;
      return f(t / d) * (1 + t * t) / (d * d);
    };
    lo = -1;
    hi = 1;
  } else if (!Number.isFinite(b)) {
    g = (t) => f(a + t / (1 - t)) / ((1 - t) * (1 - t));
    lo = 0;
    hi = 1;
  } else if (!Number.isFinite(a)) {
    g = (t) => f(b - (1 - t) / t) / (t * t);
    lo = 0;
    hi = 1;
  }
  const tol = opts.tol ?? 1e-10;
  const maxIntervals = opts.maxIntervals ?? 2000;
  let evaluations = 0;
  const counted = (x) => {
    evaluations++;
    return g(x);
  };
  const first = gk15(counted, lo, hi);
  const intervals = [{ a: lo, b: hi, ...first }];
  let total = first.value;
  let err = first.error;
  let ok = Number.isFinite(total);
  while (ok && err > Math.max(tol, tol * Math.abs(total)) && intervals.length < maxIntervals) {
    let worst = 0;
    for (let i = 1; i < intervals.length; i++) if (intervals[i].error > intervals[worst].error) worst = i;
    const w = intervals[worst];
    const m = (w.a + w.b) / 2;
    if (m <= w.a || m >= w.b) break;
    const left = { a: w.a, b: m, ...gk15(counted, w.a, m) };
    const right = { a: m, b: w.b, ...gk15(counted, m, w.b) };
    intervals.splice(worst, 1, left, right);
    total += left.value + right.value - w.value;
    err += left.error + right.error - w.error;
    if (!Number.isFinite(total)) ok = false;
  }
  total = intervals.reduce((s, iv) => s + iv.value, 0);
  err = intervals.reduce((s, iv) => s + iv.error, 0);
  ok = ok && Number.isFinite(total) && err <= Math.max(tol, tol * Math.abs(total)) * 100;
  return {
    value: total, error: err, ok, evaluations,
    intervals: intervals.map((iv) => ({ a: iv.a, b: iv.b, value: iv.value })), method: 'Gauss-Kronrod 7/15',
  };
}

/**
 * @typedef {object} RiemannShape
 * @property {number} x0 left edge
 * @property {number} x1 right edge
 * @property {number} [height] rectangle height (left, right, midpoint)
 * @property {number} [sampleX] where the height was sampled
 * @property {number} [y0] trapezoid left height
 * @property {number} [y1] trapezoid right height
 * @property {{x: number, y: number}[]} [curve] Simpson parabola samples
 * @property {number} area signed area of this piece
 */

/**
 * Riemann sums and Newton-Cotes rules with per-piece geometry.
 * @param {(x: number) => number} f
 * @param {number} a
 * @param {number} b
 * @param {number} n number of subintervals (even for Simpson)
 * @param {'left'|'right'|'midpoint'|'trapezoid'|'simpson'} [method='midpoint']
 * @returns {{value: number, method: string, shapes: RiemannShape[]}}
 */
export function riemannSum(f, a, b, n, method = 'midpoint') {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a positive integer');
  const h = (b - a) / n;
  const shapes = [];
  let value = 0;
  if (method === 'simpson') {
    if (n % 2 !== 0) throw new RangeError('Simpson rule needs an even n');
    for (let i = 0; i < n; i += 2) {
      const x0 = a + i * h;
      const xm = x0 + h;
      const x1 = x0 + 2 * h;
      const y0 = f(x0);
      const ym = f(xm);
      const y1 = f(x1);
      const area = (h / 3) * (y0 + 4 * ym + y1);
      const curve = [];
      for (let k = 0; k <= 16; k++) {
        const x = x0 + (2 * h * k) / 16;
        // Lagrange parabola through the three points.
        const l0 = ((x - xm) * (x - x1)) / ((x0 - xm) * (x0 - x1));
        const l1 = ((x - x0) * (x - x1)) / ((xm - x0) * (xm - x1));
        const l2 = ((x - x0) * (x - xm)) / ((x1 - x0) * (x1 - xm));
        curve.push({ x, y: y0 * l0 + ym * l1 + y1 * l2 });
      }
      shapes.push({ x0, x1, y0, y1, curve, area });
      value += area;
    }
    return { value, method, shapes };
  }
  for (let i = 0; i < n; i++) {
    const x0 = a + i * h;
    const x1 = x0 + h;
    if (method === 'trapezoid') {
      const y0 = f(x0);
      const y1 = f(x1);
      const area = (h * (y0 + y1)) / 2;
      shapes.push({ x0, x1, y0, y1, area });
      value += area;
      continue;
    }
    const sampleX = method === 'left' ? x0 : method === 'right' ? x1 : (x0 + x1) / 2;
    if (!['left', 'right', 'midpoint'].includes(method)) throw new RangeError('Unknown Riemann method ' + method);
    const height = f(sampleX);
    shapes.push({ x0, x1, height, sampleX, area: height * h });
    value += height * h;
  }
  return { value, method, shapes };
}

/**
 * Numeric derivative by central differences with Richardson extrapolation.
 * @param {(x: number) => number} f
 * @param {number} x
 * @param {{order?: 1|2, h?: number}} [opts]
 * @returns {number}
 */
export function numericDerivative(f, x, opts = {}) {
  const order = opts.order ?? 1;
  let h = opts.h ?? (order === 1 ? 1e-3 : 1e-2) * Math.max(1, Math.abs(x));
  const D = (step) => (order === 1
    ? (f(x + step) - f(x - step)) / (2 * step)
    : (f(x + step) - 2 * f(x) + f(x - step)) / (step * step));
  // Richardson table with step halving.
  const table = [[D(h)]];
  for (let i = 1; i < 6; i++) {
    h /= 2;
    const row = [D(h)];
    for (let j = 1; j <= i; j++) {
      const p = Math.pow(4, j);
      row.push((p * row[j - 1] - table[i - 1][j - 1]) / (p - 1));
    }
    table.push(row);
  }
  const last = table[table.length - 1];
  return last[last.length - 1];
}
