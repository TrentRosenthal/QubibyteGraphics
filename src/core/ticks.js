/**
 * Tick placement. Implements the extended Wilkinson algorithm (Talbot, Lin,
 * and Hanrahan, "An Extension of Wilkinson's Algorithm for Positioning Tick
 * Labels on Axes", 2010), which scores simplicity, coverage, density, and
 * legibility and beats Heckbert's nice numbers on all four.
 * @module core/ticks
 */

const Q = [1, 5, 2, 2.5, 4, 3];
const W = [0.25, 0.2, 0.5, 0.05];
const EPS = 1e-10;

function simplicity(i, j, lmin, lmax, lstep) {
  const n = Q.length;
  const v = ((lmin % lstep) < EPS || lstep - (lmin % lstep) < EPS) && lmin <= 0 && lmax >= 0 ? 1 : 0;
  return 1 - (i - 1) / (n - 1) - j + v;
}

function simplicityMax(i, j) {
  const n = Q.length;
  return 1 - (i - 1) / (n - 1) - j + 1;
}

function coverage(dmin, dmax, lmin, lmax) {
  const r = dmax - dmin;
  return 1 - 0.5 * ((dmax - lmax) ** 2 + (dmin - lmin) ** 2) / (0.1 * r) ** 2;
}

function coverageMax(dmin, dmax, span) {
  const r = dmax - dmin;
  if (span > r) {
    const half = (span - r) / 2;
    return 1 - 0.5 * (2 * half * half) / (0.1 * r) ** 2;
  }
  return 1;
}

function density(k, m, dmin, dmax, lmin, lmax) {
  const r = (k - 1) / (lmax - lmin);
  const rt = (m - 1) / (Math.max(lmax, dmax) - Math.min(dmin, lmin));
  return 2 - Math.max(r / rt, rt / r);
}

function densityMax(k, m) {
  return k >= m ? 2 - (k - 1) / (m - 1) : 1;
}

/**
 * Choose tick positions for a data range.
 * @param {number} dmin
 * @param {number} dmax
 * @param {number} [m=5] target number of ticks
 * @param {boolean} [onlyInside=false] keep ticks inside [dmin, dmax]
 * @returns {{ticks: number[], step: number, min: number, max: number}}
 */
export function niceTicks(dmin, dmax, m = 5, onlyInside = false) {
  if (!(dmax > dmin)) {
    if (dmin === dmax && Number.isFinite(dmin)) return { ticks: [dmin], step: 1, min: dmin, max: dmin };
    return { ticks: [], step: 1, min: dmin, max: dmax };
  }
  let best = null;
  let bestScore = -2;
  let j = 1;
  while (j < Infinity) {
    let broke = false;
    for (let qi = 0; qi < Q.length; qi++) {
      const q = Q[qi];
      const sm = simplicityMax(qi + 1, j);
      if (W[0] * sm + W[1] + W[2] + W[3] < bestScore) {
        broke = true;
        break;
      }
      let k = 2;
      while (k < 64) {
        const dm = densityMax(k, m);
        if (W[0] * sm + W[1] + W[2] * dm + W[3] < bestScore) break;
        const delta = (dmax - dmin) / (k + 1) / j / q;
        let z = Math.ceil(Math.log10(delta));
        while (z < 400) {
          const step = j * q * 10 ** z;
          const cm = coverageMax(dmin, dmax, step * (k - 1));
          if (W[0] * sm + W[1] * cm + W[2] * dm + W[3] < bestScore) break;
          const minStart = Math.floor(dmax / step) * j - (k - 1) * j;
          const maxStart = Math.ceil(dmin / step) * j;
          if (minStart > maxStart) {
            z++;
            continue;
          }
          for (let start = minStart; start <= maxStart; start++) {
            const lmin = start * (step / j);
            const lmax = lmin + step * (k - 1);
            const s = simplicity(qi + 1, j, lmin, lmax, step);
            const c = coverage(dmin, dmax, lmin, lmax);
            const g = density(k, m, dmin, dmax, lmin, lmax);
            const score = W[0] * s + W[1] * c + W[2] * g + W[3];
            if (score > bestScore && (!onlyInside || (lmin >= dmin - EPS && lmax <= dmax + EPS))) {
              bestScore = score;
              best = { lmin, lmax, step };
            }
          }
          z++;
        }
        k++;
      }
    }
    if (broke) break;
    j++;
    if (j > 12) break;
  }
  if (!best) {
    const step = (dmax - dmin) / Math.max(1, m - 1);
    return { ticks: Array.from({ length: m }, (_, i) => dmin + i * step), step, min: dmin, max: dmax };
  }
  const ticks = [];
  const n = Math.round((best.lmax - best.lmin) / best.step);
  for (let i = 0; i <= n; i++) ticks.push(cleanFloat(best.lmin + i * best.step, best.step));
  return { ticks, step: best.step, min: best.lmin, max: best.lmax };
}

/**
 * Round away float noise relative to the step (0.30000000000000004 to 0.3).
 * @param {number} v
 * @param {number} step
 * @returns {number}
 */
export function cleanFloat(v, step) {
  const digits = Math.max(0, -Math.floor(Math.log10(Math.abs(step))) + 2);
  const r = Number(v.toFixed(Math.min(15, digits)));
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Decade ticks for a log axis.
 * @param {number} dmin positive
 * @param {number} dmax positive
 * @returns {{major: number[], minor: number[]}}
 */
export function logTicks(dmin, dmax) {
  const a = Math.floor(Math.log10(dmin));
  const b = Math.ceil(Math.log10(dmax));
  const major = [];
  const minor = [];
  for (let e = a; e <= b; e++) {
    const base = 10 ** e;
    if (base >= dmin * (1 - EPS) && base <= dmax * (1 + EPS)) major.push(base);
    for (let k = 2; k <= 9; k++) {
      const v = k * base;
      if (v >= dmin && v <= dmax) minor.push(v);
    }
  }
  return { major, minor };
}

/**
 * Format a tick value as TeX: integers without decimals, small or large
 * magnitudes in scientific notation, otherwise the fewest digits the step needs.
 * @param {number} v
 * @param {number} step
 * @returns {string}
 */
export function formatTick(v, step) {
  if (v === 0) return '0';
  const av = Math.abs(v);
  if (av >= 1e5 || av < 1e-4) {
    const e = Math.floor(Math.log10(av));
    const m = v / 10 ** e;
    const ms = Number(m.toFixed(2)).toString();
    return ms === '1' ? `10^{${e}}` : `${ms}\\times 10^{${e}}`;
  }
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(digits);
}
