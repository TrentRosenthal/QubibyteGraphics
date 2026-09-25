/**
 * Animations. An animation records tracks on nodes when scheduled at a start
 * time and returns its end time. Nothing runs in real time.
 * @module core/animations
 */

import { Node, ColorMix, direction } from './node.js';
import { resolveEasing, smooth, thereAndBack, linear } from './easing.js';
import { transformPath, pathBounds, pointAtFraction, alignPaths, lerpAligned, polyPath, circlePath, rectPath } from './path.js';
import { invert, multiply } from './matrix.js';

/**
 * Base class.
 */
export class Animation {
  /**
   * @param {Record<string, any>} [opts] duration (seconds), ease, lagRatio, delay
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.duration = opts.duration;
    this.ease = opts.ease;
    this.lagRatio = opts.lagRatio;
    this.delay = opts.delay ?? 0;
  }

  /**
   * Fill unset options from play() options, then theme motion defaults.
   * @param {Record<string, any>} playOpts
   * @param {import('./scene.js').Scene} scene
   */
  applyDefaults(playOpts, scene) {
    const motion = sceneMotion(scene);
    if (playOpts.duration != null) this.duration = playOpts.duration;
    if (playOpts.ease != null) this.ease = playOpts.ease;
    if (playOpts.lagRatio != null) this.lagRatio = playOpts.lagRatio;
    if (this.duration == null) this.duration = this.defaultDuration ?? motion.duration ?? 1;
    this.ease = resolveEasing(this.ease ?? this.defaultEase ?? motion.ease, smooth);
    if (this.lagRatio == null) this.lagRatio = this.defaultLag ?? 0;
  }

  /**
   * Record tracks starting at t0.
   * @param {import('./scene.js').Scene} _scene
   * @param {number} t0
   * @returns {number} end time
   */
  schedule(_scene, t0) {
    return t0 + this.delay + this.duration;
  }
}

function sceneMotion(scene) {
  const th = scene && typeof scene.theme === 'object' ? scene.theme : null;
  return (th && th.motion) || {};
}

/**
 * Start times and per-item durations for a staggered group.
 * With lag ratio r, item i starts at i r d and each runs d seconds, where d
 * is chosen so the whole group takes `total` seconds.
 * @param {number} n
 * @param {number} t0
 * @param {number} total
 * @param {number} lagRatio
 * @returns {Array<[number, number]>} [start, end] per item
 */
export function stagger(n, t0, total, lagRatio) {
  if (n <= 0) return [];
  const d = total / (1 + (n - 1) * lagRatio);
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = t0 + i * lagRatio * d;
    out.push([s, s + d]);
  }
  return out;
}

function ensureAdded(scene, node, t0) {
  if (node.scene === scene) {
    if (node.parent === scene.root && !node.valueAt('visible', t0)) {
      node.tween('visible', t0, t0, true, linear);
    }
    return;
  }
  const saved = scene.clock;
  scene.clock = t0;
  scene.add(node);
  scene.clock = saved;
}

function hide(node, t) {
  node.tween('visible', t, t, false, linear);
}

/**
 * Animation from an `.animate` chain: tweens every captured property.
 */
export class PropertyAnimation extends Animation {
  /** @param {any} builder */
  constructor(builder) {
    super(builder.__opts);
    this.capture = builder.__capture;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const entries = [...this.capture.entries()];
    const times = stagger(entries.length, s, this.duration, this.lagRatio);
    entries.forEach(([node, props], i) => {
      const [a, b] = this.lagRatio ? times[i] : [s, e];
      for (const [k, v] of props) node.tween(k, a, b, v, this.ease);
    });
    return e;
  }
}

/**
 * Convert an animation, an `.animate` chain, or an array to an Animation.
 * @param {any} x
 * @returns {Animation}
 */
export function toAnimation(x) {
  if (x instanceof Animation) return x;
  if (x && x.__isAnimateBuilder) return new PropertyAnimation(x);
  if (Array.isArray(x)) return new AnimationGroup(x.map(toAnimation));
  throw new Error('play() takes animations or node.animate chains');
}

/** Several animations starting together. */
export class AnimationGroup extends Animation {
  /** @param {Animation[]} anims @param {Record<string, any>} [opts] */
  constructor(anims, opts = {}) {
    super(opts);
    this.anims = anims.map(toAnimation);
  }

  applyDefaults(playOpts, scene) {
    this.defaultDuration = Math.max(0, ...this.anims.map((a) => {
      a.applyDefaults({}, scene);
      return a.delay + a.duration;
    }));
    super.applyDefaults(playOpts, scene);
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const natural = Math.max(1e-9, ...this.anims.map((a) => a.delay + a.duration));
    const k = this.duration / natural;
    let end = s;
    const times = stagger(this.anims.length, s, this.duration, this.lagRatio);
    this.anims.forEach((a, i) => {
      if (this.lagRatio) {
        const [st, en] = times[i];
        a.duration = en - st;
        a.delay = 0;
        end = Math.max(end, a.schedule(scene, st));
      } else {
        a.duration *= k;
        a.delay *= k;
        end = Math.max(end, a.schedule(scene, s));
      }
    });
    return end;
  }
}

/**
 * Animations whose starts are staggered by a lag ratio.
 * @param {Array<any>} anims
 * @param {Record<string, any>} [opts] lagRatio (default 0.15), duration
 * @returns {AnimationGroup}
 */
export function lagStart(anims, opts = {}) {
  return new AnimationGroup(anims, { lagRatio: 0.15, ...opts });
}

/** Animations one after another. */
export class Succession extends Animation {
  /** @param {Array<any>} anims @param {Record<string, any>} [opts] */
  constructor(anims, opts = {}) {
    super(opts);
    this.anims = anims.map(toAnimation);
  }

  applyDefaults(playOpts, scene) {
    let total = 0;
    for (const a of this.anims) {
      a.applyDefaults({}, scene);
      total += a.delay + a.duration;
    }
    this.defaultDuration = total;
    super.applyDefaults(playOpts, scene);
  }

  schedule(scene, t0) {
    const natural = this.anims.reduce((acc, a) => acc + a.delay + a.duration, 0) || 1;
    const k = this.duration / natural;
    let t = t0 + this.delay;
    for (const a of this.anims) {
      a.duration *= k;
      a.delay *= k;
      t = a.schedule(scene, t);
    }
    return t;
  }
}

/**
 * @param {Array<any>} anims
 * @param {Record<string, any>} [opts]
 * @returns {Succession}
 */
export function succession(anims, opts) {
  return new Succession(anims, opts);
}

/**
 * @param {Array<any>} anims
 * @param {Record<string, any>} [opts]
 * @returns {AnimationGroup}
 */
export function parallel(anims, opts) {
  return new AnimationGroup(anims, opts);
}

/** Do nothing for a while (useful inside successions). */
export class Wait extends Animation {
  /** @param {number} [duration=1] */
  constructor(duration = 1) {
    super({ duration, ease: linear });
  }
}

/**
 * Stroke-draws a node, then fills it. Nodes that only have a fill (glyphs,
 * dots) are outlined in their fill color first, the way a pen would trace
 * them, then filled.
 */
export class Create extends Animation {
  /** @param {Node} node @param {Record<string, any>} [opts] */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
    this.defaultLag = opts.lagRatio ?? (node.meta.writeLag ?? 0);
    this.outlineWidth = opts.outlineWidth ?? 2;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    ensureAdded(scene, this.node, s);
    const leaves = this.node.leaves();
    const times = stagger(leaves.length, s, this.duration, this.lagRatio);
    leaves.forEach((leaf, i) => {
      const [a, b] = times[i];
      drawLeaf(leaf, a, b, this.ease, this.outlineWidth);
    });
    return s + this.duration;
  }
}

function drawLeaf(leaf, a, b, ease, outlineWidth) {
  const fill = leaf._cur.fill;
  const stroke = leaf._cur.stroke;
  const fillOpacity = leaf._cur.fillOpacity;
  const d = b - a;
  if (stroke != null && fill == null) {
    leaf.tween('draw', a, b, 1, ease, null, 0);
    return;
  }
  if (fill != null && stroke != null) {
    leaf.tween('draw', a, a + d * 0.7, 1, ease, null, 0);
    leaf.tween('fillOpacity', a, a, 0, linear);
    leaf.tween('fillOpacity', a + d * 0.5, b, fillOpacity, ease, null, 0);
    return;
  }
  if (fill != null) {
    const sw = leaf._cur.strokeWidth;
    leaf.tween('stroke', a, a, fill, linear);
    leaf.tween('strokeWidth', a, a, outlineWidth, linear);
    leaf.tween('strokeOpacity', a, a, 1, linear);
    leaf.tween('fillOpacity', a, a, 0, linear);
    leaf.tween('draw', a, a + d * 0.65, 1, ease, null, 0);
    leaf.tween('fillOpacity', a + d * 0.45, b, fillOpacity, ease, null, 0);
    leaf.tween('strokeOpacity', a + d * 0.6, b, 0, ease, null, 1);
    leaf.tween('stroke', b, b, null, linear);
    leaf.tween('strokeWidth', b, b, sw, linear);
    leaf.tween('strokeOpacity', b, b, 1, linear);
    return;
  }
  leaf.tween('opacity', a, b, leaf._cur.opacity, ease, null, 0);
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {Create}
 */
export function create(node, opts) {
  return new Create(node, opts);
}

/**
 * Write text or math: Create with a per-glyph stagger.
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {Create}
 */
export function write(node, opts = {}) {
  const n = node.leaves().length;
  const lag = opts.lagRatio ?? (n > 1 ? Math.min(0.35, 2.2 / n) : 0);
  const duration = opts.duration ?? Math.min(2.4, 0.8 + 0.06 * n);
  return new Create(node, { ...opts, lagRatio: lag, duration });
}

/** Reverse of Create: erases stroke and fill, then removes the node. */
export class Uncreate extends Animation {
  /** @param {Node} node @param {Record<string, any>} [opts] */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
    this.defaultLag = 0;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const leaves = this.node.leaves().reverse();
    const times = stagger(leaves.length, s, this.duration, this.lagRatio);
    leaves.forEach((leaf, i) => {
      const [a, b] = times[i];
      const d = b - a;
      if (leaf._cur.fill != null) leaf.tween('fillOpacity', a, a + d * 0.5, 0, this.ease);
      if (leaf._cur.stroke != null) leaf.tween('draw', a + d * 0.2, b, 0, this.ease);
      else leaf.tween('opacity', a, b, 0, this.ease);
    });
    const e = s + this.duration;
    hide(this.node, e);
    for (const leaf of leaves) restoreAfter(leaf, e);
    return e;
  }
}

function restoreAfter(leaf, t) {
  for (const k of ['draw', 'fillOpacity', 'opacity']) {
    const v = leaf._init[k];
    leaf.tween(k, t, t, v, linear);
  }
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {Uncreate}
 */
export function uncreate(node, opts) {
  return new Uncreate(node, opts);
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {Uncreate}
 */
export function unwrite(node, opts = {}) {
  const n = node.leaves().length;
  return new Uncreate(node, { lagRatio: n > 1 ? Math.min(0.3, 1.5 / n) : 0, duration: Math.min(1.6, 0.6 + 0.04 * n), ...opts });
}

/** Fade in, optionally shifting in from an offset or scaling up. */
export class FadeIn extends Animation {
  /** @param {Node} node @param {Record<string, any>} [opts] shift [dx, dy] or direction name, scale */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
    this.shift = opts.shift ? (typeof opts.shift === 'string' ? direction(opts.shift).map((v) => v * 0.4) : opts.shift) : null;
    this.fromScale = opts.scale ?? 1;
    this.defaultLag = 0;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    ensureAdded(scene, this.node, s);
    const targets = this.lagRatio ? this.node.children.length ? this.node.children : [this.node] : [this.node];
    const times = stagger(targets.length, s, this.duration, this.lagRatio);
    targets.forEach((n, i) => {
      const [a, b] = times[i];
      const op = n._cur.opacity;
      n.tween('opacity', a, b, op, this.ease, null, 0);
      if (this.shift) {
        const [x, y] = [n._cur.x, n._cur.y];
        const [ox, oy] = parentDelta(n, this.shift);
        n.tween('x', a, b, x, this.ease, null, x - ox);
        n.tween('y', a, b, y, this.ease, null, y - oy);
      }
      if (this.fromScale !== 1) scaleTween(n, a, b, this.fromScale, 1, this.ease);
    });
    return e;
  }
}

function parentDelta(n, [dx, dy]) {
  const m = n.parent ? n.parent.worldMatrix() : [1, 0, 0, 1, 0, 0];
  const inv = invert([m[0], m[1], m[2], m[3], 0, 0]);
  return [inv[0] * dx + inv[2] * dy, inv[1] * dx + inv[3] * dy];
}

/**
 * Scale a node about its bounds center from factor k0 to k1 of its current scale.
 */
function scaleTween(n, a, b, k0, k1, ease) {
  const c = n.center();
  const [cx, cy] = n.worldToParent(c[0], c[1]);
  const sx = n._cur.scaleX;
  const sy = n._cur.scaleY;
  const x = n._cur.x;
  const y = n._cur.y;
  const at = (k) => [cx + (x - cx) * k, cy + (y - cy) * k];
  const [x0, y0] = at(k0);
  const [x1, y1] = at(k1);
  n.tween('scaleX', a, b, sx * k1, ease, null, sx * k0);
  n.tween('scaleY', a, b, sy * k1, ease, null, sy * k0);
  n.tween('x', a, b, x1, ease, null, x0);
  n.tween('y', a, b, y1, ease, null, y0);
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {FadeIn}
 */
export function fadeIn(node, opts) {
  return new FadeIn(node, opts);
}

/** Fade out, optionally shifting away, then remove. */
export class FadeOut extends Animation {
  /** @param {Node} node @param {Record<string, any>} [opts] shift, scale */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
    this.shift = opts.shift ? (typeof opts.shift === 'string' ? direction(opts.shift).map((v) => v * 0.4) : opts.shift) : null;
    this.toScale = opts.scale ?? 1;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const n = this.node;
    const op = n._cur.opacity;
    n.tween('opacity', s, e, 0, this.ease);
    const x = n._cur.x;
    const y = n._cur.y;
    const sx = n._cur.scaleX;
    const sy = n._cur.scaleY;
    if (this.shift) {
      const [dx, dy] = parentDelta(n, this.shift);
      n.tween('x', s, e, x + dx, this.ease);
      n.tween('y', s, e, y + dy, this.ease);
    }
    if (this.toScale !== 1) scaleTween(n, s, e, 1, this.toScale, this.ease);
    hide(n, e);
    n.tween('opacity', e, e, op, linear);
    if (this.shift) {
      n.tween('x', e, e, x, linear);
      n.tween('y', e, e, y, linear);
    }
    if (this.toScale !== 1) {
      n.tween('scaleX', e, e, sx, linear);
      n.tween('scaleY', e, e, sy, linear);
      n.tween('x', e, e, x, linear);
      n.tween('y', e, e, y, linear);
    }
    return e;
  }
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {FadeOut}
 */
export function fadeOut(node, opts) {
  return new FadeOut(node, opts);
}

/** Grow from a point (default the node's center) from zero scale. */
export class Grow extends Animation {
  /** @param {Node} node @param {Record<string, any>} [opts] from: 'center' | edge name | [x, y], spin (radians) */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
    this.from = opts.from ?? 'center';
    this.spin = opts.spin ?? 0;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const n = this.node;
    ensureAdded(scene, n, s);
    const p = Array.isArray(this.from) ? this.from : n.anchor(this.from);
    const [px, py] = n.worldToParent(p[0], p[1]);
    const x = n._cur.x;
    const y = n._cur.y;
    const sx = n._cur.scaleX;
    const sy = n._cur.scaleY;
    const eps = 1e-3;
    n.tween('scaleX', s, e, sx, this.ease, null, sx * eps);
    n.tween('scaleY', s, e, sy, this.ease, null, sy * eps);
    n.tween('x', s, e, x, this.ease, null, px + (x - px) * eps);
    n.tween('y', s, e, y, this.ease, null, py + (y - py) * eps);
    if (this.spin) {
      const r = n._cur.rotation;
      n.tween('rotation', s, e, r, this.ease, null, r - this.spin);
    }
    return e;
  }
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {Grow}
 */
export function growFromCenter(node, opts = {}) {
  return new Grow(node, { ...opts, from: 'center' });
}

/**
 * @param {Node} node
 * @param {number[]} point
 * @param {Record<string, any>} [opts]
 * @returns {Grow}
 */
export function growFromPoint(node, point, opts = {}) {
  return new Grow(node, { ...opts, from: point });
}

/**
 * @param {Node} node
 * @param {string} edge
 * @param {Record<string, any>} [opts]
 * @returns {Grow}
 */
export function growFromEdge(node, edge, opts = {}) {
  return new Grow(node, { ...opts, from: edge });
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {Grow}
 */
export function spinIn(node, opts = {}) {
  return new Grow(node, { spin: Math.PI / 2, ...opts, from: 'center' });
}

/** Grow an arrow from its start point by moving its end. */
export class GrowArrow extends Animation {
  /** @param {import('./shapes.js').Arrow} arrow @param {Record<string, any>} [opts] */
  constructor(arrow, opts = {}) {
    super(opts);
    this.arrow = arrow;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const a = this.arrow;
    ensureAdded(scene, a, s);
    const x1 = a._cur.x1;
    const y1 = a._cur.y1;
    a.tween('x2', s, e, a._cur.x2, this.ease, null, x1 + (a._cur.x2 - x1) * 0.001);
    a.tween('y2', s, e, a._cur.y2, this.ease, null, y1 + (a._cur.y2 - y1) * 0.001);
    for (const c of a.children) c.tween('opacity', s, s + this.duration * 0.25, c._cur.opacity, this.ease, null, 0);
    return e;
  }
}

/**
 * @param {import('./shapes.js').Arrow} arrow
 * @param {Record<string, any>} [opts]
 * @returns {GrowArrow}
 */
export function growArrow(arrow, opts) {
  return new GrowArrow(arrow, opts);
}

/** Shrink to the center and remove. */
export class ShrinkToCenter extends Animation {
  /** @param {Node} node @param {Record<string, any>} [opts] */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const n = this.node;
    const snapshot = { x: n._cur.x, y: n._cur.y, scaleX: n._cur.scaleX, scaleY: n._cur.scaleY };
    scaleTween(n, s, e, 1, 1e-3, this.ease);
    hide(n, e);
    for (const [k, v] of Object.entries(snapshot)) n.tween(k, e, e, v, linear);
    return e;
  }
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {ShrinkToCenter}
 */
export function shrinkToCenter(node, opts) {
  return new ShrinkToCenter(node, opts);
}

/**
 * Rotate about a point along a true circular path (not a straight-line
 * interpolation of position).
 */
export class Rotate extends Animation {
  /** @param {Node} node @param {number} angle radians @param {Record<string, any>} [opts] about: [x, y] world point */
  constructor(node, angle, opts = {}) {
    super(opts);
    this.node = node;
    this.angle = angle;
    this.about = opts.about ?? null;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const n = this.node;
    const c = this.about ?? n.center();
    const [cx, cy] = n.worldToParent(c[0], c[1]);
    const x0 = n._cur.x;
    const y0 = n._cur.y;
    const r0 = n._cur.rotation;
    const A = this.angle;
    const pos = (u) => {
      const a = A * u;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      return [cx + (x0 - cx) * cos - (y0 - cy) * sin, cy + (x0 - cx) * sin + (y0 - cy) * cos];
    };
    const [x1, y1] = pos(1);
    n.tween('rotation', s, e, r0 + A, this.ease);
    n.tween('x', s, e, x1, this.ease, (u) => pos(u)[0]);
    n.tween('y', s, e, y1, this.ease, (u) => pos(u)[1]);
    return e;
  }
}

/**
 * @param {Node} node
 * @param {number} angle
 * @param {Record<string, any>} [opts]
 * @returns {Rotate}
 */
export function rotate(node, angle, opts) {
  return new Rotate(node, angle, opts);
}

/**
 * Morph one node into another. Leaves are paired; a node with fewer pieces
 * gets copies so every piece of the target has a source. When `replace` is
 * true the source is hidden at the end and the target shown.
 */
export class Transform extends Animation {
  /** @param {Node} source @param {Node} target @param {Record<string, any>} [opts] replace, pathArc (radians) */
  constructor(source, target, opts = {}) {
    super(opts);
    this.source = source;
    this.target = target;
    this.replace = !!opts.replace;
    this.pathArc = opts.pathArc ?? 0;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const src = this.source;
    const dst = this.target;
    ensureAdded(scene, src, s);
    let A = src.leaves();
    const B = dst.leaves();
    if (!A.length || !B.length) return e;
    if (A.length < B.length) {
      const extra = [];
      for (let j = A.length; j < B.length; j++) {
        const from = A[Math.floor((j * A.length) / B.length)];
        const c = from.copy();
        c._init.visible = false;
        (from.parent || src).add(c);
        c.tween('visible', s, s, true, linear);
        extra.push(c);
      }
      A = A.concat(extra);
    }
    const pairs = A.map((a, i) => [a, B[Math.min(B.length - 1, Math.floor((i * B.length) / A.length))]]);
    for (const [a, b] of pairs) morphLeaf(a, b, s, e, this.ease, this.pathArc);
    if (this.replace) {
      hide(src, e);
      const saved = scene.clock;
      scene.clock = e;
      if (dst.scene !== scene) scene.add(dst);
      else dst.tween('visible', e, e, true, linear);
      scene.clock = saved;
    }
    return e;
  }
}

function worldGeom(n) {
  const g = n._cur.shape || n.geometry();
  return g ? transformPath(g, n.worldMatrix()) : null;
}

function morphLeaf(a, b, s, e, ease, pathArc) {
  const ga = a._cur.shape || a.geometry();
  const gbWorld = worldGeom(b);
  if (!ga || !gbWorld) return;
  const inv = invert(a.worldMatrix());
  const gb = transformPath(gbWorld, inv);
  if (pathArc) {
    const [pa, pb] = alignPaths(ga, gb);
    const ca = pathCenterOf(pa);
    const cb = pathCenterOf(pb);
    a.tween('shape', s, e, gb, ease, (u, seg) => (u >= 1 ? seg.to : arcShift(lerpAligned(pa, pb, u), ca, cb, u, pathArc)), ga);
  } else {
    a.tween('shape', s, e, gb, ease, null, ga);
  }
  const bm = multiply(inv, b.worldMatrix());
  const scaleRatio = Math.sqrt(Math.abs(bm[0] * bm[3] - bm[1] * bm[2])) || 1;
  for (const k of ['fill', 'stroke', 'fillOpacity', 'strokeOpacity', 'opacity']) {
    const to = b._cur[k];
    if (to !== a._cur[k]) a.tween(k, s, e, to, ease);
  }
  const swTarget = b._cur.strokeWidth;
  if (swTarget !== a._cur.strokeWidth && scaleRatio) a.tween('strokeWidth', s, e, swTarget, ease);
  a.tween('draw', s, s, 1, linear);
  a.tween('drawStart', s, s, 0, linear);
}

function pathCenterOf(p) {
  const b = pathBounds(p);
  return b ? [b.x + b.w / 2, b.y + b.h / 2] : [0, 0];
}

function arcShift(p, ca, cb, u, arc) {
  // Move the interpolated path along a circular arc between the two centers.
  const mx = (ca[0] + cb[0]) / 2;
  const my = (ca[1] + cb[1]) / 2;
  const dx = cb[0] - ca[0];
  const dy = cb[1] - ca[1];
  const half = Math.hypot(dx, dy) / 2;
  if (half < 1e-9) return p;
  const r = half / Math.sin(arc / 2);
  const h = r * Math.cos(arc / 2);
  const cx = mx - (dy / (2 * half)) * h;
  const cy = my + (dx / (2 * half)) * h;
  const a0 = Math.atan2(ca[1] - cy, ca[0] - cx);
  const ang = a0 + arc * u;
  const onArc = [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  const straight = [ca[0] + dx * u, ca[1] + dy * u];
  return transformPath(p, [1, 0, 0, 1, onArc[0] - straight[0], onArc[1] - straight[1]]);
}

/**
 * @param {Node} source
 * @param {Node} target
 * @param {Record<string, any>} [opts]
 * @returns {Transform}
 */
export function transform(source, target, opts) {
  return new Transform(source, target, opts);
}

/**
 * Morph source into target, then swap them in the scene graph.
 * @param {Node} source
 * @param {Node} target
 * @param {Record<string, any>} [opts]
 * @returns {Transform}
 */
export function replacementTransform(source, target, opts = {}) {
  return new Transform(source, target, { ...opts, replace: true });
}

/**
 * Transform where leaves are matched by key (for text and math, the token
 * text), matched pieces morph, and unmatched pieces fade out or in.
 */
export class TransformMatching extends Animation {
  /**
   * @param {Node} source
   * @param {Node} target
   * @param {Record<string, any>} [opts] key: (leaf) => string, pairs: explicit [i, j] index pairs
   */
  constructor(source, target, opts = {}) {
    super(opts);
    this.source = source;
    this.target = target;
    this.keyFn = opts.key ?? ((n) => n.meta.key ?? null);
    this.pairs = opts.pairs ?? null;
    this.defaultDuration = 1.4;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const A = this.source.leaves();
    const B = this.target.leaves();
    const pairs = this.pairs ?? matchByKeys(A.map(this.keyFn), B.map(this.keyFn));
    const usedA = new Set(pairs.map((p) => p[0]));
    const usedB = new Set(pairs.map((p) => p[1]));
    ensureAdded(scene, this.source, s);
    for (const [i, j] of pairs) morphLeaf(A[i], B[j], s, e, this.ease, 0);
    const shiftVec = [this.target.center()[0] - this.source.center()[0], this.target.center()[1] - this.source.center()[1]];
    A.forEach((a, i) => {
      if (usedA.has(i)) return;
      a.tween('opacity', s, s + this.duration * 0.5, 0, this.ease);
      const [dx, dy] = parentDelta(a, shiftVec);
      a.tween('x', s, e, a._cur.x + dx, this.ease);
      a.tween('y', s, e, a._cur.y + dy, this.ease);
    });
    const saved = scene.clock;
    scene.clock = e;
    hide(this.source, e);
    if (this.target.scene !== scene) scene.add(this.target);
    else this.target.tween('visible', e, e, true, linear);
    scene.clock = saved;
    const late = B.filter((_, j) => !usedB.has(j));
    if (late.length) {
      const ghost = new FadeInLeaves(late, s + this.duration * 0.35, e, this.ease);
      ghost.apply(scene, this.target);
    }
    return e;
  }
}

class FadeInLeaves {
  constructor(leaves, a, b, ease) {
    this.leaves = leaves;
    this.a = a;
    this.b = b;
    this.ease = ease;
  }

  apply(scene, owner) {
    // Unmatched target pieces are shown early inside a temporary copy so they fade in while the rest morphs.
    for (const leaf of this.leaves) {
      const ghost = leaf.copy();
      const m = leaf.worldMatrix();
      ghost.set({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 });
      ghost._init.shape = transformPath(leaf._cur.shape || leaf.geometry(), m);
      ghost._cur.shape = ghost._init.shape;
      ghost._init.visible = false;
      scene.root.add(ghost);
      ghost.tween('visible', this.a, this.a, true, linear);
      ghost.tween('opacity', this.a, this.b, leaf._cur.opacity, this.ease, null, 0);
      ghost.tween('visible', this.b, this.b, false, linear);
    }
    return owner;
  }
}

/**
 * Longest common subsequence match of two key lists; returns index pairs.
 * Null keys never match.
 * @param {Array<string|null>} a
 * @param {Array<string|null>} b
 * @returns {Array<[number, number]>}
 */
export function matchByKeys(a, b) {
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = a[i] != null && a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] != null && a[i] === b[j]) {
      out.push([i, j]);
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/**
 * @param {Node} source
 * @param {Node} target
 * @param {Record<string, any>} [opts]
 * @returns {TransformMatching}
 */
export function transformMatching(source, target, opts) {
  return new TransformMatching(source, target, opts);
}

/** Cross-fade from one node to another. */
export class CrossFade extends Animation {
  /** @param {Node} a @param {Node} b @param {Record<string, any>} [opts] */
  constructor(a, b, opts = {}) {
    super(opts);
    this.a = a;
    this.b = b;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    new FadeOut(this.a, { duration: this.duration, ease: this.ease }).schedule(scene, s);
    const f = new FadeIn(this.b, { duration: this.duration, ease: this.ease });
    f.applyDefaults({}, scene);
    f.schedule(scene, s);
    return e;
  }
}

/**
 * @param {Node} a
 * @param {Node} b
 * @param {Record<string, any>} [opts]
 * @returns {CrossFade}
 */
export function crossFade(a, b, opts) {
  return new CrossFade(a, b, opts);
}

/** Briefly scale up and tint a node, then return. */
export class Indicate extends Animation {
  /** @param {Node} node @param {Record<string, any>} [opts] scale (1.2), color ('accent') */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
    this.factor = opts.scale ?? 1.2;
    this.color = opts.color ?? 'accent';
    this.defaultEase = thereAndBack;
    this.defaultDuration = 1;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const n = this.node;
    pulse(n, s, e, this.factor, this.ease);
    for (const leaf of n.leaves()) {
      for (const k of ['fill', 'stroke']) {
        const from = leaf._cur[k];
        if (from == null) continue;
        const to = this.color;
        leaf.tween(k, s, e, from, this.ease, (u) => (u <= 0 || u >= 1 ? from : new ColorMix(from, to, u)));
      }
    }
    return e;
  }
}

function pulse(n, s, e, factor, ease) {
  const c = n.center();
  const [cx, cy] = n.worldToParent(c[0], c[1]);
  const x = n._cur.x;
  const y = n._cur.y;
  const sx = n._cur.scaleX;
  const sy = n._cur.scaleY;
  const k = (u) => 1 + (factor - 1) * u;
  n.tween('scaleX', s, e, sx, ease, (u) => sx * k(u));
  n.tween('scaleY', s, e, sy, ease, (u) => sy * k(u));
  n.tween('x', s, e, x, ease, (u) => cx + (x - cx) * k(u));
  n.tween('y', s, e, y, ease, (u) => cy + (y - cy) * k(u));
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {Indicate}
 */
export function indicate(node, opts) {
  return new Indicate(node, opts);
}

/** Wiggle: a short rotational shake with a scale pulse. */
export class Wiggle extends Animation {
  /** @param {Node} node @param {Record<string, any>} [opts] angle (0.06 rad), wiggles (6), scale (1.08) */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
    this.angle = opts.angle ?? 0.06;
    this.wiggles = opts.wiggles ?? 6;
    this.factor = opts.scale ?? 1.08;
    this.defaultDuration = 1.2;
    this.defaultEase = linear;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const n = this.node;
    const r0 = n._cur.rotation;
    const A = this.angle;
    const W = this.wiggles;
    n.tween('rotation', s, e, r0, this.ease, (u) => r0 + A * Math.sin(2 * Math.PI * W * u) * thereAndBack(u));
    pulse(n, s, e, this.factor, thereAndBack);
    return e;
  }
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {Wiggle}
 */
export function wiggle(node, opts) {
  return new Wiggle(node, opts);
}

/**
 * An animation that owns temporary helper nodes (flash lines, circumscribe
 * outlines). Helpers are added at the start and hidden at the end.
 */
class HelperAnimation extends Animation {
  addHelper(scene, node, t) {
    node._init.visible = false;
    scene.root.add(node);
    node.tween('visible', t, t, true, linear);
  }
}

/** Lines radiating from a point. */
export class Flash extends HelperAnimation {
  /** @param {Node|number[]} at @param {Record<string, any>} [opts] color, lines (12), radius (0.5), length (0.3) */
  constructor(at, opts = {}) {
    super(opts);
    this.at = at;
    this.color = opts.color ?? 'accent';
    this.lines = opts.lines ?? 12;
    this.radius = opts.radius ?? 0.45;
    this.length = opts.length ?? 0.3;
    this.defaultEase = opts.ease ?? smooth;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const p = this.at instanceof Node ? this.at.center() : this.at;
    const { PathNode } = nodeClasses;
    for (let i = 0; i < this.lines; i++) {
      const a = (2 * Math.PI * i) / this.lines;
      const r0 = this.radius * 0.35;
      const r1 = this.radius + this.length;
      const ln = new PathNode(polyPath([[p[0] + r0 * Math.cos(a), p[1] + r0 * Math.sin(a)], [p[0] + r1 * Math.cos(a), p[1] + r1 * Math.sin(a)]]), { stroke: this.color, strokeWidth: 3 });
      this.addHelper(scene, ln, s);
      ln.tween('draw', s, s + this.duration * 0.6, 1, this.ease, null, 0);
      ln.tween('drawStart', s + this.duration * 0.3, e, 1, this.ease, null, 0);
      hide(ln, e);
    }
    return e;
  }
}

/**
 * @param {Node|number[]} at
 * @param {Record<string, any>} [opts]
 * @returns {Flash}
 */
export function flash(at, opts) {
  return new Flash(at, opts);
}

/** Draw a temporary outline around a node, then erase it. */
export class Circumscribe extends HelperAnimation {
  /** @param {Node} node @param {Record<string, any>} [opts] shape: 'rect' | 'circle', color, buff, fadeOut (keep outline and fade instead of erasing) */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
    this.shape = opts.shape ?? 'rect';
    this.color = opts.color ?? 'accent';
    this.buff = opts.buff ?? 0.16;
    this.defaultDuration = 1.6;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const b = this.node.bounds();
    if (!b) return e;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const geo = this.shape === 'circle'
      ? circlePath(cx, cy, Math.hypot(b.w, b.h) / 2 + this.buff)
      : rectPath(cx, cy, b.w + 2 * this.buff, b.h + 2 * this.buff, 0.06);
    const { PathNode } = nodeClasses;
    const outline = new PathNode(geo, { stroke: this.color, strokeWidth: 3, meta: { handDrawn: true } });
    this.addHelper(scene, outline, s);
    outline.tween('draw', s, s + this.duration * 0.5, 1, this.ease, null, 0);
    outline.tween('drawStart', s + this.duration * 0.55, e, 1, this.ease, null, 0);
    hide(outline, e);
    return e;
  }
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {Circumscribe}
 */
export function circumscribe(node, opts) {
  return new Circumscribe(node, opts);
}

/** Spotlight that closes in on a point. */
export class FocusOn extends HelperAnimation {
  /** @param {Node|number[]} at @param {Record<string, any>} [opts] color, opacity */
  constructor(at, opts = {}) {
    super(opts);
    this.at = at;
    this.color = opts.color ?? 'ink';
    this.alpha = opts.opacity ?? 0.18;
    this.defaultDuration = 1.2;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const p = this.at instanceof Node ? this.at.center() : this.at;
    const { Circle } = nodeClasses;
    const R = Math.hypot(scene.frameWidth, scene.frameHeight);
    const dot = new Circle({ radius: 1, fill: this.color, stroke: null, fillOpacity: this.alpha, x: p[0], y: p[1] });
    this.addHelper(scene, dot, s);
    dot.tween('radius', s, e, 0.12, this.ease, null, R);
    dot.tween('opacity', s, e, 1, this.ease, (u) => (u < 0.8 ? u / 0.8 : (1 - u) / 0.2), 0);
    hide(dot, e);
    return e;
  }
}

/**
 * @param {Node|number[]} at
 * @param {Record<string, any>} [opts]
 * @returns {FocusOn}
 */
export function focusOn(at, opts) {
  return new FocusOn(at, opts);
}

/** A bright window that travels along a node's path. */
export class ShowPassingFlash extends Animation {
  /** @param {Node} node @param {Record<string, any>} [opts] width (fraction of length, 0.2) */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
    this.width = opts.width ?? 0.2;
    this.defaultEase = linear;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const n = this.node;
    const w = this.width;
    ensureAdded(scene, n, s);
    n.tween('draw', s, e, 1, this.ease, (u) => Math.min(1, u * (1 + w)), 0);
    n.tween('drawStart', s, e, 1, this.ease, (u) => Math.max(0, u * (1 + w) - w), 0);
    hide(n, e);
    return e;
  }
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {ShowPassingFlash}
 */
export function showPassingFlash(node, opts) {
  return new ShowPassingFlash(node, opts);
}

/** Move a node's center along a path; optionally rotate with the tangent. */
export class MoveAlongPath extends Animation {
  /** @param {Node} node @param {Node|import('./path.js').Path} path @param {Record<string, any>} [opts] rotate: boolean */
  constructor(node, path, opts = {}) {
    super(opts);
    this.node = node;
    this.path = path;
    this.orient = !!opts.rotate;
    this.defaultEase = opts.ease ?? smooth;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const n = this.node;
    const world = this.path instanceof Node ? transformPath(this.path.resolvedGeometry(), this.path.worldMatrix()) : this.path;
    const c = n.center();
    const [cx, cy] = n.worldToParent(c[0], c[1]);
    const offx = n._cur.x - cx;
    const offy = n._cur.y - cy;
    const r0 = n._cur.rotation;
    const a0 = pointAtFraction(world, 0)[2];
    const cache = new Map();
    const at = (u) => {
      const key = Math.round(u * 4096);
      if (!cache.has(key)) {
        const [x, y, ang] = pointAtFraction(world, key / 4096);
        const [px, py] = n.worldToParent(x, y);
        cache.set(key, [px + offx, py + offy, ang]);
      }
      return cache.get(key);
    };
    const end = at(1);
    n.tween('x', s, e, end[0], this.ease, (u) => at(u)[0]);
    n.tween('y', s, e, end[1], this.ease, (u) => at(u)[1]);
    if (this.orient) n.tween('rotation', s, e, r0 + end[2] - a0, this.ease, (u) => r0 + at(u)[2] - a0);
    return e;
  }
}

/**
 * @param {Node} node
 * @param {Node|import('./path.js').Path} path
 * @param {Record<string, any>} [opts]
 * @returns {MoveAlongPath}
 */
export function moveAlongPath(node, path, opts) {
  return new MoveAlongPath(node, path, opts);
}

/**
 * @param {Node} node
 * @param {Node|import('./path.js').Path} path
 * @param {Record<string, any>} [opts]
 * @returns {MoveAlongPath}
 */
export function followPath(node, path, opts = {}) {
  return new MoveAlongPath(node, path, { rotate: true, ...opts });
}

/** Orbit a point at a fixed radius. */
export class Orbit extends Animation {
  /** @param {Node} node @param {number[]} center @param {Record<string, any>} [opts] turns (1) */
  constructor(node, center, opts = {}) {
    super(opts);
    this.node = node;
    this.centerPoint = center;
    this.turns = opts.turns ?? 1;
    this.defaultEase = opts.ease ?? linear;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const n = this.node;
    const [cx, cy] = n.worldToParent(this.centerPoint[0], this.centerPoint[1]);
    const x0 = n._cur.x;
    const y0 = n._cur.y;
    const r = Math.hypot(x0 - cx, y0 - cy);
    const a0 = Math.atan2(y0 - cy, x0 - cx);
    const T = 2 * Math.PI * this.turns;
    const pos = (u) => [cx + r * Math.cos(a0 + T * u), cy + r * Math.sin(a0 + T * u)];
    n.tween('x', s, e, pos(1)[0], this.ease, (u) => pos(u)[0]);
    n.tween('y', s, e, pos(1)[1], this.ease, (u) => pos(u)[1]);
    return e;
  }
}

/**
 * @param {Node} node
 * @param {number[]} center
 * @param {Record<string, any>} [opts]
 * @returns {Orbit}
 */
export function orbit(node, center, opts) {
  return new Orbit(node, center, opts);
}

/**
 * Run a function of eased progress every frame for the duration, then bake
 * its final state. The function may set any properties.
 */
export class UpdateAnimation extends Animation {
  /** @param {(u: number) => void} fn @param {Record<string, any>} [opts] */
  constructor(fn, opts = {}) {
    super(opts);
    this.fn = fn;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const fn = this.fn;
    const ease = this.ease;
    scene.updaters.push({ fn: (t) => fn(ease(Math.min(1, Math.max(0, (t - s) / (e - s || 1))))), t0: s, t1: e });
    const saved = scene.clock;
    scene.clock = e;
    fn(1);
    scene.clock = saved;
    return e;
  }
}

/**
 * @param {(u: number) => void} fn
 * @param {Record<string, any>} [opts]
 * @returns {UpdateAnimation}
 */
export function animateWith(fn, opts) {
  return new UpdateAnimation(fn, opts);
}

/**
 * Reveal children one at a time in order (typewriter): each child appears
 * instantly at its turn.
 */
export class Typewriter extends Animation {
  /** @param {Node} node @param {Record<string, any>} [opts] cps: characters per second (overrides duration) */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
    this.cps = opts.cps ?? null;
    this.defaultEase = linear;
  }

  applyDefaults(playOpts, scene) {
    const n = this.node.leaves().length;
    if (this.cps) this.defaultDuration = n / this.cps;
    else this.defaultDuration = Math.max(0.5, n * 0.05);
    super.applyDefaults(playOpts, scene);
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    ensureAdded(scene, this.node, s);
    const leaves = this.node.leaves();
    leaves.forEach((leaf, i) => {
      const t = s + this.duration * this.ease(i / leaves.length);
      leaf.tween('opacity', s, s, 0, linear);
      leaf.tween('opacity', t, t, 1, linear);
    });
    return s + this.duration;
  }
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {Typewriter}
 */
export function typewriter(node, opts) {
  return new Typewriter(node, opts);
}

/** A marker-style highlight band that sweeps in behind a node. */
export class Highlight extends HelperAnimation {
  /** @param {Node} node @param {Record<string, any>} [opts] color ('accent'), opacity (0.22), pad (0.08), keep (true) */
  constructor(node, opts = {}) {
    super(opts);
    this.node = node;
    this.color = opts.color ?? 'accent';
    this.alpha = opts.opacity ?? 0.22;
    this.pad = opts.pad ?? 0.08;
    this.keep = opts.keep ?? true;
    this.defaultDuration = 0.8;
  }

  schedule(scene, t0) {
    const s = t0 + this.delay;
    const e = s + this.duration;
    const b = this.node.bounds();
    if (!b) return e;
    const { Rect } = nodeClasses;
    const w = b.w + 2 * this.pad;
    const h = b.h + 2 * this.pad;
    const band = new Rect({ width: w, height: h, radius: 0.04, fill: this.color, stroke: null, fillOpacity: this.alpha, x: b.x + b.w / 2, y: b.y + b.h / 2, zIndex: -1, meta: { highlight: true } });
    const x0 = b.x - this.pad;
    this.addHelper(scene, band, s);
    band.tween('width', s, e, w, this.ease, null, 0.001);
    band.tween('x', s, e, x0 + w / 2, this.ease, (u) => x0 + (w * u) / 2, x0);
    this.band = band;
    if (!this.keep) hide(band, e);
    return e;
  }
}

/**
 * @param {Node} node
 * @param {Record<string, any>} [opts]
 * @returns {Highlight}
 */
export function highlight(node, opts) {
  return new Highlight(node, opts);
}

/**
 * Classes used by helper animations, injected by the shapes module to avoid a
 * circular import between animations and shapes.
 * @type {Record<string, any>}
 */
export const nodeClasses = {};

/**
 * Register node classes used by helper animations.
 * @param {Record<string, any>} classes
 */
export function registerNodeClasses(classes) {
  Object.assign(nodeClasses, classes);
}
