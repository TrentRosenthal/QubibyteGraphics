/**
 * Qubi matrix syntax: `[1 0; 0 e**(1i*pi/4)]`.
 *
 * - Rows are separated by `;` or a new line; elements by spaces or commas.
 * - As in the usual matrix notation, a `+` or `-` with a space before it and
 *   none after it starts a new element: `[1 -1]` has two elements, while
 *   `[1 - 1]` has one.
 * - `1i` (any number followed by `i`) is the imaginary unit times the number.
 * - Constants `pi`, `π`, `e`; functions `sqrt sin cos tan` (arguments in
 *   radians, since matrix entries are plain complex numbers); operators
 *   `+ - * / **` with complex arithmetic. Exponentials are written `e**(...)`;
 *   `exp(...)` is rejected.
 *
 * @module qubi/matrix
 */

import { QubiError } from './grammar.js';

const C = (re, im = 0) => ({ re, im });
const add = (a, b) => C(a.re + b.re, a.im + b.im);
const sub = (a, b) => C(a.re - b.re, a.im - b.im);
const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
function div(a, b) {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) return null;
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
const cexp = (a) => C(Math.exp(a.re) * Math.cos(a.im), Math.exp(a.re) * Math.sin(a.im));
const clog = (a) => C(Math.log(Math.hypot(a.re, a.im)), Math.atan2(a.im, a.re));
function csqrt(a) {
  const r = Math.hypot(a.re, a.im);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sqrt(Math.max(0, (r - a.re) / 2));
  return C(re, a.im < 0 ? -im : im);
}
const csin = (a) => C(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));
const ccos = (a) => C(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));

function cpow(a, b) {
  if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 64) {
    let r = C(1);
    for (let k = 0; k < Math.abs(b.re); k++) r = mul(r, a);
    return b.re < 0 ? div(C(1), r) : r;
  }
  if (a.re === 0 && a.im === 0) return C(0);
  return cexp(mul(b, clog(a)));
}

function lexMatrix(text, pos) {
  const toks = [];
  let i = 0;
  let line = pos.line;
  let col = pos.col;
  let sp = true;
  const here = () => ({ ...pos, line, col });
  const step = () => {
    if (text[i] === '\n') { line++; col = 1; } else col++;
    i++;
  };
  while (i < text.length) {
    const c = text[i];
    const p = here();
    if (c === ' ' || c === '\t' || c === '\r') { sp = true; step(); continue; }
    if (c === '\n') { toks.push({ t: 'row', p, sp }); sp = true; step(); continue; }
    if (/[0-9.]/.test(c)) {
      let num = '';
      while (i < text.length && /[0-9.]/.test(text[i])) { num += text[i]; step(); }
      if (!/^(\d+\.?\d*|\.\d+)$/.test(num)) throw new QubiError(`Matrix: cannot read number ${num}`, p);
      let imag = false;
      if (text[i] === 'i' && !/[A-Za-z0-9_]/.test(text[i + 1] ?? '')) { imag = true; step(); }
      toks.push({ t: 'num', v: Number(num), imag, p, sp });
      sp = false;
      continue;
    }
    if (/[A-Za-z_π]/.test(c)) {
      let id = '';
      while (i < text.length && /[A-Za-z0-9_π]/.test(text[i])) { id += text[i]; step(); }
      toks.push({ t: 'id', v: id, p, sp });
      sp = false;
      continue;
    }
    if (c === '*' && text[i + 1] === '*') { toks.push({ t: 'op', v: '**', p, sp }); step(); step(); sp = false; continue; }
    if ('+-*/()[];,^'.includes(c)) {
      if (c === '^') throw new QubiError('Matrix: use ** for powers, as in e**(1i*pi/4)', p);
      toks.push({ t: 'op', v: c, p, sp });
      step();
      sp = false;
      continue;
    }
    throw new QubiError(`Matrix: unexpected character '${c}'`, p);
  }
  toks.push({ t: 'eof', p: here(), sp: true });
  return toks;
}

/**
 * Parse Qubi matrix text into a dense complex matrix.
 * @param {string} text For example `[1 0; 0 e**(1i*pi/4)]`.
 * @param {import('./ir.js').SourcePos} [pos] Position of text[0], for errors.
 * @returns {import('./ir.js').CMatrix}
 * @throws {QubiError} On syntax errors or a non-rectangular, non-square, or non power-of-two shape.
 */
export function parseMatrix(text, pos = { line: 1, col: 1 }) {
  const toks = lexMatrix(text, pos);
  let k = 0;
  const peek = (o = 0) => toks[Math.min(k + o, toks.length - 1)];
  const isOp = (v, o = 0) => peek(o).t === 'op' && peek(o).v === v;
  const fail = (msg, t = peek()) => { throw new QubiError(`Matrix: ${msg}`, t.p); };
  while (peek().t === 'row') k++;
  if (!isOp('[')) fail('write the matrix in brackets, as in [1 0; 0 1]');
  k++;
  let depth = 0;

  const parseAdd = () => {
    let left = parseMul();
    for (;;) {
      const t = peek();
      if (t.t !== 'op' || (t.v !== '+' && t.v !== '-')) return left;
      if (depth === 0 && t.sp && !peek(1).sp) return left;
      k++;
      const right = parseMul();
      left = t.v === '+' ? add(left, right) : sub(left, right);
    }
  };
  const parseMul = () => {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t.t !== 'op' || (t.v !== '*' && t.v !== '/')) return left;
      k++;
      const right = parseUnary();
      if (t.v === '*') left = mul(left, right);
      else {
        const q = div(left, right);
        if (!q) fail('division by zero', t);
        left = q;
      }
    }
  };
  const parseUnary = () => {
    if (isOp('-')) { k++; const v = parseUnary(); return C(-v.re, -v.im); }
    if (isOp('+')) { k++; return parseUnary(); }
    return parsePow();
  };
  const parsePow = () => {
    const base = parsePrimary();
    if (!isOp('**')) return base;
    k++;
    const exp = parseUnary();
    return cpow(base, exp);
  };
  const parseParenExpr = () => {
    if (!isOp('(')) fail('expected (');
    k++;
    depth++;
    const v = parseAdd();
    if (!isOp(')')) fail('missing )');
    depth--;
    k++;
    return v;
  };
  const parsePrimary = () => {
    const t = peek();
    if (t.t === 'num') {
      k++;
      return t.imag ? C(0, t.v) : C(t.v);
    }
    if (t.t === 'op' && t.v === '(') return parseParenExpr();
    if (t.t === 'id') {
      k++;
      switch (t.v) {
        case 'pi': case 'π': return C(Math.PI);
        case 'e': return C(Math.E);
        case 'i': fail('write the imaginary unit as 1i', t); break;
        case 'exp': fail('use e** for exponentials, as in e**(1i*pi/4), not exp()', t); break;
        case 'sqrt': return csqrt(parseParenExpr());
        case 'sin': return csin(parseParenExpr());
        case 'cos': return ccos(parseParenExpr());
        case 'tan': {
          const a = parseParenExpr();
          const q = div(csin(a), ccos(a));
          if (!q) fail('tan is undefined here', t);
          return q;
        }
        default: fail(`unknown name ${t.v}. Matrices take numbers, 1i, pi, e, sqrt, sin, cos, tan`, t);
      }
    }
    fail(t.t === 'eof' ? 'missing ]' : 'expected a number');
    return C(0);
  };

  const rows = [];
  let row = [];
  for (;;) {
    const t = peek();
    if (t.t === 'eof') fail('missing ]');
    if (t.t === 'op' && t.v === ']') { k++; break; }
    if (t.t === 'row' || (t.t === 'op' && t.v === ';')) {
      k++;
      if (row.length) rows.push(row);
      row = [];
      continue;
    }
    if (t.t === 'op' && t.v === ',') { k++; continue; }
    row.push(parseAdd());
  }
  if (row.length) rows.push(row);
  while (peek().t === 'row') k++;
  if (peek().t !== 'eof') fail('unexpected text after ]');
  if (!rows.length) fail('the matrix is empty');
  const n = rows.length;
  if (rows.some((r) => r.length !== rows[0].length)) fail('rows have different lengths', toks[0]);
  if (rows[0].length !== n) fail(`must be square, got ${n}x${rows[0].length}`, toks[0]);
  if (n < 2 || (n & (n - 1)) !== 0) fail(`size must be a power of two (2, 4, 8, ...), got ${n}`, toks[0]);
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  rows.forEach((r, a) => r.forEach((v, b) => {
    re[a * n + b] = v.re;
    im[a * n + b] = v.im;
  }));
  return { rows: n, cols: n, re, im };
}

/**
 * Check that M^dagger M is the identity.
 * @param {import('./ir.js').CMatrix} m
 * @param {number} [tol]
 * @returns {boolean}
 */
export function isUnitary(m, tol = 1e-9) {
  const n = m.rows;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      let sre = 0;
      let sim = 0;
      for (let r = 0; r < n; r++) {
        const are = m.re[r * n + a];
        const aim = -m.im[r * n + a];
        const bre = m.re[r * n + b];
        const bim = m.im[r * n + b];
        sre += are * bre - aim * bim;
        sim += are * bim + aim * bre;
      }
      if (Math.abs(sre - (a === b ? 1 : 0)) > tol || Math.abs(sim) > tol) return false;
    }
  }
  return true;
}
