/**
 * Ordinary differential equation solvers for systems y' = f(t, y):
 * Euler, midpoint, classical Runge-Kutta 4, and adaptive Dormand-Prince 5(4).
 * Each returns the whole trajectory for animation.
 * @module math/ode
 */

/**
 * @typedef {object} Trajectory
 * @property {number[]} t times
 * @property {number[][]} y states (y[k] at t[k])
 * @property {number} [rejected] rejected steps (adaptive solver)
 */

function asVector(y0) {
  return Array.isArray(y0) ? y0.slice() : [y0];
}

function wrap(f, scalar) {
  return scalar ? (t, y) => [f(t, y[0])] : f;
}

function axpy(y, h, k) {
  return y.map((v, i) => v + h * k[i]);
}

function fixedStep(stepFn, f, y0, t0, t1, n) {
  const scalar = !Array.isArray(y0);
  const g = wrap(f, scalar);
  const h = (t1 - t0) / n;
  const ts = [t0];
  const ys = [asVector(y0)];
  let y = ys[0];
  for (let i = 0; i < n; i++) {
    const t = t0 + i * h;
    y = stepFn(g, t, y, h);
    ts.push(t0 + (i + 1) * h);
    ys.push(y);
  }
  return { t: ts, y: ys };
}

/**
 * Forward Euler with n equal steps.
 * @param {(t: number, y: number[]|number) => number[]|number} f
 * @param {number[]|number} y0
 * @param {number} t0
 * @param {number} t1
 * @param {number} n
 * @returns {Trajectory}
 */
export function euler(f, y0, t0, t1, n) {
  return fixedStep((g, t, y, h) => axpy(y, h, g(t, y)), f, y0, t0, t1, n);
}

/**
 * Explicit midpoint method (RK2).
 * @param {(t: number, y: number[]|number) => number[]|number} f
 * @param {number[]|number} y0
 * @param {number} t0
 * @param {number} t1
 * @param {number} n
 * @returns {Trajectory}
 */
export function midpoint(f, y0, t0, t1, n) {
  return fixedStep((g, t, y, h) => {
    const k1 = g(t, y);
    return axpy(y, h, g(t + h / 2, axpy(y, h / 2, k1)));
  }, f, y0, t0, t1, n);
}

/**
 * One classical RK4 step.
 * @param {(t: number, y: number[]) => number[]} g
 * @param {number} t
 * @param {number[]} y
 * @param {number} h
 * @returns {number[]}
 */
export function rk4Step(g, t, y, h) {
  const k1 = g(t, y);
  const k2 = g(t + h / 2, axpy(y, h / 2, k1));
  const k3 = g(t + h / 2, axpy(y, h / 2, k2));
  const k4 = g(t + h, axpy(y, h, k3));
  return y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

/**
 * Classical fourth-order Runge-Kutta.
 * @param {(t: number, y: number[]|number) => number[]|number} f
 * @param {number[]|number} y0
 * @param {number} t0
 * @param {number} t1
 * @param {number} n
 * @returns {Trajectory}
 */
export function rk4(f, y0, t0, t1, n) {
  return fixedStep(rk4Step, f, y0, t0, t1, n);
}

// Dormand-Prince coefficients.
const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const B4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];

/**
 * Adaptive Dormand-Prince RK5(4) with error control.
 * @param {(t: number, y: number[]|number) => number[]|number} f
 * @param {number[]|number} y0
 * @param {number} t0
 * @param {number} t1
 * @param {{rtol?: number, atol?: number, h0?: number, maxSteps?: number}} [opts]
 * @returns {Trajectory}
 */
export function rk45(f, y0, t0, t1, opts = {}) {
  const scalar = !Array.isArray(y0);
  const g = wrap(f, scalar);
  const rtol = opts.rtol ?? 1e-8;
  const atol = opts.atol ?? 1e-10;
  const maxSteps = opts.maxSteps ?? 100000;
  const dir = Math.sign(t1 - t0) || 1;
  let h = opts.h0 ?? (t1 - t0) / 100;
  let t = t0;
  let y = asVector(y0);
  const ts = [t];
  const ys = [y];
  let rejected = 0;
  let k1 = g(t, y);
  for (let step = 0; step < maxSteps && dir * (t1 - t) > 1e-15 * Math.max(1, Math.abs(t1)); step++) {
    if (dir * (t + h - t1) > 0) h = t1 - t;
    const k = [k1];
    for (let s = 1; s < 7; s++) {
      const yi = y.map((v, i) => {
        let acc = v;
        for (let j = 0; j < s; j++) acc += h * A[s][j] * k[j][i];
        return acc;
      });
      k.push(g(t + C[s] * h, yi));
    }
    const y5 = y.map((v, i) => v + h * B5.reduce((acc, b, s) => acc + b * k[s][i], 0));
    const y4 = y.map((v, i) => v + h * B4.reduce((acc, b, s) => acc + b * k[s][i], 0));
    let err = 0;
    for (let i = 0; i < y.length; i++) {
      const sc = atol + rtol * Math.max(Math.abs(y[i]), Math.abs(y5[i]));
      err = Math.max(err, Math.abs(y5[i] - y4[i]) / sc);
    }
    if (err <= 1 || Math.abs(h) < 1e-14) {
      t += h;
      y = y5;
      ts.push(t);
      ys.push(y);
      k1 = k[6];
    } else rejected++;
    const factor = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(err, -0.2)));
    h *= factor;
  }
  return { t: ts, y: ys, rejected };
}
