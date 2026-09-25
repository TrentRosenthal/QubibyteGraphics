/**
 * Circuit intermediate representation shared by the Qubi evaluator, the
 * simulators, the circuit renderer, and the importers. The evaluator turns a
 * Qubi program into this form; nothing downstream reads Qubi source.
 *
 * Conventions:
 * - Qubit 0 is the least significant bit. Basis index i has qubit q set when
 *   (i >> q) & 1 is 1. Bitstrings display most significant bit first, so the
 *   rightmost character is qubit 0.
 * - Angles in the IR are always radians, already converted from CodeAngleUnit.
 * - Controlled gates list controls first, then targets, in the order the user
 *   wrote them inside brackets: `CX [c1,c2,t]` gives controls [c1, c2] and
 *   targets [t].
 *
 * @module qubi/ir
 */

/**
 * Names of the native gates. Anything else must be a user `gate` definition.
 * @type {ReadonlyArray<string>}
 */
export const NATIVE_GATES = Object.freeze([
  'I', 'H', 'X', 'Y', 'Z', 'S', 'T', 'SDG', 'TDG', 'RX', 'RY', 'RZ', 'P', 'U',
  'CX', 'CY', 'CZ', 'CP', 'SWAP', 'CSWAP', 'ISWAP', 'SQRTSWAP', 'SWAPSEQ',
  'MEASURE',
]);

/**
 * Gate metadata: how many target qubits the base operation acts on, how many
 * angle parameters it takes, and its display glyph.
 * `targets: 1` gates broadcast over a parallel wire list (`H (0..2)` is three H).
 * Controlled gates (C prefix) take a bracket register; the last `targets`
 * entries are targets and everything before is a control.
 * @type {Readonly<Record<string, {targets: number, params: number, controlled: boolean, glyph: string, category: string, defaultParams?: number[]}>>}
 */
export const GATE_INFO = Object.freeze({
  I: { targets: 1, params: 0, controlled: false, glyph: 'I', category: 'pauli' },
  H: { targets: 1, params: 0, controlled: false, glyph: 'H', category: 'hadamard' },
  X: { targets: 1, params: 0, controlled: false, glyph: 'X', category: 'pauli' },
  Y: { targets: 1, params: 0, controlled: false, glyph: 'Y', category: 'pauli' },
  Z: { targets: 1, params: 0, controlled: false, glyph: 'Z', category: 'pauli' },
  S: { targets: 1, params: 0, controlled: false, glyph: 'S', category: 'phase' },
  T: { targets: 1, params: 0, controlled: false, glyph: 'T', category: 'phase' },
  SDG: { targets: 1, params: 0, controlled: false, glyph: 'S†', category: 'phase' },
  TDG: { targets: 1, params: 0, controlled: false, glyph: 'T†', category: 'phase' },
  RX: { targets: 1, params: 1, controlled: false, glyph: 'RX', category: 'rotation', defaultParams: [Math.PI / 2] },
  RY: { targets: 1, params: 1, controlled: false, glyph: 'RY', category: 'rotation', defaultParams: [Math.PI / 2] },
  RZ: { targets: 1, params: 1, controlled: false, glyph: 'RZ', category: 'rotation', defaultParams: [Math.PI / 2] },
  P: { targets: 1, params: 1, controlled: false, glyph: 'P', category: 'phase', defaultParams: [Math.PI / 2] },
  U: { targets: 1, params: 3, controlled: false, glyph: 'U', category: 'rotation' },
  CX: { targets: 1, params: 0, controlled: true, glyph: 'X', category: 'controlled' },
  CY: { targets: 1, params: 0, controlled: true, glyph: 'Y', category: 'controlled' },
  CZ: { targets: 1, params: 0, controlled: true, glyph: 'Z', category: 'controlled' },
  CP: { targets: 1, params: 1, controlled: true, glyph: 'P', category: 'controlled', defaultParams: [Math.PI / 2] },
  SWAP: { targets: 2, params: 0, controlled: false, glyph: 'SWAP', category: 'swap' },
  CSWAP: { targets: 2, params: 0, controlled: true, glyph: 'SWAP', category: 'swap' },
  ISWAP: { targets: 2, params: 0, controlled: false, glyph: 'iSWAP', category: 'swap' },
  SQRTSWAP: { targets: 2, params: 0, controlled: false, glyph: '√SWAP', category: 'swap' },
  SWAPSEQ: { targets: -1, params: 0, controlled: false, glyph: 'SWAP', category: 'swap' },
  MEASURE: { targets: 1, params: 0, controlled: false, glyph: 'M', category: 'measure' },
});

/**
 * @typedef {Object} SourcePos
 * @property {number} line 1-based
 * @property {number} col 1-based
 * @property {string} [file]
 */

/**
 * @typedef {Object} CMatrix Dense complex matrix, row-major.
 * @property {number} rows
 * @property {number} cols
 * @property {Float64Array} re
 * @property {Float64Array} im
 */

/**
 * One executable operation.
 * @typedef {Object} Op
 * @property {'gate'|'measure'|'if'|'barrier'} kind
 * @property {string} name Qubi gate name (native or user-defined). 'MEASURE' for measurements.
 * @property {number[]} targets Target wires.
 * @property {number[]} controls Control wires (empty for uncontrolled gates).
 * @property {number[]} params Angle parameters in radians.
 * @property {string[]} [paramText] Source text of each parameter, for display.
 * @property {CMatrix} [matrix] Unitary on the targets for user matrix gates.
 * @property {string} [label] Display label override (user gates, stdlib boxes).
 * @property {string} [color] Display color name from a user gate definition.
 * @property {Group} [group] Present when the op came from a stdlib call or user function.
 * @property {string} [register] For measurements: name of the classical variable receiving the result.
 * @property {IfBranch[]} [branches] For kind 'if': condition branches in order.
 * @property {Op[]} [elseOps] For kind 'if': ops when no branch matched.
 * @property {number} [loopId] Innermost enclosing LOOP/REPEAT id, if any.
 * @property {number} [iteration] Iteration index within that loop.
 * @property {SourcePos} [pos]
 */

/**
 * @typedef {Object} IfBranch
 * @property {string} condText Source text of the condition, for display.
 * @property {Op[]} ops
 */

/**
 * @typedef {Object} Group
 * @property {number} id Unique per call site evaluation.
 * @property {string} name Stdlib or function name, for example 'QFT'.
 * @property {string} callText Source text of the call, for example 'QFT(0..4)'.
 * @property {number[]} wires Wires the call touches.
 */

/**
 * @typedef {Object} Label
 * @property {number[]} wires
 * @property {string} text Evaluated text (interpolations resolved).
 * @property {string} rawText Source text before interpolation.
 * @property {number} opIndex Index into ops where the label sits.
 */

/**
 * @typedef {Object} Annotation
 * @property {string} id
 * @property {number} startOp
 * @property {number} endOp exclusive
 * @property {number[]} wires Wires touched by ops in the region.
 */

/**
 * @typedef {Object} LoopInfo
 * @property {number} id
 * @property {'LOOP'|'REPEAT'} keyword
 * @property {string} headerText For example 'LOOP 3' or 'LOOP <0..4>'.
 * @property {number} iterations
 * @property {number} startOp
 * @property {number} endOp exclusive
 */

/**
 * @typedef {Object} SweepAxis
 * @property {string} name Variable name, or '<inline>' for inline gate sweeps.
 * @property {Array<number|string>} values Values in sweep order (numbers, bitstrings, or gate names).
 * @property {'value'|'gate'} kind
 */

/**
 * The result of evaluating a Qubi program.
 * @typedef {Object} Circuit
 * @property {number} numQubits Total wires (MaxQubits or inferred).
 * @property {number} visibleQubits Wires shown in diagrams.
 * @property {Op[]} ops
 * @property {Label[]} labels
 * @property {Annotation[]} annotations
 * @property {LoopInfo[]} loops
 * @property {SweepAxis[]} sweeps Axes found in the program; empty when there is no sweep.
 * @property {Record<string, any>} settings Resolved `#settings` values.
 * @property {Record<string, any>} gateDefs User gate definitions by name.
 * @property {Record<string, any>} variables Final classical variable values.
 * @property {Array<{severity: 'error'|'warning', message: string, pos?: SourcePos}>} diagnostics
 */
