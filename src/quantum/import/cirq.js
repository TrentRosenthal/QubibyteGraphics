/**
 * Cirq importer for the JSON that `cirq.to_json(circuit)` writes:
 * a `Circuit` of `Moment`s of `GateOperation`s, each with a `gate` and a
 * list of `qubits`.
 *
 * Qubits: when every qubit is a `LineQubit`, `LineQubit(k)` becomes wire k.
 * Otherwise (GridQubit, NamedQubit, or a mix) qubits are sorted the way Cirq
 * sorts them and numbered from 0. Wire identity is all that matters here:
 * Cirq prints state vectors with its first qubit as the most significant
 * bit, while Qubi labels put wire 0 last, but the gates act on the same
 * qubits either way.
 *
 * Gates and exponent mapping (t is the exponent):
 * - `HPowGate`: t = 1 is H; otherwise RY(-pi/4) P(pi t) RY(pi/4), which is
 *   H^t up to global phase.
 * - `XPowGate` / `_PauliX`, `YPowGate` / `_PauliY`: t = 1 is X / Y; otherwise
 *   RX(pi t) / RY(pi t) (equal up to global phase).
 * - `ZPowGate` / `_PauliZ`: exactly P(pi t); t = 1, 1/2, -1/2, 1/4, -1/4 give
 *   Z, S, SDG, T, TDG.
 * - `Rx`, `Ry`, `Rz` (`rads`): RX, RY, RZ.
 * - `CZPowGate`: t = 1 is CZ, otherwise exactly CP(pi t).
 * - `CXPowGate` (`CNotPowGate`): t = 1 is CX, otherwise exactly H, CP(pi t), H on the target.
 * - `SwapPowGate`: t = 1 is SWAP, t = 1/2 is SQRTSWAP. `ISwapPowGate`: t = 1 is ISWAP.
 * - `CCXPowGate`, `CCZPowGate` (t = 1): `CX [c1,c2,t]`, `CZ [c1,c2,t]`. `CSwapGate`: CSWAP.
 * - `IdentityGate`: I. `MeasurementGate`: MEASURE with the key as register.
 *
 * `global_shift` only multiplies an uncontrolled gate operation by a global
 * phase, so it is ignored. Other gates raise an error naming the gate.
 *
 * @module quantum/import/cirq
 */

import { gateOp } from '../decompose.js';
import { makeCircuit } from './gatemap.js';
import { emitQubi } from './emit.js';

/** @typedef {import('../../qubi/ir.js').Op} Op */
/** @typedef {import('../../qubi/ir.js').Circuit} Circuit */

const Z_NAMES = [[1, 'Z'], [0.5, 'S'], [-0.5, 'SDG'], [0.25, 'T'], [-0.25, 'TDG']];

function qubitKey(q) {
  switch (q.cirq_type) {
    case 'LineQubit': return [0, q.x, 0, ''];
    case 'GridQubit': return [1, q.row, q.col, ''];
    case 'NamedQubit': return [2, 0, 0, q.name];
    default: throw new Error(`Unsupported Cirq qubit type "${q.cirq_type}"`);
  }
}

function compareKeys(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0;
}

const near = (a, b) => Math.abs(a - b) < 1e-12;

function exponentOf(gate) {
  const t = gate.exponent ?? 1;
  if (typeof t !== 'number') throw new Error(`${gate.cirq_type}: symbolic exponents are not supported`);
  return t;
}

/**
 * Maps one Cirq gate on the given wires to Qubi ops.
 * @param {any} gate
 * @param {number[]} w
 * @returns {Op[]}
 */
function mapGate(gate, w) {
  const type = gate.cirq_type;
  const arity = (k) => {
    if (w.length !== k) throw new Error(`${type} acts on ${k} qubit(s), got ${w.length}`);
  };
  switch (type) {
    case 'HPowGate': {
      arity(1);
      const t = exponentOf(gate);
      if (near(t, 1)) return [gateOp('H', w)];
      return [gateOp('RY', w, [-Math.PI / 4]), gateOp('P', w, [Math.PI * t]), gateOp('RY', w, [Math.PI / 4])];
    }
    case 'XPowGate': case '_PauliX': case 'YPowGate': case '_PauliY': {
      arity(1);
      const t = exponentOf(gate);
      const axis = type.includes('X') ? 'X' : 'Y';
      return [near(t, 1) ? gateOp(axis, w) : gateOp('R' + axis, w, [Math.PI * t])];
    }
    case 'ZPowGate': case '_PauliZ': {
      arity(1);
      const t = exponentOf(gate);
      const named = Z_NAMES.find(([v]) => near(v, t));
      return [named ? gateOp(named[1], w) : gateOp('P', w, [Math.PI * t])];
    }
    case 'Rx': case 'Ry': case 'Rz':
      arity(1);
      return [gateOp('R' + type[1].toUpperCase(), w, [gate.rads])];
    case 'IdentityGate':
      return w.map((q) => gateOp('I', [q]));
    case 'CZPowGate': {
      arity(2);
      const t = exponentOf(gate);
      return [near(t, 1) ? gateOp('CZ', [w[1]], [], [w[0]]) : gateOp('CP', [w[1]], [Math.PI * t], [w[0]])];
    }
    case 'CXPowGate': case 'CNotPowGate': {
      arity(2);
      const t = exponentOf(gate);
      if (near(t, 1)) return [gateOp('CX', [w[1]], [], [w[0]])];
      return [gateOp('H', [w[1]]), gateOp('CP', [w[1]], [Math.PI * t], [w[0]]), gateOp('H', [w[1]])];
    }
    case 'SwapPowGate': {
      arity(2);
      const t = exponentOf(gate);
      if (near(t, 1)) return [gateOp('SWAP', w)];
      if (near(t, 0.5)) return [gateOp('SQRTSWAP', w)];
      throw new Error(`SwapPowGate with exponent ${t} has no Qubi equivalent`);
    }
    case 'ISwapPowGate': {
      arity(2);
      const t = exponentOf(gate);
      if (near(t, 1)) return [gateOp('ISWAP', w)];
      throw new Error(`ISwapPowGate with exponent ${t} has no Qubi equivalent`);
    }
    case 'CCXPowGate': case 'CCZPowGate': {
      arity(3);
      const t = exponentOf(gate);
      if (!near(t, 1)) throw new Error(`${type} with exponent ${t} has no Qubi equivalent`);
      return [gateOp(type === 'CCXPowGate' ? 'CX' : 'CZ', [w[2]], [], [w[0], w[1]])];
    }
    case 'CSwapGate':
      arity(3);
      return [gateOp('CSWAP', [w[1], w[2]], [], [w[0]])];
    default:
      throw new Error(`Unsupported Cirq gate "${type}"`);
  }
}

/**
 * Imports a circuit from `cirq.to_json` output.
 * @param {string|object} input JSON text or the parsed object.
 * @returns {{circuit: Circuit, qubi: string}}
 */
export function importCirq(input) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!data || data.cirq_type !== 'Circuit' || !Array.isArray(data.moments)) {
    throw new Error('Cirq JSON must be a {"cirq_type": "Circuit", "moments": [...]} object');
  }
  const operations = [];
  for (const moment of data.moments) {
    if (moment.cirq_type !== 'Moment') throw new Error(`Expected a Moment, found "${moment.cirq_type}"`);
    for (const op of moment.operations ?? []) {
      if (op.cirq_type !== 'GateOperation') throw new Error(`Unsupported Cirq operation "${op.cirq_type}"`);
      operations.push(op);
    }
  }
  const keys = new Map();
  for (const op of operations) for (const q of op.qubits) keys.set(JSON.stringify(qubitKey(q)), qubitKey(q));
  const allLine = [...keys.values()].every((k) => k[0] === 0 && k[1] >= 0);
  const sorted = [...keys.values()].sort(compareKeys);
  const wireOf = new Map(sorted.map((k, i) => [JSON.stringify(k), allLine ? k[1] : i]));
  const numQubits = allLine ? Math.max(0, ...sorted.map((k) => k[1] + 1)) : sorted.length;
  if (numQubits === 0) throw new Error('Cirq circuit has no qubits');
  const ops = [];
  let measureCount = 0;
  for (const op of operations) {
    const wires = op.qubits.map((q) => wireOf.get(JSON.stringify(qubitKey(q))));
    const gate = op.gate;
    if (gate.cirq_type === 'MeasurementGate') {
      if ((gate.invert_mask ?? []).some(Boolean)) throw new Error('MeasurementGate with an invert_mask is not supported');
      const key = typeof gate.key === 'string' ? gate.key : gate.key?.name ?? `m${measureCount}`;
      measureCount++;
      ops.push({ kind: 'measure', name: 'MEASURE', targets: wires, controls: [], params: [], register: key });
      continue;
    }
    ops.push(...mapGate(gate, wires));
  }
  const circuit = makeCircuit(numQubits, ops);
  return { circuit, qubi: emitQubi(circuit) };
}
