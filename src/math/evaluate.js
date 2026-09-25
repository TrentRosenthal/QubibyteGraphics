/**
 * Numeric evaluation of expression trees. `compileReal` builds a fast real
 * function (odd roots of negative numbers are real, so x^(1/3) graphs for
 * x < 0; values outside a real domain give NaN). `compileComplex` and
 * `evaluate` use principal complex branches (see complex.js).
 * @module math/evaluate
 */
import { Complex } from './complex.js';
import { gamma } from './special.js';
import { ensureExpr } from './parse.js';
import { MathError } from './expr.js';

/** @typedef {import('./expr.js').Expr} Expr */

const REAL_FN = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => Math.cos(x) / Math.sin(x),
  asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  exp: Math.exp, ln: (x) => (x < 0 ? NaN : Math.log(x)), sqrt: (x) => (x < 0 ? NaN : Math.sqrt(x)),
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, sign: Math.sign, factorial: (x) => gamma(x + 1),
};

function realPow(b, e, oddDen) {
  if (b < 0 && !Number.isInteger(e)) {
    if (oddDen) {
      const r = Math.pow(-b, e);
      return oddDen === 'odd-num' ? -r : r;
    }
    return NaN;
  }
  return Math.pow(b, e);
}

/**
 * Compile an expression into a real-valued JavaScript function.
 * @param {Expr|string} expr
 * @param {string[]} vars argument order
 * @returns {(...args: number[]) => number}
 */
export function compileReal(expr, vars) {
  const e = ensureExpr(expr);
  const index = new Map(vars.map((v, i) => [v, i]));
  const build = (n) => {
    switch (n.type) {
      case 'num': {
        const v = n.value.toNumber();
        return () => v;
      }
      case 'const': {
        const v = { pi: Math.PI, e: Math.E, inf: Infinity, i: NaN }[n.name];
        return () => v;
      }
      case 'sym': {
        if (!index.has(n.name)) throw new MathError('No value for variable ' + n.name);
        const i = index.get(n.name);
        return (a) => a[i];
      }
      case 'add': {
        const fs = n.args.map(build);
        return (a) => {
          let s = 0;
          for (const f of fs) s += f(a);
          return s;
        };
      }
      case 'mul': {
        const fs = n.args.map(build);
        return (a) => {
          let s = 1;
          for (const f of fs) s *= f(a);
          return s;
        };
      }
      case 'pow': {
        const fb = build(n.args[0]);
        const ex = n.args[1];
        if (ex.type === 'num') {
          const r = ex.value;
          const v = r.toNumber();
          if (r.isInteger()) {
            if (v === 2) return (a) => {
              const b = fb(a);
              return b * b;
            };
            return (a) => Math.pow(fb(a), v);
          }
          if (r.d % 2n === 1n) {
            const tag = r.n % 2n === 0n ? 'odd-even' : 'odd-num';
            return (a) => realPow(fb(a), v, tag);
          }
          if (v === 0.5) return (a) => {
            const b = fb(a);
            return b < 0 ? NaN : Math.sqrt(b);
          };
          return (a) => realPow(fb(a), v, null);
        }
        const fe = build(ex);
        return (a) => realPow(fb(a), fe(a), null);
      }
      case 'fn': {
        const fa = build(n.args[0]);
        if (n.name === 'log') {
          const fbase = n.args[1] ? build(n.args[1]) : () => 10;
          return (a) => {
            const x = fa(a);
            return x < 0 ? NaN : Math.log(x) / Math.log(fbase(a));
          };
        }
        const f = REAL_FN[n.name];
        if (!f) throw new MathError('Cannot evaluate function ' + n.name);
        return (a) => f(fa(a));
      }
      default: throw new MathError('Cannot evaluate a ' + n.type + ' node numerically');
    }
  };
  const f = build(e);
  return (...args) => f(args);
}

const C1 = new Complex(1, 0);

/**
 * Compile an expression into a complex-valued function (principal branches).
 * @param {Expr|string} expr
 * @param {string[]} vars
 * @returns {(...args: (Complex|number)[]) => Complex}
 */
export function compileComplex(expr, vars) {
  const e = ensureExpr(expr);
  const index = new Map(vars.map((v, i) => [v, i]));
  const build = (n) => {
    switch (n.type) {
      case 'num': {
        const v = new Complex(n.value.toNumber(), 0);
        return () => v;
      }
      case 'const': {
        const v = { pi: new Complex(Math.PI), e: new Complex(Math.E), i: new Complex(0, 1), inf: new Complex(Infinity) }[n.name];
        return () => v;
      }
      case 'sym': {
        if (!index.has(n.name)) throw new MathError('No value for variable ' + n.name);
        const i = index.get(n.name);
        return (a) => a[i];
      }
      case 'add': {
        const fs = n.args.map(build);
        return (a) => {
          let re = 0;
          let im = 0;
          for (const f of fs) {
            const v = f(a);
            re += v.re;
            im += v.im;
          }
          return new Complex(re, im);
        };
      }
      case 'mul': {
        const fs = n.args.map(build);
        return (a) => {
          let s = C1;
          for (const f of fs) s = s.mul(f(a));
          return s;
        };
      }
      case 'pow': {
        const fb = build(n.args[0]);
        const fe = build(n.args[1]);
        const isE = n.args[0].type === 'const' && n.args[0].name === 'e';
        if (isE) return (a) => fe(a).exp();
        return (a) => fb(a).pow(fe(a));
      }
      case 'fn': {
        const fa = build(n.args[0]);
        switch (n.name) {
          case 'ln': return (a) => fa(a).log();
          case 'log': {
            const fbase = n.args[1] ? build(n.args[1]) : () => new Complex(10);
            return (a) => fa(a).log().div(fbase(a).log());
          }
          case 'exp': return (a) => fa(a).exp();
          case 'sqrt': return (a) => fa(a).sqrt();
          case 'abs': return (a) => new Complex(fa(a).abs(), 0);
          case 'floor': case 'ceil': case 'sign': case 'factorial': {
            const f = REAL_FN[n.name];
            return (a) => {
              const v = fa(a);
              return new Complex(v.im === 0 ? f(v.re) : NaN, 0);
            };
          }
          default: {
            if (typeof C1[n.name] !== 'function') throw new MathError('Cannot evaluate function ' + n.name);
            const name = n.name;
            return (a) => fa(a)[name]();
          }
        }
      }
      default: throw new MathError('Cannot evaluate a ' + n.type + ' node numerically');
    }
  };
  const f = build(e);
  return (...args) => f(args.map((x) => Complex.from(x)));
}

/**
 * Evaluate numerically with the given variable values. Returns a plain
 * number when the result is real (imaginary part below 1e-12 relative),
 * otherwise a Complex.
 * @param {Expr|string} expr
 * @param {Record<string, number|Complex>} [vars={}]
 * @returns {number|Complex}
 */
export function evaluate(expr, vars = {}) {
  const names = Object.keys(vars);
  const v = compileComplex(expr, names)(...names.map((k) => vars[k]));
  return v.isReal() ? v.re : v;
}
