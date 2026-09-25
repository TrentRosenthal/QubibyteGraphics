/**
 * Minimal Qubi source emitter for imported circuits. Writes one statement
 * per op using Qubi syntax from the language reference:
 *
 * - `H 0`, `H (0,1,2)` for broadcast, `RX(0.25) 0` with angles in
 *   piradians (the default CodeAngleUnit), or with a `deg` or `rad` suffix
 *   when piradians would need a long decimal (see {@link qubiAngle}),
 * - `CX [c,t]`, `CX [c1,c2,t]`, `CP(0.5) [c,t]`, `CSWAP [c,a,b]`,
 *   `SWAP [a,b]`, `MEASURE 0`, `MEASURE (0,1)`,
 * - user matrix gates as `gate NAME { matrix: [...] qubits: k }` blocks,
 * - `if cond { } elseif cond { } else { }` for classically controlled ops.
 *
 * Ops with no Qubi spelling (a controlled RY, a two-qubit user matrix with
 * controls, ...) are rewritten into exact equivalents first. Barriers have
 * no Qubi statement and are left out.
 *
 * @module quantum/import/emit
 */

import { GATE_INFO } from '../../qubi/ir.js';
import { lowerOp } from '../lower.js';

/** @typedef {import('../../qubi/ir.js').Op} Op */
/** @typedef {import('../../qubi/ir.js').Circuit} Circuit */
/** @typedef {import('../../qubi/ir.js').CMatrix} CMatrix */

const CONTROLLED = new Set(['CX', 'CY', 'CZ', 'CP', 'CSWAP']);

/**
 * Formats an angle in radians for Qubi source: a short decimal in piradians
 * (the default CodeAngleUnit, so no suffix) when one is exact, else a short
 * decimal in degrees (`60deg` for pi/3), else full-precision radians (`rad`).
 * @param {number} radians
 * @returns {string}
 */
export function qubiAngle(radians) {
  const short = (x) => {
    const r = Math.round(x * 1e6) / 1e6;
    return Math.abs(x - r) < 1e-11 * Math.max(1, Math.abs(x)) ? String(Object.is(r, -0) ? 0 : r) : null;
  };
  const pi = short(radians / Math.PI);
  if (pi !== null) return pi;
  const deg = short((radians * 180) / Math.PI);
  if (deg !== null) return `${deg}deg`;
  return `${radians}rad`;
}

function number(x) {
  const v = Math.abs(x) < 1e-15 ? 0 : x;
  return String(v);
}

function complexEntry(re, im) {
  const r = Math.abs(re) < 1e-15 ? 0 : re;
  const i = Math.abs(im) < 1e-15 ? 0 : im;
  if (i === 0) return number(r);
  if (r === 0) return `${number(i)}*1i`;
  return `(${number(r)}${i < 0 ? '-' : '+'}${number(Math.abs(i))}*1i)`;
}

/**
 * Qubi matrix literal: `[a b; c d]`.
 * @param {CMatrix} m
 * @returns {string}
 */
function matrixLiteral(m) {
  const rows = [];
  for (let i = 0; i < m.rows; i++) {
    const row = [];
    for (let j = 0; j < m.cols; j++) row.push(complexEntry(m.re[i * m.cols + j], m.im[i * m.cols + j]));
    rows.push(row.join(' '));
  }
  return `[${rows.join('; ')}]`;
}

function qubiSupports(op) {
  const controls = op.controls ?? [];
  if (op.matrix) return controls.length === 0;
  if (op.name === 'SWAPSEQ') return false;
  const info = GATE_INFO[op.name];
  if (!info) return false;
  if (CONTROLLED.has(op.name)) return controls.length >= 1;
  return controls.length === 0;
}

function wireList(wires) {
  return wires.length === 1 ? String(wires[0]) : `(${wires.join(',')})`;
}

/**
 * Qubi statement for one native gate op (already lowered).
 * @param {Op} op
 * @returns {string}
 */
function gateLine(op) {
  const params = op.params ?? [];
  const head = params.length ? `${op.name}(${params.map(qubiAngle).join(', ')})` : op.name;
  const controls = op.controls ?? [];
  const jointTargets = op.matrix ? op.targets.length > 1 : GATE_INFO[op.name].targets !== 1;
  if (controls.length || jointTargets) return `${head} [${[...controls, ...op.targets].join(',')}]`;
  return `${head} ${wireList(op.targets)}`;
}

/**
 * Converts a circuit to Qubi source text.
 * @param {Circuit|{numQubits: number, ops: Op[]}} circuit
 * @returns {string}
 */
export function emitQubi(circuit) {
  const lines = [`#settings MaxQubits ${circuit.numQubits}`];
  const defs = new Map();
  const body = [];
  const defineMatrix = (op) => {
    let name = op.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!/^[A-Z_]/.test(name) || GATE_INFO[name]) name = `G_${name}`;
    const literal = matrixLiteral(op.matrix);
    let unique = name;
    for (let k = 2; defs.has(unique) && defs.get(unique).literal !== literal; k++) unique = `${name}_${k}`;
    if (!defs.has(unique)) defs.set(unique, { literal, qubits: op.targets.length });
    return unique;
  };
  const emitOps = (ops, indent) => {
    for (const op of ops) {
      if (op.kind === 'barrier') continue;
      if (op.kind === 'measure' || op.name === 'MEASURE') {
        body.push(`${indent}MEASURE ${wireList(op.targets)}`);
        continue;
      }
      if (op.kind === 'if') {
        op.branches.forEach((b, i) => {
          body.push(`${indent}${i === 0 ? 'if' : '} elseif'} ${b.condText} {`);
          emitOps(b.ops, indent + '\t');
        });
        if (op.elseOps && op.elseOps.length) {
          body.push(`${indent}} else {`);
          emitOps(op.elseOps, indent + '\t');
        }
        body.push(`${indent}}`);
        continue;
      }
      for (const low of lowerOp(op, qubiSupports, 'Qubi')) {
        if (low.matrix) {
          const name = defineMatrix(low);
          body.push(indent + gateLine({ ...low, name, params: [] }));
        } else {
          body.push(indent + gateLine(low));
        }
      }
    }
  };
  emitOps(circuit.ops, '');
  for (const [name, def] of defs) {
    lines.push('', `gate ${name} {`, `\tname: ${name}`, `\tmatrix: ${def.literal}`, `\tqubits: ${def.qubits}`, '}');
  }
  lines.push('', ...body);
  return lines.join('\n') + '\n';
}
