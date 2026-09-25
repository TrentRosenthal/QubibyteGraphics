/**
 * Symbolic integration with steps, and definite integrals.
 *
 * The integrator searches for a proof tree (with backtracking) using, in
 * order: the constant rule, linearity, table lookups (including linear inner
 * arguments), rational functions (polynomial division and partial
 * fractions), u-substitution, trig powers and products, the cyclic
 * e^(ax) sin(bx) form, integration by parts (LIATE, repeated), and
 * expansion. The tree is then rendered as a sequence of whole-expression
 * steps, each applying one rule to one pending integral. Every
 * antiderivative is verified by differentiating it and comparing with the
 * integrand at sample points; a result that fails the check is not
 * returned.
 * @module math/integrate
 */
import { Rational } from './rational.js';
import {
  num, sym, constant, add, mul, pow, fn, integral, bracket, freeOf, key, symbols, substitute,
  replaceSubtree, withArgs, walk, size, MathError,
} from './expr.js';
import { simplify, expand } from './simplify.js';
import { ensureExpr, varName } from './parse.js';
import { diff } from './diff.js';
import { polyCoeffs, toPoly, pDeg } from './poly.js';
import { toRationalFunction, apart, cancel } from './ratfunc.js';
import { compileReal } from './evaluate.js';
import { makeStep, linkSteps } from './steps.js';
import { toLatex } from './latex.js';
import { gaussKronrod } from './quadrature.js';
import { limit, infinitySign } from './limits.js';

/** @typedef {import('./expr.js').Expr} Expr */

const TRIG = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot']);

function isZero(e) {
  return e.type === 'num' && e.value.isZero();
}

function linearParts(u, x) {
  if (u.type === 'sym' && u.name === x) return { a: num(1), b: num(0), trivial: true };
  if (freeOf(u, x)) return null;
  const cs = polyCoeffs(u, x);
  if (!cs || cs.length !== 2 || isZero(cs[1])) return null;
  return { a: cs[1], b: cs[0], trivial: false };
}

function leaf(rule, f, x, F, note) {
  const out = simplify(F);
  return { rule, f, v: x, F: out, children: [], combine: () => out, note };
}

function over(e, a) {
  return mul(e, pow(a, num(-1)));
}

// Antiderivative of fn(name, u) with respect to u.
function baseAnti(name, u) {
  switch (name) {
    case 'sin': return mul(num(-1), fn('cos', u));
    case 'cos': return fn('sin', u);
    case 'tan': return mul(num(-1), fn('ln', fn('abs', fn('cos', u))));
    case 'sec': return fn('ln', fn('abs', add(fn('sec', u), fn('tan', u))));
    case 'csc': return mul(num(-1), fn('ln', fn('abs', add(fn('csc', u), fn('cot', u)))));
    case 'cot': return fn('ln', fn('abs', fn('sin', u)));
    case 'sinh': return fn('cosh', u);
    case 'cosh': return fn('sinh', u);
    case 'tanh': return fn('ln', fn('cosh', u));
    case 'exp': return pow(constant('e'), u);
    case 'ln': return add(mul(u, fn('ln', u)), mul(num(-1), u));
    case 'asin': return add(mul(u, fn('asin', u)), pow(add(num(1), mul(num(-1), pow(u, num(2)))), num('1/2')));
    case 'acos': return add(mul(u, fn('acos', u)), mul(num(-1), pow(add(num(1), mul(num(-1), pow(u, num(2)))), num('1/2'))));
    case 'atan': return add(mul(u, fn('atan', u)), mul(num('-1/2'), fn('ln', add(num(1), pow(u, num(2))))));
    case 'abs': return mul(num('1/2'), u, fn('abs', u));
    case 'sign': return fn('abs', u);
    default: return null;
  }
}

const FN_NAMES = {
  sin: 'sine', cos: 'cosine', tan: 'tangent', sec: 'secant', csc: 'cosecant', cot: 'cotangent', sinh: 'sinh',
  cosh: 'cosh', tanh: 'tanh', exp: 'the exponential', ln: 'ln', asin: 'arcsine', acos: 'arccosine', atan: 'arctangent',
  abs: 'absolute value', sign: 'sign',
};

function linearRule(lin, base) {
  return lin.trivial ? base : 'Linear substitution';
}

function linearNote(lin, u) {
  if (lin.trivial) return undefined;
  return 'u = ' + toLatex(simplify(u)) + ', \\; du = ' + toLatex(simplify(lin.a)) + '\\,dx';
}

// Quadratic p x^2 + q (no linear term) with rational p, q.
function pureQuadratic(u, x) {
  const cs = polyCoeffs(u, x);
  if (!cs || cs.length !== 3 || !isZero(cs[1]) || cs[0].type !== 'num' || cs[2].type !== 'num' || isZero(cs[0])) return null;
  return { p: cs[2].value, q: cs[0].value };
}

function tableLookup(f, x) {
  const X = sym(x);
  if (f.type === 'sym' && f.name === x) return leaf('Power rule', f, x, over(pow(X, num(2)), num(2)));
  if (f.type === 'fn' && !f.args[1]) {
    const u = f.args[0];
    const lin = linearParts(u, x);
    if (lin) {
      const G = baseAnti(f.name, u);
      if (G) return leaf(linearRule(lin, 'Integral of ' + FN_NAMES[f.name]), f, x, over(G, lin.a), linearNote(lin, u));
    }
  }
  if (f.type === 'fn' && f.name === 'log' && f.args[1] && freeOf(f.args[1], x)) {
    const lin = linearParts(f.args[0], x);
    if (lin) {
      const G = over(baseAnti('ln', f.args[0]), mul(lin.a, fn('ln', f.args[1])));
      return leaf('Integral of a logarithm', f, x, G, 'Change of base: \\log_b u = \\frac{\\ln u}{\\ln b}');
    }
  }
  if (f.type === 'pow') {
    const [b, e] = f.args;
    if (freeOf(e, x)) {
      const lin = linearParts(b, x);
      if (lin) {
        if (e.type === 'num' && e.value.eq(Rational.from(-1))) {
          return leaf(linearRule(lin, 'Integral of 1/' + x), f, x, over(fn('ln', fn('abs', b)), lin.a), linearNote(lin, b));
        }
        const e1 = simplify(add(e, num(1)));
        return leaf(linearRule(lin, 'Power rule'), f, x, over(pow(b, e1), mul(e1, lin.a)), linearNote(lin, b));
      }
      if (b.type === 'fn' && e.type === 'num' && e.value.isInteger()) {
        const lin = linearParts(b.args[0], x);
        const k = Number(e.value.n);
        if (lin) {
          const u = b.args[0];
          const table = {
            'sec,2': [fn('tan', u), 'Integral of sec squared'],
            'cos,-2': [fn('tan', u), 'Integral of sec squared'],
            'csc,2': [mul(num(-1), fn('cot', u)), 'Integral of csc squared'],
            'sin,-2': [mul(num(-1), fn('cot', u)), 'Integral of csc squared'],
            'cos,-1': [baseAnti('sec', u), 'Integral of secant'],
            'sin,-1': [baseAnti('csc', u), 'Integral of cosecant'],
            'cosh,-2': [fn('tanh', u), 'Integral of sech squared'],
          };
          const hit = table[b.name + ',' + k];
          if (hit) return leaf(linearRule(lin, hit[1]), f, x, over(hit[0], lin.a), linearNote(lin, u));
        }
      }
      // 1/sqrt(q + p x^2) and sqrt(q + p x^2).
      if (e.type === 'num' && (e.value.eq(Rational.from('-1/2')) || e.value.eq(Rational.from('1/2')))) {
        const pq = pureQuadratic(b, x);
        if (pq) {
          const sp = simplify(pow(num(pq.p.abs()), num('1/2')));
          const sq = pow(b, num('1/2'));
          let inv;
          let rule;
          if (pq.p.isNegative() && pq.q.sign() > 0) {
            inv = over(fn('asin', mul(X, pow(num(pq.p.neg().div(pq.q)), num('1/2')))), sp);
            rule = 'Inverse sine form';
          } else if (pq.p.sign() > 0) {
            inv = over(fn('ln', fn('abs', add(mul(sp, X), sq))), sp);
            rule = 'Inverse hyperbolic form';
          }
          if (inv && e.value.isNegative()) return leaf(rule, f, x, inv);
          if (inv) {
            const F = add(mul(num('1/2'), X, sq), mul(num(pq.q), num('1/2'), inv));
            return leaf('Integral of a square root of a quadratic', f, x, F);
          }
        }
      }
    }
    if (freeOf(b, x)) {
      const lin = linearParts(e, x);
      if (lin) {
        const isE = b.type === 'const' && b.name === 'e';
        const F = isE ? over(f, lin.a) : over(f, mul(lin.a, fn('ln', b)));
        return leaf(linearRule(lin, 'Exponential rule'), f, x, F, linearNote(lin, e));
      }
    }
  }
  if (f.type === 'mul' && f.args.length === 2) {
    const [p, q] = f.args;
    if (p.type === 'fn' && q.type === 'fn' && key(p.args[0]) === key(q.args[0])) {
      const u = p.args[0];
      const lin = linearParts(u, x);
      const names = [p.name, q.name].sort().join(',');
      if (lin && names === 'sec,tan') return leaf(linearRule(lin, 'Integral of sec tan'), f, x, over(fn('sec', u), lin.a), linearNote(lin, u));
      if (lin && names === 'cot,csc') return leaf(linearRule(lin, 'Integral of csc cot'), f, x, over(mul(num(-1), fn('csc', u)), lin.a), linearNote(lin, u));
    }
  }
  return null;
}

class Search {
  constructor() {
    this.budget = 4000;
    this.active = new Set();
    this.partsDepth = 0;
    this.reserved = new Set();
  }

  freshName(f, x) {
    const used = new Set([...symbols(f), x, ...this.reserved]);
    for (const n of ['u', 'w', 't', 'v', 's', 'z']) if (!used.has(n)) return n;
    let i = 1;
    while (used.has('u_' + i)) i++;
    return 'u_' + i;
  }
}

function solve(f0, x, S, depth) {
  if (--S.budget < 0 || depth > 14) return null;
  const f = simplify(f0);
  const k = x + '|' + key(f);
  if (S.active.has(k)) return null;
  S.active.add(k);
  try {
    return solveInner(f, x, S, depth);
  } catch (err) {
    if (err instanceof MathError) return null;
    throw err;
  } finally {
    S.active.delete(k);
  }
}

function solveInner(f, x, S, depth) {
  if (freeOf(f, x)) return leaf('Constant rule', f, x, mul(f, sym(x)));
  if (f.type === 'add') {
    const kids = f.args.map((t) => solve(t, x, S, depth + 1));
    if (kids.every(Boolean)) return { rule: 'Sum rule', f, v: x, children: kids, combine: (p) => add(...p) };
  }
  if (f.type === 'mul') {
    const cs = f.args.filter((a) => freeOf(a, x));
    if (cs.length) {
      const rest = f.args.filter((a) => !freeOf(a, x));
      const c = simplify(mul(...cs));
      const child = solve(rest.length === 1 ? rest[0] : mul(...rest), x, S, depth + 1);
      if (child) return { rule: 'Constant multiple rule', f, v: x, children: [child], combine: (p) => mul(c, p[0]) };
      return null;
    }
  }
  const t = tableLookup(f, x);
  if (t) return t;
  return tryRational(f, x, S, depth)
    || trySubstitution(f, x, S, depth)
    || tryTrig(f, x, S, depth)
    || tryCyclic(f, x)
    || tryLinearRadical(f, x, S, depth)
    || tryParts(f, x, S, depth)
    || tryExpand(f, x, S, depth);
}

function tryExpand(f, x, S, depth) {
  let e;
  try {
    e = expand(f);
  } catch {
    return null;
  }
  if (key(e) === key(f)) return null;
  const child = solve(e, x, S, depth + 1);
  if (!child) return null;
  return { rule: 'Expand', f, v: x, children: [child], combine: (p) => p[0] };
}

// (B x + C) / (a x^2 + b x + c) with a quadratic irreducible over Q.
function quadraticLeaf(f, x, numPoly, quad) {
  const X = sym(x);
  const [c, b, a] = quad.map((r) => num(r));
  const B = numPoly[1] ? num(numPoly[1]) : num(0);
  const C = numPoly[0] ? num(numPoly[0]) : num(0);
  const Q = add(mul(a, pow(X, num(2))), mul(b, X), c);
  const disc = quad[0].mul(quad[2]).mul(Rational.from(4)).sub(quad[1].mul(quad[1]));
  const logPart = mul(B, over(fn('ln', fn('abs', Q)), mul(num(2), a)));
  const rest = simplify(add(C, mul(num(-1), B, b, over(num(1), mul(num(2), a)))));
  let inner;
  if (disc.sign() > 0) {
    const r = pow(num(disc), num('1/2'));
    inner = mul(num(2), over(fn('atan', over(add(mul(num(2), a, X), b), r)), r));
  } else {
    const r = pow(num(disc.neg()), num('1/2'));
    const lin = add(mul(num(2), a, X), b);
    inner = over(fn('ln', fn('abs', over(add(lin, mul(num(-1), r)), add(lin, r)))), r);
  }
  const F = add(logPart, mul(rest, inner));
  return leaf('Complete the square', f, x, F, 'Split the numerator into a multiple of the derivative of the denominator plus a constant');
}

function tryRational(f, x, S, depth) {
  const rf = toRationalFunction(f, x);
  if (!rf) return null;
  if (pDeg(rf.den) === 0) return tryExpand(f, x, S, depth);
  // A substitution often gives a neater answer (x / (x^2 + 1)).
  const sub = trySubstitution(f, x, S, depth);
  if (sub) return sub;
  const pf = apart(f, x);
  if (!pf.ok) return null;
  const pieces = [];
  if (pf.polynomial && !isZero(pf.polynomial)) pieces.push({ expr: pf.polynomial, poly: true });
  for (const t of pf.terms) pieces.push({ expr: simplify(over(t.numerator, t.power === 1 ? t.factor : pow(t.factor, num(t.power)))), term: t });
  const kids = [];
  for (const p of pieces) {
    if (p.poly) {
      const k = solve(p.expr, x, S, depth + 1);
      if (!k) return null;
      kids.push(k);
      continue;
    }
    const deg = pDeg(p.term.poly);
    if (deg === 1) {
      const k = solve(p.expr, x, S, depth + 1);
      if (!k) return null;
      kids.push(k);
    } else if (deg === 2 && p.term.power === 1) {
      kids.push(quadraticLeaf(p.expr, x, p.term.numPoly, p.term.poly));
    } else {
      return null;
    }
  }
  if (kids.length === 1 && key(kids[0].f) === key(f)) return kids[0];
  return { rule: 'Partial fraction decomposition', f, v: x, children: kids, combine: (p) => add(...p), note: toLatex(pf.result) };
}

function isLinear(u, x) {
  return linearParts(u, x) !== null;
}

// Candidate inner functions for u-substitution: arguments, bases and
// exponents first (the textbook choice), then whole function applications.
function substitutionCandidates(f, x) {
  const inner = new Map();
  const outer = new Map();
  const addCand = (g, tier) => {
    if (freeOf(g, x) || isLinear(g, x)) return;
    const k = key(g);
    if (!inner.has(k) && !outer.has(k)) tier.set(k, g);
  };
  walk(f, (n) => {
    if (n.type === 'fn') {
      addCand(n.args[0], inner);
      if (n !== f) addCand(n, outer);
    } else if (n.type === 'pow') {
      addCand(n.args[0], inner);
      addCand(n.args[1], inner);
      if (n !== f && (freeOf(n.args[0], x) || (n.args[1].type === 'num' && !n.args[1].value.isInteger()))) addCand(n, outer);
    }
  });
  const bySize = (a, b) => size(b) - size(a);
  return [...[...inner.values()].sort(bySize), ...[...outer.values()].sort(bySize)];
}

// Radicals of a linear expression: substitute u = a x + b everywhere.
function tryLinearRadical(f, x, S, depth) {
  let L = null;
  walk(f, (n) => {
    if (!L && n.type === 'pow' && n.args[1].type === 'num' && !n.args[1].value.isInteger()) {
      const lin = linearParts(n.args[0], x);
      if (lin && !lin.trivial) L = { g: n.args[0], ...lin };
    }
  });
  if (!L) return null;
  const u = S.freshName(f, x);
  const U = sym(u);
  const xOfU = mul(add(U, mul(num(-1), L.b)), pow(L.a, num(-1)));
  const h = simplify(mul(replaceSubtree(substitute(f, { [x]: xOfU }), simplify(substitute(L.g, { [x]: xOfU })), U), pow(L.a, num(-1))));
  let he;
  try {
    he = expand(h);
  } catch {
    return null;
  }
  S.reserved.add(u);
  const child = solve(he, u, S, depth + 1);
  S.reserved.delete(u);
  if (!child) return null;
  return {
    rule: 'u-substitution', f, v: x, children: [child], combine: (p) => p[0], backSub: { u, g: L.g },
    note: u + ' = ' + toLatex(L.g) + ', \\; ' + x + ' = ' + toLatex(simplify(xOfU)) + ', \\; d' + u + ' = ' + toLatex(L.a) + '\\,d' + x,
  };
}

// Rewrite powers of x (or of e^(kx)) in terms of U when g = x^k or g = e^(kx).
function powerSubstitute(q, g, U, x) {
  let base = null;
  let k = null;
  if (g.type === 'pow' && g.args[0].type === 'sym' && g.args[0].name === x && g.args[1].type === 'num') {
    base = 'x';
    k = g.args[1].value;
  } else if (g.type === 'pow' && g.args[0].type === 'const' && g.args[0].name === 'e') {
    const lin = linearParts(g.args[1], x);
    if (!lin || !isZero(lin.b) || lin.a.type !== 'num') return null;
    base = 'e';
    k = lin.a.value;
  } else return null;
  let failed = false;
  const walkNode = (n) => {
    if (failed) return n;
    if (base === 'x' && n.type === 'sym' && n.name === x) {
      const m = Rational.from(1).div(k);
      if (!m.isInteger()) failed = true;
      return pow(U, num(m));
    }
    if (base === 'x' && n.type === 'pow' && n.args[0].type === 'sym' && n.args[0].name === x && n.args[1].type === 'num') {
      const m = n.args[1].value.div(k);
      if (!m.isInteger()) failed = true;
      return pow(U, num(m));
    }
    if (base === 'e' && n.type === 'pow' && n.args[0].type === 'const' && n.args[0].name === 'e') {
      const lin = linearParts(n.args[1], x);
      if (lin && isZero(lin.b) && lin.a.type === 'num') {
        const m = lin.a.value.div(k);
        if (!m.isInteger()) failed = true;
        return pow(U, num(m));
      }
    }
    return n.args ? withArgs(n, n.args.map(walkNode)) : n;
  };
  const out = walkNode(q);
  return failed ? null : simplify(out);
}

function trySubstitution(f, x, S, depth) {
  for (const g of substitutionCandidates(f, x)) {
    const gp = diff(g, x);
    if (isZero(gp)) continue;
    const u = S.freshName(f, x);
    const U = sym(u);
    let q;
    try {
      q = simplify(mul(f, pow(gp, num(-1))));
    } catch {
      continue;
    }
    let h = simplify(replaceSubtree(q, g, U));
    if (!freeOf(h, x)) {
      const c = cancel(q, x);
      const h2 = simplify(replaceSubtree(c, g, U));
      if (freeOf(h2, x)) h = h2;
    }
    if (!freeOf(h, x)) {
      const h3 = powerSubstitute(q, g, U, x);
      if (h3 && freeOf(h3, x)) h = h3;
    }
    if (!freeOf(h, x)) continue;
    S.reserved.add(u);
    const child = solve(h, u, S, depth + 1);
    S.reserved.delete(u);
    if (!child) continue;
    return {
      rule: 'u-substitution', f, v: x, children: [child], combine: (p) => p[0],
      backSub: { u, g }, note: u + ' = ' + toLatex(g) + ', \\; d' + u + ' = ' + toLatex(gp) + '\\,d' + x,
    };
  }
  return null;
}

// Exponents of sin and cos when f is a product of trig powers of one linear argument.
function trigForm(f, x) {
  const factors = f.type === 'mul' ? f.args : [f];
  let m = 0;
  let n = 0;
  let arg = null;
  for (const g of factors) {
    const base = g.type === 'pow' ? g.args[0] : g;
    const ex = g.type === 'pow' ? g.args[1] : num(1);
    if (base.type !== 'fn' || !TRIG.has(base.name) || ex.type !== 'num' || !ex.value.isInteger()) return null;
    if (arg && key(arg) !== key(base.args[0])) return null;
    arg = base.args[0];
    const k = Number(ex.value.n);
    switch (base.name) {
      case 'sin': m += k; break;
      case 'cos': n += k; break;
      case 'tan': m += k; n -= k; break;
      case 'cot': m -= k; n += k; break;
      case 'sec': n -= k; break;
      default: m -= k;
    }
  }
  const lin = arg && linearParts(arg, x);
  if (!lin) return null;
  return { m, n, L: arg, a: lin.a };
}

function trigSub(f, x, S, depth, which, h, note) {
  const u = S.freshName(f, x);
  const U = sym(u);
  const hu = simplify(substitute(h, { __u__: U }));
  S.reserved.add(u);
  const child = solve(hu, u, S, depth + 1);
  S.reserved.delete(u);
  if (!child) return null;
  return { rule: 'Trig substitution', f, v: x, children: [child], combine: (p) => p[0], backSub: { u, g: which }, note };
}

function tryTrig(f, x, S, depth) {
  const prod = productToSum(f, x);
  if (prod) {
    const child = solve(prod, x, S, depth + 1);
    if (child) return { rule: 'Product-to-sum identity', f, v: x, children: [child], combine: (p) => p[0] };
  }
  const tf = trigForm(f, x);
  if (!tf) return null;
  const { m, n, L, a } = tf;
  const W = sym('__u__');
  const one = num(1);
  const oneMinus = add(one, mul(num(-1), pow(W, num(2))));
  // Odd reduction formulas for pure sec^k and csc^k, k >= 3.
  if (m === 0 && n <= -3 && n % 2 !== 0) return reduction(f, x, S, depth, 'sec', -n, L, a);
  if (n === 0 && m <= -3 && m % 2 !== 0) return reduction(f, x, S, depth, 'csc', -m, L, a);
  if (Math.abs(m) % 2 === 1) {
    const h = mul(num(-1), pow(oneMinus, num((m - 1) / 2)), pow(W, num(n)), pow(a, num(-1)));
    const r = trigSub(f, x, S, depth, fn('cos', L), h, 'u = \\cos(' + toLatex(L) + '), \\; \\sin^{2} = 1 - \\cos^{2}');
    if (r) return r;
  }
  if (Math.abs(n) % 2 === 1) {
    const h = mul(pow(oneMinus, num((n - 1) / 2)), pow(W, num(m)), pow(a, num(-1)));
    const r = trigSub(f, x, S, depth, fn('sin', L), h, 'u = \\sin(' + toLatex(L) + '), \\; \\cos^{2} = 1 - \\sin^{2}');
    if (r) return r;
  }
  if (m % 2 === 0 && n % 2 === 0) {
    if (m >= 0 && n >= 0) {
      const s2 = mul(num('1/2'), add(one, mul(num(-1), fn('cos', mul(num(2), L)))));
      const c2 = mul(num('1/2'), add(one, fn('cos', mul(num(2), L))));
      const e = expand(mul(pow(s2, num(m / 2)), pow(c2, num(n / 2))));
      const child = solve(e, x, S, depth + 1);
      if (child) return { rule: 'Power-reduction identity', f, v: x, children: [child], combine: (p) => p[0], note: '\\sin^{2} u = \\frac{1 - \\cos 2u}{2}, \\; \\cos^{2} u = \\frac{1 + \\cos 2u}{2}' };
      return null;
    }
    const p = m;
    const q = -(m + n);
    if (m >= 0 && q >= 2) {
      const h = mul(pow(W, num(p)), pow(add(one, pow(W, num(2))), num((q - 2) / 2)), pow(a, num(-1)));
      return trigSub(f, x, S, depth, fn('tan', L), h, 'u = \\tan(' + toLatex(L) + '), \\; \\sec^{2} = 1 + \\tan^{2}');
    }
    if (n >= 0 && m < 0) {
      const qc = -(m + n);
      if (qc >= 2) {
        const h = mul(num(-1), pow(W, num(n)), pow(add(one, pow(W, num(2))), num((qc - 2) / 2)), pow(a, num(-1)));
        return trigSub(f, x, S, depth, fn('cot', L), h, 'u = \\cot(' + toLatex(L) + '), \\; \\csc^{2} = 1 + \\cot^{2}');
      }
    }
    if (m >= 2 && q === 0) {
      const t = fn('tan', L);
      const kids = [solve(mul(pow(t, num(m - 2)), pow(fn('sec', L), num(2))), x, S, depth + 1), solve(pow(t, num(m - 2)), x, S, depth + 1)];
      if (kids.every(Boolean)) return { rule: 'Pythagorean identity', f, v: x, children: kids, combine: (pp) => add(pp[0], mul(num(-1), pp[1])), note: '\\tan^{2} u = \\sec^{2} u - 1' };
    }
    if (m < 0 && n < 0) {
      const kids = [solve(mul(pow(fn('sin', L), num(m + 2)), pow(fn('cos', L), num(n))), x, S, depth + 1), solve(mul(pow(fn('sin', L), num(m)), pow(fn('cos', L), num(n + 2))), x, S, depth + 1)];
      if (kids.every(Boolean)) return { rule: 'Pythagorean identity', f, v: x, children: kids, combine: (pp) => add(...pp), note: '1 = \\sin^{2} u + \\cos^{2} u' };
    }
  }
  return null;
}

function reduction(f, x, S, depth, name, k, L, a) {
  const other = name === 'sec' ? 'tan' : 'cot';
  const sign = name === 'sec' ? 1 : -1;
  const lower = k - 2 === 1 ? fn(name, L) : pow(fn(name, L), num(k - 2));
  const child = solve(lower, x, S, depth + 1);
  if (!child) return null;
  const head = mul(num(sign), pow(fn(name, L), num(k - 2)), fn(other, L), pow(mul(num(k - 1), a), num(-1)));
  const frac = num(new Rational(BigInt(k - 2), BigInt(k - 1)));
  return {
    rule: 'Reduction formula', f, v: x, children: [child], combine: (p) => add(head, mul(frac, p[0])),
    note: '\\int \\' + name + '^{n} u \\, du = ' + (sign < 0 ? '-' : '') + '\\frac{\\' + name + '^{n-2} u \\' + other + ' u}{n-1} + \\frac{n-2}{n-1} \\int \\' + name + '^{n-2} u \\, du',
  };
}

function productToSum(f, x) {
  if (f.type !== 'mul' || f.args.length !== 2) return null;
  const [p, q] = f.args;
  if (p.type !== 'fn' || q.type !== 'fn' || !['sin', 'cos'].includes(p.name) || !['sin', 'cos'].includes(q.name)) return null;
  if (key(p.args[0]) === key(q.args[0])) return null;
  if (!isLinear(p.args[0], x) || !isLinear(q.args[0], x)) return null;
  const A = p.args[0];
  const B = q.args[0];
  const sum = add(A, B);
  const diffAB = add(A, mul(num(-1), B));
  const h = num('1/2');
  if (p.name === 'sin' && q.name === 'cos') return simplify(mul(h, add(fn('sin', sum), fn('sin', diffAB))));
  if (p.name === 'cos' && q.name === 'sin') return simplify(mul(h, add(fn('sin', sum), mul(num(-1), fn('sin', diffAB)))));
  if (p.name === 'sin') return simplify(mul(h, add(fn('cos', diffAB), mul(num(-1), fn('cos', sum)))));
  return simplify(mul(h, add(fn('cos', diffAB), fn('cos', sum))));
}

// e^(L1) sin(L2) and e^(L1) cos(L2): parts twice returns the original integral.
function tryCyclic(f, x) {
  if (f.type !== 'mul' || f.args.length !== 2) return null;
  const ex = f.args.find((a) => a.type === 'pow' && a.args[0].type === 'const' && a.args[0].name === 'e');
  const tr = f.args.find((a) => a.type === 'fn' && (a.name === 'sin' || a.name === 'cos'));
  if (!ex || !tr) return null;
  const l1 = linearParts(ex.args[1], x);
  const l2 = linearParts(tr.args[0], x);
  if (!l1 || !l2) return null;
  const a = l1.a;
  const c = l2.a;
  const denom = add(pow(a, num(2)), pow(c, num(2)));
  const s = fn('sin', tr.args[0]);
  const co = fn('cos', tr.args[0]);
  const inner = tr.name === 'sin' ? add(mul(a, s), mul(num(-1), c, co)) : add(mul(a, co), mul(c, s));
  const F = mul(ex, inner, pow(denom, num(-1)));
  return leaf('Integration by parts twice', f, x, F, 'Two rounds of integration by parts give I = (\\text{terms}) - k I, then solve for I');
}

function liate(g, x) {
  const base = g.type === 'pow' && g.args[1].type === 'num' && g.args[1].value.sign() > 0 ? g.args[0] : g;
  if (base.type === 'fn' && (base.name === 'ln' || base.name === 'log')) return 5;
  if (base.type === 'fn' && ['asin', 'acos', 'atan'].includes(base.name)) return 4;
  if (toPoly(g, x)) return 3;
  if (base.type === 'fn' && (TRIG.has(base.name) || base.name === 'sinh' || base.name === 'cosh')) return 2;
  if (g.type === 'pow' && freeOf(g.args[0], x)) return 1;
  return 0;
}

function tryParts(f, x, S, depth) {
  if (S.partsDepth >= 5) return null;
  const factors = f.type === 'mul' ? f.args : [f];
  const ranked = factors.map((g, i) => ({ g, i, r: liate(g, x) })).sort((p, q) => q.r - p.r);
  const best = ranked[0];
  if (factors.length === 1 && best.r < 4) return null;
  if (factors.length > 1 && best.r < 3) return null;
  const u = best.g;
  const dvFactors = factors.filter((_, i) => i !== best.i);
  const dv = dvFactors.length ? simplify(mul(...dvFactors)) : num(1);
  S.partsDepth++;
  try {
    const vNode = solve(dv, x, S, depth + 1);
    if (!vNode) return null;
    const v = nodeResult(vNode);
    const du = diff(u, x);
    const rest = simplify(mul(v, du));
    const child = solve(rest, x, S, depth + 1);
    if (!child) return null;
    return {
      rule: 'Integration by parts', f, v: x, children: [child], combine: (p) => add(mul(u, v), mul(num(-1), p[0])),
      note: 'u = ' + toLatex(u) + ', \\; dv = ' + toLatex(dv) + '\\,d' + x + ', \\; du = ' + toLatex(du) + '\\,d' + x + ', \\; v = ' + toLatex(v),
    };
  } finally {
    S.partsDepth--;
  }
}

// The antiderivative of a proof tree node.
function nodeResult(node) {
  if (node.F && !node.children.length) return node.F;
  let r = node.combine(node.children.map(nodeResult));
  if (node.backSub) r = substitute(r, { [node.backSub.u]: node.backSub.g });
  return simplify(r);
}

function renderSteps(root, start, x) {
  const steps = [makeStep(start, 'Integrate')];
  let current = start;
  const replace = (e, target, repl) => (e === target ? repl : e.args ? withArgs(e, e.args.map((a) => replace(a, target, repl))) : e);
  const process = (node, target) => {
    const kids = node.children.map((c) => integral(c.f, c.v));
    const rw = node.children.length ? node.combine(kids) : node.F;
    current = replace(current, target, rw);
    steps.push(makeStep(current, node.rule, node.note ? { note: node.note } : {}));
    node.children.forEach((c, i) => process(c, kids[i]));
    if (node.backSub) {
      current = substitute(current, { [node.backSub.u]: node.backSub.g });
      steps.push(makeStep(current, 'Substitute back', { note: node.backSub.u + ' = ' + toLatex(node.backSub.g) }));
    }
  };
  const f = simplify(start.args[0]);
  let target = start;
  if (key(f) !== key(start.args[0])) {
    target = integral(f, x);
    current = target;
    steps.push(makeStep(target, 'Simplify the integrand'));
  }
  process(root, target);
  return { steps, raw: current };
}

// Check dF/dx = f at sample points where both are finite.
function verify(F, f, x) {
  const others = [...symbols(f)].filter((s) => s !== x);
  const vars = [x, ...others];
  let dF;
  let g;
  let h;
  try {
    dF = diff(F, x);
    g = compileReal(dF, vars);
    h = compileReal(f, vars);
  } catch {
    return false;
  }
  const pts = [0.37, 1.21, 2.53, -0.61, -1.73, 0.93, 3.7, -2.9, 0.11, 5.3];
  const params = others.map((_, i) => 1.3 + 0.7 * i);
  let checked = 0;
  for (const p of pts) {
    const a = g(p, ...params);
    const b = h(p, ...params);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (Math.abs(a - b) > 1e-6 * (1 + Math.abs(b))) return false;
    checked++;
  }
  return checked >= 3;
}

/**
 * @typedef {object} IntegralResult
 * @property {boolean} ok
 * @property {Expr} [result] antiderivative (without the constant)
 * @property {string} [latex] LaTeX of the antiderivative plus C
 * @property {import('./steps.js').Step[]} steps
 * @property {string} [reason]
 */

/**
 * Indefinite integral with steps.
 * @param {Expr|string} expr
 * @param {string|Expr} [variable='x']
 * @returns {IntegralResult}
 */
export function integrate(expr, variable = 'x') {
  const x = varName(variable);
  const f0 = ensureExpr(expr);
  const start = integral(f0, x);
  const f = simplify(f0);
  const S = new Search();
  const root = solve(f, x, S, 0);
  if (!root) return { ok: false, reason: 'No elementary antiderivative found', steps: [makeStep(start, 'Integrate')] };
  const F = nodeResult(root);
  if (!verify(F, f, x)) return { ok: false, reason: 'The candidate antiderivative failed the derivative check', steps: [makeStep(start, 'Integrate')] };
  const { steps } = renderSteps(root, start, x);
  steps.push(makeStep(F, 'Simplify'));
  const withC = add(F, sym('C'));
  steps.push(makeStep(withC, 'Add the constant of integration'));
  return { ok: true, result: F, latex: toLatex(withC), steps: linkSteps(steps) };
}

// Real points in (a, b) where a polynomial denominator of f vanishes.
function interiorSingularities(f, x, a, b) {
  const out = [];
  walk(f, (n) => {
    if (n.type === 'pow' && n.args[1].type === 'num' && n.args[1].value.isNegative()) {
      const p = toPoly(n.args[0], x);
      if (p && p.length > 1) {
        const coeffs = p.map((c) => c.toNumber());
        for (let i = 0; i <= 400; i++) {
          const x0 = a + ((b - a) * i) / 400;
          const x1 = a + ((b - a) * (i + 1)) / 400;
          const ev = (t) => coeffs.reduceRight((acc, c) => acc * t + c, 0);
          const v0 = ev(x0);
          const v1 = ev(x1);
          if (v0 === 0 && i > 0) out.push(x0);
          else if (v0 * v1 < 0) {
            let lo = x0;
            let hi = x1;
            for (let k = 0; k < 80; k++) {
              const mid = (lo + hi) / 2;
              if (ev(lo) * ev(mid) <= 0) hi = mid;
              else lo = mid;
            }
            out.push((lo + hi) / 2);
          }
        }
      }
    }
  });
  return [...new Set(out.map((v) => Number(v.toPrecision(12))))].filter((v) => v > a && v < b).sort((p, q) => p - q);
}

/**
 * @typedef {object} DefiniteResult
 * @property {boolean} ok
 * @property {number} [value] numeric value (Infinity for a divergent integral)
 * @property {Expr} [exact] exact value when found symbolically
 * @property {string} [latex]
 * @property {boolean} [converges]
 * @property {boolean} [numericOnly] true when no antiderivative was used
 * @property {string} [method]
 * @property {import('./steps.js').Step[]} steps
 * @property {string} [reason]
 */

/**
 * Definite integral. Uses the antiderivative with the evaluation step
 * [F(x)]_a^b = F(b) - F(a) when possible, limits for improper integrals, and
 * adaptive Gauss-Kronrod quadrature as a fallback.
 * @param {Expr|string} expr
 * @param {string|Expr} variable
 * @param {Expr|string|number} lower use 'inf'/'-inf' or +/-Infinity for infinite limits
 * @param {Expr|string|number} upper
 * @returns {DefiniteResult}
 */
export function integrateDefinite(expr, variable, lower, upper) {
  const x = varName(variable);
  const toBound = (v) => {
    if (v === Infinity || v === 'inf' || v === 'oo') return constant('inf');
    if (v === -Infinity || v === '-inf' || v === '-oo') return simplify(mul(num(-1), constant('inf')));
    return simplify(ensureExpr(v));
  };
  const A = toBound(lower);
  const B = toBound(upper);
  const f0 = ensureExpr(expr);
  const f = simplify(f0);
  const start = integral(f0, x, A, B);
  const an = infinitySign(A) ? infinitySign(A) * Infinity : compileReal(A, [])();
  const bn = infinitySign(B) ? infinitySign(B) * Infinity : compileReal(B, [])();
  const g = compileReal(f, [x]);
  const numeric = () => gaussKronrod(g, an, bn, { tol: 1e-11 });
  const anti = integrate(f0, x);
  if (!anti.ok) {
    const q = numeric();
    return {
      ok: q.ok, value: q.value, numericOnly: true, method: q.method, converges: q.ok, steps: [makeStep(start, 'Integrate')],
      reason: 'No elementary antiderivative found; value computed numerically' + (q.ok ? '' : ' (quadrature did not converge)'),
    };
  }
  const F = anti.result;
  const steps = anti.steps.slice(0, -1).map((s) => ({ ...s }));
  steps.unshift(makeStep(start, 'Definite integral'));
  const lo = Math.min(an, bn);
  const hi = Math.max(an, bn);
  const sing = Number.isFinite(lo) && Number.isFinite(hi) ? interiorSingularities(f, x, lo, hi) : [];
  const improper = !Number.isFinite(an) || !Number.isFinite(bn) || sing.length > 0 || !Number.isFinite(g(an)) || !Number.isFinite(g(bn));
  if (!improper) {
    steps.push(makeStep(bracket(F, A, B), 'Evaluate the antiderivative at the limits'));
    const Fb = substitute(F, { [x]: B });
    const Fa = substitute(F, { [x]: A });
    steps.push(makeStep(add(Fb, mul(num(-1), Fa)), 'F(b) - F(a)'));
    let exact;
    try {
      exact = simplify(add(Fb, mul(num(-1), Fa)));
    } catch (err) {
      if (!(err instanceof MathError)) throw err;
      exact = null;
    }
    const value = exact ? compileReal(exact, [])() : NaN;
    const q = numeric();
    if (exact && Number.isFinite(value) && (!q.ok || Math.abs(value - q.value) <= 1e-6 * (1 + Math.abs(value)))) {
      steps.push(makeStep(exact, 'Simplify'));
      return { ok: true, value, exact, latex: toLatex(exact), converges: true, method: 'Fundamental theorem of calculus', steps: linkSteps(steps) };
    }
    return {
      ok: q.ok, value: q.value, numericOnly: true, method: q.method, converges: q.ok, steps: [makeStep(start, 'Integrate')],
      reason: 'The antiderivative is not continuous on the interval; value computed numerically',
    };
  }
  // Improper integral: split at interior singular points and take limits.
  const points = [A, ...sing.map((s) => simplify(ensureExpr(String(s)))), B];
  const exactPoints = sing.map((s) => {
    const r = Rational.from(s);
    return Math.abs(r.toNumber() - s) < 1e-12 ? num(r) : null;
  });
  if (exactPoints.some((p) => p === null)) {
    const q = numeric();
    return { ok: q.ok, value: q.value, numericOnly: true, method: q.method, converges: q.ok, steps: [makeStep(start, 'Integrate')], reason: 'Improper integral evaluated numerically' };
  }
  for (let i = 0; i < exactPoints.length; i++) points[i + 1] = exactPoints[i];
  steps.push(makeStep(start, 'Improper integral: write as limits', { note: 'Split at ' + (sing.length ? sing.join(', ') : 'the infinite limit') }));
  let total = num(0);
  let totalNum = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const p = points[i];
    const q = points[i + 1];
    const upperLim = limit(F, x, infinitySign(q) ? (infinitySign(q) > 0 ? 'inf' : '-inf') : q, infinitySign(q) ? null : '-');
    const lowerLim = limit(F, x, infinitySign(p) ? (infinitySign(p) > 0 ? 'inf' : '-inf') : p, infinitySign(p) ? null : '+');
    if (!upperLim.ok || !lowerLim.ok || upperLim.kind === 'dne' || lowerLim.kind === 'dne') {
      return { ok: true, value: NaN, converges: false, steps: linkSteps(steps), reason: 'The limit defining the improper integral does not exist' };
    }
    if (upperLim.kind === 'infinite' || lowerLim.kind === 'infinite') {
      const s = (upperLim.numeric ?? 0) - (lowerLim.numeric ?? 0);
      steps.push(makeStep(start, 'The integral diverges'));
      return { ok: true, value: Number.isNaN(s) ? NaN : s, converges: false, steps: linkSteps(steps), reason: 'The integral diverges' };
    }
    if (upperLim.exact === false || lowerLim.exact === false) {
      const qn = numeric();
      return { ok: qn.ok, value: qn.value, numericOnly: true, method: qn.method, converges: qn.ok, steps: linkSteps(steps), reason: 'Limit evaluated numerically' };
    }
    steps.push(makeStep(add(upperLim.value, mul(num(-1), lowerLim.value)), 'Evaluate the limits', { note: 'Piece from ' + toLatex(p) + ' to ' + toLatex(q) }));
    total = add(total, upperLim.value, mul(num(-1), lowerLim.value));
    totalNum += upperLim.numeric - lowerLim.numeric;
  }
  const exact = simplify(total);
  steps.push(makeStep(exact, 'Simplify'));
  return { ok: true, value: totalNum, exact, latex: toLatex(exact), converges: true, method: 'Improper integral via limits', steps: linkSteps(steps) };
}

/**
 * Numeric definite integral of an expression by adaptive Gauss-Kronrod.
 * @param {Expr|string} expr
 * @param {string} variable
 * @param {number} a
 * @param {number} b
 * @returns {import('./quadrature.js').QuadratureResult}
 */
export function integrateNumeric(expr, variable, a, b) {
  const g = compileReal(simplify(ensureExpr(expr)), [varName(variable)]);
  return gaussKronrod(g, a, b);
}

