/**
 * Expression trees. Nodes are plain immutable objects with a stable `id`
 * (unique per created node) and a `type`. Builders here do no simplification;
 * `simplify` in simplify.js produces canonical forms. Keeping raw builders
 * separate lets derivations show unsimplified intermediate steps.
 *
 * Node types:
 * - `num`   { value: Rational }
 * - `sym`   { name: string }
 * - `const` { name: 'pi' | 'e' | 'i' | 'inf' }
 * - `add`, `mul` { args: Expr[] }
 * - `pow`   { args: [base, exponent] }
 * - `fn`    { name: string, args: Expr[] } (log takes [x, base])
 * - `eq`    { args: [lhs, rhs] }
 * - `integral` { args: [body] or [body, lower, upper], v: string }
 * - `deriv` { args: [body], v: string, order: number, partial: boolean }
 * - `limit` { args: [body, point], v: string, dir: '+' | '-' | null }
 * - `sum`   { args: [body, lower, upper], v: string }
 * - `matrix` { rows: Expr[][] } (display only)
 * - `list`  { args: Expr[] } (display only, comma separated)
 * - `bracket` { args: [F, a, b] } (display only, [F]_a^b)
 * @module math/expr
 */
import { Rational, R0, R1, RM1 } from './rational.js';

/**
 * @typedef {object} Expr
 * @property {string} id stable node id
 * @property {string} type node type
 * @property {Expr[]} [args] child nodes
 * @property {Rational} [value] for `num`
 * @property {string} [name] for `sym`, `const`, `fn`
 * @property {string} [v] bound variable for calculus operator nodes
 * @property {number} [order] derivative order
 * @property {boolean} [partial] partial derivative flag
 * @property {('+'|'-'|null)} [dir] one-sided limit direction
 * @property {Expr[][]} [rows] matrix rows for `matrix`
 */

let counter = 0;

/**
 * Create a node with a fresh id.
 * @param {string} type
 * @param {object} props
 * @returns {Expr}
 */
function make(type, props) {
  counter += 1;
  return { id: 'n' + counter, type, ...props };
}

/** Names of the supported single-argument elementary functions. */
export const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
  'exp', 'ln', 'log', 'sqrt', 'abs', 'floor', 'ceil', 'factorial', 'sign',
]);

/**
 * Numeric literal.
 * @param {number|bigint|string|Rational} v
 * @returns {Expr}
 */
export function num(v) {
  return make('num', { value: Rational.from(v) });
}

/**
 * Symbol (variable).
 * @param {string} name
 * @returns {Expr}
 */
export function sym(name) {
  return make('sym', { name });
}

/**
 * Named constant: pi, e, i (imaginary unit) or inf (positive infinity).
 * @param {'pi'|'e'|'i'|'inf'} name
 * @returns {Expr}
 */
export function constant(name) {
  return make('const', { name });
}

/**
 * Coerce numbers and Rationals to expressions; expressions pass through.
 * @param {Expr|number|bigint|Rational} v
 * @returns {Expr}
 */
export function toExpr(v) {
  if (v instanceof Rational || typeof v === 'number' || typeof v === 'bigint') return num(v);
  if (v && typeof v === 'object' && typeof v.type === 'string') return v;
  throw new TypeError('Expected an expression, got ' + String(v));
}

/**
 * Sum node (no simplification). A single argument is returned as is.
 * @param {...(Expr|number)} args
 * @returns {Expr}
 */
export function add(...args) {
  if (args.length === 0) return num(0);
  if (args.length === 1) return toExpr(args[0]);
  return make('add', { args: args.map(toExpr) });
}

/**
 * Product node (no simplification). A single argument is returned as is.
 * @param {...(Expr|number)} args
 * @returns {Expr}
 */
export function mul(...args) {
  if (args.length === 0) return num(1);
  if (args.length === 1) return toExpr(args[0]);
  return make('mul', { args: args.map(toExpr) });
}

/**
 * Power node.
 * @param {Expr|number} base
 * @param {Expr|number} exponent
 * @returns {Expr}
 */
export function pow(base, exponent) {
  return make('pow', { args: [toExpr(base), toExpr(exponent)] });
}

/**
 * Function application.
 * @param {string} name
 * @param {...(Expr|number)} args
 * @returns {Expr}
 */
export function fn(name, ...args) {
  return make('fn', { name, args: args.map(toExpr) });
}

/**
 * Equation lhs = rhs.
 * @param {Expr|number} lhs
 * @param {Expr|number} rhs
 * @returns {Expr}
 */
export function eq(lhs, rhs) {
  return make('eq', { args: [toExpr(lhs), toExpr(rhs)] });
}

/**
 * Negation, as the product -1 * x.
 * @param {Expr|number} x
 * @returns {Expr}
 */
export function neg(x) {
  return mul(num(-1), toExpr(x));
}

/**
 * Difference a - b, as a + (-1) b.
 * @param {Expr|number} a
 * @param {Expr|number} b
 * @returns {Expr}
 */
export function sub(a, b) {
  return add(toExpr(a), neg(b));
}

/**
 * Quotient a / b, as a * b^(-1).
 * @param {Expr|number} a
 * @param {Expr|number} b
 * @returns {Expr}
 */
export function div(a, b) {
  return mul(toExpr(a), pow(toExpr(b), num(-1)));
}

/**
 * Unevaluated integral.
 * @param {Expr} body
 * @param {string} v integration variable
 * @param {Expr|number} [lower]
 * @param {Expr|number} [upper]
 * @returns {Expr}
 */
export function integral(body, v, lower, upper) {
  const args = lower === undefined ? [body] : [body, toExpr(lower), toExpr(upper)];
  return make('integral', { args, v });
}

/**
 * Unevaluated derivative d^order/dv^order of body.
 * @param {Expr} body
 * @param {string} v
 * @param {number} [order=1]
 * @param {boolean} [partial=false]
 * @returns {Expr}
 */
export function deriv(body, v, order = 1, partial = false) {
  return make('deriv', { args: [body], v, order, partial });
}

/**
 * Unevaluated limit.
 * @param {Expr} body
 * @param {string} v
 * @param {Expr|number} point
 * @param {('+'|'-'|null)} [dir=null]
 * @returns {Expr}
 */
export function limitNode(body, v, point, dir = null) {
  return make('limit', { args: [body, toExpr(point)], v, dir });
}

/**
 * Unevaluated finite or infinite sum.
 * @param {Expr} body
 * @param {string} v
 * @param {Expr|number} lower
 * @param {Expr|number} upper
 * @returns {Expr}
 */
export function sumNode(body, v, lower, upper) {
  return make('sum', { args: [body, toExpr(lower), toExpr(upper)], v });
}

/**
 * Matrix of expressions, for display in derivations.
 * @param {Expr[][]} rows
 * @returns {Expr}
 */
export function matrixNode(rows) {
  return make('matrix', { rows, args: rows.flat() });
}

/**
 * Evaluation bracket [F]_a^b, shown in definite integral derivations.
 * @param {Expr} F
 * @param {Expr|number} a
 * @param {Expr|number} b
 * @returns {Expr}
 */
export function bracket(F, a, b) {
  return make('bracket', { args: [F, toExpr(a), toExpr(b)] });
}

/**
 * Comma-separated list of expressions (for displaying several equations or
 * solutions in one step).
 * @param {Expr[]} items
 * @returns {Expr}
 */
export function listNode(items) {
  return make('list', { args: items.map(toExpr) });
}

/**
 * Rebuild a node with new children, keeping type and attributes. Returns the
 * original node when every child is identical.
 * @param {Expr} e
 * @param {Expr[]} args
 * @returns {Expr}
 */
export function withArgs(e, args) {
  if (!e.args) return e;
  let same = args.length === e.args.length;
  for (let i = 0; same && i < args.length; i++) if (args[i] !== e.args[i]) same = false;
  if (same) return e;
  const props = { ...e, args };
  delete props.id;
  delete props.type;
  if (e.type === 'matrix') {
    const w = e.rows[0].length;
    props.rows = e.rows.map((_, i) => args.slice(i * w, (i + 1) * w));
  }
  return make(e.type, props);
}

/**
 * Apply f to every child and rebuild.
 * @param {Expr} e
 * @param {(child: Expr) => Expr} f
 * @returns {Expr}
 */
export function mapArgs(e, f) {
  return e.args ? withArgs(e, e.args.map(f)) : e;
}

/** @type {WeakMap<Expr, string>} */
const keyCache = new WeakMap();

/**
 * Canonical structural key. Two nodes with equal keys are the same expression
 * (ignoring ids).
 * @param {Expr} e
 * @returns {string}
 */
export function key(e) {
  const c = keyCache.get(e);
  if (c !== undefined) return c;
  let k;
  switch (e.type) {
    case 'num': k = '#' + e.value.toString(); break;
    case 'sym': k = '$' + e.name; break;
    case 'const': k = '@' + e.name; break;
    case 'fn': k = e.name + '(' + e.args.map(key).join(',') + ')'; break;
    case 'deriv': k = 'D' + e.v + e.order + (e.partial ? 'p' : '') + '(' + key(e.args[0]) + ')'; break;
    case 'integral': case 'sum': k = e.type + e.v + '(' + e.args.map(key).join(',') + ')'; break;
    case 'limit': k = 'lim' + e.v + (e.dir || '') + '(' + e.args.map(key).join(',') + ')'; break;
    case 'matrix': k = 'M' + e.rows[0].length + '(' + e.args.map(key).join(',') + ')'; break;
    default: k = e.type + '(' + e.args.map(key).join(',') + ')';
  }
  keyCache.set(e, k);
  return k;
}

/**
 * Structural equality (ignores node ids; no simplification).
 * @param {Expr} a
 * @param {Expr} b
 * @returns {boolean}
 */
export function same(a, b) {
  return a === b || key(a) === key(b);
}

/**
 * @param {Expr} e
 * @returns {boolean} true for numeric literals
 */
export function isNum(e) {
  return e.type === 'num';
}

/**
 * @param {Expr} e
 * @param {number|Rational} v
 * @returns {boolean} true when e is the literal v
 */
export function isNumValue(e, v) {
  return e.type === 'num' && e.value.eq(Rational.from(v));
}

/**
 * True when the expression does not contain the symbol `name` (bound
 * variables of integrals, sums and limits are not free).
 * @param {Expr} e
 * @param {string} name
 * @returns {boolean}
 */
export function freeOf(e, name) {
  if (e.type === 'sym') return e.name !== name;
  if (!e.args) return true;
  if ((e.type === 'integral' || e.type === 'sum' || e.type === 'limit') && e.v === name) {
    return e.args.slice(1).every((a) => freeOf(a, name));
  }
  return e.args.every((a) => freeOf(a, name));
}

/**
 * Set of free symbol names.
 * @param {Expr} e
 * @returns {Set<string>}
 */
export function symbols(e) {
  const out = new Set();
  const walk = (n, bound) => {
    if (n.type === 'sym') {
      if (!bound.has(n.name)) out.add(n.name);
      return;
    }
    if (!n.args) return;
    if (n.type === 'integral' || n.type === 'sum' || n.type === 'limit') {
      const inner = new Set(bound);
      inner.add(n.v);
      walk(n.args[0], inner);
      n.args.slice(1).forEach((a) => walk(a, bound));
      return;
    }
    n.args.forEach((a) => walk(a, bound));
  };
  walk(e, new Set());
  return out;
}

/**
 * Replace symbols by expressions.
 * @param {Expr} e
 * @param {Record<string, Expr|number>} map
 * @returns {Expr}
 */
export function substitute(e, map) {
  if (e.type === 'sym') return Object.prototype.hasOwnProperty.call(map, e.name) ? toExpr(map[e.name]) : e;
  if (!e.args) return e;
  if ((e.type === 'integral' || e.type === 'sum' || e.type === 'limit') && Object.prototype.hasOwnProperty.call(map, e.v)) {
    const inner = { ...map };
    delete inner[e.v];
    return withArgs(e, e.args.map((a, i) => substitute(a, i === 0 ? inner : map)));
  }
  return mapArgs(e, (a) => substitute(a, map));
}

/**
 * Replace every occurrence of a subtree (by structural equality).
 * @param {Expr} e
 * @param {Expr} target
 * @param {Expr} replacement
 * @returns {Expr}
 */
export function replaceSubtree(e, target, replacement) {
  const k = key(target);
  const walk = (n) => (key(n) === k ? replacement : mapArgs(n, walk));
  return walk(e);
}

/**
 * Count the nodes in a tree.
 * @param {Expr} e
 * @returns {number}
 */
export function size(e) {
  if (!e.args) return 1;
  let s = 1;
  for (const a of e.args) s += size(a);
  return s;
}

/**
 * Visit every node (pre-order).
 * @param {Expr} e
 * @param {(n: Expr) => void} f
 * @returns {void}
 */
export function walk(e, f) {
  f(e);
  if (e.args) for (const a of e.args) walk(a, f);
}

/** Frequently used literals. Build fresh ones with num() where ids matter. */
export const ZERO = make('num', { value: R0 });
/** Literal one. */
export const ONE = make('num', { value: R1 });
/** Literal minus one. */
export const MINUS_ONE = make('num', { value: RM1 });

/**
 * Error thrown for mathematically undefined operations (division by zero,
 * dimension mismatches in derived structures). Carries a plain reason.
 */
export class MathError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'MathError';
  }
}
