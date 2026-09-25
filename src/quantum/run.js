/**
 * Circuit execution: walks a Circuit's ops (including nested `if` ops) on
 * any simulator that implements `applyOp(op)` and `measure(wires, rng)`,
 * keeps classical registers, records measurements, and reports each step so
 * the animation engine can read the state after every op.
 *
 * Measurement registers: `op.register = "m"` stores the measured bits of the
 * op as an integer in `m` (the op's first target is bit 0). A register name
 * with an index, `"c[2]"`, writes the bits into register `c` starting at
 * bit 2, which is how importers map `measure q[i] -> c[j]`.
 *
 * @module quantum/run
 */

import { StatevectorSimulator } from './statevector.js';
import { evaluateCondition as defaultEvaluate } from './condition.js';
import { createRng } from './rng.js';

/** @typedef {import('../qubi/ir.js').Op} Op */
/** @typedef {import('../qubi/ir.js').Circuit} Circuit */
/** @typedef {import('./rng.js').Rng} Rng */

/**
 * @typedef {Object} MeasurementRecord
 * @property {number} step Step counter when the measurement ran.
 * @property {number[]} wires
 * @property {number[]} bits
 * @property {string} [register]
 */

/**
 * Passed to the step callback after every executed op.
 * @typedef {Object} StepInfo
 * @property {number} step Running count of executed ops, from 0.
 * @property {number} opIndex Index of the enclosing top-level op in circuit.ops.
 * @property {Op} op The op just executed (for an `if`, the op inside the chosen branch).
 * @property {any} state The simulator, after the op.
 * @property {number[]} [bits] Measured bits, for measurement ops.
 * @property {Record<string, number>} registers Classical registers so far.
 */

/**
 * @typedef {Object} RunOptions
 * @property {Rng} [rng] Randomness for measurements.
 * @property {number} [seed=1] Seed for a fresh rng when `rng` is not given.
 * @property {(info: StepInfo) => void} [onStep] Called after every executed op.
 * @property {(condText: string, scope: Record<string, number>) => boolean} [evaluateCondition]
 *   Condition evaluator for `if` ops. Defaults to the built-in one in `condition.js`.
 * @property {(op: Op, state: any) => void} [afterOp] Called after each gate op
 *   (the noise layer uses it to insert channels).
 * @property {Record<string, number>} [registers] Initial classical values.
 */

/**
 * @typedef {Object} RunResult
 * @property {Record<string, number>} registers Final classical register values.
 * @property {MeasurementRecord[]} record Every measurement, in order.
 */

/**
 * Writes measured bits into a register value.
 * @param {Record<string, number>} registers
 * @param {string} register
 * @param {number[]} bits
 */
function storeBits(registers, register, bits) {
  const m = /^(.*)\[(\d+)\]$/.exec(register);
  const name = m ? m[1] : register;
  const offset = m ? Number(m[2]) : 0;
  let value = m ? registers[name] ?? 0 : 0;
  bits.forEach((b, k) => {
    const bit = 1 << (offset + k);
    value = b ? value | bit : value & ~bit;
  });
  registers[name] = value;
}

function conditionScope(circuit, registers) {
  const scope = {};
  for (const [k, v] of Object.entries(circuit.variables ?? {})) {
    if (typeof v === 'number' || typeof v === 'boolean') scope[k] = v;
  }
  return Object.assign(scope, registers);
}

/**
 * Executes a circuit on an existing simulator.
 * @param {{applyOp: Function, measure: (wires: number[], rng?: Rng) => number[]}} sim
 * @param {Circuit|{ops: Op[], variables?: Record<string, any>}} circuit
 * @param {RunOptions} [options]
 * @returns {RunResult}
 */
export function executeCircuit(sim, circuit, options = {}) {
  const rng = options.rng ?? createRng(options.seed ?? 1);
  const evaluate = options.evaluateCondition ?? defaultEvaluate;
  const registers = { ...(options.registers ?? {}) };
  const record = [];
  let step = 0;

  const run = (ops, topIndex) => {
    ops.forEach((op, k) => {
      const opIndex = topIndex ?? k;
      if (op.kind === 'if') {
        const scope = conditionScope(circuit, registers);
        const branch = (op.branches ?? []).find((b) => evaluate(b.condText, scope));
        run(branch ? branch.ops : op.elseOps ?? [], opIndex);
        return;
      }
      let bits;
      if (op.kind === 'measure' || op.name === 'MEASURE') {
        bits = sim.measure(op.targets, rng);
        if (op.register) storeBits(registers, op.register, bits);
        record.push({ step, wires: op.targets.slice(), bits, register: op.register });
      } else {
        sim.applyOp(op, rng);
        if (options.afterOp && op.kind === 'gate') options.afterOp(op, sim);
      }
      options.onStep?.({ step, opIndex, op, state: sim, bits, registers: { ...registers } });
      step++;
    });
  };
  run(circuit.ops, undefined);
  return { registers, record };
}

/**
 * Runs a circuit on a fresh statevector simulator.
 * @param {Circuit} circuit
 * @param {RunOptions & {precision?: 'double'|'single'}} [options]
 * @returns {RunResult & {state: StatevectorSimulator}}
 */
export function runCircuit(circuit, options = {}) {
  const state = new StatevectorSimulator(circuit.numQubits, { precision: options.precision, seed: options.seed });
  const result = executeCircuit(state, circuit, { ...options, rng: options.rng ?? state.rng });
  return { state, ...result };
}

/**
 * Exact final basis-state distribution of a circuit, averaging over every
 * measurement branch (each measurement splits the state by outcome, weighted
 * by its probability, and `if` ops follow each branch's registers). Useful
 * for histograms and sweeps where sampling noise is unwanted.
 * @param {Circuit} circuit
 * @param {{maxBranches?: number, evaluateCondition?: RunOptions['evaluateCondition']}} [options]
 * @returns {Float64Array} Probability per basis index.
 */
export function outcomeDistribution(circuit, options = {}) {
  const maxBranches = options.maxBranches ?? 4096;
  const evaluate = options.evaluateCondition ?? defaultEvaluate;
  let branches = [{ sim: new StatevectorSimulator(circuit.numQubits), weight: 1, registers: {} }];

  const runOps = (ops, list) => {
    let current = list;
    for (const op of ops) {
      if (op.kind === 'if') {
        const next = [];
        for (const b of current) {
          const scope = conditionScope(circuit, b.registers);
          const branch = (op.branches ?? []).find((br) => evaluate(br.condText, scope));
          next.push(...runOps(branch ? branch.ops : op.elseOps ?? [], [b]));
        }
        current = next;
      } else if (op.kind === 'measure' || op.name === 'MEASURE') {
        for (const w of op.targets) {
          const next = [];
          for (const b of current) {
            const p1 = b.sim.probabilityOfOne(w);
            for (const outcome of [0, 1]) {
              const p = outcome ? p1 : 1 - p1;
              if (p < 1e-14) continue;
              const sim = b.sim.clone();
              sim.project(w, outcome, p);
              next.push({ sim, weight: b.weight * p, registers: { ...b.registers } });
            }
          }
          current = next;
          if (current.length > maxBranches) {
            throw new Error(`More than ${maxBranches} measurement branches; raise maxBranches or sample instead`);
          }
        }
        if (op.register) {
          // Every measured wire is now in a definite state within each branch.
          for (const b of current) {
            const bits = op.targets.map((w) => (b.sim.probabilityOfOne(w) > 0.5 ? 1 : 0));
            storeBits(b.registers, op.register, bits);
          }
        }
      } else {
        for (const b of current) b.sim.applyOp(op);
      }
    }
    return current;
  };

  branches = runOps(circuit.ops, branches);
  const out = new Float64Array(1 << circuit.numQubits);
  for (const b of branches) {
    const probs = b.sim.probabilities();
    for (let i = 0; i < out.length; i++) out[i] += b.weight * probs[i];
  }
  return out;
}
