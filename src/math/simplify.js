/**
 * Canonical simplification and expansion.
 *
 * Canonical form: sums and products are flattened, numeric parts are combined
 * with exact rational arithmetic, like terms and like powers are collected,
 * radicals are reduced and rationalized (sqrt(12) -> 2 sqrt(3), 1/sqrt(2) ->
 * sqrt(2)/2), exact trig values at rational multiples of pi are evaluated,
 * odd and even function symmetries are applied, and a numeric coefficient
 * multiplying a single sum is distributed. sqrt(u) is stored as u^(1/2) and
 * exp(u) as e^u. Only identities that are valid for every complex input are
 * applied automatically.
 * @module math/simplify
 */
import { Rational, R0, R1, RHALF, bigIntRoot, bigGcd } from './rational.js';
import {
  num, constant, add, mul, pow, fn, withArgs, mapArgs, key, MathError,
} from './expr.js';

/** @typedef {import('./expr.js').Expr} Expr */

/** @type {WeakMap<Expr, Expr>} */
const cache = new WeakMap();

/**
 * Simplify an expression to canonical form.
 * @param {Expr} e
 * @returns {Expr}
 */
export function simplify(e) {
  const c = cache.get(e);
  if (c) return c;
  const r = simplifyNode(e);
  cache.set(e, r);
  cache.set(r, r);
  return r;
}

function simplifyNode(e) {
  switch (e.type) {
    case 'num': case 'sym': case 'const': return e;
    case 'add': return simplifyAdd(e.args.map(simplify));
    case 'mul': return simplifyMul(e.args.map(simplify));
    case 'pow': return simplifyPow(simplify(e.args[0]), simplify(e.args[1]));
    case 'fn': return simplifyFn(e.name, e.args.map(simplify), e);
    default: return mapArgs(e, simplify);
  }
}

/**
 * Split a canonical term into numeric coefficient and remaining factor.
 * @param {Expr} t
 * @returns {[Rational, Expr|null]}
 */
export function splitCoeff(t) {
  if (t.type === 'num') return [t.value, null];
  if (t.type === 'mul' && t.args[0].type === 'num') {
    const rest = t.args.slice(1);
    return [t.args[0].value, rest.length === 1 ? rest[0] : mul(...rest)];
  }
  return [R1, t];
}

/**
 * True for a term whose canonical coefficient is negative.
 * @param {Expr} t
 * @returns {boolean}
 */
export function isNegativeTerm(t) {
  return splitCoeff(t)[0].isNegative();
}

function termWithCoeff(c, rest) {
  if (rest === null) return num(c);
  if (c.isOne()) return rest;
  if (rest.type === 'mul') return mul(num(c), ...rest.args);
  return mul(num(c), rest);
}

// Term ordering: polynomial terms by descending total degree, then graded
// lexicographic order on variable names, numbers last.
function monomialInfo(t) {
  const degs = new Map();
  let total = 0;
  let poly = true;
  const factors = t.type === 'mul' ? t.args : [t];
  for (const f of factors) {
    if (f.type === 'num') continue;
    if (f.type === 'sym') {
      degs.set(f.name, (degs.get(f.name) || 0) + 1);
      total += 1;
    } else if (f.type === 'pow' && f.args[0].type === 'sym' && f.args[1].type === 'num' && f.args[1].value.isInteger() && f.args[1].value.sign() > 0) {
      const d = Number(f.args[1].value.n);
      degs.set(f.args[0].name, (degs.get(f.args[0].name) || 0) + d);
      total += d;
    } else {
      poly = false;
    }
  }
  return { degs, total, poly };
}

function compareTerms(a, b) {
  const an = a.type === 'num';
  const bn = b.type === 'num';
  if (an !== bn) return an ? 1 : -1;
  const ia = monomialInfo(a);
  const ib = monomialInfo(b);
  if (ia.total !== ib.total) return ib.total - ia.total;
  const names = [...new Set([...ia.degs.keys(), ...ib.degs.keys()])].sort();
  for (const nm of names) {
    const da = ia.degs.get(nm) || 0;
    const db = ib.degs.get(nm) || 0;
    if (da !== db) return db - da;
  }
  if (ia.poly !== ib.poly) return ia.poly ? -1 : 1;
  const ka = key(splitCoeff(a)[1] || a);
  const kb = key(splitCoeff(b)[1] || b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function factorClass(f) {
  if (f.type === 'num') return 0;
  if (f.type === 'const') return f.name === 'i' ? 1.6 : 1;
  if (f.type === 'pow' && f.args[0].type === 'num') return 1.5;
  if (f.type === 'sym') return 2;
  if (f.type === 'pow' && f.args[0].type === 'sym') return 2;
  return 3;
}

function factorName(f) {
  if (f.type === 'sym') return f.name;
  if (f.type === 'pow' && f.args[0].type === 'sym') return f.args[0].name;
  if (f.type === 'const') return { i: '0', pi: '1', e: '2', inf: '3' }[f.name] || f.name;
  return key(f);
}

function compareFactors(a, b) {
  const ca = factorClass(a);
  const cb = factorClass(b);
  if (ca !== cb) return ca - cb;
  const na = factorName(a);
  const nb = factorName(b);
  const la = na.toLowerCase();
  const lb = nb.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  if (na !== nb) return na < nb ? -1 : 1;
  const ka = key(a);
  const kb = key(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function simplifyAdd(args) {
  let constSum = R0;
  const order = [];
  const terms = new Map();
  const stack = [...args];
  while (stack.length) {
    const t = stack.shift();
    if (t.type === 'add') {
      stack.unshift(...t.args);
      continue;
    }
    const [c, rest] = splitCoeff(t);
    if (rest === null) {
      constSum = constSum.add(c);
      continue;
    }
    const k = key(rest);
    const prev = terms.get(k);
    if (prev) prev.c = prev.c.add(c);
    else {
      terms.set(k, { c, rest });
      order.push(k);
    }
  }
  // Pythagorean identities with equal coefficients.
  const pyth = [['sin', 'cos', 1], ['cosh', 'sinh', -1]];
  for (const k of order) {
    const t = terms.get(k);
    if (!t || t.c.isZero()) continue;
    const r = t.rest;
    if (r.type !== 'pow' || r.args[1].type !== 'num' || !r.args[1].value.eq(Rational.from(2)) || r.args[0].type !== 'fn') continue;
    for (const [f1, f2, s] of pyth) {
      if (r.args[0].name !== f1) continue;
      const partner = key(pow(fn(f2, r.args[0].args[0]), num(2)));
      const p = terms.get(partner);
      if (p && !p.c.isZero() && p.c.eq(s === 1 ? t.c : t.c.neg())) {
        constSum = constSum.add(t.c);
        t.c = R0;
        p.c = R0;
      }
    }
  }
  const out = [];
  for (const k of order) {
    const t = terms.get(k);
    if (t.c.isZero()) continue;
    out.push(termWithCoeff(t.c, t.rest));
  }
  if (!constSum.isZero()) out.push(num(constSum));
  if (out.length === 0) return num(0);
  if (out.length === 1) return out[0];
  // Terms built from a coefficient and a canonical product may need a final
  // pass when the coefficient multiplies a sum; termWithCoeff never builds
  // that shape because distribution already happened in simplifyMul.
  out.sort(compareTerms);
  return add(...out);
}

function rationalExp(e) {
  return e.type === 'num' ? e.value : null;
}

// Numeric content of a sum: g * (sum / g) where g is the rational gcd of the
// term coefficients, times the sign of the leading term when allowed.
function extractContent(sum, allowSign) {
  let g = null;
  for (const t of sum.args) {
    const c = splitCoeff(t)[0].abs();
    if (c.isZero()) continue;
    g = g ? new Rational(bigGcd(g.n * c.d, c.n * g.d), g.d * c.d) : c;
  }
  if (!g) return [R1, sum];
  if (allowSign && splitCoeff(sum.args[0])[0].isNegative()) g = g.neg();
  if (g.isOne()) return [R1, sum];
  return [g, simplifyAdd(sum.args.map((t) => simplifyMul([num(g.inv()), t])))];
}

function simplifyMul(args) {
  let coeff = R1;
  if (args.filter((a) => a.type !== 'num').length >= 2) {
    args = args.map((a) => {
      if (a.type !== 'add') return a;
      const [g, rest] = extractContent(a, true);
      return g.isOne() ? a : mul(num(g), rest);
    });
  }
  let queue = [...args];
  let factors = [];
  for (let round = 0; round < 8; round++) {
    const groups = new Map();
    const order = [];
    while (queue.length) {
      const f = queue.shift();
      if (f.type === 'num') {
        coeff = coeff.mul(f.value);
        continue;
      }
      if (f.type === 'mul') {
        queue.unshift(...f.args);
        continue;
      }
      const base = f.type === 'pow' ? f.args[0] : f;
      const ex = f.type === 'pow' ? f.args[1] : num(1);
      const k = key(base);
      const g = groups.get(k);
      if (g) g.exps.push(ex);
      else {
        groups.set(k, { base, exps: [ex], orig: f });
        order.push(k);
      }
    }
    if (coeff.isZero()) return num(0);
    factors = [];
    let again = false;
    for (const k of order) {
      const g = groups.get(k);
      if (g.exps.length === 1) {
        factors.push(g.orig);
        continue;
      }
      const ex = simplifyAdd(g.exps);
      const p = simplifyPow(g.base, ex);
      if (p.type === 'num' || p.type === 'mul') {
        queue.push(p);
        again = true;
      } else {
        factors.push(p);
      }
    }
    // Combine radicals of numbers sharing an exponent: sqrt(2) sqrt(3) -> sqrt(6).
    const byExp = new Map();
    const kept = [];
    for (const f of factors) {
      if (f.type === 'pow' && f.args[0].type === 'num' && f.args[1].type === 'num' && f.args[0].value.sign() > 0) {
        const ek = f.args[1].value.toString();
        const prev = byExp.get(ek);
        if (prev) {
          prev.base = prev.base.mul(f.args[0].value);
          prev.count += 1;
        } else byExp.set(ek, { base: f.args[0].value, exp: f.args[1].value, count: 1, node: f });
      } else kept.push(f);
    }
    for (const v of byExp.values()) {
      if (v.count === 1) kept.push(v.node);
      else {
        const p = simplifyPow(num(v.base), num(v.exp));
        queue.push(p);
        again = true;
      }
    }
    factors = kept;
    if (!again) break;
    queue = queue.concat(factors);
    factors = [];
  }
  factors = combineTrigRatios(factors);
  if (factors.length === 0) return num(coeff);
  if (factors.length === 1 && factors[0].type === 'add' && !coeff.isOne()) {
    return simplifyAdd(factors[0].args.map((t) => simplifyMul([num(coeff), t])));
  }
  factors.sort(compareFactors);
  if (coeff.isOne()) return factors.length === 1 ? factors[0] : mul(...factors);
  return mul(num(coeff), ...factors);
}

// sin(u)^n cos(u)^(-n) -> tan(u)^n and cos(u)^n sin(u)^(-n) -> cot(u)^n.
function combineTrigRatios(factors) {
  const info = (f) => {
    const b = f.type === 'pow' ? f.args[0] : f;
    const ex = f.type === 'pow' ? f.args[1] : num(1);
    if (b.type !== 'fn' || (b.name !== 'sin' && b.name !== 'cos') || ex.type !== 'num' || !ex.value.isInteger()) return null;
    return { name: b.name, arg: key(b.args[0]), argNode: b.args[0], n: ex.value };
  };
  for (let i = 0; i < factors.length; i++) {
    const a = info(factors[i]);
    if (!a || a.n.sign() <= 0) continue;
    for (let j = 0; j < factors.length; j++) {
      const b = info(factors[j]);
      if (!b || i === j || b.name === a.name || b.arg !== a.arg || !b.n.eq(a.n.neg())) continue;
      const t = fn(a.name === 'sin' ? 'tan' : 'cot', a.argNode);
      const rest = factors.filter((_, k) => k !== i && k !== j);
      rest.push(a.n.isOne() ? t : pow(t, num(a.n)));
      return combineTrigRatios(rest);
    }
  }
  return factors;
}

// Trial-division primes used for extracting perfect powers.
const SMALL_PRIMES = (() => {
  const out = [];
  const lim = 1000;
  const sieve = new Uint8Array(lim + 1);
  for (let i = 2; i <= lim; i++) {
    if (sieve[i]) continue;
    out.push(BigInt(i));
    for (let j = i * i; j <= lim; j += i) sieve[j] = 1;
  }
  return out;
})();

// Write M = a^q * b with b as small as trial division allows.
function extractPower(M, q) {
  const Q = BigInt(q);
  let a = 1n;
  let b = 1n;
  let m = M;
  for (const p of SMALL_PRIMES) {
    if (p * p > m) break;
    let e = 0n;
    while (m % p === 0n) {
      m /= p;
      e += 1n;
    }
    if (e > 0n) {
      a *= p ** (e / Q);
      b *= p ** (e % Q);
    }
  }
  if (m > 1n) {
    const r = bigIntRoot(m, q);
    if (r ** Q === m) a *= r;
    else b *= m;
  }
  return [a, b];
}

function radical(r, ex) {
  // r > 0 rational, ex = p/q with q > 1.
  const k = ex.floor();
  const frac = ex.sub(new Rational(k));
  const q = Number(frac.d);
  const p = frac.n;
  const m = r.pow(p);
  const M = m.n * m.d ** BigInt(q - 1);
  const [a, bb] = extractPower(M, q);
  let b = bb;
  const outer = r.pow(k).mul(new Rational(a, m.d));
  if (b === 1n) return num(outer);
  let qq = q;
  // Reduce the index when b is itself a perfect power.
  for (let g = qq; g >= 2; g--) {
    if (qq % g !== 0) continue;
    const root = bigIntRoot(b, g);
    if (root ** BigInt(g) === b) {
      b = root;
      qq = qq / g;
      break;
    }
  }
  if (qq === 1) return num(outer.mul(new Rational(b)));
  const rad = pow(num(b), num(new Rational(1n, BigInt(qq))));
  if (outer.isOne()) return rad;
  return mul(num(outer), rad);
}

function isImagUnit(e) {
  return e.type === 'const' && e.name === 'i';
}

/**
 * Simplify base^exponent where both parts are already canonical.
 * @param {Expr} b
 * @param {Expr} ex
 * @returns {Expr}
 */
function simplifyPow(b, ex) {
  const r = rationalExp(ex);
  if (r && r.isZero()) return num(1);
  if (r && r.isOne()) return b;
  if (b.type === 'num') {
    const bv = b.value;
    if (bv.isOne()) return num(1);
    if (bv.isZero()) {
      if (r && r.sign() > 0) return num(0);
      if (r && r.sign() < 0) throw new MathError('Division by zero');
      return pow(b, ex);
    }
    if (r && r.isInteger()) {
      const bits = Math.max(bv.n.toString(2).length, bv.d.toString(2).length);
      if (Math.abs(Number(r.n)) * bits < 200000) return num(bv.pow(r.n));
      return pow(b, ex);
    }
    if (r && bv.sign() > 0) return radical(bv, r);
    if (r && bv.sign() < 0 && r.d === 2n) {
      const iPart = simplifyPow(constant('i'), num(r.n));
      return simplifyMul([iPart, radical(bv.neg(), r)]);
    }
    return pow(b, ex);
  }
  if (isImagUnit(b) && r && r.isInteger()) {
    const m = Number(((r.n % 4n) + 4n) % 4n);
    return [num(1), constant('i'), num(-1), simplifyMul([num(-1), constant('i')])][m];
  }
  if (b.type === 'const' && b.name === 'e') {
    const special = expOfLog(ex);
    if (special) return special;
  }
  if (b.type === 'pow' && r && r.isInteger()) {
    return simplifyPow(b.args[0], simplifyMul([b.args[1], ex]));
  }
  if (b.type === 'pow' && r && b.args[1].type === 'num') {
    // (u^a)^b = u^(ab) holds when a is in (-1, 1] (the principal branch is
    // preserved), for example (sqrt(u))^3 = u^(3/2).
    const a = b.args[1].value;
    if (a.cmp(Rational.from(-1)) > 0 && a.cmp(R1) <= 0) return simplifyPow(b.args[0], num(a.mul(r)));
  }
  if (b.type === 'add' && r) {
    const [g, rest] = extractContent(b, r.isInteger());
    if (!g.isOne()) return simplifyMul([simplifyPow(num(g), ex), simplifyPow(rest, ex)]);
  }
  if (b.type === 'mul' && r) {
    if (r.isInteger()) return simplifyMul(b.args.map((f) => simplifyPow(f, ex)));
    const [c, rest] = splitCoeff(b);
    if (c.sign() > 0 && !c.isOne()) return simplifyMul([simplifyPow(num(c), ex), simplifyPow(rest, ex)]);
  }
  return pow(b, ex);
}

// e^(ln u) = u, e^(c ln u) = u^c, e^(a + ln u) = u e^a, e^(i c pi) exact.
function expOfLog(ex) {
  if (ex.type === 'fn' && ex.name === 'ln') return ex.args[0];
  if (ex.type === 'mul') {
    const [c, rest] = splitCoeff(ex);
    if (rest && rest.type === 'fn' && rest.name === 'ln') return simplifyPow(rest.args[0], num(c));
    const ipi = ipiMultiple(ex);
    if (ipi) {
      const cs = trigExact('cos', ipi);
      const sn = trigExact('sin', ipi);
      if (cs && sn) return simplifyAdd([cs, simplifyMul([sn, constant('i')])]);
    }
  }
  if (ex.type === 'add') {
    const logs = [];
    const others = [];
    for (const t of ex.args) {
      const [c, rest] = splitCoeff(t);
      if (rest && rest.type === 'fn' && rest.name === 'ln') logs.push(simplifyPow(rest.args[0], num(c)));
      else others.push(t);
    }
    if (logs.length) {
      const e = constant('e');
      const tail = others.length ? simplifyPow(e, simplifyAdd(others)) : num(1);
      return simplifyMul([...logs, tail]);
    }
  }
  return null;
}

function ipiMultiple(ex) {
  if (ex.type !== 'mul') return null;
  let c = R1;
  let hasI = false;
  let hasPi = false;
  for (const f of ex.args) {
    if (f.type === 'num') c = c.mul(f.value);
    else if (isImagUnit(f) && !hasI) hasI = true;
    else if (f.type === 'const' && f.name === 'pi' && !hasPi) hasPi = true;
    else return null;
  }
  return hasI && hasPi ? c : null;
}

/**
 * If e is a rational multiple of pi return that rational.
 * @param {Expr} e
 * @returns {Rational|null}
 */
export function piMultiple(e) {
  if (e.type === 'num' && e.value.isZero()) return R0;
  if (e.type === 'const' && e.name === 'pi') return R1;
  if (e.type === 'mul' && e.args.length === 2 && e.args[0].type === 'num' && e.args[1].type === 'const' && e.args[1].name === 'pi') {
    return e.args[0].value;
  }
  return null;
}

const SQ = (n) => pow(num(n), num(RHALF));
const Q = (a, b) => num(new Rational(BigInt(a), BigInt(b)));

// sin(c pi) for c in [0, 1/2] with denominators dividing 12.
function sinFirstQuadrant(c) {
  const t = c.mul(Rational.from(12));
  if (!t.isInteger()) return null;
  switch (Number(t.n)) {
    case 0: return num(0);
    case 1: return simplifyAdd([simplifyMul([Q(1, 4), SQ(6)]), simplifyMul([Q(-1, 4), SQ(2)])]);
    case 2: return Q(1, 2);
    case 3: return simplifyMul([Q(1, 2), SQ(2)]);
    case 4: return simplifyMul([Q(1, 2), SQ(3)]);
    case 5: return simplifyAdd([simplifyMul([Q(1, 4), SQ(6)]), simplifyMul([Q(1, 4), SQ(2)])]);
    case 6: return num(1);
    default: return null;
  }
}

function sinOfPiMultiple(c) {
  const two = Rational.from(2);
  let t = c.sub(two.mul(new Rational(c.div(two).floor())));
  let sign = 1;
  if (t.cmp(R1) >= 0) {
    t = t.sub(R1);
    sign = -sign;
  }
  if (t.cmp(RHALF) > 0) t = R1.sub(t);
  const v = sinFirstQuadrant(t);
  if (!v) return null;
  return sign === 1 ? v : simplifyMul([num(-1), v]);
}

function trigExact(name, c) {
  const s = () => sinOfPiMultiple(c);
  const co = () => sinOfPiMultiple(RHALF.sub(c));
  const ratio = (a, b) => {
    if (!a || !b) return null;
    if (b.type === 'num' && b.value.isZero()) return null;
    return simplifyMul([a, simplifyPow(b, num(-1))]);
  };
  switch (name) {
    case 'sin': return s();
    case 'cos': return co();
    case 'tan': return ratio(s(), co());
    case 'cot': return ratio(co(), s());
    case 'sec': return ratio(num(1), co());
    case 'csc': return ratio(num(1), s());
    default: return null;
  }
}

const ODD = new Set(['sin', 'tan', 'csc', 'cot', 'asin', 'atan', 'sinh', 'tanh']);
const EVEN = new Set(['cos', 'sec', 'cosh']);

// Exact inverse-trig table: value key -> multiple of pi.
let inverseTable = null;
function inverseValues() {
  if (inverseTable) return inverseTable;
  const asin = new Map();
  const atan = new Map();
  for (const c of [0, 1, 2, 3, 4, 5, 6]) {
    const r = new Rational(BigInt(c), 12n);
    if (c % 2 === 1 && c !== 3) continue;
    const v = sinOfPiMultiple(r);
    asin.set(key(v), r);
    const t = trigExact('tan', r);
    if (t) atan.set(key(t), r);
  }
  inverseTable = { asin, atan };
  return inverseTable;
}

function inverseExact(name, arg) {
  const { asin, atan } = inverseValues();
  let a = arg;
  let sign = 1;
  if (isNegativeTerm(a)) {
    a = simplifyMul([num(-1), a]);
    sign = -1;
  }
  const k = key(a);
  const piTimes = (c) => simplifyMul([num(c), constant('pi')]);
  if (name === 'asin' && asin.has(k)) return piTimes(asin.get(k).mul(Rational.from(sign)));
  if (name === 'acos' && asin.has(k)) return piTimes(RHALF.sub(asin.get(k).mul(Rational.from(sign))));
  if (name === 'atan' && atan.has(k)) return piTimes(atan.get(k).mul(Rational.from(sign)));
  return null;
}

/**
 * Conservative test that an expression is real and non-negative for every
 * real value of its symbols (symbols are treated as real variables).
 * @param {Expr} e
 * @returns {boolean}
 */
export function isNonNegative(e) {
  switch (e.type) {
    case 'num': return e.value.sign() >= 0;
    case 'const': return e.name === 'pi' || e.name === 'e';
    case 'add': return e.args.every(isNonNegative);
    case 'mul': return e.args.every(isNonNegative);
    case 'pow': {
      const [b, ex] = e.args;
      if (containsImag(b) || containsImag(ex)) return false;
      if (b.type === 'const' && b.name === 'e') return true;
      if (ex.type === 'num' && ex.value.isInteger() && ex.value.n % 2n === 0n) return true;
      if (ex.type === 'num' && ex.value.d % 2n === 0n) return true;
      return isNonNegative(b) && (b.type === 'num' || b.type === 'const' || ex.type === 'num');
    }
    case 'fn': return ['abs', 'cosh', 'exp', 'sqrt'].includes(e.name) && !containsImag(e.args[0]);
    default: return false;
  }
}

function factorialBig(n) {
  let r = 1n;
  for (let i = 2n; i <= n; i++) r *= i;
  return r;
}

function simplifyFn(name, args, orig) {
  const a = args[0];
  if (name === 'sqrt') return simplifyPow(a, num(RHALF));
  if (name === 'exp') return simplifyPow(constant('e'), a);
  if (name === 'log') {
    const base = args[1] || num(10);
    return simplifyLog(a, base);
  }
  if (name === 'ln') return simplifyLn(a);
  if (['sin', 'cos', 'tan', 'sec', 'csc', 'cot'].includes(name)) {
    const c = piMultiple(a);
    if (c) {
      const v = trigExact(name, c);
      if (v) return v;
    }
    const inv = { sin: 'asin', cos: 'acos', tan: 'atan' }[name];
    if (inv && a.type === 'fn' && a.name === inv) return a.args[0];
  }
  if (name === 'asin' || name === 'acos' || name === 'atan') {
    const v = inverseExact(name, a);
    if (v) return v;
  }
  if ((name === 'sinh' || name === 'tanh') && a.type === 'num' && a.value.isZero()) return num(0);
  if (name === 'cosh' && a.type === 'num' && a.value.isZero()) return num(1);
  if (ODD.has(name) && isNegativeTerm(a) && a.type !== 'add') {
    return simplifyMul([num(-1), simplifyFn(name, [simplifyMul([num(-1), a])], null)]);
  }
  if (EVEN.has(name) && isNegativeTerm(a) && a.type !== 'add') {
    return simplifyFn(name, [simplifyMul([num(-1), a])], null);
  }
  if (name === 'abs') {
    if (a.type === 'num') return num(a.value.abs());
    if (a.type === 'const' && (a.name === 'pi' || a.name === 'e')) return a;
    if (isImagUnit(a)) return num(1);
    if (a.type === 'fn' && a.name === 'abs') return a;
    if (isNonNegative(a)) return a;
    if (a.type === 'mul') {
      const [c, rest] = splitCoeff(a);
      if (!c.isOne()) return simplifyMul([num(c.abs()), simplifyFn('abs', [rest], null)]);
    }
  }
  if (name === 'sign' && a.type === 'num') return num(a.value.sign());
  if ((name === 'floor' || name === 'ceil') && a.type === 'num') {
    const f = a.value.floor();
    if (name === 'floor' || a.value.isInteger()) return num(f);
    return num(f + 1n);
  }
  if (name === 'factorial' && a.type === 'num' && a.value.isInteger() && a.value.sign() >= 0 && a.value.n <= 2000n) {
    return num(factorialBig(a.value.n));
  }
  if (orig && orig.type === 'fn' && orig.name === name && orig.args.every((x, i) => x === args[i])) return orig;
  return fn(name, ...args);
}

function simplifyLn(a) {
  if (a.type === 'num') {
    const v = a.value;
    if (v.isOne()) return num(0);
    if (v.isNegative()) return simplifyAdd([simplifyLn(num(v.neg())), simplifyMul([constant('i'), constant('pi')])]);
    if (!v.isZero() && v.n === 1n) return simplifyMul([num(-1), fn('ln', num(v.d))]);
  }
  if (a.type === 'const' && a.name === 'e') return num(1);
  if (a.type === 'pow' && a.args[0].type === 'const' && a.args[0].name === 'e' && !containsImag(a.args[1])) {
    return a.args[1];
  }
  return fn('ln', a);
}

function simplifyLog(a, base) {
  if (base.type === 'const' && base.name === 'e') return simplifyLn(a);
  if (a.type === 'num' && a.value.isOne()) return num(0);
  if (a.type === 'num' && base.type === 'num' && a.value.sign() > 0 && base.value.sign() > 0 && !base.value.isOne()) {
    const bv = base.value;
    let p = R1;
    for (let k = 0; k <= 256; k++) {
      if (p.eq(a.value)) return num(k);
      if (p.eq(a.value.inv())) return num(-k);
      p = p.mul(bv);
      if (p.n.toString().length + p.d.toString().length > 600) break;
    }
  }
  if (key(a) === key(base)) return num(1);
  return fn('log', a, base);
}

function containsImag(e) {
  if (isImagUnit(e)) return true;
  return e.args ? e.args.some(containsImag) : false;
}

/**
 * Expand products of sums and integer powers of sums, then simplify.
 * @param {Expr} e
 * @returns {Expr}
 */
export function expand(e) {
  const s = simplify(e);
  return simplify(expandNode(s));
}

function distribute(termsA, termsB) {
  const out = [];
  for (const t of termsA) for (const u of termsB) out.push(simplify(mul(t, u)));
  if (out.length > 20000) throw new MathError('Expansion too large');
  return out;
}

function termsOf(e) {
  return e.type === 'add' ? e.args : [e];
}

function expandNode(e) {
  if (e.type === 'add') return simplify(add(...e.args.map(expandNode)));
  if (e.type === 'mul') {
    let terms = [num(1)];
    for (const f of e.args) terms = distribute(terms, termsOf(expandNode(f)));
    return simplify(add(...terms));
  }
  if (e.type === 'pow') {
    const b = expandNode(e.args[0]);
    const ex = e.args[1];
    if (b.type === 'add' && ex.type === 'num' && ex.value.isInteger() && ex.value.sign() > 0 && ex.value.n <= 64n) {
      let terms = [num(1)];
      for (let i = 0n; i < ex.value.n; i++) terms = termsOf(simplify(add(...distribute(terms, b.args))));
      return simplify(add(...terms));
    }
    if (b.type === 'add' && ex.type === 'num' && ex.value.isInteger() && ex.value.sign() < 0) {
      return simplify(pow(expandNode(pow(b, num(ex.value.neg()))), num(-1)));
    }
    return simplify(pow(b, ex));
  }
  if (e.type === 'fn' || e.type === 'eq') return simplify(mapArgs(e, expandNode));
  return e;
}

/**
 * Structural rebuild helper for callers that need to substitute and simplify.
 * @param {Expr} e
 * @param {Record<string, Expr|number>} map
 * @returns {Expr}
 */
export function subsSimplify(e, map) {
  const walk = (n) => {
    if (n.type === 'sym' && Object.prototype.hasOwnProperty.call(map, n.name)) {
      const v = map[n.name];
      return typeof v === 'number' ? num(v) : v;
    }
    return n.args ? withArgs(n, n.args.map(walk)) : n;
  };
  return simplify(walk(e));
}
