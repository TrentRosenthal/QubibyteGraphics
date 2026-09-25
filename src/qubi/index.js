/**
 * Public API of the Qubi language front end.
 *
 * ```js
 * import { evaluate, schedule } from 'qubibyte-graphics/qubi';
 * const circuit = evaluate('H 0\nCX [0,1]');
 * const layout = schedule(circuit);
 * ```
 *
 * @module qubi
 */

import { parseProgram, QubiError, QUBI_KEYWORDS } from './grammar.js';
import { evaluateProgram } from './evaluator.js';
import { scheduleCircuit } from './schedule.js';
import { formatAngle, toQubiSource } from './format.js';
import { SETTINGS_KEYS } from './settings.js';
import { STDLIB_NAMES } from './stdlib.js';

export { QubiError, QUBI_KEYWORDS, SETTINGS_KEYS, STDLIB_NAMES, formatAngle, toQubiSource };

/**
 * Parse Qubi source into an AST.
 * @param {string} source
 * @param {import('./grammar.js').ParseOptions} [opts]
 * @returns {import('./grammar.js').Program}
 * @throws {QubiError} With `line` and `col` on the first syntax error (unless `recover` is set).
 */
export function parse(source, opts = {}) {
  return parseProgram(source, opts);
}

function toProgram(sourceOrAst, opts) {
  if (typeof sourceOrAst === 'string') return parseProgram(sourceOrAst, { ...opts, recover: false });
  if (sourceOrAst && sourceOrAst.type === 'Program') return sourceOrAst;
  throw new TypeError('Expected Qubi source text or a Program from parse()');
}

/**
 * Evaluate Qubi source (or a parsed Program) into the circuit IR.
 * @param {string|import('./grammar.js').Program} sourceOrAst
 * @param {import('./grammar.js').ParseOptions & import('./evaluator.js').EvaluateOptions} [opts]
 * @returns {import('./ir.js').Circuit}
 * @throws {QubiError}
 */
export function evaluate(sourceOrAst, opts = {}) {
  return evaluateProgram(toProgram(sourceOrAst, opts), opts);
}

/**
 * @typedef {Object} SweepPoint
 * @property {import('./ir.js').Circuit} circuit The concrete circuit at this point.
 * @property {Record<string, number|string>} assignment Axis key to value (bitstrings as `0b...` text, gates by name).
 * @property {Record<string, number>} indices Axis key to value index.
 */

/**
 * Enumerate every point of the cartesian product of a program's sweep axes,
 * in trace mode. Axes are discovered while evaluating, so a sweep that only
 * runs in some branches is enumerated only where it runs. A program without
 * sweeps yields one point.
 * @param {string|import('./grammar.js').Program} sourceOrAst
 * @param {import('./grammar.js').ParseOptions & {maxPoints?: number}} [opts] maxPoints defaults to 10000.
 * @returns {Generator<SweepPoint>}
 * @throws {QubiError} When the sweep has more than maxPoints points.
 */
export function* enumerateSweep(sourceOrAst, opts = {}) {
  const program = toProgram(sourceOrAst, opts);
  const maxPoints = opts.maxPoints ?? 10000;
  let count = 0;
  function* walk(point) {
    const circuit = evaluateProgram(program, { mode: 'trace', sweepPoint: point });
    const next = circuit.sweeps.find((axis) => !(axis.key in point));
    if (!next) {
      if (++count > maxPoints) throw new QubiError(`The sweep has more than ${maxPoints} points`);
      const assignment = {};
      const indices = {};
      for (const axis of circuit.sweeps) {
        indices[axis.key] = point[axis.key];
        assignment[axis.key] = axis.values[point[axis.key]];
      }
      yield { circuit, assignment, indices };
      return;
    }
    for (let k = 0; k < next.values.length; k++) yield* walk({ ...point, [next.key]: k });
  }
  yield* walk({});
}

/**
 * Pack a circuit into display columns (see qubi/schedule for the modes).
 * @param {import('./ir.js').Circuit} circuit
 * @param {{mode?: string}} [opts]
 * @returns {import('./schedule.js').Schedule}
 */
export function schedule(circuit, opts = {}) {
  return scheduleCircuit(circuit, opts);
}

/**
 * @typedef {Object} Diagnostic
 * @property {'error'|'warning'} severity
 * @property {string} message Message without the position.
 * @property {number} [line]
 * @property {number} [col]
 * @property {string} [file]
 */

/**
 * Collect diagnostics for the editor without throwing: every syntax error
 * (parsing recovers at the next line), then evaluation errors and warnings.
 * @param {string} source
 * @param {import('./grammar.js').ParseOptions} [opts]
 * @returns {Diagnostic[]}
 */
export function diagnose(source, opts = {}) {
  const out = [];
  const add = (severity, message, pos) => {
    const d = { severity, message };
    if (pos) {
      d.line = pos.line;
      d.col = pos.col;
      if (pos.file) d.file = pos.file;
    }
    if (!out.some((o) => o.severity === d.severity && o.message === d.message && o.line === d.line && o.col === d.col)) out.push(d);
  };
  const fromError = (e) => {
    if (!(e instanceof QubiError)) throw e;
    add('error', e.reason, e.pos);
  };
  let program;
  try {
    program = parseProgram(source, { ...opts, recover: true });
  } catch (e) {
    fromError(e);
    return out;
  }
  program.errors.forEach(fromError);
  program.warnings.forEach((w) => add('warning', w.message, w.pos));
  if (program.errors.length) return out;
  try {
    const circuit = evaluateProgram(program, { mode: 'trace' });
    circuit.diagnostics.forEach((d) => add(d.severity, d.message, d.pos));
  } catch (e) {
    fromError(e);
  }
  return out;
}
