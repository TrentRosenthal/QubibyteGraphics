/**
 * LaTeX and plain-text printers. Output follows conventional typesetting:
 * `2x` not `2 \cdot x`, `-x` not `-1x`, negative exponents as fractions,
 * `x^{1/2}` as `\sqrt{x}`, trig powers as `\sin^{2}(x)`, and sums in the
 * canonical order produced by simplify (descending degree).
 * @module math/latex
 */
import { Rational } from './rational.js';
import { num, mul, pow } from './expr.js';
import { splitCoeff } from './simplify.js';

/** @typedef {import('./expr.js').Expr} Expr */

const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa',
  'lambda', 'mu', 'nu', 'xi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
]);

/** Greek letter names recognised by the parsers and printers. */
export const GREEK_NAMES = GREEK;

const FN_LATEX = {
  sin: '\\sin', cos: '\\cos', tan: '\\tan', sec: '\\sec', csc: '\\csc', cot: '\\cot',
  asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan', sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh',
  ln: '\\ln', exp: '\\exp', sign: '\\operatorname{sgn}',
};
const TRIG_POWER = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'sinh', 'cosh', 'tanh']);

const START = '\ue000';
const MID = '\ue001';
const END = '\ue002';
const MARK_RE = /\ue000[^\ue001]*\ue001|\ue002/g;

function clean(s) {
  return s.replace(MARK_RE, '');
}

function symLatex(name) {
  const m = /^([A-Za-z]+)(?:_\{?([A-Za-z0-9]+)\}?)?('*)(?:\(([^)]*)\))?$/.exec(name);
  if (!m) return '\\mathit{' + name + '}';
  let base = m[1];
  if (GREEK.has(base)) base = '\\' + base;
  else if (base.length > 1) base = '\\mathrm{' + base + '}';
  let out = base;
  if (m[2]) out += '_{' + m[2] + '}';
  if (m[3]) out += m[3];
  if (m[4] !== undefined) out += '(' + m[4] + ')';
  return out;
}

function ratLatex(r) {
  if (r.isInteger()) return r.n.toString();
  const neg = r.isNegative();
  return (neg ? '-' : '') + '\\frac{' + (neg ? -r.n : r.n) + '}{' + r.d + '}';
}

function isNegNum(e) {
  return e.type === 'num' && e.value.isNegative();
}

function needsLeftRight(s) {
  return /\\frac|\\sum|\\int|\\binom|\\lim/.test(clean(s));
}

function paren(s) {
  return needsLeftRight(s) ? '\\left(' + s + '\\right)' : '(' + s + ')';
}

function joinFactors(parts) {
  let out = '';
  let prevRaw = '';
  for (const p of parts) {
    const raw = clean(p);
    if (out === '') {
      out = p;
    } else if (/^[0-9.]/.test(raw) || /^-/.test(raw)) {
      out += ' \\cdot ' + p;
    } else if (/\\[A-Za-z]+$/.test(prevRaw) && /^[A-Za-z]/.test(raw)) {
      out += ' ' + p;
    } else {
      out += p;
    }
    prevRaw = raw;
  }
  return out;
}

class Printer {
  constructor(marks) {
    this.marks = marks;
  }

  wrap(e, s) {
    return this.marks ? START + e.id + MID + s + END : s;
  }

  print(e) {
    return this.wrap(e, this.body(e));
  }

  body(e) {
    switch (e.type) {
      case 'num': return ratLatex(e.value);
      case 'sym': return symLatex(e.name);
      case 'const': return { pi: '\\pi', e: 'e', i: 'i', inf: '\\infty' }[e.name];
      case 'add': return this.sum(e);
      case 'mul': return this.product(e);
      case 'pow': return this.power(e);
      case 'fn': return this.func(e);
      case 'eq': return this.print(e.args[0]) + ' = ' + this.print(e.args[1]);
      case 'integral': return this.integral(e);
      case 'deriv': return this.derivative(e);
      case 'limit': return this.limit(e);
      case 'sum': return '\\sum_{' + symLatex(e.v) + '=' + this.print(e.args[1]) + '}^{' + this.print(e.args[2]) + '} ' + this.operand(e.args[0]);
      case 'bracket': return '\\left[' + this.print(e.args[0]) + '\\right]_{' + this.print(e.args[1]) + '}^{' + this.print(e.args[2]) + '}';
      case 'list': return e.args.map((a) => this.print(a)).join(',\\quad ');
      case 'matrix': return '\\begin{bmatrix}' + e.rows.map((r) => r.map((x) => this.print(x)).join(' & ')).join(' \\\\ ') + '\\end{bmatrix}';
      default: throw new TypeError('Cannot print node type ' + e.type);
    }
  }

  operand(e) {
    const s = this.print(e);
    return e.type === 'add' ? paren(s) : s;
  }

  sum(e) {
    let out = '';
    let terms = e.args;
    // Constant sums read number first (1 + sqrt(2)) and over one denominator.
    if (terms.every(isConstantTerm)) {
      const numIdx = terms.findIndex((t) => t.type === 'num');
      if (numIdx > 0) terms = [terms[numIdx], ...terms.filter((_, i) => i !== numIdx)];
      const d = e.id !== undefined ? commonDenominator({ args: terms }) : null;
      if (d) return '\\frac{' + this.sum({ args: terms.map((t) => scaleTerm(t, d)) }) + '}{' + d + '}';
    }
    // Two-term sums read better with the positive term first: 1 - x^2.
    if (terms.length === 2 && negated(terms[0]) && !negated(terms[1]) && terms[1].type !== 'sym') terms = [terms[1], terms[0]];
    // Complex numbers read real part first: 1 - 2i.
    if (terms.length === 2 && terms[1].type === 'num' && isImaginaryTerm(terms[0])) terms = [terms[1], terms[0]];
    terms.forEach((t, i) => {
      if (i === 0) {
        out = t.type === 'eq' ? paren(this.print(t)) : this.print(t);
        return;
      }
      const neg = negated(t);
      if (neg) out += ' - ' + this.wrap(t, this.termBody(neg, t));
      else out += ' + ' + this.print(t);
    });
    return out;
  }

  // Print a negated term. When the negation is a fresh node, marks refer to
  // the original children so ids stay meaningful.
  termBody(negTerm, orig) {
    if (orig.type === 'num') return ratLatex(orig.value.neg());
    const s = this.body(negTerm);
    return negTerm.type === 'add' ? paren(s) : s;
  }

  product(e) {
    const args = flattenMul(e.args);
    let coeff = new Rational(1n);
    let coeffNode = null;
    const numer = [];
    const denom = [];
    args.forEach((f, idx) => {
      if (f.type === 'num' && idx === 0) {
        coeff = f.value;
        coeffNode = f;
        return;
      }
      if (f.type === 'pow' && f.args[1].type === 'num' && f.args[1].value.isNegative()) {
        const ex = f.args[1].value.neg();
        denom.push(ex.isOne() ? { node: f.args[0], s: null } : { node: pow(f.args[0], num(ex)), s: null, orig: f });
        return;
      }
      numer.push(f);
    });
    let sign = '';
    if (coeff.isNegative()) {
      sign = '-';
      coeff = coeff.neg();
    }
    const numParts = numer.map((f, i) => this.factor(f, i === 0 && coeff.n === 1n && sign === ''));
    const denParts = denom.map((d) => (d.orig ? this.wrap(d.orig, this.power(d.node)) : this.factor(d.node, true)));
    const cn = coeff.n;
    const cd = coeff.d;
    const coeffMarked = (s) => (coeffNode && this.marks ? START + coeffNode.id + MID + s + END : s);
    if (cd === 1n && denParts.length === 0) {
      const parts = [];
      if (cn !== 1n || numParts.length === 0) parts.push(coeffMarked(cn.toString()));
      return sign + joinFactors([...parts, ...numParts]);
    }
    const top = [];
    if (cn !== 1n || numParts.length === 0) top.push(coeffMarked(cn.toString()));
    const topStr = numParts.length === 1 && top.length === 0 && numer[0].type === 'add' ? this.print(numer[0]) : joinFactors([...top, ...numParts]);
    const bottom = [];
    if (cd !== 1n) bottom.push(cd.toString());
    const botStr = denParts.length === 1 && bottom.length === 0 && denom[0].node.type === 'add' ? this.print(denom[0].node) : joinFactors([...bottom, ...denParts]);
    return sign + '\\frac{' + topStr + '}{' + botStr + '}';
  }

  factor(f, first) {
    const s = this.print(f);
    if (f.type === 'add' || f.type === 'eq') return paren(s);
    if (isNegNum(f) && !first) return paren(s);
    if (f.type === 'mul' && isNegNum(f.args[0]) && !first) return paren(s);
    return s;
  }

  base(b) {
    const s = this.print(b);
    if (b.type === 'add' || b.type === 'mul' || b.type === 'pow' || b.type === 'eq') return paren(s);
    if (b.type === 'num' && (b.value.isNegative() || !b.value.isInteger())) return paren(s);
    if (b.type === 'fn' && !['abs', 'floor', 'ceil', 'sqrt'].includes(b.name)) return paren(s);
    if (b.type === 'integral' || b.type === 'deriv' || b.type === 'limit' || b.type === 'sum') return paren(s);
    return s;
  }

  power(e) {
    const [b, ex] = e.args;
    if (ex.type === 'num') {
      const r = ex.value;
      if (r.isNegative()) {
        const pos = r.neg();
        const inner = pos.isOne() ? this.print(b) : this.power(pow(b, num(pos)));
        return '\\frac{1}{' + inner + '}';
      }
      if (r.n === 1n && r.d > 1n) {
        const idx = r.d === 2n ? '' : '[' + r.d + ']';
        return '\\sqrt' + idx + '{' + this.print(b) + '}';
      }
      if (b.type === 'fn' && TRIG_POWER.has(b.name) && r.isInteger()) {
        return this.wrap(b, FN_LATEX[b.name] + '^{' + r.n + '}' + this.fnArg(b.args[0], true));
      }
    }
    if (ex.type === 'mul' && ex.args[0].type === 'num' && ex.args[0].value.isNegative() && !(b.type === 'const' && b.name === 'e')) {
      const [c, rest] = splitCoeff(ex);
      const posEx = c.neg().isOne() ? rest : mul(num(c.neg()), ...(rest.type === 'mul' ? rest.args : [rest]));
      return '\\frac{1}{' + this.power(pow(b, posEx)) + '}';
    }
    return this.base(b) + '^{' + this.print(ex) + '}';
  }

  fnArg(a, forceParen) {
    const common = a.type === 'add' ? commonDenominator(a) : null;
    if (common) {
      const inner = this.sum({ args: a.args.map((t) => scaleTerm(t, common)) });
      return '\\left(' + this.wrap(a, '\\frac{' + inner + '}{' + common + '}') + '\\right)';
    }
    const s = this.print(a);
    if (!forceParen && a.type === 'fn' && a.name === 'abs') return s;
    return paren(s);
  }

  func(e) {
    const a = e.args[0];
    switch (e.name) {
      case 'abs': return '\\left|' + this.print(a) + '\\right|';
      case 'floor': return '\\left\\lfloor ' + this.print(a) + ' \\right\\rfloor';
      case 'ceil': return '\\left\\lceil ' + this.print(a) + ' \\right\\rceil';
      case 'sqrt': return '\\sqrt{' + this.print(a) + '}';
      case 'exp': return 'e^{' + this.print(a) + '}';
      case 'factorial': {
        const s = this.print(a);
        return (a.type === 'sym' || (a.type === 'num' && a.value.isInteger() && !a.value.isNegative()) ? s : paren(s)) + '!';
      }
      case 'log': {
        const base = e.args[1];
        const isTen = !base || (base.type === 'num' && base.value.eq(Rational.from(10)));
        return (isTen ? '\\log' : '\\log_{' + this.print(base) + '}') + this.fnArg(a, false);
      }
      case 'ln': return '\\ln' + this.fnArg(a, false);
      case 'pm': return this.print(a) + ' \\pm ' + (e.args[1].type === 'add' ? paren(this.print(e.args[1])) : this.print(e.args[1]));
      case 'laplace': return '\\mathcal{L}\\left\\{' + this.print(a) + '\\right\\}';
      case 'ilaplace': return '\\mathcal{L}^{-1}\\left\\{' + this.print(a) + '\\right\\}';
      case 'binom': return '\\binom{' + this.print(a) + '}{' + this.print(e.args[1]) + '}';
      default: return (FN_LATEX[e.name] || '\\operatorname{' + e.name + '}') + this.fnArg(a, true);
    }
  }

  integral(e) {
    const bounds = e.args.length === 3 ? '_{' + this.print(e.args[1]) + '}^{' + this.print(e.args[2]) + '}' : '';
    return '\\int' + bounds + ' ' + this.operand(e.args[0]) + ' \\, d' + symLatex(e.v);
  }

  derivative(e) {
    const d = e.partial ? '\\partial' : 'd';
    const sp = e.partial ? ' ' : '';
    const ord = e.order > 1 ? '^{' + e.order + '}' : '';
    const b = e.args[0];
    if (b.type === 'sym' && b.name !== e.v) return '\\frac{' + d + ord + sp + this.print(b) + '}{' + d + sp + symLatex(e.v) + ord + '}';
    return '\\frac{' + d + ord + '}{' + d + sp + symLatex(e.v) + ord + '}\\left[' + this.print(b) + '\\right]';
  }

  limit(e) {
    const dir = e.dir ? '^{' + e.dir + '}' : '';
    return '\\lim_{' + symLatex(e.v) + ' \\to ' + this.print(e.args[1]) + dir + '} ' + this.operand(e.args[0]);
  }
}

// Raw products may nest; lift inner factors (and a leading inner coefficient)
// so the printed form is a single fraction with one sign.
function flattenMul(args) {
  if (!args.some((a) => a.type === 'mul')) return args;
  let coeff = new Rational(1n);
  let hadCoeff = false;
  const out = [];
  const visit = (list, top) => {
    list.forEach((f, idx) => {
      if (f.type === 'mul') visit(f.args, false);
      else if (f.type === 'num' && (idx === 0 || !top)) {
        coeff = coeff.mul(f.value);
        hadCoeff = true;
      } else out.push(f);
    });
  };
  visit(args, true);
  return hadCoeff ? [num(coeff), ...out] : out;
}

function isConstantTerm(t) {
  if (t.type === 'num' || t.type === 'const') return t.type === 'num' || t.name !== 'inf';
  if (t.type === 'pow') return t.args[0].type === 'num' && t.args[1].type === 'num';
  if (t.type === 'mul') return t.args.every(isConstantTerm);
  return false;
}

function isImaginaryTerm(t) {
  const isI = (f) => f.type === 'const' && f.name === 'i';
  if (isI(t)) return true;
  return t.type === 'mul' && t.args.some(isI) && t.args.every((f) => isI(f) || f.type === 'num' || (f.type === 'pow' && f.args[0].type === 'num'));
}

// Least common denominator (> 1) of the rational coefficients of a sum's
// terms, or null when every coefficient is an integer.
function commonDenominator(sumNode) {
  let d = 1n;
  for (const t of sumNode.args) {
    const c = t.type === 'num' ? t.value : t.type === 'mul' && t.args[0].type === 'num' ? t.args[0].value : null;
    if (c && c.d !== 1n) {
      let a = d;
      let b = c.d;
      while (b) [a, b] = [b, a % b];
      d = (d / a) * c.d;
    }
  }
  return d > 1n ? d : null;
}

function scaleTerm(t, d) {
  const D = new Rational(d);
  if (t.type === 'num') return num(t.value.mul(D));
  const hasCoeff = t.type === 'mul' && t.args[0].type === 'num';
  const c = (hasCoeff ? t.args[0].value : new Rational(1n)).mul(D);
  const rest = hasCoeff ? t.args.slice(1) : [t];
  if (c.isOne()) return rest.length === 1 ? rest[0] : mul(...rest);
  return mul(num(c), ...rest);
}

// For a term with a negative coefficient, the same term with the sign flipped.
function negated(t) {
  if (t.type === 'num') return t.value.isNegative() ? num(t.value.neg()) : null;
  if (t.type === 'mul' && t.args[0].type === 'num' && t.args[0].value.isNegative()) {
    const c = t.args[0].value.neg();
    const rest = t.args.slice(1);
    if (c.isOne()) return rest.length === 1 ? rest[0] : mul(...rest);
    return mul(num(c), ...rest);
  }
  return null;
}

/**
 * Render an expression as LaTeX.
 * @param {Expr} e
 * @returns {string}
 */
export function toLatex(e) {
  return new Printer(false).print(e);
}

/**
 * @typedef {object} LatexSpan
 * @property {string} id node id
 * @property {number} start index into the LaTeX string (inclusive)
 * @property {number} end index into the LaTeX string (exclusive)
 */

/**
 * Render as LaTeX and report the character range produced by each node, so a
 * renderer can find the glyphs that belong to a subexpression.
 * @param {Expr} e
 * @returns {{latex: string, spans: LatexSpan[]}}
 */
export function toLatexWithSpans(e) {
  const marked = new Printer(true).print(e);
  let out = '';
  const stack = [];
  const spans = [];
  for (let i = 0; i < marked.length; i++) {
    const ch = marked[i];
    if (ch === START) {
      const j = marked.indexOf(MID, i);
      stack.push({ id: marked.slice(i + 1, j), start: out.length });
      i = j;
    } else if (ch === END) {
      const s = stack.pop();
      spans.push({ id: s.id, start: s.start, end: out.length });
    } else {
      out += ch;
    }
  }
  return { latex: out, spans };
}

// Plain text printer.
const TEXT_FN = { asin: 'asin', acos: 'acos', atan: 'atan' };

function textPrec(e) {
  switch (e.type) {
    case 'eq': return 0;
    case 'add': return 1;
    case 'mul': return 2;
    case 'num': return e.value.isNegative() || !e.value.isInteger() ? 2 : 5;
    case 'pow': return 4;
    default: return 5;
  }
}

function textParen(e, minPrec) {
  const s = toText(e);
  return textPrec(e) < minPrec ? '(' + s + ')' : s;
}

/**
 * Render an expression as plain text that the text parser reads back.
 * @param {Expr} e
 * @returns {string}
 */
export function toText(e) {
  switch (e.type) {
    case 'num': return e.value.toString();
    case 'sym': return e.name;
    case 'const': return { pi: 'pi', e: 'e', i: 'i', inf: 'infinity' }[e.name];
    case 'add': {
      let out = '';
      e.args.forEach((t, i) => {
        const n = negated(t);
        if (i === 0) out = textParen(t, 1);
        else if (n) out += ' - ' + textParen(n, 2);
        else out += ' + ' + textParen(t, 1);
      });
      return out;
    }
    case 'mul': {
      const numer = [];
      const denom = [];
      let coeff = new Rational(1n);
      e.args.forEach((f, idx) => {
        if (f.type === 'num' && idx === 0) coeff = f.value;
        else if (f.type === 'pow' && f.args[1].type === 'num' && f.args[1].value.isNegative()) {
          const ex = f.args[1].value.neg();
          denom.push(ex.isOne() ? f.args[0] : pow(f.args[0], num(ex)));
        } else numer.push(f);
      });
      const sign = coeff.isNegative() ? '-' : '';
      coeff = coeff.abs();
      const parts = numer.map((f) => textParen(f, 3));
      let top = '';
      if (coeff.n !== 1n || parts.length === 0) top = coeff.n.toString();
      parts.forEach((p) => {
        if (top === '') top = p;
        else if (/^[0-9]+$/.test(top) && /^[A-Za-z(]/.test(p)) top += p;
        else top += '*' + p;
      });
      if (coeff.d !== 1n) denom.unshift(num(coeff.d));
      if (!denom.length) return sign + top;
      const bottom = denom.length === 1 ? textParen(denom[0], 5) : '(' + denom.map((d) => textParen(d, 3)).join('*') + ')';
      const topStr = numer.length > 1 || (numer.length === 1 && coeff.n !== 1n) ? '(' + top + ')' : top;
      return sign + topStr + '/' + bottom;
    }
    case 'pow': {
      const [b, ex] = e.args;
      if (ex.type === 'num' && ex.value.eq(new Rational(1n, 2n))) return 'sqrt(' + toText(b) + ')';
      if (ex.type === 'num' && ex.value.isNegative()) return '1/' + textParen(ex.value.eq(Rational.from(-1)) ? b : pow(b, num(ex.value.neg())), 5);
      const exS = toText(ex);
      const exWrapped = ex.type === 'sym' || ex.type === 'const' || (ex.type === 'num' && ex.value.isInteger() && !ex.value.isNegative()) ? exS : '(' + exS + ')';
      return textParen(b, 5) + '^' + exWrapped;
    }
    case 'fn': {
      if (e.name === 'factorial') return textParen(e.args[0], 5) + '!';
      if (e.name === 'pm') return toText(e.args[0]) + ' +- ' + textParen(e.args[1], 2);
      if (e.name === 'log' && e.args[1]) return 'log(' + toText(e.args[0]) + ', ' + toText(e.args[1]) + ')';
      return (TEXT_FN[e.name] || e.name) + '(' + e.args.map(toText).join(', ') + ')';
    }
    case 'eq': return toText(e.args[0]) + ' = ' + toText(e.args[1]);
    case 'integral': return 'integrate(' + toText(e.args[0]) + ', ' + e.v + (e.args.length === 3 ? ', ' + toText(e.args[1]) + ', ' + toText(e.args[2]) : '') + ')';
    case 'deriv': return 'd' + (e.order > 1 ? '^' + e.order : '') + '/d' + e.v + (e.order > 1 ? '^' + e.order : '') + '(' + toText(e.args[0]) + ')';
    case 'limit': return 'lim(' + toText(e.args[0]) + ', ' + e.v + ' -> ' + toText(e.args[1]) + (e.dir || '') + ')';
    case 'sum': return 'sum(' + toText(e.args[0]) + ', ' + e.v + ', ' + toText(e.args[1]) + ', ' + toText(e.args[2]) + ')';
    case 'list': return e.args.map(toText).join(', ');
    case 'bracket': return '[' + toText(e.args[0]) + '] from ' + toText(e.args[1]) + ' to ' + toText(e.args[2]);
    case 'matrix': return '[' + e.rows.map((r) => '[' + r.map(toText).join(', ') + ']').join(', ') + ']';
    default: throw new TypeError('Cannot print node type ' + e.type);
  }
}

