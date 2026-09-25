/**
 * Hand-drawn geometry. Turns clean paths into strokes that look drawn by a
 * person: a slight bow along long lines, low-frequency wobble, overshoot at
 * the ends of closed loops, and pressure that swells and tapers. Every
 * perturbation is a function of arc length from the stroke start and a
 * per-object seed, so a stroke that is half drawn is exactly the first half
 * of the finished stroke, and nothing flickers between frames.
 * @module board/hand
 */

import { flattenPath } from '../core/path.js';
import { noise1 } from '../core/random.js';

/**
 * @typedef {Object} HandPoint
 * @property {number} x
 * @property {number} y
 * @property {number} w Width factor (pressure), around 1.
 * @property {number} s Arc length from the stroke start.
 */

/**
 * @typedef {Object} HandStyle
 * @property {number} [wobble=0.012] Amplitude of low-frequency wobble in world units.
 * @property {number} [wobbleScale=1.3] Wavelength of the wobble in world units.
 * @property {number} [bow=0.008] Sideways bow as a fraction of stroke length.
 * @property {number} [overshoot=0.06] Extra travel past the start of a closed loop, as a fraction of its perimeter.
 * @property {number} [endJitter=0.02] Random extension or shortening of open stroke ends, world units.
 * @property {number} [pressure=0.25] Pressure variation amplitude.
 * @property {number} [taper=0.35] End taper as a fraction (0 = none).
 * @property {number} [taperLength=0.25] World units over which the ends taper.
 * @property {number} [drift=0] Baseline drift (vertical wander) amplitude, world units.
 */

/**
 * Flatten a path and perturb it into hand strokes.
 * @param {import('../core/path.js').Path} path world-space path
 * @param {number} seed
 * @param {HandStyle} [style]
 * @param {number} [tol=0.004] flattening tolerance in world units
 * @returns {Array<{pts: HandPoint[], closed: boolean}>}
 */
export function handStrokes(path, seed, style = {}, tol = 0.004) {
  const wobble = style.wobble ?? 0.012;
  const wobbleScale = style.wobbleScale ?? 1.3;
  const bow = style.bow ?? 0.008;
  const overshoot = style.overshoot ?? 0.06;
  const endJitter = style.endJitter ?? 0.02;
  const pressure = style.pressure ?? 0.25;
  const taper = style.taper ?? 0.35;
  const taperLen = style.taperLength ?? 0.25;
  const drift = style.drift ?? 0;
  const polys = flattenPath(path, tol);
  const out = [];
  polys.forEach((poly, pi) => {
    let pts = dedupe(poly.pts);
    if (pts.length < 2) {
      if (pts.length === 1) out.push({ pts: [{ x: pts[0][0], y: pts[0][1], w: 1, s: 0 }], closed: false });
      return;
    }
    const sub = seed * 31 + pi * 7919;
    let closed = poly.closed;
    if (closed && overshoot > 0) {
      // Continue past the start along the loop, then let the pen lift slightly outward.
      const perim = polyLength(pts);
      const extra = overshoot * perim * (0.7 + 0.6 * hash01(sub + 5));
      pts = pts.concat(walk(pts, extra).slice(1));
      closed = false;
    }
    const lens = cumulative(pts);
    const L = lens[lens.length - 1];
    if (L === 0) return;
    const [x0, y0] = pts[0];
    const [x1, y1] = pts[pts.length - 1];
    const chord = Math.hypot(x1 - x0, y1 - y0);
    const bowAmp = bow * chord * (hash01(sub + 11) * 2 - 1);
    const startExt = endJitter * (hash01(sub + 17) * 1.4 - 0.4);
    const endExt = endJitter * (hash01(sub + 23) * 1.4 - 0.4);
    const res = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const s = lens[i];
      const [nx, ny] = normalAt(pts, i);
      const u = s / L;
      const wob = wobble * noise1(s / wobbleScale + sub * 0.37, sub) + 0.35 * wobble * noise1((s * 3.1) / wobbleScale, sub + 3);
      const b = bowAmp * Math.sin(Math.PI * u);
      const d = drift * noise1(s / 2.7, sub + 9);
      const off = wob + b;
      let w = 1 + pressure * noise1(s / 0.9, sub + 41);
      if (taper > 0) {
        const tIn = Math.min(1, s / taperLen);
        const tOut = Math.min(1, (L - s) / taperLen);
        w *= 1 - taper + taper * Math.sqrt(Math.min(tIn, tOut * 1.3));
      }
      res.push({ x: x + nx * off, y: y + ny * off + d, w, s });
    }
    extendEnd(res, 0, startExt);
    extendEnd(res, res.length - 1, endExt);
    out.push({ pts: res, closed });
  });
  return out;
}

function hash01(n) {
  let h = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h ^= h >>> 15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

function dedupe(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1];
    if (Math.abs(pts[i][0] - p[0]) > 1e-7 || Math.abs(pts[i][1] - p[1]) > 1e-7) out.push(pts[i]);
  }
  return out;
}

function cumulative(pts) {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

function polyLength(pts) {
  const c = cumulative(pts);
  return c[c.length - 1];
}

function walk(pts, dist) {
  const out = [pts[0]];
  let left = dist;
  for (let i = 1; i < pts.length && left > 0; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const d = Math.hypot(bx - ax, by - ay);
    if (d >= left) {
      out.push([ax + ((bx - ax) * left) / d, ay + ((by - ay) * left) / d]);
      break;
    }
    out.push(pts[i]);
    left -= d;
  }
  return out;
}

function normalAt(pts, i) {
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  return [-dy / L, dx / L];
}

function extendEnd(res, i, ext) {
  if (res.length < 2 || Math.abs(ext) < 1e-9) return;
  const j = i === 0 ? 1 : res.length - 2;
  const p = res[i];
  const q = res[j];
  const dx = p.x - q.x;
  const dy = p.y - q.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return;
  const k = Math.max(-0.5 * L, ext) / L;
  p.x += dx * k;
  p.y += dy * k;
}

/**
 * Hatch lines filling a polygon region, used to shade large filled areas the
 * way a hand would. Lines are clipped by an even-odd scanline test.
 * @param {import('../core/path.js').Path} path world-space region
 * @param {number} spacing world units between hatch lines
 * @param {number} angle radians
 * @param {number} seed
 * @returns {import('../core/path.js').Path}
 */
export function hatchPath(path, spacing, angle, seed) {
  const polys = flattenPath(path, 0.01).map((p) => p.pts);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const rot = polys.map((pts) => pts.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]));
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const pts of rot) for (const [, y] of pts) {
    ymin = Math.min(ymin, y);
    ymax = Math.max(ymax, y);
  }
  const subpaths = [];
  const back = (x, y) => [x * cos + y * sin, -x * sin + y * cos];
  let k = 0;
  for (let y = ymin + spacing * (0.3 + 0.4 * hash01(seed)); y < ymax; y += spacing, k++) {
    const xs = [];
    for (const pts of rot) {
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const inset = spacing * 0.15;
      const a = xs[i] + inset * hash01(seed + k * 13 + i);
      const b = xs[i + 1] - inset * hash01(seed + k * 17 + i);
      if (b <= a) continue;
      const [px, py] = back(a, y);
      const [qx, qy] = back(b, y);
      subpaths.push({ points: [px, py, px + (qx - px) / 3, py + (qy - py) / 3, px + (2 * (qx - px)) / 3, py + (2 * (qy - py)) / 3, qx, qy], closed: false });
    }
  }
  return { subpaths };
}

/**
 * Approximate area of a path (sum of absolute subpath polygon areas).
 * @param {import('../core/path.js').Path} path
 * @returns {number}
 */
export function pathArea(path) {
  let A = 0;
  for (const { pts } of flattenPath(path, 0.02)) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      a += x0 * y1 - x1 * y0;
    }
    A += Math.abs(a) / 2;
  }
  return A;
}
