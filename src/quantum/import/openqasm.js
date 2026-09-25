/**
 * OpenQASM 2 and 3 importer. Produces a Qubi IR circuit and Qubi source.
 *
 * Supported:
 * - `OPENQASM 2.0;` / `OPENQASM 3;` headers, `include "qelib1.inc";` and
 *   `include "stdgates.inc";` (their gates are built in),
 * - `qreg q[n]; creg c[n];` and `qubit[n] q; qubit q; bit[n] c; bit c;`
 *   (quantum registers are laid out on consecutive wires in declaration order),
 * - `gate name(params) a, b { ... }` definitions, expanded inline,
 * - the standard library: id h x y z s sdg t tdg sx sxdg rx ry rz p phase
 *   u1 u2 u3 u U CX cx cy cz cp cphase cu1 crx cry crz ch cu cu3 swap iswap
 *   rxx rzz ccx ccz cswap (ccx becomes `CX [c1,c2,t]`, cswap `CSWAP`, crz an
 *   exact CP plus P sequence, u3 `U`),
 * - OpenQASM 3 `ctrl @` and `ctrl(n) @` modifiers,
 * - `measure q[i] -> c[j];`, `measure q -> c;`, `c[j] = measure q[i];`,
 *   `c = measure q;` and `barrier`,
 * - whole-register arguments, which broadcast (`h q;`).
 *
 * Anything else (reset, classical `if`, loops, subroutines, classical
 * declarations, `inv @`, `pow @`, `negctrl @`, `gphase`, `opaque`) raises an
 * error naming the construct and its line.
 *
 * @module quantum/import/openqasm
 */

import { addControls, makeCircuit, mapForeignGate } from './gatemap.js';
import { emitQubi } from './emit.js';

/** @typedef {import('../../qubi/ir.js').Op} Op */
/** @typedef {import('../../qubi/ir.js').Circuit} Circuit */

const UNSUPPORTED = new Set([
  'reset', 'if', 'else', 'for', 'while', 'def', 'opaque', 'let', 'const', 'input', 'output', 'box', 'delay',
  'gphase', 'return', 'break', 'continue', 'end', 'switch', 'defcal', 'cal', 'defcalgrammar', 'extern',
  'pragma', 'int', 'uint', 'float', 'angle', 'bool', 'duration', 'stretch', 'complex', 'array', 'negctrl',
  'inv', 'pow',
]);

const DESCRIBE = {
  reset: 'reset (Qubi has no reset)',
  if: 'classical if',
  else: 'classical if',
  for: 'for loop',
  while: 'while loop',
  def: 'subroutine definition',
  opaque: 'opaque gate',
  gphase: 'gphase (global phase)',
  inv: 'inv @ modifier',
  pow: 'pow @ modifier',
  negctrl: 'negctrl @ modifier',
};

const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, ln: Math.log, sqrt: Math.sqrt,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
};

const CONSTANTS = { pi: Math.PI, 'π': Math.PI, tau: 2 * Math.PI, 'τ': 2 * Math.PI, euler: Math.E, 'ℇ': Math.E };

function lex(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const re = {
    space: /[ \t\r]+/y,
    num: /(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)/y,
    id: /[A-Za-z_πτℇ][A-Za-z0-9_]*/y,
    str: /"([^"]*)"/y,
    op: /->|\*\*|==|!=|<=|>=|&&|\|\||\+\+|[-+*/^%()[\]{};,=@<>!&|~:]/y,
  };
  const match = (r) => {
    r.lastIndex = i;
    const m = r.exec(source);
    return m && m.index === i ? m : null;
  };
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    let m;
    if ((m = match(re.space))) {
      i += m[0].length;
      continue;
    }
    if (source.startsWith('//', i)) {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      for (let k = i; k < stop; k++) if (source[k] === '\n') line++;
      i = stop;
      continue;
    }
    if ((m = match(re.num))) tokens.push({ type: 'num', value: m[0], line });
    else if ((m = match(re.str))) tokens.push({ type: 'str', value: m[1], line });
    else if ((m = match(re.id))) tokens.push({ type: 'id', value: m[0], line });
    else if ((m = match(re.op))) tokens.push({ type: 'op', value: m[0], line });
    else throw new Error(`OpenQASM line ${line}: unexpected character "${ch}"`);
    i += m[0].length;
  }
  tokens.push({ type: 'eof', value: '', line });
  return tokens;
}

class Parser {
  constructor(source) {
    this.tokens = lex(source);
    this.pos = 0;
    this.version = 2;
    /** @type {Array<{name: string, size: number, offset: number}>} */
    this.qregs = [];
    /** @type {Map<string, number>} */
    this.cregs = new Map();
    this.gates = new Map();
    /** @type {Op[]} */
    this.ops = [];
    this.numQubits = 0;
  }

  peek(k = 0) {
    return this.tokens[Math.min(this.pos + k, this.tokens.length - 1)];
  }

  next() {
    return this.tokens[this.pos++];
  }

  fail(msg, tok = this.peek(), cause = undefined) {
    throw new Error(`OpenQASM line ${tok.line}: ${msg}`, cause ? { cause } : undefined);
  }

  expect(value) {
    const t = this.next();
    if (t.value !== value || t.type === 'str') this.fail(`expected "${value}", found "${t.value || 'end of input'}"`, t);
    return t;
  }

  ident() {
    const t = this.next();
    if (t.type !== 'id') this.fail(`expected a name, found "${t.value || 'end of input'}"`, t);
    return t.value;
  }

  integer() {
    const t = this.next();
    if (t.type !== 'num' || !/^\d+$/.test(t.value)) this.fail(`expected an integer, found "${t.value}"`, t);
    return Number(t.value);
  }

  // Expressions compile to closures over a parameter environment.
  expr() {
    return this.additive();
  }

  additive() {
    let left = this.multiplicative();
    while (this.peek().value === '+' || this.peek().value === '-') {
      const op = this.next().value;
      const l = left;
      const r = this.multiplicative();
      left = op === '+' ? (env) => l(env) + r(env) : (env) => l(env) - r(env);
    }
    return left;
  }

  multiplicative() {
    let left = this.unary();
    while (this.peek().value === '*' || this.peek().value === '/') {
      const op = this.next().value;
      const l = left;
      const r = this.unary();
      left = op === '*' ? (env) => l(env) * r(env) : (env) => l(env) / r(env);
    }
    return left;
  }

  unary() {
    if (this.peek().value === '-') {
      this.next();
      const v = this.unary();
      return (env) => -v(env);
    }
    if (this.peek().value === '+') {
      this.next();
      return this.unary();
    }
    return this.power();
  }

  power() {
    const base = this.primary();
    const op = this.peek().value;
    if (op === '**' || (op === '^' && this.version === 2)) {
      this.next();
      const exp = this.unary();
      return (env) => base(env) ** exp(env);
    }
    return base;
  }

  primary() {
    const t = this.next();
    if (t.type === 'num') {
      const v = Number(t.value);
      return () => v;
    }
    if (t.value === '(') {
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (t.type === 'id') {
      if (FUNCTIONS[t.value] && this.peek().value === '(') {
        this.next();
        const arg = this.expr();
        this.expect(')');
        const f = FUNCTIONS[t.value];
        return (env) => f(arg(env));
      }
      if (t.value in CONSTANTS) {
        const v = CONSTANTS[t.value];
        return () => v;
      }
      const name = t.value;
      return (env) => {
        if (!(name in env)) throw new Error(`OpenQASM line ${t.line}: unknown parameter "${name}"`);
        return env[name];
      };
    }
    return this.fail(`unexpected "${t.value || 'end of input'}" in an expression`, t);
  }

  exprList() {
    const out = [];
    if (this.peek().value === '(') {
      this.next();
      if (this.peek().value !== ')') {
        out.push(this.expr());
        while (this.peek().value === ',') {
          this.next();
          out.push(this.expr());
        }
      }
      this.expect(')');
    }
    return out;
  }

  modifiers() {
    let controls = 0;
    for (;;) {
      const t = this.peek();
      if (t.type !== 'id') return controls;
      if (t.value === 'ctrl') {
        this.next();
        let n = 1;
        if (this.peek().value === '(') {
          this.next();
          n = this.integer();
          this.expect(')');
        }
        this.expect('@');
        controls += n;
      } else if (t.value === 'negctrl' || t.value === 'inv' || t.value === 'pow') {
        this.fail(`unsupported construct: ${DESCRIBE[t.value]}`, t);
      } else {
        return controls;
      }
    }
  }

  arg() {
    const name = this.ident();
    if (this.peek().value === '[') {
      this.next();
      const index = this.integer();
      this.expect(']');
      return { name, index };
    }
    return { name, index: null };
  }

  argList(terminator) {
    const out = [];
    if (this.peek().value === terminator) return out;
    out.push(this.arg());
    while (this.peek().value === ',') {
      this.next();
      out.push(this.arg());
    }
    return out;
  }

  qubitWires(arg, tok) {
    const reg = this.qregs.find((r) => r.name === arg.name);
    if (!reg) this.fail(`unknown quantum register "${arg.name}"`, tok);
    if (arg.index === null) return Array.from({ length: reg.size }, (_, k) => reg.offset + k);
    if (arg.index >= reg.size) this.fail(`${arg.name}[${arg.index}] is outside a register of size ${reg.size}`, tok);
    return [reg.offset + arg.index];
  }

  bitTarget(arg, tok) {
    if (!this.cregs.has(arg.name)) this.fail(`unknown classical register "${arg.name}"`, tok);
    const size = this.cregs.get(arg.name);
    if (arg.index !== null && arg.index >= size) this.fail(`${arg.name}[${arg.index}] is outside a register of size ${size}`, tok);
    return { name: arg.name, index: arg.index, size };
  }

  declareQubits(name, size, tok) {
    if (this.qregs.some((r) => r.name === name) || this.cregs.has(name)) this.fail(`"${name}" is declared twice`, tok);
    this.qregs.push({ name, size, offset: this.numQubits });
    this.numQubits += size;
  }

  declareBits(name, size, tok) {
    if (this.qregs.some((r) => r.name === name) || this.cregs.has(name)) this.fail(`"${name}" is declared twice`, tok);
    this.cregs.set(name, size);
  }

  parse() {
    if (this.peek().value === 'OPENQASM') {
      this.next();
      const v = this.next();
      this.version = Math.floor(Number(v.value));
      if (this.version !== 2 && this.version !== 3) this.fail(`OpenQASM version ${v.value} is not supported`, v);
      this.expect(';');
    }
    while (this.peek().type !== 'eof') this.statement();
  }

  statement() {
    const tok = this.peek();
    if (tok.type !== 'id') this.fail(`unexpected "${tok.value}"`, tok);
    const kw = tok.value;
    if (UNSUPPORTED.has(kw) && kw !== 'inv' && kw !== 'pow' && kw !== 'negctrl') {
      this.fail(`unsupported construct: ${DESCRIBE[kw] ?? `${kw} statement`}`, tok);
    }
    switch (kw) {
      case 'include': {
        this.next();
        const file = this.next();
        if (file.type !== 'str') this.fail('expected a file name string', file);
        if (file.value !== 'qelib1.inc' && file.value !== 'stdgates.inc') {
          this.fail(`include "${file.value}" is not supported (only qelib1.inc and stdgates.inc)`, file);
        }
        this.expect(';');
        return;
      }
      case 'qreg':
      case 'creg': {
        this.next();
        const name = this.ident();
        this.expect('[');
        const size = this.integer();
        this.expect(']');
        this.expect(';');
        if (kw === 'qreg') this.declareQubits(name, size, tok);
        else this.declareBits(name, size, tok);
        return;
      }
      case 'qubit':
      case 'bit': {
        this.next();
        let size = 1;
        if (this.peek().value === '[') {
          this.next();
          size = this.integer();
          this.expect(']');
        }
        const name = this.ident();
        if (this.peek().value === '=') this.fail('initialized bit declarations are not supported', this.peek());
        this.expect(';');
        if (kw === 'qubit') this.declareQubits(name, size, tok);
        else this.declareBits(name, size, tok);
        return;
      }
      case 'gate':
        this.gateDefinition();
        return;
      case 'measure': {
        this.next();
        const qa = this.arg();
        this.expect('->');
        const ca = this.arg();
        this.expect(';');
        this.measurement(qa, ca, tok);
        return;
      }
      case 'barrier': {
        this.next();
        const args = this.argList(';');
        this.expect(';');
        const wires = args.length ? args.flatMap((a) => this.qubitWires(a, tok)) : Array.from({ length: this.numQubits }, (_, k) => k);
        this.ops.push({ kind: 'barrier', name: 'barrier', targets: wires, controls: [], params: [] });
        return;
      }
      default:
        break;
    }
    const isAssign = this.peek(1).value === '=' || (this.peek(1).value === '[' && this.peek(4).value === '=');
    if (isAssign) {
      const ca = this.arg();
      this.expect('=');
      if (this.peek().value !== 'measure') this.fail('classical assignments are not supported', tok);
      this.next();
      const qa = this.arg();
      this.expect(';');
      this.measurement(qa, ca, tok);
      return;
    }
    this.gateCall();
  }

  measurement(qa, ca, tok) {
    const wires = this.qubitWires(qa, tok);
    const bits = this.bitTarget(ca, tok);
    if ((bits.index === null ? bits.size : 1) !== wires.length) {
      this.fail(`measure maps ${wires.length} qubit(s) onto ${bits.index === null ? bits.size : 1} bit(s)`, tok);
    }
    const register = bits.index === null ? bits.name : `${bits.name}[${bits.index}]`;
    this.ops.push({ kind: 'measure', name: 'MEASURE', targets: wires, controls: [], params: [], register });
  }

  gateDefinition() {
    const tok = this.next();
    const name = this.ident();
    const params = [];
    if (this.peek().value === '(') {
      this.next();
      if (this.peek().value !== ')') {
        params.push(this.ident());
        while (this.peek().value === ',') {
          this.next();
          params.push(this.ident());
        }
      }
      this.expect(')');
    }
    const qargs = [this.ident()];
    while (this.peek().value === ',') {
      this.next();
      qargs.push(this.ident());
    }
    this.expect('{');
    const body = [];
    while (this.peek().value !== '}') {
      const st = this.peek();
      if (st.type === 'eof') this.fail(`gate ${name} is missing "}"`, tok);
      if (st.value === 'barrier') {
        this.next();
        this.argList(';');
        this.expect(';');
        continue;
      }
      if (UNSUPPORTED.has(st.value) && st.value !== 'inv' && st.value !== 'pow' && st.value !== 'negctrl') {
        this.fail(`unsupported construct inside gate ${name}: ${DESCRIBE[st.value] ?? st.value}`, st);
      }
      const controls = this.modifiers();
      const gname = this.ident();
      const exprs = this.exprList();
      const args = [this.ident()];
      while (this.peek().value === ',') {
        this.next();
        args.push(this.ident());
      }
      this.expect(';');
      for (const a of args) if (!qargs.includes(a)) this.fail(`gate ${name}: unknown qubit argument "${a}"`, st);
      body.push({ name: gname, controls, exprs, args, tok: st });
    }
    this.expect('}');
    this.gates.set(name, { params, qargs, body });
  }

  /**
   * Expands a gate by name into Qubi ops.
   * @returns {{ops: Op[], exactPhase: boolean}}
   */
  expand(name, params, qubits, tok, depth) {
    if (depth > 64) this.fail(`gate ${name} is defined recursively`, tok);
    if (new Set(qubits).size !== qubits.length) this.fail(`gate ${name} uses a qubit twice`, tok);
    const def = this.gates.get(name);
    if (def) {
      if (def.params.length !== params.length) this.fail(`gate ${name} takes ${def.params.length} parameter(s), got ${params.length}`, tok);
      if (def.qargs.length !== qubits.length) this.fail(`gate ${name} takes ${def.qargs.length} qubit(s), got ${qubits.length}`, tok);
      const env = Object.fromEntries(def.params.map((p, k) => [p, params[k]]));
      const wire = Object.fromEntries(def.qargs.map((q, k) => [q, qubits[k]]));
      const ops = [];
      let exactPhase = true;
      for (const st of def.body) {
        const all = st.args.map((a) => wire[a]);
        const sub = this.expand(st.name, st.exprs.map((e) => e(env)), all.slice(st.controls), st.tok, depth + 1);
        if (st.controls && !sub.exactPhase) this.fail(`ctrl @ on ${st.name} would turn its dropped global phase into a relative phase`, st.tok);
        exactPhase = exactPhase && sub.exactPhase;
        ops.push(...addControls(sub.ops, all.slice(0, st.controls)));
      }
      return { ops, exactPhase };
    }
    const mappedName = name === 'U' ? 'u' : name === 'CX' ? 'cx' : name;
    try {
      return mapForeignGate(mappedName, params, qubits);
    } catch (err) {
      return this.fail(err.message, tok, err);
    }
  }

  gateCall() {
    const controls = this.modifiers();
    const nameTok = this.peek();
    const name = this.ident();
    const params = this.exprList().map((e) => e({}));
    const args = this.argList(';');
    this.expect(';');
    if (!args.length) this.fail(`gate ${name} needs qubit arguments`, nameTok);
    const lists = args.map((a) => this.qubitWires(a, nameTok));
    const width = Math.max(...lists.map((l) => l.length));
    if (lists.some((l) => l.length !== 1 && l.length !== width)) this.fail(`gate ${name}: registers of different sizes`, nameTok);
    for (let k = 0; k < width; k++) {
      const qubits = lists.map((l) => (l.length === 1 ? l[0] : l[k]));
      const sub = this.expand(name, params, qubits.slice(controls), nameTok, 0);
      if (controls && !sub.exactPhase) this.fail(`ctrl @ on ${name} would turn its dropped global phase into a relative phase`, nameTok);
      this.ops.push(...addControls(sub.ops, qubits.slice(0, controls)));
    }
  }
}

/**
 * Parses OpenQASM 2 or 3 source.
 * @param {string} source
 * @returns {{circuit: Circuit, qubi: string}}
 */
export function importOpenQasm(source) {
  const p = new Parser(source);
  p.parse();
  if (p.numQubits === 0) throw new Error('OpenQASM program declares no qubits');
  const circuit = makeCircuit(p.numQubits, p.ops);
  return { circuit, qubi: emitQubi(circuit) };
}
