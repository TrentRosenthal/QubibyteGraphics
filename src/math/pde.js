/**
 * Finite-difference solvers that return animation frames: the 1D heat
 * equation (Crank-Nicolson or explicit FTCS), the 1D wave equation and the
 * 2D wave equation on a rectangular grid (leapfrog), with Dirichlet or
 * Neumann boundaries.
 * @module math/pde
 */

function sampleInitial(u0, xs) {
  return typeof u0 === 'function' ? xs.map((x) => u0(x)) : u0.slice();
}

// Thomas algorithm for tridiagonal systems (a: sub, b: diag, c: super).
function tridiagonal(a, b, c, d) {
  const n = b.length;
  const cp = new Array(n);
  const dp = new Array(n);
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / m;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }
  const x = new Array(n);
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

/**
 * @typedef {object} Frames1D
 * @property {number[]} x grid points
 * @property {{t: number, u: number[]}[]} frames
 * @property {string} method
 * @property {string} latex governing equation
 */

/**
 * 1D heat equation u_t = alpha u_xx on [0, L].
 * @param {{u0: ((x: number) => number)|number[], L?: number, nx?: number, alpha?: number, dt?: number, steps?: number,
 *   frameEvery?: number, boundary?: 'dirichlet'|'neumann', left?: number, right?: number, method?: 'crank-nicolson'|'explicit'}} opts
 * @returns {Frames1D}
 */
export function heat1D(opts) {
  const L = opts.L ?? 1;
  const nx = opts.nx ?? 51;
  const alpha = opts.alpha ?? 1;
  const dx = L / (nx - 1);
  const dt = opts.dt ?? (0.4 * dx * dx) / alpha;
  const steps = opts.steps ?? 200;
  const every = opts.frameEvery ?? 10;
  const method = opts.method ?? 'crank-nicolson';
  const neumann = opts.boundary === 'neumann';
  const xs = Array.from({ length: nx }, (_, i) => i * dx);
  let u = sampleInitial(opts.u0, xs);
  const left = opts.left ?? u[0];
  const right = opts.right ?? u[nx - 1];
  const r = (alpha * dt) / (dx * dx);
  if (method === 'explicit' && r > 0.5) throw new RangeError('Explicit scheme unstable: alpha dt / dx^2 = ' + r.toFixed(3) + ' > 1/2');
  const frames = [{ t: 0, u: u.slice() }];
  const applyBc = (v) => {
    if (neumann) {
      v[0] = v[1];
      v[nx - 1] = v[nx - 2];
    } else {
      v[0] = left;
      v[nx - 1] = right;
    }
  };
  applyBc(u);
  for (let s = 1; s <= steps; s++) {
    if (method === 'explicit') {
      const next = u.slice();
      for (let i = 1; i < nx - 1; i++) next[i] = u[i] + r * (u[i + 1] - 2 * u[i] + u[i - 1]);
      applyBc(next);
      u = next;
    } else {
      const a = new Array(nx).fill(-r / 2);
      const b = new Array(nx).fill(1 + r);
      const c = new Array(nx).fill(-r / 2);
      const d = new Array(nx);
      for (let i = 1; i < nx - 1; i++) d[i] = (r / 2) * u[i - 1] + (1 - r) * u[i] + (r / 2) * u[i + 1];
      if (neumann) {
        b[0] = 1;
        c[0] = -1;
        d[0] = 0;
        a[nx - 1] = -1;
        b[nx - 1] = 1;
        d[nx - 1] = 0;
      } else {
        b[0] = 1;
        c[0] = 0;
        d[0] = left;
        a[nx - 1] = 0;
        b[nx - 1] = 1;
        d[nx - 1] = right;
      }
      a[0] = 0;
      c[nx - 1] = 0;
      u = tridiagonal(a, b, c, d);
    }
    if (s % every === 0 || s === steps) frames.push({ t: s * dt, u: u.slice() });
  }
  return { x: xs, frames, method, latex: '\\frac{\\partial u}{\\partial t} = \\alpha \\frac{\\partial^{2} u}{\\partial x^{2}}' };
}

/**
 * 1D wave equation u_tt = c^2 u_xx on [0, L] with fixed or free ends
 * (leapfrog; requires c dt / dx <= 1).
 * @param {{u0: ((x: number) => number)|number[], v0?: ((x: number) => number)|number[], L?: number, nx?: number, c?: number,
 *   dt?: number, steps?: number, frameEvery?: number, boundary?: 'dirichlet'|'neumann'}} opts
 * @returns {Frames1D}
 */
export function wave1D(opts) {
  const L = opts.L ?? 1;
  const nx = opts.nx ?? 101;
  const c = opts.c ?? 1;
  const dx = L / (nx - 1);
  const dt = opts.dt ?? (0.9 * dx) / c;
  const steps = opts.steps ?? 200;
  const every = opts.frameEvery ?? 5;
  const courant = (c * dt) / dx;
  if (courant > 1) throw new RangeError('Leapfrog unstable: Courant number ' + courant.toFixed(3) + ' > 1');
  const xs = Array.from({ length: nx }, (_, i) => i * dx);
  const u0 = sampleInitial(opts.u0, xs);
  const v0 = opts.v0 ? sampleInitial(opts.v0, xs) : new Array(nx).fill(0);
  const r2 = courant * courant;
  const neumann = opts.boundary === 'neumann';
  const bc = (v) => {
    if (neumann) {
      v[0] = v[1];
      v[nx - 1] = v[nx - 2];
    } else {
      v[0] = 0;
      v[nx - 1] = 0;
    }
  };
  let prev = u0.slice();
  let cur = u0.slice();
  for (let i = 1; i < nx - 1; i++) cur[i] = u0[i] + dt * v0[i] + 0.5 * r2 * (u0[i + 1] - 2 * u0[i] + u0[i - 1]);
  bc(cur);
  const frames = [{ t: 0, u: u0.slice() }];
  if (every === 1) frames.push({ t: dt, u: cur.slice() });
  for (let s = 2; s <= steps; s++) {
    const next = new Array(nx);
    for (let i = 1; i < nx - 1; i++) next[i] = 2 * cur[i] - prev[i] + r2 * (cur[i + 1] - 2 * cur[i] + cur[i - 1]);
    bc(next);
    prev = cur;
    cur = next;
    if (s % every === 0 || s === steps) frames.push({ t: s * dt, u: cur.slice() });
  }
  return { x: xs, frames, method: 'leapfrog', latex: '\\frac{\\partial^{2} u}{\\partial t^{2}} = c^{2} \\frac{\\partial^{2} u}{\\partial x^{2}}' };
}

/**
 * 2D wave equation u_tt = c^2 (u_xx + u_yy) on [0, Lx] x [0, Ly] with fixed
 * edges (leapfrog; requires c dt sqrt(1/dx^2 + 1/dy^2) <= 1).
 * @param {{u0: (x: number, y: number) => number, v0?: (x: number, y: number) => number, Lx?: number, Ly?: number,
 *   nx?: number, ny?: number, c?: number, dt?: number, steps?: number, frameEvery?: number}} opts
 * @returns {{x: number[], y: number[], frames: {t: number, u: Float64Array}[], latex: string}}
 */
export function wave2D(opts) {
  const Lx = opts.Lx ?? 1;
  const Ly = opts.Ly ?? 1;
  const nx = opts.nx ?? 41;
  const ny = opts.ny ?? 41;
  const c = opts.c ?? 1;
  const dx = Lx / (nx - 1);
  const dy = Ly / (ny - 1);
  const limit = 1 / (c * Math.sqrt(1 / (dx * dx) + 1 / (dy * dy)));
  const dt = opts.dt ?? 0.9 * limit;
  if (dt > limit * (1 + 1e-12)) throw new RangeError('Leapfrog unstable: dt exceeds the CFL limit ' + limit.toExponential(3));
  const steps = opts.steps ?? 100;
  const every = opts.frameEvery ?? 5;
  const xs = Array.from({ length: nx }, (_, i) => i * dx);
  const ys = Array.from({ length: ny }, (_, j) => j * dy);
  const idx = (i, j) => j * nx + i;
  const u0 = new Float64Array(nx * ny);
  const v0 = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
      u0[idx(i, j)] = edge ? 0 : opts.u0(xs[i], ys[j]);
      v0[idx(i, j)] = edge || !opts.v0 ? 0 : opts.v0(xs[i], ys[j]);
    }
  }
  const rx = (c * dt / dx) ** 2;
  const ry = (c * dt / dy) ** 2;
  const lap = (u, i, j) => rx * (u[idx(i + 1, j)] - 2 * u[idx(i, j)] + u[idx(i - 1, j)]) + ry * (u[idx(i, j + 1)] - 2 * u[idx(i, j)] + u[idx(i, j - 1)]);
  let prev = u0;
  let cur = new Float64Array(nx * ny);
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) cur[idx(i, j)] = u0[idx(i, j)] + dt * v0[idx(i, j)] + 0.5 * lap(u0, i, j);
  const frames = [{ t: 0, u: u0.slice() }];
  for (let s = 2; s <= steps; s++) {
    const next = new Float64Array(nx * ny);
    for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) next[idx(i, j)] = 2 * cur[idx(i, j)] - prev[idx(i, j)] + lap(cur, i, j);
    prev = cur;
    cur = next;
    if (s % every === 0 || s === steps) frames.push({ t: s * dt, u: cur.slice() });
  }
  return { x: xs, y: ys, frames, latex: '\\frac{\\partial^{2} u}{\\partial t^{2}} = c^{2} \\nabla^{2} u' };
}
