/**
 * Noise channels as Kraus operator sets, a readout error model, a NoiseModel
 * that attaches channels after gates, and a fidelity-versus-depth helper for
 * visualizing decoherence.
 *
 * Every channel satisfies sum K^dagger K = I (trace preserving).
 *
 * @module quantum/noise
 */

import { fromArray, kron, scale } from './cmatrix.js';
import { gateMatrix } from './gates.js';
import { DensityMatrixSimulator } from './density.js';
import { StatevectorSimulator } from './statevector.js';
import { executeCircuit } from './run.js';

/** @typedef {import('../qubi/ir.js').CMatrix} CMatrix */
/** @typedef {import('../qubi/ir.js').Circuit} Circuit */
/** @typedef {import('../qubi/ir.js').Op} Op */
/** @typedef {import('./rng.js').Rng} Rng */

/**
 * @typedef {Object} Channel
 * @property {string} name
 * @property {number} qubits 1 or 2.
 * @property {CMatrix[]} kraus
 */

function checkProbability(p, what) {
  if (!(p >= 0 && p <= 1)) throw new Error(`${what} must be between 0 and 1, got ${p}`);
}

/**
 * One-qubit depolarizing channel: rho -> (1 - p) rho + p I/2.
 * Kraus operators sqrt(1 - 3p/4) I and sqrt(p/4) X, Y, Z.
 * @param {number} p
 * @returns {Channel}
 */
export function depolarizing(p) {
  checkProbability(p, 'Depolarizing probability');
  const a = Math.sqrt(1 - (3 * p) / 4);
  const b = Math.sqrt(p / 4);
  return {
    name: 'depolarizing',
    qubits: 1,
    kraus: [scale(gateMatrix('I'), a), scale(gateMatrix('X'), b), scale(gateMatrix('Y'), b), scale(gateMatrix('Z'), b)],
  };
}

/**
 * Two-qubit depolarizing channel: rho -> (1 - p) rho + p I/4, with the 16
 * two-qubit Paulis as Kraus operators.
 * @param {number} p
 * @returns {Channel}
 */
export function depolarizing2(p) {
  checkProbability(p, 'Depolarizing probability');
  const paulis = ['I', 'X', 'Y', 'Z'].map((n) => gateMatrix(n));
  const kraus = [];
  paulis.forEach((a, i) => {
    paulis.forEach((b, j) => {
      const w = i === 0 && j === 0 ? Math.sqrt(1 - (15 * p) / 16) : Math.sqrt(p / 16);
      kraus.push(scale(kron(a, b), w));
    });
  });
  return { name: 'depolarizing2', qubits: 2, kraus };
}

/**
 * Amplitude damping (energy relaxation, T1): |1> decays to |0> with
 * probability gamma. Fixed point |0><0|.
 * @param {number} gamma
 * @returns {Channel}
 */
export function amplitudeDamping(gamma) {
  checkProbability(gamma, 'Damping probability');
  return {
    name: 'amplitudeDamping',
    qubits: 1,
    kraus: [fromArray([[1, 0], [0, Math.sqrt(1 - gamma)]]), fromArray([[0, Math.sqrt(gamma)], [0, 0]])],
  };
}

/**
 * Phase damping (pure dephasing, T2): coherences shrink by sqrt(1 - lambda),
 * populations are unchanged.
 * @param {number} lambda
 * @returns {Channel}
 */
export function phaseDamping(lambda) {
  checkProbability(lambda, 'Damping probability');
  return {
    name: 'phaseDamping',
    qubits: 1,
    kraus: [fromArray([[1, 0], [0, Math.sqrt(1 - lambda)]]), fromArray([[0, 0], [0, Math.sqrt(lambda)]])],
  };
}

/**
 * Bit flip: X with probability p.
 * @param {number} p
 * @returns {Channel}
 */
export function bitFlip(p) {
  checkProbability(p, 'Flip probability');
  return { name: 'bitFlip', qubits: 1, kraus: [scale(gateMatrix('I'), Math.sqrt(1 - p)), scale(gateMatrix('X'), Math.sqrt(p))] };
}

/**
 * Phase flip: Z with probability p.
 * @param {number} p
 * @returns {Channel}
 */
export function phaseFlip(p) {
  checkProbability(p, 'Flip probability');
  return { name: 'phaseFlip', qubits: 1, kraus: [scale(gateMatrix('I'), Math.sqrt(1 - p)), scale(gateMatrix('Z'), Math.sqrt(p))] };
}

/**
 * Classical readout error: a true 0 reads as 1 with probability `p01`, a
 * true 1 reads as 0 with probability `p10`, independently per qubit.
 */
export class ReadoutError {
  /**
   * @param {number} p01 P(read 1 | state 0)
   * @param {number} [p10=p01] P(read 0 | state 1)
   */
  constructor(p01, p10 = p01) {
    checkProbability(p01, 'Readout error p01');
    checkProbability(p10, 'Readout error p10');
    /** @type {number} */
    this.p01 = p01;
    /** @type {number} */
    this.p10 = p10;
  }

  /**
   * Applies the confusion matrix to an exact distribution over all qubits.
   * @param {ArrayLike<number>} probabilities Length 2^n.
   * @returns {Float64Array} The distribution a noisy readout would show.
   */
  apply(probabilities) {
    let cur = Float64Array.from(probabilities);
    const n = Math.round(Math.log2(cur.length));
    for (let q = 0; q < n; q++) {
      const bit = 1 << q;
      const next = new Float64Array(cur.length);
      for (let i = 0; i < cur.length; i++) {
        const flip = i & bit ? this.p10 : this.p01;
        next[i] += cur[i] * (1 - flip);
        next[i ^ bit] += cur[i] * flip;
      }
      cur = next;
    }
    return cur;
  }

  /**
   * Corrupts measured bits.
   * @param {number[]} bits
   * @param {Rng} rng
   * @returns {number[]}
   */
  corrupt(bits, rng) {
    return bits.map((b) => (rng() < (b ? this.p10 : this.p01) ? 1 - b : b));
  }
}

export class NoiseModel {
  constructor() {
    /** @type {Array<{channel: Channel, gates: Set<string>|null}>} */
    this.rules = [];
    /** @type {ReadoutError|null} */
    this.readout = null;
  }

  /**
   * Attaches a channel after gates. A one-qubit channel is applied to every
   * wire the gate touches (controls and targets). A two-qubit channel is
   * applied after gates that touch exactly two wires, on those wires.
   * @param {Channel} channel
   * @param {string[]|'all'} [gates='all'] Qubi gate names, or every gate.
   * @returns {this}
   */
  add(channel, gates = 'all') {
    this.rules.push({ channel, gates: gates === 'all' ? null : new Set(gates) });
    return this;
  }

  /**
   * @param {ReadoutError} error
   * @returns {this}
   */
  setReadout(error) {
    this.readout = error;
    return this;
  }

  /**
   * Channels to apply after a gate op, with their wires.
   * @param {Op} op
   * @returns {Array<{channel: Channel, wires: number[]}>}
   */
  channelsAfter(op) {
    if (op.kind !== 'gate') return [];
    const wires = [...(op.controls ?? []), ...(op.targets ?? [])];
    const out = [];
    for (const { channel, gates } of this.rules) {
      if (gates && !gates.has(op.name)) continue;
      if (channel.qubits === 1) {
        for (const w of wires) out.push({ channel, wires: [w] });
      } else if (channel.qubits === wires.length) {
        out.push({ channel, wires });
      }
    }
    return out;
  }
}

/**
 * Runs a circuit on a density matrix with the model's channels inserted
 * after every gate. Measurements collapse using `rng`; `if` ops branch on
 * the resulting registers.
 * @param {Circuit} circuit
 * @param {NoiseModel} model
 * @param {{rng?: Rng, seed?: number}} [options]
 * @returns {{state: DensityMatrixSimulator, registers: Record<string, number>}}
 */
export function simulateNoisy(circuit, model, options = {}) {
  const state = new DensityMatrixSimulator(circuit.numQubits, { seed: options.seed });
  const { registers } = executeCircuit(state, circuit, {
    rng: options.rng ?? state.rng,
    afterOp: (op) => {
      for (const { channel, wires } of model.channelsAfter(op)) state.applyKraus(channel.kraus, wires);
    },
  });
  return { state, registers };
}

/**
 * Fidelity of the noisy state against the ideal state as a unitary circuit
 * is repeated: entry k is <psi_k| rho_k |psi_k> after k repetitions of the
 * circuit (entry 0 is 1). Plot it to show decoherence against depth.
 * @param {Circuit} circuit A circuit of gates only (no measurements or `if`).
 * @param {NoiseModel} model
 * @param {number} steps Number of repetitions.
 * @returns {Array<{depth: number, gates: number, fidelity: number}>}
 */
export function fidelityDecay(circuit, model, steps) {
  circuit.ops.forEach((op, i) => {
    if (op.kind !== 'gate' && op.kind !== 'barrier') {
      throw new Error(`fidelityDecay needs a circuit of gates only; op ${i} is ${op.kind === 'if' ? 'an if' : op.name}`);
    }
  });
  const ideal = new StatevectorSimulator(circuit.numQubits);
  const noisy = new DensityMatrixSimulator(circuit.numQubits);
  const gatesPerStep = circuit.ops.filter((op) => op.kind === 'gate').length;
  const out = [{ depth: 0, gates: 0, fidelity: 1 }];
  const d = noisy.dim;
  for (let k = 1; k <= steps; k++) {
    for (const op of circuit.ops) {
      ideal.applyOp(op);
      noisy.applyOp(op);
      for (const { channel, wires } of model.channelsAfter(op)) noisy.applyKraus(channel.kraus, wires);
    }
    let f = 0;
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        // Re(conj(psi_i) rho_ij psi_j)
        const rr = noisy.re[i * d + j];
        const ri = noisy.im[i * d + j];
        const tr = rr * ideal.re[j] - ri * ideal.im[j];
        const ti = rr * ideal.im[j] + ri * ideal.re[j];
        f += ideal.re[i] * tr + ideal.im[i] * ti;
      }
    }
    out.push({ depth: k, gates: k * gatesPerStep, fidelity: f });
  }
  return out;
}
