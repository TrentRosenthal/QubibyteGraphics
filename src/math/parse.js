/**
 * Parsers for plain text (`x^2 + 3x - sin(2x)/4`, `**` for powers, implicit
 * multiplication) and LaTeX (`\frac`, `\sqrt[3]{x}`, `\int_a^b f\,dx`,
 * `\sum`, `\lim_{x\to 0}`, `\frac{d}{dx}`, Greek letters). Both produce raw
 * (unsimplified) expression trees so the user's form is preserved.
 * @module math/parse
 */
import { Rational } from './rational.js';
import {
  num, sym, constant, add, mul, pow, fn, eq, neg, div, integral, deriv, limitNode, sumNode,
  substitute, toExpr, FUNCTIONS,
} from './expr.js';
import { GREEK_NAMES } from './latex.js';

/** @typedef {import('./expr.js').Expr} Expr */

const FN_ALIASES = {
  arcsin: 'asin', arccos: 'acos', arctan: 'atan', sgn: 'sign',
};
const CONSTANTS = { pi: 'pi', e: 'e', i: 'i', infinity: 'inf', inf: 'inf', oo: 'inf' };
const TEXT_OPS = new Set(['diff', 'integrate', 'limit', 'sum']);
const KNOWN_WORDS = [
  ...FUNCTIONS, ...Object.keys(FN_ALIASES), ...Object.keys(CONSTANTS), ...GREEK_NAMES, ...TEXT_OPS,
].sort((a, b) => b.length - a.length);

function isFunctionName(name) {
  return FUNCTIONS.has(name);
}

function tok(t, v, pos) {
  return { t, v, pos };
}

// Plain-text tokenizer.
function tokenizeText(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new SyntaxError('Bad number at position ' + i);
      const text = m[0];
      out.push(tok('num', text, i));
      i += text.length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z]/.test(src[j])) j++;
      const run = src.slice(i, j);
      const pieces = [];
      for (let p = 0; p < run.length;) {
        const word = KNOWN_WORDS.find((w) => run.startsWith(w, p)) || run[p];
        pieces.push(tok('id', word, i + p));
        p += word.length;
      }
      // A subscript or primes attach to the last piece of the run.
      const last = pieces[pieces.length - 1];
      const sm = /^_(\{[A-Za-z0-9]+\}|[A-Za-z0-9]+)/.exec(src.slice(j));
      if (sm) {
        last.v += '_' + sm[1].replace(/[{}]/g, '');
        j += sm[0].length;
      }
      while (src[j] === "'") {
        last.v += "'";
        j++;
      }
      out.push(...pieces);
      i = j;
      continue;
    }
    if (c === '*' && src[i + 1] === '*') {
      out.push(tok('op', '^', i));
      i += 2;
      continue;
    }
    if (c === '-' && src[i + 1] === '>') {
      out.push(tok('op', '->', i));
      i += 2;
      continue;
    }
    if ('+-*/^=(),![]|'.includes(c)) {
      out.push(tok('op', c, i));
      i++;
      continue;
    }
    if (c === '·' || c === '×') {
      out.push(tok('op', '*', i));
      i++;
      continue;
    }
    if (c === 'π') {
      out.push(tok('id', 'pi', i));
      i++;
      continue;
    }
    throw new SyntaxError('Unexpected character "' + c + '" at position ' + i);
  }
  out.push(tok('end', null, src.length));
  return out;
}

const LATEX_FUNCS = {
  sin: 'sin', cos: 'cos', tan: 'tan', sec: 'sec', csc: 'csc', cot: 'cot', arcsin: 'asin', arccos: 'acos',
  arctan: 'atan', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', exp: 'exp', ln: 'ln', log: 'log', sgn: 'sign',
};
const SKIP_CMDS = new Set([',', ';', '!', ':', ' ', 'quad', 'qquad', 'left', 'right', 'displaystyle', 'bigl', 'bigr', 'Bigl', 'Bigr', 'big', 'Big', 'limits']);

// LaTeX tokenizer.
function tokenizeLatex(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      const name = m[1];
      i += m[0].length;
      if (name === 'left' || name === 'right') {
        // Keep the delimiter that follows; drop the sizing command.
        while (/\s/.test(src[i])) i++;
        if (src[i] === '.') i++;
        continue;
      }
      if (SKIP_CMDS.has(name)) continue;
      if (name === '{') out.push(tok('op', '(', i));
      else if (name === '}') out.push(tok('op', ')', i));
      else if (name === '|') out.push(tok('op', '|', i));
      else if (name === 'cdot' || name === 'times' || name === 'ast') out.push(tok('op', '*', i));
      else if (name === 'div') out.push(tok('op', '/', i));
      else if (name === 'infty') out.push(tok('id', 'infinity', i));
      else if (name === 'pi') out.push(tok('id', 'pi', i));
      else if (GREEK_NAMES.has(name)) out.push(tok('id', name, i));
      else if (LATEX_FUNCS[name]) out.push(tok('id', LATEX_FUNCS[name], i));
      else if (name === 'mathrm' || name === 'operatorname' || name === 'text' || name === 'mathit') {
        const g = /^\s*\{([^}]*)\}/.exec(src.slice(i));
        if (!g) throw new SyntaxError('Expected a group after \\' + name);
        i += g[0].length;
        const word = g[1].trim();
        const mapped = LATEX_FUNCS[word] || FN_ALIASES[word] || word;
        if (word === 'd') out.push(tok('id', 'd', i));
        else out.push(tok('id', mapped, i));
      } else if (['frac', 'dfrac', 'tfrac'].includes(name)) out.push(tok('cmd', 'frac', i));
      else if (['sqrt', 'int', 'sum', 'lim', 'lfloor', 'rfloor', 'lceil', 'rceil', 'partial'].includes(name)) out.push(tok('cmd', name, i));
      else if (name === 'to' || name === 'rightarrow') out.push(tok('op', '->', i));
      else throw new SyntaxError('Unsupported LaTeX command \\' + name);
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      out.push(tok('num', m[0], i));
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      out.push(tok('id', c, i));
      i++;
      continue;
    }
    if (c === '{' || c === '}') {
      out.push(tok(c === '{' ? 'lbrace' : 'rbrace', c, i));
      i++;
      continue;
    }
    if ('+-*/^_=()[]|!,\''.includes(c)) {
      out.push(tok('op', c, i));
      i++;
      continue;
    }
    throw new SyntaxError('Unexpected character "' + c + '" at position ' + i);
  }
  out.push(tok('end', null, src.length));
  return out;
}

class Parser {
  constructor(tokens, latex) {
    this.toks = tokens;
    this.p = 0;
    this.latex = latex;
    this.absDepth = 0;
  }

  peek(k = 0) {
    return this.toks[Math.min(this.p + k, this.toks.length - 1)];
  }

  next() {
    const t = this.toks[this.p];
    if (this.p < this.toks.length - 1) this.p++;
    return t;
  }

  isOp(v, k = 0) {
    const t = this.peek(k);
    return t.t === 'op' && t.v === v;
  }

  expectOp(v) {
    const t = this.next();
    if (t.t !== 'op' || t.v !== v) throw new SyntaxError('Expected "' + v + '" at position ' + t.pos);
  }

  parseAll() {
    const e = this.equation();
    if (this.peek().t !== 'end') throw new SyntaxError('Unexpected "' + (this.peek().v ?? this.peek().t) + '" at position ' + this.peek().pos);
    return e;
  }

  equation() {
    const lhs = this.additive();
    if (this.isOp('=')) {
      this.next();
      return eq(lhs, this.additive());
    }
    return lhs;
  }

  additive() {
    const terms = [this.term()];
    for (;;) {
      if (this.isOp('+')) {
        this.next();
        terms.push(this.term());
      } else if (this.isOp('-')) {
        this.next();
        const t = this.term();
        terms.push(t.type === 'num' ? num(t.value.neg()) : neg(t));
      } else break;
    }
    return terms.length === 1 ? terms[0] : add(...terms);
  }

  startsAtom(t) {
    if (t.t === 'num' || t.t === 'id' || t.t === 'lbrace') return true;
    if (t.t === 'cmd') return !['rfloor', 'rceil'].includes(t.v);
    if (t.t === 'op') {
      if (t.v === '(' || t.v === '[') return true;
      if (t.v === '|') return this.absDepth === 0;
    }
    return false;
  }

  term() {
    const factors = [this.unary()];
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && t.v === '*') {
        this.next();
        factors.push(this.unary());
      } else if (t.t === 'op' && t.v === '/') {
        this.next();
        factors.push(pow(this.unary(), num(-1)));
      } else if (this.startsAtom(t)) {
        if (this.isDifferential()) break;
        factors.push(this.power());
      } else break;
    }
    return factors.length === 1 ? factors[0] : mul(...factors);
  }

  unary() {
    if (this.isOp('-')) {
      this.next();
      const u = this.unary();
      return u.type === 'num' ? num(u.value.neg()) : neg(u);
    }
    if (this.isOp('+')) {
      this.next();
      return this.unary();
    }
    return this.power();
  }

  power() {
    const base = this.postfix();
    if (this.isOp('^')) {
      this.next();
      const ex = this.latex ? this.latexScript() : this.unary();
      return pow(base, ex);
    }
    return base;
  }

  postfix() {
    let e = this.primary();
    while (this.isOp('!') || this.isOp("'")) {
      const t = this.next();
      if (t.v === '!') e = fn('factorial', e);
      else if (e.type === 'sym') e = sym(e.name + "'");
      else throw new SyntaxError('Prime only applies to a symbol');
    }
    return e;
  }

  // A LaTeX superscript or subscript: a brace group or a single token.
  latexScript() {
    const t = this.peek();
    if (t.t === 'lbrace') return this.group();
    if (t.t === 'num') {
      this.next();
      if (t.v.length > 1 && !t.v.includes('.')) {
        this.toks.splice(this.p, 0, tok('num', t.v.slice(1), t.pos + 1));
        return num(t.v[0]);
      }
      return num(Rational.from(t.v));
    }
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) {
      this.next();
      const inner = this.latexScript();
      return t.v === '-' ? (inner.type === 'num' ? num(inner.value.neg()) : neg(inner)) : inner;
    }
    return this.primary();
  }

  group() {
    const t = this.next();
    if (t.t !== 'lbrace') throw new SyntaxError('Expected "{" at position ' + t.pos);
    const e = this.equation();
    const close = this.next();
    if (close.t !== 'rbrace') throw new SyntaxError('Expected "}" at position ' + close.pos);
    return e;
  }

  // Raw tokens of a brace group, without parsing.
  groupTokens() {
    const t = this.peek();
    if (t.t !== 'lbrace') {
      this.next();
      return [t];
    }
    this.next();
    let depth = 1;
    const out = [];
    for (;;) {
      const u = this.next();
      if (u.t === 'end') throw new SyntaxError('Unclosed "{"');
      if (u.t === 'lbrace') depth++;
      if (u.t === 'rbrace') {
        depth--;
        if (depth === 0) break;
      }
      out.push(u);
    }
    return out;
  }

  subParse(tokens) {
    const p = new Parser([...tokens, tok('end', null, tokens.length ? tokens[tokens.length - 1].pos : 0)], this.latex);
    return p.parseAll();
  }

  isDifferential() {
    // Inside an integral body the differential "d x" ends the body.
    if (!this.inIntegral) return false;
    const t = this.peek();
    const u = this.peek(1);
    return t.t === 'id' && t.v === 'd' && u.t === 'id';
  }

  primary() {
    const t = this.peek();
    if (t.t === 'num') {
      this.next();
      return num(Rational.from(t.v));
    }
    if (t.t === 'lbrace') return this.group();
    if (t.t === 'op' && (t.v === '(' || t.v === '[')) {
      this.next();
      const saved = this.absDepth;
      this.absDepth = 0;
      const e = this.equation();
      this.absDepth = saved;
      this.expectOp(t.v === '(' ? ')' : ']');
      return e;
    }
    if (t.t === 'op' && t.v === '|') {
      this.next();
      this.absDepth++;
      const e = this.additive();
      this.absDepth--;
      this.expectOp('|');
      return fn('abs', e);
    }
    if (t.t === 'cmd') return this.command();
    if (t.t === 'id') return this.identifier();
    throw new SyntaxError(t.t === 'end' ? 'Unexpected end of input' : 'Unexpected "' + t.v + '" at position ' + t.pos);
  }

  identifier() {
    const t = this.next();
    const name = FN_ALIASES[t.v] || t.v;
    if (CONSTANTS[name]) return constant(CONSTANTS[name]);
    if (!this.latex && TEXT_OPS.has(name) && this.isOp('(')) return this.textOperator(name);
    if (isFunctionName(name)) return this.functionCall(name);
    return sym(name);
  }

  functionCall(name) {
    let power = null;
    let fname = name;
    let base = null;
    if (this.latex && name === 'log' && this.isOp('_')) {
      this.next();
      base = this.latexScript();
    }
    if (this.isOp('^')) {
      this.next();
      power = this.latex ? this.latexScript() : this.unaryNoCall();
      if (power.type === 'num' && power.value.eq(Rational.from(-1)) && ['sin', 'cos', 'tan'].includes(name)) {
        fname = 'a' + name;
        power = null;
      }
    }
    let args;
    if (this.isOp('(')) {
      this.next();
      const saved = this.absDepth;
      this.absDepth = 0;
      args = [this.equation()];
      while (this.isOp(',')) {
        this.next();
        args.push(this.equation());
      }
      this.absDepth = saved;
      this.expectOp(')');
    } else {
      args = [this.bareArgument()];
    }
    if (base) args.push(base);
    const call = fn(fname, ...args);
    return power ? pow(call, power) : call;
  }

  unaryNoCall() {
    if (this.isOp('-')) {
      this.next();
      const u = this.postfix();
      return u.type === 'num' ? num(u.value.neg()) : neg(u);
    }
    return this.postfix();
  }

  // Argument of a function written without parentheses: sin 2x, \sin x.
  bareArgument() {
    const factors = [this.power()];
    for (;;) {
      const t = this.peek();
      if (!this.startsAtom(t)) break;
      if (t.t === 'cmd') break;
      if (t.t === 'id' && (isFunctionName(FN_ALIASES[t.v] || t.v) || TEXT_OPS.has(t.v))) break;
      if (this.isDifferential()) break;
      factors.push(this.power());
    }
    return factors.length === 1 ? factors[0] : mul(...factors);
  }

  textOperator(name) {
    this.expectOp('(');
    const args = [this.equation()];
    while (this.isOp(',')) {
      this.next();
      args.push(this.equation());
    }
    this.expectOp(')');
    const varName = (e) => {
      if (!e || e.type !== 'sym') throw new SyntaxError(name + ' needs a variable name');
      return e.name;
    };
    switch (name) {
      case 'diff': return deriv(args[0], varName(args[1]), args[2] ? Number(args[2].value.n) : 1);
      case 'integrate': return args.length >= 4 ? integral(args[0], varName(args[1]), args[2], args[3]) : integral(args[0], varName(args[1]));
      case 'limit': {
        let point = args[2];
        let v = args[1];
        if (v && v.type === 'eq') {
          point = v.args[1];
          v = v.args[0];
        }
        return limitNode(args[0], varName(v), point);
      }
      default: {
        const v = varName(args[1]);
        return sumNode(bindIndex(args[0], v), v, args[2], args[3]);
      }
    }
  }

  command() {
    const t = this.next();
    switch (t.v) {
      case 'frac': return this.fraction();
      case 'sqrt': {
        let index = null;
        if (this.isOp('[')) {
          this.next();
          index = this.additive();
          this.expectOp(']');
        }
        const body = this.latexScript();
        if (!index) return fn('sqrt', body);
        return pow(body, index.type === 'num' ? num(index.value.inv()) : pow(index, num(-1)));
      }
      case 'lfloor': case 'lceil': {
        const e = this.additive();
        const close = this.next();
        const want = t.v === 'lfloor' ? 'rfloor' : 'rceil';
        if (close.t !== 'cmd' || close.v !== want) throw new SyntaxError('Expected \\' + want);
        return fn(t.v === 'lfloor' ? 'floor' : 'ceil', e);
      }
      case 'int': return this.integralCmd();
      case 'sum': return this.sumCmd();
      case 'lim': return this.limitCmd();
      case 'partial': return sym('partial');
      default: throw new SyntaxError('Unexpected \\' + t.v);
    }
  }

  fraction() {
    const top = this.groupTokens();
    const bottom = this.groupTokens();
    const d = derivativeShape(top, bottom);
    if (d) {
      if (d.body) return deriv(d.body, d.v, d.order, d.partial);
      const body = this.term();
      return deriv(body, d.v, d.order, d.partial);
    }
    return div(this.subParse(top), this.subParse(bottom));
  }

  scripts() {
    let lower = null;
    let upper = null;
    for (let k = 0; k < 2; k++) {
      if (this.isOp('_')) {
        this.next();
        lower = this.groupTokens();
      } else if (this.isOp('^')) {
        this.next();
        upper = this.groupTokens();
      }
    }
    return { lower, upper };
  }

  integralCmd() {
    const { lower, upper } = this.scripts();
    const savedFlag = this.inIntegral;
    this.inIntegral = true;
    let body;
    if (this.isDifferential()) body = num(1);
    else body = this.additive();
    const ok = this.isDifferential();
    this.inIntegral = savedFlag;
    if (!ok) throw new SyntaxError('Integral needs a differential such as dx');
    this.next();
    const v = this.next().v;
    if (lower && upper) return integral(body, v, this.subParse(lower), this.subParse(upper));
    return integral(body, v);
  }

  sumCmd() {
    const { lower, upper } = this.scripts();
    if (!lower || !upper) throw new SyntaxError('\\sum needs lower and upper limits');
    const lo = this.subParse(lower);
    const idx = lo.type === 'eq' ? lo.args[0] : null;
    if (!idx || !(idx.type === 'sym' || (idx.type === 'const' && (idx.name === 'i' || idx.name === 'e')))) {
      throw new SyntaxError('\\sum lower limit must look like k=1');
    }
    const v = idx.name;
    const body = this.term();
    return sumNode(bindIndex(body, v), v, lo.args[1], this.subParse(upper));
  }

  limitCmd() {
    const { lower } = this.scripts();
    if (!lower) throw new SyntaxError('\\lim needs a subscript like x \\to 0');
    const arrow = lower.findIndex((u) => u.t === 'op' && u.v === '->');
    if (arrow !== 1 || lower[0].t !== 'id') throw new SyntaxError('\\lim subscript must look like x \\to a');
    let pointToks = lower.slice(2);
    let dir = null;
    const n = pointToks.length;
    if (n >= 2 && pointToks[n - 2].t === 'op' && pointToks[n - 2].v === '^') {
      const last = pointToks[n - 1];
      if (last.t === 'op' && (last.v === '+' || last.v === '-')) {
        dir = last.v;
        pointToks = pointToks.slice(0, n - 2);
      }
    } else if (n >= 4 && pointToks[n - 4].t === 'op' && pointToks[n - 4].v === '^' && pointToks[n - 3].t === 'lbrace') {
      const mid = pointToks[n - 2];
      if (mid.t === 'op' && (mid.v === '+' || mid.v === '-')) {
        dir = mid.v;
        pointToks = pointToks.slice(0, n - 4);
      }
    }
    const body = this.term();
    return limitNode(body, lower[0].v, this.subParse(pointToks), dir);
  }
}

// Recognise d/dx, d^2/dx^2, dy/dx and the partial forms from raw tokens.
function derivativeShape(top, bottom) {
  const isD = (u) => u && ((u.t === 'id' && u.v === 'd') || (u.t === 'cmd' && u.v === 'partial'));
  if (!isD(top[0]) || !isD(bottom[0])) return null;
  const partial = top[0].t === 'cmd';
  let i = 1;
  let order = 1;
  if (top[i] && top[i].t === 'op' && top[i].v === '^') {
    order = parseInt(top[i + 1] && top[i + 1].t === 'lbrace' ? top[i + 2].v : top[i + 1].v, 10);
    i += top[i + 1].t === 'lbrace' ? 4 : 2;
  }
  let body = null;
  if (i < top.length) {
    if (top.length !== i + 1 || top[i].t !== 'id') return null;
    body = sym(top[i].v);
  }
  if (!bottom[1] || bottom[1].t !== 'id') return null;
  const rest = bottom.slice(2);
  if (rest.length && !(rest[0].t === 'op' && rest[0].v === '^')) return null;
  return { v: bottom[1].v, order: Number.isFinite(order) ? order : 1, partial, body };
}

// Inside sums over i or e, the bound variable was parsed as a constant.
function bindIndex(body, v) {
  if (v !== 'i' && v !== 'e') return body;
  const walk = (n) => {
    if (n.type === 'const' && n.name === v) return sym(v);
    if (!n.args) return n;
    const args = n.args.map(walk);
    return args.every((a, k) => a === n.args[k]) ? n : { ...n, args };
  };
  return walk(body);
}

/**
 * Parse plain text or LaTeX into an expression tree. Mode 'auto' treats input
 * containing a backslash or braces as LaTeX.
 * @param {string} src
 * @param {{mode?: ('auto'|'text'|'latex')}} [opts]
 * @returns {Expr}
 */
export function parse(src, opts = {}) {
  const mode = opts.mode || 'auto';
  const latex = mode === 'latex' || (mode === 'auto' && /[\\{}]/.test(src));
  const tokens = latex ? tokenizeLatex(src) : tokenizeText(src);
  return new Parser(tokens, latex).parseAll();
}

/**
 * Accept a string (parsed), a number, or an expression.
 * @param {string|number|Expr} v
 * @returns {Expr}
 */
export function ensureExpr(v) {
  if (typeof v === 'string') return parse(v);
  return toExpr(v);
}

/**
 * Parse a variable name or symbol expression into a plain name.
 * @param {string|Expr} v
 * @returns {string}
 */
export function varName(v) {
  if (typeof v === 'string') return v;
  if (v && v.type === 'sym') return v.name;
  throw new TypeError('Expected a variable name');
}

/**
 * Substitute values given as strings, numbers or expressions.
 * @param {string|Expr} e
 * @param {Record<string, string|number|Expr>} values
 * @returns {Expr}
 */
export function substituteValues(e, values) {
  const map = {};
  for (const [k, v] of Object.entries(values)) map[k] = ensureExpr(v);
  return substitute(ensureExpr(e), map);
}
