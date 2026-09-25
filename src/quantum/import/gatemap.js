/**
 * Maps gate names from other frameworks (OpenQASM's standard library and
 * Qiskit's instruction names) onto Qubi IR ops. Foreign names appear only in
 * this directory and in `export/`.
 *
 * Qubits are listed controls first, then targets, as in OpenQASM and Qiskit.
 * Gates without a single Qubi equivalent become exact Qubi sequences, for
 * example crz(t) is `CP(t) [c,t]` followed by `P(-t/2) c`.
 *
 * @module quantum/import/gatemap
 */

import { decomposeControlled, gateOp } from '../decompose.js';
import { controlledName } from '../lower.js';
import { gateMatrix } from '../gates.js';

/** @typedef {import('../../qubi/ir.js').Op} Op */
/** @typedef {import('../../qubi/ir.js').Circuit} Circuit */

/**
 * @typedef {Object} MappedGate
 * @property {Op[]} ops
 * @property {boolean} exactPhase False when a global phase was dropped (for
 *   example sx is RX(pi/2) up to phase); such gates cannot take extra controls.
 */

const HALF = Math.PI / 2;

/**
 * Table entry: [qubit count, param count, builder(qubits, params) -> ops, exactPhase].
 * @type {Record<string, [number, number, (q: number[], p: number[]) => Op[], boolean?]>}
 */
const TABLE = {
  id: [1, 0, (q) => [gateOp('I', q)]],
  i: [1, 0, (q) => [gateOp('I', q)]],
  h: [1, 0, (q) => [gateOp('H', q)]],
  x: [1, 0, (q) => [gateOp('X', q)]],
  y: [1, 0, (q) => [gateOp('Y', q)]],
  z: [1, 0, (q) => [gateOp('Z', q)]],
  s: [1, 0, (q) => [gateOp('S', q)]],
  sdg: [1, 0, (q) => [gateOp('SDG', q)]],
  t: [1, 0, (q) => [gateOp('T', q)]],
  tdg: [1, 0, (q) => [gateOp('TDG', q)]],
  sx: [1, 0, (q) => [gateOp('RX', q, [HALF])], false],
  sxdg: [1, 0, (q) => [gateOp('RX', q, [-HALF])], false],
  rx: [1, 1, (q, p) => [gateOp('RX', q, p)]],
  ry: [1, 1, (q, p) => [gateOp('RY', q, p)]],
  rz: [1, 1, (q, p) => [gateOp('RZ', q, p)]],
  p: [1, 1, (q, p) => [gateOp('P', q, p)]],
  phase: [1, 1, (q, p) => [gateOp('P', q, p)]],
  u1: [1, 1, (q, p) => [gateOp('P', q, p)]],
  u2: [1, 2, (q, p) => [gateOp('U', q, [HALF, p[0], p[1]])]],
  u3: [1, 3, (q, p) => [gateOp('U', q, p)]],
  u: [1, 3, (q, p) => [gateOp('U', q, p)]],
  cx: [2, 0, (q) => [gateOp('CX', [q[1]], [], [q[0]])]],
  cnot: [2, 0, (q) => [gateOp('CX', [q[1]], [], [q[0]])]],
  cy: [2, 0, (q) => [gateOp('CY', [q[1]], [], [q[0]])]],
  cz: [2, 0, (q) => [gateOp('CZ', [q[1]], [], [q[0]])]],
  cp: [2, 1, (q, p) => [gateOp('CP', [q[1]], p, [q[0]])]],
  cphase: [2, 1, (q, p) => [gateOp('CP', [q[1]], p, [q[0]])]],
  cu1: [2, 1, (q, p) => [gateOp('CP', [q[1]], p, [q[0]])]],
  crz: [2, 1, (q, p) => [gateOp('CP', [q[1]], [p[0]], [q[0]]), gateOp('P', [q[0]], [-p[0] / 2])]],
  cry: [2, 1, (q, p) => [
    gateOp('RY', [q[1]], [p[0] / 2]), gateOp('CX', [q[1]], [], [q[0]]),
    gateOp('RY', [q[1]], [-p[0] / 2]), gateOp('CX', [q[1]], [], [q[0]]),
  ]],
  crx: [2, 1, (q, p) => [
    gateOp('S', [q[1]]),
    gateOp('RY', [q[1]], [p[0] / 2]), gateOp('CX', [q[1]], [], [q[0]]),
    gateOp('RY', [q[1]], [-p[0] / 2]), gateOp('CX', [q[1]], [], [q[0]]),
    gateOp('SDG', [q[1]]),
  ]],
  ch: [2, 0, (q) => [gateOp('RY', [q[1]], [-Math.PI / 4]), gateOp('CZ', [q[1]], [], [q[0]]), gateOp('RY', [q[1]], [Math.PI / 4])]],
  cu: [2, 4, (q, p) => [
    ...decomposeControlled(gateMatrix('U', p.slice(0, 3)), q[0], q[1]),
    ...(p[3] ? [gateOp('P', [q[0]], [p[3]])] : []),
  ]],
  cu3: [2, 3, (q, p) => decomposeControlled(gateMatrix('U', p), q[0], q[1])],
  swap: [2, 0, (q) => [gateOp('SWAP', q)]],
  iswap: [2, 0, (q) => [gateOp('ISWAP', q)]],
  rzz: [2, 1, (q, p) => [gateOp('CX', [q[1]], [], [q[0]]), gateOp('RZ', [q[1]], p), gateOp('CX', [q[1]], [], [q[0]])]],
  rxx: [2, 1, (q, p) => [
    gateOp('H', [q[0]]), gateOp('H', [q[1]]),
    gateOp('CX', [q[1]], [], [q[0]]), gateOp('RZ', [q[1]], p), gateOp('CX', [q[1]], [], [q[0]]),
    gateOp('H', [q[0]]), gateOp('H', [q[1]]),
  ]],
  ccx: [3, 0, (q) => [gateOp('CX', [q[2]], [], [q[0], q[1]])]],
  toffoli: [3, 0, (q) => [gateOp('CX', [q[2]], [], [q[0], q[1]])]],
  ccz: [3, 0, (q) => [gateOp('CZ', [q[2]], [], [q[0], q[1]])]],
  cswap: [3, 0, (q) => [gateOp('CSWAP', [q[1], q[2]], [], [q[0]])]],
  fredkin: [3, 0, (q) => [gateOp('CSWAP', [q[1], q[2]], [], [q[0]])]],
};

/** Gates whose qubit count is set by the call: the last qubit is the target. */
const VARIADIC = {
  mcx: (q) => [gateOp('CX', [q[q.length - 1]], [], q.slice(0, -1))],
  mcphase: (q, p) => [gateOp('CP', [q[q.length - 1]], p, q.slice(0, -1))],
};

/**
 * Maps a foreign gate call to Qubi ops.
 * @param {string} name Gate name as written in the source format (case-insensitive).
 * @param {number[]} params Angles in radians.
 * @param {number[]} qubits Wire numbers, controls first.
 * @returns {MappedGate}
 */
export function mapForeignGate(name, params, qubits) {
  const n = name.toLowerCase();
  if (VARIADIC[n]) {
    if (qubits.length < 2) throw new Error(`Gate ${name} needs at least 2 qubits`);
    return { ops: VARIADIC[n](qubits, params), exactPhase: true };
  }
  const entry = TABLE[n];
  if (!entry) throw new Error(`Unsupported gate "${name}"`);
  const [nq, np, build, exact = true] = entry;
  if (qubits.length !== nq) throw new Error(`Gate ${name} takes ${nq} qubit(s), got ${qubits.length}`);
  if (params.length !== np) throw new Error(`Gate ${name} takes ${np} parameter(s), got ${params.length}`);
  return { ops: build(qubits, params), exactPhase: exact };
}

/**
 * Adds control wires to every op of a sequence (a controlled sequence is
 * the sequence of controlled ops).
 * @param {Op[]} ops
 * @param {number[]} controls
 * @returns {Op[]}
 */
export function addControls(ops, controls) {
  if (!controls.length) return ops;
  return ops.map((op) => {
    if (op.kind !== 'gate') throw new Error('Only gates can be controlled');
    const base = op.controls.length ? op.name : controlledName(op.name);
    return { ...op, name: base, controls: [...controls, ...op.controls] };
  });
}

/**
 * Wraps ops in a Circuit with empty display metadata.
 * @param {number} numQubits
 * @param {Op[]} ops
 * @param {Record<string, any>} [gateDefs]
 * @returns {Circuit}
 */
export function makeCircuit(numQubits, ops, gateDefs = {}) {
  return {
    numQubits,
    visibleQubits: numQubits,
    ops,
    labels: [],
    annotations: [],
    loops: [],
    sweeps: [],
    settings: {},
    gateDefs,
    variables: {},
    diagnostics: [],
  };
}
