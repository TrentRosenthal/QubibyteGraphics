/**
 * Limits with steps: direct substitution, factor-and-cancel for rational
 * functions, standard limits (sin u / u and friends), L'Hopital's rule,
 * rewriting of 0 * inf, inf - inf, 1^inf, 0^0 and inf^0 forms, degree
 * comparison for rational functions at infinity, and one-sided analysis of
 * poles. Every symbolic answer is checked numerically; when no symbolic
 * method applies a numeric estimate is returned and flagged as inexact.
 * @module math/limits
 */
import {
  num, sym, constant, add, mul, pow, fn, freeOf, limitNode, key, MathError, substitute, symbols,
} from './expr.js';
import { simplify, splitCoeff } from './simplify.js';
import { ensureExpr, varName } from './parse.js';
import { diff } from './diff.js';
import { compileReal } from './evaluate.js';
import { toRationalFunction, cancel, together } from './ratfunc.js';
import { pDeg } from './poly.js';
import { makeStep, linkSteps } from './steps.js';
import { toLatex } from './latex.js';

/** @typedef {import('./expr.js').Expr} Expr */

const fin = (e) => ({ k: 'fin', e: simplify(e) });
const inf = (s) => ({ k: 'inf', s });
const INDET = (form) => ({ k: 'indet', form });
const DNE = { k: 'dne' };
const BOUNDED = { k: 'bounded' };

function isZeroExpr(e) {
  return e.type === 'num' && e.value.isZero();
}

/**
 * True for the expression +infinity or -infinity; returns the sign or 0.
 * @param {Expr} e
 * @returns {number}
 */
export function infinitySign(e) {
  if (e.type === 'const' && e.name === 'inf') return 1;
  if (e.type === 'mul' && e.args.length === 2 && e.args[1].type === 'const' && e.args[1].name === 'inf') {
    return e.args[0].type === 'num' ? e.args[0].value.sign() : 0;
  }
  return 0;
}

function numericValue(e) {
  try {
    const v = compileReal(e, [])();
    return v;
  } catch {
    return NaN;
  }
}

class LimitContext {
  constructor(x, point, dir) {
    this.x = x;
    this.point = point;
    this.infSign = infinitySign(point);
    this.aNum = this.infSign ? this.infSign * Infinity : numericValue(point);
    this.dir = dir;
    this.steps = [];
    this.depth = 0;
    this.budget = 400;
    this.xSym = sym(x);
  }

  // Sample points approaching the limit point from one side (+1 or -1).
  samplePoints(side) {
    const out = [];
    if (this.infSign) {
      for (const p of [1e2, 1e3, 1e4, 1e5, 1e6]) out.push(this.infSign * p);
      return out;
    }
    const scale = Math.max(1, Math.abs(this.aNum));
    for (const h of [1e-3, 1e-4, 1e-5, 1e-6, 1e-7]) out.push(this.aNum + side * h * scale);
    return out;
  }

  sides() {
    if (this.infSign) return [1];
    if (this.dir === '+') return [1];
    if (this.dir === '-') return [-1];
    return [1, -1];
  }

  // Sign of g near the point on each side: +1, -1, or 0 when mixed/undefined.
  signNear(g) {
    let f;
    try {
      f = compileReal(g, [this.x]);
    } catch {
      return 0;
    }
    const signs = [];
    for (const side of this.sides()) {
      const pts = this.samplePoints(side).slice(-3);
      const vals = pts.map((p) => f(p)).filter((v) => !Number.isNaN(v));
      if (!vals.length) continue;
      const s = Math.sign(vals[vals.length - 1]);
      if (vals.some((v) => Math.sign(v) !== s)) return 0;
      signs.push(s);
    }
    if (!signs.length) return 0;
    return signs.every((s) => s === signs[0]) ? signs[0] : 0;
  }

  // Values of g near the point on each side (closest sample).
  valuesNear(g) {
    let f;
    try {
      f = compileReal(g, [this.x]);
    } catch {
      return [];
    }
    return this.sides().map((side) => {
      const pts = this.samplePoints(side);
      return pts.map((p) => f(p));
    });
  }

  record(expr, rule, note) {
    this.steps.push(makeStep(limitNode(expr, this.x, this.point, this.dir), rule, note ? { note } : {}));
  }
}

function finiteOrSymbolic(e) {
  if (symbols(e).size) return true;
  return Number.isFinite(numericValue(e));
}

function signOfExpr(e) {
  const v = numericValue(e);
  return Number.isNaN(v) ? 0 : Math.sign(v);
}

function combineAdd(vals) {
  let infSign = null;
  let bounded = false;
  const finite = [];
  for (const v of vals) {
    if (v.k === 'indet' || v.k === 'dne') return v.k === 'dne' ? DNE : v;
    if (v.k === 'bounded') bounded = true;
    else if (v.k === 'inf') {
      if (v.s === 0) return INDET('inf-inf');
      if (infSign !== null && infSign !== v.s) return INDET('inf-inf');
      infSign = v.s;
    } else finite.push(v.e);
  }
  if (infSign !== null) return inf(infSign);
  if (bounded) return DNE;
  return fin(add(...finite));
}

function combineMul(vals, ctx, node) {
  let sign = 1;
  let anyInf = false;
  let unsigned = false;
  let zero = false;
  let bounded = false;
  const finite = [];
  for (const v of vals) {
    if (v.k === 'indet') return v;
    if (v.k === 'dne') return DNE;
    if (v.k === 'bounded') {
      bounded = true;
      continue;
    }
    if (v.k === 'inf') {
      anyInf = true;
      if (v.s === 0) unsigned = true;
      else sign *= v.s;
      continue;
    }
    if (isZeroExpr(v.e)) zero = true;
    finite.push(v.e);
  }
  if (zero && anyInf) return INDET('0*inf');
  if (zero) return fin(num(0));
  if (anyInf) {
    if (bounded) return INDET('bounded*inf');
    const c = signOfExpr(simplify(mul(...finite)));
    if (c === 0 || unsigned) {
      const s = ctx.signNear(node);
      return inf(s);
    }
    return inf(sign * c);
  }
  if (bounded) return DNE;
  return fin(mul(...finite));
}

function limitOfPow(node, ctx) {
  const [b, e] = node.args;
  const lb = limitCore(b, ctx);
  const le = limitCore(e, ctx);
  if (lb.k === 'indet' || le.k === 'indet') return INDET('pow');
  if (lb.k === 'dne' || le.k === 'dne' || lb.k === 'bounded' || le.k === 'bounded') {
    if (lb.k === 'bounded' && le.k === 'fin' && signOfExpr(le.e) > 0) return BOUNDED;
    return DNE;
  }
  const isE = b.type === 'const' && b.name === 'e';
  if (lb.k === 'fin' && le.k === 'fin') {
    const bz = isZeroExpr(lb.e);
    const ez = isZeroExpr(le.e);
    if (bz && ez && !freeOf(b, ctx.x)) return INDET('0^0');
    if (bz && signOfExpr(le.e) < 0) return inf(ctx.signNear(node));
    try {
      const val = simplify(pow(lb.e, le.e));
      if (finiteOrSymbolic(val)) return fin(val);
    } catch (err) {
      if (!(err instanceof MathError)) throw err;
    }
    return inf(ctx.signNear(node));
  }
  if (lb.k === 'fin' && le.k === 'inf') {
    const bv = numericValue(lb.e);
    if (isE) return le.s > 0 ? inf(1) : fin(num(0));
    if (Math.abs(bv - 1) < 1e-12) return INDET('1^inf');
    if (bv > 1) return le.s > 0 ? inf(1) : fin(num(0));
    if (bv >= 0 && bv < 1) return le.s > 0 ? fin(num(0)) : inf(1);
    return DNE;
  }
  if (lb.k === 'inf' && le.k === 'fin') {
    const ev = numericValue(le.e);
    if (ev === 0) return INDET('inf^0');
    if (ev < 0) return fin(num(0));
    if (lb.s > 0) return inf(1);
    return inf(ctx.signNear(node));
  }
  // inf ^ inf
  if (lb.k === 'inf' && le.k === 'inf') {
    if (lb.s > 0) return le.s > 0 ? inf(1) : fin(num(0));
    return DNE;
  }
  return DNE;
}

const JUMP_FUNCS = new Set(['floor', 'ceil', 'sign']);

function limitOfFn(node, ctx) {
  const inner = limitCore(node.args[0], ctx);
  if (node.args[1] && !freeOf(node.args[1], ctx.x)) return INDET('log-base');
  const name = node.name;
  if (inner.k === 'indet') return inner;
  if (inner.k === 'dne') return DNE;
  if (inner.k === 'bounded') return ['sin', 'cos', 'atan', 'tanh'].includes(name) ? BOUNDED : DNE;
  if (inner.k === 'inf') {
    const s = inner.s;
    switch (name) {
      case 'exp': return s > 0 ? inf(1) : fin(num(0));
      case 'ln': case 'log': return s !== 0 ? inf(1) : DNE;
      case 'sqrt': return s > 0 ? inf(1) : DNE;
      case 'abs': return inf(1);
      case 'atan': return s === 0 ? DNE : fin(mul(num(s), num('1/2'), constant('pi')));
      case 'tanh': return s === 0 ? DNE : fin(num(s));
      case 'sinh': return inf(s);
      case 'cosh': return inf(1);
      case 'sin': case 'cos': return BOUNDED;
      case 'floor': case 'ceil': return inf(s);
      case 'sign': return fin(num(s));
      default: return DNE;
    }
  }
  const v = inner.e;
  if (JUMP_FUNCS.has(name)) {
    const vals = ctx.valuesNear(node).map((arr) => arr[arr.length - 1]);
    if (vals.length && vals.every((q) => Math.abs(q - vals[0]) < 1e-9)) return fin(num(Math.round(vals[0])));
    return DNE;
  }
  let exact;
  try {
    exact = simplify(node.args[1] ? fn(name, v, node.args[1]) : fn(name, v));
  } catch (err) {
    if (!(err instanceof MathError)) throw err;
    exact = null;
  }
  if (exact && finiteOrSymbolic(exact)) return fin(exact);
  const nv = exact ? numericValue(exact) : NaN;
  // Pole or boundary point of the domain (ln 0, tan(pi/2)).
  const s = ctx.signNear(node);
  const vals = ctx.valuesNear(node).flat().filter((q) => Number.isFinite(q));
  if (vals.length && vals.every((q) => Math.abs(q) > 1e3)) return inf(s);
  if (exact && !Number.isNaN(nv)) return inf(s);
  return DNE;
}

function limVal(f, ctx) {
  if (freeOf(f, ctx.x)) return fin(f);
  switch (f.type) {
    case 'sym': return ctx.infSign ? inf(ctx.infSign) : fin(ctx.point);
    case 'add': {
      const r = combineAdd(f.args.map((a) => limitCore(a, ctx)));
      if (r.k === 'indet' && ctx.infSign > 0) {
        const t = leadingTerm(f, ctx.x);
        const L = t && leadingLimit(t);
        if (L) return L;
      }
      return r;
    }
    case 'mul': return combineMul(f.args.map((a) => limitCore(a, ctx)), ctx, f);
    case 'pow': return limitOfPow(f, ctx);
    case 'fn': return limitOfFn(f, ctx);
    default: return DNE;
  }
}

function limitCore(f, ctx) {
  if (--ctx.budget < 0) return INDET('budget');
  const v = limVal(f, ctx);
  if (v.k !== 'indet') return v;
  return techniques(f, ctx, v.form);
}

// Numerator and denominator (denominator = factors with negative exponents).
function fraction(f) {
  const factors = f.type === 'mul' ? f.args : [f];
  const N = [];
  const D = [];
  for (const g of factors) {
    if (g.type === 'pow' && g.args[1].type === 'num' && g.args[1].value.isNegative()) {
      const ex = g.args[1].value.neg();
      D.push(ex.isOne() ? g.args[0] : pow(g.args[0], num(ex)));
    } else if (g.type === 'pow' && g.args[1].type !== 'num' && splitCoeff(g.args[1])[0].isNegative()) {
      D.push(pow(g.args[0], simplify(mul(num(-1), g.args[1]))));
    } else if (g.type === 'num' && !g.value.isInteger()) {
      N.push(num(g.value.n));
      D.push(num(g.value.d));
    } else N.push(g);
  }
  return { N: simplify(mul(...N)), D: simplify(mul(...D)) };
}

const STANDARD = [
  { name: 'sin', value: 1, text: '\\lim_{u \\to 0} \\frac{\\sin u}{u} = 1' },
  { name: 'tan', value: 1, text: '\\lim_{u \\to 0} \\frac{\\tan u}{u} = 1' },
  { name: 'asin', value: 1, text: '\\lim_{u \\to 0} \\frac{\\arcsin u}{u} = 1' },
  { name: 'atan', value: 1, text: '\\lim_{u \\to 0} \\frac{\\arctan u}{u} = 1' },
  { name: 'sinh', value: 1, text: '\\lim_{u \\to 0} \\frac{\\sinh u}{u} = 1' },
];

function standardLimit(f, ctx) {
  if (ctx.infSign) return null;
  const { N, D } = fraction(f);
  if (freeOf(D, ctx.x)) return null;
  const [cN, rN] = splitCoeff(N);
  const [cD, rD] = splitCoeff(D);
  if (!rN || !rD) return null;
  const at0 = (e) => {
    const l = limVal(e, ctx);
    return l.k === 'fin' && isZeroExpr(l.e);
  };
  if (rN.type === 'fn') {
    const std = STANDARD.find((s) => s.name === rN.name);
    if (std && at0(rN.args[0])) {
      const ratio = simplify(mul(rN.args[0], pow(rD, num(-1))));
      if (freeOf(ratio, ctx.x)) {
        const value = simplify(mul(num(cN), pow(num(cD), num(-1)), ratio));
        return { value, note: std.text };
      }
    }
  }
  // (e^u - 1)/u and (1 - cos u)/u^2 style forms via their standard values.
  if (rN.type === 'add' && rN.args.length === 2) {
    const [p, q] = rN.args;
    const oneTerm = [p, q].find((t) => t.type === 'num');
    const other = [p, q].find((t) => t.type !== 'num');
    if (oneTerm && other) {
      const [co, ro] = splitCoeff(other);
      if (ro.type === 'pow' && ro.args[0].type === 'const' && ro.args[0].name === 'e' && co.isOne() && oneTerm.value.eq(num(-1).value) && at0(ro.args[1])) {
        const ratio = simplify(mul(ro.args[1], pow(rD, num(-1))));
        if (freeOf(ratio, ctx.x)) {
          return { value: simplify(mul(num(cN), pow(num(cD), num(-1)), ratio)), note: '\\lim_{u \\to 0} \\frac{e^{u} - 1}{u} = 1' };
        }
      }
      if (ro.type === 'fn' && ro.name === 'cos' && co.eq(num(-1).value) && oneTerm.value.isOne() && at0(ro.args[0])) {
        const ratio = simplify(mul(pow(ro.args[0], num(2)), pow(rD, num(-1))));
        if (freeOf(ratio, ctx.x)) {
          return { value: simplify(mul(num('1/2'), num(cN), pow(num(cD), num(-1)), ratio)), note: '\\lim_{u \\to 0} \\frac{1 - \\cos u}{u^{2}} = \\frac{1}{2}' };
        }
      }
    }
  }
  if (rN.type === 'fn' && rN.name === 'ln' && rN.args[0].type === 'add') {
    const u = simplify(add(rN.args[0], num(-1)));
    if (at0(u)) {
      const ratio = simplify(mul(u, pow(rD, num(-1))));
      if (freeOf(ratio, ctx.x)) return { value: simplify(mul(num(cN), pow(num(cD), num(-1)), ratio)), note: '\\lim_{u \\to 0} \\frac{\\ln(1 + u)}{u} = 1' };
    }
  }
  return null;
}

function isReciprocalLike(e) {
  return e.type === 'pow' && e.args[1].type === 'num' && e.args[1].value.isNegative();
}

function techniques(f, ctx, form) {
  if (ctx.depth > 10) return INDET(form);
  ctx.depth++;
  try {
    const x = ctx.x;
    const rf = toRationalFunction(f, x);
    if (rf && (ctx.infSign || f.type === 'mul' || f.type === 'pow')) {
      if (ctx.infSign) {
        const dn = pDeg(rf.num);
        const dd = pDeg(rf.den);
        const lcN = rf.num[dn];
        const lcD = rf.den[dd];
        ctx.record(f, 'Divide numerator and denominator by the highest power of ' + x, 'Degrees: numerator ' + dn + ', denominator ' + dd);
        if (dn < dd) return fin(num(0));
        if (dn === dd) return fin(num(lcN.div(lcD)));
        const s = lcN.div(lcD).sign() * (ctx.infSign < 0 && (dn - dd) % 2 === 1 ? -1 : 1);
        return inf(s);
      }
      const c = cancel(f, x);
      if (key(c) !== key(f)) {
        ctx.record(c, 'Factor and cancel');
        return limitCore(c, ctx);
      }
    }
    if (ctx.infSign > 0) {
      const t = leadingTerm(f, x);
      const L = t && leadingLimit(t);
      if (L) {
        const X = pow(ctx.xSym, num(t.p));
        ctx.record(mul(t.c, X), 'Keep the dominant terms', 'As ' + x + ' grows, only the highest powers matter');
        return L;
      }
    }
    const std = standardLimit(f, ctx);
    if (std) {
      ctx.record(f, 'Standard limit', std.note);
      return fin(std.value);
    }
    const { N, D } = fraction(f);
    if (!freeOf(D, x) && !(D.type === 'num')) {
      const lN = limitCore(N, ctx);
      const lD = limitCore(D, ctx);
      const zero = (l) => l.k === 'fin' && isZeroExpr(l.e);
      const smooth = !containsFn(N, ['abs', 'floor', 'ceil', 'sign']) && !containsFn(D, ['abs', 'floor', 'ceil', 'sign']);
      if (smooth && ((zero(lN) && zero(lD)) || (lN.k === 'inf' && lD.k === 'inf'))) {
        const dN = diff(N, x);
        const dD = diff(D, x);
        const next = mul(dN, pow(dD, num(-1)));
        ctx.record(next, "L'Hopital's rule", (zero(lN) ? '0/0' : 'inf/inf') + ' form: differentiate numerator and denominator');
        return limitCore(simplify(next), ctx);
      }
      if (lN.k !== 'indet' && lD.k !== 'indet') {
        if (zero(lD) && lN.k === 'fin' && !zero(lN)) return inf(ctx.signNear(f));
        if (lD.k === 'inf' && lN.k === 'fin') return fin(num(0));
      }
    }
    if (f.type === 'mul' && (form === '0*inf' || form === 'bounded*inf')) {
      const vals = f.args.map((a) => ({ a, l: limitCore(a, ctx) }));
      const Z = vals.filter((v) => v.l.k === 'fin' || v.l.k === 'bounded').map((v) => v.a);
      const I = vals.filter((v) => v.l.k === 'inf').map((v) => v.a);
      if (Z.length && I.length) {
        const zE = simplify(mul(...Z));
        const iE = simplify(mul(...I));
        const logLike = containsFn(iE, ['ln', 'log', 'asin', 'acos', 'atan']);
        const expLike = isExponential(zE) || isReciprocalLike(zE);
        const recip = !logLike && !expLike;
        const Nq = recip ? zE : iE;
        const Dq = simplify(pow(recip ? iE : zE, num(-1)));
        ctx.record(mul(Nq, pow(Dq, num(-1))), 'Rewrite the product as a quotient', '0 \\cdot \\infty form');
        const lh = mul(diff(Nq, x), pow(diff(Dq, x), num(-1)));
        ctx.record(lh, "L'Hopital's rule");
        return limitCore(simplify(lh), ctx);
      }
    }
    if (f.type === 'pow' && !freeOf(f.args[1], x)) {
      const inner = simplify(mul(f.args[1], fn('ln', f.args[0])));
      ctx.record(pow(constant('e'), inner), 'Rewrite as an exponential', 'u^{v} = e^{v \\ln u}');
      const L = limitCore(inner, ctx);
      if (L.k === 'fin') return fin(pow(constant('e'), L.e));
      if (L.k === 'inf') return L.s > 0 ? inf(1) : L.s < 0 ? fin(num(0)) : DNE;
      return L;
    }
    if (f.type === 'add') {
      const t = together(f);
      if (key(t) !== key(f) && fraction(t).D.type !== 'num') {
        ctx.record(t, 'Combine into a single fraction');
        return limitCore(t, ctx);
      }
      const radIdx = f.args.findIndex((a) => containsSqrt(a));
      if (radIdx >= 0 && f.args.length === 2) {
        const A = f.args[radIdx];
        const B = f.args[1 - radIdx];
        const numer = simplify(add(pow(A, num(2)), mul(num(-1), pow(B, num(2)))));
        const next = mul(numer, pow(add(A, mul(num(-1), B)), num(-1)));
        ctx.record(next, 'Multiply by the conjugate');
        return limitCore(simplify(next), ctx);
      }
    }
    return INDET(form);
  } finally {
    ctx.depth--;
  }
}

function containsFn(e, names) {
  if (e.type === 'fn' && names.includes(e.name)) return true;
  return e.args ? e.args.some((a) => containsFn(a, names)) : false;
}

function isExponential(e) {
  if (e.type === 'pow' && freeOf(e.args[0], '__x__') && e.args[0].type !== 'sym') return true;
  if (e.type === 'mul') return e.args.every((a) => a.type === 'num' || isExponential(a));
  return false;
}

/**
 * Leading behaviour c x^p of an algebraic expression as x -> +infinity, or
 * null when it cannot be determined (cancellation or transcendental parts).
 * @param {Expr} e
 * @param {string} x
 * @returns {{c: Expr, p: import('./rational.js').Rational}|null}
 */
function leadingTerm(e, x) {
  if (freeOf(e, x)) return isZeroExpr(e) ? null : { c: e, p: num(0).value };
  switch (e.type) {
    case 'sym': return { c: num(1), p: num(1).value };
    case 'mul': {
      let c = [];
      let p = num(0).value;
      for (const a of e.args) {
        const t = leadingTerm(a, x);
        if (!t) return null;
        c.push(t.c);
        p = p.add(t.p);
      }
      c = simplify(mul(...c));
      return { c, p };
    }
    case 'pow': {
      const r = e.args[1];
      if (r.type !== 'num') return null;
      const t = leadingTerm(e.args[0], x);
      if (!t) return null;
      if (!r.value.isInteger() && !(numericValue(t.c) > 0)) return null;
      return { c: simplify(pow(t.c, r)), p: t.p.mul(r.value) };
    }
    case 'add': {
      const ts = e.args.map((a) => leadingTerm(a, x));
      if (ts.some((t) => !t)) return null;
      let best = ts[0].p;
      for (const t of ts) if (t.p.cmp(best) > 0) best = t.p;
      const c = simplify(add(...ts.filter((t) => t.p.eq(best)).map((t) => t.c)));
      if (isZeroExpr(c)) return null;
      return { c, p: best };
    }
    default: return null;
  }
}

function leadingLimit(t) {
  const s = t.p.sign();
  if (s < 0) return fin(num(0));
  if (s === 0) return fin(t.c);
  const cs = signOfExpr(t.c);
  return cs === 0 ? null : inf(cs);
}

function containsSqrt(e) {
  if (e.type === 'pow' && e.args[1].type === 'num' && e.args[1].value.d === 2n) return true;
  return e.args ? e.args.some(containsSqrt) : false;
}

function numericEstimate(f, ctx) {
  let g;
  try {
    g = compileReal(f, [ctx.x]);
  } catch {
    return null;
  }
  const perSide = ctx.sides().map((side) => ctx.samplePoints(side).map((p) => g(p)));
  const estimates = perSide.map((vals) => {
    const good = vals.filter((v) => Number.isFinite(v));
    if (good.length < 3) {
      if (vals.slice(-2).every((v) => v === Infinity)) return Infinity;
      if (vals.slice(-2).every((v) => v === -Infinity)) return -Infinity;
      return NaN;
    }
    const last = good[good.length - 1];
    const prev = good[good.length - 2];
    const prev2 = good[good.length - 3];
    if (Math.abs(last) > 1e6 && Math.abs(last) > Math.abs(prev) && Math.abs(prev) > Math.abs(prev2) && Math.sign(last) === Math.sign(prev)) return Math.sign(last) * Infinity;
    if (Math.abs(last - prev) <= 1e-4 * Math.max(1, Math.abs(last))) return last;
    return NaN;
  });
  return estimates;
}

function agrees(value, estimates) {
  return estimates.every((e) => {
    if (Number.isNaN(e)) return true;
    if (!Number.isFinite(value) || !Number.isFinite(e)) return value === e;
    return Math.abs(value - e) <= 1e-3 * Math.max(1, Math.abs(value));
  });
}

/**
 * @typedef {object} LimitResult
 * @property {boolean} ok false when no answer (symbolic or numeric) was found
 * @property {'finite'|'infinite'|'dne'} [kind]
 * @property {Expr} [value] the limit (constant inf or -inf when infinite)
 * @property {number} [numeric] numeric value
 * @property {boolean} [exact] false when only a numeric estimate is available
 * @property {string} [latex]
 * @property {import('./steps.js').Step[]} steps
 * @property {string} [reason]
 */

/**
 * Compute a limit with steps.
 * @param {Expr|string} expr
 * @param {string|Expr} [variable='x']
 * @param {Expr|string|number} [point=0] use 'inf' / '-inf' (or Infinity) for infinity
 * @param {('+'|'-'|null)} [dir=null] one-sided direction
 * @returns {LimitResult}
 */
export function limit(expr, variable = 'x', point = 0, dir = null) {
  const x = varName(variable);
  let a;
  if (point === Infinity || point === 'inf' || point === 'oo') a = constant('inf');
  else if (point === -Infinity || point === '-inf' || point === '-oo') a = simplify(mul(num(-1), constant('inf')));
  else a = simplify(ensureExpr(point));
  const f0 = ensureExpr(expr);
  let f = simplify(f0);
  let ctx = new LimitContext(x, a, dir);
  if (ctx.infSign < 0) {
    ctx.record(f0, 'Limit');
    const flipped = simplify(substitute(f, { [x]: mul(num(-1), sym(x)) }));
    const first = ctx.steps;
    ctx = new LimitContext(x, constant('inf'), null);
    ctx.steps = first;
    ctx.record(flipped, 'Replace ' + x + ' by -' + x + ' so that ' + x + ' \\to \\infty');
    f = flipped;
  } else {
    ctx.record(f0, 'Limit');
  }
  ctx.parametric = [...symbols(f)].some((s) => s !== x);
  let result;
  if (!ctx.infSign && !Number.isFinite(ctx.aNum)) return { ok: false, reason: 'Limit point must be a real number or infinity', steps: linkSteps(ctx.steps) };
  // Direct substitution when the function is continuous there.
  if (!ctx.infSign) {
    try {
      const direct = simplify(substitute(f, { [x]: a }));
      const dv = numericValue(direct);
      if (ctx.parametric && !hasUnevaluatedPole(direct)) {
        ctx.steps.push(makeStep(direct, 'Direct substitution'));
        return finish(ctx, fin(direct), f);
      }
      if (Number.isFinite(dv)) {
        const est = numericEstimate(f, ctx);
        if (est && est.every((e) => Number.isFinite(e)) && agrees(dv, est)) {
          ctx.steps.push(makeStep(direct, 'Direct substitution'));
          return finish(ctx, fin(direct), f);
        }
      }
    } catch (err) {
      if (!(err instanceof MathError)) throw err;
    }
  }
  try {
    result = limitCore(f, ctx);
  } catch (err) {
    if (!(err instanceof MathError)) throw err;
    result = INDET('error');
  }
  return finish(ctx, result, f);
}

function hasUnevaluatedPole(e) {
  if (e.type === 'fn' && (e.name === 'ln' || e.name === 'log') && isZeroExpr(e.args[0])) return true;
  return e.args ? e.args.some(hasUnevaluatedPole) : false;
}

function finish(ctx, result, f) {
  if (ctx.parametric && result.k === 'fin') {
    return { ok: true, kind: 'finite', value: result.e, exact: true, latex: toLatex(result.e), steps: linkSteps(ctx.steps) };
  }
  const est = numericEstimate(f, ctx);
  const valueOf = (r) => (r.k === 'fin' ? numericValue(r.e) : r.k === 'inf' && r.s !== 0 ? r.s * Infinity : NaN);
  if (result.k === 'fin' || (result.k === 'inf' && result.s !== 0)) {
    const v = valueOf(result);
    if (est && agrees(v, est)) {
      const value = result.k === 'fin' ? result.e : result.s > 0 ? constant('inf') : simplify(mul(num(-1), constant('inf')));
      if (result.k === 'fin' && ctx.steps.length && toLatex(ctx.steps[ctx.steps.length - 1].expr) !== toLatex(value)) ctx.steps.push(makeStep(value, 'Evaluate'));
      else if (result.k === 'inf') ctx.steps.push(makeStep(value, 'The function grows without bound'));
      return {
        ok: true, kind: result.k === 'fin' ? 'finite' : 'infinite', value, numeric: v, exact: true,
        latex: toLatex(value), steps: linkSteps(ctx.steps),
      };
    }
  }
  // Two-sided disagreement or oscillation.
  if (est && est.length === 2 && !Number.isNaN(est[0]) && !Number.isNaN(est[1]) && !agrees(est[0], [est[1]])) {
    return {
      ok: true, kind: 'dne', exact: true, steps: linkSteps(ctx.steps.slice(0, 1)),
      reason: 'The one-sided limits differ (right: ' + est[0] + ', left: ' + est[1] + ')', left: est[1], right: est[0],
    };
  }
  const first = ctx.steps.slice(0, 1);
  if (result.k === 'dne' || result.k === 'bounded') {
    return { ok: true, kind: 'dne', exact: true, steps: linkSteps(first), reason: 'The function oscillates without settling near the point' };
  }
  if (est && est.every((e) => !Number.isNaN(e))) {
    const v = est[0];
    return {
      ok: true, kind: Number.isFinite(v) ? 'finite' : 'infinite', numeric: v, exact: false, steps: linkSteps(first),
      reason: 'No symbolic method applied; value estimated numerically',
    };
  }
  return { ok: false, reason: 'Could not determine the limit', steps: linkSteps(first) };
}
