/**
 * Primitive shapes. Each shape is a Node whose geometry is generated from
 * tracked properties, so animating `radius` or `width` reshapes it smoothly.
 * Shapes are centered on their local origin; position with x and y.
 * @module core/shapes
 */

import { Node, Group, PathNode } from './node.js';
import { registerNodeClasses } from './animations.js';
import {
  PathBuilder, circlePath, ellipsePath, polyPath, rectPath, parseSVGPath, emptyPath, pathBounds, transformPath,
  pointAtFraction,
} from './path.js';

/**
 * Shape with geometry computed by a function of its properties.
 */
export class Shape extends Node {
  /**
   * @param {string} type
   * @param {Record<string, any>} defaults Tracked geometry properties with default values.
   * @param {Record<string, any>} props
   */
  constructor(type, defaults, props) {
    super(type, { stroke: 'ink', ...stripGeometry(props, defaults) });
    for (const [k, v] of Object.entries(defaults)) this._define(k, props[k] ?? v);
  }

  /**
   * Shorthand for reading several geometry properties.
   * @param {...string} keys
   * @returns {any[]}
   */
  g(...keys) {
    return keys.map((k) => this.get(k));
  }
}

function stripGeometry(props, defaults) {
  const out = {};
  for (const [k, v] of Object.entries(props)) if (!(k in defaults)) out[k] = v;
  return out;
}

/** Filled dot. */
export class Dot extends Shape {
  /** @param {Record<string, any>} [props] radius (default 0.08) */
  constructor(props = {}) {
    super('dot', { radius: 0.08 }, { fill: 'ink', stroke: null, ...props });
  }

  geometry() {
    return circlePath(0, 0, this.get('radius'));
  }
}

/** Circle. */
export class Circle extends Shape {
  /** @param {Record<string, any>} [props] radius (default 1) */
  constructor(props = {}) {
    super('circle', { radius: 1 }, props);
  }

  geometry() {
    return circlePath(0, 0, this.get('radius'));
  }

  /**
   * World point on the circle at an angle.
   * @param {number} angle radians
   * @returns {[number, number]}
   */
  pointAt(angle) {
    const r = this.get('radius') * this.get('scaleX');
    const [cx, cy] = this.center();
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }
}

/** Ellipse. */
export class Ellipse extends Shape {
  /** @param {Record<string, any>} [props] rx, ry */
  constructor(props = {}) {
    super('ellipse', { rx: 1.5, ry: 1 }, props);
  }

  geometry() {
    return ellipsePath(0, 0, this.get('rx'), this.get('ry'));
  }
}

/** Circular arc from startAngle to endAngle (radians, counterclockwise). */
export class Arc extends Shape {
  /** @param {Record<string, any>} [props] radius, startAngle, endAngle */
  constructor(props = {}) {
    super('arc', { radius: 1, startAngle: 0, endAngle: Math.PI / 2 }, props);
  }

  geometry() {
    const [r, a0, a1] = this.g('radius', 'startAngle', 'endAngle');
    return new PathBuilder().arc(0, 0, r, a0, a1).build();
  }
}

/** Annular sector (a wedge of a ring), for pie charts and angle markers. */
export class Sector extends Shape {
  /** @param {Record<string, any>} [props] innerRadius, outerRadius, startAngle, endAngle */
  constructor(props = {}) {
    super('sector', { innerRadius: 0, outerRadius: 1, startAngle: 0, endAngle: Math.PI / 2 }, { fill: 'accent', stroke: null, ...props });
  }

  geometry() {
    const [ri, ro, a0, a1] = this.g('innerRadius', 'outerRadius', 'startAngle', 'endAngle');
    const b = new PathBuilder();
    b.arc(0, 0, ro, a0, a1);
    if (ri > 0) b.arc(0, 0, ri, a1, a0);
    else b.lineTo(0, 0);
    return b.close().build();
  }
}

/** Rectangle with optional corner radius. */
export class Rect extends Shape {
  /** @param {Record<string, any>} [props] width, height, radius */
  constructor(props = {}) {
    super('rect', { width: 2, height: 1, radius: 0 }, props);
  }

  geometry() {
    const [w, h, r] = this.g('width', 'height', 'radius');
    return rectPath(0, 0, w, h, r);
  }
}

/** Closed polygon through points (local coordinates). */
export class Polygon extends Shape {
  /** @param {Array<[number, number]>} points @param {Record<string, any>} [props] */
  constructor(points, props = {}) {
    super('polygon', {}, props);
    this.points = points;
  }

  geometry() {
    return polyPath(this.points, true);
  }
}

/** Open polyline through points (local coordinates). */
export class Polyline extends Shape {
  /** @param {Array<[number, number]>} points @param {Record<string, any>} [props] */
  constructor(points, props = {}) {
    super('polyline', {}, props);
    this.points = points;
  }

  geometry() {
    return polyPath(this.points, false);
  }
}

/** Regular polygon with n sides. */
export class RegularPolygon extends Shape {
  /** @param {Record<string, any>} [props] sides, radius, startAngle */
  constructor(props = {}) {
    super('regularPolygon', { sides: 6, radius: 1, startAngle: Math.PI / 2 }, props);
  }

  geometry() {
    const [n, r, a0] = this.g('sides', 'radius', 'startAngle');
    const k = Math.max(3, Math.round(n));
    const pts = [];
    for (let i = 0; i < k; i++) {
      const a = a0 + (2 * Math.PI * i) / k;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return polyPath(pts, true);
  }
}

/** Star with n points. */
export class Star extends Shape {
  /** @param {Record<string, any>} [props] points, outerRadius, innerRadius */
  constructor(props = {}) {
    super('star', { points: 5, outerRadius: 1, innerRadius: 0.45, startAngle: Math.PI / 2 }, props);
  }

  geometry() {
    const [n, ro, ri, a0] = this.g('points', 'outerRadius', 'innerRadius', 'startAngle');
    const k = Math.max(2, Math.round(n));
    const pts = [];
    for (let i = 0; i < 2 * k; i++) {
      const r = i % 2 === 0 ? ro : ri;
      const a = a0 + (Math.PI * i) / k;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return polyPath(pts, true);
  }
}

/** Straight line between two points (tracked as x1, y1, x2, y2 in local space). */
export class Line extends Shape {
  /**
   * @param {number[]} [from=[-1,0]]
   * @param {number[]} [to=[1,0]]
   * @param {Record<string, any>} [props]
   */
  constructor(from = [-1, 0], to = [1, 0], props = {}) {
    super(props.type ?? 'line', { x1: from[0], y1: from[1], x2: to[0], y2: to[1] }, props);
  }

  geometry() {
    const [x1, y1, x2, y2] = this.g('x1', 'y1', 'x2', 'y2');
    return polyPath([[x1, y1], [x2, y2]]);
  }

  /** Set both endpoints. @param {number[]} a @param {number[]} b @returns {this} */
  putStartAndEnd(a, b) {
    this.set({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
    return this;
  }

  /** @returns {[number, number]} */
  get start() {
    return [this.get('x1'), this.get('y1')];
  }

  /** @returns {[number, number]} */
  get end() {
    return [this.get('x2'), this.get('y2')];
  }
}

/** Arrow head styles. */
export const ARROW_HEADS = ['triangle', 'stealth', 'open', 'line', 'round', 'square', 'diamond', 'bar', 'none'];

/**
 * Head outline in local head coordinates: tip at the origin pointing +x,
 * size is head length.
 * @param {string} style
 * @param {number} L length
 * @param {number} W width
 * @returns {{path: import('./path.js').Path, filled: boolean, back: number}}
 */
function headShape(style, L, W) {
  switch (style) {
    case 'none':
      return { path: emptyPath(), filled: false, back: 0 };
    case 'stealth':
      return { path: polyPath([[0, 0], [-L, W / 2], [-L * 0.7, 0], [-L, -W / 2]], true), filled: true, back: L * 0.7 };
    case 'open':
      return { path: polyPath([[-L, W / 2], [0, 0], [-L, -W / 2]]), filled: false, back: 0 };
    case 'line':
      return { path: polyPath([[-L * 0.8, W * 0.55], [0, 0], [-L * 0.8, -W * 0.55]]), filled: false, back: 0 };
    case 'round':
      return { path: circlePath(-W / 2, 0, W / 2), filled: true, back: W / 2 };
    case 'square':
      return { path: rectPath(-W / 2, 0, W, W), filled: true, back: W / 2 };
    case 'diamond':
      return { path: polyPath([[0, 0], [-L / 2, W / 2], [-L, 0], [-L / 2, -W / 2]], true), filled: true, back: L };
    case 'bar':
      return { path: polyPath([[0, W / 2], [0, -W / 2]]), filled: false, back: 0 };
    case 'triangle':
    default:
      return { path: polyPath([[0, 0], [-L, W / 2], [-L, -W / 2]], true), filled: true, back: L * 0.9 };
  }
}

class ArrowHead extends Node {
  constructor(which, props) {
    super('arrowHead', props);
    this.which = which;
  }

  geometry() {
    return this.parent ? this.parent._headGeometry(this.which) : null;
  }
}

class ArrowShaft extends Node {
  constructor(props) {
    super('arrowShaft', props);
  }

  geometry() {
    return this.parent ? this.parent._shaftGeometry() : null;
  }
}

/**
 * Arrow from one point to another, straight or curved, with a head at the end
 * (and optionally the start). Endpoints and bend are tracked, so arrows can be
 * animated by moving their ends.
 */
export class Arrow extends Group {
  /**
   * @param {number[]} [from=[-1,0]]
   * @param {number[]} [to=[1,0]]
   * @param {Record<string, any>} [props] head, tail (head styles), headLength, headWidth, bend (radians of arc sweep, 0 for straight), buff
   */
  constructor(from = [-1, 0], to = [1, 0], props = {}) {
    super([], { type: props.type ?? 'arrow' });
    this._define('x1', from[0]);
    this._define('y1', from[1]);
    this._define('x2', to[0]);
    this._define('y2', to[1]);
    this._define('bend', props.bend ?? 0);
    this._define('headLength', props.headLength ?? 0.24);
    this._define('headWidth', props.headWidth ?? 0.2);
    this._define('buff', props.buff ?? 0);
    this.headStyle = props.head ?? 'triangle';
    this.tailStyle = props.tail ?? 'none';
    const color = props.color ?? props.stroke ?? 'ink';
    const sw = props.strokeWidth ?? 4;
    this.shaft = new ArrowShaft({ stroke: color, strokeWidth: sw, fill: null });
    this.add(this.shaft);
    for (const which of ['head', 'tail']) {
      const style = which === 'head' ? this.headStyle : this.tailStyle;
      if (style === 'none') continue;
      const filled = headShape(style, 1, 1).filled;
      const h = new ArrowHead(which, filled ? { fill: color, stroke: null } : { stroke: color, strokeWidth: sw, fill: null });
      this[which] = h;
      this.add(h);
    }
    if (props.opacity != null) this.set('opacity', props.opacity);
  }

  /** @private */
  _ends() {
    let [x1, y1, x2, y2] = [this.get('x1'), this.get('y1'), this.get('x2'), this.get('y2')];
    const buff = this.get('buff');
    if (buff > 0) {
      const L = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ux = (x2 - x1) / L;
      const uy = (y2 - y1) / L;
      x1 += ux * buff;
      y1 += uy * buff;
      x2 -= ux * buff;
      y2 -= uy * buff;
    }
    return [x1, y1, x2, y2];
  }

  /** Full centerline path from start to end (curved when bend is nonzero). @returns {import('./path.js').Path} */
  centerline() {
    const [x1, y1, x2, y2] = this._ends();
    const bend = this.get('bend');
    if (Math.abs(bend) < 1e-6) return polyPath([[x1, y1], [x2, y2]]);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const chord = Math.hypot(dx, dy);
    const r = chord / (2 * Math.sin(Math.abs(bend) / 2));
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
    const nx = -dy / chord;
    const ny = dx / chord;
    const sgn = bend > 0 ? -1 : 1;
    const cx = mx + sgn * nx * h;
    const cy = my + sgn * ny * h;
    const a0 = Math.atan2(y1 - cy, x1 - cx);
    let a1 = Math.atan2(y2 - cy, x2 - cx);
    if (bend > 0) while (a1 < a0) a1 += 2 * Math.PI;
    else while (a1 > a0) a1 -= 2 * Math.PI;
    return new PathBuilder().arc(cx, cy, r, a0, a1).build();
  }

  /** @private */
  _headPlacement(which) {
    const c = this.centerline();
    const f = which === 'head' ? 1 : 0;
    const [x, y, ang] = pointAtFraction(c, f);
    return { x, y, ang: which === 'head' ? ang : ang + Math.PI };
  }

  /** @private */
  _headGeometry(which) {
    const style = which === 'head' ? this.headStyle : this.tailStyle;
    const { x, y, ang } = this._headPlacement(which);
    const L = this.get('headLength');
    const W = this.get('headWidth');
    const { path } = headShape(style, L, W);
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    return transformPath(path, [cos, sin, -sin, cos, x, y]);
  }

  /** @private */
  _shaftGeometry() {
    const c = this.centerline();
    const L = this.get('headLength');
    const W = this.get('headWidth');
    const total = pathLengthFast(c);
    if (total === 0) return c;
    const cut = (style) => (style === 'none' ? 0 : headShape(style, L, W).back);
    const a = Math.min(0.45, cut(this.tailStyle) / total);
    const b = Math.max(0.55, 1 - cut(this.headStyle) / total);
    return trimPath(c, a, b);
  }

  /** @returns {[number, number]} */
  get start() {
    return [this.get('x1'), this.get('y1')];
  }

  /** @returns {[number, number]} */
  get end() {
    return [this.get('x2'), this.get('y2')];
  }

  /** Set both endpoints. @param {number[]} a @param {number[]} b @returns {this} */
  putStartAndEnd(a, b) {
    this.set({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
    return this;
  }

  setColor(color) {
    for (const n of this.children) {
      if (n.get('fill') != null) n.set('fill', color);
      if (n.get('stroke') != null) n.set('stroke', color);
    }
    return this;
  }
}

function pathLengthFast(p) {
  let L = 0;
  for (const s of p.subpaths) {
    const q = s.points;
    for (let i = 0; i + 7 < q.length; i += 6) L += Math.hypot(q[i + 6] - q[i], q[i + 7] - q[i + 1]);
  }
  return L;
}

function trimPath(p, a, b) {
  const s = p.subpaths[0];
  if (!s) return p;
  if (s.points.length === 8 && Math.abs(s.points[2] - (s.points[0] + (s.points[6] - s.points[0]) / 3)) < 1e-9) {
    const [x0, y0] = [s.points[0], s.points[1]];
    const [x1, y1] = [s.points[6], s.points[7]];
    return polyPath([[x0 + (x1 - x0) * a, y0 + (y1 - y0) * a], [x0 + (x1 - x0) * b, y0 + (y1 - y0) * b]]);
  }
  const out = [];
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const [x, y] = pointAtFraction(p, a + ((b - a) * i) / N);
    out.push([x, y]);
  }
  return catmullRomPath(out, false);
}

/** Double-headed arrow. */
export class DoubleArrow extends Arrow {
  /** @param {number[]} [from] @param {number[]} [to] @param {Record<string, any>} [props] */
  constructor(from, to, props = {}) {
    super(from, to, { type: 'doubleArrow', tail: props.head ?? 'triangle', ...props });
  }
}

/** Curved arrow: an arrow with a default bend. */
export class CurvedArrow extends Arrow {
  /** @param {number[]} [from] @param {number[]} [to] @param {Record<string, any>} [props] */
  constructor(from, to, props = {}) {
    super(from, to, { type: 'curvedArrow', bend: Math.PI / 3, ...props });
  }
}

/**
 * Curly brace spanning from a to b, bulging to the right of the direction
 * a to b (use `flip` to bulge the other way).
 */
export class Brace extends Shape {
  /**
   * @param {number[]} a
   * @param {number[]} b
   * @param {Record<string, any>} [props] depth, flip
   */
  constructor(a, b, props = {}) {
    super('brace', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], depth: props.depth ?? 0.18 }, { fill: 'ink', stroke: null, ...props });
    this.flip = !!props.flip;
  }

  geometry() {
    const [x1, y1, x2, y2, depth] = this.g('x1', 'y1', 'x2', 'y2', 'depth');
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L === 0) return emptyPath();
    // Brace drawn along +x from 0 to L, bulging toward -y, then rotated into place.
    const d = depth;
    const t = Math.min(0.035, L * 0.012) + 0.012;
    const h = L / 2;
    const b = new PathBuilder();
    b.moveTo(0, 0);
    b.cubicTo(0, -d * 0.55, d * 0.35, -d * 0.5, Math.min(h * 0.45, d * 1.4), -d * 0.5);
    b.lineTo(h - d * 0.9, -d * 0.5);
    b.cubicTo(h - d * 0.3, -d * 0.5, h - t, -d * 0.62, h, -d * 1.05);
    b.cubicTo(h + t, -d * 0.62, h + d * 0.3, -d * 0.5, h + d * 0.9, -d * 0.5);
    b.lineTo(L - Math.min(h * 0.45, d * 1.4), -d * 0.5);
    b.cubicTo(L - d * 0.35, -d * 0.5, L, -d * 0.55, L, 0);
    b.lineTo(L, -t * 1.5);
    b.cubicTo(L, -d * 0.45 + t, L - d * 0.35, -d * 0.5 + t, L - Math.min(h * 0.45, d * 1.4), -d * 0.5 + t);
    b.lineTo(h + d * 0.9, -d * 0.5 + t);
    b.cubicTo(h + d * 0.3, -d * 0.5 + t, h + t * 0.5, -d * 0.6 + t, h, -d * 1.05 + t * 2.2);
    b.cubicTo(h - t * 0.5, -d * 0.6 + t, h - d * 0.3, -d * 0.5 + t, h - d * 0.9, -d * 0.5 + t);
    b.lineTo(Math.min(h * 0.45, d * 1.4), -d * 0.5 + t);
    b.cubicTo(d * 0.35, -d * 0.5 + t, 0, -d * 0.45 + t, 0, -t * 1.5);
    b.close();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const flip = this.flip ? -1 : 1;
    return transformPath(b.build(), [cos, sin, -sin * flip, cos * flip, x1, y1]);
  }

  /**
   * World point just beyond the brace tip, for placing a label.
   * @param {number} [gap=0.2]
   * @returns {[number, number]}
   */
  tip(gap = 0.2) {
    const [x1, y1, x2, y2, depth] = this.g('x1', 'y1', 'x2', 'y2', 'depth');
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    const flip = this.flip ? -1 : 1;
    const nx = ((y2 - y1) / L) * flip;
    const ny = (-(x2 - x1) / L) * flip;
    const m = this.worldMatrix();
    const px = (x1 + x2) / 2 + nx * (depth * 1.05 + gap);
    const py = (y1 + y2) / 2 + ny * (depth * 1.05 + gap);
    return [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]];
  }
}

/**
 * Brace under (or beside) a node's bounds.
 * @param {Node} node
 * @param {string} [side='bottom'] 'bottom' | 'top' | 'left' | 'right'
 * @param {Record<string, any>} [props]
 * @returns {Brace}
 */
export function braceFor(node, side = 'bottom', props = {}) {
  const b = node.bounds();
  const gap = props.gap ?? 0.12;
  if (!b) throw new Error('braceFor needs a node with geometry');
  const map = {
    bottom: [[b.x + b.w, b.y - gap], [b.x, b.y - gap]],
    top: [[b.x, b.y + b.h + gap], [b.x + b.w, b.y + b.h + gap]],
    left: [[b.x - gap, b.y], [b.x - gap, b.y + b.h]],
    right: [[b.x + b.w + gap, b.y + b.h], [b.x + b.w + gap, b.y]],
  };
  const [a, c] = map[side];
  return new Brace(a, c, props);
}

/** Path node from an SVG `d` string. */
export class SVGPathShape extends PathNode {
  /** @param {string} d @param {Record<string, any>} [props] */
  constructor(d, props = {}) {
    super(parseSVGPath(d), { type: 'svgPath', ...props });
    this.d = d;
  }
}

/**
 * Bezier curve of any order through control points. Orders 1 to 3 are exact;
 * higher orders are split with de Casteljau into pieces that are converted to
 * cubics by least-squares fitting at 1e-4 relative tolerance.
 */
export class Bezier extends Shape {
  /** @param {Array<[number, number]>} controls @param {Record<string, any>} [props] */
  constructor(controls, props = {}) {
    super('bezier', {}, props);
    if (controls.length < 2) throw new Error('A Bezier curve needs at least two control points');
    this.controls = controls;
  }

  geometry() {
    return bezierPath(this.controls);
  }
}

/**
 * Exact or fitted cubic path for a Bezier of arbitrary order.
 * @param {Array<[number, number]>} c
 * @returns {import('./path.js').Path}
 */
export function bezierPath(c) {
  const b = new PathBuilder().moveTo(c[0][0], c[0][1]);
  if (c.length === 2) b.lineTo(c[1][0], c[1][1]);
  else if (c.length === 3) b.quadTo(c[1][0], c[1][1], c[2][0], c[2][1]);
  else if (c.length === 4) b.cubicTo(c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]);
  else {
    const n = c.length - 1;
    const pieces = Math.max(2, n);
    const evalAt = (t) => {
      const pts = c.map((p) => p.slice());
      for (let r = 1; r <= n; r++) for (let i = 0; i <= n - r; i++) pts[i] = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
      return pts[0];
    };
    const deriv = (t) => {
      const pts = c.map((p, i) => (i < n ? [n * (c[i + 1][0] - p[0]), n * (c[i + 1][1] - p[1])] : null)).slice(0, n);
      for (let r = 1; r < n; r++) for (let i = 0; i < n - r; i++) pts[i] = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
      return pts[0];
    };
    for (let k = 0; k < pieces; k++) {
      const t0 = k / pieces;
      const t1 = (k + 1) / pieces;
      const h = (t1 - t0) / 3;
      const p0 = evalAt(t0);
      const p3 = evalAt(t1);
      const d0 = deriv(t0);
      const d1 = deriv(t1);
      b.cubicTo(p0[0] + d0[0] * h, p0[1] + d0[1] * h, p3[0] - d1[0] * h, p3[1] - d1[1] * h, p3[0], p3[1]);
    }
  }
  return b.build();
}

/**
 * Catmull-Rom spline through points as cubic segments.
 * @param {Array<[number, number]>} pts
 * @param {boolean} [closed=false]
 * @param {number} [tension=0.5] 0.5 is the centripetal-looking default
 * @returns {import('./path.js').Path}
 */
export function catmullRomPath(pts, closed = false, tension = 0.5) {
  if (pts.length < 2) return emptyPath();
  const n = pts.length;
  const get = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const b = new PathBuilder().moveTo(pts[0][0], pts[0][1]);
  const segs = closed ? n : n - 1;
  const k = tension / 3 / 0.5;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    b.cubicTo(
      p1[0] + ((p2[0] - p0[0]) * k) / 2, p1[1] + ((p2[1] - p0[1]) * k) / 2,
      p2[0] - ((p3[0] - p1[0]) * k) / 2, p2[1] - ((p3[1] - p1[1]) * k) / 2,
      p2[0], p2[1],
    );
  }
  if (closed) b.close();
  return b.build();
}

/**
 * Uniform cubic B-spline with the given control points, converted exactly to
 * Bezier segments.
 * @param {Array<[number, number]>} pts
 * @param {boolean} [closed=false]
 * @returns {import('./path.js').Path}
 */
export function bSplinePath(pts, closed = false) {
  const n = pts.length;
  if (n < 2) return emptyPath();
  if (n < 4 && !closed) return catmullRomPath(pts, false);
  const P = closed ? (i) => pts[((i % n) + n) % n] : (i) => pts[Math.max(0, Math.min(n - 1, i))];
  const first = closed ? 0 : -2;
  const last = closed ? n : n - 1;
  const b = new PathBuilder();
  for (let i = first; i < last; i++) {
    const p0 = P(i);
    const p1 = P(i + 1);
    const p2 = P(i + 2);
    const p3 = P(i + 3);
    const s = [(p0[0] + 4 * p1[0] + p2[0]) / 6, (p0[1] + 4 * p1[1] + p2[1]) / 6];
    const c1 = [(2 * p1[0] + p2[0]) / 3, (2 * p1[1] + p2[1]) / 3];
    const c2 = [(p1[0] + 2 * p2[0]) / 3, (p1[1] + 2 * p2[1]) / 3];
    const e = [(p1[0] + 4 * p2[0] + p3[0]) / 6, (p1[1] + 4 * p2[1] + p3[1]) / 6];
    if (i === first) b.moveTo(s[0], s[1]);
    b.cubicTo(c1[0], c1[1], c2[0], c2[1], e[0], e[1]);
  }
  if (closed) b.close();
  return b.build();
}

/** Smooth spline through or guided by points. */
export class Spline extends Shape {
  /**
   * @param {Array<[number, number]>} points
   * @param {Record<string, any>} [props] kind: 'catmull-rom' | 'b-spline', closed, tension
   */
  constructor(points, props = {}) {
    super('spline', {}, props);
    this.points = points;
    this.kind = props.kind ?? 'catmull-rom';
    this.closed = !!props.closed;
    this.tension = props.tension ?? 0.5;
  }

  geometry() {
    return this.kind === 'b-spline' ? bSplinePath(this.points, this.closed) : catmullRomPath(this.points, this.closed, this.tension);
  }
}

/**
 * Image placed in world units. `source` is an asset id registered on the
 * scene, a URL, or an already decoded image.
 */
export class ImageNode extends Node {
  /**
   * @param {any} source
   * @param {Record<string, any>} [props] width, height (world units; one may be derived from the aspect ratio), treatment ('none' | 'tint' | 'duotone' | 'desaturate')
   */
  constructor(source, props = {}) {
    super(props.type ?? 'image', props);
    this.source = source;
    this.naturalWidth = props.naturalWidth ?? 1;
    this.naturalHeight = props.naturalHeight ?? 1;
    const aspect = this.naturalWidth / this.naturalHeight;
    const w = props.width ?? (props.height ? props.height * aspect : 4);
    const h = props.height ?? w / aspect;
    this._define('width', w);
    this._define('height', h);
    this.treatment = props.treatment ?? 'none';
    this.fit = props.fit ?? 'fill';
  }

  /** Rectangle outline used for bounds, hit testing, and masks. */
  geometry() {
    return rectPath(0, 0, this.get('width'), this.get('height'));
  }
}

/** Video frames as an image source. The sampler asks for the frame at the node's local time. */
export class VideoNode extends ImageNode {
  /** @param {any} source @param {Record<string, any>} [props] startTime, playbackRate */
  constructor(source, props = {}) {
    super(source, { type: 'video', ...props });
    this.startTime = props.startTime ?? 0;
    this.playbackRate = props.playbackRate ?? 1;
  }
}

/**
 * Layer: a group with its own z-order slot, opacity, and blend mode.
 */
export class Layer extends Group {
  /** @param {Node[]} [children] @param {Record<string, any>} [props] blend: CSS composite operation */
  constructor(children = [], props = {}) {
    super(children, { type: 'layer', ...props });
    this.blend = props.blend ?? 'source-over';
  }
}

/**
 * Bounds of a set of world-space points.
 * @param {Array<[number, number]>} pts
 * @returns {{x: number, y: number, w: number, h: number}|null}
 */
export function pointsBounds(pts) {
  return pathBounds(polyPath(pts));
}

registerNodeClasses({ PathNode, Circle, Rect });

/**
 * A backing panel behind a node so labels stay readable over busy content
 * (grids, plots). Returns the panel; add it before the node or give it a
 * lower zIndex.
 * @param {Node} node
 * @param {{pad?: number, color?: string, opacity?: number, radius?: number}} [opts]
 * @returns {Rect}
 */
export function backdrop(node, opts = {}) {
  const b = node.bounds();
  if (!b) throw new Error('backdrop needs a node with geometry');
  const pad = opts.pad ?? 0.18;
  return new Rect({ width: b.w + 2 * pad, height: b.h + 2 * pad, radius: opts.radius ?? 0.08, x: b.x + b.w / 2, y: b.y + b.h / 2, fill: opts.color ?? 'background', fillOpacity: opts.opacity ?? 0.88, stroke: null, zIndex: -1, meta: { solidFill: true, noBoard: true } });
}
