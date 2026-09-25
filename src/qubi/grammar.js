/**
 * The whole Qubi grammar: token definitions, the lexer, and a recursive-descent
 * parser that produces an AST with source positions.
 *
 * Lexical notes:
 * - Numbers are lexed as runs of digits. A decimal like `0.25` is two integer
 *   tokens joined by an adjacent `.`; the parser reads dotted chains so that
 *   `0.2.max` (stepped wires), `(0.2.0.1.0.5)` (stepped floats) and `0.25`
 *   (a float) share one rule: a chain of 1 part is a value, 2 integer parts a
 *   decimal, 3 parts `A.S.E`, and 4 to 6 parts are three values where adjacent
 *   integer pairs form decimals. When that split is not unique the parser asks
 *   for parentheses, as in `0.(0.5).3`.
 * - `//` starts a comment unless a `(` or `[` opened earlier on the same line
 *   is still open; there it is the floor-division operator.
 * - Newlines end statements, except inside `(` and `[`.
 *
 * Statement forms, expression precedence (lowest first):
 * ternary `?:`, `|| or`, `^^ xor`, `&& and`, comparisons, range `..`, `|`,
 * `^`, `&`, `+ -`, `* / % //`, unary `- + ! not ~` and casts, `**` (right
 * associative), postfix (index `a[i]`, unit suffix `45deg`), primary.
 *
 * @module qubi/grammar
 */

import { GATE_INFO } from './ir.js';
import { MAX_BITS } from './values.js';
import { canonicalKey, parseSettingValue, SETTINGS_KEYS } from './settings.js';

/**
 * An error with a source position. `reason` is the message without the
 * position; `message` appends `at line L, col C`.
 */
export class QubiError extends Error {
  /**
   * @param {string} reason Short, actionable message.
   * @param {import('./ir.js').SourcePos} [pos]
   * @param {{cause?: unknown}} [options]
   */
  constructor(reason, pos, options) {
    const where = pos ? ` at ${pos.file ? pos.file + ' ' : ''}line ${pos.line}, col ${pos.col}` : '';
    super(reason + where, options);
    this.name = 'QubiError';
    this.reason = reason;
    this.pos = pos;
    this.line = pos?.line;
    this.col = pos?.col;
    this.file = pos?.file;
  }
}

/** Builtin functions callable in expressions. */
export const BUILTIN_FUNCTIONS = Object.freeze([
  'sqrt', 'round', 'roundup', 'rounddown', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'len', 'length', 'count', 'tolist', 'typeof', 'listtype', 'error',
]);

/** Type names usable in casts, `(int)x`. */
const TYPE_NAMES = Object.freeze([
  'int', 'float', 'number', 'string', 'bitstring', 'list', 'list-int', 'list-list-int', 'boolean',
  'qubit', 'wire', 'wirelist', 'wires',
]);

/** Names that evaluate to constants and cannot be assigned. */
const CONSTANT_NAMES = Object.freeze(['pi', 'π', 'e', 'max', 'visiblemax', 'all', 'visible', 'true', 'false']);

const KEYWORD_LIST = [
  'if', 'elseif', 'elif', 'else', 'LOOP', 'REPEAT', 'LABEL', 'ANNOTATE', 'ANN', 'ENDANNOTATE', 'ENDANN',
  'gate', 'function', 'fn', 'arg', 'argmax', 'blackbox', 'encapsulate', 'and', 'or', 'xor', 'not',
];

/**
 * Reserved words: control flow, definitions, logic words, constants, wire
 * keywords, and directives. For editor highlighting.
 * @type {ReadonlyArray<string>}
 */
export const QUBI_KEYWORDS = Object.freeze([
  ...KEYWORD_LIST, ...CONSTANT_NAMES, 'deg', 'rad', 'pirad', '#settings', '#import', '#include',
]);

const UNIT_SUFFIXES = new Set(['deg', 'rad', 'pirad']);
const WORD_OPS = new Set(['and', 'or', 'xor', 'not']);
const NOT_ASSIGNABLE = new Set([...CONSTANT_NAMES, ...KEYWORD_LIST, 'endif']);
/** Builtin names that are legal variable names but deserve a warning. */
const SHADOW_WARN = new Set(BUILTIN_FUNCTIONS);
const OPS2 = ['**', '++', '--', '..', '==', '!=', '<=', '>=', '&&', '||', '^^', '//'];
const OPS1 = '+-*/%?:()[]{},=<>!&|^~.';
const MAX_IMPORT_DEPTH = 20;
const GATE_PROPS = ['name', 'label', 'matrix', 'sequence', 'desc', 'examples', 'color', 'category', 'qubits'];

function isIdentStart(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === 'π';
}

function isIdentChar(c) {
  return isIdentStart(c) || (c >= '0' && c <= '9');
}

function isDigit(c) {
  return c >= '0' && c <= '9';
}

/**
 * Tokenize Qubi source.
 * @param {string} src
 * @param {{line?: number, col?: number, file?: string}} [base] Position of src[0].
 * @returns {Array<{t: string, v: any, s: number, e: number, line: number, col: number, sp: boolean, file?: string}>}
 */
function lex(src, base = {}) {
  const toks = [];
  let i = 0;
  let line = base.line ?? 1;
  let col = base.col ?? 1;
  const file = base.file;
  let depth = 0;
  let lineDepth = 0;
  let atLineStart = true;
  let sp = true;
  const pos = () => ({ line, col, file });
  const err = (msg, p = pos()) => { throw new QubiError(msg, p); };
  const advance = (k) => {
    for (let j = 0; j < k; j++) {
      if (src[i] === '\n') { line++; col = 1; } else { col++; }
      i++;
    }
  };
  const push = (t, v, s, p) => {
    toks.push({ t, v, s, e: i, line: p.line, col: p.col, sp, file });
    sp = false;
    atLineStart = false;
  };
  const newline = (p) => {
    if (depth === 0 && toks.length && toks[toks.length - 1].t !== 'nl') {
      toks.push({ t: 'nl', v: '\n', s: i, e: i, line: p.line, col: p.col, sp, file });
    }
    lineDepth = 0;
    atLineStart = true;
    sp = true;
  };

  while (i < src.length) {
    const c = src[i];
    const p = pos();
    if (c === '\n') {
      newline(p);
      advance(1);
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') {
      sp = true;
      advance(1);
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) err('Block comment is not closed: add */');
      const hadNewline = src.slice(i, end).includes('\n');
      advance(end + 2 - i);
      if (hadNewline) newline(p);
      sp = true;
      continue;
    }
    if (c === '/' && src[i + 1] === '/' && lineDepth === 0) {
      while (i < src.length && src[i] !== '\n') advance(1);
      sp = true;
      continue;
    }
    if (c === '#' && atLineStart && depth === 0) {
      const s = i;
      advance(1);
      let name = '';
      while (i < src.length && isIdentChar(src[i])) { name += src[i]; advance(1); }
      let rest = '';
      while (i < src.length && src[i] !== '\n') { rest += src[i]; advance(1); }
      rest = rest.replace(/(^|\s)\/\/.*$/, '').trim();
      push('directive', { name, rest }, s, p);
      continue;
    }
    if (c === '#') err("Directives such as #settings start a line");
    if (isDigit(c)) {
      const s = i;
      if (c === '0' && (src[i + 1] === 'b' || src[i + 1] === 'B' || src[i + 1] === 'x' || src[i + 1] === 'X')) {
        const hex = src[i + 1] === 'x' || src[i + 1] === 'X';
        advance(2);
        let digits = '';
        const ok = hex ? /[0-9a-fA-F_]/ : /[01_]/;
        while (i < src.length && ok.test(src[i])) { if (src[i] !== '_') digits += src[i]; advance(1); }
        if (!digits) err(hex ? 'Hex literal needs digits: 0x1F' : 'Bitstring literal needs digits: 0b101', p);
        if (i < src.length && isIdentChar(src[i])) {
          err(hex ? `Invalid hex digit '${src[i]}'` : `Bitstring digits are 0 and 1, found '${src[i]}'`, pos());
        }
        const width = hex ? digits.length * 4 : digits.length;
        if (width > MAX_BITS) err(`Bitstring literals hold at most ${MAX_BITS} bits`, p);
        const value = parseInt(digits, hex ? 16 : 2);
        push('bits', { value, width, text: src.slice(s, i) }, s, p);
        continue;
      }
      let digits = '';
      while (i < src.length && isDigit(src[i])) { digits += src[i]; advance(1); }
      push('int', digits, s, p);
      continue;
    }
    if (isIdentStart(c)) {
      if (atLineStart && depth === 0) {
        const m = /gate[ \t]+([A-Za-z_][A-Za-z0-9_]*)\s*\{/y;
        m.lastIndex = i;
        const g = m.exec(src);
        if (g) {
          const s = i;
          const openAt = i + g[0].length - 1;
          let k = openAt + 1;
          let braces = 1;
          let inStr = false;
          while (k < src.length && braces > 0) {
            const ch = src[k];
            if (inStr) { if (ch === '\\') k++; else if (ch === '"') inStr = false; } else if (ch === '"') inStr = true;
            else if (ch === '{') braces++;
            else if (ch === '}') braces--;
            k++;
          }
          if (braces > 0) err(`Gate ${g[1]} is missing its closing }`, p);
          advance(openAt + 1 - i);
          const bodyPos = pos();
          const body = src.slice(openAt + 1, k - 1);
          advance(k - i);
          push('gatedef', { name: g[1], body, bodyLine: bodyPos.line, bodyCol: bodyPos.col }, s, p);
          continue;
        }
      }
      const s = i;
      let name = '';
      while (i < src.length && isIdentChar(src[i])) { name += src[i]; advance(1); }
      push('ident', name, s, p);
      continue;
    }
    if (c === '"') {
      const s = i;
      advance(1);
      let raw = '';
      const contentCol = col;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\n') err('String is not closed: add "', p);
        if (src[i] === '\\' && i + 1 < src.length) { raw += src[i]; advance(1); }
        raw += src[i];
        advance(1);
      }
      if (i >= src.length) err('String is not closed: add "', p);
      advance(1);
      push('string', { raw, line: p.line, col: contentCol }, s, p);
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) {
      const s = i;
      advance(2);
      push('op', two, s, p);
      continue;
    }
    if (OPS1.includes(c)) {
      const s = i;
      if (c === '(' || c === '[') { depth++; lineDepth++; }
      if (c === ')' || c === ']') {
        depth = Math.max(0, depth - 1);
        lineDepth = Math.max(0, lineDepth - 1);
      }
      advance(1);
      push('op', c, s, p);
      continue;
    }
    err(`Unexpected character '${c}'`, p);
  }
  toks.push({ t: 'eof', v: null, s: i, e: i, line, col, sp: true, file });
  return toks;
}

/**
 * Split a dotted chain of atoms into its meaning. Each atom is
 * `{node, int: string|null}` where `int` is the digit text of a bare integer.
 * @returns {{kind: 'value', node: object}|{kind: 'stepped', parts: object[]}|{kind: 'error', message: string}}
 */
function resolveChain(atoms, mkFloat) {
  const n = atoms.length;
  if (n === 1) return { kind: 'value', node: atoms[0].node };
  if (n === 2) {
    if (atoms[0].int !== null && atoms[1].int !== null) return { kind: 'value', node: mkFloat(atoms[0], atoms[1]) };
    return { kind: 'error', message: 'A stepped range has three parts: A.S.E, for example 0.2.max' };
  }
  const splits = [];
  const walk = (i, parts) => {
    if (parts.length === 3) {
      if (i === n) splits.push(parts);
      return;
    }
    if (i < n) walk(i + 1, [...parts, atoms[i].node]);
    if (i + 1 < n && atoms[i].int !== null && atoms[i + 1].int !== null) walk(i + 2, [...parts, mkFloat(atoms[i], atoms[i + 1])]);
  };
  walk(0, []);
  if (splits.length === 1) return { kind: 'stepped', parts: splits[0] };
  if (splits.length > 1) return { kind: 'error', message: 'Ambiguous stepped range: wrap the step in parentheses, as in 0.(0.5).3' };
  return { kind: 'error', message: 'Cannot read this dotted chain: use A.S.E for a stepped range or A..B for a range' };
}

class Parser {
  /**
   * @param {string} src
   * @param {object} opts
   */
  constructor(src, opts) {
    this.src = src;
    this.opts = opts;
    this.toks = lex(src, opts.base);
    this.i = 0;
    this.noSpacedSign = false;
    this.noGreater = false;
    this.warnings = opts.warnings;
    this.errors = opts.errors;
  }

  peek(k = 0) {
    return this.toks[Math.min(this.i + k, this.toks.length - 1)];
  }

  next() {
    const t = this.toks[this.i];
    if (t.t !== 'eof') this.i++;
    return t;
  }

  prev() {
    return this.toks[Math.max(0, this.i - 1)];
  }

  pos(t = this.peek()) {
    return t.file ? { line: t.line, col: t.col, file: t.file } : { line: t.line, col: t.col };
  }

  isOp(v, k = 0) {
    const t = this.peek(k);
    return t.t === 'op' && t.v === v;
  }

  isIdent(v, k = 0) {
    const t = this.peek(k);
    return t.t === 'ident' && (v === undefined || t.v === v);
  }

  error(msg, t = this.peek()) {
    return new QubiError(msg, this.pos(t));
  }

  expectOp(v, msg) {
    if (!this.isOp(v)) throw this.error(msg ?? `Expected '${v}'${this.describeFound()}`);
    return this.next();
  }

  describeFound() {
    const t = this.peek();
    if (t.t === 'eof') return ' before the end of the file';
    if (t.t === 'nl') return ' before the end of the line';
    return `, found '${this.src.slice(t.s, t.e) || t.v}'`;
  }

  textFrom(startTok) {
    return this.src.slice(startTok.s, this.prev().e).trim();
  }

  skipNewlines() {
    while (this.peek().t === 'nl') this.next();
  }

  atStmtEnd() {
    const t = this.peek();
    return t.t === 'nl' || t.t === 'eof' || (t.t === 'op' && t.v === '}');
  }

  warn(msg, t) {
    this.warnings.push({ severity: 'warning', message: msg, pos: this.pos(t) });
  }

  // Statements

  parseProgram() {
    const body = this.parseStatements(0, null);
    return body;
  }

  parseStatements(depth, until) {
    const out = [];
    for (;;) {
      this.skipNewlines();
      const t = this.peek();
      if (t.t === 'eof') {
        if (until === '}') throw this.error('Block is missing its closing }');
        if (until === 'ENDANN') throw this.error('ANNOTATE is missing its ENDANNOTATE "id"');
        break;
      }
      if (until === '}' && this.isOp('}')) break;
      if (until === 'ENDANN' && this.isOp('}')) throw this.error('ANNOTATE is missing its ENDANNOTATE "id"');
      if (until === 'ENDANN' && (this.isIdent('ENDANNOTATE') || this.isIdent('ENDANN'))) break;
      if (!until && this.isOp('}')) throw this.error('Unmatched }: there is no open block');
      try {
        const stmt = this.parseStatement(depth);
        if (stmt) out.push(stmt);
        if (!this.atStmtEnd()) throw this.error(`Expected a new line after the statement${this.describeFound()}`);
      } catch (e) {
        if (!this.errors || !(e instanceof QubiError)) throw e;
        this.errors.push(e);
        while (this.peek().t !== 'nl' && this.peek().t !== 'eof') this.next();
      }
    }
    return out;
  }

  parseBlock(depth) {
    this.skipNewlines();
    this.expectOp('{', `Expected '{' to open the block${this.describeFound()}`);
    const body = this.parseStatements(depth + 1, '}');
    this.expectOp('}');
    return body;
  }

  parseStatement(depth) {
    const t = this.peek();
    if (t.t === 'directive') return this.parseDirective(depth);
    if (t.t === 'gatedef') {
      if (depth > 0) throw this.error('Gate definitions go at the top level');
      this.next();
      return this.parseGateDef(t);
    }
    if (this.isOp('<')) return this.parseCall(t);
    if (t.t !== 'ident') throw this.error(`Unexpected '${this.src.slice(t.s, t.e)}' at the start of a statement`);
    const name = t.v;
    if (this.isOp('=', 1)) return this.parseAssign();
    switch (name) {
      case 'if': return this.parseIf(depth);
      case 'elseif': case 'elif': case 'else':
        throw this.error(`${name} needs a preceding if block`);
      case 'endif':
        throw this.error('Qubi has no endif: an if block ends at its closing }');
      case 'LOOP': case 'REPEAT': return this.parseLoop(depth);
      case 'LABEL': return this.parseLabel();
      case 'ANNOTATE': case 'ANN': return this.parseAnnotate(depth);
      case 'ENDANNOTATE': case 'ENDANN':
        throw this.error(`${name} has no matching ANNOTATE`);
      case 'function': case 'fn': case 'blackbox': case 'encapsulate':
        return this.parseFunction(depth);
      case 'gate':
        throw this.error('A gate definition looks like: gate NAME { matrix: [1 0; 0 1] }');
      default:
        break;
    }
    if ((this.isOp('++', 1) || this.isOp('--', 1)) && !this.peek(1).sp) {
      this.next();
      const op = this.next();
      this.checkAssignable(t);
      return { type: 'IncDec', name, delta: op.v === '++' ? 1 : -1, pos: this.pos(t) };
    }
    if (BUILTIN_FUNCTIONS.includes(name) && this.isOp('(', 1)) {
      const expr = this.parseExpr();
      return { type: 'ExprStmt', expr, pos: this.pos(t), text: this.textFrom(t) };
    }
    return this.parseCall(t);
  }

  checkAssignable(t) {
    const name = t.v;
    if (NOT_ASSIGNABLE.has(name)) throw this.error(`Cannot assign to ${name}: it is a reserved word`, t);
    if (GATE_INFO[name]) throw this.error(`Cannot assign to ${name}: it is a native gate`, t);
    if (SHADOW_WARN.has(name)) this.warn(`${name} is a builtin name; prefer another variable name`, t);
  }

  parseAssign() {
    const t = this.next();
    this.checkAssignable(t);
    this.next();
    if (this.isIdent('MEASURE')) {
      const mt = this.next();
      if (this.atStmtEnd()) throw this.error('MEASURE needs wires, for example m = MEASURE (0,1)');
      const wires = this.parseWireExpr();
      if (wires.type === 'Register') throw this.error('MEASURE takes parentheses, not brackets: MEASURE (0,1)', mt);
      return { type: 'MeasureAssign', name: t.v, wires, pos: this.pos(t), text: this.textFrom(t) };
    }
    const expr = this.parseExpr();
    if (expr.type === 'Sweep') expr.axisName = t.v;
    return { type: 'Assign', name: t.v, expr, pos: this.pos(t), text: this.textFrom(t) };
  }

  parseCall(start) {
    let name = null;
    let nameExpr = null;
    if (this.isOp('<')) {
      nameExpr = this.parseSweep('<inline>');
    } else {
      name = this.next().v;
    }
    const info = name ? GATE_INFO[name] : null;
    let angles = null;
    let args = null;
    let wires = null;
    if (this.isOp('(') && !this.peek().sp) {
      if (info && info.params > 0) {
        angles = this.parseParenItems();
      } else if (info) {
        wires = this.parseWireExpr();
      } else {
        args = this.parseParenItems();
      }
    }
    if (!wires && !this.atStmtEnd() && !this.isOp(',')) wires = this.parseWireExpr();
    const trailing = [];
    let commaAfterWires = false;
    if (!this.atStmtEnd()) {
      if (this.isOp(',')) {
        this.next();
        commaAfterWires = true;
      }
      trailing.push(this.parseExpr());
      while (this.isOp(',')) {
        this.next();
        trailing.push(this.parseExpr());
      }
    }
    // A gate without angles or controls reads comma-separated values as more wires: X 1,3,5 is X (1,3,5).
    // A space-separated value (H 0 0.5) stays an angle, so it is still reported as one.
    if (info && info.params === 0 && !info.controlled && commaAfterWires && wires && wires.type !== 'Register' && !angles) {
      wires = { type: 'List', items: [wires, ...trailing.splice(0)], pos: wires.pos, text: this.textFrom(start).slice(name.length).trim() };
    }
    const node = { type: 'Call', name, nameExpr, angles, args, wires, trailing, pos: this.pos(start), text: this.textFrom(start) };
    if (info) this.checkNativeForm(node, start);
    return node;
  }

  checkNativeForm(node, start) {
    const info = GATE_INFO[node.name];
    const w = node.wires;
    if (node.name === 'MEASURE' && w && w.type === 'Register') {
      throw this.error('MEASURE takes parentheses, not brackets: MEASURE (0,1)', start);
    }
    if (info.controlled && w && w.type !== 'Register' && w.type !== 'Ident' && w.type !== 'Index') {
      throw this.error(`Controlled gates take a bracket register: ${node.name} [c,t]`, start);
    }
  }

  parseIf(depth) {
    const start = this.next();
    const branches = [];
    const condStart = this.peek();
    const cond = this.parseExpr();
    branches.push({ cond, condText: this.textFrom(condStart), body: this.parseBlock(depth) });
    let elseBody = null;
    for (;;) {
      const save = this.i;
      this.skipNewlines();
      const t = this.peek();
      if (t.t === 'ident' && (t.v === 'elseif' || t.v === 'elif' || (t.v === 'else' && this.isIdent('if', 1)))) {
        this.next();
        if (t.v === 'else') this.next();
        if (this.isOp('{')) throw this.error(`${t.v === 'else' ? 'else if' : t.v} needs a condition`);
        const cs = this.peek();
        const c = this.parseExpr();
        branches.push({ cond: c, condText: this.textFrom(cs), body: this.parseBlock(depth) });
        continue;
      }
      if (t.t === 'ident' && t.v === 'else') {
        this.next();
        elseBody = this.parseBlock(depth);
        const after = this.i;
        this.skipNewlines();
        if (this.isIdent('elseif') || this.isIdent('elif') || this.isIdent('else')) {
          throw this.error(`${this.peek().v} cannot follow else`);
        }
        this.i = after;
        break;
      }
      if (t.t === 'ident' && t.v === 'endif') throw this.error('Qubi has no endif: an if block ends at its closing }');
      this.i = save;
      break;
    }
    return { type: 'If', branches, elseBody, pos: this.pos(start) };
  }

  parseLoop(depth) {
    const start = this.next();
    if (this.isOp('{') || this.atStmtEnd()) throw this.error(`${start.v} needs a count or condition, for example ${start.v} 3 { }`);
    const hs = this.peek();
    let header;
    if (this.isOp('<')) {
      header = this.parseSweep('<loop>');
    } else {
      header = this.parseExpr();
    }
    const headerText = `${start.v} ${this.textFrom(hs)}`;
    const body = this.parseBlock(depth);
    return { type: 'Loop', keyword: start.v, header, headerText, body, pos: this.pos(start) };
  }

  parseLabel() {
    const start = this.next();
    if (this.peek().t === 'string') throw this.error('LABEL needs wires before the text: LABEL 0 "text"');
    if (this.atStmtEnd()) throw this.error('LABEL needs wires and text: LABEL 0 "text"');
    const wires = this.parseWireExpr();
    if (this.peek().t !== 'string') throw this.error('LABEL needs quoted text after the wires: LABEL 0 "text"');
    const text = this.parseString(this.next());
    return { type: 'Label', wires, text, pos: this.pos(start) };
  }

  parseAnnotate(depth) {
    const start = this.next();
    if (!this.atStmtEnd()) throw this.error(`${start.v} stands alone on its line; the id goes on ENDANNOTATE "id"`);
    const body = this.parseStatements(depth + 1, 'ENDANN');
    const end = this.next();
    if (this.peek().t !== 'string') throw this.error(`${end.v} needs an id: ${end.v} "id"`);
    const id = this.parseString(this.next());
    return { type: 'Annotate', body, id, pos: this.pos(start) };
  }

  parseFunction(depth) {
    const start = this.peek();
    if (depth > 0) throw this.error('Function definitions go at the top level');
    const modifiers = { blackbox: false, encapsulate: false };
    while (this.isIdent('blackbox') || this.isIdent('encapsulate')) modifiers[this.next().v] = true;
    if (!this.isIdent('function') && !this.isIdent('fn')) throw this.error('Expected function or fn after the modifier');
    this.next();
    const nt = this.peek();
    if (nt.t !== 'ident') throw this.error('Expected a function name');
    this.next();
    if (NOT_ASSIGNABLE.has(nt.v) || GATE_INFO[nt.v] || BUILTIN_FUNCTIONS.includes(nt.v)) {
      throw this.error(`${nt.v} is reserved and cannot name a function`, nt);
    }
    const params = [];
    this.expectOp('(', `Function ${nt.v} needs a parameter list: fn ${nt.v}(a, b) { }`);
    while (!this.isOp(')')) {
      const p = this.peek();
      if (p.t !== 'ident') throw this.error('Parameters are names separated by commas');
      if (NOT_ASSIGNABLE.has(p.v) || GATE_INFO[p.v]) throw this.error(`${p.v} is reserved and cannot name a parameter`);
      if (params.includes(p.v)) throw this.error(`Parameter ${p.v} is listed twice`);
      params.push(this.next().v);
      if (this.isOp(',')) this.next();
      else if (!this.isOp(')')) throw this.error(`Expected ',' or ')' in the parameter list${this.describeFound()}`);
    }
    this.next();
    const body = this.parseBlock(depth);
    return { type: 'FunctionDef', name: nt.v, params, modifiers, body, pos: this.pos(start) };
  }

  parseDirective(depth) {
    const t = this.next();
    const { name, rest } = t.v;
    if (depth > 0) throw this.error(`#${name} goes at the top level`, t);
    if (name === 'settings') {
      const m = /^(\S+)\s*(.*)$/.exec(rest);
      if (!m) throw this.error(`#settings needs a key and a value, for example #settings MaxQubits 4`, t);
      const key = canonicalKey(m[1]);
      if (!key) throw this.error(`Unknown setting ${m[1]}. Keys: ${SETTINGS_KEYS.join(', ')}`, t);
      const r = parseSettingValue(key, m[2]);
      if ('error' in r) throw this.error(r.error, t);
      return { type: 'Settings', key, value: r.value, raw: m[2].trim(), pos: this.pos(t) };
    }
    if (name === 'import' || name === 'include') return this.parseImport(t, name, rest);
    throw this.error(`Unknown directive #${name}. Directives: #settings, #import, #include`, t);
  }

  parseImport(t, name, rest) {
    const path = rest.replace(/^"(.*)"$/, '$1').trim();
    if (!path) throw this.error(`#${name} needs a file, for example #${name} lib.qubi`, t);
    const stack = this.opts.importStack;
    if (stack.includes(path)) throw this.error(`Import cycle: ${[...stack, path].join(' -> ')}`, t);
    const depth = (this.opts.importDepth ?? 0) + 1;
    if (depth > MAX_IMPORT_DEPTH) throw this.error(`#${name} nesting is deeper than ${MAX_IMPORT_DEPTH}`, t);
    const resolve = this.opts.resolveImport;
    if (typeof resolve !== 'function') throw this.error(`Cannot read ${path}: pass a resolveImport option to parse`, t);
    let text;
    try {
      text = resolve(path);
    } catch (e) {
      throw new QubiError(`Cannot read ${path}: ${e.message}`, this.pos(t), { cause: e });
    }
    if (typeof text !== 'string') throw this.error(`Cannot read ${path}: resolveImport returned no text`, t);
    const body = parseInternal(text, { ...this.opts, base: { file: path }, importStack: [...stack, path], importDepth: depth });
    return { type: 'Import', keyword: name, path, body, pos: this.pos(t) };
  }

  parseGateDef(t) {
    const { name, body, bodyLine, bodyCol } = t.v;
    if (GATE_INFO[name]) throw this.error(`${name} is a native gate and cannot be redefined`, t);
    if (NOT_ASSIGNABLE.has(name) || BUILTIN_FUNCTIONS.includes(name)) throw this.error(`${name} is reserved and cannot name a gate`, t);
    const clean = body.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const lines = clean.split('\n');
    const props = {};
    const file = t.file;
    const at = (line, col) => (file ? { line, col, file } : { line, col });
    for (let li = 0; li < lines.length; li++) {
      const lineNo = bodyLine + li;
      const colBase = li === 0 ? bodyCol : 1;
      const raw = lines[li];
      if (!raw.trim() || /^\s*\/\//.test(raw)) continue;
      const m = /^(\s*)([A-Za-z]+)\s*:[ \t]*(.*)$/.exec(raw);
      if (!m) throw new QubiError(`Gate ${name}: each line is key: value`, at(lineNo, colBase));
      const key = m[2];
      const valueCol = colBase + raw.length - m[3].length;
      if (!GATE_PROPS.includes(key)) {
        throw new QubiError(`Gate ${name}: unknown property ${key}. Properties: ${GATE_PROPS.join(', ')}`, at(lineNo, colBase + m[1].length));
      }
      if (key in props) throw new QubiError(`Gate ${name}: ${key} is given twice`, at(lineNo, colBase + m[1].length));
      let value = m[3].replace(/(^|\s)\/\/.*$/, '').trimEnd();
      if (key === 'matrix') {
        const bal = (s) => (s.match(/\[/g) || []).length - (s.match(/\]/g) || []).length;
        while (bal(value) > 0 && li + 1 < lines.length) {
          li++;
          value += '\n' + lines[li].replace(/(^|\s)\/\/.*$/, '');
        }
        props.matrix = { text: value, pos: at(lineNo, valueCol) };
      } else if (key === 'sequence') {
        let text = value;
        const seqLine = lineNo;
        let seqCol = valueCol;
        if (value.trim().startsWith('{')) {
          const bal = (s) => (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;
          while (bal(text) > 0 && li + 1 < lines.length) {
            li++;
            text += '\n' + lines[li];
          }
          if (bal(text) !== 0) throw new QubiError(`Gate ${name}: sequence block is missing its closing }`, at(lineNo, valueCol));
          const open = text.indexOf('{');
          seqCol = valueCol + open + 1;
          text = text.slice(open + 1, text.lastIndexOf('}'));
        }
        if (!text.trim()) throw new QubiError(`Gate ${name}: sequence is empty`, at(seqLine, seqCol));
        const seqBody = parseInternal(text, { ...this.opts, base: { line: seqLine, col: seqCol, file }, inSequence: true });
        for (const st of seqBody) {
          if (st.type === 'Settings' || st.type === 'Import' || st.type === 'FunctionDef' || st.type === 'GateDef') {
            throw new QubiError(`Gate ${name}: a sequence holds gate statements only`, st.pos);
          }
        }
        props.sequence = { body: seqBody, text: text.trim(), pos: at(seqLine, seqCol) };
      } else if (key === 'qubits') {
        if (!/^\d+$/.test(value.trim()) || Number(value) < 1) {
          throw new QubiError(`Gate ${name}: qubits takes a whole number of 1 or more`, at(lineNo, valueCol));
        }
        props.qubits = Number(value);
      } else {
        props[key] = value.trim();
      }
    }
    if (!props.matrix && !props.sequence) throw this.error(`Gate ${name} needs matrix: or sequence:`, t);
    if (props.matrix && props.sequence) throw this.error(`Gate ${name} takes matrix: or sequence:, not both`, t);
    return { type: 'GateDef', name, props, pos: this.pos(t) };
  }

  // Expressions

  parseWireExpr() {
    const saved = this.noSpacedSign;
    this.noSpacedSign = true;
    try {
      return this.parseExpr();
    } finally {
      this.noSpacedSign = saved;
    }
  }

  nested(fn) {
    const a = this.noSpacedSign;
    const b = this.noGreater;
    this.noSpacedSign = false;
    this.noGreater = false;
    try {
      return fn();
    } finally {
      this.noSpacedSign = a;
      this.noGreater = b;
    }
  }

  parseExpr() {
    return this.parseTernary();
  }

  node(type, start, props) {
    return { type, ...props, pos: this.pos(start), text: this.textFrom(start) };
  }

  parseTernary() {
    const start = this.peek();
    const cond = this.parseOr();
    if (!this.isOp('?')) return cond;
    this.next();
    const a = this.nested(() => this.parseTernary());
    this.expectOp(':', `Ternary needs ':' as in c ? a : b${this.describeFound()}`);
    const b = this.parseTernary();
    return this.node('Ternary', start, { cond, a, b });
  }

  binaryLevel(next, ops) {
    const start = this.peek();
    let left = next();
    for (;;) {
      const t = this.peek();
      let op = null;
      if (t.t === 'op' && ops.includes(t.v)) op = t.v;
      if (t.t === 'ident' && ops.includes(t.v)) op = t.v;
      if (!op) return left;
      this.next();
      const right = next();
      left = this.node('Binary', start, { op: normalizeOp(op), left, right });
    }
  }

  parseOr() { return this.binaryLevel(() => this.parseXor(), ['||', 'or']); }
  parseXor() { return this.binaryLevel(() => this.parseAnd(), ['^^', 'xor']); }
  parseAnd() { return this.binaryLevel(() => this.parseCompare(), ['&&', 'and']); }

  parseCompare() {
    const start = this.peek();
    let left = this.parseRange();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op' || !['==', '!=', '<', '>', '<=', '>='].includes(t.v)) return left;
      if (t.v === '>' && this.noGreater) return left;
      this.next();
      const right = this.parseRange();
      left = this.node('Binary', start, { op: t.v, left, right });
    }
  }

  parseRange() {
    const start = this.peek();
    const left = this.parseBitOr();
    if (!this.isOp('..')) return left;
    this.next();
    const right = this.parseBitOr();
    return this.node('Range', start, { start: left, end: right });
  }

  parseBitOr() { return this.binaryLevel(() => this.parseBitXor(), ['|']); }
  parseBitXor() { return this.binaryLevel(() => this.parseBitAnd(), ['^']); }
  parseBitAnd() { return this.binaryLevel(() => this.parseAdditive(), ['&']); }

  parseAdditive() {
    const start = this.peek();
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op' || (t.v !== '+' && t.v !== '-')) return left;
      if (this.noSpacedSign && t.sp && !this.peek(1).sp) return left;
      this.next();
      const right = this.parseMultiplicative();
      left = this.node('Binary', start, { op: t.v, left, right });
    }
  }

  parseMultiplicative() { return this.binaryLevel(() => this.parseUnary(), ['*', '/', '%', '//']); }

  parseUnary() {
    const t = this.peek();
    if ((t.t === 'op' && ['-', '+', '!', '~'].includes(t.v)) || (t.t === 'ident' && t.v === 'not')) {
      this.next();
      const arg = this.parseUnary();
      return this.node('Unary', t, { op: t.v === 'not' ? '!' : t.v, arg });
    }
    const cast = this.tryCast();
    if (cast) return cast;
    return this.parsePower();
  }

  tryCast() {
    if (!this.isOp('(')) return null;
    const start = this.peek();
    let k = 1;
    const parts = [];
    for (;;) {
      const t = this.peek(k);
      if (t.t !== 'ident') return null;
      parts.push(t.v);
      k++;
      if (this.isOp('-', k) && !this.peek(k).sp && !this.peek(k + 1).sp) { parts.push('-'); k++; continue; }
      break;
    }
    const type = parts.join('');
    if (!TYPE_NAMES.includes(type) || !this.isOp(')', k)) return null;
    const after = this.peek(k + 1);
    const startsPrimary = after.t === 'int' || after.t === 'bits' || after.t === 'string'
      || (after.t === 'ident' && !WORD_OPS.has(after.v)) || (after.t === 'op' && (after.v === '(' || after.v === '[' || after.v === '-'));
    if (!startsPrimary) return null;
    this.i += k + 1;
    const arg = this.parseUnary();
    return this.node('Cast', start, { to: type, arg });
  }

  parsePower() {
    const start = this.peek();
    const base = this.parsePostfix();
    if (!this.isOp('**')) return base;
    this.next();
    const exp = this.parseUnary();
    return this.node('Binary', start, { op: '**', left: base, right: exp });
  }

  parsePostfix() {
    const start = this.peek();
    let n = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.t === 'op' && t.v === '[' && !t.sp) {
        this.next();
        const index = this.nested(() => this.parseExpr());
        this.expectOp(']', `Index needs a closing ]${this.describeFound()}`);
        n = this.node('Index', start, { obj: n, index });
        continue;
      }
      if (t.t === 'ident' && UNIT_SUFFIXES.has(t.v) && !t.sp) {
        this.next();
        n = this.node('Unit', start, { arg: n, unit: t.v });
        continue;
      }
      return n;
    }
  }

  parseChainAtom() {
    const t = this.peek();
    if (t.t === 'int') {
      this.next();
      return { node: this.node('Num', t, { value: Number(t.v), isInt: true }), int: t.v, tok: t };
    }
    if (t.t === 'bits') {
      this.next();
      return { node: this.node('Bits', t, { value: t.v.value, width: t.v.width }), int: null, tok: t };
    }
    if (t.t === 'ident' && !WORD_OPS.has(t.v)) {
      if (BUILTIN_FUNCTIONS.includes(t.v) && this.isOp('(', 1)) return { node: this.parseBuiltinCall(), int: null, tok: t };
      this.next();
      return { node: this.identNode(t), int: null, tok: t };
    }
    if (t.t === 'op' && t.v === '(') return { node: this.parseParen(), int: null, tok: t };
    if (t.t === 'op' && t.v === '-') {
      this.next();
      const inner = this.parseChainAtom();
      return { node: this.node('Unary', t, { op: '-', arg: inner.node }), int: null, tok: t };
    }
    throw this.error(`Expected a value${this.describeFound()}`);
  }

  identNode(t) {
    if (t.v === 'true' || t.v === 'false') return this.node('Bool', t, { value: t.v === 'true' });
    return this.node('Ident', t, { name: t.v });
  }

  parsePrimary() {
    const t = this.peek();
    if (t.t === 'string') {
      this.next();
      return this.parseString(t);
    }
    if (t.t === 'op' && t.v === '[') {
      this.next();
      const items = this.nested(() => this.parseItems(']'));
      return this.node('Register', t, { items });
    }
    if (t.t === 'op' && t.v === '<') return this.parseSweep('<inline>');
    if (t.t === 'ident' && WORD_OPS.has(t.v)) throw this.error(`Unexpected '${t.v}'`);
    if (t.t === 'nl' || t.t === 'eof') throw this.error(`Expected a value${this.describeFound()}`);
    if (t.t === 'op' && t.v !== '(' && t.v !== '-') throw this.error(`Expected a value${this.describeFound()}`);
    if (t.t === 'op' && t.v === '-') throw this.error(`Expected a value${this.describeFound()}`);
    const atoms = [this.parseChainAtom()];
    while (this.isOp('.') && !this.peek().sp && !this.peek(1).sp) {
      this.next();
      atoms.push(this.parseChainAtom());
    }
    const r = resolveChain(atoms, (a, b) => {
      const text = `${a.int}.${b.int}`;
      return { type: 'Num', value: Number(text), isInt: false, pos: this.pos(a.tok), text };
    });
    if (r.kind === 'error') throw this.error(r.message, t);
    if (r.kind === 'value') return r.node;
    return this.node('Stepped', t, { start: r.parts[0], step: r.parts[1], end: r.parts[2] });
  }

  parseBuiltinCall() {
    const t = this.next();
    this.expectOp('(');
    const args = this.nested(() => this.parseItems(')'));
    return this.node('BuiltinCall', t, { name: t.v, args });
  }

  parseItems(close) {
    const items = [];
    let trailingComma = false;
    while (!this.isOp(close)) {
      if (this.peek().t === 'eof') throw this.error(`Missing '${close}'`);
      items.push(this.parseExpr());
      trailingComma = false;
      if (this.isOp(',')) {
        this.next();
        trailingComma = true;
      } else if (!this.isOp(close)) {
        throw this.error(`Expected ',' or '${close}'${this.describeFound()}`);
      }
    }
    this.next();
    items.trailingComma = trailingComma;
    return items;
  }

  parseParenItems() {
    this.expectOp('(');
    return this.nested(() => this.parseItems(')'));
  }

  parseParen() {
    const t = this.next();
    const items = this.nested(() => this.parseItems(')'));
    if (items.length === 1 && !items.trailingComma) {
      return { ...items[0], parenthesized: true };
    }
    return this.node('List', t, { items });
  }

  parseSweep(axisName) {
    const t = this.next();
    const saved = [this.noSpacedSign, this.noGreater];
    this.noSpacedSign = false;
    this.noGreater = true;
    const items = [];
    try {
      while (!this.isOp('>')) {
        if (this.atStmtEnd()) throw this.error('Sweep is missing its closing >');
        items.push(this.parseExpr());
        if (this.isOp(',')) this.next();
        else if (!this.isOp('>')) throw this.error(`Expected ',' or '>' in the sweep${this.describeFound()}`);
      }
    } finally {
      [this.noSpacedSign, this.noGreater] = saved;
    }
    this.next();
    if (!items.length) throw this.error('Sweep needs values, for example <0..5> or <H,X>', t);
    return this.node('Sweep', t, { items, axisName, site: `${t.file ? t.file + ':' : ''}${t.line}:${t.col}` });
  }

  parseString(t) {
    const { raw, line, col } = t.v;
    const parts = [];
    let lit = '';
    for (let k = 0; k < raw.length; k++) {
      const ch = raw[k];
      if (ch === '\\' && k + 1 < raw.length) {
        const nx = raw[++k];
        lit += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx;
        continue;
      }
      const dollar = ch === '$' && raw[k + 1] === '{';
      if (ch === '{' || dollar) {
        const open = dollar ? k + 1 : k;
        let d = 0;
        let end = -1;
        for (let m = open; m < raw.length; m++) {
          if (raw[m] === '{') d++;
          else if (raw[m] === '}' && --d === 0) { end = m; break; }
        }
        if (end < 0) throw new QubiError('Interpolation is missing its closing }', { line, col: col + k, file: t.file });
        const inner = raw.slice(open + 1, end);
        if (!inner.trim()) throw new QubiError('Interpolation needs an expression, as in {n}', { line, col: col + k, file: t.file });
        if (lit) parts.push(lit);
        lit = '';
        const sub = new Parser(inner, { ...this.opts, base: { line, col: col + open + 1, file: t.file } });
        const expr = sub.parseExpr();
        if (sub.peek().t !== 'eof') throw sub.error(`Unexpected text in interpolation${sub.describeFound()}`);
        parts.push(expr);
        k = end;
        continue;
      }
      lit += ch;
    }
    if (lit || !parts.length) parts.push(lit);
    return { type: 'Str', parts, raw, pos: this.pos(t), text: this.src.slice(t.s, t.e) };
  }
}

function normalizeOp(op) {
  return { or: '||', and: '&&', xor: '^^' }[op] ?? op;
}

function parseInternal(source, opts) {
  const p = new Parser(source, opts);
  const body = p.parseProgram();
  if (p.peek().t !== 'eof') throw p.error(`Unexpected ${p.describeFound().replace(/^, found /, '')}`);
  return body;
}

/**
 * @typedef {Object} ParseOptions
 * @property {string} [file] Name of the source, carried in positions.
 * @property {(path: string) => string} [resolveImport] Returns the text of an imported file.
 * @property {boolean} [recover] Collect errors per statement instead of throwing the first one.
 */

/**
 * @typedef {Object} Program
 * @property {'Program'} type
 * @property {object[]} body Statement nodes.
 * @property {Array<{severity: 'warning', message: string, pos: import('./ir.js').SourcePos}>} warnings
 * @property {QubiError[]} errors Filled only with `recover: true`.
 * @property {string} source
 */

/**
 * Parse Qubi source into an AST. `#import`/`#include` files are parsed and
 * inlined as `Import` nodes (nesting at most 20, cycles rejected).
 * @param {string} source
 * @param {ParseOptions} [opts]
 * @returns {Program}
 * @throws {QubiError} On the first syntax error unless `recover` is set.
 */
export function parseProgram(source, opts = {}) {
  const warnings = [];
  const errors = opts.recover ? [] : null;
  const importStack = opts.file ? [opts.file] : [];
  const inner = {
    resolveImport: opts.resolveImport,
    importStack,
    warnings,
    errors,
    base: opts.file ? { file: opts.file } : {},
  };
  let body = [];
  try {
    body = parseInternal(String(source), inner);
  } catch (e) {
    if (!errors || !(e instanceof QubiError)) throw e;
    errors.push(e);
  }
  return { type: 'Program', body, warnings, errors: errors ?? [], source: String(source) };
}
