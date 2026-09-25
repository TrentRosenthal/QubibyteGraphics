/**
 * Qubi IR to OpenQASM 2.0 (qelib1.inc) and OpenQASM 3.0 (stdgates.inc).
 *
 * Wires become one register `q`. Gate mapping: I id, H h, X x, Y y, Z z,
 * S s, SDG sdg, T t, TDG tdg, RX rx, RY ry, RZ rz, P u1 (2.0) or p (3.0),
 * U u3 (2.0) or U (3.0), SWAP swap, CX cx or ccx, CY cy, CZ cz, CP cu1 or cp,
 * CSWAP cswap. ISWAP is written through a small `iswap` gate definition.
 * OpenQASM 3 writes any other controlled gate with `ctrl(n) @`. Gates with
 * no direct spelling (SQRTSWAP, user matrices, SWAPSEQ, controlled gates in
 * 2.0 beyond the list) are decomposed exactly first. Classical `if` ops are
 * not exported.
 *
 * @module quantum/export/openqasm
 */

import { classicalRegisters, exportableOps, measurementBits, piAngle } from './common.js';

/** @typedef {import('../../qubi/ir.js').Op} Op */
/** @typedef {import('../../qubi/ir.js').Circuit} Circuit */

const BASE = {
  I: 'id', H: 'h', X: 'x', Y: 'y', Z: 'z', S: 's', SDG: 'sdg', T: 't', TDG: 'tdg',
  RX: 'rx', RY: 'ry', RZ: 'rz', SWAP: 'swap', ISWAP: 'iswap',
};

const ISWAP_DEF = 'gate iswap a, b { s a; s b; h a; cx a, b; cx b, a; h b; }';

/** Named controlled gates: [Qubi name, control count] -> foreign name. */
const NAMED_CONTROLLED_2 = { 'CX:1': 'cx', 'CX:2': 'ccx', 'CY:1': 'cy', 'CZ:1': 'cz', 'CP:1': 'cu1', 'CSWAP:1': 'cswap' };
const NAMED_CONTROLLED_3 = {
  'CX:1': 'cx', 'CX:2': 'ccx', 'CY:1': 'cy', 'CZ:1': 'cz', 'CP:1': 'cp', 'CSWAP:1': 'cswap',
  'RX:1': 'crx', 'RY:1': 'cry', 'RZ:1': 'crz', 'H:1': 'ch',
};
/** Base gates of controlled names, for `ctrl @`. */
const CONTROLLED_BASE = { CX: 'x', CY: 'y', CZ: 'z', CP: 'p', CSWAP: 'swap' };

function baseName(name, version) {
  if (name === 'P') return version === 2 ? 'u1' : 'p';
  if (name === 'U') return version === 2 ? 'u3' : 'U';
  return BASE[name];
}

function supportsFor(version) {
  return (op) => {
    if (op.kind !== 'gate') return true;
    if (op.matrix || op.name === 'SWAPSEQ' || op.name === 'SQRTSWAP') return false;
    const controls = op.controls ?? [];
    if (!controls.length) return Boolean(baseName(op.name, version)) && !(op.name in CONTROLLED_BASE);
    const key = `${op.name}:${controls.length}`;
    if (version === 2) return key in NAMED_CONTROLLED_2;
    return key in NAMED_CONTROLLED_3 || Boolean(CONTROLLED_BASE[op.name] ?? baseName(op.name, 3));
  };
}

function gateText(op, version) {
  const controls = op.controls ?? [];
  const args = [...controls, ...op.targets].map((w) => `q[${w}]`).join(', ');
  const params = (op.params ?? []).length ? `(${op.params.map(piAngle).join(', ')})` : '';
  const named = (version === 2 ? NAMED_CONTROLLED_2 : NAMED_CONTROLLED_3)[`${op.name}:${controls.length}`];
  if (!controls.length) return `${baseName(op.name, version)}${params} ${args};`;
  if (named) return `${named}${params} ${args};`;
  const base = CONTROLLED_BASE[op.name] ?? baseName(op.name, 3);
  const mod = controls.length === 1 ? 'ctrl @ ' : `ctrl(${controls.length}) @ `;
  return `${mod}${base}${params} ${args};`;
}

function toOpenQasm(circuit, version) {
  const format = `OpenQASM ${version}`;
  const ops = exportableOps(circuit, supportsFor(version), format);
  const regs = classicalRegisters(ops);
  const lines = version === 2
    ? ['OPENQASM 2.0;', 'include "qelib1.inc";']
    : ['OPENQASM 3.0;', 'include "stdgates.inc";'];
  if (ops.some((op) => op.name === 'ISWAP')) lines.push(ISWAP_DEF);
  lines.push(version === 2 ? `qreg q[${circuit.numQubits}];` : `qubit[${circuit.numQubits}] q;`);
  for (const [name, size] of regs) lines.push(version === 2 ? `creg ${name}[${size}];` : `bit[${size}] ${name};`);
  for (const op of ops) {
    if (op.kind === 'barrier') {
      lines.push(`barrier ${op.targets.map((w) => `q[${w}]`).join(', ')};`);
    } else if (op.kind === 'measure' || op.name === 'MEASURE') {
      for (const { wire, reg, bit } of measurementBits(op)) {
        lines.push(version === 2 ? `measure q[${wire}] -> ${reg}[${bit}];` : `${reg}[${bit}] = measure q[${wire}];`);
      }
    } else {
      lines.push(gateText(op, version));
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Writes OpenQASM 2.0.
 * @param {Circuit} circuit
 * @returns {string}
 */
export function toOpenQasm2(circuit) {
  return toOpenQasm(circuit, 2);
}

/**
 * Writes OpenQASM 3.0.
 * @param {Circuit} circuit
 * @returns {string}
 */
export function toOpenQasm3(circuit) {
  return toOpenQasm(circuit, 3);
}
