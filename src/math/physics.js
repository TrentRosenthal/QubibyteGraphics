/**
 * Physics helpers that pair a numeric solution with the LaTeX of the
 * governing equation: the constant-acceleration (suvat) solver, damped and
 * driven springs, the pendulum (small-angle and full nonlinear), Kepler
 * orbits from state vectors, n-body integration with leapfrog, and wave
 * superposition and interference patterns.
 * @module math/physics
 */
import { rk4 } from './ode.js';
import { ellipticK } from './special.js';
import { newton } from './roots.js';

const SUVAT = [
  { vars: ['v', 'u', 'a', 't'], latex: 'v = u + at' },
  { vars: ['s', 'u', 'a', 't'], latex: 's = ut + \\frac{1}{2}at^{2}' },
  { vars: ['v', 'u', 'a', 's'], latex: 'v^{2} = u^{2} + 2as' },
  { vars: ['s', 'u', 'v', 't'], latex: 's = \\frac{(u + v)t}{2}' },
  { vars: ['s', 'v', 'a', 't'], latex: 's = vt - \\frac{1}{2}at^{2}' },
];

// Solve one suvat equation for its single unknown; may return two roots.
function solveSuvat(eqIndex, unknown, k) {
  const { s, u, v, a, t } = k;
  switch (eqIndex) {
    case 0:
      if (unknown === 'v') return [u + a * t];
      if (unknown === 'u') return [v - a * t];
      if (unknown === 'a') return t === 0 ? [] : [(v - u) / t];
      return a === 0 ? [] : [(v - u) / a];
    case 1:
      if (unknown === 's') return [u * t + 0.5 * a * t * t];
      if (unknown === 'u') return t === 0 ? [] : [(s - 0.5 * a * t * t) / t];
      if (unknown === 'a') return t === 0 ? [] : [(2 * (s - u * t)) / (t * t)];
      return quadraticRoots(0.5 * a, u, -s);
    case 2: {
      if (unknown === 'v') {
        const v2 = u * u + 2 * a * s;
        return v2 < 0 ? [] : v2 === 0 ? [0] : [Math.sqrt(v2), -Math.sqrt(v2)];
      }
      if (unknown === 'u') {
        const u2 = v * v - 2 * a * s;
        return u2 < 0 ? [] : u2 === 0 ? [0] : [Math.sqrt(u2), -Math.sqrt(u2)];
      }
      if (unknown === 'a') return s === 0 ? [] : [(v * v - u * u) / (2 * s)];
      return a === 0 ? [] : [(v * v - u * u) / (2 * a)];
    }
    case 3:
      if (unknown === 's') return [((u + v) * t) / 2];
      if (unknown === 'u') return t === 0 ? [] : [(2 * s) / t - v];
      if (unknown === 'v') return t === 0 ? [] : [(2 * s) / t - u];
      return u + v === 0 ? [] : [(2 * s) / (u + v)];
    default:
      if (unknown === 's') return [v * t - 0.5 * a * t * t];
      if (unknown === 'v') return t === 0 ? [] : [(s + 0.5 * a * t * t) / t];
      if (unknown === 'a') return t === 0 ? [] : [(2 * (v * t - s)) / (t * t)];
      return quadraticRoots(-0.5 * a, v, -s);
  }
}

function quadraticRoots(A, B, C) {
  if (Math.abs(A) < 1e-15) return Math.abs(B) < 1e-15 ? [] : [-C / B];
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [(-B + sq) / (2 * A), (-B - sq) / (2 * A)];
}

/**
 * Constant-acceleration kinematics: give any three of s, u, v, a, t and the
 * other two are found. Each step names the equation used. When a square
 * root or quadratic gives two values the positive time (or the root
 * consistent with v = u + at) is chosen and the alternative is reported.
 * @param {{s?: number, u?: number, v?: number, a?: number, t?: number}} known
 * @returns {{values: {s: number, u: number, v: number, a: number, t: number}, steps: {solvedFor: string, latex: string, value: number, alternatives: number[]}[]}}
 */
export function suvat(known) {
  const k = { ...known };
  const names = ['s', 'u', 'v', 'a', 't'];
  const given = names.filter((n) => typeof k[n] === 'number');
  if (given.length < 3) throw new RangeError('Give at least three of s, u, v, a, t');
  const steps = [];
  for (let guard = 0; guard < 5 && names.some((n) => typeof k[n] !== 'number'); guard++) {
    let progressed = false;
    for (let e = 0; e < SUVAT.length && !progressed; e++) {
      const missing = SUVAT[e].vars.filter((n) => typeof k[n] !== 'number');
      if (missing.length !== 1) continue;
      const unknown = missing[0];
      let roots = solveSuvat(e, unknown, k);
      if (!roots.length) continue;
      if (unknown === 't') roots = roots.filter((r) => r >= -1e-12).sort((p, q) => p - q);
      if (!roots.length) continue;
      let choice = roots[0];
      if ((unknown === 'v' || unknown === 'u') && roots.length === 2 && typeof k.t === 'number' && typeof k.a === 'number') {
        const target = unknown === 'v' ? k.u + k.a * k.t : k.v - k.a * k.t;
        choice = roots.reduce((best, r) => (Math.abs(r - target) < Math.abs(best - target) ? r : best));
      }
      k[unknown] = choice;
      steps.push({ solvedFor: unknown, latex: SUVAT[e].latex, value: choice, alternatives: roots.filter((r) => r !== choice) });
      progressed = true;
    }
    if (!progressed) throw new RangeError('The given values do not determine the motion');
  }
  return { values: { s: k.s, u: k.u, v: k.v, a: k.a, t: k.t }, steps };
}

/**
 * Mass-spring-damper m x'' + c x' + k x = F0 cos(w t), solved exactly
 * (under-, critically or over-damped, with resonance when c = 0 and w = w0).
 * @param {{m?: number, k: number, c?: number, x0?: number, v0?: number, F0?: number, omega?: number}} p
 * @returns {{regime: string, omega0: number, zeta: number, x: (t: number) => number, latex: string, amplitude: number|null, phase: number|null, sample: (tEnd: number, n?: number) => {t: number, x: number}[]}}
 */
export function springOscillator(p) {
  const m = p.m ?? 1;
  const k = p.k;
  const c = p.c ?? 0;
  const x0 = p.x0 ?? 1;
  const v0 = p.v0 ?? 0;
  const F0 = p.F0 ?? 0;
  const w = p.omega ?? 0;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  // Particular solution for the driving force.
  let xp = () => 0;
  let vp0 = 0;
  let xp0 = 0;
  let amplitude = null;
  let phase = null;
  if (F0) {
    if (c === 0 && Math.abs(w - w0) < 1e-12) {
      xp = (t) => (F0 / (2 * m * w0)) * t * Math.sin(w0 * t);
      xp0 = 0;
      vp0 = 0;
    } else {
      amplitude = F0 / Math.hypot(k - m * w * w, c * w);
      phase = Math.atan2(c * w, k - m * w * w);
      xp = (t) => amplitude * Math.cos(w * t - phase);
      xp0 = amplitude * Math.cos(phase);
      vp0 = amplitude * w * Math.sin(phase);
    }
  }
  const X0 = x0 - xp0;
  const V0 = v0 - vp0;
  let xh;
  let regime;
  if (zeta < 1 - 1e-12) {
    regime = c === 0 ? 'undamped' : 'underdamped';
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const g = zeta * w0;
    const A = X0;
    const B = (V0 + g * X0) / wd;
    xh = (t) => Math.exp(-g * t) * (A * Math.cos(wd * t) + B * Math.sin(wd * t));
  } else if (zeta <= 1 + 1e-12) {
    regime = 'critically damped';
    const A = X0;
    const B = V0 + w0 * X0;
    xh = (t) => (A + B * t) * Math.exp(-w0 * t);
  } else {
    regime = 'overdamped';
    const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
    const B = (V0 - r1 * X0) / (r2 - r1);
    const A = X0 - B;
    xh = (t) => A * Math.exp(r1 * t) + B * Math.exp(r2 * t);
  }
  const x = (t) => xh(t) + xp(t);
  return {
    regime, omega0: w0, zeta, x, amplitude, phase,
    latex: F0 ? 'm\\ddot{x} + c\\dot{x} + kx = F_{0}\\cos(\\omega t)' : 'm\\ddot{x} + c\\dot{x} + kx = 0',
    sample: (tEnd, n = 200) => Array.from({ length: n + 1 }, (_, i) => {
      const t = (tEnd * i) / n;
      return { t, x: x(t) };
    }),
  };
}

/**
 * Simple pendulum: the small-angle solution theta0 cos(sqrt(g/L) t), the
 * full nonlinear motion theta'' = -(g/L) sin(theta) by RK4, and the exact
 * period 4 sqrt(L/g) K(sin(theta0/2)) for release from rest.
 * @param {{L?: number, g?: number, theta0: number, omega0?: number, tEnd?: number, steps?: number}} p
 * @returns {{smallAngle: {period: number, theta: (t: number) => number}, nonlinear: {t: number[], theta: number[], omega: number[]}, exactPeriod: number|null, latex: string, smallAngleLatex: string}}
 */
export function pendulum(p) {
  const L = p.L ?? 1;
  const g = p.g ?? 9.81;
  const th0 = p.theta0;
  const om0 = p.omega0 ?? 0;
  const w = Math.sqrt(g / L);
  const tEnd = p.tEnd ?? (4 * Math.PI) / w;
  const traj = rk4((_, y) => [y[1], -(g / L) * Math.sin(y[0])], [th0, om0], 0, tEnd, p.steps ?? 1000);
  return {
    smallAngle: { period: (2 * Math.PI) / w, theta: (t) => th0 * Math.cos(w * t) + (om0 / w) * Math.sin(w * t) },
    nonlinear: { t: traj.t, theta: traj.y.map((y) => y[0]), omega: traj.y.map((y) => y[1]) },
    exactPeriod: om0 === 0 && Math.abs(th0) < Math.PI ? 4 * Math.sqrt(L / g) * ellipticK(Math.sin(Math.abs(th0) / 2)) : null,
    latex: '\\ddot{\\theta} = -\\frac{g}{L}\\sin\\theta',
    smallAngleLatex: '\\ddot{\\theta} = -\\frac{g}{L}\\theta',
  };
}

/**
 * Two-body Kepler orbit in the plane from a position and velocity relative
 * to the central body (gravitational parameter mu = G M).
 * @param {{mu: number, r: [number, number], v: [number, number]}} state
 * @returns {{a: number, e: number, argPeriapsis: number, period: number|null, energy: number, h: number, type: 'ellipse'|'parabola'|'hyperbola',
 *   positionAt: (t: number) => {x: number, y: number}, path: (n?: number) => {x: number, y: number}[], latex: string}}
 */
export function keplerOrbit(state) {
  const { mu } = state;
  const [x, y] = state.r;
  const [vx, vy] = state.v;
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const h = x * vy - y * vx;
  const energy = v2 / 2 - mu / r;
  const rv = x * vx + y * vy;
  const ex = ((v2 - mu / r) * x - rv * vx) / mu;
  const ey = ((v2 - mu / r) * y - rv * vy) / mu;
  const e = Math.hypot(ex, ey);
  const omega = Math.atan2(ey, ex);
  const type = e < 1 - 1e-12 ? 'ellipse' : e > 1 + 1e-12 ? 'hyperbola' : 'parabola';
  const a = type === 'parabola' ? Infinity : -mu / (2 * energy);
  const period = type === 'ellipse' ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : null;
  const sign = Math.sign(h) || 1;
  // Mean anomaly at t = 0.
  const nu0 = Math.atan2(y, x) - omega;
  let M0 = 0;
  if (type === 'ellipse') {
    const E0 = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu0 / 2), Math.sqrt(1 + e) * Math.cos(nu0 / 2));
    M0 = E0 - e * Math.sin(E0);
  } else if (type === 'hyperbola') {
    const H0 = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu0 / 2));
    M0 = e * Math.sinh(H0) - H0;
  }
  const fromNu = (nu) => {
    const p = (h * h) / mu;
    const rr = p / (1 + e * Math.cos(nu));
    return { x: rr * Math.cos(nu + omega), y: rr * Math.sin(nu + omega) };
  };
  const positionAt = (t) => {
    if (type === 'ellipse') {
      const n = Math.sqrt(mu / (a * a * a));
      const M = M0 + sign * n * t;
      const E = newton((E1) => E1 - e * Math.sin(E1) - M, M, { df: (E1) => 1 - e * Math.cos(E1) }).root;
      const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
      return fromNu(nu);
    }
    if (type === 'hyperbola') {
      const n = Math.sqrt(mu / (-a * -a * -a));
      const M = M0 + sign * n * t;
      const H = newton((H1) => e * Math.sinh(H1) - H1 - M, Math.asinh(M / e), { df: (H1) => e * Math.cosh(H1) - 1 }).root;
      const nu = 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(H / 2));
      return fromNu(nu);
    }
    // Parabolic: Barker's equation.
    const p = (h * h) / mu;
    const D0 = Math.tan(nu0 / 2);
    const M = D0 + (D0 * D0 * D0) / 3 + sign * Math.sqrt(mu / (p * p * p)) * 2 * t;
    const D = newton((d) => d + (d * d * d) / 3 - M, D0, { df: (d) => 1 + d * d }).root;
    return fromNu(2 * Math.atan(D));
  };
  const path = (count = 200) => {
    const lim = type === 'ellipse' ? Math.PI : Math.acos(-1 / e) * 0.98;
    return Array.from({ length: count + 1 }, (_, i) => fromNu(-lim + (2 * lim * i) / count));
  };
  return { a, e, argPeriapsis: omega, period, energy, h, type, positionAt, path, latex: 'r = \\frac{a(1 - e^{2})}{1 + e\\cos\\nu}' };
}

/**
 * N-body gravity integrated with the kick-drift-kick leapfrog (symplectic,
 * so energy stays bounded). Positions and velocities are [x, y] or [x, y, z].
 * @param {{masses: number[], positions: number[][], velocities: number[][], G?: number, dt: number, steps: number, softening?: number, frameEvery?: number}} p
 * @returns {{frames: {t: number, positions: number[][]}[], energy: number[], latex: string}}
 */
export function nBody(p) {
  const G = p.G ?? 1;
  const eps2 = (p.softening ?? 0) ** 2;
  const n = p.masses.length;
  const pos = p.positions.map((q) => q.slice());
  const vel = p.velocities.map((q) => q.slice());
  const dim = pos[0].length;
  const acc = () => {
    const a = pos.map(() => new Array(dim).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = pos[j].map((c, k) => c - pos[i][k]);
        const r2 = d.reduce((s, c) => s + c * c, 0) + eps2;
        const inv = 1 / (r2 * Math.sqrt(r2));
        for (let k = 0; k < dim; k++) {
          a[i][k] += G * p.masses[j] * d[k] * inv;
          a[j][k] -= G * p.masses[i] * d[k] * inv;
        }
      }
    }
    return a;
  };
  const energyOf = () => {
    let e = 0;
    for (let i = 0; i < n; i++) e += 0.5 * p.masses[i] * vel[i].reduce((s, c) => s + c * c, 0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const r = Math.sqrt(pos[j].reduce((s, c, k) => s + (c - pos[i][k]) ** 2, 0) + eps2);
        e -= (G * p.masses[i] * p.masses[j]) / r;
      }
    }
    return e;
  };
  const every = p.frameEvery ?? 1;
  const frames = [{ t: 0, positions: pos.map((q) => q.slice()) }];
  const energy = [energyOf()];
  let a = acc();
  for (let s = 1; s <= p.steps; s++) {
    for (let i = 0; i < n; i++) for (let k = 0; k < dim; k++) vel[i][k] += 0.5 * p.dt * a[i][k];
    for (let i = 0; i < n; i++) for (let k = 0; k < dim; k++) pos[i][k] += p.dt * vel[i][k];
    a = acc();
    for (let i = 0; i < n; i++) for (let k = 0; k < dim; k++) vel[i][k] += 0.5 * p.dt * a[i][k];
    if (s % every === 0) {
      frames.push({ t: s * p.dt, positions: pos.map((q) => q.slice()) });
      energy.push(energyOf());
    }
  }
  return { frames, energy, latex: '\\ddot{\\mathbf{r}}_{i} = \\sum_{j \\ne i} \\frac{G m_{j} (\\mathbf{r}_{j} - \\mathbf{r}_{i})}{|\\mathbf{r}_{j} - \\mathbf{r}_{i}|^{3}}' };
}

/**
 * Superposition of circular waves from point sources on a grid. Returns the
 * instantaneous displacement at time t and the time-averaged intensity.
 * Each source is sum A cos(k r - w t + phase); amplitudes fall off as 1/sqrt(r)
 * when `falloff` is set.
 * @param {{sources: {x: number, y: number, amplitude?: number, phase?: number}[], wavelength: number, frequency?: number, t?: number,
 *   xmin?: number, xmax?: number, ymin?: number, ymax?: number, nx?: number, ny?: number, falloff?: boolean}} p
 * @returns {{nx: number, ny: number, displacement: Float64Array, intensity: Float64Array, latex: string}}
 */
export function interference(p) {
  const { sources, wavelength } = p;
  const nx = p.nx ?? 200;
  const ny = p.ny ?? 200;
  const xmin = p.xmin ?? -1;
  const xmax = p.xmax ?? 1;
  const ymin = p.ymin ?? -1;
  const ymax = p.ymax ?? 1;
  const k = (2 * Math.PI) / wavelength;
  const w = 2 * Math.PI * (p.frequency ?? 1);
  const t = p.t ?? 0;
  const displacement = new Float64Array(nx * ny);
  const intensity = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = ymax - ((ymax - ymin) * j) / (ny - 1);
    for (let i = 0; i < nx; i++) {
      const x = xmin + ((xmax - xmin) * i) / (nx - 1);
      let re = 0;
      let im = 0;
      for (const s of sources) {
        const r = Math.max(1e-9, Math.hypot(x - s.x, y - s.y));
        const A = (s.amplitude ?? 1) / (p.falloff ? Math.sqrt(r) : 1);
        const ph = k * r + (s.phase ?? 0);
        re += A * Math.cos(ph);
        im += A * Math.sin(ph);
      }
      displacement[j * nx + i] = re * Math.cos(w * t) + im * Math.sin(w * t);
      intensity[j * nx + i] = (re * re + im * im) / 2;
    }
  }
  return { nx, ny, displacement, intensity, latex: 'u(\\mathbf{x}, t) = \\sum_{i} A_{i} \\cos(k r_{i} - \\omega t + \\phi_{i})' };
}

/**
 * Double-slit (Fraunhofer) pattern: I / I0 = cos^2(pi d sin(theta) / lambda)
 * sinc^2(pi a sin(theta) / lambda), with the angles of the interference minima.
 * @param {{d: number, a?: number, wavelength: number}} p slit separation d, slit width a
 * @returns {{intensity: (theta: number) => number, minima: number[], latex: string}}
 */
export function doubleSlit(p) {
  const intensity = (theta) => {
    const s = Math.sin(theta);
    const beta = (Math.PI * p.d * s) / p.wavelength;
    const alpha = p.a ? (Math.PI * p.a * s) / p.wavelength : 0;
    const sinc = alpha === 0 ? 1 : Math.sin(alpha) / alpha;
    return Math.cos(beta) ** 2 * sinc * sinc;
  };
  const minima = [];
  for (let m = 0; minima.length < 5; m++) {
    const s = ((m + 0.5) * p.wavelength) / p.d;
    if (s > 1) break;
    minima.push(Math.asin(s));
  }
  return {
    intensity, minima,
    latex: 'I(\\theta) = I_{0}\\cos^{2}\\left(\\frac{\\pi d \\sin\\theta}{\\lambda}\\right)\\operatorname{sinc}^{2}\\left(\\frac{\\pi a \\sin\\theta}{\\lambda}\\right)',
  };
}

/**
 * Standing wave on a string of length L fixed at both ends, mode n:
 * y = A sin(n pi x / L) cos(w_n t) with w_n = n pi v / L.
 * @param {{L?: number, n?: number, amplitude?: number, speed?: number}} p
 * @returns {{omega: number, y: (x: number, t: number) => number, latex: string}}
 */
export function standingWave(p = {}) {
  const L = p.L ?? 1;
  const n = p.n ?? 1;
  const A = p.amplitude ?? 1;
  const v = p.speed ?? 1;
  const omega = (n * Math.PI * v) / L;
  return {
    omega,
    y: (x, t) => A * Math.sin((n * Math.PI * x) / L) * Math.cos(omega * t),
    latex: 'y(x, t) = A\\sin\\left(\\frac{n\\pi x}{L}\\right)\\cos(\\omega_{n} t)',
  };
}
