/**
 * Block registry for scene documents and the visual editor. A block
 * definition says how the block looks in the library, what the inspector
 * edits, which data ports it has, what it outputs, and how it becomes a
 * scene node.
 * @module editor/blocks
 */

import { Circle, Rect, RegularPolygon, Star, Arrow, Line, Dot, SVGPathShape, Brace, ImageNode, VideoNode } from '../core/shapes.js';
import { Text, Tex, DecimalNumber } from '../text/nodes.js';
import { CodeBlock } from '../text/code.js';
import { Axes, NumberLine, ComplexPlane, PolarPlane } from '../core/coords.js';
import { toFunction } from '../core/plots.js';
import { evaluate as evaluateQubi, enumerateSweep } from '../qubi/index.js';
import { StatevectorSimulator } from '../quantum/statevector.js';
import { circuitUnitary } from '../quantum/decompose.js';
import { densityMatrixOf } from '../quantum/analysis.js';
import { sweepProbabilities } from '../quantum/sweep.js';
import { CircuitDiagram } from '../quantum/views/circuit.js';
import { AmplitudeBars, ProbabilityPie, HintonDiagram, PhaseDisks, diracTex, matrixTex, sweepPlot } from '../quantum/views/state.js';
import { DimensionLine } from '../board/dimension.js';
import { ValueTracker } from '../core/node.js';

/**
 * @typedef {Object} Field
 * @property {string} key
 * @property {string} label
 * @property {'number'|'color'|'text'|'code'|'tex'|'select'|'bool'|'points'|'asset'} kind
 * @property {number} [min]
 * @property {number} [max]
 * @property {number} [step]
 * @property {string[]} [options]
 * @property {string} [language] for 'code' fields: 'qubi' | 'js'
 */

/**
 * @typedef {Object} BlockDefinition
 * @property {string} type
 * @property {string} label
 * @property {'shapes'|'text'|'plots'|'3d'|'board'|'quantum'|'data'|'media'} category
 * @property {Record<string, any>} defaults
 * @property {Field[]} fields
 * @property {{in: Array<{name: string, kind: string}>, out: Array<{name: string, kind: string}>}} ports
 * @property {(props: any, inputs: any, doc: any) => Record<string, any>} [outputs]
 * @property {(props: any, inputs: any, ctx: any) => any} [create]
 */

/** @type {Record<string, BlockDefinition>} */
export const BLOCKS = {};

/**
 * Register a block type.
 * @param {BlockDefinition} def
 */
export function registerBlock(def) {
  BLOCKS[def.type] = { ports: { in: [], out: [] }, fields: [], ...def };
}

/**
 * @param {string} type
 * @returns {BlockDefinition}
 */
export function blockDefinition(type) {
  const d = BLOCKS[type];
  if (!d) throw new Error(`Unknown block type "${type}"`);
  return d;
}

const POS = [
  { key: 'x', label: 'X', kind: 'number', step: 0.05 },
  { key: 'y', label: 'Y', kind: 'number', step: 0.05 },
  { key: 'rotation', label: 'Rotation', kind: 'number', step: 0.01 },
  { key: 'scale', label: 'Scale', kind: 'number', step: 0.05, min: 0.05 },
  { key: 'opacity', label: 'Opacity', kind: 'number', min: 0, max: 1, step: 0.05 },
];
const STROKE = [
  { key: 'stroke', label: 'Stroke', kind: 'color' },
  { key: 'strokeWidth', label: 'Stroke width', kind: 'number', min: 0, max: 20, step: 0.5 },
  { key: 'fill', label: 'Fill', kind: 'color' },
];
const BASE = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 };

function place(node, p) {
  node.set({ rotation: p.rotation ?? 0, opacity: p.opacity ?? 1 });
  if ((p.scale ?? 1) !== 1) node.scale(p.scale);
  node.moveTo([p.x ?? 0, p.y ?? 0]);
  if (p.tokens) node.tokens = { ...p.tokens };
  return node;
}

function shape(type, label, Ctor, extraDefaults, extraFields, build) {
  registerBlock({
    type,
    label,
    category: 'shapes',
    defaults: { ...BASE, stroke: 'ink', strokeWidth: 4, fill: null, ...extraDefaults },
    fields: [...POS, ...extraFields, ...STROKE],
    create: (p) => place(build ? build(p) : new Ctor({ ...p, x: 0, y: 0, scale: undefined }), p),
  });
}

shape('circle', 'Circle', Circle, { radius: 1 }, [{ key: 'radius', label: 'Radius', kind: 'number', min: 0.01, step: 0.05 }]);
shape('rect', 'Rectangle', Rect, { width: 2, height: 1.2, radius: 0.06 }, [
  { key: 'width', label: 'Width', kind: 'number', min: 0.01, step: 0.05 },
  { key: 'height', label: 'Height', kind: 'number', min: 0.01, step: 0.05 },
  { key: 'radius', label: 'Corner radius', kind: 'number', min: 0, step: 0.02 },
]);
shape('polygon', 'Regular polygon', RegularPolygon, { sides: 6, radius: 1 }, [
  { key: 'sides', label: 'Sides', kind: 'number', min: 3, max: 24, step: 1 },
  { key: 'radius', label: 'Radius', kind: 'number', min: 0.01, step: 0.05 },
]);
shape('star', 'Star', Star, { points: 5, outerRadius: 1, innerRadius: 0.45 }, [
  { key: 'points', label: 'Points', kind: 'number', min: 2, max: 24, step: 1 },
  { key: 'outerRadius', label: 'Outer radius', kind: 'number', min: 0.01, step: 0.05 },
  { key: 'innerRadius', label: 'Inner radius', kind: 'number', min: 0.01, step: 0.05 },
]);
shape('dot', 'Dot', Dot, { radius: 0.08, fill: 'ink', stroke: null }, [{ key: 'radius', label: 'Radius', kind: 'number', min: 0.01, step: 0.01 }]);
shape('line', 'Line', Line, { length: 3 }, [{ key: 'length', label: 'Length', kind: 'number', min: 0.01, step: 0.05 }], (p) => new Line([-p.length / 2, 0], [p.length / 2, 0], { stroke: p.stroke, strokeWidth: p.strokeWidth }));
shape('arrow', 'Arrow', Arrow, { length: 3, head: 'triangle', bend: 0 }, [
  { key: 'length', label: 'Length', kind: 'number', min: 0.01, step: 0.05 },
  { key: 'head', label: 'Head', kind: 'select', options: ['triangle', 'stealth', 'open', 'line', 'round', 'square', 'diamond', 'bar', 'none'] },
  { key: 'bend', label: 'Bend', kind: 'number', min: -3, max: 3, step: 0.05 },
], (p) => new Arrow([-p.length / 2, 0], [p.length / 2, 0], { head: p.head, bend: p.bend, color: p.stroke ?? 'ink', strokeWidth: p.strokeWidth }));
shape('brace', 'Brace', Brace, { length: 3, fill: 'ink', stroke: null }, [{ key: 'length', label: 'Length', kind: 'number', min: 0.2, step: 0.05 }], (p) => new Brace([-p.length / 2, 0], [p.length / 2, 0], { fill: p.fill }));
shape('path', 'SVG path', SVGPathShape, { d: 'M0 0 C1 1 2 -1 3 0' }, [{ key: 'd', label: 'Path data', kind: 'text' }], (p) => new SVGPathShape(p.d, { stroke: p.stroke, strokeWidth: p.strokeWidth, fill: p.fill }));

registerBlock({
  type: 'text',
  label: 'Text',
  category: 'text',
  defaults: { ...BASE, content: 'Text', size: 'body', weight: 'regular', color: 'ink', align: 'left', maxWidth: 0 },
  fields: [
    { key: 'content', label: 'Text', kind: 'text' },
    { key: 'size', label: 'Size', kind: 'select', options: ['caption', 'label', 'body', 'heading', 'title', 'display'] },
    { key: 'weight', label: 'Weight', kind: 'select', options: ['regular', 'medium', 'semibold', 'italic'] },
    { key: 'align', label: 'Align', kind: 'select', options: ['left', 'center', 'right', 'justify'] },
    { key: 'maxWidth', label: 'Wrap width', kind: 'number', min: 0, step: 0.1 },
    { key: 'color', label: 'Color', kind: 'color' },
    ...POS,
  ],
  ports: { in: [{ name: 'content', kind: 'any' }], out: [] },
  create: (p, inputs) => place(new Text(inputs.content != null ? formatValue(inputs.content) : p.content, { size: p.size, weight: p.weight, color: p.color, align: p.align, maxWidth: p.maxWidth > 0 ? p.maxWidth : Infinity }), p),
});

registerBlock({
  type: 'tex',
  label: 'Math',
  category: 'text',
  defaults: { ...BASE, source: 'e^{i\\pi} + 1 = 0', size: 0.6, color: 'ink' },
  fields: [
    { key: 'source', label: 'LaTeX', kind: 'tex' },
    { key: 'size', label: 'Size', kind: 'number', min: 0.1, step: 0.05 },
    { key: 'color', label: 'Color', kind: 'color' },
    ...POS,
  ],
  ports: { in: [{ name: 'source', kind: 'tex' }], out: [] },
  create: (p, inputs) => place(new Tex(inputs.source ?? p.source, { size: p.size, color: p.color }), p),
});

registerBlock({
  type: 'number',
  label: 'Number',
  category: 'text',
  defaults: { ...BASE, value: 0, decimals: 2, size: 0.6, color: 'ink', prefix: '', suffix: '' },
  fields: [
    { key: 'value', label: 'Value', kind: 'number', step: 0.01 },
    { key: 'decimals', label: 'Decimals', kind: 'number', min: 0, max: 8, step: 1 },
    { key: 'prefix', label: 'Prefix (TeX)', kind: 'text' },
    { key: 'suffix', label: 'Suffix (TeX)', kind: 'text' },
    { key: 'size', label: 'Size', kind: 'number', min: 0.1, step: 0.05 },
    { key: 'color', label: 'Color', kind: 'color' },
    ...POS,
  ],
  ports: { in: [{ name: 'value', kind: 'number' }], out: [] },
  create: (p, inputs) => place(new DecimalNumber(Number(inputs.value ?? p.value), { decimals: p.decimals, size: p.size, color: p.color, prefix: p.prefix, suffix: p.suffix }), p),
});

registerBlock({
  type: 'code',
  label: 'Code',
  category: 'text',
  defaults: { ...BASE, source: 'H 0\nCX [0,1]', language: 'qubi', size: 0.26 },
  fields: [
    { key: 'source', label: 'Code', kind: 'code', language: 'qubi' },
    { key: 'language', label: 'Language', kind: 'select', options: ['qubi', 'plain'] },
    { key: 'size', label: 'Size', kind: 'number', min: 0.1, step: 0.02 },
    ...POS,
  ],
  create: (p) => place(new CodeBlock(p.source, { language: p.language, size: p.size }), p),
});

const AXES_FIELDS = [
  { key: 'xMin', label: 'x min', kind: 'number', step: 0.5 },
  { key: 'xMax', label: 'x max', kind: 'number', step: 0.5 },
  { key: 'yMin', label: 'y min', kind: 'number', step: 0.5 },
  { key: 'yMax', label: 'y max', kind: 'number', step: 0.5 },
  { key: 'width', label: 'Width', kind: 'number', min: 1, step: 0.25 },
  { key: 'height', label: 'Height', kind: 'number', min: 1, step: 0.25 },
  { key: 'grid', label: 'Grid', kind: 'bool' },
];

registerBlock({
  type: 'axes',
  label: 'Axes',
  category: 'plots',
  defaults: { ...BASE, xMin: -6, xMax: 6, yMin: -3.5, yMax: 3.5, width: 11, height: 6.4, grid: true, xTitle: 'x', yTitle: 'y', functions: ['sin(x)'] },
  fields: [...AXES_FIELDS, { key: 'functions', label: 'Graphs (one expression per line)', kind: 'text' }, { key: 'xTitle', label: 'x title (TeX)', kind: 'tex' }, { key: 'yTitle', label: 'y title (TeX)', kind: 'tex' }, ...POS],
  ports: { in: [{ name: 'f', kind: 'function' }], out: [] },
  create: (p, inputs) => {
    const ax = new Axes({ x: [p.xMin, p.xMax], y: [p.yMin, p.yMax], width: p.width, height: p.height, grid: p.grid, xTitle: p.xTitle || null, yTitle: p.yTitle || null });
    const fns = Array.isArray(p.functions) ? p.functions : String(p.functions || '').split('\n');
    const colors = ['accent', 'accent2', 'positive', 'negative'];
    fns.filter((f) => String(f).trim()).forEach((f, i) => ax.plot(String(f).trim(), { color: colors[i % colors.length] }));
    if (inputs.f) ax.plot(typeof inputs.f === 'function' ? inputs.f : toFunction(inputs.f, ['x']), { color: 'accent2' });
    return place(ax, p);
  },
});

registerBlock({
  type: 'numberLine',
  label: 'Number line',
  category: 'plots',
  defaults: { ...BASE, min: -5, max: 5, length: 10 },
  fields: [
    { key: 'min', label: 'Min', kind: 'number' },
    { key: 'max', label: 'Max', kind: 'number' },
    { key: 'length', label: 'Length', kind: 'number', min: 1 },
    ...POS,
  ],
  create: (p) => place(new NumberLine({ range: [p.min, p.max], length: p.length }), p),
});

registerBlock({
  type: 'complexPlane',
  label: 'Complex plane',
  category: 'plots',
  defaults: { ...BASE, xMin: -3, xMax: 3, yMin: -2, yMax: 2, width: 9, height: 6, grid: true },
  fields: [...AXES_FIELDS, ...POS],
  create: (p) => place(new ComplexPlane({ x: [p.xMin, p.xMax], y: [p.yMin, p.yMax], width: p.width, height: p.height, grid: p.grid }), p),
});

registerBlock({
  type: 'polarPlane',
  label: 'Polar plane',
  category: 'plots',
  defaults: { ...BASE, radius: 3, rings: 4, spokes: 12, curve: '' },
  fields: [
    { key: 'radius', label: 'Radius', kind: 'number', min: 0.5 },
    { key: 'rings', label: 'Rings', kind: 'number', min: 1, max: 12, step: 1 },
    { key: 'spokes', label: 'Spokes', kind: 'number', min: 4, max: 36, step: 1 },
    ...POS,
  ],
  create: (p) => place(new PolarPlane({ radius: p.radius, rings: p.rings, spokes: p.spokes }), p),
});

registerBlock({
  type: 'dimension',
  label: 'Dimension line',
  category: 'board',
  defaults: { ...BASE, length: 4, offset: -0.5, label: '' },
  fields: [
    { key: 'length', label: 'Length', kind: 'number', min: 0.1 },
    { key: 'offset', label: 'Offset', kind: 'number', step: 0.05 },
    { key: 'label', label: 'Label (TeX)', kind: 'tex' },
    ...POS,
  ],
  create: (p) => place(new DimensionLine([-p.length / 2, 0], [p.length / 2, 0], { offset: p.offset, label: p.label ? new Tex(p.label, { size: 0.32, color: 'muted' }) : undefined }), p),
});

// Data blocks.

registerBlock({
  type: 'slider',
  label: 'Slider',
  category: 'data',
  defaults: { label: 'theta', min: 0, max: 1, step: 0.01, value: 0.5 },
  fields: [
    { key: 'label', label: 'Name', kind: 'text' },
    { key: 'min', label: 'Min', kind: 'number' },
    { key: 'max', label: 'Max', kind: 'number' },
    { key: 'step', label: 'Step', kind: 'number', min: 0 },
    { key: 'value', label: 'Value', kind: 'number' },
  ],
  ports: { in: [], out: [{ name: 'value', kind: 'number' }] },
  outputs: (p) => ({ value: Number(p.value) }),
  create: (p, _inputs, ctx) => {
    const t = new ValueTracker(Number(p.value), { name: p.label });
    ctx.scene.control({ kind: 'slider', label: p.label, min: p.min, max: p.max, step: p.step, tracker: t });
    return t;
  },
});

registerBlock({
  type: 'expression',
  label: 'Expression',
  category: 'data',
  defaults: { expr: '2*a', vars: 'a' },
  fields: [
    { key: 'expr', label: 'Expression', kind: 'text' },
    { key: 'vars', label: 'Inputs (comma separated)', kind: 'text' },
  ],
  ports: { in: [{ name: 'a', kind: 'number' }, { name: 'b', kind: 'number' }, { name: 'c', kind: 'number' }], out: [{ name: 'value', kind: 'number' }, { name: 'f', kind: 'function' }] },
  outputs: (p, inputs) => {
    const vars = String(p.vars || '').split(',').map((v) => v.trim()).filter(Boolean);
    const f = toFunction(p.expr, vars.length ? vars : ['x']);
    const args = vars.map((v) => Number(inputs[v] ?? 0));
    let value;
    try {
      value = f(...args);
    } catch {
      value = NaN;
    }
    const fx = toFunction(p.expr, ['x', ...vars.filter((v) => v !== 'x')]);
    return { value, f: (x) => fx(x, ...args.slice(vars.includes('x') ? 1 : 0)) };
  },
});

// Quantum blocks.

/**
 * Insert classical variable assignments after leading settings and imports.
 * @param {string} source
 * @param {Record<string, number>} vars
 * @returns {string}
 */
export function withVariables(source, vars) {
  const entries = Object.entries(vars).filter(([, v]) => v != null && Number.isFinite(Number(v)));
  if (!entries.length) return source;
  const lines = source.split('\n');
  let i = 0;
  while (i < lines.length && /^\s*(#settings|#import|#include|\/\/|$)/.test(lines[i])) i++;
  const assigns = entries.map(([k, v]) => `${k}=${Number(v)}`);
  return [...lines.slice(0, i), ...assigns, ...lines.slice(i)].join('\n');
}

registerBlock({
  type: 'qubi',
  label: 'Qubi program',
  category: 'quantum',
  defaults: { ...BASE, source: 'H 0\nCX [0,1]', view: 'circuit', seed: 7, shots: 1024, width: 7, height: 3 },
  fields: [
    { key: 'source', label: 'Program', kind: 'code', language: 'qubi' },
    { key: 'view', label: 'Show', kind: 'select', options: ['circuit', 'code', 'none'] },
    { key: 'shots', label: 'Shots', kind: 'number', min: 1, max: 100000, step: 1 },
    { key: 'seed', label: 'Seed', kind: 'number', step: 1 },
    { key: 'width', label: 'Width', kind: 'number', min: 1 },
    { key: 'height', label: 'Height', kind: 'number', min: 0.5 },
    ...POS,
  ],
  ports: {
    in: [{ name: 'var:*', kind: 'number' }],
    out: [
      { name: 'circuit', kind: 'circuit' },
      { name: 'state', kind: 'state' },
      { name: 'unitary', kind: 'matrix' },
      { name: 'probabilities', kind: 'vector' },
      { name: 'measurements', kind: 'counts' },
      { name: 'sweep', kind: 'series' },
    ],
  },
  outputs: (p, inputs) => {
    const vars = {};
    for (const [k, v] of Object.entries(inputs)) if (k.startsWith('var:')) vars[k.slice(4)] = v;
    const src = withVariables(p.source, vars);
    const out = { source: src };
    try {
      const circuit = evaluateQubi(src);
      out.circuit = circuit;
      const sim = new StatevectorSimulator(circuit.numQubits, { seed: p.seed });
      for (const op of circuit.ops) {
        if (op.kind === 'gate') sim.applyOp(op);
        else if (op.kind === 'measure') sim.measure(op.targets);
      }
      out.state = sim;
      out.probabilities = Array.from(sim.probabilities());
      out.measurements = sim.sample(p.shots);
      if (circuit.numQubits <= 6 && circuit.ops.every((o) => o.kind === 'gate')) out.unitary = circuitUnitary(circuit);
      if (circuit.sweeps && circuit.sweeps.length) {
        const points = [...enumerateSweep(src, { maxPoints: 256 })];
        out.sweep = sweepProbabilities(points, {});
      }
    } catch (e) {
      out.error = e.message;
    }
    return out;
  },
  create: (p, _inputs, ctx) => {
    const o = ctx.outputs;
    if (p.view === 'none') return null;
    if (p.view === 'code' || !o.circuit) return place(new CodeBlock(p.source, { size: 0.26 }), p);
    const d = new CircuitDiagram(o.circuit);
    d.fitTo(p.width, p.height);
    return place(d, { ...p, scale: 1 });
  },
});

function needState(inputs) {
  if (!inputs.state) throw new Error('Wire a Qubi program state into this block');
  return inputs.state;
}

registerBlock({
  type: 'amplitudes',
  label: 'State vector bars',
  category: 'quantum',
  defaults: { ...BASE, mode: 'phase', width: 6, height: 2.4 },
  fields: [{ key: 'mode', label: 'Mode', kind: 'select', options: ['phase', 'signed', 'probability'] }, { key: 'width', label: 'Width', kind: 'number', min: 1 }, { key: 'height', label: 'Height', kind: 'number', min: 0.5 }, ...POS],
  ports: { in: [{ name: 'state', kind: 'state' }], out: [] },
  create: (p, inputs) => {
    const st = needState(inputs);
    return place(new AmplitudeBars(st.numQubits, st, { mode: p.mode, width: p.width, height: p.height }), p);
  },
});

registerBlock({
  type: 'probabilities',
  label: 'Probability chart',
  category: 'quantum',
  defaults: { ...BASE, chart: 'bars', width: 6, height: 2.4 },
  fields: [{ key: 'chart', label: 'Chart', kind: 'select', options: ['bars', 'pie'] }, { key: 'width', label: 'Width', kind: 'number', min: 1 }, { key: 'height', label: 'Height', kind: 'number', min: 0.5 }, ...POS],
  ports: { in: [{ name: 'state', kind: 'state' }], out: [] },
  create: (p, inputs) => {
    const st = needState(inputs);
    if (p.chart === 'pie') return place(new ProbabilityPie(st.numQubits, st, { radius: Math.min(p.width, p.height) / 2 }), p);
    return place(new AmplitudeBars(st.numQubits, st, { mode: 'probability', width: p.width, height: p.height }), p);
  },
});

registerBlock({
  type: 'phaseDisks',
  label: 'Phase disks',
  category: 'quantum',
  defaults: { ...BASE },
  fields: [...POS],
  ports: { in: [{ name: 'state', kind: 'state' }], out: [] },
  create: (p, inputs) => {
    const st = needState(inputs);
    return place(new PhaseDisks(st.numQubits, st), p);
  },
});

registerBlock({
  type: 'dirac',
  label: 'Dirac notation',
  category: 'quantum',
  defaults: { ...BASE, size: 0.5, symbolic: true, decimals: 3 },
  fields: [{ key: 'size', label: 'Size', kind: 'number', min: 0.1, step: 0.05 }, { key: 'symbolic', label: 'Exact forms', kind: 'bool' }, { key: 'decimals', label: 'Decimals', kind: 'number', min: 0, max: 8, step: 1 }, ...POS],
  ports: { in: [{ name: 'state', kind: 'state' }], out: [] },
  create: (p, inputs) => place(diracTex(needState(inputs), { size: p.size, symbolic: p.symbolic, decimalPlaces: p.decimals }), p),
});

registerBlock({
  type: 'matrix',
  label: 'Unitary matrix',
  category: 'quantum',
  defaults: { ...BASE, size: 0.4, style: 'numbers' },
  fields: [{ key: 'style', label: 'Style', kind: 'select', options: ['numbers', 'hinton'] }, { key: 'size', label: 'Size', kind: 'number', min: 0.1, step: 0.05 }, ...POS],
  ports: { in: [{ name: 'unitary', kind: 'matrix' }], out: [] },
  create: (p, inputs) => {
    if (!inputs.unitary) throw new Error('Wire a Qubi program unitary into this block (programs without measurements, up to six qubits)');
    if (p.style === 'hinton') return place(new HintonDiagram(inputs.unitary, { size: p.size * 10 }), p);
    return place(matrixTex(inputs.unitary, { size: p.size, prefix: 'U =' }), p);
  },
});

registerBlock({
  type: 'density',
  label: 'Density matrix',
  category: 'quantum',
  defaults: { ...BASE, part: 'magnitude', size: 3 },
  fields: [{ key: 'part', label: 'Part', kind: 'select', options: ['magnitude', 'real', 'imag', 'phase'] }, { key: 'size', label: 'Size', kind: 'number', min: 0.5 }, ...POS],
  ports: { in: [{ name: 'state', kind: 'state' }], out: [] },
  create: (p, inputs) => {
    return place(new HintonDiagram(densityMatrixOf(needState(inputs)), { size: p.size, part: p.part }), p);
  },
});

registerBlock({
  type: 'sweepPlot',
  label: 'Sweep plot',
  category: 'quantum',
  defaults: { ...BASE, width: 7, height: 3.5 },
  fields: [{ key: 'width', label: 'Width', kind: 'number', min: 1 }, { key: 'height', label: 'Height', kind: 'number', min: 1 }, ...POS],
  ports: { in: [{ name: 'sweep', kind: 'series' }], out: [] },
  create: (p, inputs) => {
    if (!inputs.sweep) throw new Error('Wire a Qubi program with a sweep (for example a=<0..1>) into this block');
    return place(sweepPlot(inputs.sweep, { width: p.width, height: p.height }), p);
  },
});

// Media.

registerBlock({
  type: 'image',
  label: 'Image',
  category: 'media',
  defaults: { ...BASE, asset: '', width: 4, treatment: 'none', fit: 'fill' },
  fields: [
    { key: 'asset', label: 'Image', kind: 'asset' },
    { key: 'width', label: 'Width', kind: 'number', min: 0.1 },
    { key: 'treatment', label: 'Match theme', kind: 'select', options: ['none', 'tint', 'duotone', 'desaturate'] },
    ...POS,
  ],
  create: (p, _inputs, ctx) => {
    const a = ctx.assets.get(p.asset);
    if (!a) throw new Error(`Image block: asset "${p.asset}" is missing`);
    return place(new ImageNode(p.asset, { width: p.width, naturalWidth: a.width, naturalHeight: a.height, treatment: p.treatment, fit: p.fit }), p);
  },
});

registerBlock({
  type: 'background',
  label: 'Background image',
  category: 'media',
  defaults: { asset: '', treatment: 'duotone', opacity: 0.35 },
  fields: [
    { key: 'asset', label: 'Image', kind: 'asset' },
    { key: 'treatment', label: 'Match theme', kind: 'select', options: ['none', 'tint', 'duotone', 'desaturate'] },
    { key: 'opacity', label: 'Opacity', kind: 'number', min: 0, max: 1, step: 0.05 },
  ],
  create: (p, _inputs, ctx) => {
    const a = ctx.assets.get(p.asset);
    if (!a) throw new Error(`Background block: asset "${p.asset}" is missing`);
    const s = ctx.scene;
    return new ImageNode(p.asset, { width: s.frameWidth, height: s.frameHeight, naturalWidth: a.width, naturalHeight: a.height, treatment: p.treatment, fit: 'cover', opacity: p.opacity, zIndex: -100 });
  },
});

registerBlock({
  type: 'video',
  label: 'Video clip',
  category: 'media',
  defaults: { ...BASE, asset: '', width: 6, startTime: 0 },
  fields: [{ key: 'asset', label: 'Video', kind: 'asset' }, { key: 'width', label: 'Width', kind: 'number', min: 0.1 }, { key: 'startTime', label: 'Start at (s)', kind: 'number', min: 0 }, ...POS],
  create: (p, _inputs, ctx) => {
    const a = ctx.assets.get(p.asset);
    if (!a) throw new Error(`Video block: asset "${p.asset}" is missing`);
    return place(new VideoNode(p.asset, { width: p.width, naturalWidth: a.width ?? 16, naturalHeight: a.height ?? 9, startTime: p.startTime }), p);
  },
});

registerBlock({
  type: 'audio',
  label: 'Audio track',
  category: 'media',
  defaults: { asset: '', at: 0, volume: 1 },
  fields: [{ key: 'asset', label: 'Audio', kind: 'asset' }, { key: 'at', label: 'Start (s)', kind: 'number', min: 0 }, { key: 'volume', label: 'Volume', kind: 'number', min: 0, max: 2, step: 0.05 }],
  create: (p, _inputs, ctx) => {
    const s = ctx.scene;
    const saved = s.clock;
    s.clock = p.at;
    s.sound(p.asset, { volume: p.volume });
    s.clock = saved;
    return null;
  },
});

function formatValue(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return String(v);
}

/**
 * Block definitions grouped by library category, for the editor's block library.
 * @returns {Record<string, BlockDefinition[]>}
 */
export function blockLibrary() {
  const out = {};
  for (const d of Object.values(BLOCKS)) {
    if (!out[d.category]) out[d.category] = [];
    out[d.category].push(d);
  }
  return out;
}
