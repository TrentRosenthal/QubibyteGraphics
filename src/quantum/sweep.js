/**
 * Parametric sweep analysis. The Qubi evaluator's `enumerateSweep` yields
 * one `{assignment, circuit}` point per combination of sweep values; this
 * module runs each circuit exactly (measurement branches are averaged, not
 * sampled) and reports plot-ready numbers.
 *
 * Two modes:
 * - `pattern`: probability that the final state matches a bitstring pattern.
 *   The pattern is MSB first (rightmost character is qubit 0) and may use
 *   `?` or `x` as a wildcard, for example `1?0`. A pattern shorter than the
 *   register leaves the high qubits free. Without an explicit pattern, the
 *   circuit's `sweepstate` variable is used.
 * - `highest`: the most probable basis state per point and its probability.
 *
 * @module quantum/sweep
 */

import { outcomeDistribution } from './run.js';

/** @typedef {import('../qubi/ir.js').Circuit} Circuit */

/**
 * @typedef {Object} SweepPoint
 * @property {Record<string, number|string>} assignment Sweep variable values.
 * @property {Circuit} circuit
 */

/**
 * @typedef {Object} SweepResultPoint
 * @property {number} index Position in the input list.
 * @property {Record<string, number|string>} assignment
 * @property {string} label For axis ticks, for example `a=0.5, g=H`.
 * @property {number} probability
 * @property {string} state In pattern mode the pattern used; in highest mode the winning bitstring.
 */

/**
 * @typedef {Object} SweepResult
 * @property {'pattern'|'highest'} mode
 * @property {string[]} axes Names of the swept variables.
 * @property {SweepResultPoint[]} points
 * @property {{x: Array<number|string>, y: number[]}|null} series Ready for a line or bar
 *   chart when exactly one variable is swept; null otherwise.
 */

/**
 * Turns a pattern value into mask/value form.
 * @param {string|number} pattern
 * @param {number} numQubits
 * @returns {{mask: number, value: number, text: string}}
 */
export function parsePattern(pattern, numQubits) {
  let text;
  if (typeof pattern === 'number') {
    if (!Number.isInteger(pattern) || pattern < 0) throw new Error(`Sweep pattern must be a non-negative integer, got ${pattern}`);
    text = pattern.toString(2).padStart(numQubits, '0');
  } else if (typeof pattern === 'string') {
    text = pattern.trim().replace(/^0b/i, '');
  } else {
    throw new TypeError(`Sweep pattern must be a bitstring or an integer, got ${typeof pattern}`);
  }
  if (!/^[01?xX]+$/.test(text)) throw new Error(`Sweep pattern "${pattern}" may contain only 0, 1, ? and x`);
  if (text.length > numQubits) throw new Error(`Sweep pattern "${pattern}" is longer than ${numQubits} qubits`);
  let mask = 0;
  let value = 0;
  for (let k = 0; k < text.length; k++) {
    const q = text.length - 1 - k;
    const ch = text[k];
    if (ch === '0' || ch === '1') {
      mask |= 1 << q;
      if (ch === '1') value |= 1 << q;
    }
  }
  return { mask, value, text };
}

function labelOf(assignment) {
  return Object.entries(assignment)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

/**
 * Evaluates every sweep point.
 * @param {Iterable<SweepPoint>} points
 * @param {{mode?: 'pattern'|'highest', pattern?: string|number}} [options]
 * @returns {SweepResult}
 */
export function sweepProbabilities(points, options = {}) {
  const mode = options.mode ?? 'pattern';
  if (mode !== 'pattern' && mode !== 'highest') throw new Error(`Sweep mode must be "pattern" or "highest", got "${mode}"`);
  const list = [...points];
  const axes = [];
  for (const p of list) for (const k of Object.keys(p.assignment ?? {})) if (!axes.includes(k)) axes.push(k);
  const out = list.map((point, index) => {
    const { circuit } = point;
    const assignment = point.assignment ?? {};
    const dist = outcomeDistribution(circuit);
    const n = circuit.numQubits;
    if (mode === 'highest') {
      let best = 0;
      for (let i = 1; i < dist.length; i++) if (dist[i] > dist[best] + 1e-12) best = i;
      return { index, assignment, label: labelOf(assignment), probability: dist[best], state: n ? best.toString(2).padStart(n, '0') : '' };
    }
    const source = options.pattern ?? circuit.variables?.sweepstate;
    if (source === undefined) {
      throw new Error('Pattern sweep needs a pattern: pass one or set the sweepstate variable in the program');
    }
    const { mask, value, text } = parsePattern(source, n);
    let probability = 0;
    for (let i = 0; i < dist.length; i++) if ((i & mask) === value) probability += dist[i];
    return { index, assignment, label: labelOf(assignment), probability, state: text };
  });
  const series = axes.length === 1 ? { x: out.map((p) => p.assignment[axes[0]]), y: out.map((p) => p.probability) } : null;
  return { mode, axes, points: out, series };
}
