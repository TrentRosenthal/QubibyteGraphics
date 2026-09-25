/**
 * Qiskit circuit importer for a simple JSON schema:
 *
 * ```
 * {
 *   "num_qubits": 3,
 *   "num_clbits": 3,
 *   "instructions": [
 *     {"name": "h", "qubits": [0], "params": []},
 *     {"name": "cx", "qubits": [0, 1], "params": []},
 *     {"name": "unitary", "qubits": [2], "params": [[[1, 0], [0, 0]], [[0, 0], [0, 1]]]], "label": "V"},
 *     {"name": "measure", "qubits": [0], "clbits": [0]}
 *   ]
 * }
 * ```
 *
 * This is what a few lines of Python produce from a QuantumCircuit
 * (`[{"name": i.operation.name, "qubits": [qc.find_bit(q).index for q in i.qubits],
 * "params": [float(p) for p in i.operation.params], ...} for i in qc.data]`).
 * Qubit indices use Qiskit's convention, which matches Qubi: qubit 0 is the
 * least significant bit. Instruction names follow Qiskit (h, cx, ccx, mcx,
 * cp, mcphase, crz, cu, u, unitary, ...). A `unitary` instruction carries its
 * matrix as nested `[re, im]` pairs (or plain numbers) in `params[0]`.
 *
 * Binary QPY files are not parsed. QPY is a versioned binary format whose
 * layout changes between Qiskit releases and which serializes Python-side
 * objects (parameter expressions via symengine, custom instruction payloads);
 * reading it correctly means tracking every QPY version, which a browser
 * importer cannot keep up with. Export the JSON above (or OpenQASM) instead.
 *
 * @module quantum/import/qiskit
 */

import { fromArray } from '../cmatrix.js';
import { makeCircuit, mapForeignGate } from './gatemap.js';
import { emitQubi } from './emit.js';

/** @typedef {import('../../qubi/ir.js').Op} Op */
/** @typedef {import('../../qubi/ir.js').Circuit} Circuit */

function isBinary(input) {
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) return true;
  return typeof input === 'string' && input.startsWith('QISKIT');
}

function toMatrix(raw, where) {
  if (!Array.isArray(raw) || !raw.every(Array.isArray)) throw new Error(`${where}: unitary params[0] must be a matrix`);
  return fromArray(raw.map((row) => row.map((v) => (v && typeof v === 'object' && 'real' in v ? [v.real, v.imag ?? 0] : v))));
}

/**
 * Imports a Qiskit circuit in the JSON schema above.
 * @param {string|object} input JSON text or the parsed object.
 * @returns {{circuit: Circuit, qubi: string}}
 */
export function importQiskit(input) {
  if (isBinary(input)) {
    throw new Error('Binary QPY is not parsed; export the circuit as Qiskit JSON ({num_qubits, instructions}) or OpenQASM instead');
  }
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!data || !Number.isInteger(data.num_qubits) || !Array.isArray(data.instructions)) {
    throw new Error('Qiskit JSON needs an integer "num_qubits" and an "instructions" array');
  }
  const n = data.num_qubits;
  const ops = [];
  data.instructions.forEach((ins, k) => {
    const where = `Qiskit instruction ${k} (${ins.name})`;
    const qubits = ins.qubits ?? [];
    for (const q of qubits) {
      if (!Number.isInteger(q) || q < 0 || q >= n) throw new Error(`${where}: qubit ${q} is outside 0..${n - 1}`);
    }
    const name = String(ins.name).toLowerCase();
    if (name === 'measure') {
      const clbits = ins.clbits ?? qubits;
      if (clbits.length !== qubits.length) throw new Error(`${where}: needs one clbit per qubit`);
      qubits.forEach((q, j) => {
        ops.push({ kind: 'measure', name: 'MEASURE', targets: [q], controls: [], params: [], register: `c[${clbits[j]}]` });
      });
      return;
    }
    if (name === 'barrier') {
      ops.push({ kind: 'barrier', name: 'barrier', targets: qubits.slice(), controls: [], params: [] });
      return;
    }
    if (name === 'reset') throw new Error(`${where}: reset is not representable in Qubi`);
    if (name === 'unitary') {
      const matrix = toMatrix((ins.params ?? [])[0], where);
      if (matrix.rows !== 1 << qubits.length) throw new Error(`${where}: matrix size does not match ${qubits.length} qubit(s)`);
      ops.push({ kind: 'gate', name: String(ins.label ?? 'UNITARY').toUpperCase(), targets: qubits.slice(), controls: [], params: [], matrix });
      return;
    }
    const params = (ins.params ?? []).map((p) => {
      const v = Number(p);
      if (!Number.isFinite(v)) throw new Error(`${where}: parameter ${JSON.stringify(p)} is not a bound number`);
      return v;
    });
    try {
      ops.push(...mapForeignGate(name, params, qubits).ops);
    } catch (err) {
      throw new Error(`${where}: ${err.message}`, { cause: err });
    }
  });
  const circuit = makeCircuit(n, ops);
  return { circuit, qubi: emitQubi(circuit) };
}
