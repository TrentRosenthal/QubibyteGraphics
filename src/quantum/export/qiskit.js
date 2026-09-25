/**
 * Qubi IR to the Qiskit circuit JSON schema read by `import/qiskit.js`:
 * `{num_qubits, num_clbits, instructions: [{name, qubits, params, clbits?}]}`.
 *
 * Instruction names follow Qiskit: id h x y z s sdg t tdg rx ry rz p u swap
 * iswap, cx ccx mcx, cy, cz ccz, cp mcphase, cswap, crx cry crz ch, and cu
 * (controlled U with a zero global-phase parameter). SQRTSWAP and user
 * matrices become `unitary` instructions carrying the matrix as nested
 * `[re, im]` pairs, labeled with the gate name. Anything else is decomposed
 * exactly first. Classical bits are laid out register by register in order
 * of first use.
 *
 * @module quantum/export/qiskit
 */

import { classicalRegisters, exportableOps, measurementBits } from './common.js';
import { toArray } from '../cmatrix.js';
import { gateMatrix } from '../gates.js';

/** @typedef {import('../../qubi/ir.js').Op} Op */
/** @typedef {import('../../qubi/ir.js').Circuit} Circuit */

const PLAIN = {
  I: 'id', H: 'h', X: 'x', Y: 'y', Z: 'z', S: 's', SDG: 'sdg', T: 't', TDG: 'tdg',
  RX: 'rx', RY: 'ry', RZ: 'rz', P: 'p', U: 'u', SWAP: 'swap', ISWAP: 'iswap',
};

function controlledInstruction(op) {
  const k = op.controls.length;
  switch (op.name) {
    case 'CX': return k === 1 ? 'cx' : k === 2 ? 'ccx' : 'mcx';
    case 'CZ': return k === 1 ? 'cz' : k === 2 ? 'ccz' : null;
    case 'CP': return k === 1 ? 'cp' : 'mcphase';
    case 'CY': return k === 1 ? 'cy' : null;
    case 'CSWAP': return k === 1 ? 'cswap' : null;
    case 'RX': return k === 1 ? 'crx' : null;
    case 'RY': return k === 1 ? 'cry' : null;
    case 'RZ': return k === 1 ? 'crz' : null;
    case 'H': return k === 1 ? 'ch' : null;
    case 'U': return k === 1 ? 'cu' : null;
    default: return null;
  }
}

function supports(op) {
  if (op.kind !== 'gate') return true;
  const controls = op.controls ?? [];
  if (op.matrix || op.name === 'SQRTSWAP') return controls.length === 0;
  if (op.name === 'SWAPSEQ') return false;
  if (controls.length) return controlledInstruction(op) !== null;
  return op.name in PLAIN;
}

/**
 * Writes the Qiskit JSON object.
 * @param {Circuit} circuit
 * @returns {{num_qubits: number, num_clbits: number, instructions: Array<{name: string, qubits: number[], params: any[], clbits?: number[], label?: string}>}}
 */
export function toQiskitJson(circuit) {
  const ops = exportableOps(circuit, supports, 'Qiskit JSON');
  const regs = classicalRegisters(ops);
  const offsets = new Map();
  let numClbits = 0;
  for (const [name, size] of regs) {
    offsets.set(name, numClbits);
    numClbits += size;
  }
  const instructions = [];
  for (const op of ops) {
    if (op.kind === 'barrier') {
      instructions.push({ name: 'barrier', qubits: op.targets.slice(), params: [] });
    } else if (op.kind === 'measure' || op.name === 'MEASURE') {
      for (const { wire, reg, bit } of measurementBits(op)) {
        instructions.push({ name: 'measure', qubits: [wire], params: [], clbits: [offsets.get(reg) + bit] });
      }
    } else if (op.matrix || op.name === 'SQRTSWAP') {
      const m = op.matrix ?? gateMatrix(op.name);
      instructions.push({ name: 'unitary', qubits: op.targets.slice(), params: [toArray(m)], label: op.name });
    } else {
      const controls = op.controls ?? [];
      const params = (op.params ?? []).slice();
      const name = controls.length ? controlledInstruction(op) : PLAIN[op.name];
      if (name === 'cu') params.push(0);
      instructions.push({ name, qubits: [...controls, ...op.targets], params });
    }
  }
  return { num_qubits: circuit.numQubits, num_clbits: numClbits, instructions };
}
