/**
 * Display formatting for angles and conversion of a flat circuit back to
 * Qubi source.
 *
 * @module qubi/format
 */

import { GATE_INFO } from './ir.js';
import { QubiError } from './grammar.js';
import { normalizeUnit, radiansToUnit } from './settings.js';

function trimNumber(x, decimals) {
  const v = Number(x.toFixed(decimals));
  return String(Object.is(v, -0) ? 0 : v);
}

/**
 * Format an angle for display.
 * Piradians show as a multiple of π (`0.25π`, `π`, `-0.5π`, `0`), degrees with
 * a degree sign (`45°`), radians as a plain number (`0.785`).
 * @param {number} radians
 * @param {string} [unit] `piradians` (default), `degrees`, `radians`, or an alias.
 * @param {number} [decimals] Maximum decimal places, default 3; trailing zeros are dropped.
 * @returns {string}
 */
export function formatAngle(radians, unit = 'piradians', decimals = 3) {
  const u = normalizeUnit(unit);
  if (!u) throw new Error(`Unknown angle unit ${unit}: use degrees, radians, or piradians`);
  const v = radiansToUnit(radians, u);
  const text = trimNumber(v, decimals);
  if (u === 'degrees') return `${text}°`;
  if (u === 'radians') return text;
  if (text === '0') return '0';
  if (text === '1') return 'π';
  if (text === '-1') return '-π';
  return `${text}π`;
}

/** Decimal text with no exponent, readable by the Qubi lexer. */
function numText(x) {
  if (Object.is(x, -0) || x === 0) return '0';
  const s = String(x);
  if (!/e/i.test(s)) return s;
  return x.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

/** An angle as Qubi text in piradians when that is exact, else with a rad suffix. */
function angleText(r) {
  const c = Number((r / Math.PI).toPrecision(12));
  if (Math.abs(c * Math.PI - r) <= 1e-15 * Math.max(1, Math.abs(r))) return numText(c);
  return `${numText(r)}rad`;
}

const SQ = Math.SQRT1_2;

/** Matrices of the gates that have no controlled Qubi form. */
function uncontrolledMatrix(name, p) {
  const c = (re, im = 0) => [re, im];
  const e = (t) => c(Math.cos(t), Math.sin(t));
  switch (name) {
    case 'H': return [[c(SQ), c(SQ)], [c(SQ), c(-SQ)]];
    case 'U': {
      const [t, ph, la] = p;
      const cs = Math.cos(t / 2);
      const sn = Math.sin(t / 2);
      const m = (z, k) => [z[0] * k, z[1] * k];
      return [[c(cs), m(e(la), -sn)], [m(e(ph), sn), m(e(ph + la), cs)]];
    }
    case 'ISWAP': return [[c(1), c(0), c(0), c(0)], [c(0), c(0), c(0, 1), c(0)], [c(0), c(0, 1), c(0), c(0)], [c(0), c(0), c(0), c(1)]];
    case 'SQRTSWAP': {
      const a = c(0.5, 0.5);
      const b = c(0.5, -0.5);
      return [[c(1), c(0), c(0), c(0)], [c(0), a, b, c(0)], [c(0), b, a, c(0)], [c(0), c(0), c(0), c(1)]];
    }
    default: throw new QubiError(`toQubiSource: controlled ${name} has no source form`);
  }
}

function complexText([re, im]) {
  const r = Math.abs(re) < 1e-15 ? 0 : re;
  const i = Math.abs(im) < 1e-15 ? 0 : im;
  if (i === 0) return numText(r);
  if (r === 0) return `(${numText(i)}*1i)`;
  return `(${numText(r)}${i < 0 ? '-' : '+'}${numText(Math.abs(i))}*1i)`;
}

/** Controlled version of an m-qubit matrix: targets are the low bits, controls the high bits. */
function controlledMatrixText(u, k) {
  const m = u.length;
  const dim = m * 2 ** k;
  const rows = [];
  for (let r = 0; r < dim; r++) {
    const row = [];
    for (let col = 0; col < dim; col++) {
      const high = dim - m;
      if (r >= high && col >= high) row.push(complexText(u[r - high][col - high]));
      else row.push(r === col ? '1' : '0');
    }
    rows.push(row.join(' '));
  }
  return `[${rows.join('; ')}]`;
}

function cmatrixRows(m) {
  const rows = [];
  for (let r = 0; r < m.rows; r++) {
    const row = [];
    for (let c = 0; c < m.cols; c++) row.push([m.re[r * m.cols + c], m.im[r * m.cols + c]]);
    rows.push(row);
  }
  return rows;
}

function quote(text) {
  return '"' + text.replace(/[\\"{}]/g, (ch) => '\\' + ch).replace(/\n/g, '\\n') + '"';
}

const reg = (ws) => `[${ws.join(',')}]`;

/** `m[2]` and `m` both name the classical variable `m`. */
const registerName = (register) => register.replace(/\[\d+\]$/, '');

/**
 * Emit Qubi source for a flat circuit (no `if` ops). Parsing the result and
 * evaluating it reproduces the ops, with two documented exceptions that have
 * no direct Qubi form: a controlled RX, RY, or RZ becomes the exact
 * decomposition R(θ/2), controlled X or Z, R(-θ/2), controlled X or Z; and a
 * controlled H, U, ISWAP, SQRTSWAP, or user gate becomes a user matrix gate
 * whose register lists the targets and then the controls. Controlled S, T,
 * SDG, TDG become CP. Stdlib and function groups are flattened.
 * @param {import('./ir.js').Circuit} circuit
 * @returns {string}
 */
export function toQubiSource(circuit) {
  const lines = [`#settings MaxQubits ${circuit.numQubits}`];
  if (circuit.visibleQubits !== circuit.numQubits) lines.push(`#settings VisibleQubits ${circuit.visibleQubits}`);
  lines.push('#settings CodeAngleUnit piradians');
  const defs = [];
  const defined = new Map();
  let synth = 0;
  const defineMatrix = (key, name, text, qubits, extra = {}) => {
    if (defined.has(key)) return defined.get(key);
    const body = [`gate ${name} {`];
    if (extra.displayName) body.push(`\tname: ${extra.displayName}`);
    if (extra.label) body.push(`\tlabel: ${extra.label}`);
    body.push(`\tmatrix: ${text}`);
    if (extra.color) body.push(`\tcolor: ${extra.color}`);
    body.push(`\tqubits: ${qubits}`, '}');
    defs.push(body.join('\n'));
    defined.set(key, name);
    return name;
  };
  const labelsAt = new Map();
  for (const l of circuit.labels ?? []) {
    if (!labelsAt.has(l.opIndex)) labelsAt.set(l.opIndex, []);
    labelsAt.get(l.opIndex).push(l);
  }
  const body = [];
  const flushLabels = (k) => {
    for (const l of labelsAt.get(k) ?? []) body.push(`LABEL (${l.wires.join(',')}) ${quote(l.text)}`);
  };
  const ops = circuit.ops;
  for (let k = 0; k < ops.length; k++) {
    flushLabels(k);
    const op = ops[k];
    if (op.kind === 'if') throw new QubiError('toQubiSource takes a flat circuit; if ops have no source form');
    if (op.kind === 'measure') {
      if (!op.register) {
        body.push(`MEASURE ${op.targets[0]}`);
        continue;
      }
      const name = registerName(op.register);
      const wires = [op.targets[0]];
      const seen = new Set([op.register]);
      while (k + 1 < ops.length && ops[k + 1].kind === 'measure' && ops[k + 1].register
        && registerName(ops[k + 1].register) === name && !seen.has(ops[k + 1].register) && !labelsAt.has(k + 1)) {
        seen.add(ops[k + 1].register);
        wires.push(ops[++k].targets[0]);
      }
      body.push(`${name} = MEASURE (${wires.join(',')})`);
      continue;
    }
    body.push(...gateLines(op, circuit, defineMatrix, () => ++synth));
  }
  flushLabels(ops.length);
  return [...lines, ...defs, ...body].join('\n') + '\n';
}

function gateLines(op, circuit, defineMatrix, nextId) {
  const { name, targets, controls, params } = op;
  const info = GATE_INFO[name];
  const angles = (ps) => `(${ps.map(angleText).join(', ')})`;
  if (op.matrix || !info) {
    if (!op.matrix) throw new QubiError(`toQubiSource: gate ${name} has no matrix`);
    const def = circuit.gateDefs?.[name];
    const q = Math.log2(op.matrix.rows);
    const text = def?.matrixText ?? controlledMatrixText(cmatrixRows(op.matrix), 0);
    const defName = defineMatrix(`user:${name}`, name, text, q, def ? { displayName: def.displayName !== name ? def.displayName : null, label: def.label !== name ? def.label : null, color: def.color } : {});
    if (!controls.length) return [q === 1 ? `${defName} ${targets[0]}` : `${defName} ${reg(targets)}`];
    const cName = defineMatrix(`ctrl:${name}:${controls.length}`, `Ctrl_${name}_${nextId()}`, controlledMatrixText(cmatrixRows(op.matrix), controls.length), q + controls.length);
    return [`${cName} ${reg([...targets, ...controls])}`];
  }
  if (info.controlled) {
    return [`${name}${params.length ? angles(params) : ''} ${reg([...controls, ...targets])}`];
  }
  if (!controls.length) {
    if (info.targets === 2) return [`${name} ${reg(targets)}`];
    return [`${name}${params.length ? angles(params) : ''} ${targets[0]}`];
  }
  const cform = { X: 'CX', Y: 'CY', Z: 'CZ', P: 'CP', SWAP: 'CSWAP' }[name];
  if (cform) return [`${cform}${params.length ? angles(params) : ''} ${reg([...controls, ...targets])}`];
  const phase = { S: Math.PI / 2, SDG: -Math.PI / 2, T: Math.PI / 4, TDG: -Math.PI / 4 }[name];
  if (phase !== undefined) return [`CP(${angleText(phase)}) ${reg([...controls, ...targets])}`];
  if (name === 'I') return [`I ${targets[0]}`];
  if (name === 'RX' || name === 'RY' || name === 'RZ') {
    const flip = name === 'RX' ? 'CZ' : 'CX';
    const r = reg([...controls, ...targets]);
    return [
      `${name}(${angleText(params[0] / 2)}) ${targets[0]}`,
      `${flip} ${r}`,
      `${name}(${angleText(-params[0] / 2)}) ${targets[0]}`,
      `${flip} ${r}`,
    ];
  }
  const u = uncontrolledMatrix(name, params);
  const cName = defineMatrix(`ctrl:${name}:${params.join(',')}:${controls.length}`, `Ctrl_${name}_${nextId()}`, controlledMatrixText(u, controls.length), targets.length + controls.length);
  return [`${cName} ${reg([...targets, ...controls])}`];
}
