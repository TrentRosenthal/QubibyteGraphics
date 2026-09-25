/**
 * Rational functions: combining over a common denominator (`together`),
 * cancelling common polynomial factors (`cancel`), and partial fraction
 * decomposition over the rationals with steps (`apart`).
 * @module math/ratfunc
 */
import { R0, R1 } from './rational.js';
import { num, sym, add, mul, pow, eq, freeOf, key, listNode } from './expr.js';
import { simplify, expand } from './simplify.js';
import {
  pAdd, pMul, pDivmod, pGcd, pDeg, pTrim, pPrimitive, polyToExpr, factorRational,
} from './poly.js';
import { ensureExpr, varName } from './parse.js';
import { makeStep, linkSteps } from './steps.js';

/** @typedef {import('./expr.js').Expr} Expr */
/** @typedef {import('./poly.js').Poly} Poly */

/**
 * Numerator and denominator polynomials (rational coefficients) of a
 * rational function of x, or null when expr is not one.
 * @param {Expr} expr
 * @param {string} x
 * @returns {{num: Poly, den: Poly}|null}
 */
export function toRationalFunction(expr, x) {
  const walk = (e) => {
    switch (e.type) {
      case 'num': return { num: [e.value], den: [R1] };
      case 'sym': return e.name === x ? { num: [R0, R1], den: [R1] } : null;
      case 'add': {
        let acc = { num: [], den: [R1] };
        for (const a of e.args) {
          const r = walk(a);
          if (!r) return null;
          acc = { num: pAdd(pMul(acc.num, r.den), pMul(r.num, acc.den)), den: pMul(acc.den, r.den) };
        }
        return acc;
      }
      case 'mul': {
        let acc = { num: [R1], den: [R1] };
        for (const a of e.args) {
          const r = walk(a);
          if (!r) return null;
          acc = { num: pMul(acc.num, r.num), den: pMul(acc.den, r.den) };
        }
        return acc;
      }
      case 'pow': {
        const ex = e.args[1];
        if (ex.type !== 'num' || !ex.value.isInteger()) return null;
        const r = walk(e.args[0]);
        if (!r) return null;
        let n = Number(ex.value.n);
        let base = r;
        if (n < 0) {
          if (!pTrim(r.num).length) return null;
          base = { num: r.den, den: r.num };
          n = -n;
        }
        let acc = { num: [R1], den: [R1] };
        for (let i = 0; i < n; i++) acc = { num: pMul(acc.num, base.num), den: pMul(acc.den, base.den) };
        return acc;
      }
      default: return null;
    }
  };
  const r = walk(simplify(expr));
  if (!r || !pTrim(r.den).length) return null;
  return reduce(r.num, r.den);
}

function reduce(n, d) {
  const g = pGcd(n, d);
  let nn = pDivmod(n, g).q;
  let dd = pDivmod(d, g).q;
  const { content, prim } = pPrimitive(dd);
  nn = nn.map((c) => c.div(content));
  dd = prim;
  return { num: pTrim(nn), den: dd };
}

/**
 * Cancel common factors of a rational function in x and return N/D in
 * lowest terms (numerator expanded, denominator factored when it factors
 * over the rationals). Non-rational expressions are returned simplified.
 * @param {Expr|string} expr
 * @param {string} [x='x']
 * @returns {Expr}
 */
export function cancel(expr, x = 'x') {
  const e = ensureExpr(expr);
  const r = toRationalFunction(e, x);
  if (!r) return simplify(e);
  const N = polyToExpr(r.num, x);
  if (pDeg(r.den) === 0) return simplify(mul(N, pow(num(r.den[0]), num(-1))));
  return simplify(mul(N, pow(factoredPoly(r.den, x), num(-1))));
}

/**
 * Expression of a polynomial as a product of its irreducible factors.
 * @param {Poly} p
 * @param {string} x
 * @returns {Expr}
 */
export function factoredPoly(p, x) {
  const f = factorRational(p);
  const parts = [];
  if (!f.content.isOne()) parts.push(num(f.content));
  for (const { poly, mult } of f.factors) {
    const pe = polyToExpr(poly, x);
    parts.push(mult === 1 ? pe : pow(pe, num(mult)));
  }
  if (!parts.length) return num(f.content);
  return parts.length === 1 ? parts[0] : mul(...parts);
}

/**
 * Combine a sum of fractions over a common denominator (works with several
 * variables; the numerator is expanded).
 * @param {Expr|string} expr
 * @returns {Expr}
 */
export function together(expr) {
  const e = simplify(ensureExpr(expr));
  if (e.type !== 'add') return e;
  const parts = e.args.map(splitFraction);
  const denom = new Map();
  for (const p of parts) {
    for (const [k, { base, n }] of p.den) {
      const cur = denom.get(k);
      if (!cur || cur.n.cmp(n) < 0) denom.set(k, { base, n });
    }
  }
  if (!denom.size) return e;
  const numerTerms = parts.map((p) => {
    const extra = [];
    for (const [k, { base, n }] of denom) {
      const have = p.den.get(k);
      const need = have ? n.sub(have.n) : n;
      if (!need.isZero()) extra.push(pow(base, num(need)));
    }
    return mul(p.num, ...extra);
  });
  const N = expand(add(...numerTerms));
  const D = [...denom.values()].map(({ base, n }) => pow(base, num(n)));
  return simplify(mul(N, pow(mul(...D), num(-1))));
}

function splitFraction(t) {
  const factors = t.type === 'mul' ? t.args : [t];
  const numer = [];
  const den = new Map();
  for (const f of factors) {
    if (f.type === 'pow' && f.args[1].type === 'num' && f.args[1].value.isNegative()) {
      den.set(key(f.args[0]), { base: f.args[0], n: f.args[1].value.neg() });
    } else if (f.type === 'num' && !f.value.isInteger()) {
      numer.push(num(f.value.n));
      den.set(key(num(f.value.d)), { base: num(f.value.d), n: R1 });
    } else numer.push(f);
  }
  return { num: numer.length ? mul(...numer) : num(1), den };
}

// Exact Gaussian elimination for a square system with a unique solution.
function solveExact(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    while (p < n && M[p][c].isZero()) p++;
    if (p === n) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const inv = M[c][c].inv();
    for (let j = c; j <= n; j++) M[c][j] = M[c][j].mul(inv);
    for (let r = 0; r < n; r++) {
      if (r === c || M[r][c].isZero()) continue;
      const f = M[r][c];
      for (let j = c; j <= n; j++) M[r][j] = M[r][j].sub(f.mul(M[c][j]));
    }
  }
  return M.map((row) => row[n]);
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVW';

/**
 * @typedef {object} PartialFractions
 * @property {boolean} ok
 * @property {Expr} [result] sum of the partial fractions
 * @property {Expr} [polynomial] polynomial part from long division
 * @property {{numerator: Expr, factor: Expr, power: number, poly: Poly, numPoly: Poly}[]} [terms]
 * @property {import('./steps.js').Step[]} steps
 * @property {string} [reason]
 */

/**
 * Partial fraction decomposition over the rationals, with steps.
 * @param {Expr|string} expr
 * @param {string|Expr} [variable='x']
 * @returns {PartialFractions}
 */
export function apart(expr, variable = 'x') {
  const x = varName(variable);
  const e = ensureExpr(expr);
  const rf = toRationalFunction(e, x);
  if (!rf) return { ok: false, reason: 'Not a rational function of ' + x + ' with rational coefficients', steps: [] };
  const steps = [makeStep(e, 'Start')];
  const X = sym(x);
  let N = rf.num;
  const D = rf.den;
  let polyPart = [];
  if (pDeg(N) >= pDeg(D)) {
    const { q, r } = pDivmod(N, D);
    polyPart = q;
    N = r;
    steps.push(makeStep(add(polyToExpr(q, x), mul(polyToExpr(N, x), pow(polyToExpr(D, x), num(-1)))), 'Polynomial long division'));
  }
  const fac = factorRational(D);
  // Fold the constant into the numerator so factors are primitive.
  N = N.map((c) => c.div(fac.content));
  const denomExpr = mul(...fac.factors.map(({ poly, mult }) => (mult === 1 ? polyToExpr(poly, x) : pow(polyToExpr(poly, x), num(mult)))));
  if (!pTrim(N).length) {
    const result = polyToExpr(polyPart, x);
    return { ok: true, result, polynomial: result, terms: [], steps: linkSteps(steps) };
  }
  const properPart = mul(polyToExpr(N, x), pow(denomExpr, num(-1)));
  steps.push(makeStep(pTrim(polyPart).length ? add(polyToExpr(polyPart, x), properPart) : properPart, 'Factor the denominator'));
  // Unknown numerators.
  const slots = [];
  let letter = 0;
  for (const { poly, mult } of fac.factors) {
    const k = pDeg(poly);
    for (let j = 1; j <= mult; j++) {
      const coeffNames = [];
      for (let c = 0; c < k; c++) coeffNames.push(LETTERS[letter++ % LETTERS.length] + (letter > LETTERS.length ? letter : ''));
      slots.push({ poly, j, mult, coeffNames });
    }
  }
  const template = add(...slots.map((s) => {
    const numer = add(...s.coeffNames.map((nm, c) => (c === 0 ? sym(nm) : mul(sym(nm), c === 1 ? X : pow(X, num(c))))));
    const f = polyToExpr(s.poly, x);
    return mul(numer, pow(s.j === 1 ? f : pow(f, num(s.j)), num(-1)));
  }));
  steps.push(makeStep(eq(mul(polyToExpr(N, x), pow(denomExpr, num(-1))), template), 'Set up partial fractions'));
  // Build the linear system: N = sum_s numer_s * D / f_s^j.
  let Dfull = [R1];
  for (const { poly, mult } of fac.factors) for (let j = 0; j < mult; j++) Dfull = pMul(Dfull, poly);
  const unknowns = slots.flatMap((s) => s.coeffNames);
  const n = unknowns.length;
  const columns = [];
  for (const s of slots) {
    let fj = [R1];
    for (let j = 0; j < s.j; j++) fj = pMul(fj, s.poly);
    const cof = pDivmod(Dfull, fj).q;
    for (let c = 0; c < s.coeffNames.length; c++) {
      const shifted = new Array(c).fill(R0).concat(cof);
      columns.push(shifted);
    }
  }
  const A = [];
  const b = [];
  for (let row = 0; row < n; row++) {
    A.push(columns.map((col) => col[row] || R0));
    b.push(N[row] || R0);
  }
  const sol = solveExact(A, b);
  if (!sol) return { ok: false, reason: 'Partial fraction system is singular', steps: linkSteps(steps) };
  steps.push(makeStep(listNode(unknowns.map((u, i) => eq(sym(u), num(sol[i])))), 'Solve for the coefficients', {
    note: 'Matching coefficients of ' + x + ' gives ' + unknowns.map((u, i) => u + ' = ' + sol[i].toString()).join(', '),
  }));
  const terms = [];
  let idx = 0;
  for (const s of slots) {
    const numPoly = pTrim(s.coeffNames.map(() => sol[idx++]));
    if (!numPoly.length) continue;
    const f = polyToExpr(s.poly, x);
    terms.push({ numerator: polyToExpr(numPoly, x), factor: f, power: s.j, poly: s.poly, numPoly });
  }
  const pieces = terms.map((t) => mul(t.numerator, pow(t.power === 1 ? t.factor : pow(t.factor, num(t.power)), num(-1))));
  const polyExpr = polyToExpr(polyPart, x);
  const raw = add(...(pTrim(polyPart).length ? [polyExpr] : []), ...pieces.map(simplify));
  steps.push(makeStep(raw, 'Partial fraction decomposition'));
  return { ok: true, result: raw, polynomial: polyExpr, terms, steps: linkSteps(steps) };
}

/**
 * True when expr is free of x or a rational function of x.
 * @param {Expr} expr
 * @param {string} x
 * @returns {boolean}
 */
export function isRationalIn(expr, x) {
  return freeOf(expr, x) || toRationalFunction(expr, x) !== null;
}

