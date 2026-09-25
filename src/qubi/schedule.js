/**
 * Packs circuit ops into display columns.
 *
 * Every op occupies a vertical span: from its lowest to its highest wire
 * (controls included), since the renderer draws a connector through the
 * wires in between. An `if` op spans every wire of its branches. Two ops
 * "overlap" when their spans intersect; ops in one column never overlap.
 *
 * Modes (the `Scheduling` setting):
 * - `never`: one op per column, in program order.
 * - `same_line`: ops are placed in program order; an op joins the current
 *   (last) column when it overlaps nothing there, otherwise it opens a new
 *   column. Ops never move left past a column that is already closed.
 * - `same_gate_continuous`: as `same_line`, but an op joins the current
 *   column only when every op there has the same gate name.
 * - `same_gate` (alias `sameType`): an op may join any column at or after its
 *   earliest legal column (one past the last column holding an op it
 *   overlaps) whose ops all have its gate name; otherwise it opens a new
 *   column at the end. Ops with the same name may share a column even when
 *   they are not consecutive, and no dependency is reordered.
 * - `always`: as-soon-as-possible packing: each op goes to its earliest legal
 *   column.
 * - `compressed`: as `always`, and consecutive iterations of one LOOP/REPEAT
 *   may share columns when their wire sets are disjoint.
 *
 * Boundaries: ops never cross the start or end of a LOOP/REPEAT or of an
 * ANNOTATE region, so brackets and boxes enclose whole columns. Iteration
 * boundaries inside a loop are also kept, except in `compressed` mode where
 * an iteration whose wires are disjoint from the iterations merged since the
 * last kept boundary joins them.
 *
 * @module qubi/schedule
 */

import { opWires } from './evaluator.js';

const MODES = new Set(['never', 'same_line', 'same_gate_continuous', 'same_gate', 'always', 'compressed']);

function spanOf(op, numQubits) {
  const w = opWires(op);
  if (!w.length) return [0, Math.max(0, numQubits - 1)];
  return [Math.min(...w), Math.max(...w)];
}

function barrierSet(circuit, mode) {
  const barriers = new Set();
  const n = circuit.ops.length;
  for (const a of circuit.annotations) {
    barriers.add(a.startOp);
    barriers.add(a.endOp);
  }
  for (const loop of circuit.loops) {
    barriers.add(loop.startOp);
    barriers.add(loop.endOp);
    const starts = loop.iterationStarts ?? [];
    if (mode !== 'compressed') {
      starts.forEach((s) => barriers.add(s));
      continue;
    }
    let merged = new Set();
    starts.forEach((s, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : loop.endOp;
      const wires = new Set();
      for (let i = s; i < end; i++) opWires(circuit.ops[i]).forEach((w) => wires.add(w));
      const disjoint = [...wires].every((w) => !merged.has(w));
      if (k > 0 && !disjoint) {
        barriers.add(s);
        merged = wires;
      } else {
        wires.forEach((w) => merged.add(w));
      }
    });
  }
  barriers.delete(0);
  barriers.delete(n);
  return barriers;
}

/**
 * @typedef {Object} Schedule
 * @property {string} mode Scheduling mode used (aliases resolved).
 * @property {number[][]} columns Op indices per column, in program order.
 * @property {number[]} opColumn Column of each op.
 * @property {Array<{id: number, keyword: string, headerText: string, iterations: number, startCol: number, endCol: number, iterationCols: number[]}>} loops Loop bracket spans; endCol is exclusive.
 * @property {Array<{id: string, startCol: number, endCol: number, wires: number[]}>} annotations Annotation box spans; endCol is exclusive.
 * @property {Array<{id: number, name: string, callText: string, blackbox: boolean, startCol: number, endCol: number, wires: number[]}>} groups Stdlib, function, and sequence-gate boxes; endCol is exclusive.
 * @property {number[]} labelColumns Column of each circuit label (the column of the op it precedes).
 */

/**
 * Pack a circuit's top-level ops into display columns.
 * @param {import('./ir.js').Circuit} circuit
 * @param {{mode?: string}} [opts] Mode overrides `circuit.settings.Scheduling`.
 * @returns {Schedule}
 */
export function scheduleCircuit(circuit, opts = {}) {
  let mode = opts.mode ?? circuit.settings?.Scheduling ?? 'same_line';
  if (mode === 'sameType') mode = 'same_gate';
  if (!MODES.has(mode)) throw new Error(`Unknown scheduling mode ${mode}`);
  const ops = circuit.ops;
  const nq = Math.max(1, circuit.numQubits, ...ops.flatMap(opWires).map((w) => w + 1));
  const barriers = barrierSet(circuit, mode);
  const lastCol = new Int32Array(nq).fill(-1);
  const columns = [];
  const colNames = [];
  const opColumn = [];
  const countAt = [];
  let floor = 0;
  for (let k = 0; k < ops.length; k++) {
    if (barriers.has(k)) floor = columns.length;
    countAt.push(columns.length);
    const op = ops[k];
    const [lo, hi] = spanOf(op, nq);
    let busy = -1;
    for (let w = lo; w <= hi; w++) busy = Math.max(busy, lastCol[w]);
    const earliest = Math.max(floor, busy + 1);
    let col;
    const cur = columns.length - 1;
    switch (mode) {
      case 'never':
        col = columns.length;
        break;
      case 'same_line':
        col = cur >= floor && busy < cur ? cur : columns.length;
        break;
      case 'same_gate_continuous':
        col = cur >= floor && busy < cur && colNames[cur] === op.name ? cur : columns.length;
        break;
      case 'same_gate': {
        col = columns.length;
        for (let c = earliest; c < columns.length; c++) {
          if (colNames[c] === op.name) { col = c; break; }
        }
        break;
      }
      default:
        col = earliest;
    }
    if (col === columns.length) {
      columns.push([]);
      colNames.push(op.name);
    } else if (colNames[col] !== op.name) {
      colNames[col] = null;
    }
    columns[col].push(k);
    opColumn.push(col);
    for (let w = lo; w <= hi; w++) lastCol[w] = Math.max(lastCol[w], col);
  }
  countAt.push(columns.length);
  for (const c of columns) c.sort((a, b) => a - b);

  const colAt = (opIndex) => (opIndex < ops.length ? opColumn[opIndex] : columns.length);
  const spanCols = (start, end) => {
    if (end <= start) return { startCol: countAt[start], endCol: countAt[start] };
    const cols = opColumn.slice(start, end);
    return { startCol: Math.min(...cols), endCol: Math.max(...cols) + 1 };
  };
  const loops = circuit.loops.map((l) => {
    const span = spanCols(l.startOp, l.endOp);
    const starts = l.iterationStarts ?? [];
    const iterationCols = starts.map((s, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : l.endOp;
      return spanCols(s, end).startCol;
    });
    return { id: l.id, keyword: l.keyword, headerText: l.headerText, iterations: l.iterations, ...span, iterationCols };
  });
  const annotations = circuit.annotations.map((a) => ({ id: a.id, ...spanCols(a.startOp, a.endOp), wires: a.wires.slice() }));
  const groupMap = new Map();
  ops.forEach((op, k) => {
    for (let gr = op.group; gr; gr = gr.parent) {
      const entry = groupMap.get(gr.id) ?? {
        id: gr.id, name: gr.name, callText: gr.callText, blackbox: Boolean(gr.blackbox),
        startCol: Infinity, endCol: -Infinity, wires: gr.wires.slice(),
      };
      entry.startCol = Math.min(entry.startCol, opColumn[k]);
      entry.endCol = Math.max(entry.endCol, opColumn[k] + 1);
      groupMap.set(gr.id, entry);
    }
  });
  const groups = [...groupMap.values()].sort((a, b) => a.id - b.id);
  const labelColumns = circuit.labels.map((l) => colAt(l.opIndex));
  return { mode, columns, opColumn, loops, annotations, groups, labelColumns };
}
