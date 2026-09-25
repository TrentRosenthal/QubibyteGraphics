/**
 * Univariate polynomials. Exact polynomials are arrays of Rational
 * coefficients from the constant term up (p[k] multiplies x^k). Includes
 * conversion to and from expressions, division, gcd, square-free
 * factorization, the rational root theorem, full factorization over the
 * rationals (Kronecker's method for factors of degree two and up), and
 * Aberth's method for numeric complex roots.
 * @module math/poly
 */
import { Rational, R0, R1, bigGcd, bestRational } from './rational.js';
import { num, sym, add, mul, pow, freeOf, MathError } from './expr.js';
import { simplify, expand } from './simplify.js';
import { Complex } from './complex.js';

/** @typedef {import('./expr.js').Expr} Expr */
/** @typedef {Rational[]} Poly */

/**
 * Remove leading zero coefficients.
 * @param {Poly} p
 * @returns {Poly}
 */
export function pTrim(p) {
  let n = p.length;
  while (n > 0 && p[n - 1].isZero()) n--;
  return p.slice(0, n);
}

/**
 * Degree (-1 for the zero polynomial).
 * @param {Poly} p
 * @returns {number}
 */
export function pDeg(p) {
  return pTrim(p).length - 1;
}

/** @param {Poly} a @param {Poly} b @returns {Poly} */
export function pAdd(a, b) {
  const n = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < n; i++) out.push((a[i] || R0).add(b[i] || R0));
  return pTrim(out);
}

/** @param {Poly} a @param {Poly} b @returns {Poly} */
export function pSub(a, b) {
  return pAdd(a, b.map((c) => c.neg()));
}

/** @param {Poly} a @param {Poly} b @returns {Poly} */
export function pMul(a, b) {
  if (!a.length || !b.length) return [];
  const out = new Array(a.length + b.length - 1).fill(R0);
  for (let i = 0; i < a.length; i++) {
    if (a[i].isZero()) continue;
    for (let j = 0; j < b.length; j++) out[i + j] = out[i + j].add(a[i].mul(b[j]));
  }
  return pTrim(out);
}

/**
 * Multiply by a scalar.
 * @param {Poly} a
 * @param {Rational} c
 * @returns {Poly}
 */
export function pScale(a, c) {
  return pTrim(a.map((x) => x.mul(c)));
}

/**
 * Polynomial long division.
 * @param {Poly} a dividend
 * @param {Poly} b divisor (non-zero)
 * @returns {{q: Poly, r: Poly}}
 */
export function pDivmod(a, b) {
  b = pTrim(b);
  if (!b.length) throw new MathError('Division by the zero polynomial');
  let r = pTrim(a);
  const db = b.length - 1;
  const lead = b[db];
  const q = new Array(Math.max(0, r.length - db)).fill(R0);
  while (r.length - 1 >= db && r.length) {
    const shift = r.length - 1 - db;
    const c = r[r.length - 1].div(lead);
    q[shift] = c;
    const next = r.slice();
    for (let i = 0; i <= db; i++) next[i + shift] = next[i + shift].sub(c.mul(b[i]));
    next.pop();
    r = pTrim(next);
  }
  return { q: pTrim(q), r };
}

/**
 * Monic greatest common divisor.
 * @param {Poly} a
 * @param {Poly} b
 * @returns {Poly}
 */
export function pGcd(a, b) {
  a = pTrim(a);
  b = pTrim(b);
  while (b.length) {
    const r = pDivmod(a, b).r;
    a = b;
    b = r;
  }
  return pMonic(a);
}

/**
 * Scale to leading coefficient 1.
 * @param {Poly} p
 * @returns {Poly}
 */
export function pMonic(p) {
  p = pTrim(p);
  if (!p.length) return p;
  const l = p[p.length - 1];
  return p.map((c) => c.div(l));
}

/** @param {Poly} p @returns {Poly} derivative */
export function pDeriv(p) {
  const out = [];
  for (let i = 1; i < p.length; i++) out.push(p[i].mul(Rational.from(i)));
  return pTrim(out);
}

/**
 * Exact evaluation (Horner).
 * @param {Poly} p
 * @param {Rational} x
 * @returns {Rational}
 */
export function pEval(p, x) {
  let acc = R0;
  for (let i = p.length - 1; i >= 0; i--) acc = acc.mul(x).add(p[i]);
  return acc;
}

/**
 * Split into content (a positive rational, sign moved into it so the
 * primitive part has positive leading coefficient) and a primitive integer
 * polynomial.
 * @param {Poly} p
 * @returns {{content: Rational, prim: Poly}}
 */
export function pPrimitive(p) {
  p = pTrim(p);
  if (!p.length) return { content: R0, prim: [] };
  let lcmDen = 1n;
  for (const c of p) lcmDen = (lcmDen * c.d) / bigGcd(lcmDen, c.d);
  const ints = p.map((c) => (c.n * lcmDen) / c.d);
  let g = 0n;
  for (const v of ints) g = bigGcd(g, v);
  if (ints[ints.length - 1] < 0n) g = -g;
  return { content: new Rational(g, lcmDen), prim: ints.map((v) => new Rational(v / g)) };
}

/**
 * Yun's square-free factorization of a monic polynomial.
 * @param {Poly} p
 * @returns {{poly: Poly, mult: number}[]}
 */
export function squareFree(p) {
  p = pMonic(p);
  const out = [];
  if (p.length <= 1) return out;
  let a = pGcd(p, pDeriv(p));
  let b = pDivmod(p, a).q;
  let c = pDivmod(pDeriv(p), a).q;
  let d = pSub(c, pDeriv(b));
  let i = 1;
  while (pDeg(b) > 0) {
    a = pGcd(b, d);
    if (pDeg(a) > 0) out.push({ poly: pMonic(a), mult: i });
    b = pDivmod(b, a).q;
    c = pDivmod(d, a).q;
    d = pSub(c, pDeriv(b));
    i++;
  }
  return out;
}

function divisors(n) {
  if (n < 0n) n = -n;
  const out = [];
  if (n === 0n) return out;
  if (n > 10n ** 12n) return null;
  for (let d = 1n; d * d <= n; d++) {
    if (n % d === 0n) {
      out.push(d);
      if (d * d !== n) out.push(n / d);
    }
  }
  return out.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
}

/**
 * Rational roots by the rational root theorem (each root listed once).
 * @param {Poly} p
 * @returns {Rational[]}
 */
export function rationalRoots(p) {
  const { prim } = pPrimitive(p);
  const roots = [];
  let q = prim;
  if (!q.length) return roots;
  while (q.length > 1 && q[0].isZero()) {
    if (!roots.some((r) => r.isZero())) roots.push(R0);
    q = q.slice(1);
  }
  if (q.length <= 1) return roots;
  const a0 = q[0].n;
  const an = q[q.length - 1].n;
  const ps = divisors(a0);
  const qs = divisors(an);
  if (!ps || !qs) {
    // Coefficients too large to enumerate divisors: test rationalized
    // numeric roots exactly instead.
    for (const z of polyRootsNumeric(q.map((c) => c.toNumber()))) {
      if (!z.isReal(1e-9)) continue;
      const r = bestRational(z.re, 1e9);
      if (pEval(q, r).isZero() && !roots.some((u) => u.eq(r))) roots.push(r);
    }
    return roots.sort((x, y) => x.cmp(y));
  }
  const seen = new Set();
  for (const pp of ps) {
    for (const qq of qs) {
      for (const s of [1n, -1n]) {
        const r = new Rational(s * pp, qq);
        const k = r.toString();
        if (seen.has(k)) continue;
        seen.add(k);
        if (pEval(q, r).isZero()) roots.push(r);
      }
    }
  }
  return roots.sort((x, y) => x.cmp(y));
}

// Kronecker: find a non-trivial integer factor of degree d of a primitive
// square-free integer polynomial with no rational roots, or null. Candidate
// factors are interpolated with integer Lagrange numerators so each trial
// costs a few BigInt multiplications.
function kroneckerFactor(f, d, budget) {
  const cands = [];
  for (let k = 0; k < 4 * (d + 1) + 8; k++) {
    const x = BigInt(k % 2 === 0 ? k / 2 : -(k + 1) / 2);
    const v = pEval(f, new Rational(x));
    if (!v.isZero()) cands.push({ x, v: v.n < 0n ? -v.n : v.n });
  }
  // Points where |f| is small have few divisors.
  cands.sort((p, q) => (p.v < q.v ? -1 : p.v > q.v ? 1 : 0));
  const chosen = cands.slice(0, d + 1);
  if (chosen.length < d + 1) return null;
  const xs = chosen.map((c) => c.x);
  const vals = chosen.map((c) => pEval(f, new Rational(c.x)).n);
  const raw = vals.map(divisors);
  if (raw.some((ds) => ds === null)) {
    budget.exhausted = true;
    return null;
  }
  const divs = raw.map((ds, i) => (i === 0 ? ds : ds.flatMap((x) => [x, -x])));
  let combos = 1;
  for (const ds of divs) combos *= ds.length;
  if (combos > budget.left) {
    budget.exhausted = true;
    return null;
  }
  budget.left -= combos;
  // Lagrange numerators N_i (integer coefficients) and denominators D_i.
  const numers = [];
  const dens = [];
  for (let i = 0; i <= d; i++) {
    let poly = [1n];
    let den = 1n;
    for (let j = 0; j <= d; j++) {
      if (j === i) continue;
      const next = new Array(poly.length + 1).fill(0n);
      poly.forEach((c, k) => {
        next[k] -= c * xs[j];
        next[k + 1] += c;
      });
      poly = next;
      den *= xs[i] - xs[j];
    }
    numers.push(poly);
    dens.push(den);
  }
  let W = 1n;
  for (const dn of dens) {
    const a = dn < 0n ? -dn : dn;
    W = (W / bigGcd(W, a)) * a;
  }
  const scale = dens.map((dn) => W / dn);
  const lead = f[f.length - 1].n;
  const idx = new Array(d + 1).fill(0);
  const acc = new Array(d + 1);
  for (;;) {
    acc.fill(0n);
    for (let i = 0; i <= d; i++) {
      const y = divs[i][idx[i]] * scale[i];
      const N = numers[i];
      for (let k = 0; k <= d; k++) acc[k] += y * N[k];
    }
    if (acc[d] !== 0n && acc.every((c) => c % W === 0n)) {
      const g = acc.map((c) => c / W);
      if (lead % g[d] === 0n) {
        const gp = g.map((c) => new Rational(c));
        const { q, r } = pDivmod(f, gp);
        if (!r.length && q.every((c) => c.isInteger())) return pPrimitive(gp).prim;
      }
    }
    let pos = 0;
    while (pos <= d) {
      idx[pos]++;
      if (idx[pos] < divs[pos].length) break;
      idx[pos] = 0;
      pos++;
    }
    if (pos > d) return null;
  }
}

/**
 * @typedef {object} RationalFactorization
 * @property {Rational} content overall constant factor
 * @property {{poly: Poly, mult: number}[]} factors primitive integer factors
 * @property {boolean} complete false if a search budget ran out, so a listed
 *   factor of degree four or more might still be reducible
 */

const factorCache = new Map();

/**
 * Factor a polynomial over the rationals into irreducible primitive integer
 * polynomials with multiplicities. Kronecker's search for factors of degree
 * two and up is limited by `maxCombos` candidate factors (0 skips it, which
 * still finds every rational root and repeated factor).
 * @param {Poly} p
 * @param {{maxCombos?: number}} [opts]
 * @returns {RationalFactorization}
 */
export function factorRational(p, opts = {}) {
  p = pTrim(p);
  if (!p.length) return { content: R0, factors: [], complete: true };
  const maxCombos = opts.maxCombos ?? 400000;
  const cacheKey = p.map(String).join(',') + '|' + maxCombos;
  const hit = factorCache.get(cacheKey);
  if (hit) return hit;
  const result = factorRationalUncached(p, maxCombos);
  if (factorCache.size > 500) factorCache.clear();
  factorCache.set(cacheKey, result);
  return result;
}

function factorRationalUncached(p, maxCombos) {
  const { content, prim } = pPrimitive(p);
  const out = [];
  const budget = { left: maxCombos, exhausted: false };
  for (const { poly, mult } of squareFree(prim)) {
    let rest = pPrimitive(poly).prim;
    for (const r of rationalRoots(rest)) {
      const lin = pPrimitive([r.neg(), R1]).prim;
      rest = pDivmod(rest, lin).q;
      out.push({ poly: lin, mult });
    }
    rest = pPrimitive(rest).prim;
    const stack = [rest];
    while (stack.length) {
      const f = stack.pop();
      const deg = pDeg(f);
      if (deg < 1) continue;
      let split = null;
      for (let d = 2; d <= Math.floor(deg / 2) && !split; d++) split = kroneckerFactor(f, d, budget);
      if (split) {
        stack.push(split, pPrimitive(pDivmod(f, split).q).prim);
      } else out.push({ poly: f, mult });
    }
  }
  // Recover the constant: product of factors has leading coefficient L.
  let lead = R1;
  for (const { poly, mult } of out) lead = lead.mul(poly[poly.length - 1].pow(mult));
  const c = content.mul(prim[prim.length - 1]).div(lead);
  out.sort((a, b) => pDeg(a.poly) - pDeg(b.poly) || a.poly[0].cmp(b.poly[0]));
  return { content: c, factors: out, complete: !budget.exhausted };
}

/**
 * Coefficients of expr as a polynomial in x (expressions free of x), low
 * degree first, or null if expr is not a polynomial in x.
 * @param {Expr} expr
 * @param {string} x
 * @returns {Expr[]|null}
 */
export function polyCoeffs(expr, x) {
  const e = expand(expr);
  const terms = e.type === 'add' ? e.args : [e];
  const buckets = [];
  for (const t of terms) {
    const factors = t.type === 'mul' ? t.args : [t];
    let deg = 0;
    const rest = [];
    for (const f of factors) {
      if (f.type === 'sym' && f.name === x) deg += 1;
      else if (f.type === 'pow' && f.args[0].type === 'sym' && f.args[0].name === x) {
        const ex = f.args[1];
        if (ex.type !== 'num' || !ex.value.isInteger() || ex.value.sign() < 0) return null;
        deg += Number(ex.value.n);
      } else if (!freeOf(f, x)) return null;
      else rest.push(f);
    }
    (buckets[deg] = buckets[deg] || []).push(rest.length ? mul(...rest) : num(1));
  }
  const out = [];
  for (let i = 0; i < buckets.length; i++) out.push(buckets[i] ? simplify(add(...buckets[i])) : num(0));
  while (out.length > 1 && out[out.length - 1].type === 'num' && out[out.length - 1].value.isZero()) out.pop();
  return out;
}

/**
 * Rational coefficient polynomial of expr in x, or null.
 * @param {Expr} expr
 * @param {string} x
 * @returns {Poly|null}
 */
export function toPoly(expr, x) {
  const cs = polyCoeffs(expr, x);
  if (!cs || cs.some((c) => c.type !== 'num')) return null;
  return pTrim(cs.map((c) => c.value));
}

/**
 * Build the canonical expression of a rational polynomial.
 * @param {Poly} p
 * @param {string} x
 * @returns {Expr}
 */
export function polyToExpr(p, x) {
  const X = sym(x);
  const terms = [];
  p.forEach((c, k) => {
    if (c.isZero()) return;
    if (k === 0) terms.push(num(c));
    else terms.push(mul(num(c), k === 1 ? X : pow(X, num(k))));
  });
  return simplify(add(...terms));
}

/**
 * Build a polynomial expression from expression coefficients.
 * @param {Expr[]} cs coefficients, low degree first
 * @param {string} x
 * @returns {Expr}
 */
export function coeffsToExpr(cs, x) {
  const X = sym(x);
  return simplify(add(...cs.map((c, k) => (k === 0 ? c : mul(c, k === 1 ? X : pow(X, num(k)))))));
}

/**
 * Numeric complex roots by the Aberth-Ehrlich method.
 * @param {(number|Complex)[]} coeffs low degree first
 * @param {{tol?: number, maxIter?: number}} [opts]
 * @returns {Complex[]}
 */
export function polyRootsNumeric(coeffs, opts = {}) {
  const tol = opts.tol ?? 1e-14;
  const maxIter = opts.maxIter ?? 500;
  let c = coeffs.map((v) => Complex.from(v));
  while (c.length && c[c.length - 1].abs() === 0) c.pop();
  const roots = [];
  while (c.length > 1 && c[0].abs() === 0) {
    roots.push(new Complex(0, 0));
    c = c.slice(1);
  }
  const n = c.length - 1;
  if (n < 1) return roots;
  const lead = c[n];
  c = c.map((v) => v.div(lead));
  const evalBoth = (z) => {
    let p = c[n];
    let dp = new Complex(0, 0);
    for (let i = n - 1; i >= 0; i--) {
      dp = dp.mul(z).add(p);
      p = p.mul(z).add(c[i]);
    }
    return [p, dp];
  };
  // Initial guesses on a circle whose radius is the geometric mean bound.
  let radius = Math.pow(c[0].abs(), 1 / n);
  if (!(radius > 0) || !Number.isFinite(radius)) radius = 1;
  let upper = 0;
  for (let i = 0; i < n; i++) upper = Math.max(upper, Math.pow(c[i].abs(), 1 / (n - i)));
  radius = Math.min(Math.max(radius, 1e-3), 2 * upper || 1);
  let z = [];
  for (let k = 0; k < n; k++) z.push(Complex.polar(radius, (2 * Math.PI * k) / n + 0.4));
  for (let iter = 0; iter < maxIter; iter++) {
    let maxStep = 0;
    const next = z.slice();
    for (let k = 0; k < n; k++) {
      const [p, dp] = evalBoth(z[k]);
      if (p.abs() === 0) continue;
      const ratio = p.div(dp);
      let s = new Complex(0, 0);
      for (let j = 0; j < n; j++) if (j !== k) s = s.add(new Complex(1, 0).div(z[k].sub(z[j])));
      const w = ratio.div(new Complex(1, 0).sub(ratio.mul(s)));
      if (!Number.isFinite(w.re) || !Number.isFinite(w.im)) continue;
      next[k] = z[k].sub(w);
      maxStep = Math.max(maxStep, w.abs() / Math.max(1, z[k].abs()));
    }
    z = next;
    if (maxStep < tol) break;
  }
  // Newton polish and clean tiny imaginary parts.
  for (let k = 0; k < n; k++) {
    for (let it = 0; it < 3; it++) {
      const [p, dp] = evalBoth(z[k]);
      if (dp.abs() === 0) break;
      const step = p.div(dp);
      if (!Number.isFinite(step.re)) break;
      z[k] = z[k].sub(step);
    }
    if (Math.abs(z[k].im) <= 1e-10 * Math.max(1, Math.abs(z[k].re))) z[k] = new Complex(z[k].re, 0);
  }
  return roots.concat(z).sort((a, b) => a.re - b.re || a.im - b.im);
}

