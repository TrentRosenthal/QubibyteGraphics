/**
 * Easing functions map progress u in [0, 1] to eased progress. Every
 * animation has one; the default is `smooth`.
 * @module core/easing
 */

/** @typedef {(u: number) => number} Easing */

const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);

/** @type {Easing} */
export const linear = (u) => u;

/**
 * The house default: a smoothstep-like curve with softer ends than a cubic
 * ease in-out (sigmoid rescaled to hit 0 and 1 exactly).
 * @type {Easing}
 */
export const smooth = (u) => {
  u = clamp01(u);
  const k = 10;
  const s = (x) => 1 / (1 + Math.exp(-x));
  const lo = s(-k / 2);
  const hi = s(k / 2);
  return (s(k * (u - 0.5)) - lo) / (hi - lo);
};

const inOut = (f) => (u) => (u < 0.5 ? f(2 * u) / 2 : 1 - f(2 - 2 * u) / 2);
const out = (f) => (u) => 1 - f(1 - u);

/** @type {Easing} */ export const easeInQuad = (u) => u * u;
/** @type {Easing} */ export const easeOutQuad = out(easeInQuad);
/** @type {Easing} */ export const easeInOutQuad = inOut(easeInQuad);
/** @type {Easing} */ export const easeInCubic = (u) => u * u * u;
/** @type {Easing} */ export const easeOutCubic = out(easeInCubic);
/** @type {Easing} */ export const easeInOutCubic = inOut(easeInCubic);
/** @type {Easing} */ export const easeInQuart = (u) => u ** 4;
/** @type {Easing} */ export const easeOutQuart = out(easeInQuart);
/** @type {Easing} */ export const easeInOutQuart = inOut(easeInQuart);
/** @type {Easing} */ export const easeInQuint = (u) => u ** 5;
/** @type {Easing} */ export const easeOutQuint = out(easeInQuint);
/** @type {Easing} */ export const easeInOutQuint = inOut(easeInQuint);
/** @type {Easing} */ export const easeInSine = (u) => 1 - Math.cos((u * Math.PI) / 2);
/** @type {Easing} */ export const easeOutSine = out(easeInSine);
/** @type {Easing} */ export const easeInOutSine = (u) => -(Math.cos(Math.PI * u) - 1) / 2;
/** @type {Easing} */ export const easeInExpo = (u) => (u <= 0 ? 0 : 2 ** (10 * u - 10));
/** @type {Easing} */ export const easeOutExpo = out(easeInExpo);
/** @type {Easing} */ export const easeInOutExpo = inOut(easeInExpo);
/** @type {Easing} */ export const easeInCirc = (u) => 1 - Math.sqrt(1 - clamp01(u) ** 2);
/** @type {Easing} */ export const easeOutCirc = out(easeInCirc);
/** @type {Easing} */ export const easeInOutCirc = inOut(easeInCirc);
const BACK = 1.70158;
/** @type {Easing} */ export const easeInBack = (u) => (BACK + 1) * u ** 3 - BACK * u * u;
/** @type {Easing} */ export const easeOutBack = out(easeInBack);
/** @type {Easing} */ export const easeInOutBack = inOut((u) => ((BACK * 1.525) + 1) * u ** 3 - BACK * 1.525 * u * u);
/** @type {Easing} */
export const easeOutElastic = (u) => {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return 2 ** (-10 * u) * Math.sin(((u * 10 - 0.75) * 2 * Math.PI) / 3) + 1;
};
/** @type {Easing} */ export const easeInElastic = out(easeOutElastic);
/** @type {Easing} */ export const easeInOutElastic = inOut(easeInElastic);
/** @type {Easing} */
export const easeOutBounce = (u) => {
  const n = 7.5625;
  const d = 2.75;
  if (u < 1 / d) return n * u * u;
  if (u < 2 / d) return n * (u -= 1.5 / d) * u + 0.75;
  if (u < 2.5 / d) return n * (u -= 2.25 / d) * u + 0.9375;
  return n * (u -= 2.625 / d) * u + 0.984375;
};
/** @type {Easing} */ export const easeInBounce = out(easeOutBounce);
/** @type {Easing} */ export const easeInOutBounce = inOut(easeInBounce);

/** Goes 0 to 1 and back to 0, smoothly. @type {Easing} */
export const thereAndBack = (u) => smooth(u < 0.5 ? 2 * u : 2 - 2 * u);

/** Starts slow and ends fast. @type {Easing} */
export const rushInto = (u) => 2 * smooth(u / 2);

/** Starts fast and ends slow. @type {Easing} */
export const rushFrom = (u) => 2 * smooth(u / 2 + 0.5) - 1;

/** Holds, runs, holds: the transition happens in the middle 60%. @type {Easing} */
export const slowInto = (u) => Math.sqrt(1 - (1 - clamp01(u)) ** 2);

/**
 * CSS-style cubic Bezier easing through (0,0), (x1,y1), (x2,y2), (1,1).
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @returns {Easing}
 */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dsx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (u) => {
    u = clamp01(u);
    let t = u;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - u;
      if (Math.abs(e) < 1e-7) return sy(t);
      const d = dsx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0;
    let hi = 1;
    t = u;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - u) < 1e-7) break;
      if (v < u) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/**
 * Damped spring response normalized to settle at 1. With the defaults the
 * spring slightly overshoots and settles, like a UI spring.
 * @param {{stiffness?: number, damping?: number, mass?: number, velocity?: number}} [opts]
 * @returns {Easing}
 */
export function spring(opts = {}) {
  const k = opts.stiffness ?? 170;
  const c = opts.damping ?? 18;
  const m = opts.mass ?? 1;
  const v0 = -(opts.velocity ?? 0);
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  // Duration over which the spring is considered settled; progress maps onto it.
  const settle = Math.min(10, 6 / (zeta * w0 || 1));
  const x = (t) => {
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0 - v0) / wd) * Math.sin(wd * t));
    }
    if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + (w0 - v0) * t);
    const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
    const A = (v0 - r2) / (r1 - r2);
    return 1 - (A * Math.exp(r1 * t) + (1 - A) * Math.exp(r2 * t));
  };
  const end = x(settle);
  return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : x(u * settle) / end);
}

/**
 * Stepped easing: jumps in n equal steps.
 * @param {number} n
 * @returns {Easing}
 */
export function steps(n) {
  return (u) => (u >= 1 ? 1 : Math.floor(u * n) / n);
}

/** Named easings, for scene documents and the editor. @type {Record<string, Easing>} */
export const EASINGS = {
  linear, smooth, thereAndBack, rushInto, rushFrom, slowInto,
  easeInQuad, easeOutQuad, easeInOutQuad,
  easeInCubic, easeOutCubic, easeInOutCubic,
  easeInQuart, easeOutQuart, easeInOutQuart,
  easeInQuint, easeOutQuint, easeInOutQuint,
  easeInSine, easeOutSine, easeInOutSine,
  easeInExpo, easeOutExpo, easeInOutExpo,
  easeInCirc, easeOutCirc, easeInOutCirc,
  easeInBack, easeOutBack, easeInOutBack,
  easeInElastic, easeOutElastic, easeInOutElastic,
  easeInBounce, easeOutBounce, easeInOutBounce,
  spring: spring(),
};

/**
 * Resolve an easing given as a function, a name, or a cubic-bezier array.
 * @param {Easing|string|number[]|undefined} e
 * @param {Easing} [fallback=smooth]
 * @returns {Easing}
 */
export function resolveEasing(e, fallback = smooth) {
  if (!e) return fallback;
  if (typeof e === 'function') return e;
  if (Array.isArray(e) && e.length === 4) return cubicBezier(e[0], e[1], e[2], e[3]);
  if (typeof e === 'string') {
    const m = /^cubic-bezier\(([^)]+)\)$/.exec(e.trim());
    if (m) {
      const [a, b, c, d] = m[1].split(',').map(Number);
      return cubicBezier(a, b, c, d);
    }
    if (EASINGS[e]) return EASINGS[e];
    throw new Error(`Unknown easing "${e}". Use one of: ${Object.keys(EASINGS).join(', ')}`);
  }
  throw new Error('Easing must be a function, a name, or [x1, y1, x2, y2]');
}
