/**
 * Qubi IR to Cirq JSON in the `cirq.to_json` layout (Circuit, Moment,
 * GateOperation, LineQubit), readable by `cirq.read_json` and by
 * `import/cirq.js`.
 *
 * Wire k becomes `LineQubit(k)`. Gate mapping: H HPowGate, X/Y/Z the Pauli
 * gates, S T SDG TDG P as ZPowGate with exponent angle/pi, RX RY RZ as Rx Ry
 * Rz, I IdentityGate, CX CXPowGate (two controls CCXPowGate), CZ CZPowGate
 * (two controls CCZPowGate), CP CZPowGate with exponent angle/pi, SWAP and
 * SQRTSWAP SwapPowGate (exponent 1 and 1/2), ISWAP ISwapPowGate, CSWAP
 * CSwapGate, MEASURE MeasurementGate keyed by the register (or `m0`, `m1`,
 * ...). U and anything else are decomposed exactly first. Ops are packed
 * into moments greedily in order.
 *
 * @module quantum/export/cirq
 */

import { exportableOps } from './common.js';

/** @typedef {import('../../qubi/ir.js').Op} Op */
/** @typedef {import('../../qubi/ir.js').Circuit} Circuit */

const pow = (type, exponent) => ({ cirq_type: type, exponent, global_shift: 0 });

const UNCONTROLLED = {
  H: () => pow('HPowGate', 1),
  X: () => pow('_PauliX', 1),
  Y: () => pow('_PauliY', 1),
  Z: () => pow('_PauliZ', 1),
  S: () => pow('ZPowGate', 0.5),
  SDG: () => pow('ZPowGate', -0.5),
  T: () => pow('ZPowGate', 0.25),
  TDG: () => pow('ZPowGate', -0.25),
  P: (p) => pow('ZPowGate', p[0] / Math.PI),
  RX: (p) => ({ cirq_type: 'Rx', rads: p[0] }),
  RY: (p) => ({ cirq_type: 'Ry', rads: p[0] }),
  RZ: (p) => ({ cirq_type: 'Rz', rads: p[0] }),
  I: () => ({ cirq_type: 'IdentityGate', qid_shape: [2] }),
  SWAP: () => pow('SwapPowGate', 1),
  SQRTSWAP: () => pow('SwapPowGate', 0.5),
  ISWAP: () => pow('ISwapPowGate', 1),
};

const CONTROLLED = {
  'CX:1': () => pow('CXPowGate', 1),
  'CX:2': () => pow('CCXPowGate', 1),
  'CZ:1': () => pow('CZPowGate', 1),
  'CZ:2': () => pow('CCZPowGate', 1),
  'CP:1': (p) => pow('CZPowGate', p[0] / Math.PI),
  'CSWAP:1': () => ({ cirq_type: 'CSwapGate' }),
};

function supports(op) {
  if (op.kind !== 'gate') return true;
  if (op.matrix) return false;
  const controls = op.controls ?? [];
  if (controls.length) return `${op.name}:${controls.length}` in CONTROLLED;
  return op.name in UNCONTROLLED;
}

const lineQubit = (x) => ({ cirq_type: 'LineQubit', x });

/**
 * Writes the Cirq JSON object.
 * @param {Circuit} circuit
 * @returns {{cirq_type: 'Circuit', moments: Array<{cirq_type: 'Moment', operations: object[]}>}}
 */
export function toCirqJson(circuit) {
  const ops = exportableOps(circuit, supports, 'Cirq JSON');
  const moments = [];
  let current = null;
  let used = new Set();
  let measureCount = 0;
  for (const op of ops) {
    if (op.kind === 'barrier') {
      current = null;
      continue;
    }
    const controls = op.controls ?? [];
    const wires = [...controls, ...op.targets];
    let gate;
    if (op.kind === 'measure' || op.name === 'MEASURE') {
      const key = op.register ?? `m${measureCount}`;
      measureCount++;
      gate = { cirq_type: 'MeasurementGate', num_qubits: wires.length, key, invert_mask: [] };
    } else if (controls.length) {
      gate = CONTROLLED[`${op.name}:${controls.length}`](op.params ?? []);
    } else {
      gate = UNCONTROLLED[op.name](op.params ?? []);
    }
    if (!current || wires.some((w) => used.has(w))) {
      current = { cirq_type: 'Moment', operations: [] };
      moments.push(current);
      used = new Set();
    }
    wires.forEach((w) => used.add(w));
    current.operations.push({ cirq_type: 'GateOperation', gate, qubits: wires.map(lineQubit) });
  }
  return { cirq_type: 'Circuit', moments };
}
