/**
 * Scene graph nodes with time-tracked properties.
 *
 * Every property change made while a scene is being built is recorded as a
 * segment on a per-property track: a step (instant change) or a tween (from,
 * to, easing, duration). Sampling the scene at time t evaluates every track at
 * t, so any frame can be rendered directly, in any order, with the same result.
 * That is what makes seeking, parallel export, and frame-accurate video work.
 *
 * Reading a property returns the build-time value while authoring, and the
 * value at the sampled time while rendering (for `always` updaters).
 *
 * @module core/node
 */

import { compose, multiply, apply as applyMat, invert } from './matrix.js';
import { transformPath, pathBounds, partialPath, alignPaths, lerpAligned, clonePath } from './path.js';

/**
 * Shared evaluation context. `sampling` is true while a frame is being
 * resolved; `capture` is set while an `.animate` chain is being recorded.
 */
export const ctx = {
  sampling: false,
  t: 0,
  /** @type {Map<Node, Map<string, any>>|null} */
  frame: null,
  /** @type {Map<Node, Map<string, any>>|null} */
  capture: null,
  /** Theme being rendered while sampling (null while building). @type {any} */
  theme: null,
  /** Seed of the scene being sampled. */
  seed: 0,
};

const ID_COUNTERS = new Map();

/**
 * Reset automatic ids. Called at the start of every scene build so that ids
 * are stable between runs.
 */
export function resetIds() {
  ID_COUNTERS.clear();
}

function nextId(type) {
  const n = (ID_COUNTERS.get(type) ?? 0) + 1;
  ID_COUNTERS.set(type, n);
  return `${type}${n}`;
}

/**
 * How each property interpolates.
 * @type {Record<string, 'number'|'color'|'path'|'step'|'array'>}
 */
export const PROP_KIND = {
  x: 'number', y: 'number', rotation: 'number', scaleX: 'number', scaleY: 'number',
  opacity: 'number', fillOpacity: 'number', strokeOpacity: 'number', strokeWidth: 'number',
  draw: 'number', drawStart: 'number', value: 'number',
  fill: 'color', stroke: 'color',
  shape: 'path',
  visible: 'step', lineCap: 'step', lineJoin: 'step', zIndex: 'step', text: 'step', tex: 'step',
  dash: 'array',
};

/**
 * A color mid-transition between two theme tokens or literal colors. The
 * sampler resolves both ends against the active theme and mixes them.
 */
export class ColorMix {
  /** @param {any} a @param {any} b @param {number} t */
  constructor(a, b, t) {
    this.a = a;
    this.b = b;
    this.t = t;
  }
}

/**
 * @typedef {Object} Segment
 * @property {number} t0
 * @property {number} t1
 * @property {any} from
 * @property {any} to
 * @property {(u: number) => number} ease
 * @property {((u: number, seg: Segment) => any)|null} fn Custom value function (overrides interpolation).
 * @property {any} [cache]
 */

function interpolate(kind, from, to, u, seg) {
  if (kind === 'number' || (typeof from === 'number' && typeof to === 'number')) return from + (to - from) * u;
  if (kind === 'color') {
    if (from == null || to == null) return u < 0.5 ? from : to;
    return new ColorMix(from, to, u);
  }
  if (kind === 'path') {
    if (!from || !to) return u < 1 ? from : to;
    if (!seg.cache) seg.cache = alignPaths(from, to);
    return lerpAligned(seg.cache[0], seg.cache[1], u);
  }
  if (kind === 'array' && Array.isArray(from) && Array.isArray(to) && from.length === to.length) {
    return from.map((v, i) => v + (to[i] - v) * u);
  }
  return u < 1 ? from : to;
}

/**
 * Base scene node.
 */
export class Node {
  /**
   * @param {string} type
   * @param {Record<string, any>} [props]
   */
  constructor(type, props = {}) {
    /** @type {string} */
    this.type = type;
    /** @type {string} */
    this.id = props.id ?? nextId(type);
    /** @type {string|undefined} */
    this.name = props.name;
    /** @type {Node[]} */
    this.children = [];
    /** @type {Node|null} */
    this.parent = null;
    /** @type {import('./scene.js').Scene|null} */
    this.scene = null;
    /** @type {Record<string, any>} */
    this._init = {};
    /** @type {Record<string, any>} */
    this._cur = {};
    /** @type {Map<string, Segment[]>} */
    this._tracks = new Map();
    /** Per-object theme token overrides. @type {Record<string, any>} */
    this.tokens = props.tokens ?? {};
    /** Hints for the board-style renderers. @type {Record<string, any>} */
    this.meta = props.meta ?? {};
    const defaults = {
      x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
      opacity: 1, visible: true,
      fill: null, fillOpacity: 1,
      stroke: null, strokeOpacity: 1, strokeWidth: 4,
      draw: 1, drawStart: 0,
      lineCap: 'round', lineJoin: 'round', dash: null, zIndex: 0,
      shape: null,
    };
    for (const [k, v] of Object.entries(defaults)) this._define(k, v);
    const skip = new Set(['id', 'name', 'tokens', 'meta', 'children', 'scale', 'position', 'color']);
    for (const [k, v] of Object.entries(props)) {
      if (skip.has(k)) continue;
      if (k in this._cur) this._set(k, v);
    }
    if (props.scale != null) this._setScale(props.scale);
    if (props.position) {
      this._set('x', props.position[0]);
      this._set('y', props.position[1]);
    }
    if (props.color != null) this.setColor(props.color);
  }

  /**
   * Declare a tracked property with its initial value.
   * @param {string} key
   * @param {any} value
   * @protected
   */
  _define(key, value) {
    this._init[key] = value;
    this._cur[key] = value;
  }

  /**
   * Read a property honoring the evaluation context.
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    if (ctx.capture) {
      const m = ctx.capture.get(this);
      if (m && m.has(key)) return m.get(key);
    }
    if (ctx.sampling) {
      const f = ctx.frame && ctx.frame.get(this);
      if (f && f.has(key)) return f.get(key);
      return this.valueAt(key, ctx.t);
    }
    return this._cur[key];
  }

  /**
   * Write a property. While building, this records an instant change at the
   * scene clock. While an `.animate` chain is recorded, it captures a target.
   * While sampling (inside an updater), it overrides the value for the frame.
   * @param {string} key
   * @param {any} value
   * @returns {this}
   */
  set(key, value) {
    if (typeof key === 'object') {
      for (const [k, v] of Object.entries(key)) this.set(k, v);
      return this;
    }
    if (key === 'scale') return this._setScale(value);
    if (key === 'color') return this.setColor(value);
    if (key === 'position') {
      this.set('x', value[0]);
      return this.set('y', value[1]);
    }
    return this._set(key, value);
  }

  /** @private */
  _setScale(s) {
    const [sx, sy] = Array.isArray(s) ? s : [s, s];
    this._set('scaleX', sx);
    return this._set('scaleY', sy);
  }

  /**
   * @param {string} key
   * @param {any} value
   * @returns {this}
   * @protected
   */
  _set(key, value) {
    if (!(key in this._cur)) throw new Error(`${this.type} has no property "${key}"`);
    if (ctx.capture) {
      if (!ctx.capture.has(this)) ctx.capture.set(this, new Map());
      ctx.capture.get(this).set(key, value);
      return this;
    }
    if (ctx.sampling) {
      if (!ctx.frame.has(this)) ctx.frame.set(this, new Map());
      ctx.frame.get(this).set(key, value);
      return this;
    }
    const scene = this.scene;
    if (!scene || !scene.building || (scene.clock <= 0 && !this._tracks.has(key))) {
      this._init[key] = value;
      this._cur[key] = value;
      return this;
    }
    this._pushSegment(key, { t0: scene.clock, t1: scene.clock, from: this._cur[key], to: value, ease: (u) => u, fn: null });
    this._cur[key] = value;
    return this;
  }

  /**
   * Record a tween on a property from its current build-time value.
   * @param {string} key
   * @param {number} t0
   * @param {number} t1
   * @param {any} to
   * @param {(u: number) => number} ease
   * @param {((u: number, seg: Segment) => any)|null} [fn]
   * @param {any} [from]
   */
  tween(key, t0, t1, to, ease, fn = null, from = undefined) {
    if (!(key in this._cur)) throw new Error(`${this.type} has no property "${key}"`);
    const seg = { t0, t1: Math.max(t0, t1), from: from === undefined ? this._cur[key] : from, to, ease, fn };
    this._pushSegment(key, seg);
    this._cur[key] = to;
  }

  /** @private */
  _pushSegment(key, seg) {
    let segs = this._tracks.get(key);
    if (!segs) {
      segs = [];
      this._tracks.set(key, segs);
    }
    let i = segs.length;
    while (i > 0 && segs[i - 1].t0 > seg.t0) i--;
    segs.splice(i, 0, seg);
    if (this.scene) this.scene._noteTime(seg.t1);
  }

  /**
   * Value of a property at time t from its track.
   * @param {string} key
   * @param {number} t
   * @returns {any}
   */
  valueAt(key, t) {
    const segs = this._tracks.get(key);
    if (!segs || !segs.length || t < segs[0].t0) return this._init[key];
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].t0 <= t) lo = mid;
      else hi = mid - 1;
    }
    const seg = segs[lo];
    if (t >= seg.t1) return seg.fn ? seg.fn(seg.ease(1), seg) : seg.to;
    const u = seg.ease((t - seg.t0) / (seg.t1 - seg.t0));
    if (seg.fn) return seg.fn(u, seg);
    return interpolate(PROP_KIND[key], seg.from, seg.to, u, seg);
  }

  /** Time of the last recorded change on this node or its descendants. @returns {number} */
  lastTime() {
    let t = 0;
    for (const segs of this._tracks.values()) for (const s of segs) t = Math.max(t, s.t1);
    for (const c of this.children) t = Math.max(t, c.lastTime());
    return t;
  }

  // Convenience accessors.
  get x() { return this.get('x'); }
  set x(v) { this.set('x', v); }
  get y() { return this.get('y'); }
  set y(v) { this.set('y', v); }
  get rotation() { return this.get('rotation'); }
  set rotation(v) { this.set('rotation', v); }
  get opacity() { return this.get('opacity'); }
  set opacity(v) { this.set('opacity', v); }
  get fill() { return this.get('fill'); }
  set fill(v) { this.set('fill', v); }
  get stroke() { return this.get('stroke'); }
  set stroke(v) { this.set('stroke', v); }
  get strokeWidth() { return this.get('strokeWidth'); }
  set strokeWidth(v) { this.set('strokeWidth', v); }
  get visible() { return this.get('visible'); }
  set visible(v) { this.set('visible', v); }

  /** Position as [x, y]. @returns {[number, number]} */
  get position() {
    return [this.get('x'), this.get('y')];
  }

  /**
   * Local transform matrix from the current (or sampled) properties.
   * @returns {number[]}
   */
  localMatrix() {
    return compose(this.get('x'), this.get('y'), this.get('rotation'), this.get('scaleX'), this.get('scaleY'));
  }

  /** @returns {number[]} */
  worldMatrix() {
    const m = this.localMatrix();
    return this.parent ? multiply(this.parent.worldMatrix(), m) : m;
  }

  /**
   * Geometry in local coordinates, before draw-range trimming. Shapes
   * override this; plain groups return null.
   * @returns {import('./path.js').Path|null}
   */
  geometry() {
    return null;
  }

  /**
   * Geometry honoring a `shape` override (set by morphs) and the draw range.
   * @returns {import('./path.js').Path|null}
   */
  resolvedGeometry() {
    const override = this.get('shape');
    const g = override || this.geometry();
    if (!g) return null;
    const a = this.get('drawStart');
    const b = this.get('draw');
    if (a <= 0 && b >= 1) return g;
    return partialPath(g, Math.max(0, a), Math.min(1, b));
  }

  /**
   * Add children.
   * @param {...Node} nodes
   * @returns {this}
   */
  add(...nodes) {
    for (const n of nodes.flat()) {
      if (!n) continue;
      if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n);
      n.parent = this;
      this.children.push(n);
      if (this.scene) n._attach(this.scene);
    }
    return this;
  }

  /** @param {import('./scene.js').Scene} scene @protected */
  _attach(scene) {
    this.scene = scene;
    for (const c of this.children) c._attach(scene);
  }

  /**
   * Depth-first list of this node and its descendants.
   * @returns {Node[]}
   */
  family() {
    const out = [this];
    for (const c of this.children) out.push(...c.family());
    return out;
  }

  /**
   * Descendants that carry geometry.
   * @returns {Node[]}
   */
  leaves() {
    return this.family().filter((n) => n.geometry() !== null || n.get('shape'));
  }

  /**
   * Axis-aligned bounds in world coordinates.
   * @returns {{x: number, y: number, w: number, h: number}|null}
   */
  bounds() {
    let box = null;
    for (const n of this.family()) {
      const g = n.get('shape') || n.geometry();
      if (!g) continue;
      const b = pathBounds(transformPath(g, n.worldMatrix()));
      if (!b) continue;
      if (!box) box = { ...b };
      else {
        const x1 = Math.max(box.x + box.w, b.x + b.w);
        const y1 = Math.max(box.y + box.h, b.y + b.h);
        box.x = Math.min(box.x, b.x);
        box.y = Math.min(box.y, b.y);
        box.w = x1 - box.x;
        box.h = y1 - box.y;
      }
    }
    return box;
  }

  /** Center of world bounds (or position when there is no geometry). @returns {[number, number]} */
  center() {
    const b = this.bounds();
    if (!b) return this.parent ? applyMat(this.parent.worldMatrix(), this.get('x'), this.get('y')) : [this.get('x'), this.get('y')];
    return [b.x + b.w / 2, b.y + b.h / 2];
  }

  /** @returns {number} */
  get width() {
    const b = this.bounds();
    return b ? b.w : 0;
  }

  /** @returns {number} */
  get height() {
    const b = this.bounds();
    return b ? b.h : 0;
  }

  /**
   * World point of a bounds anchor: 'center', 'left', 'right', 'top',
   * 'bottom', 'top-left', and so on, or a direction vector [dx, dy].
   * @param {string|number[]} where
   * @returns {[number, number]}
   */
  anchor(where = 'center') {
    const b = this.bounds() || { x: this.get('x'), y: this.get('y'), w: 0, h: 0 };
    const [dx, dy] = direction(where);
    return [b.x + (b.w * (dx + 1)) / 2, b.y + (b.h * (dy + 1)) / 2];
  }

  /**
   * Convert a world point to this node's parent space.
   * @param {number} x @param {number} y
   * @returns {[number, number]}
   */
  worldToParent(x, y) {
    if (!this.parent) return [x, y];
    return applyMat(invert(this.parent.worldMatrix()), x, y);
  }

  /**
   * Move by a world-space offset.
   * @param {number|number[]} dx
   * @param {number} [dy]
   * @returns {this}
   */
  shift(dx, dy) {
    if (Array.isArray(dx)) [dx, dy] = dx;
    const [ox, oy] = this.worldToParent(0, 0);
    const [px, py] = this.worldToParent(dx, dy ?? 0);
    this.set('x', this.get('x') + (px - ox));
    return this.set('y', this.get('y') + (py - oy));
  }

  /**
   * Move so that the given anchor (default the bounds center) sits at a world point.
   * @param {number[]|Node} target point or node
   * @param {string|number[]} [anchor='center']
   * @returns {this}
   */
  moveTo(target, anchor = 'center') {
    const p = target instanceof Node ? target.center() : target;
    const a = this.anchor(anchor);
    return this.shift(p[0] - a[0], p[1] - a[1]);
  }

  /**
   * Scale about a world point (default the bounds center).
   * @param {number|number[]} s
   * @param {number[]} [about]
   * @returns {this}
   */
  scale(s, about) {
    const [sx, sy] = Array.isArray(s) ? s : [s, s];
    const c = about ?? this.center();
    const before = this.center();
    this.set('scaleX', this.get('scaleX') * sx);
    this.set('scaleY', this.get('scaleY') * sy);
    const after = this.center();
    const tx = c[0] + (before[0] - c[0]) * sx;
    const ty = c[1] + (before[1] - c[1]) * sy;
    return this.shift(tx - after[0], ty - after[1]);
  }

  /**
   * Rotate by an angle (radians) about a world point (default the bounds center).
   * @param {number} angle
   * @param {number[]} [about]
   * @returns {this}
   */
  rotate(angle, about) {
    const c = about ?? this.center();
    const before = this.center();
    this.set('rotation', this.get('rotation') + angle);
    const after = this.center();
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const vx = before[0] - c[0];
    const vy = before[1] - c[1];
    const tx = c[0] + vx * cos - vy * sin;
    const ty = c[1] + vx * sin + vy * cos;
    return this.shift(tx - after[0], ty - after[1]);
  }

  /**
   * Set fill (and optionally stroke) color on this node and its descendants.
   * @param {string|null} color
   * @returns {this}
   */
  setColor(color) {
    for (const n of this.family()) {
      if (n.get('fill') != null || n.meta.fillByDefault) n.set('fill', color);
      if (n.get('stroke') != null) n.set('stroke', color);
    }
    return this;
  }

  /**
   * @param {string|null} color
   * @param {number} [opacity]
   * @returns {this}
   */
  setFill(color, opacity) {
    this.set('fill', color);
    if (opacity != null) this.set('fillOpacity', opacity);
    return this;
  }

  /**
   * @param {string|null} color
   * @param {number} [width]
   * @param {number} [opacity]
   * @returns {this}
   */
  setStroke(color, width, opacity) {
    this.set('stroke', color);
    if (width != null) this.set('strokeWidth', width);
    if (opacity != null) this.set('strokeOpacity', opacity);
    return this;
  }

  /**
   * Place next to another node (or point) in a direction, with a gap.
   * @param {Node|number[]} other
   * @param {string|number[]} [dir='right']
   * @param {number} [buff=0.25]
   * @param {string|number[]} [align] optional cross-axis alignment edge
   * @returns {this}
   */
  nextTo(other, dir = 'right', buff = 0.25, align) {
    const [dx, dy] = direction(dir);
    const target = other instanceof Node ? other.anchor([dx, dy]) : other;
    const mine = this.anchor([-dx, -dy]);
    this.shift(target[0] - mine[0] + dx * buff, target[1] - mine[1] + dy * buff);
    if (align && other instanceof Node) this.alignTo(other, align);
    return this;
  }

  /**
   * Align an edge of this node with the same edge of another node.
   * @param {Node|number[]} other
   * @param {string|number[]} edge
   * @returns {this}
   */
  alignTo(other, edge) {
    const [dx, dy] = direction(edge);
    const t = other instanceof Node ? other.anchor([dx, dy]) : other;
    const m = this.anchor([dx, dy]);
    return this.shift(dx !== 0 ? t[0] - m[0] : 0, dy !== 0 ? t[1] - m[1] : 0);
  }

  /**
   * Move to the frame edge or corner with a margin.
   * @param {string|number[]} edge
   * @param {number} [margin=0.5]
   * @returns {this}
   */
  toEdge(edge, margin = 0.5) {
    if (!this.scene) throw new Error('toEdge needs the node to be in a scene');
    const [dx, dy] = direction(edge);
    const hw = this.scene.frameWidth / 2 - margin;
    const hh = this.scene.frameHeight / 2 - margin;
    const a = this.anchor([dx, dy]);
    return this.shift(dx !== 0 ? dx * hw - a[0] : 0, dy !== 0 ? dy * hh - a[1] : 0);
  }

  /**
   * Scale uniformly so the node fits in a width and/or height.
   * @param {number} [w]
   * @param {number} [h]
   * @returns {this}
   */
  fitTo(w, h) {
    const b = this.bounds();
    if (!b) return this;
    let s = Infinity;
    if (w != null && b.w > 0) s = Math.min(s, w / b.w);
    if (h != null && b.h > 0) s = Math.min(s, h / b.h);
    if (s === Infinity) return this;
    return this.scale(s);
  }

  /**
   * An animation builder: methods called on it are recorded as property
   * targets and turned into tweens when played.
   * @returns {any}
   */
  get animate() {
    return animateBuilder(this);
  }

  /**
   * Deep copy with the current build-time values as initial values.
   * @returns {this}
   */
  copy() {
    const c = Object.create(Object.getPrototypeOf(this));
    Object.assign(c, this);
    c.id = nextId(this.type);
    c.parent = null;
    c.scene = null;
    c._init = { ...this._cur };
    c._cur = { ...this._cur };
    if (c._cur.shape) {
      c._init.shape = clonePath(c._cur.shape);
      c._cur.shape = c._init.shape;
    }
    c._tracks = new Map();
    c.tokens = { ...this.tokens };
    c.meta = { ...this.meta };
    c.children = [];
    for (const ch of this.children) c.add(ch.copy());
    if (typeof c._afterCopy === 'function') c._afterCopy(this);
    return c;
  }

  /**
   * Serialize the node's structure and initial state (tracks are serialized by
   * the scene).
   * @returns {Record<string, any>}
   */
  toJSON() {
    const props = {};
    for (const [k, v] of Object.entries(this._init)) {
      if (k === 'shape' && v) props.shape = v;
      else if (v !== null && typeof v !== 'function') props[k] = v;
    }
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      props,
      tokens: Object.keys(this.tokens).length ? this.tokens : undefined,
      children: this.children.length ? this.children.map((c) => c.toJSON()) : undefined,
    };
  }
}

/**
 * Normalize a direction name or vector to [dx, dy] with components in {-1, 0, 1}.
 * @param {string|number[]} d
 * @returns {[number, number]}
 */
export function direction(d) {
  if (Array.isArray(d)) return [Math.sign(d[0]), Math.sign(d[1])];
  const map = {
    center: [0, 0], left: [-1, 0], right: [1, 0], up: [0, 1], top: [0, 1], down: [0, -1], bottom: [0, -1],
    'top-left': [-1, 1], 'top-right': [1, 1], 'bottom-left': [-1, -1], 'bottom-right': [1, -1],
    ul: [-1, 1], ur: [1, 1], dl: [-1, -1], dr: [1, -1],
  };
  const v = map[d];
  if (!v) throw new Error(`Unknown direction "${d}"`);
  return v;
}

/**
 * Group of nodes, also used as a layer.
 */
export class Group extends Node {
  /**
   * @param {Node[]} [children]
   * @param {Record<string, any>} [props]
   */
  constructor(children = [], props = {}) {
    super(props.type ?? 'group', props);
    this.add(...children);
  }

  /**
   * Child by index (negative counts from the end).
   * @param {number} i
   * @returns {Node}
   */
  at(i) {
    return this.children[i < 0 ? this.children.length + i : i];
  }

  /** @returns {number} */
  get length() {
    return this.children.length;
  }

  /**
   * Arrange children in a row or column with a gap.
   * @param {'row'|'column'} [dir='row']
   * @param {number} [gap=0.25]
   * @param {'start'|'center'|'end'} [align='center']
   * @returns {this}
   */
  arrange(dir = 'row', gap = 0.25, align = 'center') {
    const c0 = this.center();
    let cursor = null;
    for (const ch of this.children) {
      if (cursor === null) {
        cursor = ch;
        continue;
      }
      ch.nextTo(cursor, dir === 'row' ? 'right' : 'down', gap);
      if (align !== 'center') ch.alignTo(cursor, dir === 'row' ? (align === 'start' ? 'top' : 'bottom') : align === 'start' ? 'left' : 'right');
      else if (dir === 'row') ch.shift(0, cursor.center()[1] - ch.center()[1]);
      else ch.shift(cursor.center()[0] - ch.center()[0], 0);
      cursor = ch;
    }
    const c1 = this.center();
    return this.shift(c0[0] - c1[0], c0[1] - c1[1]);
  }

  /**
   * Arrange children in a grid.
   * @param {{rows?: number, cols?: number, gap?: number|number[], cellAlign?: string}} [opts]
   * @returns {this}
   */
  arrangeInGrid(opts = {}) {
    const n = this.children.length;
    const cols = opts.cols ?? (opts.rows ? Math.ceil(n / opts.rows) : Math.ceil(Math.sqrt(n)));
    const rows = opts.rows ?? Math.ceil(n / cols);
    const [gx, gy] = Array.isArray(opts.gap) ? opts.gap : [opts.gap ?? 0.25, opts.gap ?? 0.25];
    const colW = new Array(cols).fill(0);
    const rowH = new Array(rows).fill(0);
    this.children.forEach((ch, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      colW[c] = Math.max(colW[c], ch.width);
      rowH[r] = Math.max(rowH[r], ch.height);
    });
    const totalW = colW.reduce((a, b) => a + b, 0) + gx * (cols - 1);
    const totalH = rowH.reduce((a, b) => a + b, 0) + gy * (rows - 1);
    const c0 = this.center();
    this.children.forEach((ch, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      const x = -totalW / 2 + colW.slice(0, c).reduce((a, b) => a + b, 0) + gx * c + colW[c] / 2;
      const y = totalH / 2 - rowH.slice(0, r).reduce((a, b) => a + b, 0) - gy * r - rowH[r] / 2;
      ch.moveTo([c0[0] + x, c0[1] + y]);
    });
    return this;
  }

  /**
   * Distribute children evenly between the first and last along an axis.
   * @param {'x'|'y'} [axis='x']
   * @returns {this}
   */
  distribute(axis = 'x') {
    const n = this.children.length;
    if (n < 3) return this;
    const i = axis === 'x' ? 0 : 1;
    const a = this.children[0].center()[i];
    const b = this.children[n - 1].center()[i];
    this.children.forEach((ch, k) => {
      const target = a + ((b - a) * k) / (n - 1);
      const cur = ch.center()[i];
      if (i === 0) ch.shift(target - cur, 0);
      else ch.shift(0, target - cur);
    });
    return this;
  }
}

/**
 * A node with explicit path geometry.
 */
export class PathNode extends Node {
  /**
   * @param {import('./path.js').Path} path
   * @param {Record<string, any>} [props]
   */
  constructor(path, props = {}) {
    super(props.type ?? 'path', { stroke: 'ink', ...props });
    /** @type {import('./path.js').Path} */
    this.path = path;
  }

  /** @returns {import('./path.js').Path} */
  geometry() {
    return this.path;
  }

  toJSON() {
    const j = super.toJSON();
    j.path = this.path;
    return j;
  }
}

/**
 * A value holder that animates like any other property. Use it to drive
 * updaters: `const t = tracker(0); scene.play(t.to(5))`.
 */
export class ValueTracker extends Node {
  /** @param {number} [value=0] @param {Record<string, any>} [props] */
  constructor(value = 0, props = {}) {
    super('value', props);
    this._define('value', value);
  }

  /** @returns {number} */
  get value() {
    return this.get('value');
  }

  set value(v) {
    this.set('value', v);
  }

  /**
   * Animation to a new value.
   * @param {number} v
   * @param {Record<string, any>} [opts]
   */
  to(v, opts = {}) {
    return this.animate.set('value', v).with(opts);
  }
}

function animateBuilder(node) {
  const capture = new Map();
  const opts = {};
  const proxy = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === '__isAnimateBuilder') return true;
        if (prop === '__capture') return capture;
        if (prop === '__opts') return opts;
        if (prop === '__node') return node;
        if (prop === 'with') {
          return (o) => {
            Object.assign(opts, o);
            return proxy;
          };
        }
        const v = node[prop];
        if (typeof v !== 'function') {
          const prev = ctx.capture;
          ctx.capture = capture;
          try {
            return node[prop];
          } finally {
            ctx.capture = prev;
          }
        }
        return (...args) => {
          const prev = ctx.capture;
          ctx.capture = capture;
          try {
            v.apply(node, args);
          } finally {
            ctx.capture = prev;
          }
          return proxy;
        };
      },
    },
  );
  return proxy;
}

/**
 * Resolve the world-space geometry of a node at the current evaluation time.
 * @param {Node} node
 * @returns {import('./path.js').Path|null}
 */
export function worldGeometry(node) {
  const g = node.get('shape') || node.geometry();
  if (!g) return null;
  return transformPath(g, node.worldMatrix());
}
