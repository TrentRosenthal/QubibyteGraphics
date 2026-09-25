/**
 * 3D building blocks for quantum figures: the Bloch sphere with an
 * animatable state arrow, the Q-sphere, density-matrix bar cities,
 * amplitude landscapes, and printable 3D circuit models.
 * @module three/quantum3d
 */

import { ColorMix } from '../core/node.js';
import { phaseColor } from '../core/color.js';
import { Animation } from '../core/animations.js';
import { Group3D, Mesh3D, Lines3D, Label3D, Arrow3D, Points3D, text3D } from './object3d.js';
import { uvSphere, box, roundedBox, cylinder, cone, torus, tube, mergeMeshes, translateMesh, transformMesh, meshBounds, makeMesh } from './geometry.js';
import { sphericalGrid } from './axes3d.js';
import { loadLabelText } from './render.js';
import { spherical, rotateAxis, normalize, cross, perpendicular } from './vec3.js';
import * as M from './mat4.js';
import * as Q from './quat.js';
import { scheduleCircuit } from '../qubi/schedule.js';


/** Default Bloch sphere axis labels. */
export const BLOCH_LABELS = {
  zPlus: '\\lvert 0\\rangle', zMinus: '\\lvert 1\\rangle', xPlus: '\\lvert +\\rangle', xMinus: '\\lvert -\\rangle', yPlus: '\\lvert +i\\rangle', yMinus: '\\lvert -i\\rangle',
};

/** State arrow whose tip follows the parent Bloch sphere's theta and phi. */
class StateArrow extends Arrow3D {
  endpoints() {
    const b = this.parent;
    const r = b.radius * 0.985;
    return [[0, 0, 0], spherical(b.get('theta'), b.get('phi')).map((v) => v * r)];
  }
}

/** Dashed projection guides from the tip to the equator plane. */
class StateGuides extends Lines3D {
  emit(ctx, m, opacity) {
    const b = this.parent;
    const tip = spherical(b.get('theta'), b.get('phi')).map((v) => v * b.radius);
    const foot = [tip[0], tip[1], 0];
    this.polylines = Math.hypot(foot[0], foot[1]) > 1e-3 ? [{ points: [tip, foot], closed: false }, { points: [[0, 0, 0], foot], closed: false }] : [];
    if (this.polylines.length) super.emit(ctx, m, opacity);
  }
}

/** Path traced by the state arrow's tip from a start time to the current time. */
class TipTrail extends Lines3D {
  emit(ctx, m, opacity) {
    const b = this.parent;
    const t = ctx.t ?? 0;
    const start = this.trailFrom;
    if (t <= start) return;
    const pts = [];
    const n = Math.min(900, Math.max(2, Math.ceil((t - start) * 60)));
    for (let i = 0; i <= n; i++) {
      const tau = start + ((t - start) * i) / n;
      pts.push(spherical(b.valueAt('theta', tau), b.valueAt('phi', tau)).map((v) => v * b.radius));
    }
    pts.push(spherical(b.get('theta'), b.get('phi')).map((v) => v * b.radius));
    this.polylines = [{ points: pts, closed: false }];
    super.emit(ctx, m, opacity);
  }
}

/**
 * Bloch sphere: a translucent sphere with faint latitude and longitude lines
 * (equator slightly stronger), x, y, z axes with state labels, and a state
 * arrow driven by the animatable `theta` and `phi` properties.
 */
export class BlochSphere extends Group3D {
  /**
   * @param {Record<string, any>} [opts] theta, phi, radius (1.5), labels (strings, Paths, or {path}; keys zPlus, zMinus, xPlus, xMinus, yPlus, yMinus), labelFactory, labelSize (0.3), color (arrow, default 'accent'), sphereColor, trail (true or {from: time}), guides (true), axes (true)
   */
  constructor(opts = {}) {
    super([], { type: 'bloch', ...(opts.props || {}) });
    this._define('theta', opts.theta ?? 0);
    this._define('phi', opts.phi ?? 0);
    this.radius = opts.radius ?? 1.5;
    const r = this.radius;
    this.labelFactory = opts.labelFactory ?? null;
    if (!this.labelFactory) loadLabelText();
    const sphere = uvSphere(r, 48, 24);
    const cls = new Map();
    const P = sphere.positions;
    const latOf = (i) => Math.round((Math.acos(Math.max(-1, Math.min(1, P[i * 3 + 2] / r))) * 180) / Math.PI);
    const lon = (i) => Math.round(((Math.atan2(P[i * 3 + 1], P[i * 3]) * 180) / Math.PI + 360) % 360);
    for (const f of sphere.faces) {
      for (let k = 0; k < f.length; k++) {
        const a = f[k];
        const b = f[(k + 1) % f.length];
        const la = latOf(a);
        const lb = latOf(b);
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (la === lb && la % 30 === 0 && la !== 0 && la !== 180) cls.set(key, la === 90 ? 'major' : 'grid');
        else if (la !== lb && lon(a) === lon(b) && lon(a) % 45 === 0) cls.set(key, 'grid');
      }
    }
    sphere.edgeClass = cls;
    this.sphere = new Mesh3D(sphere, { color: opts.sphereColor ?? 'auto', material: { kind: 'glass', edges: 'none', alpha: 0.1, rim: 0.28 }, castShadow: false, name: 'bloch-sphere' });
    this.add(this.sphere);
    const labels = { ...BLOCH_LABELS, ...(opts.labels || {}) };
    const size = opts.labelSize ?? 0.3;
    if (opts.axes !== false) {
      const ext = r * 1.22;
      const axisColor = new ColorMix('ink', 'background', 0.45);
      this.add(new Lines3D([[[-ext, 0, 0], [ext, 0, 0]], [[0, -ext, 0], [0, ext, 0]], [[0, 0, -ext], [0, 0, ext]]], { color: axisColor, strokeWidth: 2, role: 'axis', name: 'bloch-axes' }));
      const place = [
        ['zPlus', [0, 0, ext + size * 0.8]], ['zMinus', [0, 0, -ext - size * 0.8]],
        ['xPlus', [ext + size * 0.9, 0, 0]], ['xMinus', [-ext - size * 0.9, 0, 0]],
        ['yPlus', [0, ext + size * 0.9, 0]], ['yMinus', [0, -ext - size * 0.9, 0]],
      ];
      for (const [k, p] of place) {
        if (labels[k] == null || labels[k] === false) continue;
        this.add(new Label3D(labels[k], { position: p, size, color: k[0] === 'z' ? 'ink' : 'muted', factory: this.labelFactory, name: `bloch-label-${k}` }));
      }
    }
    if (opts.guides !== false) this.add(new StateGuides([], { color: 'muted', strokeOpacity: 0.7, strokeWidth: 2, dash: [0.07, 0.06], name: 'bloch-guides' }));
    if (opts.trail) {
      const trail = new TipTrail([], { color: opts.color ?? 'accent', strokeWidth: 3, strokeOpacity: 0.75, name: 'bloch-trail' });
      trail.trailFrom = typeof opts.trail === 'object' ? opts.trail.from ?? 0 : 0;
      this.add(trail);
    }
    this.arrow = new StateArrow([0, 0, 0], [0, 0, r], { color: opts.color ?? 'accent', shaftRadius: r * 0.018, headRadius: r * 0.055, headLength: r * 0.16, material: 'glossy', name: 'bloch-state' });
    this.add(this.arrow);
  }

  /**
   * Point the state at (theta, phi) instantly.
   * @param {number} theta @param {number} phi
   * @returns {this}
   */
  setState(theta, phi) {
    return this.set({ theta, phi });
  }

  /**
   * Rotation-axis indicator for a gate: a dashed line along the axis and a
   * curved arrow circling it near its positive end. Returns the group so the
   * caller can fade it in and out.
   * @param {number[]} axis
   * @param {{color?: any, angle?: number, sweep?: number}} [opts] sweep: arc length in radians (default 1.6 pi); a negative angle reverses the arrow
   * @returns {Group3D}
   */
  rotationIndicator(axis, opts = {}) {
    const r = this.radius;
    const a = normalize(axis);
    const color = opts.color ?? 'accent2';
    const g = new Group3D([], { name: 'rotation-indicator' });
    const ext = r * 1.3;
    g.add(new Lines3D([[a.map((v) => -v * ext), a.map((v) => v * ext)]], { color, strokeWidth: 2.5, dash: [0.1, 0.07], strokeOpacity: 0.85 }));
    const center = a.map((v) => v * r * 1.12);
    const rho = r * 0.2;
    const u = perpendicular(a);
    const w = cross(a, u);
    const sweep = (opts.sweep ?? 1.6 * Math.PI) * Math.sign(opts.angle ?? 1);
    const pts = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const t = (sweep * i) / n;
      pts.push([0, 1, 2].map((k) => center[k] + rho * (Math.cos(t) * u[k] + Math.sin(t) * w[k])));
    }
    g.add(new Lines3D([pts], { color, strokeWidth: 3 }));
    const end = pts[n];
    const tan = normalize([0, 1, 2].map((k) => Math.sign(sweep) * (-Math.sin(sweep) * u[k] + Math.cos(sweep) * w[k])));
    const hl = r * 0.09;
    const head = new Mesh3D(translateMesh(cone(r * 0.035, hl, 16), 0, 0, hl / 2), { color, material: 'flat', castShadow: false });
    head.set({ quat: Q.fromUnitVectors([0, 0, 1], tan), position: end });
    g.add(head);
    this.add(g);
    return g;
  }
}

/**
 * @param {Record<string, any>} [opts] see {@link BlochSphere}
 * @returns {BlochSphere}
 */
export function blochSphere(opts) {
  return new BlochSphere(opts);
}

function thetaPhiOf(v) {
  const L = Math.hypot(...v) || 1;
  return [Math.acos(Math.max(-1, Math.min(1, v[2] / L))), Math.atan2(v[1], v[0])];
}

/** Rotate a Bloch state about an axis: the tip sweeps along the true rotation path. */
export class BlochRotate extends Animation {
  /** @param {BlochSphere} bloch @param {number[]} axis @param {number} angle @param {Record<string, any>} [opts] */
  constructor(bloch, axis, angle, opts = {}) {
    super(opts);
    this.bloch = bloch;
    this.axis = normalize(axis);
    this.angle = angle;
  }

  schedule(_scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const b = this.bloch;
    const v0 = spherical(b._cur.theta, b._cur.phi);
    const phi0 = b._cur.phi;
    const at = (u) => {
      const [th, ph] = thetaPhiOf(rotateAxis(v0, this.axis, this.angle * u));
      const k = Math.round((phi0 - ph) / (2 * Math.PI));
      return [th, ph + 2 * Math.PI * k];
    };
    const end = at(1);
    b.tween('theta', s, e, end[0], this.ease, (u) => at(u)[0]);
    b.tween('phi', s, e, end[1], this.ease, (u) => at(u)[1]);
    return e;
  }
}

/**
 * @param {BlochSphere} bloch @param {number[]} axis @param {number} angle
 * @param {Record<string, any>} [opts]
 * @returns {BlochRotate}
 */
export function blochRotate(bloch, axis, angle, opts) {
  return new BlochRotate(bloch, axis, angle, opts);
}

function complexOf(v) {
  if (typeof v === 'number') return [v, 0];
  if (Array.isArray(v)) return [v[0] ?? 0, v[1] ?? 0];
  if (v && typeof v === 'object') return [v.re ?? v.real ?? 0, v.im ?? v.imag ?? 0];
  return [0, 0];
}

/**
 * Q-sphere: basis states as dots on a sphere, sized by magnitude and colored
 * by phase, with lines to the center.
 * @param {Array<{latitude?: number, polar?: number, longitude: number, magnitude: number, phaseColor?: any, phase?: number, label?: any}>} nodes latitude in radians from the equator (pi/2 is the north pole), or polar from +z
 * @param {{radius?: number, maxDot?: number, labelFactory?: Function, labelSize?: number}} [opts]
 * @returns {Group3D}
 */
export function qSphere(nodes, opts = {}) {
  const r = opts.radius ?? 1.5;
  const g = new Group3D([], { type: 'qsphere' });
  g.add(sphericalGrid({ radius: r, meridians: 12, parallels: 5 }, { strokeOpacity: 0.13 }));
  g.add(new Mesh3D(uvSphere(r, 48, 24), { color: 'auto', material: { kind: 'glass', edges: 'none', alpha: 0.05, rim: 0.18 }, castShadow: false }));
  const maxDot = opts.maxDot ?? r * 0.12;
  let maxMag = 0;
  for (const n of nodes) maxMag = Math.max(maxMag, n.magnitude);
  for (const n of nodes) {
    if (!(n.magnitude > 1e-9)) continue;
    const polar = n.polar ?? Math.PI / 2 - (n.latitude ?? 0);
    const p = spherical(polar, n.longitude).map((v) => v * r);
    const color = n.phaseColor ?? (n.phase != null ? phaseColor(n.phase) : 'accent');
    const k = maxMag > 0 ? Math.sqrt(n.magnitude / maxMag) : 1;
    g.add(new Lines3D([[[0, 0, 0], p]], { color, strokeWidth: 2.5, strokeOpacity: 0.85 }));
    g.add(new Points3D([p], { color, radius: maxDot * Math.max(0.25, k) }));
    if (n.label != null) g.add(new Label3D(n.label, { position: labelSpot(p, r), size: opts.labelSize ?? 0.22, color: 'muted', factory: opts.labelFactory ?? null }));
  }
  return g;
}

/**
 * Where a Q-sphere label goes: outward from its point and a little further
 * from the equator, so a point facing the camera never hides under its label.
 * @param {number[]} p
 * @param {number} r
 * @returns {number[]}
 */
function labelSpot(p, r) {
  const up = p[2] < -1e-6 * r ? -1 : 1;
  return [p[0] * 1.14, p[1] * 1.14, p[2] * 1.14 + up * r * 0.13];
}

/**
 * Density matrix as a 3D bar chart ("city plot"). Heights are |value| or the
 * real part; colors follow the phase (or the sign in 'real' mode).
 * @param {Array<Array<number|number[]|{re: number, im: number}>>} matrix
 * @param {{height?: 'abs'|'real', color?: 'phase'|'sign'|any, spacing?: number, barWidth?: number, scale?: number, labels?: any[], labelFactory?: Function, floor?: boolean}} [opts]
 * @returns {Group3D}
 */
export function barCity(matrix, opts = {}) {
  const n = matrix.length;
  const m = matrix[0] ? matrix[0].length : 0;
  const sp = opts.spacing ?? 1;
  const w = (opts.barWidth ?? 0.62) * sp;
  const scale = opts.scale ?? 2.5;
  const mode = opts.height ?? 'abs';
  const g = new Group3D([], { type: 'barcity' });
  const x0 = (-(m - 1) * sp) / 2;
  const y0 = ((n - 1) * sp) / 2;
  if (opts.floor !== false) {
    const lines = [];
    for (let i = 0; i <= n; i++) lines.push([[x0 - sp / 2, y0 + sp / 2 - i * sp, 0], [x0 + (m - 0.5) * sp, y0 + sp / 2 - i * sp, 0]]);
    for (let j = 0; j <= m; j++) lines.push([[x0 - sp / 2 + j * sp, y0 + sp / 2, 0], [x0 - sp / 2 + j * sp, y0 - (n - 0.5) * sp, 0]]);
    g.add(new Lines3D(lines, { color: 'ink', strokeOpacity: 0.16, strokeWidth: 1.5, role: 'grid', name: 'barcity-floor' }));
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const [re, im] = complexOf(matrix[i][j]);
      const mag = Math.hypot(re, im);
      const h = (mode === 'real' ? re : mag) * scale;
      if (Math.abs(h) < 1e-4) continue;
      let color;
      if (opts.color && opts.color !== 'phase' && opts.color !== 'sign') color = opts.color;
      else if (opts.color === 'sign' || mode === 'real') color = h >= 0 ? 'accent' : 'negative';
      else color = mag > 1e-9 ? phaseColor(Math.atan2(im, re), { L: 0.72, C: 0.12 }) : 'muted';
      const bar = new Mesh3D(box(w, w, Math.abs(h)), { color, material: 'matte', castShadow: false, name: `bar-${i}-${j}` });
      bar.set('position', [x0 + j * sp, y0 - i * sp, h / 2]);
      g.add(bar);
    }
  }
  if (opts.labels) {
    const size = 0.24 * sp;
    opts.labels.forEach((lab, k) => {
      if (k < m) g.add(new Label3D(lab, { position: [x0 + k * sp, y0 + sp * 0.95, 0], size, color: 'muted', factory: opts.labelFactory ?? null }));
      if (k < n) g.add(new Label3D(lab, { position: [x0 - sp * 0.95, y0 - k * sp, 0], size, color: 'muted', factory: opts.labelFactory ?? null }));
    });
  }
  return g;
}

/**
 * Amplitudes over the computational basis: a row of bars (1D input) or a
 * surface over a grid (2D input). Height is the magnitude; color the phase.
 * @param {Array<any>|Array<Array<any>>} values complex amplitudes (numbers, [re, im], or {re, im})
 * @param {{mode?: 'bars'|'surface', spacing?: number, scale?: number, labels?: any[], labelFactory?: Function}} [opts]
 * @returns {Group3D}
 */
export function amplitudeLandscape(values, opts = {}) {
  const twoD = Array.isArray(values[0]) && Array.isArray(values[0][0]) ? true : Array.isArray(values[0]) && values[0].length > 2;
  const mode = opts.mode ?? (twoD ? 'surface' : 'bars');
  const sp = opts.spacing ?? 0.8;
  const scale = opts.scale ?? 2.5;
  const g = new Group3D([], { type: 'amplitudes' });
  if (mode === 'bars') {
    const list = twoD ? values.flat() : values;
    const x0 = (-(list.length - 1) * sp) / 2;
    list.forEach((v, i) => {
      const [re, im] = complexOf(v);
      const mag = Math.hypot(re, im);
      if (mag * scale < 1e-4) return;
      const bar = new Mesh3D(box(sp * 0.6, sp * 0.6, mag * scale), { color: phaseColor(Math.atan2(im, re), { L: 0.72, C: 0.12 }), material: 'matte', castShadow: false });
      bar.set('position', [x0 + i * sp, 0, (mag * scale) / 2]);
      g.add(bar);
      if (opts.labels && opts.labels[i] != null) g.add(new Label3D(opts.labels[i], { position: [x0 + i * sp, -sp * 0.8, 0], size: 0.24, color: 'muted', factory: opts.labelFactory ?? null }));
    });
    g.add(new Lines3D([[[x0 - sp * 0.6, 0, 0], [x0 + (list.length - 1) * sp + sp * 0.6, 0, 0]]], { color: 'ink', strokeOpacity: 0.3, strokeWidth: 1.5 }));
    return g;
  }
  const rows = values.length;
  const cols = values[0].length;
  const grid = values.map((row) => row.map(complexOf));
  const faces = [];
  const pos = [];
  const colors = [];
  const x0 = (-(cols - 1) * sp) / 2;
  const y0 = ((rows - 1) * sp) / 2;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) pos.push([x0 + j * sp, y0 - i * sp, Math.hypot(...grid[i][j]) * scale]);
  for (let i = 0; i + 1 < rows; i++) {
    for (let j = 0; j + 1 < cols; j++) {
      const a = i * cols + j;
      faces.push([a + cols, a + cols + 1, a + 1, a]);
      const c = [grid[i][j], grid[i][j + 1], grid[i + 1][j], grid[i + 1][j + 1]].reduce((acc, z) => [acc[0] + z[0], acc[1] + z[1]], [0, 0]);
      colors.push(phaseColor(Math.atan2(c[1], c[0]), { L: 0.72, C: 0.12 }));
    }
  }
  g.add(new Mesh3D(makeMesh(pos, faces, { faceColors: colors }), { material: 'matte', castShadow: false }));
  return g;
}

function safeLabel(factory, label) {
  try {
    const r = factory(String(label));
    return r && r.subpaths ? r : r && r.path ? r.path : null;
  } catch {
    return null;
  }
}

const GATE_COLORS = [
  [/^H/i, 'gateHadamard'], [/^[XYZ]$/i, 'gatePauli'], [/^(S|T|P|PHASE)/i, 'gatePhase'], [/^R/i, 'gateRotation'],
];

function gateColor(g) {
  if (g.color) return g.color;
  if (g.kind === 'control' || g.kind === 'target') return 'gateControlled';
  if (g.kind === 'swap') return 'gateSwap';
  if (g.kind === 'measure') return 'gateMeasure';
  const label = typeof g.label === 'string' ? g.label : '';
  for (const [re, tok] of GATE_COLORS) if (re.test(label)) return tok;
  return 'gateUser';
}

/**
 * @typedef {Object} CircuitModelInput
 * @property {number|Array<{label?: any}>} wires wire count or wire descriptors (top to bottom)
 * @property {Array<{column: number, wires: number[], kind: 'box'|'control'|'target'|'swap'|'measure', label?: any, color?: any}>} gates
 *   one entry per gate element; a controlled gate is several entries in one column (controls and a target or box), joined by a vertical connector
 */

/**
 * The printable-model description of an evaluated Qubi circuit: one column
 * per operation (so connectors never join unrelated gates), controls as
 * dots, controlled X as a target ring, SWAP as crosses, MEASURE as a meter,
 * everything else as a labeled box.
 * @param {import('../qubi/ir.js').Circuit} circuit
 * @param {{scheduling?: string}} [opts] scheduling mode (default 'never')
 * @returns {CircuitModelInput}
 */
export function circuitModel(circuit, opts = {}) {
  const sched = scheduleCircuit(circuit, { mode: opts.scheduling ?? 'never' });
  const gates = [];
  sched.columns.forEach((col, c) => {
    for (const i of col) {
      const op = circuit.ops[i];
      if (op.kind === 'measure' || op.name === 'MEASURE') {
        for (const t of op.targets) gates.push({ column: c, wires: [t], kind: 'measure' });
        continue;
      }
      if (op.kind !== 'gate') continue;
      for (const q of op.controls) gates.push({ column: c, wires: [q], kind: 'control' });
      const base = op.controls.length ? op.name.replace(/^C+/, '') : op.name;
      if (base === 'SWAP') gates.push({ column: c, wires: op.targets, kind: 'swap' });
      else if (base === 'X' && op.controls.length) gates.push({ column: c, wires: op.targets, kind: 'target' });
      else gates.push({ column: c, wires: op.targets, kind: 'box', label: op.label ?? base });
    }
  });
  return { wires: circuit.numQubits, gates };
}

/**
 * Printable 3D model of a quantum circuit: wires as cylinders, gates as
 * rounded boxes (with extruded labels when a label factory returns outline
 * Paths), controls as spheres, targets as rings, swaps as crosses, and
 * vertical connectors as cylinders, on an optional base plate. Units are
 * millimeters in the exported mesh when `scale` is left at its default.
 * @param {CircuitModelInput} circuit
 * @param {{columnSpacing?: number, wireSpacing?: number, wireRadius?: number, gateSize?: number, gateHeight?: number, labelFactory?: (text: string) => any, base?: boolean, scale?: number}} [opts]
 * @returns {{mesh: import('./geometry.js').MeshGeometry, group: Group3D}}
 */
export function circuitMesh(circuit, opts = {}) {
  const k = opts.scale ?? 1;
  const cs = (opts.columnSpacing ?? 1.4) * k;
  const ws = (opts.wireSpacing ?? 1.2) * k;
  const wr = (opts.wireRadius ?? 0.07) * k;
  const gs = (opts.gateSize ?? 0.8) * k;
  const gh = (opts.gateHeight ?? 0.36) * k;
  const baseT = 0.12 * k;
  const nWires = typeof circuit.wires === 'number' ? circuit.wires : circuit.wires.length;
  const cols = circuit.gates.reduce((m, g) => Math.max(m, g.column), 0) + 1;
  const length = (cols + 1) * cs;
  const x0 = -length / 2;
  const colX = (c) => x0 + (c + 1) * cs;
  const wireY = (w) => ((nWires - 1) / 2 - w) * ws;
  const zc = opts.base === false ? 0 : baseT + wr;
  const parts = [];
  const group = new Group3D([], { type: 'circuit3d' });
  const add = (mesh, matrix, color, name) => {
    const placed = matrix ? transformMesh(mesh, matrix) : mesh;
    parts.push({ mesh: placed, color });
    group.add(new Mesh3D(placed, { color, material: 'matte', name }));
  };
  if (opts.base !== false) add(translateMesh(roundedBox(length + cs * 0.2, nWires * ws + ws * 0.4, baseT, baseT * 0.45, 2), 0, 0, baseT / 2), null, 'surface', 'base');
  const alongX = M.axisAngle([0, 1, 0], Math.PI / 2);
  const alongY = M.axisAngle([1, 0, 0], Math.PI / 2);
  for (let w = 0; w < nWires; w++) add(cylinder(wr, length, 16), M.multiply(M.translation(0, wireY(w), zc), alongX), 'muted', `wire-${w}`);
  const byColumn = new Map();
  for (const g of circuit.gates) {
    if (!byColumn.has(g.column)) byColumn.set(g.column, []);
    byColumn.get(g.column).push(g);
  }
  for (const [c, gates] of byColumn) {
    const x = colX(c);
    const ys = gates.filter((g) => g.kind !== 'measure').flatMap((g) => g.wires.map(wireY));
    const linked = gates.some((g) => g.kind === 'control' || g.kind === 'target') || gates.some((g) => g.kind === 'swap' && g.wires.length > 1);
    if (linked) {
      const top = Math.max(...ys);
      const bot = Math.min(...ys);
      if (top - bot > 1e-9) add(cylinder(wr * 0.9, top - bot, 12), M.multiply(M.translation(x, (top + bot) / 2, zc), alongY), 'gateControlled', `connector-${c}`);
    }
    for (const g of gates) {
      const color = gateColor(g);
      if (g.kind === 'box' || g.kind === 'measure') {
        const yTop = Math.max(...g.wires.map(wireY));
        const yBot = Math.min(...g.wires.map(wireY));
        const h = yTop - yBot + gs;
        const body = roundedBox(gs, h, gh, gh * 0.3, 2);
        const cz = zc - wr + gh / 2;
        add(body, M.translation(x, (yTop + yBot) / 2, cz), color, `gate-${c}`);
        if (g.kind === 'measure') {
          const arc = [];
          for (let i = 0; i <= 16; i++) {
            const a = Math.PI * (0.15 + (0.7 * i) / 16);
            arc.push([Math.cos(a) * gs * 0.26, Math.sin(a) * gs * 0.26 - gs * 0.1, 0]);
          }
          add(tube(arc, { radius: wr * 0.5, radialSegments: 8, caps: true }), M.translation(x, (yTop + yBot) / 2, cz + gh / 2), 'ink', `meter-${c}`);
        } else if (g.label != null && opts.labelFactory) {
          const path = safeLabel(opts.labelFactory, g.label);
          if (path && path.subpaths.length) {
            const t = text3D(path, { depth: gh * 0.25 });
            const b = meshBounds(t.mesh);
            const fit = (gs * 0.62) / Math.max(b.max[0] - b.min[0], (b.max[1] - b.min[1]) * 1.1, 1e-6);
            add(t.mesh, M.multiply(M.translation(x, (yTop + yBot) / 2, cz + gh / 2 - gh * 0.02), M.scaling(fit, fit, 1)), 'background', `label-${c}`);
          }
        }
      } else if (g.kind === 'control') {
        for (const w of g.wires) add(uvSphere(wr * 2.6, 20, 10), M.translation(x, wireY(w), zc), color, `control-${c}-${w}`);
      } else if (g.kind === 'target') {
        for (const w of g.wires) add(torus(gs * 0.32, wr * 0.9, 32, 10), M.translation(x, wireY(w), zc), color, `target-${c}-${w}`);
      } else if (g.kind === 'swap') {
        for (const w of g.wires) {
          for (const ang of [Math.PI / 4, -Math.PI / 4]) add(box(gs * 0.5, wr * 1.6, wr * 1.6), M.multiply(M.translation(x, wireY(w), zc), M.axisAngle([0, 0, 1], ang)), color, `swap-${c}-${w}`);
        }
      }
    }
  }
  return { mesh: mergeMeshes(parts), group };
}
