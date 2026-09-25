/**
 * Complex analysis helpers for visualisation: domain colouring, conformal
 * images of grids, Riemann surface sheets for sqrt and log, numeric contour
 * integrals, and residues of rational functions.
 * @module math/complexviz
 */
import { Complex } from './complex.js';
import { compileComplex } from './evaluate.js';
import { ensureExpr, varName } from './parse.js';
import { gaussKronrod } from './quadrature.js';
import { toRationalFunction } from './ratfunc.js';
import { factorRational, polyRootsNumeric, pDeg } from './poly.js';
import { laurent } from './series.js';
import { num, add, mul, pow } from './expr.js';
import { simplify } from './simplify.js';
import { Rational } from './rational.js';

/** @typedef {import('./expr.js').Expr} Expr */
/** @typedef {(z: Complex) => Complex} ComplexFn */

function asFunction(f, variable = 'z') {
  if (typeof f === 'function') return (z) => Complex.from(f(z));
  const g = compileComplex(ensureExpr(f), [variable]);
  return (z) => g(z);
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const k = (n) => (n + h * 12) % 12;
  const fch = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(255 * fch(0)), Math.round(255 * fch(8)), Math.round(255 * fch(4))];
}

/**
 * Colour of one complex value: hue from the argument (red at arg 0, going
 * through yellow, green, cyan, blue, magenta counterclockwise), lightness
 * from |w| (black at zeros, white at poles) with a band for every doubling of
 * |w| so level curves of the modulus are visible.
 * @param {Complex|number} w
 * @returns {[number, number, number]} RGB in 0..255
 */
export function domainColor(w) {
  const c = Complex.from(w);
  const m = c.abs();
  if (!Number.isFinite(m)) return [255, 255, 255];
  if (Number.isNaN(m)) return [128, 128, 128];
  let h = c.arg() / (2 * Math.PI);
  if (h < 0) h += 1;
  const base = (2 / Math.PI) * Math.atan(Math.sqrt(m));
  const lg = Math.log2(m || 1e-300);
  const band = 0.82 + 0.18 * (lg - Math.floor(lg));
  const l = Math.min(1, Math.max(0, base * band));
  return hslToRgb(h, 0.9, l);
}

/**
 * Domain colouring image of f over a rectangle, as RGBA bytes (row 0 is the
 * top edge, y = ymax).
 * @param {ComplexFn|Expr|string} f function of z
 * @param {{xmin?: number, xmax?: number, ymin?: number, ymax?: number, width?: number, height?: number, variable?: string}} [opts]
 * @returns {{width: number, height: number, data: Uint8ClampedArray}}
 */
export function domainColoring(f, opts = {}) {
  const { xmin = -2, xmax = 2, ymin = -2, ymax = 2, width = 200, height = 200 } = opts;
  const g = asFunction(f, opts.variable || 'z');
  const data = new Uint8ClampedArray(width * height * 4);
  for (let j = 0; j < height; j++) {
    const y = ymax - ((ymax - ymin) * (j + 0.5)) / height;
    for (let i = 0; i < width; i++) {
      const x = xmin + ((xmax - xmin) * (i + 0.5)) / width;
      let w;
      try {
        w = g(new Complex(x, y));
      } catch {
        w = new Complex(NaN, NaN);
      }
      const [r, gg, b] = domainColor(w);
      const k = (j * width + i) * 4;
      data[k] = r;
      data[k + 1] = gg;
      data[k + 2] = b;
      data[k + 3] = 255;
    }
  }
  return { width, height, data };
}

/**
 * Image of a rectangular grid of lines under f, for conformal map
 * animations. Each line is a polyline of mapped points; `source` holds the
 * unmapped points so a renderer can interpolate between them.
 * @param {ComplexFn|Expr|string} f
 * @param {{xmin?: number, xmax?: number, ymin?: number, ymax?: number, lines?: number, samples?: number, variable?: string}} [opts]
 * @returns {{horizontal: {source: {x: number, y: number}[], image: {x: number, y: number}[]}[], vertical: {source: {x: number, y: number}[], image: {x: number, y: number}[]}[]}}
 */
export function conformalGrid(f, opts = {}) {
  const { xmin = -1, xmax = 1, ymin = -1, ymax = 1, lines = 11, samples = 80 } = opts;
  const g = asFunction(f, opts.variable || 'z');
  const line = (p0, p1) => {
    const source = [];
    const image = [];
    for (let k = 0; k <= samples; k++) {
      const t = k / samples;
      const x = p0.x + (p1.x - p0.x) * t;
      const y = p0.y + (p1.y - p0.y) * t;
      source.push({ x, y });
      const w = g(new Complex(x, y));
      image.push({ x: w.re, y: w.im });
    }
    return { source, image };
  };
  const horizontal = [];
  const vertical = [];
  for (let i = 0; i < lines; i++) {
    const y = ymin + ((ymax - ymin) * i) / (lines - 1);
    horizontal.push(line({ x: xmin, y }, { x: xmax, y }));
    const x = xmin + ((xmax - xmin) * i) / (lines - 1);
    vertical.push(line({ x, y: ymin }, { x, y: ymax }));
  }
  return { horizontal, vertical };
}

/**
 * Sample points on the Riemann surface of sqrt (two sheets) or log
 * (`sheets` sheets). Points are laid out by ring (radius) and spoke (angle)
 * so a renderer can build a mesh; height is Re(sqrt z) for sqrt and
 * Im(log z) = theta for log.
 * @param {'sqrt'|'log'} kind
 * @param {{radius?: number, rings?: number, spokes?: number, sheets?: number}} [opts]
 * @returns {{kind: string, sheets: {index: number, grid: {x: number, y: number, z: number, re: number, im: number}[][]}[]}}
 */
export function riemannSurface(kind, opts = {}) {
  const { radius = 2, rings = 12, spokes = 48 } = opts;
  const sheetCount = kind === 'sqrt' ? 2 : opts.sheets ?? 3;
  const sheets = [];
  for (let s = 0; s < sheetCount; s++) {
    const grid = [];
    for (let r = 1; r <= rings; r++) {
      const rad = (radius * r) / rings;
      const row = [];
      for (let k = 0; k <= spokes; k++) {
        const theta = 2 * Math.PI * (s + k / spokes) - (kind === 'log' ? Math.PI * (sheetCount - 1) : 0);
        const x = rad * Math.cos(theta);
        const y = rad * Math.sin(theta);
        let re;
        let im;
        if (kind === 'sqrt') {
          const m = Math.sqrt(rad);
          re = m * Math.cos(theta / 2);
          im = m * Math.sin(theta / 2);
        } else {
          re = Math.log(rad);
          im = theta;
        }
        row.push({ x, y, z: kind === 'sqrt' ? re : im, re, im });
      }
      grid.push(row);
    }
    sheets.push({ index: s, grid });
  }
  return { kind, sheets };
}

/**
 * Numeric contour integral of f along the path gamma(t), t in [t0, t1]:
 * integral f(gamma(t)) gamma'(t) dt. gamma' defaults to a central difference.
 * @param {ComplexFn|Expr|string} f
 * @param {(t: number) => Complex|{re: number, im: number}} gamma
 * @param {number} t0
 * @param {number} t1
 * @param {{dgamma?: (t: number) => Complex|{re: number, im: number}, tol?: number, variable?: string}} [opts]
 * @returns {Complex}
 */
export function contourIntegral(f, gamma, t0, t1, opts = {}) {
  const g = asFunction(f, opts.variable || 'z');
  const path = (t) => Complex.from(gamma(t));
  const dpath = opts.dgamma ? (t) => Complex.from(opts.dgamma(t)) : (t) => {
    const h = 1e-6 * Math.max(1, Math.abs(t));
    return path(t + h).sub(path(t - h)).div(2 * h);
  };
  const integrand = (t) => g(path(t)).mul(dpath(t));
  const tol = opts.tol ?? 1e-10;
  const re = gaussKronrod((t) => integrand(t).re, t0, t1, { tol });
  const im = gaussKronrod((t) => integrand(t).im, t0, t1, { tol });
  return new Complex(re.value, im.value);
}

/**
 * Circle path helper for contour integrals: center + r e^(it).
 * @param {Complex|number} center
 * @param {number} r
 * @returns {(t: number) => Complex}
 */
export function circlePath(center, r) {
  const c = Complex.from(center);
  return (t) => c.add(Complex.polar(r, t));
}

/**
 * @typedef {object} Residue
 * @property {Expr|Complex} pole
 * @property {number} order
 * @property {Expr|Complex} residue
 * @property {boolean} exact
 */

/**
 * Poles and residues of a rational function of z. Rational and quadratic
 * poles give exact residues (from the Laurent series); other poles are found
 * numerically and their residues computed by a small contour integral.
 * @param {Expr|string} expr
 * @param {string|Expr} [variable='z']
 * @returns {Residue[]}
 */
export function residues(expr, variable = 'z') {
  const z = varName(variable);
  const e = ensureExpr(expr);
  const rf = toRationalFunction(e, z);
  if (!rf) throw new TypeError('residues needs a rational function of ' + z);
  const out = [];
  if (pDeg(rf.den) < 1) return out;
  const fr = factorRational(rf.den);
  const allRoots = polyRootsNumeric(rf.den.map((q) => q.toNumber()));
  const g = asFunction(e, z);
  for (const { poly, mult } of fr.factors) {
    const d = pDeg(poly);
    let exactRoots = null;
    if (d === 1) exactRoots = [num(poly[0].neg().div(poly[1]))];
    else if (d === 2) {
      const [c, b, a] = poly;
      const disc = b.mul(b).sub(a.mul(c).mul(Rational.from(4)));
      const sq = simplify(pow(num(disc), num('1/2')));
      const den = num(a.mul(Rational.from(2)));
      exactRoots = [-1, 1].map((s) => simplify(mul(add(num(b.neg()), mul(num(s), sq)), pow(den, num(-1)))));
    }
    if (exactRoots) {
      for (const p of exactRoots) {
        const l = laurent(e, z, p, 0);
        if (l.ok) {
          out.push({ pole: p, order: l.poleOrder, residue: simplify(l.residue), exact: true });
          continue;
        }
        out.push(numericResidue(g, compileComplex(p, [])(), mult, allRoots));
      }
      continue;
    }
    const roots = polyRootsNumeric(poly.map((q) => q.toNumber()));
    for (const r of roots) out.push(numericResidue(g, r, mult, allRoots));
  }
  return out;
}

// Residue by a contour integral around a circle that excludes other poles.
function numericResidue(g, a, order, allRoots) {
  let dist = Infinity;
  for (const r of allRoots) {
    const dd = r.sub(a).abs();
    if (dd > 1e-8) dist = Math.min(dist, dd);
  }
  const rho = Math.min(0.25, dist / 3);
  const I = contourIntegral(g, circlePath(a, rho), 0, 2 * Math.PI);
  return { pole: a, order, residue: I.div(new Complex(0, 2 * Math.PI)), exact: false };
}
