/**
 * Evaluates the classical condition of an `if` op against measurement
 * registers. The IR carries conditions as source text (`IfBranch.condText`),
 * so the runner needs a small expression evaluator. It covers the Qubi
 * scalar and logic operators that make sense for classical bits:
 *
 * - literals: decimal numbers, `0b...`, `0x...`, `true`, `false`
 * - names: registers and circuit variables; `name[j]` reads bit j
 * - `+ - * / % **`, `& | ^ ~`, `== != < > <= >=`
 * - `&& and || or ^^ xor ! not`, `?:`, parentheses
 *
 * A caller that already has a full Qubi expression evaluator can replace
 * this one through the `evaluateCondition` option of the runner.
 *
 * @module quantum/condition
 */

const TOKEN = /\s*(0b[01]+|0x[0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|\*\*|&&|\|\||\^\^|==|!=|<=|>=|[-+*/%&|^~!<>()?:[\]])/y;

function tokenize(text) {
  const out = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < text.length) {
    if (/^\s*$/.test(text.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(text);
    if (!m) throw new Error(`Cannot read condition "${text}" at "${text.slice(pos).trim()}"`);
    out.push(m[1]);
    pos = TOKEN.lastIndex;
  }
  return out;
}

const WORD_OPS = { and: '&&', or: '||', xor: '^^', not: '!' };

const BINARY = [
  ['||'], ['^^'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%'],
];

/**
 * Evaluates a condition to a boolean.
 * @param {string} text Condition source text, for example `m == 1 && c[0]`.
 * @param {Record<string, number|boolean>} scope Register and variable values.
 * @returns {boolean}
 */
export function evaluateCondition(text, scope) {
  const tokens = tokenize(text).map((t) => WORD_OPS[t] ?? t);
  let i = 0;
  const peek = () => tokens[i];
  const expect = (t) => {
    if (tokens[i] !== t) throw new Error(`Condition "${text}": expected "${t}"`);
    i++;
  };
  const num = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

  function primary() {
    const t = tokens[i++];
    if (t === undefined) throw new Error(`Condition "${text}" ends early`);
    if (t === '(') {
      const v = ternary();
      expect(')');
      return v;
    }
    if (/^0b/.test(t)) return parseInt(t.slice(2), 2);
    if (/^0x/.test(t)) return parseInt(t.slice(2), 16);
    if (/^[\d.]/.test(t)) return Number(t);
    if (t === 'true') return 1;
    if (t === 'false') return 0;
    if (/^[A-Za-z_]/.test(t)) {
      if (!(t in scope)) throw new Error(`Condition "${text}": unknown name "${t}"`);
      let v = num(scope[t]);
      if (peek() === '[') {
        i++;
        const bit = ternary();
        expect(']');
        v = (v >> bit) & 1;
      }
      return v;
    }
    throw new Error(`Condition "${text}": unexpected "${t}"`);
  }

  function unary() {
    const t = peek();
    if (t === '!' || t === '-' || t === '+' || t === '~') {
      i++;
      const v = unary();
      if (t === '!') return v ? 0 : 1;
      if (t === '-') return -v;
      if (t === '~') return ~v;
      return v;
    }
    return power();
  }

  function power() {
    const base = primary();
    if (peek() === '**') {
      i++;
      return base ** unary();
    }
    return base;
  }

  function binary(level) {
    if (level === BINARY.length) return unary();
    let left = binary(level + 1);
    while (BINARY[level].includes(peek())) {
      const op = tokens[i++];
      const right = binary(level + 1);
      left = apply(op, left, right);
    }
    return left;
  }

  function apply(op, a, b) {
    switch (op) {
      case '||': return a || b ? 1 : 0;
      case '^^': return !a !== !b ? 1 : 0;
      case '&&': return a && b ? 1 : 0;
      case '|': return a | b;
      case '^': return a ^ b;
      case '&': return a & b;
      case '==': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
      case '<': return a < b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return a / b;
      default: return a % b;
    }
  }

  function ternary() {
    const cond = binary(0);
    if (peek() === '?') {
      i++;
      const a = ternary();
      expect(':');
      const b = ternary();
      return cond ? a : b;
    }
    return cond;
  }

  const v = ternary();
  if (i !== tokens.length) throw new Error(`Condition "${text}": unexpected "${tokens[i]}"`);
  return Boolean(v);
}
