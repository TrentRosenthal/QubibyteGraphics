/**
 * Circuit diagrams from the Qubi circuit IR. Publication style: thin wires,
 * square gates with centered labels, filled control dots on a vertical
 * connector, the XOR target for CX, crosses for swaps, a meter glyph for
 * measurement with a classical double wire down to the register line.
 * Honors ShowGateParams, GateParamAngleUnit, ShowConditionalBranches,
 * ShowEvaluatedLabels, VisibleQubits, Zoom, and every Scheduling mode.
 * @module quantum/views/circuit
 */

import { Group, PathNode } from '../../core/node.js';
import { PathBuilder, polyPath, circlePath, rectPath, mergePaths } from '../../core/path.js';
import { Tex } from '../../text/nodes.js';
import { GATE_INFO } from '../../qubi/ir.js';
import { schedule as scheduleCircuit, formatAngle } from '../../qubi/index.js';
import { AnimationGroup, Create, FadeIn, lagStart } from '../../core/animations.js';
import { linear } from '../../core/easing.js';

const CATEGORY_TOKEN = {
  hadamard: 'gateHadamard',
  pauli: 'gatePauli',
  phase: 'gatePhase',
  rotation: 'gateRotation',
  controlled: 'gateControlled',
  swap: 'gateSwap',
  measure: 'gateMeasure',
  user: 'gateUser',
};

/**
 * TeX label for a gate name.
 * @param {string} name
 * @returns {string}
 */
export function gateTex(name) {
  const map = { SDG: 'S^{\\dagger}', TDG: 'T^{\\dagger}', RX: 'R_x', RY: 'R_y', RZ: 'R_z', ISWAP: 'i\\mathrm{SWAP}', SQRTSWAP: '\\sqrt{\\mathrm{SWAP}}' };
  if (map[name]) return map[name];
  if (/^[A-Z]$/.test(name)) return name;
  return `\\mathrm{${name.replace(/_/g, '\\_')}}`;
}

/**
 * TeX for an angle in the display unit.
 * @param {number} radians
 * @param {string} unit 'piradians' | 'degrees' | 'radians'
 * @param {number} decimals
 * @returns {string}
 */
export function angleTexFor(radians, unit, decimals) {
  if (unit === 'piradians' || unit === 'pirad') {
    const f = radians / Math.PI;
    for (const den of [1, 2, 3, 4, 6, 8, 12, 16, 32, 64]) {
      const num = Math.round(f * den);
      if (num !== 0 && Math.abs(f * den - num) < 1e-9) {
        const g = gcd(Math.abs(num), den);
        const n = num / g;
        const d = den / g;
        const sign = n < 0 ? '-' : '';
        const top = Math.abs(n) === 1 ? '\\pi' : `${Math.abs(n)}\\pi`;
        return d === 1 ? `${sign}${top}` : `${sign}\\tfrac{${top}}{${d}}`;
      }
    }
  }
  const s = formatAngle(radians, unit, decimals);
  return s.replace(/π/g, '\\pi').replace(/°/g, '^{\\circ}');
}

/**
 * @typedef {Object} CircuitOptions
 * @property {number} [wireGap=0.8] vertical distance between wires (world units, before Zoom)
 * @property {number} [colWidth=0.9] width of a one-gate column
 * @property {number} [gateSize=0.56] gate box side
 * @property {'box'|'outline'|'expand'} [groups='box'] stdlib and function calls as one box, as an outlined region, or fully expanded without marks
 * @property {boolean} [wireLabels=true] q_0 labels at the left
 * @property {boolean} [initialKets=false] |0> at the start of each wire
 * @property {string} [scheduling] override the Scheduling setting
 * @property {boolean} [showParams] override ShowGateParams
 * @property {boolean} [showBranches] override ShowConditionalBranches
 * @property {number} [visible] override VisibleQubits
 */

/**
 * A circuit diagram node.
 */
export class CircuitDiagram extends Group {
  /**
   * @param {import('../../qubi/ir.js').Circuit} circuit
   * @param {CircuitOptions & Record<string, any>} [opts]
   */
  constructor(circuit, opts = {}) {
    super([], { type: 'circuit' });
    this.circuit = circuit;
    const set = circuit.settings || {};
    this.zoom = set.Zoom ?? 1;
    this.wireGap = (opts.wireGap ?? 0.8) * this.zoom;
    this.colWidth = (opts.colWidth ?? 0.9) * this.zoom;
    this.gateSize = (opts.gateSize ?? 0.56) * this.zoom;
    this.groupMode = opts.groups ?? 'box';
    this.showParams = opts.showParams ?? set.ShowGateParams ?? true;
    this.showBranches = opts.showBranches ?? set.ShowConditionalBranches ?? true;
    this.showEvaluated = set.ShowEvaluatedLabels ?? true;
    this.angleUnit = set.GateParamAngleUnit ?? 'piradians';
    this.decimals = Math.min(3, set.DecimalPlaces ?? 3);
    this.visible = Math.min(circuit.numQubits, opts.visible ?? circuit.visibleQubits ?? circuit.numQubits);
    this.hidden = circuit.numQubits - this.visible;
    this.labelSize = 0.3 * this.zoom;
    this.schedule = scheduleCircuit(circuit, { mode: opts.scheduling ?? set.Scheduling ?? 'same_line' });
    this.hasClassical = circuit.ops.some((o) => o.kind === 'measure' || o.kind === 'if');
    /** Nodes per column, for build animations. @type {Array<import('../../core/node.js').Node[]>} */
    this.columnNodes = [];
    /** Wire line nodes. @type {PathNode[]} */
    this.wires = [];
    this._layout(opts);
  }

  /**
   * Local y of a wire (qubit 0 at the top).
   * @param {number} q
   * @returns {number}
   */
  wireY(q) {
    return -q * this.wireGap;
  }

  /**
   * Local x of the center of a column.
   * @param {number} c
   * @returns {number}
   */
  colX(c) {
    return this.colStart[c] + this.colWidths[c] / 2;
  }

  /**
   * World point of a column center on a wire.
   * @param {number} c
   * @param {number} q
   * @returns {[number, number]}
   */
  point(c, q) {
    const m = this.worldMatrix();
    const x = this.colX(c);
    const y = this.wireY(q);
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  /** @private */
  _layout(opts) {
    const c = this.circuit;
    const sched = this.schedule;
    const collapsed = new Map();
    if (this.groupMode === 'box') {
      for (const g of sched.groups) collapsed.set(g.id, g);
    } else {
      for (const g of sched.groups) if (g.blackbox) collapsed.set(g.id, g);
    }
    // Columns that belong entirely to a collapsed group become one box column.
    const colGroup = new Map();
    for (const g of collapsed.values()) for (let k = g.startCol; k < g.endCol; k++) colGroup.set(k, g);
    this.colWidths = sched.columns.map((ops, k) => {
      if (colGroup.has(k)) {
        const g = colGroup.get(k);
        return k === g.startCol ? Math.max(this.colWidth * 1.4, 0.3 + g.callText.length * 0.16 * this.zoom) : 0;
      }
      let w = this.colWidth;
      for (const i of ops) {
        const op = c.ops[i];
        if (op.kind === 'if' && this.showBranches) w = Math.max(w, this._branchWidth(op) + 0.3 * this.zoom);
        if (op.kind === 'gate' && this.showParams && op.params.length) w = Math.max(w, this.colWidth * (op.params.length > 1 ? 1.9 : 1.25));
      }
      return w;
    });
    const labelPad = opts.wireLabels === false ? 0.2 : 0.75 * this.zoom;
    this.colStart = [];
    let x = labelPad;
    for (const w of this.colWidths) {
      this.colStart.push(x);
      x += w;
    }
    this.diagramWidth = x + 0.35 * this.zoom;
    const nWires = this.visible;
    const classicalY = this.wireY(nWires - 1) - this.wireGap * 0.9;
    this.classicalY = classicalY;
    // Wires.
    for (let q = 0; q < nWires; q++) {
      const y = this.wireY(q);
      const wire = new PathNode(polyPath([[labelPad - 0.25 * this.zoom, y], [this.diagramWidth, y]]), { type: 'wire', stroke: 'muted', strokeWidth: 2.2, lineCap: 'butt' });
      this.wires.push(wire);
      this.add(wire);
      if (opts.wireLabels !== false) {
        const label = new Tex(opts.initialKets ? `\\lvert 0\\rangle` : `q_{${q}}`, { size: this.labelSize * 1.05, color: 'muted' });
        label.moveTo([labelPad - 0.35 * this.zoom - label.width / 2, y]);
        this.add(label);
        this.wireLabels = this.wireLabels || [];
        this.wireLabels.push(label);
      }
    }
    if (this.hasClassical) {
      const b = new PathBuilder();
      b.moveTo(labelPad - 0.25 * this.zoom, classicalY + 0.035).lineTo(this.diagramWidth, classicalY + 0.035);
      b.moveTo(labelPad - 0.25 * this.zoom, classicalY - 0.035).lineTo(this.diagramWidth, classicalY - 0.035);
      const cw = new PathNode(b.build(), { type: 'classicalWire', stroke: 'muted', strokeWidth: 1.6, lineCap: 'butt' });
      this.add(cw);
      this.classicalWire = cw;
      const lbl = new Tex('c', { size: this.labelSize * 1.05, color: 'muted' });
      lbl.moveTo([labelPad - 0.35 * this.zoom - lbl.width / 2, classicalY]);
      this.add(lbl);
    }
    if (this.hidden > 0) {
      const y = this.wireY(nWires - 1) - this.wireGap * 0.45;
      const note = new Tex(`+${this.hidden}\\ \\text{hidden}`, { size: this.labelSize * 0.8, color: 'faint' });
      note.moveTo([labelPad - 0.2 + note.width / 2, y]);
      this.add(note);
    }
    // Gates, column by column.
    sched.columns.forEach((ops, k) => {
      const nodes = [];
      if (colGroup.has(k)) {
        const g = colGroup.get(k);
        if (k === g.startCol) nodes.push(...this._groupBox(g, k));
      } else {
        for (const i of ops) nodes.push(...this._opNodes(c.ops[i], k));
      }
      for (const n of nodes) this.add(n);
      this.columnNodes.push(nodes);
    });
    if (this.groupMode === 'outline') for (const g of sched.groups) if (!collapsed.has(g.id)) this._groupOutline(g);
    for (const l of sched.loops) this._loopBracket(l);
    for (const a of sched.annotations) this._annotation(a);
    c.labels.forEach((l, i) => this._label(l, sched.labelColumns[i]));
    this.moveTo([0, 0]);
  }

  /** @private */
  _branchWidth(op) {
    let n = 0;
    for (const b of op.branches) n = Math.max(n, b.ops.length);
    n = Math.max(n, (op.elseOps || []).length);
    return Math.max(1, n) * this.colWidth + 0.2;
  }

  /** @private */
  _box(cx, y0, y1, token, meta = {}) {
    const s = this.gateSize;
    const h = Math.abs(y1 - y0) + s;
    const w = meta.width ?? s;
    return new PathNode(rectPath(cx, (y0 + y1) / 2, w, h, 0.06 * this.zoom), { type: 'gateBox', fill: 'surface', stroke: token, strokeWidth: 2.4, meta: { solidFill: true, ...meta } });
  }

  /** @private */
  _texAt(tex, x, y, size, color = 'ink') {
    const t = new Tex(tex, { size, color });
    t.moveTo([x, y]);
    return t;
  }

  /** @private */
  _visibleWires(wires) {
    return wires.filter((w) => w < this.visible);
  }

  /** @private */
  _opNodes(op, k) {
    if (op.kind === 'if') return this._ifNodes(op, k);
    return this._opNodesAt(op, this.colX(k));
  }

  /** @private */
  _opNodesAt(op, x) {
    const nodes = [];
    const targets = this._visibleWires(op.targets);
    const controls = this._visibleWires(op.controls);
    const all = targets.concat(controls);
    if (!all.length) return nodes;
    const hiddenTouched = op.targets.length + op.controls.length > all.length;
    const info = GATE_INFO[op.name];
    const token = op.kind === 'measure' ? 'gateMeasure' : op.color ? op.color : CATEGORY_TOKEN[info ? info.category : 'user'];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    if (op.kind === 'measure') {
      for (const q of targets) nodes.push(...this._meter(x, q, op));
      return nodes;
    }

    // Vertical connector for multi-wire ops.
    if (hi > lo || hiddenTouched) {
      const yEnd = hiddenTouched ? this.wireY(this.visible - 1) - this.wireGap * 0.4 : this.wireY(hi);
      nodes.push(new PathNode(polyPath([[x, this.wireY(lo)], [x, yEnd]]), { type: 'connector', stroke: 'ink', strokeWidth: 2.4, lineCap: 'butt' }));
    }
    for (const q of controls) nodes.push(new PathNode(circlePath(x, this.wireY(q), 0.085 * this.zoom), { type: 'control', fill: 'ink', stroke: null, meta: { solidFill: true } }));
    const base = op.name;
    if (base === 'CX' && !op.matrix) {
      for (const q of targets) nodes.push(this._oplus(x, this.wireY(q)));
      return nodes;
    }
    if (base === 'CZ' && !op.matrix) {
      for (const q of targets) nodes.push(new PathNode(circlePath(x, this.wireY(q), 0.085 * this.zoom), { type: 'control', fill: 'ink', stroke: null, meta: { solidFill: true } }));
      return nodes;
    }
    if ((base === 'SWAP' || base === 'CSWAP') && !op.matrix) {
      for (const q of targets) nodes.push(this._cross(x, this.wireY(q)));
      return nodes;
    }
    // Box gates: single-wire gates box their wire; multi-target gates box the target span.
    const tlo = Math.min(...targets);
    const thi = Math.max(...targets);
    const label = op.label ? `\\mathrm{${op.label}}` : gateTex(base.startsWith('C') && info && info.controlled ? info.glyph : base);
    const params = this.showParams && op.params.length && !(op.name === 'CX') ? op.params.map((p) => angleTexFor(p, this.angleUnit, this.decimals)) : [];
    const boxW = params.length ? this.gateSize * (params.length > 1 ? 2.6 : 1.7) : this.gateSize;
    if (targets.length) {
      const box = this._box(x, this.wireY(tlo), this.wireY(thi), token, { width: boxW });
      nodes.push(box);
      const ym = (this.wireY(tlo) + this.wireY(thi)) / 2;
      if (params.length) {
        nodes.push(this._texAt(label, x, ym + 0.1 * this.zoom, this.labelSize));
        nodes.push(this._texAt(params.join(',\\,'), x, ym - 0.14 * this.zoom, this.labelSize * 0.62, 'muted'));
      } else {
        nodes.push(this._texAt(label, x, ym, this.labelSize * (label.length > 6 ? 0.8 : 1)));
      }
    }
    return nodes;
  }

  /** @private */
  _oplus(x, y) {
    const r = 0.17 * this.zoom;
    const b = new PathBuilder();
    b.arc(x, y, r, 0, 2 * Math.PI).close();
    b.moveTo(x - r, y).lineTo(x + r, y);
    b.moveTo(x, y - r).lineTo(x, y + r);
    return new PathNode(b.build(), { type: 'target', fill: 'background', stroke: 'ink', strokeWidth: 2.4, meta: { solidFill: true } });
  }

  /** @private */
  _cross(x, y) {
    const r = 0.11 * this.zoom;
    const b = new PathBuilder();
    b.moveTo(x - r, y - r).lineTo(x + r, y + r);
    b.moveTo(x - r, y + r).lineTo(x + r, y - r);
    return new PathNode(b.build(), { type: 'swapCross', stroke: 'ink', strokeWidth: 2.6 });
  }

  /** @private */
  _meter(x, q, op) {
    const y = this.wireY(q);
    const s = this.gateSize;
    const box = this._box(x, y, y, 'gateMeasure');
    const arc = new PathBuilder().arc(x, y - s * 0.16, s * 0.3, Math.PI * 0.05, Math.PI * 0.95).build();
    const needle = polyPath([[x, y - s * 0.16], [x + s * 0.22, y + s * 0.22]]);
    const glyph = new PathNode(mergePaths(arc, needle), { type: 'meter', stroke: 'ink', strokeWidth: 2 });
    const nodes = [box, glyph];
    if (this.hasClassical) {
      const d = 0.035;
      const yb = this.classicalY;
      const line = new PathBuilder();
      line.moveTo(x - d, y - s / 2).lineTo(x - d, yb + 0.02);
      line.moveTo(x + d, y - s / 2).lineTo(x + d, yb + 0.02);
      nodes.push(new PathNode(line.build(), { type: 'classicalDrop', stroke: 'muted', strokeWidth: 1.6, lineCap: 'butt', zIndex: -1 }));
      const tip = polyPath([[x - 0.07, yb + 0.1], [x + 0.07, yb + 0.1], [x, yb + 0.01]], true);
      nodes.push(new PathNode(tip, { type: 'classicalTip', fill: 'muted', stroke: null, meta: { solidFill: true } }));
      const key = `${Math.round(x * 1000)}`;
      this.registerLabels = this.registerLabels || new Map();
      if (op.register && !this.registerLabels.has(key)) {
        this.registerLabels.set(key, true);
        const m = /^([A-Za-z_]\w*)(?:\[(\d+)\])?$/.exec(op.register);
        const tex = m ? `\\mathit{${m[1].replace(/_/g, '\\_')}}${m[2] != null ? `_{${m[2]}}` : ''}` : `\\text{${escapeTex(op.register)}}`;
        nodes.push(this._texAt(tex, x + 0.2 * this.zoom, yb - 0.2 * this.zoom, this.labelSize * 0.62, 'muted'));
      }
    }
    return nodes;
  }

  /** @private */
  _ifNodes(op, k) {
    const x0 = this.colStart[k] + 0.15 * this.zoom;
    const x1 = this.colStart[k] + this.colWidths[k] - 0.15 * this.zoom;
    const wires = this._visibleWires(op.targets.concat(op.controls));
    const branchWires = new Set(wires);
    for (const b of op.branches) for (const o of b.ops) for (const w of o.targets.concat(o.controls)) if (w < this.visible) branchWires.add(w);
    for (const o of op.elseOps || []) for (const w of o.targets.concat(o.controls)) if (w < this.visible) branchWires.add(w);
    const ws = [...branchWires];
    if (!ws.length) return [];
    const lo = Math.min(...ws);
    const hi = Math.max(...ws);
    const nodes = [];
    const top = this.wireY(lo) + this.gateSize * 0.75;
    const bottom = this.wireY(hi) - this.gateSize * 0.75;
    const frame = new PathNode(rectPath((x0 + x1) / 2, (top + bottom) / 2, x1 - x0, top - bottom, 0.08), { type: 'ifFrame', stroke: 'faint', strokeWidth: 1.8, dash: [0.08, 0.06], meta: { noOvershoot: true } });
    nodes.push(frame);
    const cond = op.branches.map((b) => b.condText).join('\\;\\text{or}\\;');
    const condTex = `\\text{if } ${texifyCondition(op.branches[0]?.condText ?? '')}`;
    nodes.push(this._texAt(op.branches.length > 1 ? `\\text{if } ${texifyCondition(cond)}` : condTex, (x0 + x1) / 2, top + 0.2 * this.zoom, this.labelSize * 0.7, 'muted'));
    if (this.hasClassical) {
      const xm = (x0 + x1) / 2;
      const d = 0.035;
      const line = new PathBuilder();
      line.moveTo(xm - d, bottom).lineTo(xm - d, this.classicalY);
      line.moveTo(xm + d, bottom).lineTo(xm + d, this.classicalY);
      nodes.push(new PathNode(line.build(), { type: 'classicalDrop', stroke: 'muted', strokeWidth: 1.6, lineCap: 'butt' }));
      nodes.push(new PathNode(circlePath(xm, this.classicalY, 0.06), { type: 'classicalDot', fill: 'muted', stroke: null, meta: { solidFill: true } }));
    }
    if (this.showBranches) {
      const inner = op.branches[0] ? op.branches[0].ops : [];
      inner.forEach((o, j) => nodes.push(...this._opNodesAt(o, x0 + 0.1 + this.colWidth * (j + 0.5))));
    }
    return nodes;
  }

  /** @private */
  _groupBox(g, k) {
    const wires = this._visibleWires(g.wires);
    if (!wires.length) return [];
    const x = this.colX(k);
    const lo = Math.min(...wires);
    const hi = Math.max(...wires);
    const w = this.colWidths[k] - 0.18 * this.zoom;
    const box = this._box(x, this.wireY(lo), this.wireY(hi), 'gateUser', { width: w });
    const label = this._texAt(`\\mathrm{${escapeTex(g.name)}}`, x, (this.wireY(lo) + this.wireY(hi)) / 2 + (hi > lo ? 0.12 : 0), this.labelSize);
    const nodes = [box, label];
    if (hi > lo) nodes.push(this._texAt(`\\mathtt{${escapeTex(argsOf(g.callText))}}`, x, (this.wireY(lo) + this.wireY(hi)) / 2 - 0.2 * this.zoom, this.labelSize * 0.6, 'muted'));
    return nodes;
  }

  /** @private */
  _groupOutline(g) {
    const wires = this._visibleWires(g.wires);
    if (!wires.length) return;
    const x0 = this.colStart[g.startCol] + 0.06;
    const x1 = this.colStart[g.endCol - 1] + this.colWidths[g.endCol - 1] - 0.06;
    const top = this.wireY(Math.min(...wires)) + this.gateSize * 0.8;
    const bottom = this.wireY(Math.max(...wires)) - this.gateSize * 0.8;
    const r = new PathNode(rectPath((x0 + x1) / 2, (top + bottom) / 2, x1 - x0, top - bottom, 0.1), { type: 'groupOutline', stroke: 'faint', strokeWidth: 1.8, dash: [0.1, 0.07], zIndex: -1 });
    this.add(r);
    const t = this._texAt(`\\mathrm{${escapeTex(g.callText)}}`, x0 + 0.1, top + 0.2 * this.zoom, this.labelSize * 0.7, 'muted');
    t.shift(t.width / 2, 0);
    this.add(t);
  }

  /** @private */
  _loopBracket(l) {
    const x0 = this.colStart[l.startCol] + 0.08;
    const x1 = this.colStart[l.endCol - 1] + this.colWidths[l.endCol - 1] - 0.08;
    const y = this.wireY(0) + this.gateSize * 0.95;
    const b = new PathBuilder();
    b.moveTo(x0, y - 0.12).lineTo(x0, y).lineTo(x1, y).lineTo(x1, y - 0.12);
    this.add(new PathNode(b.build(), { type: 'loopBracket', stroke: 'muted', strokeWidth: 1.8 }));
    const txt = `\\text{${escapeTex(l.headerText)}}\\;\\times ${l.iterations}`;
    this.add(this._texAt(txt, (x0 + x1) / 2, y + 0.2 * this.zoom, this.labelSize * 0.66, 'muted'));
  }

  /** @private */
  _annotation(a) {
    const wires = this._visibleWires(a.wires);
    if (!wires.length || a.endCol <= a.startCol) return;
    const x0 = this.colStart[a.startCol] + 0.04;
    const x1 = this.colStart[a.endCol - 1] + this.colWidths[a.endCol - 1] - 0.04;
    const top = this.wireY(Math.min(...wires)) + this.gateSize * 0.85;
    const bottom = this.wireY(Math.max(...wires)) - this.gateSize * 0.85;
    this.add(new PathNode(rectPath((x0 + x1) / 2, (top + bottom) / 2, x1 - x0, top - bottom, 0.12), { type: 'annotation', stroke: 'accent', strokeWidth: 2, strokeOpacity: 0.7, dash: [0.12, 0.08], zIndex: -1 }));
    const t = this._texAt(`\\text{${escapeTex(a.id)}}`, x0, top + 0.2 * this.zoom, this.labelSize * 0.66, 'accent');
    t.shift(t.width / 2 + 0.08, 0);
    this.add(t);
  }

  /** @private */
  _label(l, col) {
    const wires = this._visibleWires(l.wires);
    if (!wires.length) return;
    const x = col < this.colStart.length ? this.colStart[col] : this.diagramWidth - 0.35;
    const top = this.wireY(Math.min(...wires)) + this.gateSize * 0.7;
    const bottom = this.wireY(Math.max(...wires)) - this.gateSize * 0.7;
    this.add(new PathNode(polyPath([[x, top], [x, bottom]]), { type: 'labelRule', stroke: 'faint', strokeWidth: 1.6, dash: [0.06, 0.06] }));
    const text = this.showEvaluated ? l.text : l.rawText;
    const t = this._texAt(`\\text{${escapeTex(text)}}`, x, top + 0.18 * this.zoom, this.labelSize * 0.7, 'muted');
    this.add(t);
  }

  /**
   * Animation that builds the circuit column by column: wires draw first,
   * then each column's gates appear in order.
   * @param {Record<string, any>} [opts] duration (default scales with columns)
   * @returns {import('../../core/animations.js').Animation}
   */
  build(opts = {}) {
    const cols = this.columnNodes.filter((c) => c.length);
    const wireAnim = new AnimationGroup(this.wires.map((w) => new Create(w)).concat(this.classicalWire ? [new Create(this.classicalWire)] : []), { duration: 0.8 });
    const rest = this.children.filter((n) => !this.wires.includes(n) && n !== this.classicalWire && !cols.flat().includes(n));
    const colAnims = cols.map((nodes) => new AnimationGroup(nodes.map((n) => (n.type === 'tex' ? new FadeIn(n) : new Create(n))), { duration: 0.5 }));
    const labels = rest.length ? [new AnimationGroup(rest.map((n) => new FadeIn(n)), { duration: 0.6 })] : [];
    return lagStart([wireAnim, ...colAnims, ...labels], { lagRatio: 0.35, duration: opts.duration ?? Math.min(6, 1.2 + cols.length * 0.35) });
  }
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

function escapeTex(s) {
  return String(s).replace(/\\/g, '\\textbackslash ').replace(/([#$%&_{}])/g, '\\$1').replace(/\^/g, '\\textasciicircum ').replace(/~/g, '\\textasciitilde ');
}

function argsOf(callText) {
  const i = callText.indexOf('(');
  return i >= 0 ? callText.slice(i) : callText;
}

function texifyCondition(c) {
  return String(c)
    .replace(/&&/g, '\\land ')
    .replace(/\|\|/g, '\\lor ')
    .replace(/==/g, '=')
    .replace(/!=/g, '\\neq ')
    .replace(/>=/g, '\\geq ')
    .replace(/<=/g, '\\leq ')
    .replace(/0b([01]+)/g, '\\mathtt{$1}')
    .replace(/\b([A-Za-z_]\w*)\b/g, (m) => (m === 'mathtt' ? m : `\\mathit{${m.replace(/_/g, '\\_')}}`));
}

/**
 * Time cursor for execution animations: a vertical line that sweeps across
 * the columns of a circuit diagram.
 */
export class ExecutionCursor extends PathNode {
  /** @param {CircuitDiagram} diagram */
  constructor(diagram) {
    const top = diagram.wireY(0) + diagram.gateSize * 0.9;
    const bottom = (diagram.hasClassical ? diagram.classicalY : diagram.wireY(diagram.visible - 1)) - diagram.gateSize * 0.6;
    super(polyPath([[0, top], [0, bottom]]), { type: 'cursor', stroke: 'accent', strokeWidth: 3, strokeOpacity: 0.85, zIndex: 5 });
    this.diagram = diagram;
    this.set('x', diagram.colStart[0] - 0.05);
    diagram.add(this);
  }

  /**
   * Local x just after column k (k = -1 is before the first column).
   * @param {number} k
   * @returns {number}
   */
  xAfter(k) {
    const d = this.diagram;
    if (k < 0) return d.colStart[0] - 0.05;
    return d.colStart[k] + d.colWidths[k];
  }

  /**
   * Tween the cursor to just after column k.
   * @param {number} k
   * @param {Record<string, any>} [opts]
   * @returns {any}
   */
  to(k, opts = {}) {
    return this.animate.set('x', this.xAfter(k)).with({ ease: linear, ...opts });
  }
}
