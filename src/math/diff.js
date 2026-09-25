/**
 * Symbolic differentiation. `differentiate` returns a full step list where
 * each step applies one rule (sum, constant multiple, product, quotient,
 * power, chain, exponential, logarithmic, trig) to one pending derivative;
 * `diff` computes the simplified derivative directly. Partial derivatives
 * treat other symbols as constants. `implicitDerivative` finds dy/dx from
 * F(x, y) = G(x, y).
 * @module math/diff
 */
import {
  num, sym, constant, add, mul, pow, fn, eq, deriv, freeOf, key, MathError, withArgs,
} from './expr.js';
import { simplify, expand } from './simplify.js';
import { ensureExpr, varName } from './parse.js';
import { makeStep, linkSteps } from './steps.js';
import { polyCoeffs } from './poly.js';

/** @typedef {import('./expr.js').Expr} Expr */
/** @typedef {import('./steps.js').Step} Step */

const half = () => num('1/2');

// Derivative of the outer function at u (without the chain factor).
function outerDerivative(name, u, extra) {
  switch (name) {
    case 'sin': return fn('cos', u);
    case 'cos': return mul(num(-1), fn('sin', u));
    case 'tan': return pow(fn('sec', u), num(2));
    case 'sec': return mul(fn('sec', u), fn('tan', u));
    case 'csc': return mul(num(-1), fn('csc', u), fn('cot', u));
    case 'cot': return mul(num(-1), pow(fn('csc', u), num(2)));
    case 'asin': return pow(add(num(1), mul(num(-1), pow(u, num(2)))), num('-1/2'));
    case 'acos': return mul(num(-1), pow(add(num(1), mul(num(-1), pow(u, num(2)))), num('-1/2')));
    case 'atan': return pow(add(num(1), pow(u, num(2))), num(-1));
    case 'sinh': return fn('cosh', u);
    case 'cosh': return fn('sinh', u);
    case 'tanh': return pow(fn('cosh', u), num(-2));
    case 'ln': return pow(u, num(-1));
    case 'log': return pow(mul(u, fn('ln', extra || num(10))), num(-1));
    case 'exp': return pow(constant('e'), u);
    case 'sqrt': return mul(half(), pow(u, num('-1/2')));
    case 'abs': return mul(u, pow(fn('abs', u), num(-1)));
    case 'floor': case 'ceil': case 'sign': return num(0);
    default: throw new MathError('Cannot differentiate ' + name + ' symbolically');
  }
}

const FN_RULE = {
  sin: 'Derivative of sine', cos: 'Derivative of cosine', tan: 'Derivative of tangent', sec: 'Derivative of secant',
  csc: 'Derivative of cosecant', cot: 'Derivative of cotangent', asin: 'Derivative of arcsine', acos: 'Derivative of arccosine',
  atan: 'Derivative of arctangent', sinh: 'Derivative of sinh', cosh: 'Derivative of cosh', tanh: 'Derivative of tanh',
  ln: 'Derivative of ln', log: 'Derivative of log', exp: 'Exponential rule', sqrt: 'Power rule', abs: 'Derivative of absolute value',
  floor: 'Derivative of floor (zero except at jumps)', ceil: 'Derivative of ceiling (zero except at jumps)', sign: 'Derivative of sign (zero except at 0)',
};

/**
 * Apply one differentiation rule to d/dv[u].
 * @param {Expr} u
 * @param {string} v
 * @param {object} ctx
 * @returns {{out: Expr, rule: string}}
 */
function applyRule(u, v, ctx) {
  const D = (e) => deriv(e, v, 1, ctx.partial);
  const isConst = (e) => freeOf(e, v) && ctx.dependents.every((y) => freeOf(e, y));
  if (isConst(u)) return { out: num(0), rule: 'Constant rule' };
  if (u.type === 'sym' && u.name === v) return { out: num(1), rule: 'Derivative of ' + v };
  if (u.type === 'sym' && ctx.dependents.includes(u.name)) {
    const d = deriv(u, v, 1, false);
    ctx.final.add(d.id);
    return { out: d, rule: 'Derivative of ' + u.name + ' with respect to ' + v };
  }
  switch (u.type) {
    case 'add': return { out: add(...u.args.map(D)), rule: 'Sum rule' };
    case 'mul': {
      const cs = u.args.filter(isConst);
      const vs = u.args.filter((f) => !isConst(f));
      if (cs.length) {
        const c = simplify(mul(...cs));
        return { out: mul(c, D(vs.length === 1 ? vs[0] : mul(...vs))), rule: 'Constant multiple rule' };
      }
      const den = vs.filter((f) => f.type === 'pow' && f.args[1].type === 'num' && f.args[1].value.isNegative());
      const numer = vs.filter((f) => !den.includes(f));
      if (den.length && numer.length) {
        const N = numer.length === 1 ? numer[0] : mul(...numer);
        const Dn = mul(...den.map((f) => (f.args[1].value.eq(num(-1).value) ? f.args[0] : pow(f.args[0], num(f.args[1].value.neg())))));
        const top = add(mul(D(N), Dn), mul(num(-1), N, D(Dn)));
        return { out: mul(top, pow(pow(Dn, num(2)), num(-1))), rule: 'Quotient rule' };
      }
      const f = vs[0];
      const g = vs.length === 2 ? vs[1] : mul(...vs.slice(1));
      return { out: add(mul(D(f), g), mul(f, D(g))), rule: 'Product rule' };
    }
    case 'pow': {
      const [b, ex] = u.args;
      if (isConst(ex)) {
        const n = simplify(ex);
        const n1 = simplify(add(n, num(-1)));
        const lowered = n1.type === 'num' && n1.value.isZero() ? null : n1.type === 'num' && n1.value.isOne() ? b : pow(b, n1);
        const core = lowered ? mul(n, lowered) : n;
        if (b.type === 'sym' && b.name === v) return { out: core, rule: 'Power rule' };
        return { out: mul(core, D(b)), rule: 'Power rule with chain rule' };
      }
      if (isConst(b)) {
        const isE = b.type === 'const' && b.name === 'e';
        const outer = isE ? u : mul(u, fn('ln', b));
        if (ex.type === 'sym' && ex.name === v) return { out: outer, rule: 'Exponential rule' };
        return { out: mul(outer, D(ex)), rule: 'Exponential rule with chain rule' };
      }
      return { out: mul(u, D(mul(ex, fn('ln', b)))), rule: 'Logarithmic differentiation' };
    }
    case 'fn': {
      const a = u.args[0];
      const outer = outerDerivative(u.name, a, u.args[1]);
      if (u.args[1] && !isConst(u.args[1])) {
        return { out: D(mul(fn('ln', a), pow(fn('ln', u.args[1]), num(-1)))), rule: 'Change of base' };
      }
      const rule = FN_RULE[u.name];
      if (a.type === 'sym' && a.name === v) return { out: outer, rule };
      if (u.name === 'floor' || u.name === 'ceil' || u.name === 'sign') return { out: num(0), rule };
      return { out: mul(outer, D(a)), rule: 'Chain rule', note: rule + ' as the outer function' };
    }
    case 'deriv': {
      if (u.v === v && u.args[0].type === 'sym' && ctx.dependents.includes(u.args[0].name)) {
        const d = deriv(u.args[0], v, u.order + 1, u.partial);
        ctx.final.add(d.id);
        return { out: d, rule: 'Higher derivative' };
      }
      return { out: D(diff(simplify(u.args[0]), u.v, u.order)), rule: 'Evaluate inner derivative' };
    }
    default: throw new MathError('Cannot differentiate a ' + u.type + ' expression');
  }
}

function findPending(e, v, ctx) {
  if (e.type === 'deriv' && e.v === v && !ctx.final.has(e.id)) return e;
  if (!e.args) return null;
  for (const a of e.args) {
    const f = findPending(a, v, ctx);
    if (f) return f;
  }
  return null;
}

function replaceNode(e, target, replacement) {
  if (e === target) return replacement;
  if (!e.args) return e;
  return withArgs(e, e.args.map((a) => replaceNode(a, target, replacement)));
}

// Rewrite every pending derivative in `start`, recording one step per rule.
function rewrite(start, v, ctx, steps, maxSteps) {
  let cur = start;
  for (;;) {
    const p = findPending(cur, v, ctx);
    if (!p) break;
    if (steps.length >= maxSteps) {
      const done = finishAll(cur, v, ctx);
      steps.push(makeStep(done, 'Differentiate the remaining terms'));
      return done;
    }
    const inner = p.args[0];
    if (p.order > 1) {
      const once = deriv(deriv(inner, v, 1, p.partial), v, p.order - 1, p.partial);
      cur = replaceNode(cur, p, once);
      continue;
    }
    const { out, rule, note } = applyRule(inner, v, ctx);
    cur = replaceNode(cur, p, out);
    steps.push(makeStep(cur, rule, note ? { note } : {}));
  }
  return cur;
}

function finishAll(e, v, ctx) {
  const p = findPending(e, v, ctx);
  if (!p) return e;
  const d = ctx.dependents.length ? implicitDiffRaw(p.args[0], v, ctx) : diff(p.args[0], v, p.order);
  return finishAll(replaceNode(e, p, d), v, ctx);
}

function implicitDiffRaw(u, v, ctx) {
  const { out } = applyRule(u, v, ctx);
  return finishAll(out, v, ctx);
}

/**
 * @typedef {object} Derivation
 * @property {boolean} ok
 * @property {Expr} [result] simplified result
 * @property {string} [latex] LaTeX of the result
 * @property {Step[]} steps
 * @property {string} [reason] why the operation failed when ok is false
 */

/**
 * Differentiate with a full step list.
 * @param {Expr|string} expr
 * @param {string|Expr} [variable='x']
 * @param {{order?: number, partial?: boolean, maxSteps?: number, retried?: boolean}} [opts]
 * @returns {Derivation}
 */
export function differentiate(expr, variable = 'x', opts = {}) {
  const v = varName(variable);
  const order = opts.order ?? 1;
  const partial = !!opts.partial;
  let current = ensureExpr(expr);
  const steps = [];
  try {
    for (let k = 1; k <= order; k++) {
      const ctx = { partial, dependents: [], final: new Set() };
      const start = deriv(current, v, 1, partial);
      steps.push(makeStep(start, k === 1 ? 'Differentiate' : 'Differentiate again (order ' + k + ')'));
      const raw = rewrite(start, v, ctx, steps, steps.length + (opts.maxSteps ?? 80));
      current = simplify(raw);
      steps.push(makeStep(current, 'Simplify'));
    }
  } catch (err) {
    if (!(err instanceof MathError)) throw err;
    // Rules applied to an unsimplified form can meet 0/0 (sqrt(0 * x));
    // simplifying the input first removes such removable problems.
    const simplified = trySimplify(ensureExpr(expr));
    if (!opts.retried && simplified && key(simplified) !== key(ensureExpr(expr))) {
      const again = differentiate(simplified, variable, { ...opts, retried: true });
      if (again.ok) {
        const first = makeStep(ensureExpr(expr), 'Simplify before differentiating');
        return { ...again, steps: linkSteps([first, ...again.steps]) };
      }
    }
    return { ok: false, reason: err.message, steps: linkSteps(steps) };
  }
  return { ok: true, result: current, latex: makeStep(current, '').latex, steps: linkSteps(steps) };
}

function trySimplify(e) {
  try {
    return simplify(e);
  } catch (err) {
    if (err instanceof MathError) return null;
    throw err;
  }
}

/**
 * Simplified derivative without steps.
 * @param {Expr|string} expr
 * @param {string} [v='x']
 * @param {number} [order=1]
 * @returns {Expr}
 */
export function diff(expr, v = 'x', order = 1) {
  let e = simplify(ensureExpr(expr));
  for (let k = 0; k < order; k++) e = simplify(d1(e, v));
  return e;
}

// Direct recursive derivative (raw, simplified by the caller).
function d1(u, v) {
  if (freeOf(u, v)) return num(0);
  switch (u.type) {
    case 'sym': return num(1);
    case 'add': return add(...u.args.map((a) => d1(a, v)));
    case 'mul': {
      const terms = [];
      u.args.forEach((f, i) => {
        if (freeOf(f, v)) return;
        const others = u.args.filter((_, j) => j !== i);
        terms.push(mul(...others, d1(f, v)));
      });
      return add(...terms);
    }
    case 'pow': {
      const [b, ex] = u.args;
      if (freeOf(ex, v)) return mul(ex, pow(b, add(ex, num(-1))), d1(b, v));
      if (freeOf(b, v)) return mul(u, fn('ln', b), d1(ex, v));
      return mul(u, d1(mul(ex, fn('ln', b)), v));
    }
    case 'fn': {
      if (u.args[1] && !freeOf(u.args[1], v)) return d1(mul(fn('ln', u.args[0]), pow(fn('ln', u.args[1]), num(-1))), v);
      return mul(outerDerivative(u.name, u.args[0], u.args[1]), d1(u.args[0], v));
    }
    case 'eq': return eq(d1(u.args[0], v), d1(u.args[1], v));
    default: throw new MathError('Cannot differentiate a ' + u.type + ' expression');
  }
}

/**
 * Implicit differentiation: dy/dx from an equation F(x, y) = G(x, y).
 * @param {Expr|string} equation an equation, or an expression taken as F = 0
 * @param {string} [x='x']
 * @param {string} [y='y']
 * @returns {Derivation}
 */
export function implicitDerivative(equation, x = 'x', y = 'y') {
  let e = ensureExpr(equation);
  if (e.type !== 'eq') e = eq(e, num(0));
  const steps = [makeStep(e, 'Start with the equation')];
  const ctx = { partial: false, dependents: [y], final: new Set() };
  try {
    const both = eq(deriv(e.args[0], x), deriv(e.args[1], x));
    steps.push(makeStep(both, 'Differentiate both sides with respect to ' + x));
    const raw = rewrite(both, x, ctx, steps, 120);
    const dy = deriv(sym(y), x);
    const simp = eq(simplify(raw.args[0]), simplify(raw.args[1]));
    steps.push(makeStep(simp, 'Simplify'));
    // Solve the linear equation in dy/dx.
    const D = '__dydx__';
    const dyKey = key(dy);
    const toSym = (n) => (n.type === 'deriv' && key(n) === dyKey ? sym(D) : n.args ? withArgs(n, n.args.map(toSym)) : n);
    const F = simplify(add(toSym(simp.args[0]), mul(num(-1), toSym(simp.args[1]))));
    const cs = polyCoeffs(F, D);
    if (!cs || cs.length !== 2) {
      return { ok: false, reason: 'The differentiated equation is not linear in dy/dx', steps: linkSteps(steps) };
    }
    const [b, a] = cs;
    if (a.type === 'num' && a.value.isZero()) return { ok: false, reason: 'dy/dx cancels out', steps: linkSteps(steps) };
    steps.push(makeStep(eq(mul(a, dy), simplify(mul(num(-1), b))), 'Collect the dy/dx terms on one side'));
    const result = simplify(mul(num(-1), b, pow(a, num(-1))));
    const tidy = simplify(expand(result));
    const best = key(tidy).length < key(result).length ? tidy : result;
    steps.push(makeStep(eq(dy, best), 'Divide to solve for dy/dx'));
    return { ok: true, result: best, latex: makeStep(best, '').latex, steps: linkSteps(steps) };
  } catch (err) {
    if (err instanceof MathError) return { ok: false, reason: err.message, steps: linkSteps(steps) };
    throw err;
  }
}
